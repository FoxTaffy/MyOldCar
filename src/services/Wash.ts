/**
 * Умная мойка: когда пора мыть машину.
 * Считает «загрязнённость» (0–100) по дням с последней мойки, пробегу, дождям на пути и сезону реагентов,
 * а затем смотрит прогноз: перед дождём мыть бессмысленно, в сильный мороз — вредно.
 */
export type WashLevel = 'clean' | 'ok' | 'soon' | 'now' | 'wait' | 'frost'

export interface DayWeather {
  /** YYYY-MM-DD */
  date: string
  rainMm: number
  minC: number | null
}

export interface WashInput {
  /** Дата последней мойки YYYY-MM-DD; null — записей нет. */
  lastWashISO: string | null
  /** Пробег с последней мойки, км (или за последние 3 недели, если записей нет). */
  kmSince: number
  /** Сегодня YYYY-MM-DD. */
  todayISO: string
  /** Погода: прошедшие дни и прогноз (если удалось получить). */
  weather?: DayWeather[]
}

export interface WashAdvice {
  level: WashLevel
  /** «Грязь» 0–100 */
  dirt: number
  title: string
  reasons: string[]
  /** Лучший день для мойки в ближайшие дни (по прогнозу), YYYY-MM-DD. */
  bestDay: string | null
  daysSince: number | null
}

/** Реагенты на дорогах: ноябрь–март. */
export const isSaltSeason = (iso: string): boolean => {
  const m = Number(iso.slice(5, 7))
  return m >= 11 || m <= 3
}

const DAY = 86_400_000
export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO + 'T00:00:00Z') - Date.parse(fromISO + 'T00:00:00Z')) / DAY)
}

/** Дождь, который реально пачкает машину, и мороз, при котором мойка вредна. */
const DIRTY_RAIN_MM = 1.5
const WET_FORECAST_MM = 2
const FROST_C = -5

export function washAdvice(i: WashInput): WashAdvice {
  const salt = isSaltSeason(i.todayISO)
  const daysSince = i.lastWashISO ? Math.max(0, daysBetween(i.lastWashISO, i.todayISO)) : null
  // Записей нет — исходим из трёх недель, чтобы не молчать.
  const days = daysSince ?? 21
  const past = (i.weather ?? []).filter((d) => d.date <= i.todayISO && (!i.lastWashISO || d.date > i.lastWashISO))
  const rainyDays = past.filter((d) => d.rainMm >= DIRTY_RAIN_MM).length
  const reasons: string[] = []

  let dirt = days * 2.2 + i.kmSince * 0.1 + rainyDays * 9
  if (salt) dirt += days * 1.8
  dirt = Math.round(Math.min(100, dirt))

  if (daysSince == null) reasons.push('Мойки в журнале не отмечены — считаю, что прошло около 3 недель.')
  else reasons.push(daysSince === 0 ? 'Помыта сегодня.' : `С последней мойки прошло ${daysSince} дн.`)
  if (i.kmSince >= 50) reasons.push(`Проехали ${Math.round(i.kmSince)} км.`)
  if (rainyDays) reasons.push(`Дождливых дней после мойки: ${rainyDays} — на дороге грязная вода.`)
  if (salt) reasons.push('Сезон реагентов (ноябрь–март): соль разъедает кузов и днище, мойте чаще.')

  const future = (i.weather ?? []).filter((d) => d.date > i.todayISO).slice(0, 3)
  const rainSoon = future.find((d, idx) => idx < 2 && d.rainMm >= WET_FORECAST_MM)
  const frostSoon = future.slice(0, 2).some((d) => d.minC != null && d.minC <= FROST_C) || (i.weather ?? []).some((d) => d.date === i.todayISO && d.minC != null && d.minC <= FROST_C)
  // Лучший день: сухо и не лютый мороз, и после последнего дождя.
  const best = future.find((d) => d.rainMm < DIRTY_RAIN_MM && (d.minC == null || d.minC > FROST_C)) ?? null

  let level: WashLevel
  let title: string
  if (dirt >= 70) { level = 'now'; title = 'Пора мыть машину' }
  else if (dirt >= 45) { level = 'soon'; title = 'Скоро стоит помыть' }
  else if (dirt >= 15) { level = 'ok'; title = 'Пока чисто' }
  else { level = 'clean'; title = 'Машина чистая' }

  if (level === 'now' || level === 'soon') {
    // Сильно загрязнённую машину в сезон соли моем несмотря на дождь: дождь соль не смывает.
    const urgentSalt = salt && dirt >= 85
    if (rainSoon && !urgentSalt) {
      level = 'wait'
      title = 'Подождите с мойкой'
      reasons.push(`${fmt(rainSoon.date)} ожидается дождь (${Math.round(rainSoon.rainMm)} мм) — после него машина снова станет грязной.`)
    } else if (rainSoon && urgentSalt) {
      reasons.push('Дождь обещан, но на кузове соль — не тяните, мойте сегодня.')
    }
    if (frostSoon && level !== 'wait') {
      level = 'frost'
      title = 'Мойте в тепле или на боксе'
      reasons.push(`Мороз ${FROST_C} °C и ниже: на улице вода замёрзнет на замках и уплотнителях. Лучше бокс или день потеплее; после мойки протрите уплотнители.`)
    }
  }
  if (best && (level === 'wait' || level === 'frost')) reasons.push(`Подходящий день: ${fmt(best.date)}.`)

  return { level, dirt, title, reasons, bestDay: best?.date ?? (level === 'now' || level === 'soon' ? i.todayISO : null), daysSince }
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export function fmt(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
}

/** Ответ Open-Meteo (daily) → массив дней. */
export function parseWeather(json: unknown): DayWeather[] {
  const d = (json as { daily?: { time?: string[]; precipitation_sum?: (number | null)[]; temperature_2m_min?: (number | null)[] } })?.daily
  if (!d?.time) return []
  return d.time.map((date, k) => ({ date, rainMm: d.precipitation_sum?.[k] ?? 0, minC: d.temperature_2m_min?.[k] ?? null }))
}

export const weatherUrl = (lat: number, lon: number): string =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&daily=precipitation_sum,temperature_2m_min&past_days=14&forecast_days=4&timezone=auto`

/** Загружает погоду (интернет нужен только для этого); ошибки не пробрасывает — совет работает и без прогноза. */
export async function fetchWeather(lat: number, lon: number, fetchFn: typeof fetch = fetch): Promise<DayWeather[]> {
  try {
    const r = await fetchFn(weatherUrl(lat, lon))
    return r.ok ? parseWeather(await r.json()) : []
  } catch {
    return []
  }
}
