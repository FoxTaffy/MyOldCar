<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import LineChart from '@/components/LineChart.vue'
import RingGauge from '@/components/RingGauge.vue'
import Segmented from '@/components/Segmented.vue'
import Sheet from '@/components/Sheet.vue'
import { useSensors } from '@/composables/useSensors'
import { moveItem, useUi } from '@/composables/useUi'
import { useVehicle } from '@/composables/useVehicle'
import { levelOf, type SensorDef } from '@/data/sensors'
import { num } from '@/utils/format'
import SensorsView from './SensorsView.vue'

const { values, history, pollMode, isConnected } = useVehicle()
const { visibleDefs, allDefs } = useSensors()
const { ui } = useUi()
pollMode.value = 'normal'

const tab = ref('tiles')
const tabs = [{ id: 'tiles', label: 'Мониторинг' }, { id: 'graphs', label: 'Графики' }, { id: 'all', label: 'Все датчики' }]
const edit = ref(false)
const adding = ref(false)

const defs = computed(() => ui.monitor.map((id) => allDefs.value.find((d) => d.id === id)).filter((d): d is SensorDef => !!d))
const free = computed(() => visibleDefs.value.filter((d) => !ui.monitor.includes(d.id)))
const lvl = (d: SensorDef) => (ui.zoneColors ? levelOf(d, values.value[d.id]) : 'ok')
const tone = { ok: 'text-ink', warn: 'text-warn', bad: 'text-bad' } as const

function add(id: string): void { ui.monitor.push(id); adding.value = false }
function remove(id: string): void { ui.monitor.splice(ui.monitor.indexOf(id), 1) }
const focus = ref<string | null>(null)
function open(id: string): void { focus.value = id; tab.value = 'graphs' }
const graphDefs = computed(() => (focus.value ? [...defs.value].sort((a, b) => (a.id === focus.value ? -1 : b.id === focus.value ? 1 : 0)) : defs.value))
</script>

<template>
  <section class="space-y-3">
    <div class="flex items-center gap-2">
      <Segmented :options="tabs" :model-value="tab" underline class="min-w-0 flex-1" @update:model-value="tab = $event" />
      <template v-if="tab === 'tiles'">
        <button class="flex h-10 w-10 items-center justify-center rounded-full text-accent active:bg-night-700" aria-label="Добавить датчик" @click="adding = true"><AppIcon name="plus" /></button>
        <button class="flex h-10 w-10 items-center justify-center rounded-full active:bg-night-700" :class="edit ? 'bg-accent text-accent-on' : 'text-faint'" :aria-pressed="edit" aria-label="Изменить порядок и удалить" @click="edit = !edit"><AppIcon name="edit" /></button>
      </template>
    </div>

    <p v-if="!isConnected && tab !== 'all'" class="rounded-xl bg-accent-soft px-3 py-2 text-sm text-soft">Нет связи с адаптером — значения появятся после подключения (в демо-режиме они симулируются).</p>

    <template v-if="tab === 'tiles'">
      <div class="grid grid-cols-2 gap-2.5">
        <div v-for="(d, i) in defs" :key="d.id" class="card relative">
          <component :is="edit ? 'div' : 'button'" class="flex w-full flex-col items-center px-2 pb-3 pt-3 text-center" @click="!edit && open(d.id)">
            <span class="w-full truncate text-sm font-medium text-soft">{{ d.name }}</span>
            <span class="relative my-1 block">
              <RingGauge :value="values[d.id] ?? null" :min="d.scale[0]" :max="d.scale[1]" :level="lvl(d)" :size="96" />
              <span class="absolute inset-0 flex items-center justify-center text-xl font-bold tabular-nums" :class="tone[lvl(d)]">{{ values[d.id] != null ? num(values[d.id], d.digits) : '—' }}</span>
            </span>
            <span class="text-xs text-faint">{{ d.unit }}</span>
          </component>
          <div v-if="edit" class="absolute inset-x-1 top-1 flex items-center justify-between">
            <button class="flex h-8 w-8 items-center justify-center rounded-full bg-bad text-white" :aria-label="`Убрать ${d.name}`" @click="remove(d.id)"><AppIcon name="minus" :size="18" /></button>
            <span class="flex gap-0.5">
              <button class="flex h-8 w-8 items-center justify-center rounded-full bg-night-700 text-soft disabled:opacity-30" :disabled="i === 0" aria-label="Выше" @click="moveItem(ui.monitor, i, -1)"><AppIcon name="back" :size="18" class="-rotate-90" /></button>
              <button class="flex h-8 w-8 items-center justify-center rounded-full bg-night-700 text-soft disabled:opacity-30" :disabled="i === defs.length - 1" aria-label="Ниже" @click="moveItem(ui.monitor, i, 1)"><AppIcon name="back" :size="18" class="rotate-90" /></button>
            </span>
          </div>
        </div>
        <button class="flex min-h-[10rem] flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed border-night-600 text-faint active:bg-night-700" @click="adding = true"><AppIcon name="plus" :size="30" /><span class="text-sm">Добавить датчик</span></button>
      </div>
      <p class="text-center text-xs text-faint">Нажмите на плитку, чтобы открыть график. Карандаш — изменить порядок и убрать.</p>
    </template>

    <template v-else-if="tab === 'graphs'">
      <p v-if="!defs.length" class="card p-4 text-center text-sm text-mute">Добавьте датчики на вкладке «Мониторинг».</p>
      <div v-for="d in graphDefs" :key="d.id" class="card p-3" :class="focus === d.id ? 'ring-2 ring-accent' : ''">
        <div class="mb-1 flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold">{{ d.name }}</span>
          <span class="text-sm font-bold tabular-nums" :class="tone[lvl(d)]">{{ values[d.id] != null ? num(values[d.id], d.digits) : '—' }} <span class="text-xs font-normal text-faint">{{ d.unit }}</span></span>
        </div>
        <LineChart :points="history[d.id] ?? []" :digits="d.digits" :fill="ui.graphFill" />
      </div>
      <p class="text-center text-xs text-faint">Последние 90 измерений каждого датчика.</p>
    </template>

    <SensorsView v-else />

    <Sheet v-if="adding" title="Добавить датчик" @close="adding = false">
      <p v-if="!free.length" class="p-4 text-center text-sm text-mute">Все доступные датчики уже на экране.</p>
      <div class="card overflow-hidden">
        <button v-for="d in free" :key="d.id" class="row" @click="add(d.id)">
          <span class="min-w-0"><span class="row-title">{{ d.name }}</span><span v-if="d.hint" class="row-sub">{{ d.hint }}</span></span>
          <span class="shrink-0 text-sm font-semibold tabular-nums" :class="values[d.id] != null ? 'text-accent' : 'text-faint'">{{ values[d.id] != null ? `${num(values[d.id], d.digits)} ${d.unit}` : 'нет данных' }}</span>
        </button>
      </div>
    </Sheet>
  </section>
</template>
