<script setup lang="ts">
import { computed } from 'vue'
import type { Level } from '@/types'

const props = defineProps<{ label: string; value: string; unit: string; level: Level; hint?: string }>()
const tone = computed(() => ({
  ok: { dot: 'bg-ok', text: 'text-ink' },
  warn: { dot: 'bg-warn', text: 'text-warn' },
  bad: { dot: 'bg-bad', text: 'text-bad' },
}[props.level]))
</script>

<template>
  <div class="card flex flex-col items-center px-3 py-4 text-center">
    <div class="flex items-center gap-2 text-sm font-medium text-soft"><span class="lamp" :class="tone.dot" />{{ label }}</div>
    <div class="my-3 text-6xl font-semibold leading-none tabular-nums" :class="tone.text">{{ value }}</div>
    <div class="text-xs text-faint">{{ unit }}</div>
    <div v-if="hint" class="mt-1 text-xs font-semibold text-warn">{{ hint }}</div>
  </div>
</template>
