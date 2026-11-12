import { reactive, watch } from 'vue'
import { carTitle, newCar, type Car } from '@/services/Cars'
import { DEFAULT_OIL, oilStatus } from '@/services/OilService'
import type { TrackPoint } from '@/services/TripAnalysis'
import { TripSession, type FinishedTrip } from '@/services/TripSession'
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
    // odometerTrackedAt появился позже: у старых профилей отсчёт оценки одометра начинаем с текущего момента.
    base.cars = base.cars.map((c) => newCar({ ...c, id: c.id, oil: { ...DEFAULT_OIL, ...c.oil }, odometerTrackedAt: c.odometerTrackedAt ?? c.trackedTotalKm ?? 0 }))
  } else {
    // Миграция с версии с одной машиной: её масло, пробег и поездки переходят в первую машину.
    const old = read<{ fuelPrice?: number; oil?: Car['oil']; trackedTotalKm?: number; trips?: Trip[] }>(OLD_KEY)
    const car = newCar({ name: 'ВАЗ-2104', make: 'ВАЗ', model: '2104', oil: { ...DEFAULT_OIL, ...old?.oil }, trackedTotalKm: old?.trackedTotalKm ?? 0 })
    base = { fuelPrice: old?.fuelPrice ?? 65, cars: [car], activeCarId: car.id, trips: (old?.trips ?? []).map((t) => ({ ...t, carId: car.id })) }
  }
  if (!base.cars.some((c) => c.id === base.activeCarId)) base.activeCarId = base.cars[0].id

  if (!Array.isArray(base.trips)) base.trips = []
  if (!Number.isFinite(base.fuelPrice) || base.fuelPrice < 0) base.fuelPrice = 65

  // Приложение закрыли посреди поездки — сохраняем то, что успели записать.
  const active = read<{ trip?: Trip; points?: TrackPoint[] }>(ACTIVE_KEY)
  const rescued = active?.trip ? TripSession.finalize(active.trip, Array.isArray(active.points) ? active.points : []) : null
  if (rescued && !base.trips.some((t) => t.id === rescued.trip.id)) {
    if (rescued.trip.hasTrack && !write(trackKey(rescued.trip.id), rescued.points)) rescued.trip.hasTrack = false
    base.trips.push(rescued.trip)
    // Сразу на диск: иначе при повторном падении до первого сохранения спасённая поездка пропала бы.
    write(KEY, base)
  }
  try { localStorage.removeItem(ACTIVE_KEY) } catch { /* ignore */ }
  return base
}

const garage = reactive<Garage>(load())
let timer: ReturnType<typeof setTimeout> | null = null
let activeTimer: ReturnType<typeof setTimeout> | null = null
let activeData: { trip: Trip; points: TrackPoint[] } | null = null

function saveNow(): void {
  if (timer) clearTimeout(timer)
  timer = null
  // Хранилище переполнено треками — жертвуем самыми старыми, но машины, масло и список поездок сохраняем обязательно.
  while (!write(KEY, garage) && dropOldestTrack()) { /* повторяем */ }
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

function dropTrip(id: string): void {
  try { localStorage.removeItem(trackKey(id)) } catch { /* ignore */ }
}

/** Удаляет трек самой старой поездки (сама поездка и её цифры остаются). false — треков больше нет. */
function dropOldestTrack(except?: string): boolean {
  const oldest = garage.trips.filter((t) => t.hasTrack && t.id !== except).sort((a, b) => a.start - b.start)[0]
  if (!oldest) return false
  dropTrip(oldest.id)
  oldest.hasTrack = false
  return true
}

/** Оставляем треки только у MAX_TRACKS последних поездок. */
function pruneTracks(): void {
  const withTrack = garage.trips.filter((t) => t.hasTrack).sort((a, b) => b.start - a.start)
  for (const t of withTrack.slice(MAX_TRACKS)) {
    dropTrip(t.id)
    t.hasTrack = false
  }
}

/** Пишет трек; если места нет — освобождает его, удаляя самые старые треки. */
function writeTrack(id: string, points: TrackPoint[]): boolean {
  for (;;) {
    if (write(trackKey(id), points)) return true
    if (!dropOldestTrack(id)) return false
  }
}

const finite = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback)

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
        if (f.trip.hasTrack && !writeTrack(f.trip.id, f.points)) f.trip.hasTrack = false
        garage.trips.push(f.trip)
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
    /** Пустые/нечисловые значения из полей ввода не должны попасть в хранилище. */
    setOil(dateISO: string, sinceKm: number, intervalKm: number): void {
      const c = activeCar()
      c.oil = {
        dateISO: dateISO || null,
        offsetKm: Math.max(0, finite(sinceKm, 0)),
        trackedAtSet: c.trackedTotalKm,
        intervalKm: Math.min(50000, Math.max(1000, finite(intervalKm, DEFAULT_OIL.intervalKm))),
      }
      saveNow()
    },
    /** Запомнить показание одометра: дальше приложение прибавляет к нему намеренный пробег. */
    setOdometer(carId: string, km: number | null): void {
      const c = garage.cars.find((x) => x.id === carId)
      if (!c) return
      c.odometerKm = km != null && Number.isFinite(km) && km >= 0 ? km : null
      c.odometerTrackedAt = c.trackedTotalKm
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
