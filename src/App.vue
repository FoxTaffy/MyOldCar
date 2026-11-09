<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import OnboardingWizard from '@/components/OnboardingWizard.vue'
import { useUpdate } from '@/composables/useUpdate'
import { useVehicle } from '@/composables/useVehicle'

const v = useVehicle()
const up = useUpdate()
const showSetup = ref(!v.prefs.onboarded)
const tabs = [
  { to: '/', label: 'Панель' },
  { to: '/sensors', label: 'Датчики' },
  { to: '/diagnostics', label: 'Ошибки' },
  { to: '/performance', label: '0–100' },
  { to: '/stats', label: 'Поездки' },
  { to: '/service', label: 'Сервис' },
]
onMounted(() => { v.autoStart(); void up.check() })
const viaText = { ble: 'BLUETOOTH', wifi: 'WI-FI', mock: 'ДЕМО' } as const
const statusText = computed(() =>
  v.status.value === 'connected' ? `ONLINE · ${viaText[v.via.value ?? 'mock']}` : v.status.value === 'connecting' ? (v.note.value ?? 'ПОДКЛЮЧЕНИЕ…').toUpperCase() : 'ОФФЛАЙН',
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
      <button v-if="!v.isConnected.value" class="btn !px-3 !py-2 !text-xs" :disabled="v.status.value === 'connecting'" @click="v.connect()">{{ v.status.value === 'connecting' ? 'Ждите…' : 'Подключить' }}</button>
      <button v-else class="btn-ghost !px-3 !py-2 !text-xs" @click="v.disconnect()">Отключить</button>
      <button class="btn-ghost !px-3 !py-2 !text-xs" @click="showSetup = true">Настр.</button>
      <p v-if="v.error.value" class="w-full font-mono text-xs text-bad">{{ v.error.value }}</p>
    </header>

    <div v-if="up.update.value" class="flex items-center gap-2 border-b border-night-600 bg-night-800 px-4 py-2 text-xs">
      <span class="mr-auto">Доступна версия <span class="font-mono text-ok">{{ up.update.value.version }}</span></span>
      <button class="btn !px-3 !py-1.5 !text-[11px]" @click="up.install()">Обновить</button>
    </div>

    <main class="min-h-0 flex-1 overflow-y-auto p-3">
      <RouterView />
    </main>

    <OnboardingWizard v-if="showSetup" @done="showSetup = false" />

    <nav class="grid grid-cols-6 border-t border-night-600 bg-night-900 pb-[env(safe-area-inset-bottom)]">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="border-t-2 border-transparent py-3 text-center text-[9px] font-semibold uppercase tracking-[0.1em] text-[#7b8696]" active-class="!border-accent !text-[#d5dae2]">
        {{ t.label }}
      </RouterLink>
    </nav>
  </div>
</template>
