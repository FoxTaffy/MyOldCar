import { levelOf, type SensorDef } from '@/data/sensors'

/** Накопленная статистика одного датчика за поездку. */
export interface SensorAgg {
  min: number
  max: number
  sum: number
  n: number
  okMs: number
  warnMs: number
  badMs: number
}

/** Короткий ряд для графика поездки (шаг растёт, когда массив заполнен). */
export interface TripSeries {
  /** Секунды от начала поездки. */
  t: number[]
  data: Record<string, number[]>
}

/** Эти датчики пишутся в график поездки (остальные — только min/avg/max и время в зонах). */
export const SERIES_IDS = ['speed', 'rpm', 'coolant', 'voltage', 'load'] as const
const MAX_POINTS = 180
const MAX_GAP_MS = 5000

export class SensorStatsRecorder {
  agg: Record<string, SensorAgg> = {}
  series: TripSeries = { t: [], data: Object.fromEntries(SERIES_IDS.map((id) => [id, [] as number[]])) }
  private lastT: number | null = null
  private startT: number | null = null
  private stepMs = 10_000
  private nextPoint = 0

  constructor(private readonly defs: () => SensorDef[]) {}

  reset(): void {
    this.agg = {}
    this.series = { t: [], data: Object.fromEntries(SERIES_IDS.map((id) => [id, [] as number[]])) }
    this.lastT = null
    this.startT = null
    this.stepMs = 10_000
    this.nextPoint = 0
  }

  feed(t: number, values: Record<string, number | null | undefined>): void {
    const dt = this.lastT == null ? 0 : t - this.lastT
    const span = dt > 0 && dt <= MAX_GAP_MS ? dt : 0
    this.lastT = t
    if (this.startT == null) { this.startT = t; this.nextPoint = t }
    for (const def of this.defs()) {
      const v = values[def.id]
      if (v == null || Number.isNaN(v)) continue
      const a = (this.agg[def.id] ??= { min: v, max: v, sum: 0, n: 0, okMs: 0, warnMs: 0, badMs: 0 })
      a.min = Math.min(a.min, v)
      a.max = Math.max(a.max, v)
      a.sum += v
      a.n++
      const l = levelOf(def, v)
      if (l === 'ok') a.okMs += span
      else if (l === 'warn') a.warnMs += span
      else a.badMs += span
    }
    if (t >= this.nextPoint) {
      this.nextPoint = t + this.stepMs
      const s = this.series
      s.t.push(Math.round((t - this.startT) / 1000))
      for (const id of SERIES_IDS) s.data[id].push(round(values[id] ?? NaN))
      if (s.t.length > MAX_POINTS) {
        const half = (arr: number[]) => arr.filter((_, i) => i % 2 === 0)
        s.t = half(s.t)
        for (const id of SERIES_IDS) s.data[id] = half(s.data[id])
        this.stepMs *= 2
      }
    }
  }

  snapshot(): { sensors: Record<string, SensorAgg>; series: TripSeries } {
    const s = this.series
    return {
      sensors: Object.fromEntries(Object.entries(this.agg).map(([k, a]) => [k, { ...a }])),
      series: { t: [...s.t], data: Object.fromEntries(Object.entries(s.data).map(([k, v]) => [k, [...v]])) },
    }
  }
}

/** NaN в JSON превратится в null — это «нет данных» на графике. */
const round = (v: number): number => (Number.isNaN(v) ? NaN : Math.round(v * 10) / 10)

export const aggAvg = (a: SensorAgg): number => (a.n ? a.sum / a.n : 0)
