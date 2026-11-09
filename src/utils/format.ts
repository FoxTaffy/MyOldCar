export const num = (n: number | null | undefined, digits = 0): string =>
  n == null || Number.isNaN(n) ? '—' : n.toFixed(digits).replace('.', ',')

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
