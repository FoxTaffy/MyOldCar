<script setup lang="ts">
import { computed } from 'vue'

/** Столбики с подписями; выбранный столбик подсвечен. Для «день / месяц» и расходов по месяцам. */
const props = defineProps<{ items: { key: string; label: string; value: number | null }[]; max?: number; selected?: string; marks?: number[]; fmt?: (n: number) => string }>()
const emit = defineEmits<{ pick: [string] }>()
const top = computed(() => props.max ?? Math.max(1, ...props.items.map((i) => i.value ?? 0)))
</script>

<template>
  <div class="relative">
    <div v-for="m in marks ?? []" :key="m" class="pointer-events-none absolute inset-x-0 border-t border-dashed border-night-600" :style="{ bottom: `calc(1.5rem + ${(m / top) * 7.5}rem)` }">
      <span class="absolute -top-2.5 right-0 bg-night-800 pl-1 text-[10px] text-faint">{{ m }}</span>
    </div>
    <div class="flex h-[9.5rem] items-end gap-1.5">
      <button v-for="i in items" :key="i.key" class="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" :aria-label="`${i.label}: ${i.value ?? 'нет данных'}`" @click="emit('pick', i.key)">
        <span v-if="selected === i.key && i.value != null" class="text-[11px] font-semibold text-accent">{{ fmt ? fmt(i.value) : Math.round(i.value) }}</span>
        <span class="w-full max-w-[2rem] rounded-t-lg transition-all" :class="selected === i.key ? 'bg-accent' : 'bg-accent/35'" :style="{ height: i.value ? Math.max(4, (i.value / top) * 7.5) + 'rem' : '2px', opacity: i.value ? 1 : 0.35 }" />
        <span class="h-5 truncate text-[11px]" :class="selected === i.key ? 'font-bold text-ink' : 'text-faint'">{{ i.label }}</span>
      </button>
    </div>
  </div>
</template>
