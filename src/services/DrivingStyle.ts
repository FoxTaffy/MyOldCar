import { dayKey } from '@/utils/format'
import type { TrackPoint } from './TripAnalysis'
import type { Trip } from './TripRecorder'

/** Итоги стиля вождения за одну поездку (считаются по треку при её завершении). */
export interface TripStyle {
  /** Резкие разгоны (> ACCEL_KMH_S) и торможения (> BRAKE_KMH_S). */
  accel: number
  brake: number
  /** Сколько раз скорость держалась выше лимита дольше OVER_MIN_S, и сколько км при этом проехано. */
  over: number
  overKm: number
  nightKm: number
  nightMs: number
  /** Время с оборотами выше HI_RPM. */
  hiRpmMs: number
  avgRpm: number | null
  maxRpm: number | null
}

/** Порог резкого разгона, км/ч за секунду. */
export const ACCEL_KMH_S = 7
/** Порог резкого торможения, км/ч за секунду. */
export const BRAKE_KMH_S = 9
export const OVER_MIN_S = 3
export const HI_RPM = 3500
/** Ночь: с 22:00 до 06:00. */
const isNight = (t: number): boolean => { const h = new Date(t).getHours(); return h >= 22 || h < 6 }
/** Точки трека разрежены; ускорение считаем только по соседним точкам не дальше друг от друга. */
const MAX_RATE_GAP_S = 12
const MAX_SUM_GAP_S = 60

export function analyzeStyle(points: TrackPoint[], limitKmh = 110): TripStyle {
  const s: TripStyle = { accel: 0, brake: 0, over: 0, overKm: 0, nightKm: 0, nightMs: 0, hiRpmMs: 0, avgRpm: null, maxRpm: null }
  let rpmSum = 0
  let rpmMs = 0
  let overRun = 0
  let overCounted = false
  let lastKind: 'a' | 'b' | null = null
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const dt = (b.t - a.t) / 1000
    if (!(dt > 0)) continue
    if (b.rpm != null) s.maxRpm = Math.max(s.maxRpm ?? 0, b.rpm)
    if (dt <= MAX_SUM_GAP_S) {
      const rpm = a.rpm != null && b.rpm != null ? (a.rpm + b.rpm) / 2 : null
      if (rpm != null && rpm > 0) { rpmSum += rpm * dt; rpmMs += dt * 1000; if (rpm > HI_RPM) s.hiRpmMs += dt * 1000 }
    }
    if (a.spd == null || b.spd == null) { overRun = 0; overCounted = false; lastKind = null; continue }
    const avg = (a.spd + b.spd) / 2
    if (dt <= MAX_SUM_GAP_S && isNight(a.t) && avg > 1) { s.nightKm += (avg * dt) / 3600; s.nightMs += dt * 1000 }
    if (dt <= MAX_RATE_GAP_S) {
      const rate = (b.spd - a.spd) / dt
      // Один затяжной разгон — одно событие, а не по событию на каждую точку.
      const kind = rate > ACCEL_KMH_S ? 'a' : rate < -BRAKE_KMH_S && a.spd >= 15 ? 'b' : null
      if (kind && kind !== lastKind) { if (kind === 'a') s.accel++; else s.brake++ }
      lastKind = kind
    } else lastKind = null
    if (a.spd > limitKmh && b.spd > limitKmh && dt <= MAX_SUM_GAP_S) {
      overRun += dt
      s.overKm += (avg * dt) / 3600
      if (overRun >= OVER_MIN_S && !overCounted) { s.over++; overCounted = true }
    } else { overRun = 0; overCounted = false }
  }
  if (rpmMs > 0) s.avgRpm = Math.round(rpmSum / (rpmMs / 1000))
  s.nightKm = Math.round(s.nightKm * 100) / 100
  s.overKm = Math.round(s.overKm * 100) / 100
  return s
}

export type StyleKind = 'safety' | 'eco'
const clamp = (n: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, n))

/** Оценка 0–100 для одной поездки; null, если стиль не записан. */
export function tripScore(t: Trip, kind: StyleKind): number | null {
  const s = t.style
  if (!s) return null
  const km = Math.max(1, t.distanceKm)
  const harsh = s.accel + s.brake
  if (kind === 'safety') return Math.round(clamp(100 * Math.exp(-6 * ((harsh + 1.5 * s.over) / km))))
  const total = t.movingMs + t.stoppedMs
  const idle = total > 0 ? t.stoppedMs / total : 0
  const hi = total > 0 ? s.hiRpmMs / total : 0
  const harshPenalty = 30 * (1 - Math.exp(-6 * (harsh / km)))
  return Math.round(clamp(100 - 35 * Math.min(1, idle / 0.4) - 35 * Math.min(1, hi / 0.3) - harshPenalty))
}

/** Средняя оценка по набору поездок, взвешенная по пробегу. */
export function avgScore(trips: Trip[], kind: StyleKind): number | null {
  let w = 0
  let sum = 0
  for (const t of trips) {
    const sc = tripScore(t, kind)
    if (sc == null) continue
    const k = Math.max(0.5, t.distanceKm)
    w += k
    sum += sc * k
  }
  return w > 0 ? Math.round(sum / w) : null
}

export const scoreLabel = (score: number | null): string =>
  score == null ? 'Нет данных' : score >= 90 ? 'Отлично' : score >= 75 ? 'Хорошо' : score >= 55 ? 'Можно лучше' : 'Агрессивно'

/** Оценка по дням: ключ — YYYY-MM-DD. */
export function scoreByDay(trips: Trip[], kind: StyleKind): Record<string, number> {
  const groups: Record<string, Trip[]> = {}
  for (const t of trips) (groups[dayKey(t.start)] ??= []).push(t)
  const out: Record<string, number> = {}
  for (const [d, list] of Object.entries(groups)) {
    const sc = avgScore(list, kind)
    if (sc != null) out[d] = sc
  }
  return out
}

export interface StyleSummary {
  km: number
  movingMs: number
  stoppedMs: number
  avgSpeed: number
  maxSpeed: number
  avgRpm: number | null
  maxRpm: number | null
  accel: number
  brake: number
  over: number
  overKm: number
  nightKm: number
  nightMs: number
  trips: number
}

export function summarize(trips: Trip[]): StyleSummary {
  const r: StyleSummary = { km: 0, movingMs: 0, stoppedMs: 0, avgSpeed: 0, maxSpeed: 0, avgRpm: null, maxRpm: null, accel: 0, brake: 0, over: 0, overKm: 0, nightKm: 0, nightMs: 0, trips: trips.length }
  let rpmW = 0
  let rpmSum = 0
  for (const t of trips) {
    r.km += t.distanceKm
    r.movingMs += t.movingMs
    r.stoppedMs += t.stoppedMs
    r.maxSpeed = Math.max(r.maxSpeed, t.maxSpeedKmh)
    const s = t.style
    if (!s) continue
    r.accel += s.accel
    r.brake += s.brake
    r.over += s.over
    r.overKm += s.overKm
    r.nightKm += s.nightKm
    r.nightMs += s.nightMs
    if (s.maxRpm != null) r.maxRpm = Math.max(r.maxRpm ?? 0, s.maxRpm)
    if (s.avgRpm != null) { rpmSum += s.avgRpm * t.movingMs; rpmW += t.movingMs }
  }
  r.avgSpeed = r.movingMs > 0 ? r.km / (r.movingMs / 3_600_000) : 0
  r.avgRpm = rpmW > 0 ? Math.round(rpmSum / rpmW) : null
  return r
}
