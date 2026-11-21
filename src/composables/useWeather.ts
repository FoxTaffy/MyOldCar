import { computed, ref } from 'vue'
import { useUi } from '@/composables/useUi'
import { useVehicle } from '@/composables/useVehicle'
import { fetchWeather, type WxData } from '@/services/WeatherApi'
import { advise } from '@/services/WeatherAdvice'

const LOC_KEY = 'myoldcar.loc.v1' // тот же ключ, что пишет useWash при каждой точке GPS
const WX_KEY = 'myoldcar.weather.v2'
const TTL = 30 * 60_000

function read<T>(key: string): T | null {
  try { const r = localStorage.getItem(key); return r ? (JSON.parse(r) as T) : null } catch { return null }
}
function write(key: string, v: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* ignore */ }
}

const data = ref<WxData | null>(read<WxData>(WX_KEY))
const loading = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const noLocation = ref(false)
const tick = ref(Date.now())

/** Одноразовое определение места, если GPS ещё ни разу не отдавал координаты. */
function locate(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => resolve(null),
      { timeout: 10_000, maximumAge: 10 * 60_000 },
    )
  })
}

/** Погода и советы для карточки на главной. */
export function useWeather() {
  const v = useVehicle()
  const { ui } = useUi()

  const advice = computed(() => (data.value ? advise({ data: data.value, nowMs: tick.value, tires: ui.tires }) : null))

  async function refresh(force = false): Promise<void> {
    // Принудительное обновление (сменили ключ) не отбрасываем, а ждём текущую загрузку и повторяем.
    if (loading.value) {
      if (force) { while (loading.value) await new Promise((r) => setTimeout(r, 200)) } else return
    }
    tick.value = Date.now()
    const cached = read<WxData>(WX_KEY)
    // Другой источник (добавили/убрали ключ) — кэш недействителен.
    const wantYandex = !!ui.yandexKey.trim()
    const stale = !cached || Date.now() - cached.fetchedAt > TTL || (wantYandex && cached.source !== 'yandex') || (!wantYandex && cached.source === 'yandex')
    if (!force && !stale) { data.value = cached; return }
    let loc = (v.gpsFix.value ? { lat: v.gpsFix.value.lat, lon: v.gpsFix.value.lon } : null) ?? read<{ lat: number; lon: number }>(LOC_KEY)
    loading.value = true
    error.value = null
    try {
      if (!loc) {
        loc = await locate()
        if (loc) write(LOC_KEY, loc)
      }
      noLocation.value = !loc
      if (!loc) return
      const r = await fetchWeather(loc.lat, loc.lon, ui.yandexKey)
      data.value = r.data
      note.value = r.note
      write(WX_KEY, r.data)
    } catch (e) {
      // Оставляем прошлый прогноз на экране — устаревший лучше пустого.
      error.value = data.value ? 'Нет сети — показан сохранённый прогноз' : e instanceof Error ? e.message : 'Не удалось получить прогноз'
    } finally { loading.value = false }
  }

  return { data, advice, loading, error, note, noLocation, refresh }
}
