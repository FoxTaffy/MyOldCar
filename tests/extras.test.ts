import { describe, expect, it } from 'vitest'
import { fuelRange } from '@/services/FuelRange'
import { adapterInfo } from '@/services/ELMService'
import { styleTips, summarize } from '@/services/DrivingStyle'
import type { Expense } from '@/services/Expenses'
import type { Trip } from '@/services/TripRecorder'

const fill = (odometerKm: number, liters: number, full = true): Expense => ({ id: String(odometerKm), carId: 'a', cat: 'fuel', date: '2026-01-01', amount: liters * 60, liters, odometerKm, full })

describe('запас хода', () => {
  it('по датчику уровня', () => {
    const r = fuelRange({ tankL: 40, levelPct: 50, l100: 10, odometerKm: null, fills: [] })
    expect(r).toMatchObject({ litersLeft: 20, km: 200, source: 'sensor', low: false })
  })
  it('от последнего полного бака с доливом', () => {
    const r = fuelRange({ tankL: 40, levelPct: null, l100: 10, odometerKm: 1300, fills: [fill(1000, 35), fill(1100, 5, false)] })
    // 40 + 5 − 30 = 15 л → 150 км
    expect(r?.litersLeft).toBeCloseTo(15)
    expect(r?.km).toBeCloseTo(150)
    expect(r?.source).toBe('fill')
  })
  it('мало топлива', () => {
    expect(fuelRange({ tankL: 40, levelPct: 8, l100: 9, odometerKm: null, fills: [] })?.low).toBe(true)
  })
  it('без бака или расхода — нет оценки', () => {
    expect(fuelRange({ tankL: null, levelPct: 50, l100: 9, odometerKm: null, fills: [] })).toBeNull()
    expect(fuelRange({ tankL: 40, levelPct: null, l100: 9, odometerKm: 100, fills: [] })).toBeNull()
  })
})

describe('адаптер', () => {
  it('клон v2.1 — предупреждение, v1.5 и OBDLink — нет', () => {
    expect(adapterInfo('\r\rELM327 v2.1\r\r>').warning).toMatch(/клон/)
    expect(adapterInfo('ELM327 v1.5').warning).toBeNull()
    expect(adapterInfo('ELM327 v1.5').version).toBe('ELM327 v1.5')
    expect(adapterInfo('OBDLink MX+ r2.3').warning).toBeNull()
  })
})

describe('советы по стилю', () => {
  const trip = (style: Partial<NonNullable<Trip['style']>>): Trip => ({
    id: 'x', start: 0, end: 1, distanceKm: 100, fuelL: 8, movingMs: 3_600_000, stoppedMs: 600_000, maxSpeedKmh: 140,
    style: { accel: 0, brake: 0, over: 0, overKm: 0, nightKm: 0, nightMs: 0, hiRpmMs: 0, avgRpm: 2200, maxRpm: 4000, ...style },
  })
  it('резкая езда даёт советы, спокойная — нет', () => {
    expect(styleTips(summarize([trip({ accel: 8, brake: 6, overKm: 20 })]))).toHaveLength(3)
    expect(styleTips(summarize([trip({})]))).toEqual([])
  })
  it('мало пробега — без советов', () => {
    expect(styleTips(summarize([{ ...trip({ accel: 9 }), distanceKm: 5 }]))).toEqual([])
  })
})
