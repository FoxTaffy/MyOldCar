<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { placeName } from '@/services/Geocoder'
import { analyzeTrack, nearestPoint, speedColor, type TrackPoint } from '@/services/TripAnalysis'
import { tripAvgSpeed, tripConsumption, type Trip } from '@/services/TripRecorder'
import { dateTime, duration, num } from '@/utils/format'

const route = useRoute()
const { garage, loadTrack } = useGarage()
const { session, tripActive } = useVehicle()

const isLive = route.params.id === 'live'
const points = ref<TrackPoint[]>([])
const trip = ref<Trip | null>(null)
const mapEl = ref<HTMLDivElement | null>(null)
const picked = ref<TrackPoint | null>(null)
const place = ref<string | null>(null)
const placeBusy = ref(false)
const placeErr = ref<string | null>(null)
const sliderIdx = ref(0)

let map: L.Map | null = null
let layer: L.LayerGroup | null = null
let cursor: L.CircleMarker | null = null
let timer: ReturnType<typeof setInterval> | null = null

function refresh(): void {
  if (isLive) {
    points.value = [...session.points]
    trip.value = session.trip ? { ...session.trip } : null
  } else {
    trip.value = garage.trips.find((t) => t.id === route.params.id) ?? null
    points.value = loadTrack(String(route.params.id))
  }
}

const analysis = computed(() => analyzeTrack(points.value))
const hasRoute = computed(() => analysis.value.route.length >= 2)
const milEvents = computed(() => trip.value?.events ?? [])
const codesAt = (t: number): string[] => milEvents.value.find((e) => Math.abs(e.t - t) < 15000)?.codes ?? []

const fmtTime = (t: number): string => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Строки данных для выбранной точки: показываются под картой и во всплывающем окне. */
function facts(p: TrackPoint): [string, string][] {
  const rows: [string, string][] = [
    ['Время', fmtTime(p.t)],
    ['Скорость', p.spd != null ? `${num(p.spd, 0)} км/ч` : '—'],
    ['Обороты', p.rpm != null ? `${num(p.rpm, 0)} об/мин` : '—'],
    ['Темп. ОЖ', p.ect != null ? `${num(p.ect, 0)} °C` : '—'],
    ['Расход', p.l100 != null ? `${num(p.l100, 1)} л/100 км` : p.maf != null ? `ДМРВ ${num(p.maf, 1)} г/с` : '—'],
    ['Нагрузка', p.load != null ? `${num(p.load, 0)} %` : '—'],
    ['Дроссель', p.thr != null ? `${num(p.thr, 0)} %` : '—'],
    ['Напряжение', p.volt != null ? `${num(p.volt, 1)} В` : '—'],
    ['Check Engine', p.mil ? 'ГОРИТ' : 'не горит'],
  ]
  const codes = codesAt(p.t)
  if (p.mil && codes.length) rows.push(['Коды', codes.join(', ')])
  return rows
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function popupHtml(p: TrackPoint, title?: string): string {
  const rows = facts(p).map(([k, v]) => `<tr><td style="color:#7b8696;padding-right:10px">${esc(k)}</td><td style="font-family:ui-monospace,monospace;text-align:right">${esc(v)}</td></tr>`).join('')
  return `<div style="min-width:190px;color:#12161d">${title ? `<b>${esc(title)}</b>` : ''}<table style="font-size:12px;width:100%">${rows}</table><div class="place" style="margin-top:6px;font-size:12px;color:#4a5260">определяю место…</div></div>`
}

/** Показ точки: подсветка на карте, данные под картой, адрес. */
async function pick(p: TrackPoint, open = false): Promise<void> {
  picked.value = p
  place.value = null
  placeErr.value = null
  sliderIdx.value = Math.max(0, points.value.indexOf(p))
  if (map && p.lat != null && p.lon != null) {
    cursor?.remove()
    cursor = L.circleMarker([p.lat, p.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#4a86c8', fillOpacity: 1 }).addTo(map)
    if (open) map.panTo([p.lat, p.lon])
    void loadPlace(p)
  }
}

async function loadPlace(p: TrackPoint): Promise<void> {
  if (p.lat == null || p.lon == null) return
  placeBusy.value = true
  try {
    place.value = await placeName(p.lat, p.lon)
  } catch {
    placeErr.value = 'Адрес недоступен (нет интернета)'
  } finally {
    placeBusy.value = false
  }
}

function marker(p: { lat: number | null; lon: number | null }, html: string, size: number, onClick?: () => void): void {
  if (!map || !layer || p.lat == null || p.lon == null) return
  const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: 500 })
  if (onClick) m.on('click', onClick)
  m.addTo(layer)
}

const badge = (bg: string, text: string, border = '#0d1015'): string =>
  `<div style="width:26px;height:26px;border-radius:50%;background:${bg};border:2px solid ${border};color:#fff;font:700 14px/22px system-ui;text-align:center">${text}</div>`

function draw(): void {
  if (!map) return
  layer?.remove()
  layer = L.layerGroup().addTo(map)
  const r = analysis.value.route
  if (r.length < 2) return
  const canvas = L.canvas({ padding: 0.3 })
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1]
    const b = r[i]
    L.polyline([[a.lat as number, a.lon as number], [b.lat as number, b.lon as number]], { color: speedColor(b.spd), weight: 6, opacity: 0.95, renderer: canvas })
      .on('click', (e: L.LeafletMouseEvent) => {
        const p = nearestPoint(r, e.latlng.lat, e.latlng.lng) ?? b
        void pick(p)
        L.popup({ maxWidth: 260 }).setLatLng([p.lat as number, p.lon as number]).setContent(popupHtml(p)).openOn(map as L.Map)
        void fillPlace(p)
      })
      .addTo(layer)
  }
  const first = r[0]
  const last = r[r.length - 1]
  marker(first, badge('#5fae7a', 'A'), 26, () => void pick(first))
  if (!isLive) marker(last, badge('#4a86c8', 'B'), 26, () => void pick(last))
  for (const s of analysis.value.stops) {
    marker(s, `<div style="padding:2px 6px;border-radius:3px;background:#12161d;border:1px solid #d6a23f;color:#d6a23f;font:600 11px system-ui;white-space:nowrap;width:max-content;transform:translate(-50%,-50%)">P ${duration(s.end - s.start)}</div>`, 1, () => {
      const p = points.value.find((x) => x.t >= s.start) ?? first
      void pick(p)
    })
  }
  for (const m of analysis.value.milPoints) {
    marker(m, badge('#d9594c', '!', '#fff'), 30, () => {
      void pick(m)
      if (m.lat != null && m.lon != null) {
        L.popup({ maxWidth: 260 }).setLatLng([m.lat, m.lon]).setContent(popupHtml(m, 'Загорелась лампа Check Engine')).openOn(map as L.Map)
        void fillPlace(m)
      }
    })
  }
  if (isLive) map.panTo([last.lat as number, last.lon as number])
}

/** Дописывает адрес в открытое всплывающее окно. */
async function fillPlace(p: TrackPoint): Promise<void> {
  if (p.lat == null || p.lon == null) return
  let text: string
  try { text = await placeName(p.lat, p.lon) } catch { text = 'адрес недоступен (нет интернета)' }
  const el = document.querySelector('.leaflet-popup-content .place')
  if (el) el.textContent = `Место: ${text}`
}

function fit(): void {
  const r = analysis.value.route
  if (!map || r.length < 1) return
  map.fitBounds(L.latLngBounds(r.map((p) => [p.lat as number, p.lon as number] as [number, number])), { padding: [24, 24] })
}

function flyTo(lat: number | null, lon: number | null): void {
  if (map && lat != null && lon != null) map.setView([lat, lon], Math.max(map.getZoom(), 16))
}

function onSlide(): void {
  const p = points.value[sliderIdx.value]
  if (p) void pick(p, true)
}

onMounted(async () => {
  refresh()
  await nextTick()
  if (!mapEl.value) return
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: true }).setView([55.75, 37.62], 11)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
  draw()
  fit()
  if (isLive) timer = setInterval(() => { refresh(); draw() }, 3000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  map?.remove()
  map = null
})

const legend = [0, 30, 60, 90, 120]
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-2">
      <RouterLink to="/stats" class="btn-ghost !px-3 !py-2 !text-xs">← Поездки</RouterLink>
      <div class="font-mono text-sm">{{ trip ? dateTime(trip.start) : '—' }}</div>
      <span v-if="isLive" class="label ml-auto" :class="tripActive ? 'text-ok' : 'text-[#7b8696]'">{{ tripActive ? 'идёт запись' : 'нет активной поездки' }}</span>
    </div>

    <div class="relative">
      <div ref="mapEl" class="trip-map h-[52vh] w-full border border-night-600" />
      <p v-if="!hasRoute" class="absolute inset-x-3 top-3 z-[500] border border-night-600 bg-night-900 p-3 text-sm text-[#7b8696]">
        Нет GPS-координат для этой поездки: включите «Записывать поездки в фоне» и разрешите доступ к геопозиции.
      </p>
    </div>

    <div class="flex items-center gap-2 text-[11px] text-[#7b8696]">
      <span>км/ч:</span>
      <span v-for="v in legend" :key="v" class="flex items-center gap-1"><i class="inline-block h-2 w-4" :style="{ background: speedColor(v) }" />{{ v }}{{ v === 120 ? '+' : '' }}</span>
      <button class="btn-ghost ml-auto !px-2 !py-1 !text-[10px]" @click="fit">Весь маршрут</button>
    </div>

    <div v-if="trip" class="card grid grid-cols-4 gap-2 p-3 text-center">
      <div><div class="label">км</div><div class="font-mono text-lg">{{ num(trip.distanceKm, 1) }}</div></div>
      <div><div class="label">ср. км/ч</div><div class="font-mono text-lg">{{ num(tripAvgSpeed(trip), 0) }}</div></div>
      <div><div class="label">макс.</div><div class="font-mono text-lg">{{ num(trip.maxSpeedKmh, 0) }}</div></div>
      <div><div class="label">л/100</div><div class="font-mono text-lg">{{ num(tripConsumption(trip), 1) }}</div></div>
    </div>

    <div v-if="points.length > 1" class="card space-y-2 p-3">
      <div class="label">Точка маршрута (тапните по линии на карте или двигайте ползунок)</div>
      <input v-model.number="sliderIdx" type="range" min="0" :max="points.length - 1" class="w-full" @input="onSlide" />
      <dl v-if="picked" class="divide-y divide-night-600 text-sm">
        <div v-for="[k, v] in facts(picked)" :key="k" class="flex justify-between py-1">
          <dt class="text-[#7b8696]">{{ k }}</dt>
          <dd class="font-mono tabular-nums" :class="k === 'Check Engine' && picked.mil ? 'font-bold text-bad' : ''">{{ v }}</dd>
        </div>
        <div class="flex justify-between gap-3 py-1">
          <dt class="text-[#7b8696]">Место</dt>
          <dd class="text-right text-xs">{{ placeBusy ? 'определяю…' : place ?? placeErr ?? (picked.lat == null ? 'нет координат' : '—') }}</dd>
        </div>
      </dl>
    </div>

    <div v-if="analysis.stops.length" class="card p-3">
      <div class="label mb-2">Где стоял (от 2 минут)</div>
      <ul class="divide-y divide-night-600 text-sm">
        <li v-for="s in analysis.stops" :key="s.start" class="flex items-center justify-between gap-2 py-2" @click="flyTo(s.lat, s.lon)">
          <span class="font-mono text-xs text-[#7b8696]">{{ fmtTime(s.start) }}–{{ fmtTime(s.end) }}</span>
          <span class="mr-auto text-xs">{{ s.engineOn ? 'двигатель работал' : 'двигатель заглушен/нет данных' }}</span>
          <b class="font-mono text-warn">{{ duration(s.end - s.start) }}</b>
        </li>
      </ul>
    </div>

    <div v-if="milEvents.length || analysis.milPoints.length" class="card border-bad p-3">
      <div class="label mb-2 text-bad">Check Engine</div>
      <ul class="space-y-1 text-sm">
        <li v-for="m in analysis.milPoints" :key="m.t" class="flex items-center gap-2" @click="flyTo(m.lat, m.lon)">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center border border-bad font-mono font-bold text-bad">!</span>
          <span class="font-mono text-xs text-[#7b8696]">{{ fmtTime(m.t) }}</span>
          <span>загорелась{{ codesAt(m.t).length ? ': ' + codesAt(m.t).join(', ') : '' }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

<style>
/* Тёмная карта: инвертируем светлые тайлы OSM, маркеры и линии не трогаем. */
.trip-map .leaflet-tile-pane { filter: invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9); }
.trip-map { background: #0d1015; }
.trip-map .leaflet-control-attribution { background: rgba(13, 16, 21, 0.8); color: #7b8696; }
.trip-map .leaflet-control-attribution a { color: #7fb0e6; }
</style>
