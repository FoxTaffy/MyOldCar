import type { SensorDef } from '@/data/sensors'
import { fuelLitersPerHour } from './FuelCalculator'
import { SensorStatsRecorder, type SensorAgg, type TripSeries } from './SensorStats'

/** Событие в пути: загорелась лампа Check Engine. */
export interface TripEvent {
  t: number
  type: 'mil'
  lat: number | null
  lon: number | null
  /** Коды ошибок, считанные из ЭБУ в момент загорания (если удалось). */
  codes?: string[]
}

export interface Trip {
  id: string
  /** Автомобиль, на котором совершена поездка. */
  carId?: string
  start: number
  end: number
  distanceKm: number
  fuelL: number
  movingMs: number
  stoppedMs: number
  maxSpeedKmh: number
  /** Откуда данные: OBD-датчики, GPS или оба. */
  source?: 'obd' | 'gps' | 'both'
  events?: TripEvent[]
  /** Есть ли сохранённый трек (точки с координатами и показаниями). */
  hasTrack?: boolean
  /** Статистика датчиков за поездку (у старых записей нет). */
  sensors?: Record<string, SensorAgg>
  /** Ряды для графика поездки. */
  series?: TripSeries
}

export const tripAvgSpeed = (t: Trip): number => (t.movingMs > 0 ? t.distanceKm / (t.movingMs / 3_600_000) : 0)
export const tripConsumption = (t: Trip): number | null => (t.distanceKm >= 0.5 && t.fuelL > 0 ? (t.fuelL / t.distanceKm) * 100 : null)

/** Пропуски в данных длиннее этого по скорости не интегрируем (потеря связи, пауза опроса). */
const MAX_GAP_MS = 5000
/** Пропуск до 10 минут можно закрыть смещением по GPS (редкие точки в фоне, тоннель). */
export const MAX_GPS_GAP_MS = 10 * 60_000

/** Интегрирует скорость и расход ДМРВ в поездку, а также статистику датчиков. Не зависит от железа — легко тестируется. */
export class TripRecorder {
  current: Trip | null = null
  readonly stats: SensorStatsRecorder
  private last: { t: number; speed: number } | null = null

  constructor(defs: () => SensorDef[] = () => []) {
    this.stats = new SensorStatsRecorder(defs)
  }

  /** Копия текущей поездки вместе со статистикой датчиков (для сохранения и показа). */
  snapshot(): Trip | null {
    const t = this.current
    return t ? { ...t, ...this.stats.snapshot() } : null
  }

  begin(now: number, carId?: string): void {
    this.stats.reset()
    this.current = { id: String(now), carId, start: now, end: now, distanceKm: 0, fuelL: 0, movingMs: 0, stoppedMs: 0, maxSpeedKmh: 0 }
    this.last = null
  }

  /**
   * Возвращает приращение пробега, км. mafGs=null — расход за этот интервал не считаем (нет данных ДМРВ).
   * values — показания всех датчиков на этот момент (для статистики). gapKm — смещение по GPS с прошлой точки:
   * им закрываем пропуск, слишком длинный для интегрирования скорости.
   */
  feed(t: number, speedKmh: number | null, mafGs: number | null, values?: Record<string, number | null | undefined>, gapKm?: number | null): number {
    const trip = this.current
    if (!trip) return 0
    // Опоздавшие данные (старее уже учтённых) не должны сбивать счёт времени.
    if (this.last && t <= this.last.t) return 0
    if (values) this.stats.feed(t, values)
    if (speedKmh == null) return 0
    const prev = this.last
    this.last = { t, speed: speedKmh }
    trip.maxSpeedKmh = Math.max(trip.maxSpeedKmh, speedKmh)
    trip.end = t
    if (!prev) return 0
    const dt = t - prev.t
    if (dt > MAX_GAP_MS) {
      if (gapKm == null || dt > MAX_GPS_GAP_MS) return 0
      trip.distanceKm += gapKm
      if (gapKm > 0) trip.movingMs += dt
      else trip.stoppedMs += dt
      return gapKm
    }
    const km = (((prev.speed + speedKmh) / 2) * dt) / 3_600_000
    trip.distanceKm += km
    if (speedKmh >= 1 || prev.speed >= 1) trip.movingMs += dt
    else trip.stoppedMs += dt
    if (mafGs != null) trip.fuelL += (fuelLitersPerHour(mafGs) * dt) / 3_600_000
    return km
  }

  /** Время без движения учитываем как стоянку, даже когда данных скорости нет (потеря связи, пауза). */
  addStopped(ms: number): void {
    if (this.current && ms > 0) this.current.stoppedMs += ms
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
