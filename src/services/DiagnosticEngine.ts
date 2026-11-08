import matrixJson from '@/data/dtcMatrix.json'
import type { AppSettings, CauseResult, DiagnosisResult, SensorSnapshot } from '@/types'

/* ---------- Формат JSON-матрицы ---------- */

type SensorKey = 'rpm' | 'speedKmh' | 'coolantTempC' | 'mafGs' | 'mafKgh' | 'voltage'
type Op = '<' | '<=' | '>' | '>=' | '=='

/** Условие: либо сравнение датчика, либо флаг настроек, либо состояние двигателя. */
export interface Condition {
  sensor?: SensorKey
  op?: Op
  value?: number
  setting?: keyof AppSettings
  state?: 'idle' | 'moving' | 'cold' | 'warm'
}

export interface Rule {
  /** Все условия должны выполняться (AND). */
  if: Condition[]
  /** Сколько очков добавить к весу причины. */
  add: number
  note: string
}

export interface CauseDef {
  id: string
  title: string
  base: number
  recommendation: string
  rules: Rule[]
}

export interface DtcEntry {
  title: string
  causes?: CauseDef[]
  alias?: string
}

export type DtcMatrix = Record<string, DtcEntry>
export const DTC_MATRIX = matrixJson as unknown as DtcMatrix

/* ---------- Вычисление условий ---------- */

interface Ctx {
  snap: SensorSnapshot | null
  settings: AppSettings
}

function sensorValue(snap: SensorSnapshot | null, key: SensorKey): number | null {
  if (!snap) return null
  if (key === 'mafKgh') return snap.mafGs == null ? null : snap.mafGs * 3.6
  const v = snap[key]
  return v ?? null
}

function compare(a: number, op: Op, b: number): boolean {
  switch (op) {
    case '<': return a < b
    case '<=': return a <= b
    case '>': return a > b
    case '>=': return a >= b
    case '==': return a === b
  }
}

function stateHolds(snap: SensorSnapshot | null, state: NonNullable<Condition['state']>): boolean {
  if (!snap) return false
  const idle = (snap.speedKmh ?? 0) < 1 && snap.rpm != null && snap.rpm > 0 && snap.rpm < 1200
  switch (state) {
    case 'idle': return idle
    case 'moving': return (snap.speedKmh ?? 0) >= 1
    case 'cold': return snap.coolantTempC != null && snap.coolantTempC < 60
    case 'warm': return snap.coolantTempC != null && snap.coolantTempC >= 75
  }
}

function holds(c: Condition, ctx: Ctx): boolean {
  if (c.setting) return ctx.settings[c.setting] === true
  if (c.state) return stateHolds(ctx.snap, c.state)
  if (c.sensor && c.op && c.value !== undefined) {
    const v = sensorValue(ctx.snap, c.sensor)
    return v !== null && compare(v, c.op, c.value)
  }
  return false
}

/** Округление до целых так, чтобы сумма была ровно 100 (метод наибольших остатков). */
function toPercents(scores: number[]): number[] {
  const total = scores.reduce((a, b) => a + b, 0)
  if (total <= 0) return scores.map(() => 0)
  const raw = scores.map((s) => (s / total) * 100)
  const floors = raw.map(Math.floor)
  let left = 100 - floors.reduce((a, b) => a + b, 0)
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac)
  for (const { i } of order) {
    if (left-- <= 0) break
    floors[i]++
  }
  return floors
}

/* ---------- Публичный API ---------- */

export function normalizeCode(code: string): string {
  return code.trim().toUpperCase()
}

export function isKnownCode(code: string): boolean {
  return normalizeCode(code) in DTC_MATRIX
}

/**
 * Пересчитывает веса причин для кода ошибки с учётом стоп-кадра и настроек.
 * Вернёт причины, отсортированные по убыванию вероятности (сумма = 100%).
 */
export function diagnose(
  rawCode: string,
  snapshot: SensorSnapshot | null,
  settings: AppSettings,
  matrix: DtcMatrix = DTC_MATRIX,
): DiagnosisResult {
  const code = normalizeCode(rawCode)
  const entry = matrix[code]
  if (!entry) {
    return {
      code,
      title: 'Код не найден в локальной базе',
      causes: [{
        id: 'unknown', title: 'Неизвестный код', probability: 100,
        recommendation: 'Найди расшифровку кода для М73/Bosch M7.9.7 и добавь правило в src/data/dtcMatrix.json.',
      }],
      notes: [],
    }
  }
  const defs = entry.alias ? matrix[entry.alias]?.causes ?? [] : entry.causes ?? []
  const ctx: Ctx = { snap: snapshot, settings }
  const notes: string[] = []

  const scored = defs.map((d) => {
    let score = d.base
    for (const r of d.rules) {
      if (r.if.every((c) => holds(c, ctx))) {
        score += r.add
        if (r.note) notes.push(`${d.title}: +${r.add} — ${r.note}`)
      }
    }
    return { def: d, score }
  })

  const pcts = toPercents(scored.map((s) => s.score))
  const causes: CauseResult[] = scored
    .map((s, i) => ({ id: s.def.id, title: s.def.title, probability: pcts[i], recommendation: s.def.recommendation }))
    .sort((a, b) => b.probability - a.probability)

  return { code, title: entry.title, causes, notes }
}
