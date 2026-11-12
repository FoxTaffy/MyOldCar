/** Прогрев двигателя: следим за температурой ОЖ с момента подключения и сообщаем, когда можно ехать. */

/** С этой температуры ОЖ можно трогаться (щадяще; полностью двигатель прогрет ~85–90 °C). */
export const READY_C = 70
/** Если при подключении ОЖ уже не ниже этого — двигатель тёплый, прогрев не показываем. */
export const WARM_ON_CONNECT_C = 60

export type WarmupState = 'idle' | 'warming' | 'ready'

export interface WarmupInfo {
  state: WarmupState
  tempC: number | null
  /** Прогресс 0..1 от температуры в начале прогрева до READY_C. */
  progress: number
  /** Ориентировочно минут до готовности (по скорости нагрева), null — пока неизвестно. */
  etaMin: number | null
}

export class WarmupTracker {
  state: WarmupState = 'idle'
  /** Вызывается один раз, когда холодный двигатель дошёл до READY_C. */
  onReady: ((tempC: number) => void) | null = null
  private startC = 0
  private startT = 0
  private lastC: number | null = null
  private lastT = 0

  reset(): void {
    this.state = 'idle'
    this.lastC = null
  }

  /** Подаётся каждый снимок датчиков. rpm — чтобы не считать прогревом заглушенный двигатель. */
  feed(t: number, tempC: number | null, rpm: number | null): WarmupInfo {
    if (tempC == null || Number.isNaN(tempC)) return this.info(null)
    this.lastC = tempC
    this.lastT = t
    if (this.state === 'idle') {
      // Первое показание после подключения решает: холодный старт или двигатель уже тёплый.
      if (tempC < WARM_ON_CONNECT_C) {
        this.state = 'warming'
        this.startC = tempC
        this.startT = t
      } else this.state = 'ready'
    } else if (this.state === 'warming' && tempC >= READY_C && (rpm ?? 0) >= 0) {
      this.state = 'ready'
      this.onReady?.(tempC)
    }
    return this.info(tempC)
  }

  info(tempC: number | null = this.lastC): WarmupInfo {
    let progress = 0
    let etaMin: number | null = null
    if (this.state === 'ready') progress = 1
    else if (this.state === 'warming' && tempC != null) {
      const span = Math.max(1, READY_C - this.startC)
      progress = Math.min(1, Math.max(0, (tempC - this.startC) / span))
      const dtMin = (this.lastT - this.startT) / 60_000
      const rise = tempC - this.startC
      if (dtMin >= 1 && rise >= 2) etaMin = Math.max(0, Math.round((READY_C - tempC) / (rise / dtMin)))
    }
    return { state: this.state, tempC, progress, etaMin }
  }
}
