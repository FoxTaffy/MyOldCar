import { BUILTIN_SENSORS, levelOf, type SensorDef } from '@/data/sensors'
import type { Level } from '@/types'
import { dateTime, duration, num } from '@/utils/format'
import { aggAvg, type SensorAgg } from './SensorStats'
import { tripAvgSpeed, tripConsumption, type Trip } from './TripRecorder'

export interface SensorLine {
  id: string
  name: string
  unit: string
  min: number
  avg: number
  max: number
  level: Level
  /** Доли времени в зонах, 0..1. */
  ok: number
  warn: number
  bad: number
  text: string
}

const fmt = (v: number, d: number) => num(v, d)
const mins = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} с` : `${Math.round(ms / 60_000)} мин`)

function lineFor(def: SensorDef, a: SensorAgg): SensorLine {
  const total = a.okMs + a.warnMs + a.badMs
  const ok = total ? a.okMs / total : 1
  const warn = total ? a.warnMs / total : 0
  const bad = total ? a.badMs / total : 0
  const avg = aggAvg(a)
  // Худший цвет из min/max/среднего; в красной зоне хоть раз — красный не показываем, если это <3 % времени.
  const worst: Level = bad >= 0.03 ? 'bad' : bad > 0 || warn >= 0.1 ? 'warn' : levelOf(def, avg)
  const d = def.digits
  let text = `${fmt(a.min, d)} … ${fmt(a.max, d)} ${def.unit}, в среднем ${fmt(avg, d)}.`
  if (def.ok) {
    if (bad > 0) text += ` Красная зона: ${mins(a.badMs)} (${Math.round(bad * 100)} %).`
    if (warn > 0) text += ` Оранжевая зона: ${mins(a.warnMs)} (${Math.round(warn * 100)} %).`
    if (bad === 0 && warn === 0) text += ' Всё время в норме.'
  }
  return { id: def.id, name: def.name, unit: def.unit, min: a.min, avg, max: a.max, level: worst, ok, warn, bad, text }
}

/** Построчная сводка по каждому датчику поездки. */
export function sensorLines(trip: Trip, defs: SensorDef[] = BUILTIN_SENSORS): SensorLine[] {
  const out: SensorLine[] = []
  for (const def of defs) {
    const a = trip.sensors?.[def.id]
    if (a && a.n > 0) out.push(lineFor(def, a))
  }
  return out
}

/** Текстовая сводка поездки: общая строка + замечания по датчикам. */
export function tripSummaryText(trip: Trip, pricePerL: number, defs: SensorDef[] = BUILTIN_SENSORS): string[] {
  const l100 = tripConsumption(trip)
  const lines = [
    `Поездка ${dateTime(trip.start)}: ${fmt(trip.distanceKm, 1)} км за ${duration(trip.end - trip.start)} (в движении ${duration(trip.movingMs)}, на стоянке ${duration(trip.stoppedMs)}).`,
    `Скорость: средняя ${fmt(tripAvgSpeed(trip), 0)} км/ч, максимум ${fmt(trip.maxSpeedKmh, 0)} км/ч.`,
    `Топливо: ${fmt(trip.fuelL, 1)} л${l100 != null ? `, ${fmt(l100, 1)} л/100 км` : ''}, около ${fmt(trip.fuelL * pricePerL, 0)} ₽.`,
  ]
  const ls = sensorLines(trip, defs)
  const bad = ls.filter((l) => l.level === 'bad')
  const warn = ls.filter((l) => l.level === 'warn')
  if (!ls.length) lines.push('Данных по датчикам нет (поездка записана старой версией).')
  else if (!bad.length && !warn.length) lines.push('Датчики: все показания в пределах нормы.')
  else {
    if (bad.length) lines.push(`Требует внимания: ${bad.map((l) => l.name).join(', ')}.`)
    if (warn.length) lines.push(`Отклонения (оранжевые): ${warn.map((l) => l.name).join(', ')}.`)
  }
  return lines
}

/** Полный текст для копирования / «Поделиться»: общая сводка + каждый датчик. */
export function tripReport(trip: Trip, pricePerL: number, defs: SensorDef[] = BUILTIN_SENSORS): string {
  const ls = sensorLines(trip, defs).map((l) => `• ${l.name}: ${l.text}`)
  return [...tripSummaryText(trip, pricePerL, defs), '', ...ls].join('\n')
}
