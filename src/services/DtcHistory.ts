/**
 * История чтений ошибок: каждое чтение кодов сохраняется с датой и пробегом.
 * По ней видно, какие коды появились впервые, какие пропали и какие вернулись после исчезновения
 * (верный признак плавающей неисправности), а также когда ошибки стирали.
 */

export interface DtcScan {
  id: string
  carId: string
  at: number
  /** Оценка одометра на момент чтения, км. */
  odometerKm: number | null
  stored: string[]
  pending: string[]
  milOn: boolean | null
  /** Запись о сбросе ошибок (режим 04): stored/pending — что было стёрто. */
  cleared?: boolean
  demo?: boolean
}

export type CodeTrend = 'new' | 'repeat' | 'returned'

export const MAX_SCANS_PER_CAR = 100

/** Добавить чтение; у каждой машины храним не больше max последних. */
export function addScan(list: DtcScan[], s: DtcScan, max = MAX_SCANS_PER_CAR): DtcScan[] {
  const next = [...list, s]
  const mine = next.filter((x) => x.carId === s.carId)
  if (mine.length <= max) return next
  const drop = new Set(mine.slice(0, mine.length - max).map((x) => x.id))
  return next.filter((x) => !drop.has(x.id))
}

/** Чтения одной машины, от старых к новым (демо отдельно от реальных). */
export function scansFor(list: DtcScan[], carId: string, demo = false): DtcScan[] {
  return list.filter((x) => x.carId === carId && !!x.demo === demo).sort((a, b) => a.at - b.at)
}

const codesOf = (s: DtcScan): string[] => [...s.stored, ...s.pending]

/**
 * Для каждого кода текущего чтения: впервые (new), был и в прошлом чтении (repeat),
 * или был когда-то раньше, пропадал (или его стирали) и вернулся (returned).
 */
export function trends(history: DtcScan[], current: DtcScan): Record<string, CodeTrend> {
  const before = history.filter((s) => s.at < current.at && !s.cleared).sort((a, b) => a.at - b.at)
  const prev = before[before.length - 1]
  const prevCodes = new Set(prev ? codesOf(prev) : [])
  const ever = new Set(before.flatMap(codesOf))
  // Код, стёртый сбросом после прошлого чтения, тоже «вернулся», а не «повторился».
  const clearedSince = history.some((s) => s.cleared && s.at < current.at && (!prev || s.at > prev.at))
  const out: Record<string, CodeTrend> = {}
  for (const c of codesOf(current)) {
    if (prevCodes.has(c) && !clearedSince) out[c] = 'repeat'
    else if (ever.has(c)) out[c] = 'returned'
    else out[c] = 'new'
  }
  return out
}

/** Коды, которые были в прошлом чтении, а сейчас пропали. */
export function goneSince(history: DtcScan[], current: DtcScan): string[] {
  const before = history.filter((s) => s.at < current.at && !s.cleared).sort((a, b) => a.at - b.at)
  const prev = before[before.length - 1]
  if (!prev) return []
  const now = new Set(codesOf(current))
  return codesOf(prev).filter((c) => !now.has(c))
}

export interface CodeStat { code: string; times: number; firstAt: number; lastAt: number }

/** Сколько раз каждый код встречался в истории — сверху самые частые. */
export function codeStats(history: DtcScan[]): CodeStat[] {
  const m = new Map<string, CodeStat>()
  for (const s of history) {
    if (s.cleared) continue
    for (const c of new Set(codesOf(s))) {
      const st = m.get(c)
      if (st) { st.times++; st.lastAt = Math.max(st.lastAt, s.at); st.firstAt = Math.min(st.firstAt, s.at) }
      else m.set(c, { code: c, times: 1, firstAt: s.at, lastAt: s.at })
    }
  }
  return [...m.values()].sort((a, b) => b.times - a.times || b.lastAt - a.lastAt)
}

/* ------------------------------------------------------------------ */

const KEY = 'myoldcar.dtclog.v1'

export function loadScans(): DtcScan[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export function saveScans(list: DtcScan[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* место кончилось — история не критична */ }
}
