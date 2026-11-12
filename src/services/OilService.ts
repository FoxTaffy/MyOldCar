import type { Level } from '@/types'

export interface OilState {
  /** Дата последней замены (YYYY-MM-DD) или null, если не задана. */
  dateISO: string | null
  /** Сколько км проехано с замены на момент ввода (по одометру/на глаз). */
  offsetKm: number
  /** Значение счётчика пробега приложения в момент ввода. */
  trackedAtSet: number
  intervalKm: number
}

export const DEFAULT_OIL: OilState = { dateISO: null, offsetKm: 0, trackedAtSet: 0, intervalKm: 10000 }

export interface OilStatus {
  configured: boolean
  sinceKm: number
  leftKm: number
  /** 0…100+ — доля интервала. */
  pct: number
  level: Level
  daysSince: number | null
  /** Масло пора менять по сроку (прошёл год), даже если пробег ещё не вышел. */
  overdueByTime: boolean
}

/** Масло стареет и без пробега: раз в год его меняют независимо от километража. */
export const OIL_MAX_DAYS = 365

/**
 * Пробег с замены = введённый вручную пробег + то, что приложение намеряло по скорости
 * после ввода. По OBD одометр недоступен, поэтому считаем сами и поправляем вручную.
 */
export function oilStatus(o: OilState, trackedTotalKm: number, now = new Date(), maxDays = OIL_MAX_DAYS): OilStatus {
  if (!o.dateISO) return { configured: false, sinceKm: 0, leftKm: o.intervalKm, pct: 0, level: 'ok', daysSince: null, overdueByTime: false }
  const sinceKm = Math.max(0, o.offsetKm + trackedTotalKm - o.trackedAtSet)
  const pct = (sinceKm / o.intervalKm) * 100
  const raw = Math.floor((now.getTime() - new Date(o.dateISO + 'T00:00:00').getTime()) / 86400000)
  const days = Number.isFinite(raw) ? Math.max(0, raw) : null
  const overdueByTime = days != null && days >= maxDays
  return {
    configured: true,
    sinceKm,
    leftKm: o.intervalKm - sinceKm,
    pct,
    level: pct >= 100 || overdueByTime ? 'bad' : pct >= 80 || (days != null && days >= maxDays - 35) ? 'warn' : 'ok',
    daysSince: days,
    overdueByTime,
  }
}
