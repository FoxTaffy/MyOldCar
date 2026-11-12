<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ points: { t: number; rpm: number; speed: number }[]; maxRpm?: number; maxT?: number }>()
const W = 600
const H = 200
const TOP = 24

const maxRpm = computed(() => props.maxRpm ?? 6500)
const maxT = computed(() => Math.max(props.maxT ?? 10000, ...props.points.map((p) => p.t), 1))
// Шкала скорости растягивается, если разгон ушёл дальше 120 км/ч.
const maxSpeed = computed(() => Math.max(120, Math.ceil(Math.max(0, ...props.points.map((p) => p.speed)) / 20) * 20))

function path(sel: (p: { rpm: number; speed: number }) => number, max: number): string {
  return props.points
    .map((p, i) => `${i ? 'L' : 'M'}${((p.t / maxT.value) * W).toFixed(1)},${(H - Math.min(1, sel(p) / max) * (H - TOP)).toFixed(1)}`)
    .join(' ')
}
const rpmPath = computed(() => path((p) => p.rpm, maxRpm.value))
const speedPath = computed(() => path((p) => p.speed, maxSpeed.value))
const y100 = computed(() => H - (100 / maxSpeed.value) * (H - TOP))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="График оборотов и скорости при разгоне">
    <g stroke="rgb(var(--line))" stroke-width="1">
      <line v-for="i in 4" :key="i" x1="0" :x2="W" :y1="TOP + ((H - TOP) / 4) * (i - 1)" :y2="TOP + ((H - TOP) / 4) * (i - 1)" />
    </g>
    <line x1="0" :x2="W" :y1="y100" :y2="y100" stroke="#5fae7a" stroke-width="1" stroke-dasharray="4 6" opacity="0.6" />
    <text :x="W - 4" :y="y100 - 4" text-anchor="end" fill="#5fae7a" font-size="11" opacity="0.8">100 км/ч</text>
    <path v-if="points.length > 1" :d="speedPath" fill="none" stroke="#5fae7a" stroke-width="2.5" stroke-linejoin="round" />
    <path v-if="points.length > 1" :d="rpmPath" fill="none" stroke="rgb(var(--accent))" stroke-width="2" stroke-linejoin="round" />
    <text v-else :x="W / 2" :y="H / 2 + 12" text-anchor="middle" fill="rgb(var(--faint))" font-size="13">график появится во время замера</text>
    <text x="4" y="14" fill="#5fae7a" font-size="12">— км/ч (до {{ maxSpeed }})</text>
    <text x="150" y="14" fill="rgb(var(--accent))" font-size="12">— об/мин (до {{ maxRpm }})</text>
    <text :x="W - 4" y="14" text-anchor="end" fill="rgb(var(--mute))" font-size="12">{{ (maxT / 1000).toFixed(0) }} с</text>
  </svg>
</template>
