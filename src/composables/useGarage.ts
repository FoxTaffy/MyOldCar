import { reactive, watch } from 'vue'
import { carTitle, newCar, type Car } from '@/services/Cars'
import { DEFAULT_OIL, oilStatus } from '@/services/OilService'
import type { TrackPoint } from '@/services/TripAnalysis'
import type { FinishedTrip } from '@/services/TripSession'
import type { Trip } from '@/services/TripRecorder'

const KEY = 'myoldcar.garage.v2'
const OLD_KEY = 'myoldcar.garage.v1'
const ACTIVE_KEY = 'myoldcar.active.v1'
const trackKey = (id: string) => `myoldcar.track.${id}`
const MAX_TRIPS = 200
/** Треки (точки на карте) тяжёлые — храним только у последних поездок. */
const MAX_TRACKS = 30

interface Garage {
  fuelPrice: number
  cars: Car[]
  activeCarId: string
  trips: Trip[]
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

function load(): Garage {
  const saved = read<Partial<Garage>>(KEY)
  let base: Garage
  if (saved?.cars?.length) {
    base = { fuelPrice: 65, cars: [], activeCarId: '', trips: [], ...saved } as Garage
    base.cars = base.cars.map((c) => newCar({ ...c, id: c.id, oil: { ...DEFAULT_OIL, ...c.oil } }))
  } else {
    // Миграция с версии с одной машиной: её масло, пробег и поездки переходят в первую машину.
    const old = read<{ fuelPrice?: number; oil?: Car['oil']; trackedTotalKm?: number; trips?: Trip[] }>(OLD_KEY)
    const car = newCar({ name: 'ВАЗ-2104', make: 'ВАЗ', model: '2104', oil: { ...DEFAULT_OIL, ...old?.oil }, trackedTotalKm: old?.trackedTotalKm ?? 0 })
    base = { fuelPrice: old?.fuelPrice ?? 65, cars: [car], activeCarId: car.id, trips: (old?.trips ?? []).map((t) => ({ ...t, carId: car.id })) }
  }
  if (!base.cars.some((c) => c.id === base.activeCarId)) base.activeCarId = base.cars[0].id

  // Приложение закрыли посреди поездки — сохраняем то, что успели записать.
  const active = read<{ trip: Trip; points: TrackPoint[] }>(ACTIVE_KEY)
  if (active?.trip && active.trip.distanceKm >= 0.1) {
    const last = active.points.length ? active.points[active.points.length - 1].t : active.trip.end
    const trip: Trip = { ...active.trip, end: last, hasTrack: active.points.length >= 2 }
    base.trips.push(trip)
    if (trip.hasTrack) write(trackKey(trip.id), active.points)
  }
  try { localStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
  return base
}

const garage = reactive<Garage>(load())
let timer: ReturnType<typeof setTimeout> | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null
let activeData: { trip: Trip; points: TrackPoint[] } | null = null

function saveNow(): void {
  timer = null
  write(KEY, garage)
}
/** Запись не чаще раза в 5 с: опрос идёт несколько раз в секунду. */
function scheduleSave(): void {
  if (!timer) timer = setTimeout(saveNow, 5000)
}
function flushActive(): void {
  activeTimer = null
  if (activeData) write(ACTIVE_KEY, activeData)
  else try { localStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
}

function activeCar(): Car {
  return garage.cars.find((c) => c.id === garage.activeCarId) ?? garage.cars[0]
}

/** Оставляем треки только у MAX_TRACKS последних поездок. */
function pruneTracks(): void {
  const withTrack = garage.trips.filter((t) => t.hasTrack).sort((a, b) => b.start - a.start)
  for (const t of withTrack.slice(MAX_TRACKS)) {
    try { localStorage.removeItem(trackKey(t.id)) } catch { /* ignore */ }
    t.hasTrack = false
  }
}

function dropTrip(id: string): void {
  try { localStorage.removeItem(trackKey(id)) } catch { /* ignore */ }
}

watch(() => garage.fuelPrice, saveNow)
watch(() => garage.activeCarId, saveNow)
// Правки профилей машин сохраняем с задержкой (поля вводятся по символу).
watch(() => garage.cars, scheduleSave, { deep: true })
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { saveNow(); flushActive() }
  })
}

export function useGarage() {
  return {
    garage,
    car: activeCar,
    oil: () => oilStatus(activeCar().oil, activeCar().trackedTotalKm),
    addDistance(km: number): void {
      if (km > 0) { activeCar().trackedTotalKm += km; scheduleSave() }
    },
    /** Периодически сохраняет идущую поездку (на случай, если приложение убьют). */
    saveActive(trip: Trip | null, points: TrackPoint[]): void {
      activeData = trip ? { trip: { ...trip }, points } : null
      if (!activeTimer) activeTimer = setTimeout(flushActive, 15000)
    },
    finishTrip(f: FinishedTrip | null): void {
      activeData = null
      flushActive()
      if (f) {
        garage.trips.push(f.trip)
        if (f.trip.hasTrack && !write(trackKey(f.trip.id), f.points)) {
          // Не хватило места: выкидываем самые старые треки и пробуем ещё раз.
          pruneTracks()
          if (!write(trackKey(f.trip.id), f.points)) f.trip.hasTrack = false
        }
        if (garage.trips.length > MAX_TRIPS) {
          for (const t of garage.trips.splice(0, garage.trips.length - MAX_TRIPS)) dropTrip(t.id)
        }
        pruneTracks()
      }
      saveNow()
    },
    loadTrack: (id: string): TrackPoint[] => read<TrackPoint[]>(trackKey(id)) ?? [],
    deleteTrip(id: string): void {
      dropTrip(id)
      garage.trips = garage.trips.filter((t) => t.id !== id)
      saveNow()
    },
    setOil(dateISO: string, sinceKm: number, intervalKm: number): void {
      const c = activeCar()
      c.oil = { dateISO, offsetKm: Math.max(0, sinceKm), trackedAtSet: c.trackedTotalKm, intervalKm: Math.max(1000, intervalKm) }
      saveNow()
    },
    clearTrips(carId?: string): void {
      const gone = garage.trips.filter((t) => !carId || t.carId === carId || !t.carId)
      for (const t of gone) dropTrip(t.id)
      garage.trips = garage.trips.filter((t) => !gone.includes(t))
      saveNow()
    },
    selectCar(id: string): void {
      if (garage.cars.some((c) => c.id === id)) garage.activeCarId = id
    },
    addCar(init: Partial<Car> = {}): Car {
      const c = newCar(init)
      garage.cars.push(c)
      garage.activeCarId = c.id
      saveNow()
      return c
    },
    removeCar(id: string): void {
      if (garage.cars.length <= 1) return
      for (const t of garage.trips.filter((t) => t.carId === id)) dropTrip(t.id)
      garage.trips = garage.trips.filter((t) => t.carId !== id)
      garage.cars = garage.cars.filter((c) => c.id !== id)
      if (garage.activeCarId === id) garage.activeCarId = garage.cars[0].id
      saveNow()
    },
    carName: (id?: string): string => {
      const c = garage.cars.find((x) => x.id === id)
      return c ? carTitle(c) : ''
    },
    save: saveNow,
  }
}
