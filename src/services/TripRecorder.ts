import type { SensorDef } from '@/data/sensors'
import { fuelLitersPerHour } from './FuelCalculator'
import { SensorStatsRecorder, type SensorAgg, type TripSeries } from './SensorStats'

export interface Trip {
  id: string
  start: number
  end: number
  distanceKm: number
  fuelL: number
  movingMs: number
  stoppedMs: number
  maxSpeedKmh: number
  /** Статистика датчиков за поездку (у старых записей нет). */
  sensors?: Record<string, SensorAgg>
  /** Ряды для графика поездки. */
  series?: TripSeries
}

export const tripAvgSpeed = (t: Trip): number => (t.movingMs > 0 ? t.distanceKm / (t.movingMs / 3_600_000) : 0)
export const tripConsumption = (t: Trip): number | null => (t.distanceKm >= 0.5 ? (t.fuelL / t.distanceKm) * 100 : null)

/** Пропуски в данных длиннее этого не интегрируем (потеря связи, пауза опроса). */
const MAX_GAP_MS = 5000

/** Интегрирует скорость и расход ДМРВ в поездку. Не зависит от железа — легко тестируется. */
export class TripRecorder {
  current: Trip | null = null
  readonly stats: SensorStatsRecorder
  private last: { t: number; speed: number; maf: number | null } | null = null

  constructor(defs: () => SensorDef[] = () => []) {
    this.stats = new SensorStatsRecorder(defs)
  }

  /** Копия текущей поездки вместе со статистикой датчиков (для сохранения). */
  snapshot(): Trip | null {
    const t = this.current
    return t ? { ...t, ...this.stats.snapshot() } : null
  }

  begin(now: number): void {
    this.stats.reset()
    this.current = { id: String(now), start: now, end: now, distanceKm: 0, fuelL: 0, movingMs: 0, stoppedMs: 0, maxSpeedKmh: 0 }
    this.last = null
  }

  /** Возвращает приращение пробега, км (для общего счётчика). */
  feed(t: number, speedKmh: number | null, mafGs: number | null, values?: Record<string, number | null | undefined>): number {
    const trip = this.current
    if (trip && values) this.stats.feed(t, values)
    if (!trip || speedKmh == null) return 0
    const prev = this.last
    this.last = { t, speed: speedKmh, maf: mafGs ?? prev?.maf ?? null }
    trip.maxSpeedKmh = Math.max(trip.maxSpeedKmh, speedKmh)
    trip.end = t
    if (!prev) return 0
    const dt = t - prev.t
    if (dt <= 0 || dt > MAX_GAP_MS) return 0
    const km = (((prev.speed + speedKmh) / 2) * dt) / 3_600_000
    trip.distanceKm += km
    if (speedKmh >= 1 || prev.speed >= 1) trip.movingMs += dt
    else trip.stoppedMs += dt
    const maf = this.last.maf
    if (maf != null) trip.fuelL += (fuelLitersPerHour(maf) * dt) / 3_600_000
    return km
  }

  /** Завершает поездку; слишком короткие (<0.1 км) отбрасываются. */
  end(now: number): Trip | null {
    const trip = this.current
    this.current = null
    this.last = null
    if (!trip) return null
    trip.end = now
    Object.assign(trip, this.stats.snapshot())
    return trip.distanceKm >= 0.1 ? trip : null
  }
}
