import type { SensorSnapshot } from '@/types'
import { fuelLitersPer100Km } from './FuelCalculator'
import { haversineKm, type TrackPoint } from './TripAnalysis'
import { TripRecorder, type Trip, type TripEvent } from './TripRecorder'

/** Если ни один датчик (OBD и GPS) 30 минут не показывает движения/работы двигателя — поездка завершается и сохраняется. */
export const IDLE_END_MS = 30 * 60_000

/** Данные считаются «живыми», если свежее этого. */
const OBD_FRESH_MS = 5000
const GPS_FRESH_MS = 10_000
/** Скорость GPS ниже порога считаем шумом (стоим). */
const GPS_NOISE_KMH = 2
/** Точность GPS хуже — точку не используем. */
const GPS_MAX_ACCURACY_M = 60
const MAX_POINTS = 1200

export interface GpsFix {
  t: number
  lat: number
  lon: number
  /** км/ч, null если GPS не знает скорость. */
  speedKmh: number | null
  accuracy: number
  bearing?: number | null
}

export interface FinishedTrip {
  trip: Trip
  points: TrackPoint[]
}

/**
 * Сессия поездки: объединяет OBD и GPS, сама начинает и заканчивает поездку,
 * пишет трек. Время передаётся снаружи — легко тестируется.
 */
export class TripSession {
  private rec = new TripRecorder()
  points: TrackPoint[] = []
  private obd: { snap: SensorSnapshot; at: number } | null = null
  private gps: { fix: GpsFix; at: number } | null = null
  private lastActivity = 0
  private lastPointAt = 0
  private lastPointPos: { lat: number; lon: number } | null = null
  private minIntervalMs = 4000
  private prevMil = false
  private sources = new Set<'obd' | 'gps'>()
  /** Кто-то должен считать коды при загорании лампы. */
  onMil?: (ev: TripEvent) => void

  constructor(private carId?: string) {}

  get trip(): Trip | null {
    return this.rec.current
  }
  get active(): boolean {
    return this.rec.current != null
  }
  setCar(carId?: string): void {
    this.carId = carId
  }

  /** Новые показания OBD. */
  feedObd(now: number, snap: SensorSnapshot): number {
    this.obd = { snap, at: now }
    return this.step(now)
  }

  /** Новая точка GPS. */
  feedGps(now: number, fix: GpsFix): number {
    if (fix.accuracy > GPS_MAX_ACCURACY_M) return 0
    this.gps = { fix, at: now }
    return this.step(now)
  }

  private obdNow(now: number): SensorSnapshot | null {
    return this.obd && now - this.obd.at <= OBD_FRESH_MS ? this.obd.snap : null
  }
  private gpsNow(now: number): GpsFix | null {
    return this.gps && now - this.gps.at <= GPS_FRESH_MS ? this.gps.fix : null
  }

  private step(now: number): number {
    const obd = this.obdNow(now)
    const gps = this.gpsNow(now)
    const gpsSpeed = gps?.speedKmh != null ? (gps.speedKmh < GPS_NOISE_KMH ? 0 : gps.speedKmh) : null
    const speed = obd?.speedKmh ?? gpsSpeed
    const engineOn = (obd?.rpm ?? 0) > 0
    const active = engineOn || (obd?.speedKmh ?? 0) > 0 || (gpsSpeed ?? 0) > 0
    if (active) this.lastActivity = now

    if (!this.rec.current) {
      if (!active) return 0
      this.start(now)
    }
    if (obd) this.sources.add('obd')
    if (gps) this.sources.add('gps')

    const maf = obd?.mafGs ?? null
    const km = this.rec.feed(now, speed, maf)
    this.recordPoint(now, obd, gps, speed)
    return km
  }

  private start(now: number): void {
    this.rec.begin(now, this.carId)
    this.points = []
    this.sources.clear()
    this.lastPointAt = 0
    this.lastPointPos = null
    this.minIntervalMs = 4000
    this.prevMil = false
  }

  private recordPoint(now: number, obd: SensorSnapshot | null, gps: GpsFix | null, speed: number | null): void {
    const mil = obd?.milOn === true
    const milEdge = mil !== this.prevMil
    const moved = gps && this.lastPointPos ? haversineKm(this.lastPointPos, gps) * 1000 : 0
    const interval = (speed ?? 0) >= 1 ? this.minIntervalMs : this.minIntervalMs * 4
    if (!milEdge && this.points.length && now - this.lastPointAt < interval && moved < 25) return

    const maf = obd?.mafGs ?? null
    const p: TrackPoint = {
      t: now,
      lat: gps ? round(gps.lat, 6) : null,
      lon: gps ? round(gps.lon, 6) : null,
      spd: speed != null ? round(speed, 1) : null,
      rpm: obd?.rpm != null ? Math.round(obd.rpm) : null,
      ect: obd?.coolantTempC ?? null,
      maf: maf != null ? round(maf, 2) : null,
      load: obd?.loadPct != null ? round(obd.loadPct, 0) : null,
      thr: obd?.throttlePct != null ? round(obd.throttlePct, 0) : null,
      volt: obd?.voltage != null ? round(obd.voltage, 1) : null,
      mil,
      l100: maf != null ? fuelPer100(maf, speed ?? 0) : null,
    }
    this.points.push(p)
    this.lastPointAt = now
    if (gps) this.lastPointPos = gps

    if (mil && !this.prevMil) {
      const ev: TripEvent = { t: now, type: 'mil', lat: p.lat, lon: p.lon }
      const trip = this.rec.current
      if (trip) trip.events = [...(trip.events ?? []), ev]
      this.onMil?.(ev)
    }
    this.prevMil = mil
    if (this.points.length > MAX_POINTS) this.decimate()
  }

  /** Прореживает трек вдвое (кроме первой/последней точек и смен состояния лампы), чтобы поездка любой длины влезала в хранилище. */
  private decimate(): void {
    const keep = (p: TrackPoint, i: number, a: TrackPoint[]) =>
      i === 0 || i === a.length - 1 || i % 2 === 0 || p.mil !== a[i - 1].mil
    this.points = this.points.filter(keep)
    this.minIntervalMs *= 2
  }

  /**
   * Вызывать периодически (раз в минуту). Если все датчики молчат ≥ 30 минут — завершает поездку.
   * Конец поездки = момент последней активности (простой не входит в поездку).
   */
  tick(now: number): FinishedTrip | null {
    if (!this.rec.current) return null
    if (now - this.lastActivity < IDLE_END_MS) return null
    return this.finish(this.lastActivity)
  }

  /** Принудительно завершить (например, пользователь вручную). */
  finish(endAt: number = Date.now()): FinishedTrip | null {
    const trip = this.rec.end(endAt)
    const points = this.points.filter((p) => p.t <= endAt)
    this.points = []
    this.obd = null
    this.gps = null
    this.prevMil = false
    if (!trip) return null
    trip.hasTrack = points.length >= 2
    trip.source = this.sources.has('obd') && this.sources.has('gps') ? 'both' : this.sources.has('gps') ? 'gps' : 'obd'
    this.sources.clear()
    return { trip, points }
  }

  /** Восстановление из сохранённых данных (приложение закрыли посреди поездки). */
  static finalize(trip: Trip, points: TrackPoint[]): FinishedTrip | null {
    if (trip.distanceKm < 0.1) return null
    const last = points.length ? points[points.length - 1].t : trip.end
    return { trip: { ...trip, end: last, hasTrack: points.length >= 2 }, points }
  }
}

const round = (n: number, d: number): number => {
  const k = 10 ** d
  return Math.round(n * k) / k
}

function fuelPer100(maf: number, speed: number): number | null {
  const v = fuelLitersPer100Km(maf, speed)
  return v == null ? null : round(v, 1)
}
