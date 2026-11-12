<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useVehicle } from '@/composables/useVehicle'
import { num } from '@/utils/format'

const v = useVehicle()
v.pollMode.value = 'normal'
const mirror = ref(false)
const s = computed(() => v.snapshot.value)
const speed = computed(() => (s.value?.speedKmh != null ? Math.round(s.value.speedKmh) : null))
const warn = computed(() => (speed.value ?? 0) >= 110)
// Не гасим экран, пока открыт HUD (где поддерживается).
let lock: { release: () => Promise<void> } | null = null
onMounted(async () => { try { lock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null } catch { /* нет поддержки */ } })
onUnmounted(() => { void lock?.release() })
</script>

<template>
  <div class="fixed inset-0 z-40 flex flex-col bg-black text-white" style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom)">
    <div class="flex items-center justify-between px-2 py-2">
      <RouterLink to="/" class="flex h-11 w-11 items-center justify-center rounded-full text-white/70 active:bg-white/10" aria-label="Закрыть HUD"><AppIcon name="close" /></RouterLink>
      <button class="rounded-full border border-white/25 px-4 py-1.5 text-sm text-white/80 active:bg-white/10" :aria-pressed="mirror" @click="mirror = !mirror">Зеркало {{ mirror ? 'вкл' : 'выкл' }}</button>
    </div>
    <div class="flex flex-1 flex-col items-center justify-center gap-6 px-4" :style="mirror ? 'transform: scaleY(-1)' : ''">
      <div class="text-center">
        <div class="font-black leading-none tabular-nums transition-colors" :class="warn ? 'text-[#ff5a4d]' : 'text-[#3ed1ff]'" style="font-size: min(42vw, 38vh)">{{ speed ?? '—' }}</div>
        <div class="mt-1 text-xl tracking-widest text-white/60">КМ/Ч</div>
      </div>
      <div class="grid w-full max-w-md grid-cols-3 gap-2 text-center">
        <div><div class="text-3xl font-bold tabular-nums">{{ num(s?.rpm) }}</div><div class="text-xs text-white/50">об/мин</div></div>
        <div><div class="text-3xl font-bold tabular-nums" :class="(s?.coolantTempC ?? 0) > 108 ? 'text-[#ff5a4d]' : ''">{{ num(s?.coolantTempC) }}</div><div class="text-xs text-white/50">°C ОЖ</div></div>
        <div><div class="text-3xl font-bold tabular-nums">{{ num(s?.voltage, 1) }}</div><div class="text-xs text-white/50">В</div></div>
      </div>
      <p v-if="!v.isConnected.value" class="text-sm text-white/50">Нет связи со сканером — подключитесь, чтобы увидеть скорость.</p>
    </div>
  </div>
</template>
