<script setup lang="ts">
import { computed, ref } from 'vue'
import TripChart from '@/components/TripChart.vue'
import DailyChart, { type DayPoint } from '@/components/DailyChart.vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { sensorLines, tripReport, tripSummaryText } from '@/services/TripSummary'
import { tripAvgSpeed, tripConsumption, type Trip } from '@/services/TripRecorder'
import { dateTime, dayKey, duration, num } from '@/utils/format'

const { garage, clearTrips } = useGarage()
const { tripLive, isConnected, liveTrip } = useVehicle()
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

const trips = computed<Trip[]>(() => {
  const from = period.value === 'all' ? 0 : Date.now() - Number(period.value) * 86400000
  const list = garage.trips.filter((t) => t.start >= from)
  const live = tripLive.value
  if (isConnected.value && live.distanceKm >= 0.05) {
    list.push({ ...(liveTrip() ?? {}), id: 'live', start: Date.now() - live.movingMs - live.stoppedMs, end: Date.now(), ...live })
  }
  return list.sort((a, b) => b.start - a.start)
})

function sum(list: Trip[]) {
  const t = list.reduce((a, x) => ({ km: a.km + x.distanceKm, l: a.l + x.fuelL, mv: a.mv + x.movingMs, st: a.st + x.stoppedMs }), { km: 0, l: 0, mv: 0, st: 0 })
  return { ...t, avg: t.mv ? t.km / (t.mv / 3_600_000) : 0, l100: t.km >= 0.5 ? (t.l / t.km) * 100 : null, cost: t.l * garage.fuelPrice }
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

function wipe(): void {
  if (confirm('Удалить всю историю поездок? Счётчик масла не изменится.')) clearTrips()
}
</script>

<template>
  <section class="space-y-2">
    <div class="grid grid-cols-3 border border-night-600">
      <button v-for="p in periods" :key="p.k" class="py-2 text-xs font-semibold uppercase tracking-wider" :class="period === p.k ? 'bg-accent text-night-950' : 'text-[#7b8696]'" @click="period = p.k">{{ p.l }}</button>
    </div>

    <div v-if="!trips.length" class="card p-4 text-sm text-[#7b8696]">Поездок пока нет. Запись идёт сама, пока приложение подключено к адаптеру.</div>

    <template v-else>
      <div class="card grid grid-cols-2 gap-px bg-night-600 p-0">
        <div class="bg-night-800 p-3"><div class="label">Расстояние</div><div class="font-mono text-2xl font-semibold">{{ num(total.km, 1) }} <span class="text-xs text-[#7b8696]">км</span></div></div>
        <div class="bg-night-800 p-3"><div class="label">Ср. скорость</div><div class="font-mono text-2xl font-semibold">{{ num(total.avg, 1) }} <span class="text-xs text-[#7b8696]">км/ч</span></div></div>
        <div class="bg-night-800 p-3"><div class="label">Топливо</div><div class="font-mono text-2xl font-semibold">{{ num(total.l, 1) }} <span class="text-xs text-[#7b8696]">л</span></div></div>
        <div class="bg-night-800 p-3"><div class="label">Расход</div><div class="font-mono text-2xl font-semibold">{{ num(total.l100, 1) }} <span class="text-xs text-[#7b8696]">л/100</span></div></div>
        <div class="bg-night-800 p-3"><div class="label">Стоимость</div><div class="font-mono text-2xl font-semibold">{{ num(total.cost, 0) }} <span class="text-xs text-[#7b8696]">₽</span></div></div>
        <div class="col-span-2 grid grid-cols-3 gap-px bg-night-600">
          <div class="bg-night-800 p-3"><div class="label">Всего</div><div class="font-mono text-lg font-semibold">{{ duration(total.mv + total.st) }}</div></div>
          <div class="bg-night-800 p-3"><div class="label">В пути</div><div class="font-mono text-lg font-semibold">{{ duration(total.mv) }}</div></div>
          <div class="bg-night-800 p-3"><div class="label">Стоянка</div><div class="font-mono text-lg font-semibold">{{ duration(total.st) }}</div></div>
        </div>
      </div>

      <div class="card p-3"><div class="label mb-1">Пробег и расход по дням</div><DailyChart :days="days" /></div>

      <article v-for="t in trips" :key="t.id" class="card p-3">
        <button class="block w-full text-left" @click="open = open === t.id ? null : t.id">
          <div class="mb-2 flex items-baseline justify-between">
            <span class="font-mono text-sm">{{ dateTime(t.start) }}</span>
            <span v-if="t.id === 'live'" class="label text-ok">идёт</span>
            <span v-else class="font-mono text-xs text-[#7b8696]">{{ duration(t.end - t.start) }} {{ open === t.id ? '▲' : '▼' }}</span>
          </div>
          <dl class="grid grid-cols-4 gap-2 text-center">
            <div><dt class="label">км</dt><dd class="font-mono text-lg">{{ num(t.distanceKm, 1) }}</dd></div>
            <div><dt class="label">км/ч</dt><dd class="font-mono text-lg">{{ num(tripAvgSpeed(t), 0) }}</dd></div>
            <div><dt class="label">л/100</dt><dd class="font-mono text-lg">{{ num(tripConsumption(t), 1) }}</dd></div>
            <div><dt class="label">₽</dt><dd class="font-mono text-lg">{{ num(t.fuelL * garage.fuelPrice, 0) }}</dd></div>
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
                  <span class="font-mono text-[11px] text-[#7b8696]">мин {{ num(l.min, 1) }} · ср {{ num(l.avg, 1) }} · макс {{ num(l.max, 1) }} {{ l.unit }}</span>
                </div>
                <div class="my-1 flex h-1.5 w-full overflow-hidden bg-night-600">
                  <span :class="BAR.ok" :style="{ width: l.ok * 100 + '%' }" />
                  <span :class="BAR.warn" :style="{ width: l.warn * 100 + '%' }" />
                  <span :class="BAR.bad" :style="{ width: l.bad * 100 + '%' }" />
                </div>
                <p class="text-xs text-[#aab3c0]">{{ l.text }}</p>
              </li>
            </ul>
          </div>

          <button class="btn-ghost w-full !py-2 !text-xs" @click="share(t)">{{ copied === t.id ? 'Скопировано' : 'Поделиться сводкой' }}</button>
        </div>
      </article>

      <button class="btn-ghost w-full" @click="wipe">Очистить историю</button>
    </template>
  </section>
</template>
