import { describe, expect, it } from 'vitest'
import { fetchWeather, fromWmo, parseOpenMeteo, parseYandex, type WxData, type WxHour } from '../src/services/WeatherApi'
import { advise, iceAt, roadAt, tireTips, windLabel } from '../src/services/WeatherAdvice'

const BASE = Date.UTC(2026, 10, 19, 12, 0) // 19 ноября 12:00 UTC
const H = 3_600_000
const hour = (i: number, o: Partial<WxHour> = {}): WxHour => {
  const ts = BASE + i * H
  const d = new Date(ts)
  return {
    ts, date: d.toISOString().slice(0, 10), h: d.getUTCHours(), tempC: 5, feelsC: 3, precMm: 0, precType: 'none', intensity: 0,
    freezing: false, thunder: false, fog: false, cloud: 1, windMs: 3, gustMs: 4, visM: null, ...o,
  }
}
const make = (hours: WxHour[], days = [{ date: '2026-11-19', minC: 2, maxC: 7, precMm: 0 }, { date: '2026-11-20', minC: 2, maxC: 7, precMm: 0 }]): WxData =>
  ({ source: 'open-meteo', fetchedAt: BASE, now: hours[0], hours, days })
const run = (hours: WxHour[], tires: 'auto' | 'summer' | 'winter' | 'all' = 'winter', days?: Parameters<typeof make>[1]) =>
  advise({ data: make(hours, days), nowMs: BASE, tires })
const series = (n: number, f: (i: number) => Partial<WxHour>): WxHour[] => Array.from({ length: n }, (_, i) => hour(i, f(i)))

describe('состояние дороги', () => {
  it('дождь около нуля — гололёд', () => {
    const h = hour(0, { precType: 'rain', precMm: 1, tempC: 0 })
    expect(iceAt(h, [])).toBe(true)
    expect(roadAt(h, [])).toBe('ice')
  })
  it('подморозило после дождя — гололёд, а после дождя в плюс — просто мокро', () => {
    const rainy = hour(0, { precType: 'rain', precMm: 1, tempC: 4 })
    expect(roadAt(hour(1, { tempC: -2 }), [rainy])).toBe('ice')
    expect(roadAt(hour(1, { tempC: 4 }), [rainy])).toBe('wet')
  })
  it('снег в мороз — снег, сухой мороз — сухо', () => {
    expect(roadAt(hour(0, { precType: 'snow', precMm: 1, tempC: -6 }), [])).toBe('snow')
    expect(roadAt(hour(0, { tempC: -6 }), [])).toBe('dry')
  })
  it('ледяной дождь', () => {
    expect(roadAt(hour(0, { precType: 'rain', precMm: 0.5, freezing: true, tempC: -1 }), [])).toBe('ice')
  })
})

describe('советы', () => {
  it('гололёд завтра — предупреждение с пометкой «завтра»', () => {
    const hrs = series(40, (i) => (i >= 20 && i <= 24 ? { precType: 'rain', precMm: 1, tempC: 0 } : { tempC: 3 }))
    const a = run(hrs)
    const t = a.tips.find((x) => x.id === 'ice-tomorrow')
    expect(t?.level).toBe('bad')
    expect(t?.text).toMatch(/гололёд/i)
    expect(a.roadTomorrow).toBe('ice')
    expect(a.tips[0].level).toBe('bad')
  })
  it('слабый дождь — зонт', () => {
    const a = run(series(6, () => ({ precType: 'rain', precMm: 0.4, intensity: 1 })))
    expect(a.tips.find((t) => t.id === 'rain-today')?.text).toMatch(/зонт/)
  })
  it('сильный ветер и штиль', () => {
    expect(run(series(6, () => ({ gustMs: 14, windMs: 9 }))).tips.some((t) => t.id === 'wind-today')).toBe(true)
    const calm = run(series(6, () => ({ windMs: 0.3, gustMs: 0.5 })))
    expect(calm.tips.some((t) => t.id === 'calm')).toBe(true)
    expect(windLabel(0.2)).toBe('штиль')
  })
  it('сильный мороз', () => {
    const a = run(series(6, () => ({ tempC: -24, feelsC: -30 })))
    expect(a.tips.find((t) => t.id === 'frost-today')?.level).toBe('bad')
  })
  it('туман по видимости', () => {
    const a = run(series(6, () => ({ fog: true, visM: 300 })))
    expect(a.tips.find((t) => t.id === 'fog-today')?.text).toMatch(/300 м/)
  })
  it('когда всё спокойно — зелёный совет, без тревог', () => {
    const a = run(series(30, () => ({})))
    expect(a.tips.every((t) => t.level === 'ok')).toBe(true)
    expect(a.tips.length).toBeGreaterThan(0)
  })
})

describe('смена резины', () => {
  const days = (mean: number, spread = 3) => [0, 1, 2, 3].map((k) => ({ date: `2026-11-${19 + k}`, minC: mean - spread, maxC: mean + spread, precMm: 0 }))
  it('осенью холодает — пора переобуваться', () => {
    const t = tireTips(days(2), '2026-11-19', 'summer')
    expect(t[0].id).toBe('tires-winter-now')
  })
  it('осенью ещё +9 — скоро пора', () => {
    expect(tireTips(days(9, 1), '2026-10-05', 'summer')[0].id).toBe('tires-winter-soon')
  })
  it('зимняя резина уже стоит или всесезонка — молчим', () => {
    expect(tireTips(days(2), '2026-11-19', 'winter')).toHaveLength(0)
    expect(tireTips(days(2), '2026-11-19', 'all')).toHaveLength(0)
  })
  it('весной потеплело — на летнюю', () => {
    const d = [0, 1, 2, 3].map((k) => ({ date: `2026-04-${10 + k}`, minC: 5, maxC: 15, precMm: 0 }))
    expect(tireTips(d, '2026-04-10', 'winter')[0].id).toBe('tires-summer-now')
    expect(tireTips(d, '2026-04-10', 'summer')).toHaveLength(0)
  })
  it('летом без советов', () => {
    expect(tireTips(days(20), '2026-07-10', 'auto')).toHaveLength(0)
  })
})

describe('источники данных', () => {
  it('коды WMO', () => {
    expect(fromWmo(66)).toMatchObject({ precType: 'rain', freezing: true })
    expect(fromWmo(75)).toMatchObject({ precType: 'snow', intensity: 3 })
    expect(fromWmo(95)).toMatchObject({ thunder: true })
  })
  it('Open-Meteo: часовой пояс и видимость', () => {
    const j = {
      utc_offset_seconds: 10800,
      current: { time: '2026-11-19T15:00', temperature_2m: 1, apparent_temperature: -3, precipitation: 0.2, weather_code: 61, wind_speed_10m: 5, wind_gusts_10m: 9 },
      hourly: { time: ['2026-11-19T15:00', '2026-11-19T16:00'], temperature_2m: [1, 0], apparent_temperature: [-3, -4], precipitation: [0.2, 0], weather_code: [61, 3], wind_speed_10m: [5, 4], wind_gusts_10m: [9, 8], visibility: [800, 20000] },
      daily: { time: ['2026-11-19'], temperature_2m_max: [2], temperature_2m_min: [-1], precipitation_sum: [0.2] },
    }
    const d = parseOpenMeteo(j)
    expect(d.now.ts).toBe(Date.UTC(2026, 10, 19, 12, 0))
    expect(d.now.precType).toBe('rain')
    expect(d.now.fog).toBe(true)
    expect(d.hours[1].visM).toBe(20000)
    expect(d.days[0]).toMatchObject({ minC: -1, maxC: 2 })
  })
  const ya = {
    now: Math.floor(BASE / 1000),
    fact: { temp: 3, feels_like: -1, condition: 'light-rain', wind_speed: 6, wind_gust: 11, prec_type: 1, prec_strength: 0.25 },
    forecasts: [{ date: '2026-11-19', hours: [{ hour: '12', hour_ts: Math.floor(BASE / 1000), temp: 3, feels_like: -1, condition: 'rain', prec_type: 1, prec_strength: 0.75, prec_mm: 1.2, wind_speed: 6, wind_gust: 11 }, { hour: '13', hour_ts: Math.floor(BASE / 1000) + 3600, temp: -1, condition: 'wet-snow', prec_type: 2, prec_strength: 0.5, prec_mm: 0.5 }] }],
  }
  it('Яндекс.Погода: разбор ответа', () => {
    const d = parseYandex(ya)
    expect(d.source).toBe('yandex')
    expect(d.now).toMatchObject({ tempC: 3, feelsC: -1, precType: 'rain', intensity: 1, windMs: 6 })
    expect(d.hours[0]).toMatchObject({ intensity: 3, h: 12 })
    expect(d.hours[1].precType).toBe('sleet')
    expect(d.days[0]).toMatchObject({ minC: -1, maxC: 3 })
  })
  it('ключ отвергнут — падаем на Open-Meteo и сообщаем', async () => {
    const om = { utc_offset_seconds: 0, current: { time: '2026-11-19T12:00', temperature_2m: 1 }, hourly: { time: ['2026-11-19T12:00'] }, daily: { time: [] } }
    const seen: string[] = []
    const r = await fetchWeather(55.7, 37.6, 'bad-key', async (url, headers) => {
      seen.push(url)
      return url.includes('yandex') ? { status: 403, data: null } : (expect(headers).toBeUndefined(), { status: 200, data: om })
    })
    expect(r.data.source).toBe('open-meteo')
    expect(r.note).toMatch(/ключ/)
    expect(seen).toHaveLength(3) // два заголовка Яндекса + Open-Meteo
  })
  it('без ключа Яндекс не трогаем, с ключом — шлём заголовок', async () => {
    const urls: string[] = []
    await fetchWeather(55.7, 37.6, '', async (u) => { urls.push(u); return { status: 200, data: { utc_offset_seconds: 0, current: { time: '2026-11-19T12:00' }, hourly: { time: [] }, daily: {} } } })
    expect(urls.every((u) => u.includes('open-meteo'))).toBe(true)
    let hdr: Record<string, string> | undefined
    const r = await fetchWeather(55.7, 37.6, ' abc ', async (_u, h) => { hdr = h; return { status: 200, data: ya } })
    expect(hdr).toEqual({ 'X-Yandex-API-Key': 'abc' })
    expect(r.data.source).toBe('yandex')
  })
})
