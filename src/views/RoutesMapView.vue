<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PageHeader from '@/components/PageHeader.vue'
import Segmented from '@/components/Segmented.vue'
import { useGarage } from '@/composables/useGarage'
import { useMyTrips } from '@/composables/useMyTrips'
import { inPeriod, type RoutePeriod } from '@/services/RouteSummary'
import { dayKey, num, span } from '@/utils/format'

/** Итоговая карта: маршруты всех поездок за 7 дней, 30 дней или всё время. */
const { loadRoute } = useGarage()
const { trips } = useMyTrips()
const period = ref<RoutePeriod>('7')
const periods = [{ id: '7', label: '7 дней' }, { id: '30', label: '30 дней' }, { id: 'all', label: 'Всё время' }]
const mapEl = ref<HTMLDivElement | null>(null)
let map: L.Map | null = null
let layer: L.LayerGroup | null = null

const list = computed(() => inPeriod(trips.value, period.value).sort((a, b) => a.start - b.start))
const withRoute = computed(() => list.value.map((t) => ({ t, route: loadRoute(t.id) })).filter((x) => x.route.length >= 2))
const stats = computed(() => {
  const l = list.value
  const km = l.reduce((a, t) => a + t.distanceKm, 0)
  const ms = l.reduce((a, t) => a + t.movingMs + t.stoppedMs, 0)
  return {
    trips: l.length, km, ms,
    days: new Set(l.map((t) => dayKey(t.start))).size,
    longest: l.reduce((m, t) => Math.max(m, t.distanceKm), 0),
    drawn: withRoute.value.length,
  }
})

/** Старые поездки бледнее, свежие ярче: сразу видно, где ездили недавно. */
function color(i: number, n: number): string {
  const k = n <= 1 ? 1 : i / (n - 1)
  return `hsl(${Math.round(255 - 60 * k)} ${Math.round(70 + 25 * k)}% ${Math.round(62 - 8 * k)}%)`
}

function draw(): void {
  if (!map) return
  layer?.remove()
  layer = L.layerGroup().addTo(map)
  const canvas = L.canvas({ padding: 0.3 })
  const all: L.LatLngTuple[] = []
  withRoute.value.forEach(({ route }, i, a) => {
    L.polyline(route, { color: color(i, a.length), weight: i === a.length - 1 ? 5 : 3.5, opacity: i === a.length - 1 ? 0.95 : 0.55, renderer: canvas }).addTo(layer!)
    all.push(...route)
  })
  const last = withRoute.value[withRoute.value.length - 1]
  if (last) L.circleMarker(last.route[last.route.length - 1], { radius: 7, color: '#fff', weight: 2, fillColor: '#2fbf84', fillOpacity: 1 }).bindTooltip('Последняя поездка').addTo(layer)
  if (all.length) map.fitBounds(L.latLngBounds(all), { padding: [24, 24], maxZoom: 15 })
}

onMounted(async () => {
  await nextTick()
  if (!mapEl.value) return
  map = L.map(mapEl.value, { zoomControl: true }).setView([55.75, 37.62], 10)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
  draw()
})
watch(period, () => draw())
onBeforeUnmount(() => { map?.remove(); map = null })
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Карта поездок" />
    <Segmented :options="periods" :model-value="period" class="flex w-full [&>button]:flex-1" @update:model-value="period = $event as RoutePeriod" />

    <div class="relative overflow-hidden rounded-2xl border border-night-600">
      <div ref="mapEl" class="trip-map h-[52vh] min-h-[20rem] w-full" />
      <p v-if="!stats.drawn" class="pointer-events-none absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-xl bg-night-900/90 p-3 text-center text-sm text-mute">
        {{ stats.trips ? 'У этих поездок нет координат — маршрут не нарисовать.' : 'За выбранный период поездок нет.' }}
      </p>
    </div>
    <div class="flex items-center gap-2 text-[11px] text-faint"><span>давно</span><span class="h-1.5 flex-1 rounded-full" style="background: linear-gradient(90deg, hsl(255 70% 62%), hsl(195 95% 54%))" /><span>недавно</span></div>

    <div class="tiles grid-cols-2">
      <div><div class="label">Поездок</div><div class="tile-value">{{ stats.trips }}</div></div>
      <div><div class="label">Пробег</div><div class="tile-value">{{ num(stats.km, 1) }} <span class="tile-unit">км</span></div></div>
      <div><div class="label">Дней в пути</div><div class="tile-value">{{ stats.days }}</div></div>
      <div><div class="label">Самая длинная</div><div class="tile-value">{{ num(stats.longest, 1) }} <span class="tile-unit">км</span></div></div>
      <div class="col-span-2"><div class="label">Время за рулём и на стоянках</div><div class="tile-value">{{ span(stats.ms) }}</div></div>
    </div>
    <p v-if="period === 'all'" class="text-center text-xs text-faint">Маршруты хранятся для каждой поездки, записанной с этой версии. Более старые рисуются, пока цел их подробный трек.</p>
  </section>
</template>

<style>
:root[data-theme="dark"] .trip-map .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9); }
.trip-map { background: rgb(var(--inset)); }
.trip-map .leaflet-control-attribution { background: rgb(var(--card) / 0.85); color: rgb(var(--mute)); }
.trip-map .leaflet-bar a { background: rgb(var(--card)); color: rgb(var(--ink)); border-color: rgb(var(--line)); }
</style>
