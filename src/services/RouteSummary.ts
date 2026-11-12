import type { TrackPoint } from './TripAnalysis'
import { haversineKm } from './TripAnalysis'

/** Компактный маршрут поездки для общей карты: [широта, долгота]. */
export type Route = [number, number][]

const MAX_ROUTE_POINTS = 220

/** Прореживает трек до ≤ MAX_ROUTE_POINTS точек (с равным шагом по расстоянию), координаты до 5 знаков (~1 м). */
export function buildRoute(points: TrackPoint[]): Route {
  const pts = points.filter((p) => p.lat != null && p.lon != null) as (TrackPoint & { lat: number; lon: number })[]
  if (pts.length < 2) return []
  let total = 0
  for (let i = 1; i < pts.length; i++) total += haversineKm(pts[i - 1], pts[i])
  const step = total / (MAX_ROUTE_POINTS - 1)
  const out: Route = [[round5(pts[0].lat), round5(pts[0].lon)]]
  let acc = 0
  for (let i = 1; i < pts.length; i++) {
    acc += haversineKm(pts[i - 1], pts[i])
    if (acc >= step && i < pts.length - 1) { out.push([round5(pts[i].lat), round5(pts[i].lon)]); acc = 0 }
  }
  const last = pts[pts.length - 1]
  out.push([round5(last.lat), round5(last.lon)])
  return out
}

const round5 = (n: number): number => Math.round(n * 1e5) / 1e5

export type RoutePeriod = '7' | '30' | 'all'

/** Поездки, попадающие в период (7 дней, 30 дней или всё время). */
export function inPeriod<T extends { start: number }>(trips: T[], period: RoutePeriod, now = Date.now()): T[] {
  if (period === 'all') return trips
  const from = now - Number(period) * 86_400_000
  return trips.filter((t) => t.start >= from)
}
