/** Журнал расходов: заправки, обслуживание, мойка, страховка и налоги, дороги и штрафы, прочее. */
export type ExpenseCat = 'fuel' | 'service' | 'wash' | 'docs' | 'road' | 'other'

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
  { id: 'service', title: 'Обслуживание и ремонт', icon: 'wrench' },
  { id: 'wash', title: 'Мойка автомобиля', icon: 'shower' },
  { id: 'docs', title: 'Страховка, налог, техосмотр', icon: 'doc' },
  { id: 'road', title: 'Парковка, платные дороги, штрафы', icon: 'road' },
  { id: 'other', title: 'Прочее', icon: 'box' },
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
  return summarize(list.filter((e) => monthKey(e.date) === ym))
}

/** Итог по категориям для произвольного набора записей. Неизвестная категория (из старой копии) идёт в «Прочее». */
export function summarize(list: Expense[]): MonthSummary {
  const byCat = Object.fromEntries(CATS.map((c) => [c.id, { amount: 0, pct: 0 }])) as Record<ExpenseCat, { amount: number; pct: number }>
  let liters = 0
  for (const e of list) {
    ;(byCat[e.cat] ?? byCat.other).amount += e.amount
    if (e.cat === 'fuel' && e.liters) liters += e.liters
  }
  const total = CATS.reduce((s, c) => s + byCat[c.id].amount, 0)
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

/**
 * Стоимость владения за год: сумма по категориям, в месяц и на километр.
 * km — пробег за этот год (по поездкам или одометру из заправок), если известен.
 */
export interface YearReport {
  year: number
  total: number
  byCat: MonthSummary['byCat']
  perMonth: number
  perKm: number | null
  km: number | null
  months: number
}

export function yearReport(list: Expense[], year: number, km: number | null, now = new Date()): YearReport {
  const mine = list.filter((e) => e.date.startsWith(String(year)))
  const s = summarize(mine)
  // Текущий год делим на прошедшие месяцы, а не на 12.
  const months = year === now.getFullYear() ? now.getMonth() + 1 : 12
  const odo = mine.filter((e) => e.odometerKm != null).map((e) => e.odometerKm as number)
  const kmOdo = odo.length >= 2 ? Math.max(...odo) - Math.min(...odo) : null
  const useKm = km && km > 0 ? km : kmOdo && kmOdo > 0 ? kmOdo : null
  return { year, total: s.total, byCat: s.byCat, perMonth: s.total / months, perKm: useKm ? s.total / useKm : null, km: useKm, months }
}

/** Годы, за которые есть записи (новые сверху). */
export const expenseYears = (list: Expense[]): number[] => [...new Set(list.map((e) => Number(e.date.slice(0, 4))))].filter(Number.isFinite).sort((a, b) => b - a)
