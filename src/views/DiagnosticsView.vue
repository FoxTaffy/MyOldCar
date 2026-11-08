<script setup lang="ts">
import { ref } from 'vue'
import { useVehicle } from '@/composables/useVehicle'
import { diagnose } from '@/services/DiagnosticEngine'
import type { DiagnosisResult } from '@/types'

const { settings, snapshot, isConnected, getElm } = useVehicle()
const results = ref<DiagnosisResult[]>([])
const scanned = ref(false)
const busy = ref(false)
const err = ref<string | null>(null)

const toggles: { key: keyof typeof settings; label: string }[] = [
  { key: 'recentFuelServicing', label: 'Недавно обслуживались топливные магистрали / бак' },
  { key: 'recentAirIntakeServicing', label: 'Недавно трогали впуск (ДМРВ, гофра, фильтр)' },
  { key: 'recentIgnitionServicing', label: 'Недавно меняли свечи / провода / модуль' },
  { key: 'coldStartOnly', label: 'Ошибка проявляется только на холодном' },
]

async function scan(): Promise<void> {
  busy.value = true
  err.value = null
  try {
    const elm = getElm()
    const codes = await elm.readDtcs()
    // Стоп-кадр: берём свежий снимок, а не последний из цикла опроса.
    const frame = await elm.readSnapshot().catch(() => snapshot.value)
    results.value = codes.map((c) => diagnose(c, frame, settings))
    scanned.value = true
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function clear(): Promise<void> {
  if (!confirm('Сбросить ошибки в ЭБУ? Стоп-кадр будет потерян.')) return
  busy.value = true
  try {
    await getElm().clearDtcs()
    results.value = []
  } finally {
    busy.value = false
  }
}

const barColor = (p: number) => (p >= 50 ? 'bg-bad' : p >= 25 ? 'bg-warn' : 'bg-accent')
</script>

<template>
  <section class="space-y-2">
    <div class="card space-y-2 p-4">
      <h2 class="label">Контекст для диагноста</h2>
      <label v-for="t in toggles" :key="t.key" class="flex items-start gap-3 text-sm">
        <input v-model="settings[t.key]" type="checkbox" class="mt-1 accent-blue-500" />
        <span>{{ t.label }}</span>
      </label>
    </div>

    <div class="flex gap-3">
      <button class="btn flex-1" :disabled="!isConnected || busy" @click="scan">{{ busy ? 'Чтение…' : 'Считать ошибки' }}</button>
      <button class="btn-ghost" :disabled="!isConnected || busy || !results.length" @click="clear">Сбросить</button>
    </div>
    <p v-if="!isConnected" class="text-center text-sm text-[#5f6978]">Сначала подключись к адаптеру.</p>
    <p v-if="err" class="text-sm text-bad">{{ err }}</p>
    <p v-if="scanned && !results.length" class="card p-4 text-center text-ok">Ошибок не найдено</p>

    <article v-for="r in results" :key="r.code" class="card space-y-3 p-4">
      <header>
        <div class="font-mono text-2xl font-semibold text-bad">{{ r.code }}</div>
        <div class="text-sm text-[#aab3c0]">{{ r.title }}</div>
      </header>
      <ul class="space-y-3">
        <li v-for="c in r.causes" :key="c.id">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold">{{ c.title }}</span>
            <span class="font-mono text-base tabular-nums">{{ c.probability }}%</span>
          </div>
          <div class="my-1 h-1.5 bg-night-700">
            <div class="h-full" :class="barColor(c.probability)" :style="{ width: c.probability + '%' }" />
          </div>
          <p class="text-sm text-[#7b8696]">{{ c.recommendation }}</p>
        </li>
      </ul>
      <details v-if="r.notes.length" class="text-xs text-[#5f6978]">
        <summary class="cursor-pointer">Почему такие вероятности</summary>
        <ul class="mt-1 list-disc pl-5"><li v-for="n in r.notes" :key="n">{{ n }}</li></ul>
      </details>
    </article>
  </section>
</template>
