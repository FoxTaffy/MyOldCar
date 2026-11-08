<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVehicle } from '@/composables/useVehicle'
import type { AppSettings } from '@/types'

const emit = defineEmits<{ done: [] }>()
const { prefs, settings, connect, isConnected, status } = useVehicle()

const step = ref(0)
const total = 3
const connectNow = ref(true)

const portText = computed({
  get: () => String(prefs.port),
  set: (v: string) => { const n = parseInt(v, 10); if (n > 0 && n < 65536) prefs.port = n },
})

const toggles: { key: keyof AppSettings; label: string; hint: string }[] = [
  { key: 'recentFuelServicing', label: 'Недавно обслуживались топливные магистрали / бак', hint: 'Повышает вероятность проблем с давлением топлива' },
  { key: 'recentAirIntakeServicing', label: 'Недавно трогали впуск (ДМРВ, гофра, фильтр)', hint: 'Повышает вероятность подсоса воздуха' },
  { key: 'recentIgnitionServicing', label: 'Недавно меняли свечи / провода / модуль зажигания', hint: 'Учитывается при пропусках зажигания' },
  { key: 'coldStartOnly', label: 'Неисправность проявляется только на холодном', hint: 'Влияет на оценку модуля зажигания' },
]

async function finish(): Promise<void> {
  prefs.onboarded = true
  emit('done')
  if (connectNow.value && status.value === 'disconnected' && !isConnected.value) await connect()
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
    <div class="card max-h-full w-full max-w-md space-y-4 overflow-y-auto rounded-b-none border-night-600 bg-night-900 p-5 sm:rounded-b-2xl">
      <div class="flex items-center justify-between text-xs text-slate-400">
        <span class="font-semibold uppercase tracking-widest">Первая настройка</span>
        <span>{{ step + 1 }} / {{ total }}</span>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-night-700">
        <div class="h-full bg-accent transition-all" :style="{ width: ((step + 1) / total) * 100 + '%' }" />
      </div>

      <section v-if="step === 0" class="space-y-3">
        <h2 class="text-xl font-bold">Привет! Это сканер для ВАЗ 2104</h2>
        <p class="text-sm text-slate-400">Всё считается на телефоне — интернет и нейросети не нужны. Выбери, как подключаться.</p>
        <label class="flex items-start gap-3 rounded-xl border border-night-600 p-3">
          <input type="radio" class="mt-1 accent-blue-500" :checked="!prefs.mock" @change="prefs.mock = false" />
          <span><b>Реальный адаптер ELM327 (Wi-Fi)</b><br /><span class="text-xs text-slate-400">Сначала подключи телефон к Wi-Fi сети адаптера</span></span>
        </label>
        <label class="flex items-start gap-3 rounded-xl border border-night-600 p-3">
          <input type="radio" class="mt-1 accent-blue-500" :checked="prefs.mock" @change="prefs.mock = true" />
          <span><b>Демо-режим</b><br /><span class="text-xs text-slate-400">Симуляция машины, чтобы посмотреть интерфейс</span></span>
        </label>
        <div v-if="!prefs.mock" class="grid grid-cols-3 gap-3">
          <label class="col-span-2 text-xs text-slate-400">IP адаптера
            <input v-model="prefs.host" inputmode="decimal" class="mt-1 w-full rounded-lg border border-night-600 bg-night-800 px-3 py-2 font-mono text-slate-100" />
          </label>
          <label class="text-xs text-slate-400">Порт
            <input v-model="portText" inputmode="numeric" class="mt-1 w-full rounded-lg border border-night-600 bg-night-800 px-3 py-2 font-mono text-slate-100" />
          </label>
          <p class="col-span-3 text-xs text-slate-500">По умолчанию 192.168.0.10 : 35000</p>
        </div>
      </section>

      <section v-else-if="step === 1" class="space-y-3">
        <h2 class="text-xl font-bold">Состояние машины</h2>
        <p class="text-sm text-slate-400">Это помогает диагносту точнее оценить причины ошибок. Можно изменить позже на экране «Ошибки».</p>
        <label v-for="t in toggles" :key="t.key" class="flex items-start gap-3 rounded-xl border border-night-600 p-3">
          <input v-model="settings[t.key]" type="checkbox" class="mt-1 accent-blue-500" />
          <span class="text-sm">{{ t.label }}<br /><span class="text-xs text-slate-500">{{ t.hint }}</span></span>
        </label>
      </section>

      <section v-else class="space-y-3">
        <h2 class="text-xl font-bold">Готово</h2>
        <p class="text-sm text-slate-400">
          Режим: <b class="text-slate-200">{{ prefs.mock ? 'демо' : `ELM327 ${prefs.host}:${prefs.port}` }}</b>.
          Настройки можно открыть снова кнопкой ⚙ вверху.
        </p>
        <label class="flex items-center gap-3 text-sm">
          <input v-model="connectNow" type="checkbox" class="accent-blue-500" /> Подключиться сразу
        </label>
      </section>

      <div class="flex gap-3 pt-1">
        <button v-if="step > 0" class="btn-ghost" @click="step--">Назад</button>
        <button v-if="step < total - 1" class="btn flex-1" @click="step++">Далее</button>
        <button v-else class="btn flex-1" @click="finish">Начать</button>
      </div>
    </div>
  </div>
</template>
