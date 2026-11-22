import { describe, expect, it } from 'vitest'
import { expenseYears, monthSummary, yearReport, type Expense } from '@/services/Expenses'
import { expensesToCsv, toCsv, trackToCsv, trackToGpx } from '@/services/Export'
import type { TrackPoint } from '@/services/TripAnalysis'

const pt = (t: number, lat: number | null, lon: number | null, spd = 50): TrackPoint => ({ t, lat, lon, spd, rpm: 2000, ect: 90, maf: 5, load: 30, thr: 10, volt: 14.1, mil: false })
const ex = (date: string, cat: Expense['cat'], amount: number, extra: Partial<Expense> = {}): Expense => ({ id: date + cat, carId: 'a', date, cat, amount, ...extra })

describe('экспорт', () => {
  it('CSV: BOM, «;», десятичная запятая, экранирование', () => {
    const s = toCsv(['a', 'b'], [[1.5, 'x;y'], [null, 'кавычка "q"']])
    expect(s.startsWith('﻿')).toBe(true)
    expect(s).toContain('1,5;"x;y"')
    expect(s).toContain(';"кавычка ""q"""')
  })
  it('GPX: только точки с координатами, с временем и расширениями', () => {
    const g = trackToGpx([pt(0, 55.75, 37.62), pt(1000, null, null), pt(2000, 55.76, 37.63)], 'Поездка <1>')
    expect(g.match(/<trkpt /g)).toHaveLength(2)
    expect(g).toContain('<time>1970-01-01T00:00:02.000Z</time>')
    expect(g).toContain('<myoldcar:rpm>2000</myoldcar:rpm>')
    expect(g).toContain('Поездка &lt;1&gt;')
  })
  it('CSV трека: строка на точку', () => {
    expect(trackToCsv([pt(0, 1, 2), pt(1, 1, 2)]).trim().split('\r\n')).toHaveLength(3)
  })
  it('CSV журнала отсортирован по дате', () => {
    const csv = expensesToCsv([ex('2026-03-01', 'fuel', 1000, { liters: 15 }), ex('2026-01-01', 'docs', 9000)], () => 'ВАЗ')
    const lines = csv.trim().split('\r\n')
    expect(lines[1]).toMatch(/^2026-01-01;ВАЗ;Страховка/)
  })
})

describe('категории и стоимость владения', () => {
  const list = [
    ex('2026-01-10', 'fuel', 3000, { odometerKm: 100000 }), ex('2026-02-10', 'docs', 9000), ex('2026-02-11', 'road', 500),
    ex('2026-06-10', 'fuel', 3000, { odometerKm: 106000 }), ex('2025-05-01', 'service', 4000), ex('2026-02-12', 'legacy' as Expense['cat'], 100),
  ]
  it('новые категории в месячной сводке, неизвестные — в «Прочее»', () => {
    const m = monthSummary(list, '2026-02')
    expect(m.total).toBe(9600)
    expect(m.byCat.docs.amount).toBe(9000)
    expect(m.byCat.other.amount).toBe(100)
  })
  it('год: в месяц и на километр (по одометру заправок)', () => {
    const r = yearReport(list, 2026, null, new Date('2026-06-30'))
    expect(r.total).toBe(15600)
    expect(r.months).toBe(6)
    expect(r.perMonth).toBe(2600)
    expect(r.km).toBe(6000)
    expect(r.perKm).toBeCloseTo(2.6)
    expect(yearReport(list, 2025, 1000, new Date('2026-06-30')).perMonth).toBeCloseTo(4000 / 12)
    expect(expenseYears(list)).toEqual([2026, 2025])
  })
})
