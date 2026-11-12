import { reactive, watch } from 'vue'
import { carTitle, newCar, type Car } from '@/services/Cars'
import type { Expense } from '@/services/Expenses'
import { itemStatus, type ServiceItem } from '@/services/Maintenance'
import { DEFAULT_OIL, oilStatus } from '@/services/OilService'
import type { TrackPoint } from '@/services/TripAnalysis'
import { buildRoute, type Route } from '@/services/RouteSummary'
import { TripSession, type FinishedTrip } from '@/services/TripSession'
import type { Trip } from '@/services/TripRecorder'

const KEY = 'myoldcar.garage.v2'
const OLD_KEY = 'myoldcar.garage.v1'
const ACTIVE_KEY = 'myoldcar.active.v1'
const trackKey = (id: string) => `myoldcar.track.${id}`
const routeKey = (id: string) => `myoldcar.route.${id}`
const MAX_TRIPS = 200
/** Треки (точки на карте) тяжёлые — храним только у последних поездок. */
const MAX_TRACKS = 30

interface Garage {
  fuelPrice: number
  cars: Car[]
  activeCarId: string
  trips: Trip[]
  expenses: Expense[]
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
    base = { fuelPrice: 65, cars: [], activeCarId: '', trips: [], expenses: [], ...saved } as Garage
    if (!Array.isArray(base.expenses)) base.expenses = []
    // odometerTrackedAt появился позже: у старых профилей отсчёт оценки одометра начинаем с текущего момента.
    base.cars = base.cars.map((c) => newCar({ ...c, id: c.id, oil: { ...DEFAULT_OIL, ...c.oil }, odometerTrackedAt: c.odometerTrackedAt ?? c.trackedTotalKm ?? 0 }))
  } else {
    // Миграция с версии с одной машиной: её масло, пробег и поездки переходят в первую машину.
    const old = read<{ fuelPrice?: number; oil?: Car['oil']; trackedTotalKm?: number; trips?: Trip[] }>(OLD_KEY)
    // Новый пользователь: профиль пустой, без машины «по умолчанию» — приложение само предложит добавить свою.
    const car = old
      ? newCar({ name: 'ВАЗ-2104', make: 'ВАЗ', model: '2104', oil: { ...DEFAULT_OIL, ...old.oil }, trackedTotalKm: old.trackedTotalKm ?? 0 })
      : newCar({ name: '', placeholder: true })
    base = { fuelPrice: old?.fuelPrice ?? 65, cars: [car], activeCarId: car.id, trips: (old?.trips ?? []).map((t) => ({ ...t, carId: car.id })), expenses: [] }
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
  // Поездки, записанные до появления общей карты: маршрут строим из сохранённого трека (пока он ещё есть).
  for (const t of base.trips) {
    if (!t.hasTrack || localStorage.getItem(routeKey(t.id))) continue
    const pts = read<TrackPoint[]>(trackKey(t.id))
    if (pts) saveRoute(t.id, pts)
  }
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

/** Удаляет только тяжёлый трек (компактный маршрут для общей карты остаётся). */
function dropTrip(id: string): void {
  try { localStorage.removeItem(trackKey(id)) } catch { /* ignore */ }
}
/** Удаляет все данные поездки: трек и маршрут. */
function dropTripAll(id: string): void {
  dropTrip(id)
  try { localStorage.removeItem(routeKey(id)) } catch { /* ignore */ }
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

/** Сохраняет компактный маршрут; пустой не пишем. */
function saveRoute(id: string, points: TrackPoint[]): void {
  const r = buildRoute(points)
  if (r.length >= 2) write(routeKey(id), r)
}

const finite = (n: unknown, fallback: number): number => (typeof n === 'number' && Number.isFinite(n) ? n : fallback)

watch(() => garage.fuelPrice, saveNow)
watch(() => garage.activeCarId, saveNow)
// Правки профилей машин сохраняем с задержкой (поля вводятся по символу).
watch(() => garage.cars, scheduleSave, { deep: true })
watch(() => garage.expenses, scheduleSave, { deep: true })
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
        saveRoute(f.trip.id, f.points)
        garage.trips.push(f.trip)
        if (garage.trips.length > MAX_TRIPS) {
          for (const t of garage.trips.splice(0, garage.trips.length - MAX_TRIPS)) dropTripAll(t.id)
        }
        pruneTracks()
      }
      saveNow()
    },
    loadTrack: (id: string): TrackPoint[] => read<TrackPoint[]>(trackKey(id)) ?? [],
    /** Компактный маршрут поездки для общей карты (для всех поездок, не только последних 30). */
    loadRoute: (id: string): Route => read<Route>(routeKey(id)) ?? [],
    deleteTrip(id: string): void {
      dropTripAll(id)
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
      for (const t of gone) dropTripAll(t.id)
      garage.trips = garage.trips.filter((t) => !gone.includes(t))
      saveNow()
    },
    selectCar(id: string): void {
      if (garage.cars.some((c) => c.id === id)) garage.activeCarId = id
    },
    /** Нет ни одной настоящей машины — нужно показать приветствие и добавить первую. */
    needsFirstCar: (): boolean => activeCar().placeholder === true,
    /** Заполняет пустой профиль новичка данными из мастера (а не добавляет вторую машину). */
    fillFirstCar(init: Partial<Car>): Car {
      const c = activeCar()
      Object.assign(c, init, { placeholder: false })
      if (!c.name) c.name = [c.make, c.model].filter(Boolean).join(' ') || 'Моя машина'
      saveNow()
      return c
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
      for (const t of garage.trips.filter((t) => t.carId === id)) dropTripAll(t.id)
      garage.trips = garage.trips.filter((t) => t.carId !== id)
      garage.cars = garage.cars.filter((c) => c.id !== id)
      if (garage.activeCarId === id) garage.activeCarId = garage.cars[0].id
      saveNow()
    },
    /** Расходы активной машины (новые сверху). */
    expenses: (): Expense[] => garage.expenses.filter((e) => e.carId === activeCar().id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)),
    addExpense(e: Omit<Expense, 'id' | 'carId'>): Expense {
      const x: Expense = { ...e, id: `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, carId: activeCar().id }
      garage.expenses.push(x)
      saveNow()
      return x
    },
    updateExpense(id: string, e: Omit<Expense, 'id' | 'carId'>): void {
      const i = garage.expenses.findIndex((x) => x.id === id)
      if (i >= 0) { garage.expenses[i] = { ...e, id, carId: garage.expenses[i].carId }; saveNow() }
    },
    removeExpense(id: string): void {
      garage.expenses = garage.expenses.filter((x) => x.id !== id)
      saveNow()
    },
    /** Позиции обслуживания активной машины со статусом. */
    serviceItems: () => activeCar().services.map((it) => ({ it, st: itemStatus(it, activeCar().trackedTotalKm) })),
    /** Отметить замену: дата, пробег с замены (обычно 0) и, при желании, новый интервал. */
    markServiced(id: string, dateISO: string, sinceKm = 0, intervalKm?: number): void {
      const c = activeCar()
      const it = c.services.find((x) => x.id === id)
      if (!it) return
      it.dateISO = dateISO
      it.offsetKm = Math.max(0, finite(sinceKm, 0))
      it.trackedAtSet = c.trackedTotalKm
      if (intervalKm != null) it.intervalKm = Math.min(500000, Math.max(500, finite(intervalKm, it.intervalKm)))
      saveNow()
    },
    addServiceItem(name: string, intervalKm: number, months?: number): ServiceItem {
      const it: ServiceItem = { id: `s${Date.now().toString(36)}`, name: name.trim() || 'Позиция', intervalKm: Math.min(500000, Math.max(500, finite(intervalKm, 10000))), months, dateISO: null, offsetKm: 0, trackedAtSet: 0 }
      activeCar().services.push(it)
      saveNow()
      return it
    },
    removeServiceItem(id: string): void {
      const c = activeCar()
      c.services = c.services.filter((x) => x.id !== id)
      saveNow()
    },
    setLastDiag(count: number): void {
      activeCar().lastDiag = { at: Date.now(), count }
      saveNow()
    },
    carName: (id?: string): string => {
      const c = garage.cars.find((x) => x.id === id)
      return c ? carTitle(c) : ''
    },
    save: saveNow,
  }
}
