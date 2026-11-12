<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BarChart from '@/components/BarChart.vue'
import PageHeader from '@/components/PageHeader.vue'
import Sheet from '@/components/Sheet.vue'
import { useGarage } from '@/composables/useGarage'
import { useMyTrips } from '@/composables/useMyTrips'
import { useUi } from '@/composables/useUi'
import { useVehicle } from '@/composables/useVehicle'
import { consumptionFromFills } from '@/services/Expenses'
import { Ema, fuelLitersPer100Km, fuelLitersPerHour } from '@/services/FuelCalculator'
import { dayKey, int, num } from '@/utils/format'

const { garage, car, expenses } = useGarage()
const { trips } = useMyTrips()
const { ui } = useUi()
const v = useVehicle()
v.pollMode.value = 'normal'

// Живой расход: на ходу — л/100 км, на месте — л/ч; сглаживаем, чтобы цифра не прыгала.
const emaH = new Ema(0.25)
const ema100 = new Ema(0.15)
const hour = ref<number | null>(null)
const per100 = ref<number | null>(null)
const idleH = ref<number | null>(null)
const emaIdle = new Ema(0.1)
watch(v.snapshot, (s) => {
  if (!s || s.mafGs == null) { hour.value = per100.value = null; emaH.reset(); ema100.reset(); return }
  hour.value = emaH.push(fuelLitersPerHour(s.mafGs))
  const inst = fuelLitersPer100Km(s.mafGs, s.speedKmh ?? 0)
  if (inst === null) ema100.reset()
  per100.value = inst === null ? null : ema100.push(inst)
  if ((s.speedKmh ?? 0) < 1 && (s.rpm ?? 0) > 0) idleH.value = emaIdle.push(fuelLitersPerHour(s.mafGs))
}, { immediate: true })

const month = computed(() => trips.value.filter((t) => t.start >= Date.now() - 30 * 86400000))
const sumFuel = computed(() => month.value.reduce((s, t) => s + t.fuelL, 0))
const sumKm = computed(() => month.value.reduce((s, t) => s + t.distanceKm, 0))
const avg100 = computed(() => (sumKm.value >= 1 && sumFuel.value > 0 ? (sumFuel.value / sumKm.value) * 100 : null))
const cost = computed(() => sumFuel.value * garage.fuelPrice)
const per100km = computed(() => (sumKm.value >= 1 ? cost.value / sumKm.value : null))

/** Сравнение недели с предыдущей — для «плашки» сверху. */
const trend = computed(() => {
  const week = (from: number, to: number) => { const l = trips.value.filter((t) => t.start >= Date.now() - to * 86400000 && t.start < Date.now() - from * 86400000); const km = l.reduce((s, t) => s + t.distanceKm, 0); const f = l.reduce((s, t) => s + t.fuelL, 0); return km >= 5 && f > 0 ? (f / km) * 100 : null }
  const a = week(0, 7)
  const b = week(7, 14)
  return a != null && b != null ? { a, b, better: a <= b } : null
})
const days = computed(() => Array.from({ length: 14 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() - (13 - i))
  const k = dayKey(d.getTime())
  const l = trips.value.filter((t) => dayKey(t.start) === k)
  const km = l.reduce((s, t) => s + t.distanceKm, 0)
  const f = l.reduce((s, t) => s + t.fuelL, 0)
  return { key: k, label: String(d.getDate()), value: km >= 1 && f > 0 ? Math.round((f / km) * 1000) / 10 : null }
}))
const picked = ref(days.value[days.value.length - 1].key)
const fills = computed(() => consumptionFromFills(expenses()))
const level = computed(() => v.values.value.fuellvl ?? null)

const settings = ref(false)
const FUELS = ['АИ-92', 'АИ-95', 'АИ-98', 'ДТ', 'Газ']
const bar = (x: number | null, max: number): string => (x == null ? '0%' : Math.min(100, (x / max) * 100) + '%')
void int
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Топливная эффективность">
      <template #right><button class="flex h-11 w-11 items-center justify-center rounded-full text-faint active:bg-night-700" aria-label="Настройки топлива" @click="settings = true"><AppIcon name="gear" /></button></template>
    </PageHeader>

    <p v-if="trend" class="rounded-xl px-3 py-2 text-center text-sm font-medium" :class="trend.better ? 'bg-ok/12 text-ok' : 'bg-warn/12 text-warn'">
      {{ trend.better ? 'Расход за неделю снизился' : 'Расход за неделю вырос' }}: {{ num(trend.a, 1) }} против {{ num(trend.b, 1) }} л/100 км на прошлой неделе
    </p>

    <div class="card divide-y divide-night-600">
      <div class="p-4">
        <div class="text-sm text-mute">Мгновенный расход</div>
        <div class="mt-1 text-3xl font-bold tabular-nums">{{ per100 != null ? num(per100, 1) : hour != null ? num(hour, 1) : '—' }} <span class="text-sm font-normal text-faint">{{ per100 != null ? 'л/100 км' : hour != null ? 'л/ч (на месте)' : 'л/100 км' }}</span></div>
        <div class="mt-2 h-2 overflow-hidden rounded-full bg-night-700"><div class="h-full rounded-full bg-accent transition-all" :style="{ width: bar(per100 ?? hour, 25) }" /></div>
      </div>
      <div class="grid grid-cols-2 divide-x divide-night-600">
        <div class="p-4"><div class="text-sm text-mute">Расход сейчас</div><div class="mt-1 text-2xl font-bold tabular-nums">{{ num(hour, 1) }} <span class="text-sm font-normal text-faint">л/ч</span></div></div>
        <div class="p-4"><div class="text-sm text-mute">На холостом ходу</div><div class="mt-1 text-2xl font-bold tabular-nums">{{ num(idleH, 1) }} <span class="text-sm font-normal text-faint">л/ч</span></div></div>
      </div>
    </div>

    <div class="card divide-y divide-night-600">
      <div class="grid grid-cols-2 divide-x divide-night-600">
        <div class="p-4"><div class="text-sm text-mute">Средний расход, 30 дн.</div><div class="mt-1 text-2xl font-bold tabular-nums">{{ num(avg100, 1) }} <span class="text-sm font-normal text-faint">л/100</span></div></div>
        <div class="p-4"><div class="text-sm text-mute">Израсходовано</div><div class="mt-1 text-2xl font-bold tabular-nums">{{ num(sumFuel, 1) }} <span class="text-sm font-normal text-faint">л</span></div></div>
      </div>
      <div class="grid grid-cols-2 divide-x divide-night-600">
        <div class="p-4"><div class="text-sm text-mute">Стоимость, 30 дн.</div><div class="mt-1 text-2xl font-bold tabular-nums">{{ int(cost) }} <span class="text-sm font-normal text-faint">{{ ui.currency }}</span></div><div class="text-xs text-faint">{{ per100km != null ? num(per100km, 1) + ' ' + ui.currency + '/км' : 'цена ' + num(garage.fuelPrice, 2) + ' ' + ui.currency + '/л' }}</div></div>
        <div class="p-4"><div class="text-sm text-mute">Уровень топлива</div><div class="mt-1 text-2xl font-bold tabular-nums">{{ level != null ? num(level, 0) : '—' }} <span class="text-sm font-normal text-faint">%</span></div><div class="text-xs text-faint">{{ level != null && car().tankL ? '≈ ' + num((level / 100) * car().tankL!, 0) + ' л в баке' : 'ЭБУ может не отдавать' }}</div></div>
      </div>
    </div>

    <div class="card p-4">
      <h2 class="mb-3 text-lg font-bold">Расход по дням, л/100 км</h2>
      <BarChart :items="days" :selected="picked" :fmt="(n) => num(n, 1)" @pick="picked = $event" />
    </div>

    <div v-if="fills" class="card flex items-center gap-3 p-4 text-sm">
      <AppIcon name="pump" class="shrink-0 text-accent" />
      <p class="text-soft">По заправкам из журнала реальный расход <b>{{ num(fills.l100, 1) }} л/100 км</b><template v-if="avg100">, приложение по ДМРВ считает <b>{{ num(avg100, 1) }}</b>{{ Math.abs(fills.l100 - avg100) / fills.l100 > 0.15 ? ' — расхождение больше 15 %, на старой машине это нормально (ДМРВ изнашивается)' : ' — расчёт хорошо сходится' }}</template>.</p>
    </div>
    <p class="px-2 text-center text-xs text-faint">Расход считается по расходу воздуха (ДМРВ) и стехиометрии бензина 14,7:1. Если ЭБУ не отдаёт ДМРВ — расход по OBD недоступен, но заправки в журнале всё равно дают средний расход.</p>

    <Sheet v-if="settings" title="Настройки топлива" @close="settings = false">
      <div class="card overflow-hidden">
        <label class="row"><span class="row-title">Цена за литр, {{ ui.currency }}</span><input v-model.number="garage.fuelPrice" type="number" min="0" step="0.5" inputmode="decimal" class="w-24 bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
        <label class="row"><span class="row-title">Тип топлива</span><select v-model="car().fuel" class="bg-transparent text-right text-sm font-medium text-accent outline-none"><option value="">—</option><option v-for="f in FUELS" :key="f">{{ f }}</option></select></label>
        <label class="row"><span class="row-title">Объём бака, л</span><input v-model.number="car().tankL" type="number" min="0" inputmode="numeric" class="w-24 bg-transparent text-right text-sm font-medium text-accent outline-none" placeholder="—"></label>
        <label class="row"><span class="row-title">Валюта</span><input v-model="ui.currency" maxlength="4" class="w-16 bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
      </div>
      <template #footer><button class="btn w-full" @click="settings = false">Готово</button></template>
    </Sheet>
  </section>
</template>
