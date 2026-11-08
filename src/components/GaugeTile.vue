<script setup lang="ts">
import { computed } from 'vue'
import type { Level } from '@/types'

const props = defineProps<{ label: string; value: string; unit: string; level: Level; hint?: string }>()

const ring = computed(() => ({
  ok: 'border-emerald-500/60 shadow-emerald-500/20 text-emerald-400',
  warn: 'border-amber-400/70 shadow-amber-400/20 text-amber-300',
  bad: 'border-red-500/80 shadow-red-500/30 text-red-400',
}[props.level]))
</script>

<template>
  <div class="card flex flex-col justify-between border-2 p-4 shadow-lg transition-colors" :class="ring">
    <div class="text-xs font-semibold uppercase tracking-widest text-slate-400">{{ label }}</div>
    <div class="my-2 text-center font-mono text-6xl font-bold tabular-nums leading-none sm:text-7xl">{{ value }}</div>
    <div class="flex items-end justify-between text-sm text-slate-400">
      <span>{{ unit }}</span>
      <span v-if="hint" class="text-xs">{{ hint }}</span>
    </div>
  </div>
</template>
