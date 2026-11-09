<script setup lang="ts">
import { computed } from 'vue'
import { num } from '@/utils/format'
import type { OilStatus } from '@/services/OilService'

const props = defineProps<{ status: OilStatus; intervalKm: number; changedAt: string | null }>()

const fill = computed(() => Math.min(100, props.status.pct))
const bar = computed(() => ({ ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[props.status.level]))
const text = computed(() => ({ ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[props.status.level]))
const ticks = computed(() => Array.from({ length: 11 }, (_, i) => i))
const date = computed(() => (props.changedAt ? new Date(props.changedAt + 'T00:00:00').toLocaleDateString('ru-RU') : '—'))
</script>

<template>
  <div>
    <div class="mb-1 flex items-baseline justify-between">
      <span class="label">Моторное масло</span>
      <span class="font-mono text-xs text-[#7b8696]">замена: {{ date }}<template v-if="status.daysSince != null"> · {{ status.daysSince }} дн.</template></span>
    </div>
    <template v-if="status.configured">
      <div class="relative h-3 bg-night-700">
        <div class="absolute inset-y-0 left-0" :class="bar" :style="{ width: fill + '%' }" />
        <span v-for="i in ticks" :key="i" class="absolute inset-y-0 w-px bg-night-950/70" :style="{ left: i * 10 + '%' }" />
      </div>
      <div class="mt-1 flex justify-between font-mono text-[10px] text-[#5f6978]">
        <span>0</span><span>{{ num(intervalKm / 2000, 0) }}к</span><span>{{ num(intervalKm / 1000, 0) }}к км</span>
      </div>
      <div class="mt-1 flex items-baseline justify-between">
        <span class="font-mono text-2xl font-semibold tabular-nums" :class="text">{{ num(status.sinceKm) }} <span class="text-xs text-[#7b8696]">км с замены</span></span>
        <span class="font-mono text-sm" :class="status.leftKm < 0 ? 'text-bad' : 'text-[#aab3c0]'">
          {{ status.leftKm >= 0 ? 'осталось ' + num(status.leftKm) : 'просрочено ' + num(-status.leftKm) }} км
        </span>
      </div>
    </template>
    <p v-else class="text-sm text-[#7b8696]">Дата замены не указана — задайте её на вкладке «Сервис».</p>
  </div>
</template>
