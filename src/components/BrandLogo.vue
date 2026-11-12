<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { brandLogo } from '@/data/carCatalog'

/** Логотип производителя; если файла нет — цветной кружок с буквами. */
const props = withDefaults(defineProps<{ make: string; size?: number }>(), { size: 56 })
const failed = ref(false)
watch(() => props.make, () => { failed.value = false })
const src = computed(() => (failed.value ? null : brandLogo(props.make)))
const colors = ['#e8542f', '#2f7be8', '#16a085', '#8e44ad', '#d68910', '#c0392b', '#2471a3', '#117a65']
const bg = computed(() => colors[[...props.make].reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length])
</script>

<template>
  <span class="inline-flex shrink-0 items-center justify-center rounded-full bg-white shadow-card" :style="{ width: size + 'px', height: size + 'px', background: src ? undefined : bg }">
    <img v-if="src" :src="src" :alt="make" class="object-contain" :style="{ width: size * 0.72 + 'px', height: size * 0.72 + 'px' }" loading="lazy" @error="failed = true">
    <span v-else class="font-bold text-white" :style="{ fontSize: size * 0.34 + 'px' }">{{ (make || '?').slice(0, 2).toUpperCase() }}</span>
  </span>
</template>
