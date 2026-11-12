<script setup lang="ts">
import { computed } from 'vue'
import { int, num } from '@/utils/format'
import { OIL_MAX_DAYS, type OilStatus } from '@/services/OilService'

const props = defineProps<{ status: OilStatus; intervalKm: number; changedAt: string | null }>()

const fill = computed(() => Math.max(0, Math.min(100, props.status.pct)))
const bar = computed(() => ({ ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[props.status.level]))
const text = computed(() => ({ ok: 'text-ok', warn: 'text-warn', bad: 'text-bad' }[props.status.level]))
const date = computed(() => (props.changedAt ? new Date(props.changedAt + 'T00:00:00').toLocaleDateString('ru-RU') : '—'))
/** Подпись шкалы в тысячах км: 10 → «10», 7,5 → «7,5». */
const thousands = (km: number): string => num(km / 1000, km % 1000 ? 1 : 0).replace(/,0$/, '')
</script>

<template>
  <div>
    <div class="mb-1 flex items-baseline justify-between gap-2">
      <span class="label">Моторное масло</span>
      <span class="font-mono text-xs muted">замена: {{ date }}<template v-if="status.daysSince != null"> · {{ status.daysSince }} дн.</template></span>
    </div>
    <template v-if="status.configured">
      <div class="relative h-3 bg-night-700">
        <div class="absolute inset-y-0 left-0" :class="bar" :style="{ width: fill + '%' }" />
        <span v-for="i in 9" :key="i" class="absolute inset-y-0 w-px bg-night-950/70" :style="{ left: i * 10 + '%' }" />
      </div>
      <div class="mt-1 flex justify-between font-mono text-[10px] text-[#5f6978]">
        <span>0</span><span>{{ thousands(intervalKm / 2) }}</span><span>{{ thousands(intervalKm) }} тыс. км</span>
      </div>
      <div class="mt-1 flex items-baseline justify-between gap-2">
        <span class="font-mono text-2xl font-semibold tabular-nums" :class="text">{{ int(status.sinceKm) }} <span class="tile-unit">км с замены</span></span>
        <span class="text-right font-mono text-sm" :class="status.leftKm < 0 ? 'text-bad' : 'text-[#aab3c0]'">
          {{ status.leftKm >= 0 ? 'осталось ' + int(status.leftKm) : 'перепробег ' + int(-status.leftKm) }} км
        </span>
      </div>
      <p v-if="status.overdueByTime" class="mt-1 text-xs text-bad">С замены прошло больше {{ OIL_MAX_DAYS }} дней — масло пора менять по сроку, даже если пробег не вышел.</p>
    </template>
    <p v-else class="text-sm muted">Дата замены не указана — задайте её на вкладке «Сервис».</p>
  </div>
</template>
