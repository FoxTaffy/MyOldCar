<script setup lang="ts">
import { computed } from 'vue'
import type { Level } from '@/types'

const props = defineProps<{ label: string; value: string; unit: string; level: Level; hint?: string }>()

// Статус — цветная полоса слева и цвет цифр; остальное нейтральное.
const tone = computed(() => ({
  ok: { bar: 'bg-ok', text: 'text-ok' },
  warn: { bar: 'bg-warn', text: 'text-warn' },
  bad: { bar: 'bg-bad', text: 'text-bad' },
}[props.level]))
</script>

<template>
  <div class="card relative flex flex-col justify-between py-3 pl-5 pr-3">
    <span class="absolute inset-y-0 left-0 w-1" :class="tone.bar" />
    <div class="label">{{ label }}</div>
    <div class="my-3 text-right font-mono text-5xl font-semibold tabular-nums leading-none sm:text-6xl" :class="tone.text">{{ value }}</div>
    <div class="text-xs text-[#7b8696]">
      <div class="uppercase tracking-wider">{{ unit }}</div>
      <div v-if="hint" class="font-mono">{{ hint }}</div>
    </div>
  </div>
</template>
