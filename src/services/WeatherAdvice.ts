/**
 * Советы водителю по прогнозу: гололёд, снег, дождь, ветер, мороз, туман, смена резины.
 * Чистые функции без сети и без Vue — всё покрыто тестами.
 */
import type { WxData, WxDay, WxHour } from './WeatherApi'

export type TireSetting = 'auto' | 'summer' | 'winter' | 'all'
export type RoadState = 'dry' | 'wet' | 'snow' | 'ice'
export type TipLevel = 'bad' | 'warn' | 'info' | 'ok'
export type When = 'now' | 'today' | 'tomorrow'

export interface Tip {
  id: string
  level: TipLevel
  icon: string
  text: string
  when: When
}

export const ROAD_TEXT: Record<RoadState, string> = { dry: 'сухо', wet: 'мокро', snow: 'снег', ice: 'гололёд' }
const SEVERITY: Record<RoadState, number> = { dry: 0, wet: 1, snow: 2, ice: 3 }
const worse = (a: RoadState, b: RoadState): RoadState => (SEVERITY[b] > SEVERITY[a] ? b : a)

const HOUR = 3_600_000
const pad = (h: number): string => `${String(h).padStart(2, '0')}:00`
const t0 = (x: number): string => `${Math.round(x) > 0 ? '+' : ''}${Math.round(x)}`.replace('-', '−')
export const fmtTemp = (x: number): string => `${t0(x)}°`

/* ─────────────── Состояние дороги ─────────────── */

const wetNow = (h: WxHour): boolean => h.precType === 'rain' || h.precType === 'sleet' || h.precType === 'hail'

/** Гололёдная ситуация в точке с учётом предыстории (часы до неё). */
export function iceAt(h: WxHour, before: WxHour[]): boolean {
  if (h.freezing && h.tempC <= 1) return true
  // осадки в жидком виде при околонулевой температуре
  if (wetNow(h) && h.precMm >= 0.1 && h.tempC > -6 && h.tempC <= 1) return true
  // подморозило после мокрого: за последние 8 часов были дождь/мокрый снег/плюс с осадками
  if (h.tempC <= 0.5) {
    const recent = before.slice(-8)
    if (recent.some((b) => (wetNow(b) && b.precMm >= 0.1) || (b.precType === 'snow' && b.tempC > -0.5 && b.precMm >= 0.1))) return true
  }
  return false
}

export function roadAt(h: WxHour, before: WxHour[]): RoadState {
  if (iceAt(h, before)) return 'ice'
  if ((h.precType === 'snow' || h.precType === 'sleet') && h.precMm >= 0.1 && h.tempC <= 1) return 'snow'
  const recent = [...before.slice(-3), h]
  if (recent.some((b) => wetNow(b) && b.precMm >= 0.1) && h.tempC > 0) return 'wet'
  return 'dry'
}

function roadOver(hours: WxHour[], all: WxHour[]): RoadState {
  let r: RoadState = 'dry'
  for (const h of hours) r = worse(r, roadAt(h, all.filter((x) => x.ts < h.ts)))
  return r
}

/* ─────────────── Окна прогноза ─────────────── */

export interface Windows {
  /** Ближайшие 12 часов */
  soon: WxHour[]
  /** Завтра целиком */
  tomorrow: WxHour[]
  tomorrowDate: string | null
}

export function windows(d: WxData, nowMs: number): Windows {
  const today = d.now.date
  const dates = [...new Set(d.hours.map((h) => h.date))].sort()
  const tomorrowDate = dates.find((x) => x > today) ?? null
  return {
    soon: d.hours.filter((h) => h.ts >= nowMs - HOUR / 2 && h.ts <= nowMs + 12 * HOUR),
    tomorrow: tomorrowDate ? d.hours.filter((h) => h.date === tomorrowDate) : [],
    tomorrowDate,
  }
}

/* ─────────────── Ветер ─────────────── */

export function windLabel(ms: number): string {
  if (ms < 1) return 'штиль'
  if (ms < 4) return 'слабый'
  if (ms < 8) return 'умеренный'
  if (ms < 12) return 'свежий'
  if (ms < 17) return 'сильный'
  return 'шторм'
}

/* ─────────────── Описание ─────────────── */

export function condText(h: WxHour): string {
  if (h.thunder) return 'Гроза'
  if (h.precType === 'hail') return 'Град'
  if (h.precType === 'rain') return h.freezing ? 'Ледяной дождь' : h.intensity >= 3 ? 'Сильный дождь' : h.intensity === 1 ? 'Слабый дождь' : 'Дождь'
  if (h.precType === 'sleet') return 'Мокрый снег'
  if (h.precType === 'snow') return h.intensity >= 3 ? 'Сильный снег' : h.intensity === 1 ? 'Слабый снег' : 'Снег'
  if (h.fog) return 'Туман'
  return h.cloud === 0 ? 'Ясно' : h.cloud === 1 ? 'Переменная облачность' : 'Пасмурно'
}

export function condIcon(h: WxHour, night = false): string {
  if (h.thunder) return '⛈️'
  if (h.precType === 'hail') return '🌨️'
  if (h.precType === 'rain') return '🌧️'
  if (h.precType === 'sleet' || h.precType === 'snow') return '❄️'
  if (h.fog) return '🌫️'
  if (h.cloud === 0) return night ? '🌙' : '☀️'
  return h.cloud === 1 ? (night ? '☁️' : '⛅') : '☁️'
}

/** Для сводки по дню берём самый «значимый» час (осадки важнее облаков). */
export function dayRepresentative(hours: WxHour[]): WxHour | null {
  if (!hours.length) return null
  const score = (h: WxHour): number => (h.thunder ? 100 : 0) + (h.precType !== 'none' ? 10 * h.intensity + h.precMm : 0) + (h.fog ? 5 : 0) + h.cloud * 0.1
  return hours.filter((h) => h.h >= 7 && h.h <= 22).reduce<WxHour | null>((b, h) => (!b || score(h) > score(b) ? h : b), null) ?? hours[0]
}

/* ─────────────── Советы ─────────────── */

export interface AdviceInput {
  data: WxData
  nowMs: number
  tires: TireSetting
}

export interface Advice {
  roadNow: RoadState
  roadTomorrow: RoadState | null
  tips: Tip[]
}

const LEVEL_ORDER: Record<TipLevel, number> = { bad: 0, warn: 1, info: 2, ok: 3 }

function windowTips(hours: WxHour[], all: WxHour[], when: When, tomorrow: boolean): Tip[] {
  if (!hours.length) return []
  const out: Tip[] = []
  const pre = tomorrow ? 'Завтра' : ''
  const sentence = (s: string): string => (tomorrow ? `${pre} ${s.charAt(0).toLowerCase()}${s.slice(1)}` : s)
  const from = (h: WxHour | undefined): string => (h && h !== hours[0] ? ` — с ${pad(h.h)}` : '')

  // Гололёд
  const ice = hours.find((h) => iceAt(h, all.filter((x) => x.ts < h.ts)))
  if (ice) out.push({ id: `ice-${when}`, level: 'bad', icon: '🧊', when, text: sentence(`Возможен гололёд${from(ice)}. Будьте осторожны: плавно тормозите, держите дистанцию, не обгоняйте без нужды.`) })

  // Осадки
  const snow = hours.filter((h) => h.precType === 'snow' || h.precType === 'sleet')
  const heavySnow = snow.find((h) => h.intensity >= 3 || h.precMm >= 2)
  if (heavySnow) out.push({ id: `snow-heavy-${when}`, level: 'warn', icon: '🌨️', when, text: sentence(`Сильный снегопад${from(heavySnow)}. Выезжайте с запасом времени, очистите стёкла, фары и крышу.`) })
  else if (snow.some((h) => h.precMm >= 0.1)) out.push({ id: `snow-${when}`, level: 'info', icon: '❄️', when, text: sentence('Будет снег. Смахните его с крыши и датчиков, на дорогах скользко — дистанцию больше.') })

  const rain = hours.filter((h) => h.precType === 'rain' && !h.freezing && h.precMm >= 0.1)
  const heavyRain = rain.find((h) => h.intensity >= 3 || h.thunder || h.precMm >= 4)
  if (hours.some((h) => h.thunder)) out.push({ id: `thunder-${when}`, level: 'warn', icon: '⛈️', when, text: sentence('Возможна гроза. В ливень сбавьте скорость и не паркуйтесь под деревьями.') })
  else if (heavyRain) out.push({ id: `rain-heavy-${when}`, level: 'warn', icon: '🌧️', when, text: sentence(`Сильный дождь${from(heavyRain)}. Риск аквапланирования — сбросьте скорость, включите ближний свет.`) })
  else if (rain.length) out.push({ id: `rain-${when}`, level: 'info', icon: '☔', when, text: sentence(`${rain.every((h) => h.intensity <= 1) ? 'Слабый дождь' : 'Будет дождь'}. Положите в машину зонт.`) })
  if (hours.some((h) => h.precType === 'hail')) out.push({ id: `hail-${when}`, level: 'warn', icon: '🌨️', when, text: sentence('Возможен град — по возможности поставьте машину под крышу.') })

  // Видимость
  const fog = hours.find((h) => h.fog || (h.visM != null && h.visM < 1000))
  if (fog) {
    const vis = Math.min(...hours.map((h) => h.visM ?? Infinity))
    out.push({ id: `fog-${when}`, level: 'warn', icon: '🌫️', when, text: sentence(`Туман${Number.isFinite(vis) ? `, видимость до ${Math.round(vis / 10) * 10} м` : ''}${from(fog)}. Включите ближний свет и противотуманки, увеличьте дистанцию.`) })
  }

  // Ветер
  const gust = Math.max(...hours.map((h) => h.gustMs))
  if (gust >= 17) out.push({ id: `wind-${when}`, level: 'bad', icon: '💨', when, text: sentence(`Штормовой ветер, порывы до ${Math.round(gust)} м/с. Лучше не ехать без нужды: возможны падающие ветки и сильный снос.`) })
  else if (gust >= 12) out.push({ id: `wind-${when}`, level: 'warn', icon: '💨', when, text: sentence(`Сильный ветер, порывы до ${Math.round(gust)} м/с. На трассе и мостах крепче держите руль, осторожнее с фурами.`) })

  // Температура
  const min = Math.min(...hours.map((h) => h.tempC))
  const max = Math.max(...hours.map((h) => h.tempC))
  if (min <= -20) out.push({ id: `frost-${when}`, level: 'bad', icon: '🥶', when, text: sentence(`Сильный мороз до ${fmtTemp(min)}. Проверьте АКБ, прогрейте двигатель, не мойте машину и держите топливо не на нуле.`) })
  else if (min <= -10) out.push({ id: `frost-${when}`, level: 'warn', icon: '🥶', when, text: sentence(`Мороз до ${fmtTemp(min)}. Прогрейте двигатель перед выездом, следите за зарядом аккумулятора.`) })
  if (max >= 30) out.push({ id: `heat-${when}`, level: 'warn', icon: '🥵', when, text: sentence(`Жара до ${fmtTemp(max)}. Следите за температурой охлаждающей жидкости, давление в шинах проверяйте на холодных.`) })
  return out
}

const avg = (a: number[]): number => a.reduce((s, x) => s + x, 0) / a.length
const dayMean = (d: WxDay): number => (d.minC + d.maxC) / 2

/** Сезонная резина: порог +7 °C среднесуточной. */
export function tireTips(days: WxDay[], todayISO: string, tires: TireSetting): Tip[] {
  if (tires === 'all' || days.length === 0) return []
  const month = Number(todayISO.slice(5, 7))
  const next = days.filter((d) => d.date >= todayISO).slice(0, 4)
  if (!next.length) return []
  const mean = avg(next.map(dayMean))
  const lowest = Math.min(...next.map((d) => d.minC))
  const hasFrost = lowest <= 0
  const m = Math.round(mean)
  const tip = (id: string, level: TipLevel, text: string): Tip[] => [{ id, level, icon: '🛞', when: 'today', text }]
  const autumn = month >= 9 || month <= 1
  const spring = month >= 3 && month <= 5
  const ifSummer = tires === 'auto' ? ' (если ещё на летней)' : ''
  const ifWinter = tires === 'auto' ? ' (если ещё на зимней)' : ''

  if (autumn && tires !== 'winter') {
    if (mean <= 5 || hasFrost) return tip('tires-winter-now', 'warn', `Пора переобуваться на зимнюю резину${ifSummer}: среднесуточная ${fmtTemp(m)}${hasFrost ? `, ночью до ${fmtTemp(lowest)}` : ''}. Летняя резина на холоде теряет сцепление.`)
    if (mean <= 10) return tip('tires-winter-soon', 'info', `Скоро пора переобуваться${ifSummer}: среднесуточная ${fmtTemp(m)}. Когда она устойчиво ниже +7° — ставьте зимнюю резину.`)
  }
  if (spring && tires !== 'summer') {
    if (mean >= 9 && !hasFrost) return tip('tires-summer-now', 'info', `Тепло: среднесуточная ${fmtTemp(m)}. Можно переобуваться на летнюю резину${ifWinter} — если не обещают возврата холодов.`)
    if (mean >= 6 && lowest >= -1) return tip('tires-summer-soon', 'info', `Скоро пора на летнюю резину${ifWinter}: среднесуточная уже ${fmtTemp(m)}, но ночью ещё возможны заморозки.`)
  }
  return []
}

export function advise({ data, nowMs, tires }: AdviceInput): Advice {
  const w = windows(data, nowMs)
  const all = data.hours
  const roadNow = roadAt(data.now, all.filter((h) => h.ts < data.now.ts))
  const roadTomorrow = w.tomorrow.length ? roadOver(w.tomorrow, all) : null

  const tips: Tip[] = [
    ...windowTips(w.soon, all, 'today', false),
    ...windowTips(w.tomorrow, all, 'tomorrow', true),
  ]
  // «Сегодня» и «завтра» с одним и тем же событием не дублируем в тексте, но оставляем оба (разные сроки).
  tips.push(...tireTips(data.days, data.now.date, tires))

  // Перепад температуры: давление в шинах
  const todayD = data.days.find((d) => d.date === data.now.date)
  const tomD = data.days.find((d) => d.date === w.tomorrowDate)
  if (todayD && tomD && Math.abs(tomD.minC - todayD.minC) >= 10) {
    tips.push({ id: 'swing', level: 'info', icon: '🌡️', when: 'tomorrow', text: `Завтра ${tomD.minC < todayD.minC ? 'похолодает' : 'потеплеет'} на ${Math.round(Math.abs(tomD.minC - todayD.minC))}°. Проверьте давление в шинах: оно меняется примерно на 0,1 атм на каждые 10°.` })
  }

  // Штиль — просто приятная заметка, когда всё спокойно
  if (data.now.windMs < 1 && !tips.some((t) => t.level === 'bad' || t.level === 'warn')) {
    tips.push({ id: 'calm', level: 'ok', icon: '🍃', when: 'now', text: 'Штиль — ветер не мешает, можно ехать спокойно.' })
  }
  if (!tips.some((t) => t.level !== 'ok')) {
    tips.push({ id: 'all-good', level: 'ok', icon: '✅', when: 'now', text: roadNow === 'dry' ? 'Дорога сухая, опасных явлений не ожидается — хорошей поездки.' : 'Опасных явлений не ожидается, но дорога ещё не просохла.' })
  }
  tips.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level])
  return { roadNow, roadTomorrow, tips }
}
