import { Capacitor } from '@capacitor/core'

/** Локальное уведомление: на телефоне — системное (видно при выключенном экране), в браузере — Notification API. */
let permAsked = false

export async function ensureNotifyPermission(): Promise<boolean> {
  try {
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      let p = await LocalNotifications.checkPermissions()
      if (p.display === 'prompt' && !permAsked) {
        permAsked = true
        p = await LocalNotifications.requestPermissions()
      }
      return p.display === 'granted'
    }
    if (typeof Notification === 'undefined') return false
    if (Notification.permission === 'default' && !permAsked) {
      permAsked = true
      await Notification.requestPermission()
    }
    return Notification.permission === 'granted'
  } catch {
    return false
  }
}

export async function notify(title: string, body: string): Promise<void> {
  try { navigator.vibrate?.([300, 150, 300]) } catch { /* ignore */ }
  try {
    if (!(await ensureNotifyPermission())) return
    if (Capacitor.isNativePlatform()) {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      await LocalNotifications.schedule({ notifications: [{ id: 4001, title, body }] })
    } else new Notification(title, { body })
  } catch { /* уведомление — не критично */ }
}
