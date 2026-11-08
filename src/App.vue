<script setup lang="ts">
import { computed, ref } from 'vue'
import OnboardingWizard from '@/components/OnboardingWizard.vue'
import { useVehicle } from '@/composables/useVehicle'

const v = useVehicle()
const showSetup = ref(!v.prefs.onboarded)
const tabs = [
  { to: '/', label: 'Панель' },
  { to: '/diagnostics', label: 'Ошибки' },
  { to: '/performance', label: '0–100' },
]
const statusText = computed(() =>
  v.status.value === 'connected' ? (v.prefs.mock ? 'ДЕМО' : 'ELM327 ONLINE') : v.status.value === 'connecting' ? 'ПОДКЛЮЧЕНИЕ' : 'ОФФЛАЙН',
)
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col">
    <header class="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-night-600 px-4 py-2">
      <div class="mr-auto">
        <div class="text-sm font-semibold uppercase tracking-[0.12em]">ВАЗ-2104 <span class="text-[#7b8696]">/ М73</span></div>
        <div class="flex items-center gap-2 font-mono text-[11px] text-[#7b8696]">
          <span class="inline-block h-2 w-2" :class="v.isConnected.value ? 'bg-ok' : 'bg-[#4a5260]'" />{{ statusText }}
        </div>
      </div>
      <label v-if="!v.isConnected.value" class="flex items-center gap-2 text-xs text-[#aab3c0]">
        <input v-model="v.prefs.mock" type="checkbox" /> Mock
      </label>
      <button v-if="!v.isConnected.value" class="btn !px-3 !py-2 !text-xs" :disabled="v.status.value === 'connecting'" @click="v.connect()">Подключить</button>
      <button v-else class="btn-ghost !px-3 !py-2 !text-xs" @click="v.disconnect()">Отключить</button>
      <button class="btn-ghost !px-3 !py-2 !text-xs" @click="showSetup = true">Настр.</button>
      <p v-if="v.error.value" class="w-full font-mono text-xs text-bad">{{ v.error.value }}</p>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto p-3">
      <RouterView />
    </main>

    <OnboardingWizard v-if="showSetup" @done="showSetup = false" />

    <nav class="grid grid-cols-3 border-t border-night-600 bg-night-900 pb-[env(safe-area-inset-bottom)]">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="border-t-2 border-transparent py-3 text-center text-xs font-semibold uppercase tracking-[0.14em] text-[#7b8696]" active-class="!border-accent !text-[#d5dae2]">
        {{ t.label }}
      </RouterLink>
    </nav>
  </div>
</template>
