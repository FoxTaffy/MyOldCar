/** Число с десятичной запятой; для отсутствующего значения — «—». */
export const num = (n: number | null | undefined, digits = 0): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(digits).replace('.', ',')

/** Целое с разделителями тысяч: 123 456. */
export const int = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0')

/** Длительность словами: «45 с», «12 мин», «1 ч 05 мин». */
export function span(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s} с`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} мин` : `${Math.floor(m / 60)} ч ${String(m % 60).padStart(2, '0')} мин`
}

export function time(ts: number): string {
  return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** ч:мм */
export function duration(ms: number): string {
  const m = Math.round(ms / 60000)
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** Ключ дня в локальной зоне (YYYY-MM-DD). */
export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const todayISO = (): string => dayKey(Date.now())
