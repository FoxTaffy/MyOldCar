import { computed, ref, watch } from 'vue'
import { useGarage } from '@/composables/useGarage'
import { useMyTrips } from '@/composables/useMyTrips'
import { useVehicle } from '@/composables/useVehicle'
import { fetchWeather, washAdvice, type DayWeather } from '@/services/Wash'
import { todayISO } from '@/utils/format'

const LOC_KEY = 'myoldcar.loc.v1'
const WX_KEY = 'myoldcar.weather.v1'
const WX_TTL = 3 * 3600_000

function read<T>(key: string): T | null {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : null } catch { return null }
}
function write(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
}

const weather = ref<DayWeather[]>(read<{ at: number; days: DayWeather[] }>(WX_KEY)?.days ?? [])
const loading = ref(false)
const noLocation = ref(false)

/** Общая логика «умной мойки» для главной и отдельного экрана. */
export function useWash() {
  const { expenses } = useGarage()
  const { trips } = useMyTrips()
  const v = useVehicle()

  // Последнее известное место (для прогноза погоды) запоминаем, пока приходят точки GPS.
  watch(() => v.gpsFix.value, (f) => { if (f) write(LOC_KEY, { lat: f.lat, lon: f.lon }) })

  const lastWash = computed(() => expenses().filter((e) => e.cat === 'wash').map((e) => e.date).sort().pop() ?? null)
  const kmSince = computed(() => {
    const from = lastWash.value ? Date.parse(lastWash.value + 'T00:00:00') : Date.now() - 21 * 86400000
    return trips.value.filter((t) => t.start >= from).reduce((a, t) => a + t.distanceKm, 0)
  })
  const advice = computed(() => washAdvice({ lastWashISO: lastWash.value, kmSince: kmSince.value, todayISO: todayISO(), weather: weather.value }))

  /** Загружает прогноз по последнему известному месту (не чаще раза в 3 часа, если не force). */
  async function refresh(force = false): Promise<void> {
    const loc = (v.gpsFix.value ? { lat: v.gpsFix.value.lat, lon: v.gpsFix.value.lon } : null) ?? read<{ lat: number; lon: number }>(LOC_KEY)
    noLocation.value = !loc
    if (!loc) return
    const cached = read<{ at: number; days: DayWeather[] }>(WX_KEY)
    if (!force && cached && Date.now() - cached.at < WX_TTL) { weather.value = cached.days; return }
    loading.value = true
    try {
      const days = await fetchWeather(loc.lat, loc.lon)
      if (days.length) { weather.value = days; write(WX_KEY, { at: Date.now(), days }) }
    } finally { loading.value = false }
  }

  return { advice, lastWash, kmSince, weather, loading, noLocation, refresh }
}
