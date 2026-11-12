import { describe, expect, it } from 'vitest'
import { buildRoute, inPeriod } from '../src/services/RouteSummary'
import type { TrackPoint } from '../src/services/TripAnalysis'

const pt = (i: number): TrackPoint => ({ t: i * 1000, lat: 55 + i * 0.0005, lon: 37 + i * 0.0005, spd: 40, rpm: null, ect: null, maf: null, load: null, thr: null, volt: null, mil: false, l100: null })

describe('маршрут для общей карты', () => {
  it('прореживает длинный трек и сохраняет концы', () => {
    const pts = Array.from({ length: 1200 }, (_, i) => pt(i))
    const r = buildRoute(pts)
    expect(r.length).toBeLessThanOrEqual(225)
    expect(r[0]).toEqual([55, 37])
    expect(r[r.length - 1][0]).toBeCloseTo(55 + 1199 * 0.0005, 4)
  })
  it('точки без координат игнорирует', () => {
    expect(buildRoute([{ ...pt(0), lat: null, lon: null }, pt(1)])).toEqual([])
  })
  it('периоды 7 / 30 дней / всё', () => {
    const now = Date.parse('2026-06-30T12:00:00Z')
    const d = (n: number) => ({ start: now - n * 86_400_000 })
    const trips = [d(1), d(10), d(100)]
    expect(inPeriod(trips, '7', now)).toHaveLength(1)
    expect(inPeriod(trips, '30', now)).toHaveLength(2)
    expect(inPeriod(trips, 'all', now)).toHaveLength(3)
  })
})
