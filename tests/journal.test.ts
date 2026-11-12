import { describe, expect, it } from 'vitest'
import { analyzeStyle, avgScore, scoreByDay, summarize, tripScore } from '@/services/DrivingStyle'
import { consumptionFromFills, litersFor, monthSeries, monthSummary, shiftMonth, type Expense } from '@/services/Expenses'
import { computeStat, hm } from '@/services/HomeStats'
import { defaultServices, itemStatus } from '@/services/Maintenance'
import { newCar } from '@/services/Cars'
import type { TrackPoint } from '@/services/TripAnalysis'
import type { Trip } from '@/services/TripRecorder'

const pt = (tSec: number, spd: number | null, rpm: number | null = 2000, base = new Date(2026, 5, 10, 12, 0, 0).getTime()): TrackPoint => ({ t: base + tSec * 1000, lat: null, lon: null, spd, rpm, ect: 90, maf: null, load: null, thr: null, volt: null, mil: false })
const trip = (o: Partial<Trip> = {}): Trip => ({ id: 't', start: new Date(2026, 5, 10, 12).getTime(), end: 0, distanceKm: 10, fuelL: 0.8, movingMs: 1_200_000, stoppedMs: 0, maxSpeedKmh: 90, ...o })

describe('Стиль вождения', () => {
  it('считает резкий разгон и торможение один раз на затяжной манёвр', () => {
    // 0→40 за 4 с (10 км/ч/с), ещё +16 за 2 с (8 км/ч/с) — один разгон; потом 56→20 за 3 с (12 км/ч/с) — торможение.
    const s = analyzeStyle([pt(0, 0), pt(4, 40), pt(6, 56), pt(9, 20), pt(20, 20)])
    expect(s.accel).toBe(1)
    expect(s.brake).toBe(1)
  })
  it('плавное вождение событий не даёт', () => {
    const s = analyzeStyle([pt(0, 0), pt(5, 15), pt(10, 30), pt(15, 45), pt(20, 60)])
    expect(s.accel + s.brake).toBe(0)
  })
  it('превышение скорости — только дольше 3 секунд, и считается километраж', () => {
    const short = analyzeStyle([pt(0, 100), pt(2, 120), pt(4, 100)], 110)
    expect(short.over).toBe(0)
    const long = analyzeStyle([pt(0, 100), pt(2, 120), pt(4, 125), pt(6, 130), pt(8, 100)], 110)
    expect(long.over).toBe(1)
    expect(long.overKm).toBeGreaterThan(0)
  })
  it('ночь: с 22:00 до 06:00; обороты — среднее и максимум', () => {
    const night = new Date(2026, 5, 10, 23, 0, 0).getTime()
    const s = analyzeStyle([pt(0, 60, 2000, night), pt(30, 60, 4000, night)])
    expect(s.nightKm).toBeCloseTo(0.5, 1)
    expect(s.maxRpm).toBe(4000)
    expect(s.avgRpm).toBe(3000)
    expect(analyzeStyle([pt(0, 60), pt(30, 60)]).nightKm).toBe(0)
  })
  it('оценка падает с числом резких манёвров; у старых поездок её нет', () => {
    const calm = trip({ style: { accel: 0, brake: 0, over: 0, overKm: 0, nightKm: 0, nightMs: 0, hiRpmMs: 0, avgRpm: 2000, maxRpm: 3000 } })
    const rough = trip({ style: { accel: 6, brake: 6, over: 2, overKm: 3, nightKm: 0, nightMs: 0, hiRpmMs: 600_000, avgRpm: 3500, maxRpm: 5800 } })
    expect(tripScore(calm, 'safety')).toBe(100)
    expect(tripScore(rough, 'safety')!).toBeLessThan(60)
    expect(tripScore(calm, 'eco')!).toBeGreaterThan(tripScore(rough, 'eco')!)
    expect(tripScore(trip(), 'safety')).toBeNull()
    expect(avgScore([trip()], 'safety')).toBeNull()
  })
  it('день и итоги по набору поездок', () => {
    const a = trip({ style: { accel: 1, brake: 0, over: 0, overKm: 0, nightKm: 1, nightMs: 60000, hiRpmMs: 0, avgRpm: 2000, maxRpm: 3200 } })
    const b = trip({ id: 'b', start: new Date(2026, 5, 11, 9).getTime(), maxSpeedKmh: 120 })
    expect(Object.keys(scoreByDay([a, b], 'safety'))).toEqual(['2026-06-10'])
    const sum = summarize([a, b])
    expect(sum.km).toBe(20)
    expect(sum.maxSpeed).toBe(120)
    expect(sum.accel).toBe(1)
    expect(sum.avgRpm).toBe(2000)
  })
})

describe('Журнал расходов', () => {
  const e = (date: string, cat: Expense['cat'], amount: number, extra: Partial<Expense> = {}): Expense => ({ id: date + cat + amount, carId: 'c', cat, date, amount, ...extra })
  const list = [e('2026-10-05', 'fuel', 1000, { liters: 13.4 }), e('2026-11-02', 'fuel', 2000, { liters: 27 }), e('2026-11-10', 'wash', 500), e('2026-11-20', 'service', 1500)]
  it('итоги месяца, доли и сравнение', () => {
    const m = monthSummary(list, '2026-11')
    expect(m.total).toBe(4000)
    expect(m.byCat.fuel.pct).toBe(50)
    expect(m.liters).toBe(27)
    expect(monthSummary(list, '2026-10').total).toBe(1000)
    expect(monthSummary(list, '2026-09').total).toBe(0)
  })
  it('сдвиг месяцев через границу года и ряд для графика', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12')
    expect(shiftMonth('2026-12', 1)).toBe('2027-01')
    const s = monthSeries(list, '2026-11', 3)
    expect(s.map((x) => x.ym)).toEqual(['2026-09', '2026-10', '2026-11'])
    expect(s.map((x) => x.total)).toEqual([0, 1000, 4000])
  })
  it('литры из суммы и цены', () => {
    expect(litersFor(1000, 74.76)).toBeCloseTo(13.38, 2)
    expect(litersFor(0, 70)).toBeNull()
    expect(litersFor(500, 0)).toBeNull()
  })
  it('средний расход по заправкам: литры без первой заправки на пробег между первой и последней', () => {
    const r = consumptionFromFills([
      e('2026-10-01', 'fuel', 1, { liters: 30, odometerKm: 10000 }),
      e('2026-10-10', 'fuel', 1, { liters: 36, odometerKm: 10400 }),
      e('2026-10-20', 'fuel', 1, { liters: 36, odometerKm: 10800 }),
    ])
    expect(r!.km).toBe(800)
    expect(r!.l100).toBeCloseTo(9, 5)
    expect(consumptionFromFills([e('2026-10-01', 'fuel', 1, { liters: 30, odometerKm: 10000 })])).toBeNull()
  })
})

describe('Обслуживание', () => {
  it('позиция с интервалом: прогресс по пробегу и по сроку', () => {
    const it = { ...defaultServices().find((x) => x.id === 'air-filter')!, dateISO: '2026-01-01', offsetKm: 3000, trackedAtSet: 100 }
    const st = itemStatus(it, 100 + 9000, new Date(2026, 5, 1))
    expect(st.sinceKm).toBe(12000)
    expect(st.pct).toBe(80)
    expect(st.level).toBe('warn')
    // срок 12 месяцев прошёл — красный, даже если пробега мало
    expect(itemStatus({ ...it, offsetKm: 0 }, 100, new Date(2027, 1, 1)).level).toBe('bad')
  })
  it('без срока время значения не имеет; не заданная позиция нейтральна', () => {
    const fuel = { ...defaultServices().find((x) => x.id === 'fuel-filter')!, dateISO: '2015-01-01' }
    expect(itemStatus(fuel, 0, new Date(2026, 5, 1)).level).toBe('ok')
    expect(itemStatus(defaultServices()[0], 5000).configured).toBe(false)
  })
  it('у новой машины есть набор расходников', () => {
    expect(newCar().services.length).toBeGreaterThanOrEqual(8)
  })
})

describe('Плитки главной', () => {
  const car = newCar({ lastDiag: { at: new Date(2026, 10, 12).getTime(), count: 2 } })
  it('средний пробег и время', () => {
    const t = [trip({ distanceKm: 10, movingMs: 600_000 }), trip({ distanceKm: 20, movingMs: 1_800_000 })]
    expect(computeStat('avgKm', t, car, 65).value).toBe('15,0')
    expect(computeStat('avgTime', t, car, 65).value).toBe('00:20')
    expect(computeStat('totalKm', t, car, 65).value).toBe('30')
    expect(hm(3_660_000)).toBe('01:01')
  })
  it('пустые данные дают прочерк, а не NaN', () => {
    expect(computeStat('avgKm', [], car, 65).value).toBe('—')
    expect(computeStat('avgFuel', [], car, 65).value).toBe('—')
    expect(computeStat('safety', [], car, 65).value).toBe('—')
  })
  it('последняя диагностика и стоимость', () => {
    expect(computeStat('lastDiag', [], car, 65).unit).toBe('кодов: 2')
    expect(computeStat('cost', [trip({ fuelL: 10 })], car, 65).value).toMatch(/650/)
    expect(computeStat('lastDiag', [], newCar(), 65).value).toBe('—')
  })
})
