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
import { dateTime, duration, num, span } from '@/utils/format'

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
/** Живая поездка: карта следует за машиной, пока пользователь сам её не сдвинул. */
const follow = ref(isLive)

let map: L.Map | null = null
let layer: L.LayerGroup | null = null
let cursor: L.CircleMarker | null = null
let timer: ReturnType<typeof setInterval> | null = null
let placeTimer: ReturnType<typeof setTimeout> | null = null
let placeToken = 0
let fitted = false

function refresh(): void {
  if (isLive) {
    points.value = [...session.points]
    trip.value = session.trip ? { ...session.trip } : null
  } else {
    trip.value = garage.trips.find((t) => t.id === route.params.id) ?? null
    points.value = trip.value ? loadTrack(String(route.params.id)) : []
  }
}

const analysis = computed(() => analyzeTrack(points.value))
const hasRoute = computed(() => analysis.value.route.length >= 2)
const milEvents = computed(() => trip.value?.events ?? [])
const codesAt = (t: number): string[] => milEvents.value.find((e) => Math.abs(e.t - t) < 15000)?.codes ?? []
const emptyText = computed(() => {
  if (isLive) return tripActive.value ? 'Жду координаты GPS — маршрут появится, как только поймаются спутники.' : 'Сейчас поездка не записывается.'
  if (!trip.value) return 'Поездка не найдена — возможно, она удалена.'
  return 'У этой поездки нет GPS-трека: включите «Записывать поездки в фоне» и разрешите доступ к геопозиции.'
})

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
  // В окне — только то, что есть: пустые строки (GPS-поездка без OBD) не показываем.
  const rows = facts(p).filter(([, v]) => v !== '—').map(([k, v]) => `<tr><td style="color:#7b8696;padding-right:10px">${esc(k)}</td><td style="font-family:ui-monospace,monospace;text-align:right">${esc(v)}</td></tr>`).join('')
  return `<div style="min-width:190px;color:#12161d">${title ? `<b>${esc(title)}</b>` : ''}<table style="font-size:12px;width:100%">${rows}</table><div class="place" style="margin-top:6px;font-size:12px;color:#4a5260">определяю место…</div></div>`
}

/** Показ точки: подсветка на карте, данные под картой, адрес. */
function pick(p: TrackPoint, pan = false): void {
  picked.value = p
  sliderIdx.value = Math.max(0, points.value.indexOf(p))
  if (map && p.lat != null && p.lon != null) {
    cursor?.remove()
    cursor = L.circleMarker([p.lat, p.lon], { radius: 9, color: '#fff', weight: 3, fillColor: '#4a86c8', fillOpacity: 1 }).addTo(map)
    if (pan) map.panTo([p.lat, p.lon])
  }
  loadPlace(p)
}

/**
 * Адрес точки. Запрос уходит с задержкой и только для последней выбранной точки:
 * пока тянут ползунок, геокодер не дёргаем (у Nominatim лимит — один запрос в секунду).
 */
function loadPlace(p: TrackPoint): void {
  const token = ++placeToken
  if (placeTimer) clearTimeout(placeTimer)
  place.value = null
  placeErr.value = null
  placeBusy.value = p.lat != null && p.lon != null
  if (p.lat == null || p.lon == null) return
  const { lat, lon } = p
  placeTimer = setTimeout(async () => {
    try {
      const text = await placeName(lat, lon)
      if (token === placeToken) place.value = text
    } catch {
      if (token === placeToken) placeErr.value = 'адрес недоступен (нет интернета)'
    } finally {
      if (token === placeToken) placeBusy.value = false
    }
  }, 700)
}

function marker(p: { lat: number | null; lon: number | null }, html: string, size: number, onClick?: () => void): void {
  if (!map || !layer || p.lat == null || p.lon == null) return
  const m = L.marker([p.lat, p.lon], { icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: 500 })
  if (onClick) m.on('click', onClick)
  m.addTo(layer)
}

const badge = (bg: string, text: string, border = '#0d1015'): string =>
  `<div style="width:26px;height:26px;border-radius:50%;background:${bg};border:2px solid ${border};color:#fff;font:700 14px/22px system-ui;text-align:center">${text}</div>`

/** Всплывающее окно у точки; адрес дописывается, когда придёт (и только если окно всё ещё открыто на этой точке). */
function openPopup(p: TrackPoint, title?: string): void {
  if (!map || p.lat == null || p.lon == null) return
  const popup = L.popup({ maxWidth: 260 }).setLatLng([p.lat, p.lon]).setContent(popupHtml(p, title)).openOn(map)
  placeName(p.lat, p.lon)
    .then((text) => `Место: ${text}`, () => 'адрес недоступен (нет интернета)')
    .then((text) => { const el = popup.getElement()?.querySelector('.place'); if (el) el.textContent = text })
}

function draw(): void {
  if (!map) return
  layer?.remove()
  layer = L.layerGroup().addTo(map)
  const r = analysis.value.route
  if (r.length < 2) return
  const canvas = L.canvas({ padding: 0.3, tolerance: 8 })
  for (let i = 1; i < r.length; i++) {
    const a = r[i - 1]
    const b = r[i]
    L.polyline([[a.lat as number, a.lon as number], [b.lat as number, b.lon as number]], { color: speedColor(b.spd), weight: 6, opacity: 0.95, renderer: canvas })
      .on('click', (e: L.LeafletMouseEvent) => {
        const p = nearestPoint(r, e.latlng.lat, e.latlng.lng) ?? b
        pick(p)
        openPopup(p)
      })
      .addTo(layer)
  }
  const first = r[0]
  const last = r[r.length - 1]
  marker(first, badge('#5fae7a', 'A'), 26, () => pick(first))
  if (!isLive) marker(last, badge('#4a86c8', 'B'), 26, () => pick(last))
  for (const s of analysis.value.stops) {
    marker(s, `<div style="padding:2px 6px;border-radius:3px;background:#12161d;border:1px solid #d6a23f;color:#d6a23f;font:600 11px system-ui;white-space:nowrap;width:max-content;transform:translate(-50%,-50%)">P ${span(s.end - s.start)}</div>`, 1, () => {
      pick(points.value.find((x) => x.t >= s.start) ?? first)
    })
  }
  for (const m of analysis.value.milPoints) {
    marker(m, badge('#d9594c', '!', '#fff'), 30, () => {
      pick(m)
      openPopup(m, 'Загорелась лампа Check Engine')
    })
  }
  if (!fitted) {
    // Маршрут появился (или карта только открылась) — показываем его целиком один раз.
    fitted = true
    fit()
  } else if (isLive && follow.value) {
    map.panTo([last.lat as number, last.lon as number])
  }
}

function fit(): void {
  const r = analysis.value.route
  if (!map || r.length < 1) return
  map.fitBounds(L.latLngBounds(r.map((p) => [p.lat as number, p.lon as number] as [number, number])), { padding: [24, 24], maxZoom: 17 })
}

function showAll(): void {
  follow.value = false
  fit()
}

function resumeFollow(): void {
  follow.value = true
  const last = analysis.value.route[analysis.value.route.length - 1]
  if (map && last) map.setView([last.lat as number, last.lon as number], Math.max(map.getZoom(), 15))
}

function flyTo(lat: number | null, lon: number | null): void {
  if (!map || lat == null || lon == null) return
  follow.value = false
  map.setView([lat, lon], Math.max(map.getZoom(), 16))
  mapEl.value?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

function onSlide(): void {
  const p = points.value[sliderIdx.value]
  if (!p) return
  follow.value = false
  pick(p, true)
}

onMounted(async () => {
  refresh()
  await nextTick()
  if (!mapEl.value) return
  map = L.map(mapEl.value, { zoomControl: true, attributionControl: true }).setView([55.75, 37.62], 11)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
  // Пользователь сам сдвинул карту — перестаём возвращать её к машине.
  map.on('dragstart', () => { follow.value = false })
  draw()
  if (isLive) timer = setInterval(() => { refresh(); draw() }, 3000)
})
onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
  if (placeTimer) clearTimeout(placeTimer)
  placeToken++
  map?.remove()
  map = null
})

const legend = [0, 30, 60, 90, 120]
const cost = computed(() => (trip.value && trip.value.fuelL > 0 ? trip.value.fuelL * garage.fuelPrice : null))
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-2">
      <RouterLink to="/stats" class="btn-ghost btn-sm">← Поездки</RouterLink>
      <div class="truncate font-mono text-sm">{{ trip ? dateTime(trip.start) : isLive ? 'Текущая поездка' : '—' }}</div>
      <span v-if="isLive" class="label ml-auto shrink-0" :class="tripActive ? 'text-ok' : ''">{{ tripActive ? 'идёт запись' : 'не идёт' }}</span>
    </div>

    <div class="relative">
      <div ref="mapEl" class="trip-map h-[52vh] w-full border border-night-600" />
      <p v-if="!hasRoute" class="absolute inset-x-3 top-3 z-[500] border border-night-600 bg-night-900 p-3 text-sm muted">{{ emptyText }}</p>
    </div>

    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] muted">
      <span>км/ч:</span>
      <span v-for="v in legend" :key="v" class="flex items-center gap-1"><i class="inline-block h-2 w-4" :style="{ background: speedColor(v) }" />{{ v }}{{ v === 120 ? '+' : '' }}</span>
      <span class="ml-auto flex gap-2">
        <button v-if="isLive && hasRoute && !follow" class="btn-ghost btn-sm !py-1 !text-[10px]" @click="resumeFollow">Следить</button>
        <button v-if="hasRoute" class="btn-ghost btn-sm !py-1 !text-[10px]" @click="showAll">Весь маршрут</button>
      </span>
    </div>

    <div v-if="trip" class="tiles grid-cols-4 text-center">
      <div><div class="label">км</div><div class="font-mono text-lg tabular-nums">{{ num(trip.distanceKm, 1) }}</div></div>
      <div><div class="label">ср. км/ч</div><div class="font-mono text-lg tabular-nums">{{ num(tripAvgSpeed(trip), 0) }}</div></div>
      <div><div class="label">макс.</div><div class="font-mono text-lg tabular-nums">{{ num(trip.maxSpeedKmh, 0) }}</div></div>
      <div><div class="label">л/100</div><div class="font-mono text-lg tabular-nums">{{ num(tripConsumption(trip), 1) }}</div></div>
      <div><div class="label">в пути</div><div class="font-mono text-lg tabular-nums">{{ duration(trip.movingMs) }}</div></div>
      <div><div class="label">стоянка</div><div class="font-mono text-lg tabular-nums">{{ duration(trip.stoppedMs) }}</div></div>
      <div><div class="label">топливо, л</div><div class="font-mono text-lg tabular-nums">{{ trip.fuelL > 0 ? num(trip.fuelL, 1) : '—' }}</div></div>
      <div><div class="label">₽</div><div class="font-mono text-lg tabular-nums">{{ num(cost, 0) }}</div></div>
    </div>

    <div v-if="points.length > 1" class="card space-y-2 p-3">
      <div class="label">Точка маршрута</div>
      <input v-model.number="sliderIdx" type="range" min="0" :max="points.length - 1" class="w-full" aria-label="Положение на маршруте" @input="onSlide" />
      <dl v-if="picked" class="rows">
        <div v-for="[k, v] in facts(picked)" :key="k">
          <dt>{{ k }}</dt>
          <dd :class="k === 'Check Engine' && picked.mil ? 'font-bold text-bad' : ''">{{ v }}</dd>
        </div>
        <div>
          <dt>Место</dt>
          <dd class="!font-sans text-xs">{{ picked.lat == null ? 'нет координат' : placeBusy ? 'определяю…' : place ?? placeErr ?? '—' }}</dd>
        </div>
      </dl>
      <p v-else class="text-xs muted">Двигайте ползунок или нажмите на линию маршрута — покажу скорость, обороты, расход и адрес в этой точке.</p>
    </div>

    <div v-if="analysis.stops.length" class="card p-3">
      <div class="label mb-1">Остановки от 2 минут</div>
      <ul class="divide-y divide-night-600 text-sm">
        <li v-for="s in analysis.stops" :key="s.start">
          <button class="flex w-full items-center justify-between gap-2 py-2 text-left" @click="flyTo(s.lat, s.lon)">
            <span class="font-mono text-xs muted">{{ fmtTime(s.start) }}–{{ fmtTime(s.end) }}</span>
            <span class="mr-auto text-xs">{{ s.engineOn ? 'двигатель работал' : 'двигатель заглушен или нет данных' }}</span>
            <b class="font-mono text-warn">{{ span(s.end - s.start) }}</b>
          </button>
        </li>
      </ul>
    </div>

    <div v-if="analysis.milPoints.length" class="card !border-bad p-3">
      <div class="label mb-1 !text-bad">Check Engine</div>
      <ul class="text-sm">
        <li v-for="m in analysis.milPoints" :key="m.t">
          <button class="flex w-full items-center gap-2 py-1 text-left" @click="flyTo(m.lat, m.lon)">
            <span class="mil h-6 w-6 !border">!</span>
            <span class="font-mono text-xs muted">{{ fmtTime(m.t) }}</span>
            <span>{{ m === points[0] ? 'горела с начала поездки' : 'загорелась' }}{{ codesAt(m.t).length ? ': ' + codesAt(m.t).join(', ') : '' }}</span>
          </button>
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
.trip-map .leaflet-bar a { background: #12161d; color: #d5dae2; border-color: #262e3b; }
.trip-map .leaflet-bar a:hover { background: #1a202a; }
</style>
