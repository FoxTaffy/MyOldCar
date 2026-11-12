import { avgScore } from './DrivingStyle'
import { currentOdometer, type Car } from './Cars'
import type { Trip } from './TripRecorder'
import { int, num } from '@/utils/format'
import type { StatId } from '@/composables/useUi'

export interface StatOut { label: string; value: string; unit: string }

export const STAT_TITLES: Record<StatId, string> = {
  avgKm: 'Средний пробег поездки', avgTime: 'Среднее время в пути', lastDiag: 'Последняя диагностика',
  totalKm: 'Пробег за 30 дней', totalTime: 'Время в пути за 30 дней', avgFuel: 'Средний расход', totalFuel: 'Топлива израсходовано',
  avgSpeed: 'Средняя скорость', maxSpeed: 'Максимальная скорость', safety: 'Оценка безопасности', eco: 'Оценка эко-вождения',
  odometer: 'Одометр (оценка)', trips: 'Поездок за 30 дней', cost: 'Стоимость топлива за 30 дней',
}
const SHORT: Record<StatId, string> = {
  avgKm: 'Средн. пробег', avgTime: 'Средн. время', lastDiag: 'Диагностика', totalKm: 'Пробег, 30 дн.', totalTime: 'В пути, 30 дн.',
  avgFuel: 'Расход', totalFuel: 'Топливо', avgSpeed: 'Средн. скорость', maxSpeed: 'Макс. скорость', safety: 'Безопасность',
  eco: 'Эко', odometer: 'Одометр', trips: 'Поездок', cost: 'Топливо, ₽',
}

export function hm(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Значение для плитки главной. trips30 — поездки машины за последние 30 дней (без демо). */
export function computeStat(id: StatId, trips30: Trip[], car: Car, fuelPrice: number, currency = '₽'): StatOut {
  const n = trips30.length
  const km = trips30.reduce((s, t) => s + t.distanceKm, 0)
  const ms = trips30.reduce((s, t) => s + t.movingMs + t.stoppedMs, 0)
  const fuel = trips30.reduce((s, t) => s + t.fuelL, 0)
  const moving = trips30.reduce((s, t) => s + t.movingMs, 0)
  const label = SHORT[id]
  const dash = { label, value: '—', unit: '' }
  switch (id) {
    case 'avgKm': return n ? { label, value: num(km / n, 1), unit: 'км' } : { ...dash, unit: 'км' }
    case 'avgTime': return n ? { label, value: hm(ms / n), unit: 'ч:мин' } : { label, value: '00:00', unit: 'ч:мин' }
    case 'lastDiag': {
      const d = car.lastDiag
      if (!d) return dash
      const date = new Date(d.at).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
      return { label, value: date, unit: d.count ? `кодов: ${d.count}` : 'ошибок нет' }
    }
    case 'totalKm': return { label, value: num(km, 0), unit: 'км' }
    case 'totalTime': return { label, value: hm(ms), unit: 'ч:мин' }
    case 'avgFuel': return km >= 1 && fuel > 0 ? { label, value: num((fuel / km) * 100, 1), unit: 'л/100 км' } : { ...dash, unit: 'л/100 км' }
    case 'totalFuel': return { label, value: num(fuel, 1), unit: 'л' }
    case 'avgSpeed': return moving > 0 ? { label, value: num(km / (moving / 3_600_000), 0), unit: 'км/ч' } : { ...dash, unit: 'км/ч' }
    case 'maxSpeed': return { label, value: num(Math.max(0, ...trips30.map((t) => t.maxSpeedKmh)), 0), unit: 'км/ч' }
    case 'safety': { const s = avgScore(trips30, 'safety'); return { label, value: s == null ? '—' : String(s), unit: 'из 100' } }
    case 'eco': { const s = avgScore(trips30, 'eco'); return { label, value: s == null ? '—' : String(s), unit: 'из 100' } }
    case 'odometer': { const o = currentOdometer(car); return { label, value: o == null ? '—' : int(o), unit: 'км' } }
    case 'trips': return { label, value: String(n), unit: 'шт.' }
    case 'cost': return { label, value: int(fuel * fuelPrice), unit: currency }
  }
}
