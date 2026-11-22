import { Capacitor } from '@capacitor/core'
import { carTitle, type Car } from './Cars'
import { docKindTitle, docStatus, type CarDoc } from './CarDocs'
import { itemStatus } from './Maintenance'
import { oilStatus } from './OilService'

/**
 * Напоминания системными уведомлениями — приходят, даже если приложение закрыто:
 *  • сразу (при запуске/возврате), если подошло обслуживание или истекает документ — не чаще раза в неделю на позицию;
 *  • заранее запланированные на даты: за warnDays дней до окончания документа и в последний день.
 */

export interface Reminder {
  /** Ключ для защиты от повторов: car:item. */
  key: string
  car: string
  text: string
  level: 'warn' | 'bad'
}

export function dueReminders(cars: Car[], warnPct: number, warnDays: number, now = new Date()): Reminder[] {
  const out: Reminder[] = []
  for (const c of cars) {
    if (c.placeholder) continue
    const name = carTitle(c)
    const o = oilStatus(c.oil, c.trackedTotalKm, now)
    if (o.configured && (o.level === 'bad' || o.pct >= warnPct)) {
      out.push({ key: `${c.id}:oil`, car: name, level: o.level === 'bad' ? 'bad' : 'warn', text: o.leftKm <= 0 || o.overdueByTime ? 'пора менять масло' : `масло — осталось ${Math.max(0, Math.round(o.leftKm))} км` })
    }
    for (const it of c.services) {
      const st = itemStatus(it, c.trackedTotalKm, now)
      if (!st.configured || (st.level !== 'bad' && st.pct < warnPct)) continue
      out.push({ key: `${c.id}:${it.id}`, car: name, level: st.level === 'bad' ? 'bad' : 'warn', text: st.level === 'bad' ? `${it.name.toLowerCase()} — пора менять` : `${it.name.toLowerCase()} — осталось ${Math.max(0, Math.round(st.leftKm))} км` })
    }
    for (const d of c.docs ?? []) {
      const st = docStatus(d, now, warnDays)
      if (st.level === 'ok') continue
      out.push({ key: `${c.id}:doc:${d.id}:${d.untilISO}`, car: name, level: st.level, text: `${docTitle(d)}: ${st.text.toLowerCase()}` })
    }
  }
  return out
}

const docTitle = (d: CarDoc): string => (d.kind === 'custom' ? d.title || 'Документ' : docKindTitle(d.kind))

/** Какие напоминания показать сейчас: не показанные за последние repeatDays. */
export function freshReminders(list: Reminder[], shown: Record<string, number>, now = Date.now(), repeatDays = 7): Reminder[] {
  return list.filter((r) => !shown[r.key] || now - shown[r.key] >= repeatDays * 86400000)
}

export interface Planned { id: number; at: Date; title: string; body: string }

/** Уведомления на будущие даты: за warnDays до окончания документа и в последний день (в 10:00). */
export function plannedDocNotices(cars: Car[], warnDays: number, now = new Date()): Planned[] {
  const out: Planned[] = []
  let id = BASE_ID + 100
  for (const c of cars) {
    if (c.placeholder) continue
    for (const d of c.docs ?? []) {
      const until = new Date(d.untilISO + 'T10:00:00')
      if (!Number.isFinite(until.getTime())) continue
      const early = new Date(until.getTime() - warnDays * 86400000)
      const title = `${docTitle(d)} · ${carTitle(c)}`
      if (early > now) out.push({ id: id++, at: early, title, body: `Действует до ${fmt(d.untilISO)} — осталось ${warnDays} дн. Пора продлить.` })
      if (until > now) out.push({ id: id++, at: until, title, body: 'Сегодня последний день действия. Продлите, чтобы не получить штраф.' })
      if (id > BASE_ID + 190) return out
    }
  }
  return out
}

const fmt = (iso: string): string => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
const BASE_ID = 5000
const SHOWN_KEY = 'myoldcar.remind.v1'

function loadShown(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '{}') } catch { return {} }
}

/**
 * Пересчитать и запланировать напоминания. Вызывается при запуске и при возврате в приложение.
 * Без разрешения на уведомления ничего не делает (о сроках всё равно видно в журнале обслуживания).
 */
export async function syncReminders(cars: Car[], opts: { enabled: boolean; warnPct: number; warnDays: number }): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const pending = await LocalNotifications.getPending()
    const mine = pending.notifications.filter((n) => n.id >= BASE_ID && n.id < BASE_ID + 200)
    if (mine.length) await LocalNotifications.cancel({ notifications: mine.map((n) => ({ id: n.id })) })
    if (!opts.enabled) return
    const perm = await LocalNotifications.checkPermissions()
    if (perm.display !== 'granted') return

    const notifications = plannedDocNotices(cars, opts.warnDays).map((p) => ({ id: p.id, title: p.title, body: p.body, schedule: { at: p.at, allowWhileIdle: true } }))
    const shown = loadShown()
    const fresh = freshReminders(dueReminders(cars, opts.warnPct, opts.warnDays), shown)
    if (fresh.length) {
      const bad = fresh.some((r) => r.level === 'bad')
      const multiCar = new Set(fresh.map((r) => r.car)).size > 1
      notifications.push({
        id: BASE_ID,
        title: bad ? 'Пора на обслуживание' : 'Скоро обслуживание',
        body: fresh.map((r) => (multiCar ? `${r.car}: ${r.text}` : r.text)).join('; '),
        schedule: { at: new Date(Date.now() + 3000), allowWhileIdle: true },
      })
      const now = Date.now()
      for (const r of fresh) shown[r.key] = now
      try { localStorage.setItem(SHOWN_KEY, JSON.stringify(shown)) } catch { /* ignore */ }
    }
    if (notifications.length) await LocalNotifications.schedule({ notifications })
  } catch (e) {
    console.warn('reminders:', e)
  }
}
