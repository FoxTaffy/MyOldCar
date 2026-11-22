import { tripScore } from './DrivingStyle'
import type { Expense } from './Expenses'
import { catTitle } from './Expenses'
import type { TrackPoint } from './TripAnalysis'
import type { Trip } from './TripRecorder'

/**
 * Выгрузка данных для внешних программ: трек в GPX (карты, Strava, OsmAnd), показания и журнал в CSV (Excel, Google Таблицы).
 * CSV — с разделителем «;» и BOM: так русский Excel открывает файл двойным щелчком без мастера импорта.
 */

const BOM = '﻿'
const SEP = ';'

function cell(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000).replace('.', ',') : ''
  if (typeof v === 'boolean') return v ? 'да' : 'нет'
  const s = String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: string[], rows: unknown[][]): string {
  return BOM + [header, ...rows].map((r) => r.map(cell).join(SEP)).join('\r\n') + '\r\n'
}

const iso = (t: number): string => new Date(t).toISOString()
const local = (t: number): string => {
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
const xml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** GPX 1.1: трек + скорость, обороты и температура в расширениях (их читают многие программы). */
export function trackToGpx(points: TrackPoint[], name: string): string {
  const pts = points.filter((p) => p.lat != null && p.lon != null)
  const seg = pts
    .map((p) => {
      const ext = [
        p.spd != null ? `<myoldcar:speed>${Math.round(p.spd * 10) / 10}</myoldcar:speed>` : '',
        p.rpm != null ? `<myoldcar:rpm>${Math.round(p.rpm)}</myoldcar:rpm>` : '',
        p.ect != null ? `<myoldcar:coolant>${Math.round(p.ect)}</myoldcar:coolant>` : '',
      ].join('')
      return `      <trkpt lat="${(p.lat as number).toFixed(6)}" lon="${(p.lon as number).toFixed(6)}"><time>${iso(p.t)}</time>${ext ? `<extensions>${ext}</extensions>` : ''}</trkpt>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MyOldCar" xmlns="http://www.topografix.com/GPX/1/1" xmlns:myoldcar="https://github.com/FoxTaffy/MyOldCar/gpx">
  <metadata><name>${xml(name)}</name>${pts.length ? `<time>${iso(pts[0].t)}</time>` : ''}</metadata>
  <trk>
    <name>${xml(name)}</name>
    <trkseg>
${seg}
    </trkseg>
  </trk>
</gpx>
`
}

/** Все показания трека по точкам. */
export function trackToCsv(points: TrackPoint[]): string {
  return toCsv(
    ['Время', 'Широта', 'Долгота', 'Скорость, км/ч', 'Обороты', 'ОЖ, °C', 'ДМРВ, г/с', 'Нагрузка, %', 'Дроссель, %', 'Напряжение, В', 'Расход, л/100 км', 'Check Engine'],
    points.map((p) => [local(p.t), p.lat, p.lon, p.spd, p.rpm, p.ect, p.maf, p.load, p.thr, p.volt, p.l100 ?? null, p.mil]),
  )
}

/** Сводка поездок: по строке на поездку. */
export function tripsToCsv(trips: Trip[], carName: (id?: string) => string, fuelPrice = 0): string {
  return toCsv(
    ['Начало', 'Конец', 'Машина', 'Пробег, км', 'В движении, мин', 'Стоянки, мин', 'Средняя, км/ч', 'Макс., км/ч', 'Топливо, л', 'Расход, л/100 км', 'Стоимость топлива', 'Источник', 'Безопасность', 'Эко'],
    trips.map((t) => {
      const avg = t.movingMs > 0 ? t.distanceKm / (t.movingMs / 3_600_000) : null
      const l100 = t.distanceKm >= 0.5 && t.fuelL > 0 ? (t.fuelL / t.distanceKm) * 100 : null
      return [local(t.start), local(t.end), carName(t.carId), t.distanceKm, t.movingMs / 60000, t.stoppedMs / 60000, avg, t.maxSpeedKmh, t.fuelL || null, l100, t.fuelL > 0 && fuelPrice > 0 ? t.fuelL * fuelPrice : null, t.source ?? '', tripScore(t, 'safety'), tripScore(t, 'eco')]
    }),
  )
}

/** Журнал расходов. */
export function expensesToCsv(list: Expense[], carName: (id?: string) => string): string {
  const rows = [...list].sort((a, b) => a.date.localeCompare(b.date))
  return toCsv(
    ['Дата', 'Машина', 'Категория', 'Сумма', 'Одометр, км', 'Литры', 'Цена за литр', 'Топливо', 'Полный бак', 'Место', 'Что делали', 'Заметка'],
    rows.map((e) => [e.date, carName(e.carId), catTitle(e.cat), e.amount, e.odometerKm ?? null, e.liters ?? null, e.pricePerL ?? null, e.fuelType ?? '', e.cat === 'fuel' ? !!e.full : null, e.place ?? '', (e.items ?? []).map((i) => `${i.name} ${i.amount}`).join(', '), e.note ?? '']),
  )
}
