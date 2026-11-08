<script setup lang="ts">
import { ref } from 'vue'
import OnboardingWizard from '@/components/OnboardingWizard.vue'
import { useVehicle } from '@/composables/useVehicle'

const v = useVehicle()
const showSetup = ref(!v.prefs.onboarded)
const tabs = [
  { to: '/', label: 'Панель' },
  { to: '/diagnostics', label: 'Ошибки' },
  { to: '/performance', label: '0–100' },
]
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col">
    <header class="flex flex-wrap items-center gap-2 px-4 pb-2 pt-3">
      <div class="mr-auto">
        <div class="text-lg font-bold tracking-wide">ВАЗ 2104 <span class="text-accent-glow">· М73</span></div>
        <div class="text-xs text-slate-400">
          <span :class="v.isConnected.value ? 'text-emerald-400' : 'text-slate-500'">●</span>
          {{ v.status.value === 'connected' ? (v.prefs.mock ? 'Демо-режим (mock)' : 'ELM327 подключён') : v.status.value === 'connecting' ? 'Подключение…' : 'Не подключено' }}
        </div>
      </div>
      <button class="btn-ghost !px-3 !py-2 text-sm" aria-label="Настройки" @click="showSetup = true">⚙</button>
      <label v-if="!v.isConnected.value" class="flex items-center gap-2 text-xs text-slate-300">
        <input v-model="v.prefs.mock" type="checkbox" class="accent-blue-500" /> Mock
      </label>
      <button v-if="!v.isConnected.value" class="btn !py-2 text-sm" :disabled="v.status.value === 'connecting'" @click="v.connect()">Подключить</button>
      <button v-else class="btn-ghost !py-2 text-sm" @click="v.disconnect()">Отключить</button>
      <p v-if="v.error.value" class="w-full text-xs text-red-400">{{ v.error.value }}</p>
    </header>

    <main class="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
      <RouterView />
    </main>

    <OnboardingWizard v-if="showSetup" @done="showSetup = false" />

    <nav class="grid grid-cols-3 border-t border-night-600 bg-night-900/95 pb-[env(safe-area-inset-bottom)]">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="py-3 text-center text-sm font-semibold text-slate-400" active-class="!text-accent-glow">
        {{ t.label }}
      </RouterLink>
    </nav>
  </div>
</template>
