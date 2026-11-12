<script setup lang="ts">
import { computed } from 'vue'

/** Линия значений с сеткой и подписями по оси Y. Масштаб — по видимым данным (с запасом). */
const props = defineProps<{ points: number[]; digits?: number; fill?: boolean; height?: number; min?: number; max?: number; color?: string }>()
const W = 320
const L = 34
const H = computed(() => props.height ?? 110)
const range = computed(() => {
  const real = props.points.filter((v) => Number.isFinite(v))
  if (!real.length) return [0, 1] as const
  let lo = props.min ?? Math.min(...real)
  let hi = props.max ?? Math.max(...real)
  if (hi - lo < 1e-6) { lo -= 1; hi += 1 }
  const pad = props.min == null && props.max == null ? (hi - lo) * 0.12 : 0
  return [lo - pad, hi + pad] as const
})
const x = (i: number) => L + (i / Math.max(1, props.points.length - 1)) * (W - L - 4)
const y = (v: number) => 6 + (1 - (v - range.value[0]) / (range.value[1] - range.value[0])) * (H.value - 12)
const d = computed(() => props.points.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(''))
const area = computed(() => (props.points.length > 1 ? `${d.value}L${x(props.points.length - 1).toFixed(1)},${H.value - 6}L${L},${H.value - 6}Z` : ''))
const ticks = computed(() => [0, 0.5, 1].map((f) => range.value[0] + (range.value[1] - range.value[0]) * f))
const fmt = (n: number) => (Math.abs(n) >= 100 || (props.digits ?? 0) === 0 ? Math.round(n).toString() : n.toFixed(1))
const stroke = computed(() => props.color ?? 'rgb(var(--accent))')
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="График">
    <g v-for="t in ticks" :key="t">
      <line :x1="L" :x2="W - 4" :y1="y(t)" :y2="y(t)" stroke="rgb(var(--line))" stroke-width="1" />
      <text :x="L - 5" :y="y(t) + 3.5" text-anchor="end" font-size="10" fill="rgb(var(--faint))">{{ fmt(t) }}</text>
    </g>
    <path v-if="fill && area" :d="area" :fill="stroke" opacity="0.14" />
    <path v-if="points.length > 1" :d="d" fill="none" :stroke="stroke" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
    <text v-else :x="W / 2" :y="H / 2" text-anchor="middle" font-size="12" fill="rgb(var(--faint))">нет данных</text>
  </svg>
</template>
