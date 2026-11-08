<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import RpmChart from '@/components/RpmChart.vue'
import { useVehicle } from '@/composables/useVehicle'
import { PerformanceTimer, type PerfResult, type PerfState } from '@/services/PerformanceTimer'

const { isConnected, getElm, pollMode } = useVehicle()

// Класс-автомат не реактивен — состояние и результат зеркалим в ref.
let timer = new PerformanceTimer()
const state = ref<PerfState>('idle')
const result = ref<PerfResult | null>(null)
const armed = ref(false)
const elapsed = ref(0)
const speed = ref(0)
const points = ref<{ t: number; rpm: number; speed: number }[]>([])
let running = false

async function arm(): Promise<void> {
  timer = new PerformanceTimer()
  state.value = 'idle'
  result.value = null
  points.value = []
  elapsed.value = 0
  armed.value = true
  running = true
  // Основной цикл опроса приостанавливаем: адаптер один, очередь общая.
  pollMode.value = 'off'
  const elm = getElm()
  try {
    while (running && timer.state !== 'finished') {
      // Скорость читаем в каждом цикле, обороты — тоже (нужны для анализа пробуксовки).
      const s = await elm.readSpeed()
      const r = await elm.readRpm()
      if (s == null || r == null) continue
      const now = performance.now()
      speed.value = s
      state.value = timer.feed(now, s, r)
      elapsed.value = timer.elapsedMs
      if (state.value !== 'idle') points.value = timer.samples.map((p) => ({ t: p.t, rpm: p.rpm, speed: p.speedKmh }))
      if (state.value === 'finished') result.value = timer.result
    }
  } finally {
    stop()
  }
}

function stop(): void {
  running = false
  armed.value = false
  pollMode.value = 'normal'
}

onBeforeUnmount(stop)

const seconds = computed(() => ((result.value?.durationMs ?? elapsed.value) / 1000).toFixed(1))
</script>

<template>
  <section class="mt-2 space-y-3">
    <div class="card p-6 text-center">
      <div class="text-xs font-semibold uppercase tracking-widest text-slate-400">0 → 100 км/ч</div>
      <div class="my-2 font-mono text-8xl font-bold tabular-nums" :class="result ? 'text-emerald-400' : 'text-accent-glow'">{{ seconds }}<span class="text-3xl text-slate-400"> с</span></div>
      <div class="font-mono text-2xl text-slate-300">{{ speed }} км/ч</div>
      <div class="mt-1 text-sm text-slate-500">
        <template v-if="result">Готово</template>
        <template v-else-if="state === 'running'">Идёт замер…</template>
        <template v-else-if="armed">Жду начала движения…</template>
        <template v-else>Остановись и нажми «Старт»</template>
      </div>
    </div>

    <div class="flex gap-3">
      <button class="btn flex-1" :disabled="!isConnected || armed" @click="arm">Старт</button>
      <button class="btn-ghost" :disabled="!armed" @click="stop">Стоп</button>
    </div>

    <div v-if="result?.warnings.length" class="card border-amber-400/70 p-4 text-amber-300">
      <p v-for="w in result.warnings" :key="w">⚠ {{ w }}</p>
    </div>

    <div class="card p-3"><RpmChart :points="points" :max-t="result ? result.durationMs : 10000" /></div>
  </section>
</template>
