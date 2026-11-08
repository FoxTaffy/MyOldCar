<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ points: { t: number; rpm: number; speed: number }[]; maxRpm?: number; maxT?: number }>()
const W = 600
const H = 200

const maxRpm = computed(() => props.maxRpm ?? 6500)
const maxT = computed(() => Math.max(props.maxT ?? 10000, ...props.points.map((p) => p.t), 1))

function path(sel: (p: { rpm: number; speed: number }) => number, max: number): string {
  return props.points
    .map((p, i) => `${i ? 'L' : 'M'}${((p.t / maxT.value) * W).toFixed(1)},${(H - (sel(p) / max) * H).toFixed(1)}`)
    .join(' ')
}
const rpmPath = computed(() => path((p) => p.rpm, maxRpm.value))
const speedPath = computed(() => path((p) => p.speed, 120))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="График оборотов и скорости">
    <g stroke="#26334d" stroke-width="1">
      <line v-for="i in 4" :key="i" x1="0" :x2="W" :y1="(H / 4) * i" :y2="(H / 4) * i" />
    </g>
    <path v-if="points.length > 1" :d="speedPath" fill="none" stroke="#5fae7a" stroke-width="2" />
    <path v-if="points.length > 1" :d="rpmPath" fill="none" stroke="#7fb0e6" stroke-width="2.5" />
    <text x="6" y="14" fill="#7fb0e6" font-size="12">об/мин (макс {{ maxRpm }})</text>
    <text x="6" y="30" fill="#5fae7a" font-size="12">км/ч (макс 120)</text>
  </svg>
</template>
