<script setup lang="ts">
import { computed, ref } from 'vue'
import { levelOf, BUILTIN_SENSORS } from '@/data/sensors'
import type { TripSeries } from '@/services/SensorStats'
import type { Level } from '@/types'

const props = defineProps<{ series: TripSeries }>()
const W = 600
const H = 180
const L = 34
const B = 18
const FILL: Record<Level, string> = { ok: '#5fae7a', warn: '#d6a23f', bad: '#d9594c' }

const ids = computed(() => Object.keys(props.series.data).filter((id) => props.series.data[id].some((v) => v != null && Number.isFinite(v))))
const sel = ref('')
const cur = computed(() => (ids.value.includes(sel.value) ? sel.value : ids.value[0] ?? ''))
const def = computed(() => BUILTIN_SENSORS.find((d) => d.id === cur.value))
const vals = computed(() => props.series.data[cur.value] ?? [])

const range = computed(() => {
  const d = def.value
  const real = vals.value.filter((v): v is number => v != null && Number.isFinite(v))
  let lo = d?.scale[0] ?? 0
  let hi = d?.scale[1] ?? 1
  if (real.length) { lo = Math.min(lo, ...real); hi = Math.max(hi, ...real) }
  return [lo, hi] as const
})
const tMax = computed(() => Math.max(1, props.series.t[props.series.t.length - 1] ?? 1))
const x = (t: number) => L + (t / tMax.value) * (W - L - 6)
const y = (v: number) => H - B - ((v - range.value[0]) / (range.value[1] - range.value[0] || 1)) * (H - B - 6)

const bands = computed(() => {
  const d = def.value
  if (!d?.ok) return []
  const [lo, hi] = range.value
  const N = 48
  const out: { y: number; h: number; level: Level }[] = []
  for (let i = 0; i < N; i++) {
    const a = lo + (i / N) * (hi - lo)
    const b = lo + ((i + 1) / N) * (hi - lo)
    const level = levelOf(d, (a + b) / 2)
    const last = out[out.length - 1]
    const y1 = y(b)
    const y0 = y(a)
    if (last && last.level === level) { last.h += y0 - y1; last.y = y1 } else out.push({ y: y1, h: y0 - y1, level })
  }
  return out
})
const path = computed(() => {
  let s = ''
  let pen = false
  vals.value.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return }
    s += `${pen ? 'L' : 'M'}${x(props.series.t[i]).toFixed(1)},${y(v).toFixed(1)}`
    pen = true
  })
  return s
})
const mins = (s: number) => `${Math.round(s / 60)}м`
</script>

<template>
  <div v-if="ids.length">
    <div class="mb-2 flex flex-wrap gap-1">
      <button v-for="id in ids" :key="id" class="chip !px-3 !py-1 !text-xs" :class="cur === id ? 'on' : ''" @click="sel = id">
        {{ BUILTIN_SENSORS.find((d) => d.id === id)?.name }}
      </button>
    </div>
    <svg :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" :aria-label="`График: ${def?.name}`">
      <rect v-for="(b, i) in bands" :key="i" :x="L" :y="b.y" :width="W - L - 6" :height="b.h" :fill="FILL[b.level]" opacity="0.13" />
      <text :x="L - 4" :y="y(range[1]) + 8" text-anchor="end" font-size="10" fill="rgb(var(--mute))">{{ Math.round(range[1]) }}</text>
      <text :x="L - 4" :y="y(range[0])" text-anchor="end" font-size="10" fill="rgb(var(--mute))">{{ Math.round(range[0]) }}</text>
      <text :x="L" :y="H - 3" font-size="10" fill="rgb(var(--mute))">0</text>
      <text :x="W - 6" :y="H - 3" text-anchor="end" font-size="10" fill="rgb(var(--mute))">{{ mins(tMax) }}</text>
      <path :d="path" fill="none" stroke="rgb(var(--ink))" stroke-width="1.8" stroke-linejoin="round" />
    </svg>
    <p class="mt-1 text-[11px] text-mute">{{ def?.name }}, {{ def?.unit }} · фон: зелёный — норма, оранжевый — внимание, красный — вне нормы</p>
  </div>
  <p v-else class="text-xs text-mute">График для этой поездки не записан.</p>
</template>
