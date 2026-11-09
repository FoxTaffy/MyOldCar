<script setup lang="ts">
import { computed } from 'vue'

export interface DayPoint { label: string; km: number; l100: number | null }
const props = defineProps<{ days: DayPoint[] }>()

const W = 600
const H = 170
const PAD = 22
const maxKm = computed(() => Math.max(10, ...props.days.map((d) => d.km)) * 1.15)
const cons = computed(() => props.days.map((d) => d.l100).filter((v): v is number => v != null))
const cMin = computed(() => (cons.value.length ? Math.min(...cons.value) - 0.5 : 0))
const cMax = computed(() => (cons.value.length ? Math.max(...cons.value) + 0.5 : 1))
const slot = computed(() => (W - PAD * 2) / Math.max(1, props.days.length))
const x = (i: number) => PAD + slot.value * i + slot.value / 2
const yKm = (v: number) => H - PAD - (v / maxKm.value) * (H - PAD * 2)
const yC = (v: number) => H - PAD - ((v - cMin.value) / (cMax.value - cMin.value || 1)) * (H - PAD * 2)
const line = computed(() =>
  props.days.map((d, i) => (d.l100 == null ? null : `${x(i).toFixed(1)},${yC(d.l100).toFixed(1)}`)).filter(Boolean).join(' '),
)
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="Пробег и расход по дням">
    <g stroke="#262e3b"><line v-for="i in 3" :key="i" :x1="PAD" :x2="W - PAD" :y1="PAD + ((H - PAD * 2) / 3) * (i - 1)" :y2="PAD + ((H - PAD * 2) / 3) * (i - 1)" /></g>
    <g v-for="(d, i) in days" :key="d.label">
      <rect :x="x(i) - Math.min(28, slot * 0.35)" :y="yKm(d.km)" :width="Math.min(56, slot * 0.7)" :height="H - PAD - yKm(d.km)" fill="#4a86c8" />
      <text :x="x(i)" :y="H - 6" text-anchor="middle" font-size="11" fill="#7b8696">{{ d.label }}</text>
      <text :x="x(i)" :y="yKm(d.km) - 4" text-anchor="middle" font-size="10" fill="#aab3c0">{{ Math.round(d.km) }}</text>
    </g>
    <polyline v-if="line" :points="line" fill="none" stroke="#d6a23f" stroke-width="2" />
    <text :x="PAD" y="12" font-size="11" fill="#4a86c8">км</text>
    <text :x="W - PAD" y="12" text-anchor="end" font-size="11" fill="#d6a23f">л/100 км</text>
  </svg>
</template>
