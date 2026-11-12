/**
 * Определение «еду или стою» по скорости и оборотам, а не только по GPS.
 * GPS на стоянке «дрейфует» (2–9 км/ч), а у старых машин датчик скорости бывает мёртвым.
 * Поэтому каждое показание скорости проверяется на согласованность с оборотами двигателя:
 * при движении на передаче обороты пропорциональны скорости (≈ 25–130 об/мин на км/ч),
 * а «скорость» GPS 3 км/ч при 2500 об/мин на нейтрали — это стоянка.
 */
export type MotionKind = 'driving' | 'coasting' | 'idling' | 'parked'

export interface MotionInput {
  /** Скорость по OBD, км/ч (null — датчик не отвечает или данных нет). */
  obdSpeed: number | null
  /** Обороты, об/мин (null — нет данных). */
  rpm: number | null
  /** Скорость по GPS, км/ч, уже без шума (null — GPS молчит). */
  gpsSpeed: number | null
}

export interface MotionResult {
  kind: MotionKind
  /** Скорость, которой верим, км/ч (0 — стоим). */
  speed: number
  /** Откуда взята скорость. */
  source: 'obd' | 'gps' | 'none'
  /** Оценка передачи по отношению оборотов к скорости (1…6), если едем и обороты известны. */
  gear: number | null
  /** Датчик скорости OBD врёт (показывает 0, а GPS и обороты говорят об обратном). */
  obdSpeedSuspect: boolean
}

/** Двигатель считаем работающим выше этих оборотов. */
export const ENGINE_ON_RPM = 300
/** Ниже этой скорости (км/ч) OBD считаем стоянкой. */
export const OBD_STILL_KMH = 2
/** Уверенное движение по GPS, км/ч. */
export const GPS_SURE_KMH = 10
/** Верхняя граница об/мин на 1 км/ч для движения на передаче (1-я передача у старых легковых ≈ 130–150). */
export const MAX_RPM_PER_KMH = 260
/** Типичные об/мин на 1 км/ч по передачам (ВАЗ/классика/малолитражки): для оценки передачи. */
const GEAR_RATIOS = [135, 78, 52, 39, 31]

/** Номер передачи по отношению оборотов к скорости. */
export function estimateGear(rpm: number, speed: number): number | null {
  if (speed < 8 || rpm < 600) return null
  const ratio = rpm / speed
  if (ratio > MAX_RPM_PER_KMH) return null
  let best = 0
  let bestErr = Infinity
  GEAR_RATIOS.forEach((r, i) => {
    const err = Math.abs(Math.log(ratio / r))
    if (err < bestErr) { bestErr = err; best = i }
  })
  return best + 1
}

/** Скорость GPS (3–10 км/ч) правдоподобна, только если обороты не слишком велики для такой скорости. */
export function gpsSpeedPlausible(gps: number, rpm: number | null): boolean {
  if (gps >= GPS_SURE_KMH) return true
  if (gps < 3) return false
  if (rpm == null || rpm < ENGINE_ON_RPM) return true // без оборотов проверить нечем (или двигатель заглушен — катимся)
  return rpm / gps <= MAX_RPM_PER_KMH
}

export function classifyMotion(i: MotionInput): MotionResult {
  const rpmKnown = i.rpm != null
  const engineOn = (i.rpm ?? 0) >= ENGINE_ON_RPM
  /** Без данных об оборотах двигатель считаем работающим, пока есть скорость. */
  const moveKind: MotionKind = rpmKnown && !engineOn ? 'coasting' : 'driving'
  const obd = i.obdSpeed
  const gps = i.gpsSpeed

  // 1. OBD-скорость есть и уверенная.
  if (obd != null && obd >= OBD_STILL_KMH) {
    const rpm = i.rpm
    // Скорость есть, а двигатель не работает: накат с заглушенным мотором / буксир.
    return {
      kind: moveKind, speed: obd, source: 'obd',
      gear: engineOn && rpm != null ? estimateGear(rpm, obd) : null, obdSpeedSuspect: false,
    }
  }

  // 2. OBD говорит «стоим» (или не отвечает). GPS-скорости верим, только если она сходится с оборотами.
  if (gps != null && gps >= 3 && gpsSpeedPlausible(gps, i.rpm)) {
    // OBD-скорость 0 при уверенном GPS и работающем двигателе — датчик скорости неисправен.
    const suspect = obd != null && obd < OBD_STILL_KMH && gps >= GPS_SURE_KMH
    if (obd == null || suspect) {
      return {
        kind: moveKind, speed: gps, source: 'gps',
        gear: engineOn && i.rpm != null ? estimateGear(i.rpm, gps) : null, obdSpeedSuspect: suspect,
      }
    }
  }

  // 3. Стоим.
  return { kind: engineOn ? 'idling' : 'parked', speed: 0, source: obd != null ? 'obd' : gps != null ? 'gps' : 'none', gear: null, obdSpeedSuspect: false }
}

export const MOTION_TEXT: Record<MotionKind, string> = {
  driving: 'Едем',
  coasting: 'Накат (двигатель не работает)',
  idling: 'Стоим, двигатель работает',
  parked: 'Стоим',
}
