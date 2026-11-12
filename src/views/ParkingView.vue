<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useVehicle } from '@/composables/useVehicle'
import { placeName } from '@/services/Geocoder'
import { span } from '@/utils/format'

interface Spot { lat: number; lon: number; at: number; note: string; address?: string }
const KEY = 'myoldcar.parking.v1'
const v = useVehicle()
const spot = ref<Spot | null>((() => { try { return JSON.parse(localStorage.getItem(KEY) ?? 'null') } catch { return null } })())
const busy = ref(false)
const err = ref<string | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval>
onMounted(() => { timer = setInterval(() => { now.value = Date.now() }, 30000) })
onUnmounted(() => clearInterval(timer))
const persist = (): void => { try { if (spot.value) localStorage.setItem(KEY, JSON.stringify(spot.value)); else localStorage.removeItem(KEY) } catch { /* ignore */ } }

async function where(): Promise<{ lat: number; lon: number } | null> {
  const f = v.gpsFix.value
  if (f && Date.now() - f.t < 60000) return { lat: f.lat, lon: f.lon }
  return new Promise((res) => {
    if (!navigator.geolocation) return res(null)
    navigator.geolocation.getCurrentPosition((p) => res({ lat: p.coords.latitude, lon: p.coords.longitude }), () => res(null), { enableHighAccuracy: true, timeout: 15000 })
  })
}
async function save(): Promise<void> {
  busy.value = true
  err.value = null
  const p = await where()
  if (!p) { err.value = 'Не удалось определить место. Включите геопозицию и подождите, пока найдутся спутники.'; busy.value = false; return }
  spot.value = { ...p, at: Date.now(), note: spot.value?.note ?? '' }
  persist()
  busy.value = false
  void placeName(p.lat, p.lon).then((a) => { if (spot.value) { spot.value.address = a; persist() } }).catch(() => undefined)
}
function clear(): void { if (confirm('Забыть место парковки?')) { spot.value = null; persist() } }
const elapsed = computed(() => (spot.value ? span(now.value - spot.value.at) : ''))
const mapUrl = computed(() => (spot.value ? `https://www.google.com/maps/search/?api=1&query=${spot.value.lat},${spot.value.lon}` : ''))
const routeUrl = computed(() => (spot.value ? `https://www.google.com/maps/dir/?api=1&destination=${spot.value.lat},${spot.value.lon}&travelmode=walking` : ''))
const open = (u: string): void => { window.open(u, '_blank') }
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Стоянка" />
    <div v-if="!spot" class="card flex flex-col items-center gap-4 px-6 py-10 text-center">
      <span class="flex h-20 w-20 items-center justify-center rounded-3xl bg-accent-soft text-accent"><AppIcon name="parking" :size="44" /></span>
      <p class="text-sm text-mute">Запомните, где оставили машину, — потом приложение проведёт вас пешком обратно.</p>
      <button class="btn w-full" :disabled="busy" @click="save">{{ busy ? 'Определяю место…' : 'Запомнить это место' }}</button>
    </div>
    <template v-else>
      <div class="card p-5">
        <div class="flex items-center gap-3"><span class="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-on"><AppIcon name="pin" :size="26" /></span><div class="min-w-0"><div class="text-lg font-bold">Машина стоит {{ elapsed }}</div><div class="truncate text-sm text-mute">{{ spot.address ?? `${spot.lat.toFixed(5)}, ${spot.lon.toFixed(5)}` }}</div></div></div>
        <label class="mt-4 block text-xs text-mute">Заметка (этаж, ряд, ориентир)
          <input v-model="spot.note" class="field mt-1" placeholder="Например, 2 этаж, колонна B4" @change="persist">
        </label>
        <div class="mt-4 grid grid-cols-2 gap-2"><button class="btn" @click="open(routeUrl)">Вести к машине</button><button class="btn-ghost" @click="open(mapUrl)">Показать на карте</button></div>
      </div>
      <div class="grid grid-cols-2 gap-2"><button class="btn-soft" :disabled="busy" @click="save">Обновить место</button><button class="btn-ghost !text-bad" @click="clear">Забыть место</button></div>
    </template>
    <p v-if="err" class="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">{{ err }}</p>
    <p class="px-2 text-center text-xs text-faint">Место хранится только на телефоне. Карту откроет приложение карт; кнопки работают при наличии интернета.</p>
  </section>
</template>
