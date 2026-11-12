import { Capacitor } from '@capacitor/core'

export interface NotifyState {
  /** Когда установлено соединение с машиной. */
  since: number
  values: Record<string, number | null>
  via: string
}

/** «Работает 1 ч 05 мин» / «Работает 12 мин 30 с». */
export function elapsedText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} ч ${String(m).padStart(2, '0')} мин`
  return m > 0 ? `${m} мин ${String(sec).padStart(2, '0')} с` : `${sec} с`
}

export function notificationBody(st: NotifyState, now = Date.now()): string {
  const v = st.values
  const parts = [`Работает ${elapsedText(now - st.since)}`]
  if (v.speed != null) parts.push(`${Math.round(v.speed)} км/ч`)
  if (v.coolant != null) parts.push(`ОЖ ${Math.round(v.coolant)} °C`)
  if (v.voltage != null) parts.push(`${v.voltage.toFixed(1)} В`)
  return parts.join(' · ')
}

const ID = 4104
const CHANNEL = 'myoldcar-connection'
const UPDATE_MS = 10_000
const SMALL_ICON = 'ic_stat_car'

/**
 * Постоянное уведомление «Машина подключена» через Android foreground-сервис (работает на Samsung / One UI).
 * В браузере и на iOS ничего не делает. Все ошибки глотаются: уведомление не должно ломать опрос.
 */
export class Notifier {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false
  private getState: (() => NotifyState) | null = null

  private get supported(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
  }

  async start(getState: () => NotifyState): Promise<void> {
    if (!this.supported || this.running) return
    this.getState = getState
    try {
      const { ForegroundService, Importance } = await import('@capawesome-team/capacitor-android-foreground-service')
      // Android 13+: без разрешения уведомление не показывается (сервис при этом работает).
      const perm = await ForegroundService.checkPermissions()
      if (perm.display !== 'granted') await ForegroundService.requestPermissions()
      await ForegroundService.createNotificationChannel({
        id: CHANNEL, name: 'Подключение к машине', description: 'Постоянное уведомление, пока приложение подключено к OBD-адаптеру', importance: Importance.Low,
      })
      this.running = true
      await ForegroundService.startForegroundService({
        id: ID, title: 'MyOldCar · машина подключена', body: this.body(), smallIcon: SMALL_ICON, silent: true, notificationChannelId: CHANNEL,
      })
      this.timer = setInterval(() => { void this.refresh() }, UPDATE_MS)
    } catch {
      this.running = false
    }
  }

  private body(): string {
    const st = this.getState?.()
    return st ? notificationBody(st) : 'Подключено'
  }

  private async refresh(): Promise<void> {
    if (!this.running) return
    try {
      const { ForegroundService } = await import('@capawesome-team/capacitor-android-foreground-service')
      await ForegroundService.updateForegroundService({ id: ID, title: 'MyOldCar · машина подключена', body: this.body(), smallIcon: SMALL_ICON, silent: true, notificationChannelId: CHANNEL })
    } catch { /* ignore */ }
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (!this.running) return
    this.running = false
    try {
      const { ForegroundService } = await import('@capawesome-team/capacitor-android-foreground-service')
      await ForegroundService.stopForegroundService()
    } catch { /* ignore */ }
  }
}
