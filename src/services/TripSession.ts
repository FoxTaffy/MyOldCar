import type { SensorSnapshot } from '@/types'
import { fuelLitersPer100Km } from './FuelCalculator'
import { haversineKm, type TrackPoint } from './TripAnalysis'
import type { SensorDef } from '@/data/sensors'
import { analyzeStyle } from './DrivingStyle'
import { classifyMotion, type MotionResult } from './MotionState'
import { MAX_GPS_GAP_MS, TripRecorder, type Trip, type TripEvent } from './TripRecorder'

/** Если ни один датчик (OBD и GPS) 30 минут не показывает движения/работы двигателя — поездка завершается и сохраняется. */
export const IDLE_END_MS = 30 * 60_000

/** Данные считаются «живыми», если свежее этого. */
const OBD_FRESH_MS = 5000
const GPS_FRESH_MS = 10_000
/** Координата точки трека: в фоне фиксы редки (10–60 с), поэтому для маршрута берём последнюю точку и постарше. */
const GPS_POS_FRESH_MS = 60_000
/** Скорость GPS ниже порога считаем шумом (стоим). */
const GPS_NOISE_KMH = 2
/** Смещение быстрее этого между редкими точками — выброс GPS, а не езда. */
const GPS_MAX_KMH = 250
/** Точность GPS хуже — точку не используем. */
const GPS_MAX_ACCURACY_M = 60
const MAX_POINTS = 1200

/** Резче этого GPS-скорость меняться не может (разгон 0–100 за 3 с ≈ 33 км/ч за с), км/ч в секунду. */
const GPS_MAX_ACCEL_KMH_PER_S = 35
/** Скорость GPS, больше смещения за интервал более чем в 1.5 раза + этот запас, считаем выбросом, км/ч. */
const GPS_DRIFT_MARGIN_KMH = 25
/** Сравнивать скорость с соседней точкой и со смещением имеет смысл, только если точки близки по времени. */
const GPS_COMPARE_MAX_MS = 15_000

/**
 * Скорость, которую GPS иногда «выдаёт» одной точкой (200+ км/ч при реальных 40): сверхпредел, нереальный разгон
 * относительно прошлой точки или заметно больше, чем даёт смещение между точками.
 */
export function isGpsSpeedOutlier(
  speedKmh: number,
  prev: { speedKmh: number | null; dtMs: number } | null,
  driftKmh: number | null,
): boolean {
  if (speedKmh > GPS_MAX_KMH) return true
  if (prev && prev.dtMs > 0 && prev.dtMs <= GPS_COMPARE_MAX_MS) {
    if (prev.speedKmh != null && (speedKmh - prev.speedKmh) / (prev.dtMs / 1000) > GPS_MAX_ACCEL_KMH_PER_S) return true
    if (driftKmh != null && speedKmh > driftKmh * 1.5 + GPS_DRIFT_MARGIN_KMH) return true
  }
  return false
}

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
  private rec: TripRecorder
  /** Последние показания всех датчиков (каталог + PID) — для статистики поездки. */
  private values: Record<string, number | null | undefined> | undefined
  points: TrackPoint[] = []
  private obd: { snap: SensorSnapshot; at: number } | null = null
  private gps: { fix: GpsFix; at: number } | null = null
  private lastActivity = 0
  private lastPointAt = 0
  /** Время последних обработанных данных (OBD или GPS). */
  private lastAt = 0
  private lastPointPos: { lat: number; lon: number } | null = null
  private minIntervalMs = 4000
  private prevMil = false
  private sources = new Set<'obd' | 'gps'>()
  /** Кто-то должен считать коды при загорании лампы. */
  onMil?: (ev: TripEvent) => void
  /** Последнее решение «едем / стоим / накат» (по скорости и оборотам). */
  motion: MotionResult | null = null
  /** Демо-режим: новые поездки помечаются как демонстрационные. */
  demo = false
  /** Порог превышения скорости для оценки стиля вождения, км/ч. */
  speedLimit = 110

  constructor(private carId?: string, defs: () => SensorDef[] = () => []) {
    this.rec = new TripRecorder(defs)
  }

  get trip(): Trip | null {
    return this.rec.current
  }
  /** Текущая поездка со статистикой датчиков (для показа и сохранения). */
  snapshot(): Trip | null {
    return this.rec.snapshot()
  }
  get active(): boolean {
    return this.rec.current != null
  }
  setCar(carId?: string): void {
    this.carId = carId
  }

  /** Новые показания OBD. */
  feedObd(now: number, snap: SensorSnapshot, values?: Record<string, number | null | undefined>): number {
    this.obd = { snap, at: now }
    if (values) this.values = values
    return this.step(now)
  }

  /** Новая точка GPS. */
  feedGps(now: number, fix: GpsFix): number {
    if (fix.accuracy > GPS_MAX_ACCURACY_M) return 0
    const prev = this.gps
    // Точки GPS идут строго по времени: повтор или более старая точка не нужны.
    if (prev && now <= prev.at) return 0
    // Смещение с прошлой точки. В фоне и по сети точки приходят редко (раз в 10–60 с) и часто без скорости —
    // тогда скорость и пробег считаем по координатам, иначе такая поездка не записалась бы вовсе.
    let gapKm: number | null = null
    let driftKmh: number | null = null
    const dt = prev ? now - prev.at : 0
    if (prev && dt <= MAX_GPS_GAP_MS) {
      const metres = haversineKm(prev.fix, fix) * 1000
      // Смещение меньше погрешности GPS — это стоянка, а не движение.
      const noise = Math.max(prev.fix.accuracy, fix.accuracy, 5)
      const kmh = metres < noise ? 0 : (metres / (dt / 1000)) * 3.6
      if (kmh <= GPS_MAX_KMH) {
        gapKm = kmh > 0 ? metres / 1000 : 0
        driftKmh = kmh
      }
    }
    // Выброс скорости GPS (одиночный скачок до 200+ км/ч) заменяем скоростью по смещению, а если её нет — отбрасываем.
    if (fix.speedKmh != null && isGpsSpeedOutlier(fix.speedKmh, prev ? { speedKmh: prev.fix.speedKmh, dtMs: dt } : null, driftKmh)) {
      fix = { ...fix, speedKmh: null }
    }
    if (fix.speedKmh == null && driftKmh != null) fix = { ...fix, speedKmh: driftKmh }
    this.gps = { fix, at: now }
    if (now >= this.lastAt) return this.step(now, gapKm)
    // Точка опоздала: OBD уже прислал более свежие данные (обычное дело, когда приложение проснулось и дочитывает журнал GPS).
    return this.late(now, fix, prev?.at ?? now, gapKm)
  }

  /**
   * Опоздавшая точка GPS. Время поездки она не двигает, но если приложение в этот промежуток спало,
   * её пробег закрывает пропуск, а координаты попадают в трек на своё место.
   */
  private late(now: number, fix: GpsFix, from: number, gapKm: number | null): number {
    if (!this.rec.current || gapKm == null) return 0
    const km = this.rec.fillHole(from, now, gapKm)
    if (km > 0) this.lastActivity = Math.max(this.lastActivity, now)
    let i = this.points.length
    while (i > 0 && this.points[i - 1].t > now) i--
    const before = this.points[i - 1]
    const after = this.points[i]
    // В трек — только если рядом по времени нет точки (то есть это действительно пропуск).
    if ((!before || now - before.t >= this.minIntervalMs) && (!after || after.t - now >= this.minIntervalMs)) {
      this.points.splice(i, 0, {
        t: now, lat: round(fix.lat, 6), lon: round(fix.lon, 6), spd: fix.speedKmh != null ? round(fix.speedKmh, 1) : null,
        rpm: null, ect: null, maf: null, load: null, thr: null, volt: null, mil: before?.mil ?? false, l100: null,
      })
      this.sources.add('gps')
      if (this.points.length > MAX_POINTS) this.decimate()
    }
    return km
  }

  private obdNow(now: number): SensorSnapshot | null {
    return this.obd && now - this.obd.at <= OBD_FRESH_MS ? this.obd.snap : null
  }
  private gpsNow(now: number): GpsFix | null {
    return this.gps && now - this.gps.at <= GPS_FRESH_MS ? this.gps.fix : null
  }

  private step(now: number, gapKm: number | null = null): number {
    this.lastAt = Math.max(this.lastAt, now)
    const obd = this.obdNow(now)
    const gps = this.gpsNow(now)
    const gpsSpeed = gps?.speedKmh != null ? (gps.speedKmh < GPS_NOISE_KMH ? 0 : gps.speedKmh) : null
    const obdSpeed = obd?.speedKmh ?? null
    // «Едем или стоим» решаем по скорости и оборотам вместе: GPS на стоянке дрейфует, а датчик скорости может врать.
    const motion = classifyMotion({ obdSpeed, rpm: obd?.rpm ?? null, gpsSpeed })
    this.motion = motion
    const speed: number | null = obd == null && gps == null ? null : motion.speed
    const engineOn = (obd?.rpm ?? 0) > 0
    const active = engineOn || (obdSpeed ?? 0) > 0 || (gpsSpeed ?? 0) > 0
    if (active) this.lastActivity = Math.max(this.lastActivity, now)

    if (!this.rec.current) {
      if (!active) return 0
      this.start(now)
    }
    if (obd) this.sources.add('obd')
    if (gps) this.sources.add('gps')

    const maf = obd?.mafGs ?? null
    // Показания датчиков берём, только пока OBD свежий. Когда приложение свёрнуто и опрос остановился, в `this.values`
    // лежат устаревшие данные: если их подставлять на каждую точку GPS, график «замирает» на последнем значении (чаще 0).
    // Тогда в статистику идёт только скорость по GPS, остальные датчики на графике — разрыв.
    const values = obd ? this.values : speed != null ? { speed } : undefined
    const km = this.rec.feed(now, speed, maf, values, gapKm)
    this.recordPoint(now, obd, gps, speed)
    return km
  }

  private start(now: number): void {
    this.rec.begin(now, this.carId, this.demo)
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
    // Для маршрута годится и не самая свежая точка GPS; для скорости и движения остаётся строгая свежесть (gps).
    const pos = gps ?? (this.gps && now - this.gps.at <= GPS_POS_FRESH_MS ? this.gps.fix : null)
    const moved = pos && this.lastPointPos ? haversineKm(this.lastPointPos, pos) * 1000 : 0
    const interval = (speed ?? 0) >= 1 ? this.minIntervalMs : this.minIntervalMs * 4
    // Пока в треке нет ни одной координаты, а она появилась, точку пишем без оглядки на интервал — иначе OBD «занимает» слот,
    // и редкие фоновые фиксы GPS отбрасываются.
    const needFirstPos = pos != null && this.lastPointPos == null
    if (!milEdge && !needFirstPos && this.points.length && now - this.lastPointAt < interval && moved < 25) return

    const maf = obd?.mafGs ?? null
    const p: TrackPoint = {
      t: now,
      lat: pos ? round(pos.lat, 6) : null,
      lon: pos ? round(pos.lon, 6) : null,
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
    if (pos) this.lastPointPos = pos

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
    this.lastAt = 0
    this.values = undefined
    this.prevMil = false
    if (!trip) return null
    trip.hasTrack = points.length >= 2
    trip.source = this.sources.has('obd') && this.sources.has('gps') ? 'both' : this.sources.has('gps') ? 'gps' : 'obd'
    this.sources.clear()
    if (points.length >= 2) trip.style = analyzeStyle(points, this.speedLimit)
    return { trip, points }
  }

  /** Восстановление из сохранённых данных (приложение закрыли посреди поездки). */
  static finalize(trip: Trip, points: TrackPoint[]): FinishedTrip | null {
    if (trip.distanceKm < 0.1) return null
    const last = points.length ? points[points.length - 1].t : trip.end
    return { trip: { ...trip, end: last, hasTrack: points.length >= 2, style: points.length >= 2 ? analyzeStyle(points) : undefined }, points }
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
