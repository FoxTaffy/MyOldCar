<script setup lang="ts">
import { computed } from 'vue'

export interface DayPoint { label: string; km: number; l100: number | null }
const props = defineProps<{ days: DayPoint[] }>()

const W = 600
const H = 190
const PAD = 26
const TOP = 30
const maxKm = computed(() => Math.max(10, ...props.days.map((d) => d.km)) * 1.15)
const cons = computed(() => props.days.map((d) => d.l100).filter((v): v is number => v != null))
const cMin = computed(() => (cons.value.length ? Math.min(...cons.value) - 1 : 0))
const cMax = computed(() => (cons.value.length ? Math.max(...cons.value) + 1 : 1))
const slot = computed(() => (W - PAD * 2) / Math.max(1, props.days.length))
const x = (i: number) => PAD + slot.value * i + slot.value / 2
const yKm = (v: number) => H - PAD - (v / maxKm.value) * (H - PAD - TOP)
const yC = (v: number) => H - PAD - ((v - cMin.value) / (cMax.value - cMin.value || 1)) * (H - PAD - TOP)
const dots = computed(() => props.days.flatMap((d, i) => (d.l100 == null ? [] : [{ x: x(i), y: yC(d.l100), v: d.l100 }])))
const line = computed(() => dots.value.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '))
// Подписи значений расхода не должны слипаться, когда дней много.
const showValues = computed(() => props.days.length <= 8)
const fmtKm = (v: number) => (v >= 10 ? Math.round(v).toString() : v.toFixed(1).replace('.', ','))
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="Пробег и расход по дням">
    <g stroke="rgb(var(--line))"><line v-for="i in 4" :key="i" :x1="PAD" :x2="W - PAD" :y1="TOP + ((H - PAD - TOP) / 3) * (i - 1)" :y2="TOP + ((H - PAD - TOP) / 3) * (i - 1)" /></g>
    <g v-for="(d, i) in days" :key="d.label">
      <rect :x="x(i) - Math.min(28, slot * 0.35)" :y="yKm(d.km)" :width="Math.min(56, slot * 0.7)" :height="Math.max(1, H - PAD - yKm(d.km))" fill="rgb(var(--accent))" />
      <text :x="x(i)" :y="H - 8" text-anchor="middle" font-size="12" fill="rgb(var(--mute))">{{ d.label }}</text>
      <text :x="x(i)" :y="yKm(d.km) - 5" text-anchor="middle" font-size="12" fill="rgb(var(--soft))">{{ fmtKm(d.km) }}</text>
    </g>
    <polyline v-if="dots.length > 1" :points="line" fill="none" stroke="#d6a23f" stroke-width="2" />
    <g v-for="p in dots" :key="p.x">
      <circle :cx="p.x" :cy="p.y" r="4" fill="#d6a23f" stroke="rgb(var(--card))" stroke-width="2" />
      <text v-if="showValues" :x="p.x + 8" :y="p.y + 4" font-size="12" fill="#d6a23f">{{ p.v.toFixed(1).replace('.', ',') }}</text>
    </g>
    <rect :x="PAD" y="6" width="10" height="10" fill="rgb(var(--accent))" /><text :x="PAD + 15" y="15" font-size="12" fill="rgb(var(--soft))">пробег, км</text>
    <circle :cx="W - PAD - 92" cy="11" r="4" fill="#d6a23f" /><text :x="W - PAD" y="15" text-anchor="end" font-size="12" fill="rgb(var(--soft))">расход, л/100</text>
  </svg>
</template>
