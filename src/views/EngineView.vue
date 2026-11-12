<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BarChart from '@/components/BarChart.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useMyTrips } from '@/composables/useMyTrips'
import { useVehicle } from '@/composables/useVehicle'
import { BUILTIN_SENSORS, levelOf } from '@/data/sensors'
import { dayKey, num } from '@/utils/format'

const v = useVehicle()
const { trips } = useMyTrips()
v.pollMode.value = 'normal'

const CELLS = ['coolant', 'map', 'intake', 'rpm', 'load', 'stft', 'ltft', 'maf']
const defs = CELLS.map((id) => BUILTIN_SENSORS.find((d) => d.id === id)!).filter(Boolean)
const TONE = { ok: 'text-accent', warn: 'text-warn', bad: 'text-bad' } as const
const cur = ref('coolant')
const curDef = computed(() => defs.find((d) => d.id === cur.value)!)

const MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
const from = new Date(Date.now() - 6 * 86400000)
const period = `${from.getDate()} ${MONTHS[from.getMonth()]} – ${new Date().getDate()} ${MONTHS[new Date().getMonth()]}`

/** Среднее значение датчика по дням за неделю (по статистике поездок). */
const bars = computed(() => Array.from({ length: 7 }, (_, i) => {
  const d = new Date(); d.setDate(d.getDate() - (6 - i))
  const k = dayKey(d.getTime())
  let sum = 0
  let n = 0
  for (const t of trips.value) {
    const a = t.sensors?.[cur.value]
    if (a && a.n && dayKey(t.start) === k) { sum += a.sum; n += a.n }
  }
  return { key: k, label: String(d.getDate()), value: n ? Math.round((sum / n) * 100) / 100 : null }
}))
const hasData = computed(() => bars.value.some((b) => b.value != null))
// Столбики умеют только положительные значения: для коррекций (±) показываем модуль со знаком в подписи.
const shown = computed(() => bars.value.map((b) => ({ ...b, value: b.value == null ? null : Math.abs(b.value) })))
const picked = ref(bars.value[6].key)
const pickedVal = computed(() => bars.value.find((b) => b.key === picked.value)?.value ?? null)
const ecu = computed(() => v.ecuStatus.value)
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Диагностика двигателя" />
    <span class="inline-block rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-accent-on">{{ period }}</span>

    <div class="card flex items-center justify-center bg-gradient-to-b from-accent-soft to-transparent py-5 text-accent"><AppIcon name="engine" :size="120" /></div>

    <div class="card p-3">
      <div class="grid grid-cols-4 gap-y-4">
        <button v-for="d in defs" :key="d.id" class="min-w-0 px-1 text-center" :class="cur === d.id ? 'rounded-xl bg-accent-soft' : ''" @click="cur = d.id">
          <div class="py-1 text-lg font-bold tabular-nums" :class="v.values.value[d.id] != null ? TONE[levelOf(d, v.values.value[d.id])] : 'text-faint'">{{ v.values.value[d.id] != null ? num(v.values.value[d.id], d.digits) : '—' }}<span class="ml-0.5 text-[10px] font-normal text-faint">{{ d.unit }}</span></div>
          <div class="pb-1 text-[11px] leading-tight text-mute">{{ d.name }}</div>
        </button>
      </div>
    </div>

    <div class="card p-4">
      <div class="mb-1 flex items-baseline justify-between"><h2 class="text-base font-bold">{{ curDef.name }}</h2><span class="text-sm tabular-nums text-mute">{{ pickedVal != null ? num(pickedVal, curDef.digits) + ' ' + curDef.unit : '' }}</span></div>
      <BarChart v-if="hasData" :items="shown" :selected="picked" :fmt="(n) => num(n, curDef.digits)" @pick="picked = $event" />
      <p v-else class="py-8 text-center text-sm text-mute">За неделю нет записанных поездок с этим датчиком. Среднее по дням появится, когда приложение запишет поездки при подключённом сканере.</p>
      <p v-if="hasData" class="mt-1 text-center text-xs text-faint">Среднее за день по записанным поездкам{{ cur === 'stft' || cur === 'ltft' ? ' (модуль значения)' : '' }}.</p>
    </div>

    <div v-if="ecu" class="card divide-y divide-night-600">
      <div class="row"><span class="row-title">Лампа Check Engine</span><span class="text-sm font-bold" :class="ecu.mil ? 'text-bad' : 'text-ok'">{{ ecu.mil ? 'горит' : 'выключена' }}</span></div>
      <div class="row"><span class="row-title">Кодов неисправностей</span><span class="text-sm font-bold" :class="ecu.dtcCount ? 'text-bad' : 'text-ok'">{{ ecu.dtcCount }}</span></div>
      <div class="row"><span class="row-title">Тесты готовности</span><span class="text-sm font-bold text-soft">{{ ecu.monitors.filter((m) => m.supported && m.complete).length }} из {{ ecu.monitors.filter((m) => m.supported).length }}</span></div>
    </div>
  </section>
</template>
