/**
 * Аккумулятор и генератор по напряжению.
 *  • В покое (двигатель заглушён несколько минут или ещё не заводился): 12,6 В и выше — заряжен,
 *    12,4–12,6 — разряжен наполовину, ниже 12,4 — сильно разряжен или изношен.
 *    Напряжение в покое адаптер меряет сам (команда ATRV), даже при выключенном зажигании.
 *  • На работающем двигателе (обороты выше холостых минуту и дольше): 13,5–14,8 В — генератор заряжает;
 *    ниже — недозаряд (ремень, щётки, реле-регулятор), выше — перезаряд (регулятор), аккумулятор «кипит».
 * Провал при запуске здесь не меряется: опрос раз в несколько секунд его не ловит.
 */

export type BatteryKind = 'rest' | 'charge'

export interface BatteryEvent {
  t: number
  kind: BatteryKind
  v: number
}

export interface Sample {
  t: number
  /** Обороты: null — ЭБУ молчит (зажигание выключено). */
  rpm: number | null
  volt: number | null
}

/** Двигатель заглушён не меньше этого — напряжение уже «покоя», без поверхностного заряда после поездки. */
export const REST_AFTER_MS = 5 * 60_000
/** Не чаще одной записи покоя за этот промежуток. */
const REST_EVERY_MS = 30 * 60_000
const CHARGE_RPM = 1100
const CHARGE_HOLD_MS = 60_000
const CHARGE_SAMPLES = 6

const median = (a: number[]): number => {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Разбирает поток показаний одной сессии подключения и выдаёт записи «покой» и «зарядка». */
export class BatteryTracker {
  private lastRunAt: number | null = null
  private ranThisSession = false
  private lastRestAt: number | null = null
  private chargeFrom: number | null = null
  private chargeVolts: number[] = []
  private chargeDone = false

  constructor(private readonly sessionStart = Date.now()) {}

  feed(s: Sample): BatteryEvent | null {
    const running = s.rpm != null && s.rpm > 300
    if (running) {
      this.lastRunAt = s.t
      this.ranThisSession = true
    }
    if (s.volt == null || !(s.volt > 5 && s.volt < 20)) return null

    if (!running) {
      this.chargeFrom = null
      this.chargeVolts = []
      // Покой: двигатель в этой сессии не заводился (подключились к стоящей машине) или заглушён давно.
      const settled = this.lastRunAt == null ? !this.ranThisSession : s.t - this.lastRunAt >= REST_AFTER_MS
      if (settled && (this.lastRestAt == null || s.t - this.lastRestAt >= REST_EVERY_MS)) {
        this.lastRestAt = s.t
        return { t: s.t, kind: 'rest', v: round(s.volt) }
      }
      return null
    }

    if (this.chargeDone) return null
    if (s.rpm != null && s.rpm >= CHARGE_RPM) {
      this.chargeFrom ??= s.t
      if (s.t - this.chargeFrom >= CHARGE_HOLD_MS / 2) this.chargeVolts.push(s.volt)
      if (s.t - this.chargeFrom >= CHARGE_HOLD_MS && this.chargeVolts.length >= CHARGE_SAMPLES) {
        this.chargeDone = true
        return { t: s.t, kind: 'charge', v: round(median(this.chargeVolts)) }
      }
    } else {
      this.chargeFrom = null
      this.chargeVolts = []
    }
    return null
  }

  get started(): number { return this.sessionStart }
}

const round = (v: number): number => Math.round(v * 100) / 100

export type Level = 'ok' | 'warn' | 'bad'

export function restLevel(v: number): { level: Level; text: string } {
  if (v >= 12.6) return { level: 'ok', text: 'Заряжен' }
  if (v >= 12.4) return { level: 'warn', text: 'Заряжен наполовину — стоит подзарядить' }
  if (v >= 12.0) return { level: 'bad', text: 'Сильно разряжен — зарядите и проверьте под нагрузкой' }
  return { level: 'bad', text: 'Разряжен: зимой может не завести' }
}

export function chargeLevel(v: number): { level: Level; text: string } {
  if (v < 13.2) return { level: 'bad', text: 'Генератор не заряжает: проверьте ремень, щётки, реле-регулятор' }
  if (v < 13.5) return { level: 'warn', text: 'Слабая зарядка (много потребителей или износ генератора)' }
  if (v <= 14.8) return { level: 'ok', text: 'Генератор заряжает нормально' }
  return { level: 'bad', text: 'Перезаряд: неисправен регулятор напряжения — аккумулятор выкипает' }
}

export interface BatteryReport {
  rest: { v: number; t: number; level: Level; text: string } | null
  charge: { v: number; t: number; level: Level; text: string } | null
  /** Изменение среднего напряжения покоя: последние 5 против предыдущих 5 (В). */
  restTrend: number | null
  restSeries: { t: number; v: number }[]
}

export function batteryReport(events: BatteryEvent[]): BatteryReport {
  const rest = events.filter((e) => e.kind === 'rest').sort((a, b) => a.t - b.t)
  const charge = events.filter((e) => e.kind === 'charge').sort((a, b) => a.t - b.t)
  const lr = rest[rest.length - 1]
  const lc = charge[charge.length - 1]
  const avg = (a: BatteryEvent[]) => a.reduce((s, e) => s + e.v, 0) / a.length
  const trend = rest.length >= 10 ? round(avg(rest.slice(-5)) - avg(rest.slice(-10, -5))) : null
  return {
    rest: lr ? { v: lr.v, t: lr.t, ...restLevel(lr.v) } : null,
    charge: lc ? { v: lc.v, t: lc.t, ...chargeLevel(lc.v) } : null,
    restTrend: trend,
    restSeries: rest.slice(-30).map((e) => ({ t: e.t, v: e.v })),
  }
}

/** Ответ ATRV: «12.4V». */
export function parseAdapterVoltage(raw: string): number | null {
  const m = /(\d{1,2}(?:[.,]\d{1,2})?)\s*V/i.exec(raw)
  if (!m) return null
  const v = Number(m[1].replace(',', '.'))
  return v > 5 && v < 20 ? v : null
}

/* ------------------------------------------------------------------ */

const KEY = 'myoldcar.battery.v1'
const MAX_PER_CAR = 120

export function loadBattery(): Record<string, BatteryEvent[]> {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

export function addBatteryEvent(all: Record<string, BatteryEvent[]>, carId: string, e: BatteryEvent): Record<string, BatteryEvent[]> {
  const next = { ...all, [carId]: [...(all[carId] ?? []), e].slice(-MAX_PER_CAR) }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
  return next
}
