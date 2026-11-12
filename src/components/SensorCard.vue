<script setup lang="ts">
import { computed } from 'vue'
import Sparkline from '@/components/Sparkline.vue'
import ZoneBar from '@/components/ZoneBar.vue'
import { levelOf, type SensorDef } from '@/data/sensors'
import { num } from '@/utils/format'

const props = defineProps<{ def: SensorDef; value: number | null | undefined; history?: number[] }>()
const level = computed(() => levelOf(props.def, props.value))
const tone = computed(() => ({
  ok: { bar: 'bg-ok', text: 'text-ok', label: 'норма' },
  warn: { bar: 'bg-warn', text: 'text-warn', label: 'внимание' },
  bad: { bar: 'bg-bad', text: 'text-bad', label: 'вне нормы' },
}[level.value]))
const color = computed(() => ({ ok: '#5fae7a', warn: '#d6a23f', bad: '#d9594c' }[level.value]))
const has = computed(() => props.value != null && !Number.isNaN(props.value))
</script>

<template>
  <div class="card relative flex flex-col gap-1.5 py-2.5 pl-4 pr-3" :class="has ? '' : 'opacity-60'">
    <span class="absolute inset-y-0 left-0 w-1" :class="has && def.ok ? tone.bar : 'bg-night-600'" />
    <div class="flex items-baseline justify-between gap-2">
      <span class="label truncate">{{ def.name }}<span v-if="def.custom" class="ml-1 text-accent">·импорт</span></span>
      <span v-if="has && def.ok" class="font-mono text-[10px] uppercase" :class="tone.text">{{ tone.label }}</span>
    </div>
    <div class="flex items-baseline justify-end gap-1.5">
      <span class="font-mono text-3xl font-semibold tabular-nums leading-none" :class="has && def.ok ? tone.text : 'text-[#d5dae2]'">{{ has ? num(value, def.digits) : '—' }}</span>
      <span class="text-xs text-[#7b8696]">{{ def.unit }}</span>
    </div>
    <ZoneBar :def="def" :value="value" />
    <Sparkline v-if="history && history.length > 1" :points="history" :scale="def.scale" :color="color" />
    <p v-if="def.hint" class="text-[11px] leading-tight text-[#7b8696]">{{ def.hint }}</p>
  </div>
</template>
