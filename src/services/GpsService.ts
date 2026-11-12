import { Capacitor } from '@capacitor/core'
import { BackgroundGeolocation } from '@capgo/background-geolocation'
import type { GpsFix } from './TripSession'

/**
 * GPS-трекинг. На Android работает как служба переднего плана с уведомлением —
 * поэтому приложение продолжает писать поездку при свёрнутом экране и выключенном дисплее.
 * В браузере (разработка) используется navigator.geolocation.
 */
export type GpsState = 'off' | 'starting' | 'on' | 'denied' | 'error'

/**
 * Права для записи в фоне: точная геопозиция, уведомления службы и геопозиция «всегда».
 * Android выдаёт «всегда» только отдельным запросом после обычной геопозиции, поэтому просим по шагам.
 * Возвращает текст проблемы или null, если всё выдано.
 */
export async function ensureBackgroundPermissions(): Promise<string | null> {
  let p = await BackgroundGeolocation.checkPermissions()
  if (p.location !== 'granted') {
    p = await BackgroundGeolocation.requestPermissions({ permissions: ['location', 'notification'] })
  }
  if (p.location !== 'granted') return 'Нет доступа к геопозиции. Разрешите её в настройках телефона.'
  if (p.backgroundLocation !== 'granted') {
    p = await BackgroundGeolocation.requestPermissions({ permissions: ['backgroundLocation'] })
  }
  if (p.backgroundLocation !== 'granted') {
    return 'Выберите геопозицию «Всегда» в настройках приложения, иначе запись остановится при выключенном экране.'
  }
  return null
}

export class GpsService {
  state: GpsState = 'off'
  lastFix: GpsFix | null = null
  onFix?: (fix: GpsFix) => void
  onState?: (s: GpsState, msg?: string) => void
  private webWatch: number | null = null
  /** Разница «часы телефона − время точки» (минимальная из виденных): переводит время GPS в часы телефона. */
  private clockOffset: number | null = null
  /** Время (по GPS) последней принятой точки — чтобы не учитывать одну точку дважды. */
  private lastRawTime = 0
  private logCursor = 0
  private syncing: Promise<void> | null = null

  private set(s: GpsState, msg?: string): void {
    this.state = s
    this.onState?.(s, msg)
  }

  async start(): Promise<void> {
    if (this.state === 'on' || this.state === 'starting') return
    this.set('starting')
    try {
      if (Capacitor.isNativePlatform()) {
        const problem = await ensureBackgroundPermissions()
        if (problem) {
          this.set('denied', problem)
          return
        }
        // Журнал прошлого запуска уже не относится к текущей поездке.
        await BackgroundGeolocation.clearLocationLog().catch(() => undefined)
        this.logCursor = 0
        await BackgroundGeolocation.start(
          {
            backgroundTitle: 'MyOldCar: идёт запись поездки',
            backgroundMessage: 'Пишу маршрут и показания датчиков',
            // Права запрашиваем сами (ensureBackgroundPermissions), здесь диалог не нужен.
            requestPermissions: false,
            stale: false,
            distanceFilter: 0,
            networkFallback: true,
            // Служба сама пишет каждую точку в файл: если Android усыпил WebView, точки не теряются (см. syncLog).
            locationLog: true,
          },
          (pos, err) => {
            if (err) {
              this.set(err.code === 'NOT_AUTHORIZED' ? 'denied' : 'error', err.message)
              return
            }
            if (!pos) return
            if (this.state === 'error') this.set('on')
            this.push(pos.latitude, pos.longitude, pos.speed, pos.accuracy, pos.bearing, pos.time)
          },
        )
        this.set('on')
      } else if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        this.webWatch = navigator.geolocation.watchPosition(
          (p) => {
            // После временной ошибки (нет сигнала) точки пошли снова — состояние должно вернуться в «работает».
            if (this.state !== 'on') this.set('on')
            this.push(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.accuracy, p.coords.heading, p.timestamp)
          },
          (e) => this.set(e.code === 1 ? 'denied' : 'error', e.message),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
        )
        this.set('on')
      } else {
        this.set('error', 'GPS недоступен')
      }
    } catch (e) {
      this.set('error', e instanceof Error ? e.message : String(e))
    }
  }

  /** Открыть системные настройки приложения, если права выданы не полностью. */
  openSettings(): Promise<void> {
    return Capacitor.isNativePlatform() ? BackgroundGeolocation.openSettings().catch(() => undefined) : Promise.resolve()
  }

  async stop(): Promise<void> {
    if (this.state === 'off') return
    if (Capacitor.isNativePlatform()) await BackgroundGeolocation.stop().catch(() => undefined)
    if (this.webWatch != null) navigator.geolocation.clearWatch(this.webWatch)
    this.webWatch = null
    this.clockOffset = null
    this.set('off')
  }

  /**
   * Дочитывает из журнала службы точки, которые не дошли до приложения (экран выключен, WebView заморожен),
   * и подаёт их в поездку с их настоящим временем. Вызывать периодически и при возврате в приложение.
   */
  syncLog(): Promise<void> {
    if (!Capacitor.isNativePlatform() || this.state !== 'on') return Promise.resolve()
    this.syncing ??= this.readLog().catch(() => undefined).finally(() => { this.syncing = null })
    return this.syncing
  }

  private async readLog(): Promise<void> {
    for (;;) {
      const { entries } = await BackgroundGeolocation.getLocationLog({ afterId: this.logCursor, limit: 1000 })
      if (!entries.length) return
      for (const e of entries) this.push(e.latitude, e.longitude, e.speed, e.accuracy, e.bearing, e.time)
      this.logCursor = entries[entries.length - 1].id
      await BackgroundGeolocation.clearLocationLog({ upToId: this.logCursor })
      if (entries.length < 1000) return
    }
  }

  /** Подать точку вручную (демо-режим, тесты). time — время точки по GPS, мс. */
  push(lat: number, lon: number, speedMs: number | null, accuracy: number, bearing?: number | null, time?: number | null): void {
    const now = Date.now()
    let t = now
    if (time != null && time > 0) {
      // Одна и та же точка приходит и напрямую, и из журнала; опоздавшие тоже не нужны.
      if (time <= this.lastRawTime) return
      this.lastRawTime = time
      // Время точки, а не время доставки: пачка опоздавших точек не должна слипаться в один момент.
      this.clockOffset = Math.min(this.clockOffset ?? Infinity, now - time)
      t = Math.min(now, time + this.clockOffset)
    }
    // Скорость GPS приходит в м/с; отрицательное значение = «не определена».
    const fix: GpsFix = {
      t,
      lat, lon,
      speedKmh: speedMs != null && speedMs >= 0 ? speedMs * 3.6 : null,
      accuracy: accuracy ?? 0,
      bearing: bearing ?? null,
    }
    this.lastFix = fix
    this.onFix?.(fix)
  }
}
