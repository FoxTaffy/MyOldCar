import { Capacitor } from '@capacitor/core'
import { BackgroundGeolocation } from '@capgo/background-geolocation'
import type { GpsFix } from './TripSession'

/**
 * GPS-трекинг. На Android работает как служба переднего плана с уведомлением —
 * поэтому приложение продолжает писать поездку при свёрнутом экране и выключенном дисплее.
 * В браузере (разработка) используется navigator.geolocation.
 */
export type GpsState = 'off' | 'starting' | 'on' | 'denied' | 'error'

export class GpsService {
  state: GpsState = 'off'
  lastFix: GpsFix | null = null
  onFix?: (fix: GpsFix) => void
  onState?: (s: GpsState, msg?: string) => void
  private webWatch: number | null = null

  private set(s: GpsState, msg?: string): void {
    this.state = s
    this.onState?.(s, msg)
  }

  async start(): Promise<void> {
    if (this.state === 'on' || this.state === 'starting') return
    this.set('starting')
    try {
      if (Capacitor.isNativePlatform()) {
        await BackgroundGeolocation.start(
          {
            backgroundTitle: 'MyOldCar: идёт запись поездки',
            backgroundMessage: 'Пишу маршрут и показания датчиков',
            requestPermissions: true,
            stale: false,
            distanceFilter: 0,
            networkFallback: true,
          },
          (pos, err) => {
            if (err) {
              this.set(err.code === 'NOT_AUTHORIZED' ? 'denied' : 'error', err.message)
              return
            }
            if (pos) this.push(pos.latitude, pos.longitude, pos.speed, pos.accuracy, pos.bearing, pos.time)
          },
        )
        this.set('on')
      } else if (typeof navigator !== 'undefined' && 'geolocation' in navigator) {
        this.webWatch = navigator.geolocation.watchPosition(
          (p) => this.push(p.coords.latitude, p.coords.longitude, p.coords.speed, p.coords.accuracy, p.coords.heading, p.timestamp),
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

  async stop(): Promise<void> {
    if (Capacitor.isNativePlatform()) await BackgroundGeolocation.stop().catch(() => undefined)
    if (this.webWatch != null) navigator.geolocation.clearWatch(this.webWatch)
    this.webWatch = null
    this.set('off')
  }

  /** Подать точку вручную (демо-режим, тесты). */
  push(lat: number, lon: number, speedMs: number | null, accuracy: number, bearing?: number | null, time?: number | null): void {
    // Скорость GPS приходит в м/с; отрицательное значение = «не определена».
    const fix: GpsFix = {
      t: Date.now(),
      lat, lon,
      speedKmh: speedMs != null && speedMs >= 0 ? speedMs * 3.6 : null,
      accuracy: accuracy ?? 0,
      bearing: bearing ?? null,
    }
    void time
    this.lastFix = fix
    this.onFix?.(fix)
  }
}
