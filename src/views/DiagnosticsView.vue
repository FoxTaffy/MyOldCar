<script setup lang="ts">
import { computed, ref } from 'vue'
import { useVehicle } from '@/composables/useVehicle'
import { describeDtc, searchDtcs } from '@/data/dtcDictionary'
import { diagnose } from '@/services/DiagnosticEngine'
import type { DiagnosisResult } from '@/types'

const { settings, snapshot, isConnected, getElm, milOn } = useVehicle()
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
    const stored = await elm.readDtcs()
    // Режим 07 поддерживают не все ЭБУ — ошибка тут не должна ронять чтение.
    const pending = (await elm.readPendingDtcs().catch(() => [])).filter((c) => !stored.includes(c))
    // Стоп-кадр: берём свежий снимок со всеми PID, а не последний из цикла опроса.
    const frame = await elm.readSnapshot(true).catch(() => snapshot.value)
    results.value = [
      ...stored.map((c) => ({ ...diagnose(c, frame, settings), status: 'confirmed' as const })),
      ...pending.map((c) => ({ ...diagnose(c, frame, settings), status: 'pending' as const })),
    ]
    scanned.value = true
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function copy(): Promise<void> {
  const text = results.value
    .map((r) => `${r.code} (${r.status === 'pending' ? 'временная' : 'подтверждённая'}) — ${r.title}\n` + r.causes.map((c) => `  ${c.probability}% ${c.title}`).join('\n'))
    .join('\n\n')
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    err.value = 'Не удалось скопировать'
  }
}
const copied = ref(false)
const query = ref('')
const found = computed(() => searchDtcs(query.value))

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
      <button class="btn-ghost" :disabled="!results.length" @click="copy">{{ copied ? 'Скопировано' : 'Копия' }}</button>
    </div>
    <div v-if="milOn" class="flex items-center gap-3 border border-bad p-3 text-bad">
      <span class="flex h-7 w-7 shrink-0 items-center justify-center border-2 border-bad font-mono text-lg font-bold">!</span>
      <span class="text-sm">Лампа Check Engine сейчас горит</span>
    </div>
    <p v-if="!isConnected" class="text-center text-sm text-[#5f6978]">Сначала подключись к адаптеру.</p>
    <p v-if="err" class="text-sm text-bad">{{ err }}</p>
    <p v-if="scanned && !results.length" class="card p-4 text-center text-ok">Ошибок не найдено</p>

    <article v-for="r in results" :key="r.code" class="card space-y-3 p-4">
      <header>
        <div class="flex items-baseline justify-between">
          <span class="font-mono text-2xl font-semibold text-bad">{{ r.code }}</span>
          <span class="label" :class="r.status === 'pending' ? 'text-warn' : 'text-bad'">{{ r.status === 'pending' ? 'Временная' : 'Подтверждённая' }}</span>
        </div>
        <div class="text-sm text-[#aab3c0]">{{ r.title }}</div>
        <div class="mt-1 text-xs text-[#5f6978]">{{ describeDtc(r.code).system }}<template v-if="describeDtc(r.code).subsystem"> · {{ describeDtc(r.code).subsystem }}</template> · {{ describeDtc(r.code).kind === 'generic' ? 'универсальный код' : 'заводской код' }}</div>
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

    <div class="card space-y-2 p-4">
      <h2 class="label">Справочник кодов</h2>
      <input v-model="query" class="field" placeholder="Код (P0171) или слово (лямбда, форсунка…)" autocapitalize="characters" spellcheck="false" />
      <ul v-if="found.length" class="divide-y divide-night-600 text-sm">
        <li v-for="d in found" :key="d.code" class="flex gap-3 py-2">
          <span class="w-14 shrink-0 font-mono font-semibold text-accent-glow">{{ d.code }}</span>
          <span>{{ d.title }}</span>
        </li>
      </ul>
      <template v-else-if="query.trim()">
        <p class="text-sm text-[#7b8696]">В справочнике нет такого кода. Общая расшифровка:</p>
        <p v-if="/^[PBCU][0-9A-F]{4}$/i.test(query.trim())" class="text-sm">{{ describeDtc(query).title }}</p>
      </template>
    </div>
  </section>
</template>
