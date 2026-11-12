import { oilStatus, type OilState, type OilStatus } from './OilService'

/** Расходник или узел с интервалом замены. Состояние хранится так же, как у масла. */
export interface ServiceItem extends OilState {
  id: string
  name: string
  /** Срок замены в месяцах (необязательно): по истечении позиция краснеет, даже если пробег не вышел. */
  months?: number
}

export const DEFAULT_ITEMS: { id: string; name: string; intervalKm: number; months?: number }[] = [
  { id: 'fuel-filter', name: 'Топливный фильтр', intervalKm: 30000 },
  { id: 'air-filter', name: 'Воздушный фильтр', intervalKm: 15000, months: 12 },
  { id: 'plugs', name: 'Свечи зажигания', intervalKm: 30000 },
  { id: 'timing', name: 'Ремень ГРМ', intervalKm: 60000, months: 60 },
  { id: 'gear-oil', name: 'Масло в КПП', intervalKm: 60000 },
  { id: 'coolant', name: 'Охлаждающая жидкость', intervalKm: 60000, months: 36 },
  { id: 'brake-fluid', name: 'Тормозная жидкость', intervalKm: 40000, months: 24 },
  { id: 'pads', name: 'Тормозные колодки', intervalKm: 30000 },
  { id: 'cabin-filter', name: 'Салонный фильтр', intervalKm: 15000, months: 12 },
]

export function defaultServices(): ServiceItem[] {
  return DEFAULT_ITEMS.map((d) => ({ id: d.id, name: d.name, months: d.months, dateISO: null, offsetKm: 0, trackedAtSet: 0, intervalKm: d.intervalKm }))
}

export function itemStatus(it: ServiceItem, trackedTotalKm: number, now = new Date()): OilStatus {
  return oilStatus(it, trackedTotalKm, now, it.months ? Math.round(it.months * 30.4) : Infinity)
}
