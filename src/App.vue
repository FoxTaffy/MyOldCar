<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import OnboardingWizard from '@/components/OnboardingWizard.vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { carShort } from '@/services/Cars'

const v = useVehicle()
const { car } = useGarage()
const route = useRoute()
const showSetup = ref(!v.prefs.onboarded)
const tabs = [
  { to: '/', label: 'Панель' },
  { to: '/diagnostics', label: 'Ошибки' },
  { to: '/performance', label: '0–100' },
  { to: '/stats', label: 'Поездки' },
  { to: '/service', label: 'Сервис' },
]
/** Карта поездки — часть раздела «Поездки»: вкладка должна оставаться подсвеченной. */
const activeTab = computed(() => (route.path.startsWith('/trip') ? '/stats' : route.path))
onMounted(() => v.autoStart())
const viaText = { ble: 'BLUETOOTH', wifi: 'WI-FI', mock: 'ДЕМО' } as const
const statusText = computed(() => {
  if (v.status.value === 'connecting') return (v.note.value ?? 'Подключение…').toUpperCase()
  if (v.status.value !== 'connected') return 'НЕТ СВЯЗИ'
  return v.ecuSilent.value ? 'ЭБУ МОЛЧИТ · ЗАЖИГАНИЕ?' : `НА СВЯЗИ · ${viaText[v.via.value ?? 'mock']}`
})
const dot = computed(() => (v.status.value === 'connected' ? (v.ecuSilent.value ? 'bg-warn' : 'bg-ok') : v.status.value === 'connecting' ? 'bg-accent' : 'bg-[#4a5260]'))
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col">
    <header class="border-b border-night-600 px-3 py-2">
      <div class="flex items-center gap-2">
        <RouterLink to="/garage" class="mr-auto block min-w-0" title="Профили автомобилей">
          <div class="truncate text-sm font-semibold uppercase tracking-[0.12em]">{{ carShort(car()) }} <span class="muted">▾</span></div>
          <div class="flex items-center gap-2 truncate font-mono text-[11px] text-[#7b8696]">
            <span class="inline-block h-2 w-2 shrink-0" :class="dot" />
            <span class="truncate">{{ statusText }}</span>
            <span v-if="v.tripActive.value" class="shrink-0 text-ok">· ЗАПИСЬ</span>
          </div>
        </RouterLink>
        <RouterLink v-if="v.milOn.value" to="/diagnostics" class="mil h-9 w-9 text-lg" title="Горит Check Engine" aria-label="Горит Check Engine — открыть ошибки">!</RouterLink>
        <button v-if="v.status.value === 'disconnected'" class="btn btn-sm" @click="v.connect()">Подключить</button>
        <button v-else class="btn-ghost btn-sm" @click="v.disconnect()">{{ v.status.value === 'connecting' ? 'Отмена' : 'Отключить' }}</button>
        <button class="btn-ghost btn-sm flex h-9 w-9 items-center justify-center !p-0" title="Настройки" aria-label="Настройки" @click="showSetup = true">
          <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square" aria-hidden="true">
            <path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><rect x="14" y="4.5" width="4" height="5" /><rect x="6" y="14.5" width="4" height="5" />
          </svg>
        </button>
      </div>
      <button v-if="v.error.value" class="mt-1 flex w-full items-start gap-2 text-left font-mono text-xs text-bad" title="Скрыть" @click="v.clearError()">
        <span class="min-w-0 flex-1 break-words">{{ v.error.value }}</span><span class="muted shrink-0" aria-hidden="true">✕</span>
      </button>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto p-3">
      <RouterView />
    </main>

    <OnboardingWizard v-if="showSetup" @done="showSetup = false" />

    <nav class="grid grid-cols-5 border-t border-night-600 bg-night-900 pb-[env(safe-area-inset-bottom)]">
      <RouterLink
        v-for="t in tabs" :key="t.to" :to="t.to"
        class="border-t-2 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.1em]"
        :class="activeTab === t.to ? 'border-accent text-[#d5dae2]' : 'border-transparent text-[#7b8696]'"
      >
        {{ t.label }}
      </RouterLink>
    </nav>
  </div>
</template>
