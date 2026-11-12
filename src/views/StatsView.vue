<script setup lang="ts">
import { computed, ref } from 'vue'
import Segmented from '@/components/Segmented.vue'
import TripChart from '@/components/TripChart.vue'
import DailyChart, { type DayPoint } from '@/components/DailyChart.vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { sensorLines, tripReport, tripSummaryText } from '@/services/TripSummary'
import { tripAvgSpeed, tripConsumption, type Trip } from '@/services/TripRecorder'
import { dateTime, dayKey, int, liters, num, span, time } from '@/utils/format'

const { garage, clearTrips, deleteTrip } = useGarage()
const { tripLive, tripActive, session, prefs, liveTrip } = useVehicle()
const open = ref<string | null>(null)
const copied = ref<string | null>(null)
const lineColor = { ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' } as const
const BAR = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' } as const

async function share(t: Trip): Promise<void> {
  const text = tripReport(t, garage.fuelPrice)
  try {
    if (navigator.share) await navigator.share({ title: 'Поездка', text })
    else { await navigator.clipboard.writeText(text); copied.value = t.id; setTimeout(() => { copied.value = null }, 2000) }
  } catch { /* отмена */ }
}
const period = ref<'7' | '30' | 'all'>('7')
const periods = [{ k: '7', l: '7 дней' }, { k: '30', l: '30 дней' }, { k: 'all', l: 'Всё' }] as const

/** Демо-поездки видны только в демо-режиме и в статистику реальной машины не попадают. */
const demoMode = computed(() => prefs.mode === 'mock')
const mine = computed(() => garage.trips.filter((t) => (!t.carId || t.carId === garage.activeCarId) && !!t.demo === demoMode.value))

const trips = computed<Trip[]>(() => {
  const from = period.value === 'all' ? 0 : Date.now() - Number(period.value) * 86400000
  const list = mine.value.filter((t) => t.start >= from)
  const live = tripLive.value
  if (tripActive.value && live.distanceKm >= 0.05 && session.demo === demoMode.value) {
    list.push({ ...(liveTrip() ?? {}), id: 'live', carId: garage.activeCarId, end: Date.now(), hasTrack: true, ...live })
  }
  return list.sort((a, b) => b.start - a.start)
})

function sum(list: Trip[]) {
  const t = list.reduce((a, x) => ({ km: a.km + x.distanceKm, l: a.l + x.fuelL, mv: a.mv + x.movingMs, st: a.st + x.stoppedMs, max: Math.max(a.max, x.maxSpeedKmh) }), { km: 0, l: 0, mv: 0, st: 0, max: 0 })
  // Расход считаем только по поездкам, где есть данные ДМРВ: иначе GPS-поездки занижали бы среднее.
  const fuelled = list.filter((x) => x.fuelL > 0)
  const fkm = fuelled.reduce((a, x) => a + x.distanceKm, 0)
  return { ...t, avg: t.mv ? t.km / (t.mv / 3_600_000) : null, l100: fkm >= 0.5 ? (t.l / fkm) * 100 : null, cost: t.l > 0 ? t.l * garage.fuelPrice : null }
}
const total = computed(() => sum(trips.value))

const days = computed<DayPoint[]>(() => {
  const by = new Map<string, Trip[]>()
  for (const t of trips.value) by.set(dayKey(t.start), [...(by.get(dayKey(t.start)) ?? []), t])
  return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-14).map(([k, list]) => {
    const s = sum(list)
    return { label: k.slice(8) + '.' + k.slice(5, 7), km: s.km, l100: s.l100 }
  })
})

const sourceText = { obd: 'OBD', gps: 'GPS', both: 'OBD + GPS' } as const

function askDelete(id: string): void {
  if (confirm('Удалить поездку?')) deleteTrip(id)
}

function wipe(): void {
  if (confirm('Удалить всю историю поездок этой машины? Счётчик масла не изменится.')) clearTrips(garage.activeCarId)
}
</script>

<template>
  <section class="space-y-2">
    <Segmented :options="periods.map((x) => ({ id: x.k, label: x.l }))" :model-value="period" class="flex w-full [&>button]:flex-1" @update:model-value="period = $event as typeof period" />
    <RouterLink to="/routes" class="btn-ghost block w-full text-center">Карта всех поездок: 7 дней · 30 дней · всё время</RouterLink>
    <p v-if="demoMode" class="rounded-xl bg-accent-soft p-2.5 text-center text-xs text-soft">Демо-режим: показаны симулированные поездки. В статистику машины и счётчик масла они не идут.</p>

    <div v-if="!trips.length" class="card p-4 text-sm muted">
      {{ mine.length ? 'За выбранный период поездок нет — выберите период побольше.' : 'Поездок пока нет. Запись идёт сама: по GPS и датчикам, в том числе при свёрнутом приложении.' }}
    </div>

    <template v-else>
      <div class="tiles grid-cols-2">
        <div><div class="label">Расстояние</div><div class="tile-value">{{ num(total.km, 1) }} <span class="tile-unit">км</span></div></div>
        <div><div class="label">Поездок</div><div class="tile-value">{{ trips.length }}</div></div>
        <div><div class="label">Расход</div><div class="tile-value">{{ num(total.l100, 1) }} <span class="tile-unit">л/100</span></div></div>
        <div><div class="label">Топливо</div><div class="tile-value">{{ liters(total.l) }} <span class="tile-unit">л</span></div></div>
        <div><div class="label">Стоимость</div><div class="tile-value">{{ int(total.cost) }} <span class="tile-unit">₽</span></div></div>
        <div><div class="label">Ср. / макс. км/ч</div><div class="tile-value">{{ num(total.avg, 0) }} <span class="tile-unit">/ {{ num(total.max, 0) }}</span></div></div>
        <div class="col-span-2 !p-0">
          <div class="grid grid-cols-3 gap-px bg-night-600">
            <div class="bg-night-800 p-3"><div class="label">Всего</div><div class="font-mono text-base font-semibold tabular-nums">{{ span(total.mv + total.st) }}</div></div>
            <div class="bg-night-800 p-3"><div class="label">В пути</div><div class="font-mono text-base font-semibold tabular-nums">{{ span(total.mv) }}</div></div>
            <div class="bg-night-800 p-3"><div class="label">Стоянка</div><div class="font-mono text-base font-semibold tabular-nums">{{ span(total.st) }}</div></div>
          </div>
        </div>
      </div>

      <div class="card p-3"><div class="label mb-1">Пробег и расход по дням</div><DailyChart :days="days" /></div>

      <article v-for="t in trips" :key="t.id" class="card p-3">
        <button class="block w-full text-left" @click="open = open === t.id ? null : t.id">
          <div class="mb-2 flex items-baseline justify-between gap-2">
            <span class="font-mono text-sm">{{ dateTime(t.start) }}<template v-if="t.id !== 'live'"> – {{ time(t.end) }}</template></span>
            <span v-if="t.id === 'live'" class="label text-ok">идёт</span>
            <span v-else class="font-mono text-xs muted">{{ span(t.end - t.start) }} {{ open === t.id ? '▲' : '▼' }}</span>
          </div>
          <dl class="grid grid-cols-4 gap-2 text-center">
            <div><dt class="label">км</dt><dd class="font-mono text-lg tabular-nums">{{ num(t.distanceKm, 1) }}</dd></div>
            <div><dt class="label">ср. км/ч</dt><dd class="font-mono text-lg tabular-nums">{{ num(tripAvgSpeed(t), 0) }}</dd></div>
            <div><dt class="label">л/100</dt><dd class="font-mono text-lg tabular-nums">{{ num(tripConsumption(t), 1) }}</dd></div>
            <div><dt class="label">₽</dt><dd class="font-mono text-lg tabular-nums">{{ t.fuelL > 0 ? num(t.fuelL * garage.fuelPrice, 0) : '—' }}</dd></div>
          </dl>
        </button>

        <div v-if="open === t.id" class="mt-3 space-y-3 border-t border-night-600 pt-3">
          <div class="space-y-1 text-sm leading-snug">
            <p v-for="(l, i) in tripSummaryText(t, garage.fuelPrice)" :key="i">{{ l }}</p>
          </div>

          <TripChart v-if="t.series" :series="t.series" />

          <div v-if="sensorLines(t).length">
            <div class="label mb-1">Каждый датчик</div>
            <ul class="divide-y divide-night-600">
              <li v-for="l in sensorLines(t)" :key="l.id" class="py-2">
                <div class="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span class="text-sm font-semibold" :class="lineColor[l.level]">{{ l.name }}</span>
                  <span class="font-mono text-[11px] text-mute">мин {{ num(l.min, 1) }} · ср {{ num(l.avg, 1) }} · макс {{ num(l.max, 1) }} {{ l.unit }}</span>
                </div>
                <div class="my-1 flex h-1.5 w-full overflow-hidden bg-night-600">
                  <span :class="BAR.ok" :style="{ width: l.ok * 100 + '%' }" />
                  <span :class="BAR.warn" :style="{ width: l.warn * 100 + '%' }" />
                  <span :class="BAR.bad" :style="{ width: l.bad * 100 + '%' }" />
                </div>
                <p class="text-xs text-soft">{{ l.text }}</p>
              </li>
            </ul>
          </div>

          <button class="btn-ghost w-full !py-2 !text-xs" @click="share(t)">{{ copied === t.id ? 'Скопировано' : 'Поделиться сводкой' }}</button>
        </div>

        <div class="mt-2 flex items-center gap-2">
          <span v-if="t.events?.length" class="mil h-6 w-6 !border text-sm" title="Загоралась лампа Check Engine">!</span>
          <RouterLink v-if="t.hasTrack" :to="`/trip/${t.id}`" class="btn-ghost btn-sm">Карта и данные</RouterLink>
          <span v-else class="text-xs text-faint">без трека</span>
          <span v-if="t.source" class="font-mono text-[10px] uppercase tracking-wider text-faint">{{ sourceText[t.source] }}</span>
          <button v-if="t.id !== 'live'" class="link ml-auto" @click="askDelete(t.id)">удалить</button>
        </div>
      </article>

      <button v-if="mine.length" class="btn-ghost w-full" @click="wipe">Очистить историю</button>
    </template>
  </section>
</template>
