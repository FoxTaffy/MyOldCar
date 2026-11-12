import { describe, expect, it } from 'vitest'
import { parseWeather, washAdvice, type DayWeather } from '../src/services/Wash'

const day = (date: string, rainMm = 0, minC: number | null = 10): DayWeather => ({ date, rainMm, minC })

describe('умная мойка', () => {
  it('только что помыли — чисто', () => {
    const a = washAdvice({ lastWashISO: '2026-06-10', todayISO: '2026-06-11', kmSince: 20 })
    expect(a.level).toBe('clean')
  })
  it('три недели без мойки летом — пора', () => {
    const a = washAdvice({ lastWashISO: '2026-06-01', todayISO: '2026-06-25', kmSince: 400 })
    expect(a.level).toBe('now')
  })
  it('зимой грязнеет быстрее (реагенты)', () => {
    const summer = washAdvice({ lastWashISO: '2026-06-01', todayISO: '2026-06-13', kmSince: 150 })
    const winter = washAdvice({ lastWashISO: '2026-12-01', todayISO: '2026-12-13', kmSince: 150 })
    expect(winter.dirt).toBeGreaterThan(summer.dirt)
  })
  it('дожди после мойки повышают загрязнённость', () => {
    const base = { lastWashISO: '2026-06-01', todayISO: '2026-06-10', kmSince: 100 }
    const wet = washAdvice({ ...base, weather: [day('2026-06-03', 8), day('2026-06-05', 5), day('2026-06-08', 4)] })
    expect(wet.dirt).toBeGreaterThan(washAdvice(base).dirt)
  })
  it('завтра дождь — ждём и называем день', () => {
    const a = washAdvice({ lastWashISO: '2026-06-01', todayISO: '2026-06-25', kmSince: 400, weather: [day('2026-06-26', 10), day('2026-06-27', 0), day('2026-06-28', 0)] })
    expect(a.level).toBe('wait')
    expect(a.bestDay).toBe('2026-06-27')
  })
  it('сильный мороз — рекомендуем бокс', () => {
    const a = washAdvice({ lastWashISO: '2026-01-01', todayISO: '2026-01-25', kmSince: 300, weather: [day('2026-01-26', 0, -18)] })
    expect(a.level).toBe('frost')
  })
  it('в соль и очень грязно — моем даже перед дождём', () => {
    const a = washAdvice({ lastWashISO: null, todayISO: '2026-02-10', kmSince: 900, weather: [day('2026-02-11', 6, 0)] })
    expect(a.level).toBe('now')
  })
  it('разбор ответа Open-Meteo', () => {
    const w = parseWeather({ daily: { time: ['2026-06-01'], precipitation_sum: [3.2], temperature_2m_min: [11] } })
    expect(w).toEqual([{ date: '2026-06-01', rainMm: 3.2, minC: 11 }])
    expect(parseWeather({})).toEqual([])
  })
})
