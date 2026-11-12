<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/** Нижняя панель/полноэкранное окно поверх страницы. */
defineProps<{ title?: string; full?: boolean }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <div class="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" @click.self="$emit('close')">
    <div class="mx-auto flex w-full max-w-3xl flex-col bg-night-950 shadow-2xl" :class="full ? 'h-full' : 'max-h-[88%] rounded-t-3xl'" style="padding-bottom: env(safe-area-inset-bottom)">
      <div class="flex h-14 shrink-0 items-center justify-between px-2" :style="full ? 'padding-top: env(safe-area-inset-top)' : ''">
        <button class="flex h-11 w-11 items-center justify-center rounded-full active:bg-night-700" aria-label="Закрыть" @click="$emit('close')"><AppIcon name="close" /></button>
        <h2 class="min-w-0 flex-1 truncate px-2 text-center text-base font-semibold">{{ title }}</h2>
        <div class="flex min-w-[2.75rem] justify-end"><slot name="right" /></div>
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><slot /></div>
      <div v-if="$slots.footer" class="shrink-0 px-3 pb-3 pt-1"><slot name="footer" /></div>
    </div>
  </div>
</template>
