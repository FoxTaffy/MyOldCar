<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ points: (number | null)[]; scale: [number, number]; color: string }>()
const W = 120
const H = 28
const d = computed(() => {
  const pts = props.points
  if (pts.length < 2) return ''
  const [a, b] = props.scale
  let lo = a
  let hi = b
  // Узкий реальный диапазон показываем крупнее, чем полная шкала датчика.
  const real = pts.filter((v): v is number => v != null && Number.isFinite(v))
  if (real.length) {
    const mn = Math.min(...real)
    const mx = Math.max(...real)
    const pad = Math.max((mx - mn) * 0.15, (b - a) * 0.03)
    lo = Math.max(a - (b - a), mn - pad)
    hi = Math.min(b + (b - a), mx + pad)
    if (hi - lo < (b - a) * 0.1) { const m = (hi + lo) / 2; lo = m - (b - a) * 0.05; hi = m + (b - a) * 0.05 }
  }
  let out = ''
  let pen = false
  pts.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) { pen = false; return }
    out += `${pen ? 'L' : 'M'}${((i / (pts.length - 1)) * W).toFixed(1)},${(H - 2 - ((v - lo) / (hi - lo)) * (H - 4)).toFixed(1)}`
    pen = true
  })
  return out
})
</script>

<template>
  <svg :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" class="h-7 w-full" role="presentation">
    <path v-if="d" :d="d" fill="none" :stroke="color" stroke-width="1.6" vector-effect="non-scaling-stroke" />
  </svg>
</template>
