import { reactive, watch } from 'vue'
import { DEFAULT_OIL, oilStatus, type OilState } from '@/services/OilService'
import type { Trip } from '@/services/TripRecorder'

const KEY = 'myoldcar.garage.v1'
const MAX_TRIPS = 200

interface Garage {
  fuelPrice: number
  oil: OilState
  /** Пробег, намеренный приложением за всё время, км. */
  trackedTotalKm: number
  trips: Trip[]
  /** Поездка, идущая в момент последнего сохранения (на случай закрытия приложения). */
  activeTrip: Trip | null
}

function load(): Garage {
  const base: Garage = { fuelPrice: 65, oil: { ...DEFAULT_OIL }, trackedTotalKm: 0, trips: [], activeTrip: null }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) Object.assign(base, JSON.parse(raw))
    base.oil = { ...DEFAULT_OIL, ...base.oil }
  } catch { /* ignore */ }
  // Приложение закрыли посреди поездки — сохраняем то, что успели записать.
  if (base.activeTrip && base.activeTrip.distanceKm >= 0.1) base.trips.push(base.activeTrip)
  base.activeTrip = null
  return base
}

const garage = reactive<Garage>(load())
let timer: ReturnType<typeof setTimeout> | null = null

/** Источник актуальной незавершённой поездки; копию со статистикой делаем только при записи на диск. */
let activeSource: (() => Trip | null) | null = null

function saveNow(): void {
  timer = null
  if (activeSource) garage.activeTrip = activeSource()
  try { localStorage.setItem(KEY, JSON.stringify(garage)) } catch { /* ignore */ }
}
/** Запись не чаще раза в 5 с: опрос идёт несколько раз в секунду. */
function scheduleSave(): void {
  if (!timer) timer = setTimeout(saveNow, 5000)
}
watch(() => garage.fuelPrice, saveNow)
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow() })
}

export function useGarage() {
  return {
    garage,
    oil: () => oilStatus(garage.oil, garage.trackedTotalKm),
    addDistance(km: number, active: (() => Trip | null) | null): void {
      garage.trackedTotalKm += km
      activeSource = active
      scheduleSave()
    },
    finishTrip(trip: Trip | null): void {
      activeSource = null
      garage.activeTrip = null
      if (trip) {
        garage.trips.push(trip)
        if (garage.trips.length > MAX_TRIPS) garage.trips.splice(0, garage.trips.length - MAX_TRIPS)
      }
      saveNow()
    },
    setOil(dateISO: string, sinceKm: number, intervalKm: number): void {
      garage.oil = { dateISO, offsetKm: Math.max(0, sinceKm), trackedAtSet: garage.trackedTotalKm, intervalKm: Math.max(1000, intervalKm) }
      saveNow()
    },
    clearTrips(): void {
      garage.trips = []
      saveNow()
    },
    save: saveNow,
  }
}
