/**
 * Документы и сроки: ОСАГО, КАСКО, диагностическая карта (техосмотр), водительское удостоверение, транспортный налог,
 * а также свои позиции (аптечка, огнетушитель, пропуск). Приложение напоминает заранее и в день окончания.
 */

export type DocKind = 'osago' | 'kasko' | 'to' | 'license' | 'tax' | 'custom'

export interface CarDoc {
  id: string
  kind: DocKind
  title: string
  /** Действует до (включительно), YYYY-MM-DD. */
  untilISO: string
  /** Номер полиса, страховая, заметка. */
  note?: string
}

export const DOC_KINDS: { id: DocKind; title: string; hint: string }[] = [
  { id: 'osago', title: 'ОСАГО', hint: 'Полис на год; езда без него — штраф' },
  { id: 'kasko', title: 'КАСКО', hint: 'Добровольная страховка' },
  { id: 'to', title: 'Техосмотр', hint: 'Диагностическая карта: срок зависит от возраста машины' },
  { id: 'license', title: 'Водительское удостоверение', hint: 'Действует 10 лет' },
  { id: 'tax', title: 'Транспортный налог', hint: 'Уплата до 1 декабря за прошлый год' },
  { id: 'custom', title: 'Другое', hint: 'Аптечка, огнетушитель, пропуск, сервисная гарантия…' },
]

export const docKindTitle = (k: DocKind): string => DOC_KINDS.find((d) => d.id === k)?.title ?? 'Документ'

export interface DocStatus {
  /** Дней до окончания (0 — сегодня последний день, отрицательное — просрочен). */
  daysLeft: number
  level: 'ok' | 'warn' | 'bad'
  text: string
}

const dayStart = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

export function docStatus(doc: CarDoc, now = new Date(), warnDays = 14): DocStatus {
  const until = new Date(doc.untilISO + 'T00:00:00')
  const daysLeft = Math.round((dayStart(until) - dayStart(now)) / 86400000)
  if (!Number.isFinite(daysLeft)) return { daysLeft: 0, level: 'warn', text: 'Срок не указан' }
  if (daysLeft < 0) return { daysLeft, level: 'bad', text: `Истёк ${-daysLeft} ${plural(-daysLeft)} назад` }
  if (daysLeft === 0) return { daysLeft, level: 'bad', text: 'Сегодня последний день' }
  return { daysLeft, level: daysLeft <= warnDays ? 'warn' : 'ok', text: `Осталось ${daysLeft} ${plural(daysLeft)}` }
}

export function plural(n: number, forms: [string, string, string] = ['день', 'дня', 'дней']): string {
  const a = Math.abs(n) % 100
  const b = a % 10
  if (a > 10 && a < 20) return forms[2]
  if (b === 1) return forms[0]
  if (b >= 2 && b <= 4) return forms[1]
  return forms[2]
}

/** Предложить срок нового документа: ОСАГО и налог — через год, ВУ — через 10 лет. */
export function suggestUntil(kind: DocKind, from = new Date()): string {
  const d = new Date(from)
  if (kind === 'license') d.setFullYear(d.getFullYear() + 10)
  else if (kind === 'tax') { d.setMonth(11, 1); if (d < from) d.setFullYear(d.getFullYear() + 1) }
  else d.setFullYear(d.getFullYear() + 1)
  if (kind !== 'tax') d.setDate(d.getDate() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
