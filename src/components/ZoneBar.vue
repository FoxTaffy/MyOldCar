<script setup lang="ts">
import { computed } from 'vue'
import { levelOf, type SensorDef } from '@/data/sensors'
import type { Level } from '@/types'

const props = defineProps<{ def: SensorDef; value: number | null | undefined }>()
const STEPS = 60
const FILL: Record<Level, string> = { ok: '#5fae7a', warn: '#d6a23f', bad: '#d9594c' }

/** Зоны шкалы: семплируем levelOf по шкале и склеиваем соседние одинаковые куски. */
const segs = computed(() => {
  const [a, b] = props.def.scale
  const out: { x: number; w: number; level: Level }[] = []
  for (let i = 0; i < STEPS; i++) {
    const level = props.def.ok ? levelOf(props.def, a + ((i + 0.5) / STEPS) * (b - a)) : 'ok'
    const last = out[out.length - 1]
    if (last && last.level === level) last.w += 100 / STEPS
    else out.push({ x: (i * 100) / STEPS, w: 100 / STEPS, level })
  }
  return out
})
const pos = computed(() => {
  if (props.value == null || Number.isNaN(props.value)) return null
  const [a, b] = props.def.scale
  return Math.min(100, Math.max(0, ((props.value - a) / (b - a)) * 100))
})
</script>

<template>
  <svg viewBox="0 0 100 8" preserveAspectRatio="none" class="h-2 w-full" role="presentation">
    <rect v-for="s in segs" :key="s.x" :x="s.x" y="2" :width="s.w" height="4" :fill="FILL[s.level]" opacity="0.35" />
    <rect v-if="pos != null" :x="Math.min(98.6, Math.max(0, pos - 0.7))" y="0" width="1.4" height="8" fill="#e8ecf2" />
  </svg>
</template>
