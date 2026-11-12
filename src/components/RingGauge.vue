<script setup lang="ts">
import { computed } from 'vue'
import type { Level } from '@/types'

/** Круговой индикатор (как плитки Infocar): дуга 270°, значение в центре. */
const props = defineProps<{ value: number | null; min: number; max: number; level?: Level; size?: number }>()
const R = 38
const C = 2 * Math.PI * R
const ARC = C * 0.75
const frac = computed(() => (props.value == null || !Number.isFinite(props.value) ? 0 : Math.min(1, Math.max(0, (props.value - props.min) / (props.max - props.min || 1)))))
const color = computed(() => ({ ok: 'rgb(var(--accent))', warn: 'rgb(var(--warn))', bad: 'rgb(var(--bad))' }[props.level ?? 'ok']))
</script>

<template>
  <svg viewBox="0 0 100 100" :width="size ?? 84" :height="size ?? 84" aria-hidden="true">
    <g transform="rotate(135 50 50)" fill="none" stroke-linecap="round" stroke-width="9">
      <circle cx="50" cy="50" :r="R" stroke="rgb(var(--raised))" :stroke-dasharray="`${ARC} ${C}`" />
      <circle v-if="frac > 0.004" cx="50" cy="50" :r="R" :stroke="color" :stroke-dasharray="`${ARC * frac} ${C}`" style="transition: stroke-dasharray 0.4s ease" />
    </g>
    <slot />
  </svg>
</template>
