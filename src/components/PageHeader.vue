<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppIcon from './AppIcon.vue'

defineProps<{ title: string; help?: string }>()
const router = useRouter()
const back = (): void => { if (window.history.length > 1) router.back(); else void router.push('/') }
</script>

<template>
  <header class="sticky top-0 z-20 -mx-3 -mt-3 mb-2 flex h-14 items-center gap-1 bg-night-950/90 px-2 backdrop-blur">
    <button class="flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-night-700" aria-label="Назад" @click="back"><AppIcon name="back" /></button>
    <h1 class="min-w-0 flex-1 truncate text-center text-base font-semibold">{{ title }}</h1>
    <div class="flex min-w-[2.75rem] justify-end"><slot name="right"><RouterLink v-if="help" :to="help" class="flex h-11 w-11 items-center justify-center rounded-full text-faint active:bg-night-700" aria-label="Справка"><AppIcon name="help" /></RouterLink></slot></div>
  </header>
</template>
