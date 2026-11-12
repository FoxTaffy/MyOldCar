/** Журнал расходов: заправки, обслуживание и прочее, мойка. */
export type ExpenseCat = 'fuel' | 'service' | 'wash'

export interface Expense {
  id: string
  carId: string
  cat: ExpenseCat
  /** Дата, YYYY-MM-DD. */
  date: string
  amount: number
  place?: string
  note?: string
  /** Показание одометра на момент записи, км (для расхода по заправкам). */
  odometerKm?: number | null
  /** Только для заправок. */
  fuelType?: string
  pricePerL?: number | null
  liters?: number | null
  /** Заправлен полный бак (нужно для честного расчёта расхода). */
  full?: boolean
  /** Только для обслуживания: что делали и работа своими руками. */
  items?: { name: string; amount: number; note?: string }[]
  diy?: boolean
}

export const CATS: { id: ExpenseCat; title: string; icon: string }[] = [
  { id: 'fuel', title: 'Заправка', icon: 'pump' },
  { id: 'service', title: 'Обслуживание и прочее', icon: 'wrench' },
  { id: 'wash', title: 'Мойка автомобиля', icon: 'shower' },
]
export const catTitle = (c: ExpenseCat): string => CATS.find((x) => x.id === c)?.title ?? c

export const monthKey = (date: string): string => date.slice(0, 7)

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export interface MonthSummary {
  total: number
  byCat: Record<ExpenseCat, { amount: number; pct: number }>
  liters: number
}

export function monthSummary(list: Expense[], ym: string): MonthSummary {
  const byCat = { fuel: { amount: 0, pct: 0 }, service: { amount: 0, pct: 0 }, wash: { amount: 0, pct: 0 } }
  let liters = 0
  for (const e of list) {
    if (monthKey(e.date) !== ym) continue
    byCat[e.cat].amount += e.amount
    if (e.cat === 'fuel' && e.liters) liters += e.liters
  }
  const total = byCat.fuel.amount + byCat.service.amount + byCat.wash.amount
  for (const c of CATS) byCat[c.id].pct = total > 0 ? (byCat[c.id].amount / total) * 100 : 0
  return { total, byCat, liters }
}

/** Последние n месяцев, заканчивая ym. */
export function monthSeries(list: Expense[], ym: string, n = 6): { ym: string; total: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const k = shiftMonth(ym, i - (n - 1))
    return { ym: k, total: monthSummary(list, k).total }
  })
}

export const litersFor = (amount: number, price: number): number | null => (amount > 0 && price > 0 ? Math.round((amount / price) * 100) / 100 : null)

/**
 * Средний расход по заправкам с одометром: литры всех заправок, кроме первой, делим на пробег между первой и последней.
 * Нужны минимум две записи с разным показанием одометра. Метод честен, если баки заправляли до полного.
 */
export function consumptionFromFills(list: Expense[]): { l100: number; km: number; liters: number } | null {
  const fills = list
    .filter((e) => e.cat === 'fuel' && e.liters && e.liters > 0 && e.odometerKm != null)
    .sort((a, b) => (a.odometerKm as number) - (b.odometerKm as number))
  if (fills.length < 2) return null
  const km = (fills[fills.length - 1].odometerKm as number) - (fills[0].odometerKm as number)
  if (!(km > 0)) return null
  const liters = fills.slice(1).reduce((s, e) => s + (e.liters as number), 0)
  return { l100: (liters / km) * 100, km, liters }
}
