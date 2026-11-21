/**
 * Погода для виджета «Погода и дорога»: единая модель + загрузка из Яндекс.Погоды (нужен ключ разработчика)
 * или, если ключа нет / он не принят, из Open-Meteo (бесплатно, без ключа).
 * Всё нормализуется в почасовой прогноз — советы (WeatherAdvice) не знают, откуда пришли данные.
 */
import { Capacitor, CapacitorHttp } from '@capacitor/core'

export type PrecType = 'none' | 'rain' | 'sleet' | 'snow' | 'hail'

export interface WxHour {
  /** Unix, мс */
  ts: number
  /** Локальная дата точки YYYY-MM-DD */
  date: string
  /** Локальный час 0–23 */
  h: number
  tempC: number
  feelsC: number
  /** Осадки за час, мм */
  precMm: number
  precType: PrecType
  /** 0 — нет, 1 — слабые, 2 — умеренные, 3 — сильные */
  intensity: 0 | 1 | 2 | 3
  /** Дождь/морось при минусе: на земле превращается в лёд */
  freezing: boolean
  thunder: boolean
  fog: boolean
  /** 0 ясно, 1 переменная облачность, 2 пасмурно */
  cloud: 0 | 1 | 2
  /** Ветер, м/с */
  windMs: number
  gustMs: number
  /** Видимость, м (null — источник не сообщает) */
  visM: number | null
}

export interface WxDay {
  date: string
  minC: number
  maxC: number
  precMm: number
}

export interface WxData {
  source: 'yandex' | 'open-meteo'
  fetchedAt: number
  now: WxHour
  hours: WxHour[]
  days: WxDay[]
}

export class WeatherError extends Error {}

const blank = (): Omit<WxHour, 'ts' | 'date' | 'h' | 'tempC' | 'feelsC'> => ({
  precMm: 0, precType: 'none', intensity: 0, freezing: false, thunder: false, fog: false, cloud: 0, windMs: 0, gustMs: 0, visM: null,
})
const n = (x: unknown, d = 0): number => (typeof x === 'number' && Number.isFinite(x) ? x : d)

/* ───────────────────────────── Open-Meteo ───────────────────────────── */

/** Код погоды WMO → поля модели. */
export function fromWmo(code: number): Partial<WxHour> {
  const p = (precType: PrecType, intensity: 1 | 2 | 3, extra: Partial<WxHour> = {}): Partial<WxHour> => ({ precType, intensity, cloud: 2, ...extra })
  switch (code) {
    case 0: return { cloud: 0 }
    case 1: case 2: return { cloud: 1 }
    case 3: return { cloud: 2 }
    case 45: case 48: return { cloud: 2, fog: true }
    case 51: case 53: return p('rain', 1)
    case 55: return p('rain', 2)
    case 56: case 57: return p('rain', 1, { freezing: true })
    case 61: return p('rain', 1)
    case 63: return p('rain', 2)
    case 65: return p('rain', 3)
    case 66: return p('rain', 2, { freezing: true })
    case 67: return p('rain', 3, { freezing: true })
    case 71: return p('snow', 1)
    case 73: case 77: return p('snow', 2)
    case 75: return p('snow', 3)
    case 80: return p('rain', 2)
    case 81: return p('rain', 2)
    case 82: return p('rain', 3)
    case 85: return p('snow', 2)
    case 86: return p('snow', 3)
    case 95: return p('rain', 2, { thunder: true })
    case 96: case 99: return p('hail', 3, { thunder: true })
    default: return { cloud: 1 }
  }
}

const OM_VARS = 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m'
export const openMeteoUrl = (lat: number, lon: number): string =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}`
  + `&current=${OM_VARS}&hourly=${OM_VARS},visibility`
  + '&daily=temperature_2m_max,temperature_2m_min,precipitation_sum'
  + '&wind_speed_unit=ms&past_hours=12&forecast_days=4&timezone=auto'

interface OmJson {
  utc_offset_seconds?: number
  current?: Record<string, unknown>
  hourly?: Record<string, (number | string | null)[]>
  daily?: Record<string, (number | string | null)[]>
}

/** «2026-11-19T14:00» в зоне точки → unix мс. */
function localToTs(iso: string, offsetSec: number): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso)
  if (!m) return NaN
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - offsetSec * 1000
}

export function parseOpenMeteo(json: unknown, fetchedAt = Date.now()): WxData {
  const j = json as OmJson
  const off = n(j.utc_offset_seconds)
  const hr = j.hourly
  if (!hr?.time || !j.current) throw new WeatherError('Open-Meteo: неожиданный ответ')
  const mk = (time: string, r: { t: unknown; f: unknown; p: unknown; c: unknown; w: unknown; g: unknown; v?: unknown }): WxHour => {
    const code = n(r.c)
    const base = { ...blank(), ...fromWmo(code) }
    return {
      ...base,
      ts: localToTs(time, off), date: time.slice(0, 10), h: Number(time.slice(11, 13)),
      tempC: n(r.t), feelsC: n(r.f, n(r.t)), precMm: n(r.p), windMs: n(r.w), gustMs: Math.max(n(r.g), n(r.w)),
      visM: r.v == null ? null : n(r.v),
    }
  }
  const col = (k: string): (number | string | null)[] => hr[k] ?? []
  const hours = (hr.time as string[]).map((t, i) => mk(t, { t: col('temperature_2m')[i], f: col('apparent_temperature')[i], p: col('precipitation')[i], c: col('weather_code')[i], w: col('wind_speed_10m')[i], g: col('wind_gusts_10m')[i], v: col('visibility')[i] }))
  // Туман по видимости: код 45/48 приходит не всегда.
  for (const h of hours) if (h.visM != null && h.visM < 1000) h.fog = true
  const c = j.current
  const now = mk(String(c.time), { t: c.temperature_2m, f: c.apparent_temperature, p: c.precipitation, c: c.weather_code, w: c.wind_speed_10m, g: c.wind_gusts_10m })
  // Видимость «сейчас» берём из ближайшего часа.
  const near = hours.find((h) => h.ts >= now.ts - 30 * 60_000)
  now.visM = near?.visM ?? null
  if (now.visM != null && now.visM < 1000) now.fog = true
  const d = j.daily
  const days: WxDay[] = ((d?.time as string[] | undefined) ?? []).map((date, i) => ({
    date, minC: n(d?.temperature_2m_min?.[i]), maxC: n(d?.temperature_2m_max?.[i]), precMm: n(d?.precipitation_sum?.[i]),
  }))
  return { source: 'open-meteo', fetchedAt, now, hours, days }
}

/* ───────────────────────────── Яндекс.Погода ───────────────────────────── */

const YA_RAIN = new Set(['light-rain', 'rain', 'moderate-rain', 'heavy-rain', 'continuous-heavy-rain', 'showers'])
const YA_SNOW = new Set(['light-snow', 'snow', 'snow-showers'])

interface YaPart {
  temp?: number; feels_like?: number; condition?: string; wind_speed?: number; wind_gust?: number
  prec_type?: number; prec_strength?: number; prec_mm?: number; is_thunder?: boolean; hour?: string; hour_ts?: number
}

/** Условие Яндекса (condition + prec_type + prec_strength) → поля модели. */
export function fromYandex(p: YaPart): Partial<WxHour> {
  const cond = p.condition ?? ''
  const out: Partial<WxHour> = { cloud: cond === 'clear' ? 0 : cond === 'overcast' || cond.includes('rain') || cond.includes('snow') || cond.includes('hail') ? 2 : 1 }
  // prec_type: 0 нет, 1 дождь, 2 дождь со снегом, 3 снег, 4 град
  let type: PrecType = 'none'
  if (p.prec_type === 1) type = 'rain'
  else if (p.prec_type === 2) type = 'sleet'
  else if (p.prec_type === 3) type = 'snow'
  else if (p.prec_type === 4) type = 'hail'
  else if (p.prec_type == null) type = YA_RAIN.has(cond) ? 'rain' : YA_SNOW.has(cond) ? 'snow' : cond === 'wet-snow' ? 'sleet' : cond === 'hail' ? 'hail' : 'none'
  if (type !== 'none') {
    out.precType = type
    const s = p.prec_strength
    out.intensity = s != null ? (s >= 0.75 ? 3 : s >= 0.5 ? 2 : 1) : cond.startsWith('light') ? 1 : cond.includes('heavy') || cond === 'showers' ? 3 : 2
    if (cond === 'heavy-rain' || cond === 'continuous-heavy-rain') out.intensity = 3
  }
  out.thunder = !!p.is_thunder || cond.startsWith('thunderstorm')
  if (out.thunder && type === 'none') { out.precType = 'rain'; out.intensity = 2 }
  return out
}

export const yandexUrl = (lat: number, lon: number): string =>
  `https://api.weather.yandex.ru/v2/forecast?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&lang=ru_RU&limit=4&hours=true&extra=false`

export function parseYandex(json: unknown, fetchedAt = Date.now()): WxData {
  const j = json as { now?: number; fact?: YaPart; forecasts?: { date: string; hours?: YaPart[]; parts?: Record<string, YaPart & { temp_min?: number; temp_max?: number; prec_mm?: number }>; }[] }
  if (!j.fact || !Array.isArray(j.forecasts)) throw new WeatherError('Яндекс.Погода: неожиданный ответ')
  const mk = (p: YaPart, ts: number, date: string, h: number): WxHour => ({
    ...blank(), ...fromYandex(p), ts, date, h,
    tempC: n(p.temp), feelsC: n(p.feels_like, n(p.temp)), precMm: n(p.prec_mm), windMs: n(p.wind_speed), gustMs: Math.max(n(p.wind_gust), n(p.wind_speed)),
  } as WxHour)
  const hours: WxHour[] = []
  const days: WxDay[] = []
  for (const f of j.forecasts) {
    for (const p of f.hours ?? []) hours.push(mk(p, n(p.hour_ts) * 1000, f.date, Number(p.hour)))
    const ps = Object.values(f.parts ?? {})
    const temps = (f.hours ?? []).map((p) => n(p.temp))
    const lows = temps.length ? temps : ps.map((x) => n(x.temp_min ?? x.temp)).filter(Number.isFinite)
    const highs = temps.length ? temps : ps.map((x) => n(x.temp_max ?? x.temp)).filter(Number.isFinite)
    days.push({
      date: f.date,
      minC: lows.length ? Math.min(...lows) : 0,
      maxC: highs.length ? Math.max(...highs) : 0,
      precMm: (f.hours ?? []).reduce((a, p) => a + n(p.prec_mm), 0) || ps.reduce((a, x) => a + n(x.prec_mm), 0),
    })
  }
  const nowTs = n(j.now) * 1000 || fetchedAt
  const d = new Date(nowTs)
  const today = j.forecasts[0]?.date ?? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const nowHour = hours.filter((h) => h.ts <= nowTs).pop()
  const now = mk(j.fact, nowTs, nowHour?.date ?? today, nowHour?.h ?? d.getHours())
  now.visM = null
  return { source: 'yandex', fetchedAt, now, hours, days }
}

/* ───────────────────────────── Загрузка ───────────────────────────── */

type Getter = (url: string, headers?: Record<string, string>) => Promise<{ status: number; data: unknown }>

/** На телефоне — нативный HTTP (у API Яндекса нет CORS-заголовков для WebView), в браузере — обычный fetch. */
const defaultGet: Getter = async (url, headers) => {
  if (Capacitor.isNativePlatform()) {
    const r = await CapacitorHttp.get({ url, headers, responseType: 'json' })
    return { status: r.status, data: r.data }
  }
  const r = await fetch(url, { headers })
  return { status: r.status, data: r.ok ? await r.json() : null }
}

export interface WeatherResult { data: WxData; note: string | null }

/** Прогноз по координатам. Ключ Яндекса задан — пробуем его, при отказе тихо уходим на Open-Meteo и говорим об этом в note. */
export async function fetchWeather(lat: number, lon: number, yandexKey: string, get: Getter = defaultGet): Promise<WeatherResult> {
  let note: string | null = null
  const key = yandexKey.trim()
  if (key) {
    try {
      // Ключ из кабинета разработчика (формат UUID) идёт в X-Yandex-API-Key — проверено живым запросом.
      // Если его отвергли, пробуем заголовок X-Yandex-Weather-Key, которым пользуются ключи из других кабинетов.
      let r = await get(yandexUrl(lat, lon), { 'X-Yandex-API-Key': key })
      if (r.status === 401 || r.status === 403) r = await get(yandexUrl(lat, lon), { 'X-Yandex-Weather-Key': key })
      if (r.status === 401 || r.status === 403) throw new WeatherError('Яндекс.Погода не приняла ключ — показываю данные Open-Meteo')
      if (r.status === 429) throw new WeatherError('Лимит запросов Яндекс.Погоды исчерпан — показываю данные Open-Meteo')
      if (r.status < 200 || r.status >= 300) throw new WeatherError(`Яндекс.Погода: ошибка ${r.status} — показываю данные Open-Meteo`)
      return { data: parseYandex(r.data), note: null }
    } catch (e) {
      note = e instanceof WeatherError ? e.message : 'Яндекс.Погода недоступна — показываю данные Open-Meteo'
    }
  }
  const r = await get(openMeteoUrl(lat, lon))
  if (r.status < 200 || r.status >= 300) throw new WeatherError(`Не удалось получить прогноз (${r.status})`)
  return { data: parseOpenMeteo(r.data), note }
}
