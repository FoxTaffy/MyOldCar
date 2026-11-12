<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import RpmChart from '@/components/RpmChart.vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { PerformanceTimer, type PerfResult, type PerfState } from '@/services/PerformanceTimer'
import { dateTime, num } from '@/utils/format'

const { isConnected, snapshot, pollMode } = useVehicle()
const { garage } = useGarage()

/* ---------- история замеров (по машинам) ---------- */

interface Run { at: number; carId: string; ms: number; slip: boolean }
const RUNS_KEY = 'myoldcar.perf.v1'
function loadRuns(): Run[] {
  try {
    const v = JSON.parse(localStorage.getItem(RUNS_KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}
const runs = ref<Run[]>(loadRuns())
const myRuns = computed(() => runs.value.filter((r) => r.carId === garage.activeCarId).sort((a, b) => b.at - a.at))
const best = computed(() => (myRuns.value.length ? Math.min(...myRuns.value.map((r) => r.ms)) : null))
function saveRuns(): void {
  try { localStorage.setItem(RUNS_KEY, JSON.stringify(runs.value.slice(-50))) } catch { /* ignore */ }
}
function clearRuns(): void {
  if (!confirm('Удалить историю замеров этой машины?')) return
  runs.value = runs.value.filter((r) => r.carId !== garage.activeCarId)
  saveRuns()
}

/* ---------- замер ---------- */

// Класс-автомат не реактивен — состояние и результат зеркалим в ref.
let timer = new PerformanceTimer()
const state = ref<PerfState>('idle')
const result = ref<PerfResult | null>(null)
const armed = ref(false)
const waitingForStop = ref(false)
const elapsed = ref(0)
const aborted = ref(0)
const points = ref<{ t: number; rpm: number; speed: number }[]>([])
const speed = computed(() => snapshot.value?.speedKmh ?? null)

function arm(): void {
  timer = new PerformanceTimer()
  state.value = 'idle'
  result.value = null
  points.value = []
  elapsed.value = 0
  aborted.value = 0
  waitingForStop.value = true
  armed.value = true
  // Быстрый опрос: только скорость и обороты — так замер точнее, а поездка продолжает записываться.
  pollMode.value = 'fast'
}

function stop(): void {
  armed.value = false
  pollMode.value = 'normal'
}

watch(snapshot, (s) => {
  if (!armed.value || !s || s.speedKmh == null || s.rpm == null) return
  state.value = timer.feed(s.timestamp, s.speedKmh, s.rpm)
  waitingForStop.value = timer.waitingForStop
  aborted.value = timer.aborted
  elapsed.value = timer.elapsedMs
  points.value = timer.samples.map((p) => ({ t: p.t, rpm: p.rpm, speed: p.speedKmh }))
  if (state.value === 'finished' && timer.result) {
    result.value = timer.result
    runs.value.push({ at: Date.now(), carId: garage.activeCarId, ms: timer.result.durationMs, slip: timer.result.warnings.length > 0 })
    saveRuns()
    stop()
  }
})
// Связь пропала посреди замера — снимаем взвод, чтобы кнопки не «зависли».
watch(isConnected, (on) => { if (!on && armed.value) stop() })

onBeforeUnmount(stop)

const seconds = computed(() => num((result.value?.durationMs ?? elapsed.value) / 1000, 1))
const hint = computed(() => {
  if (result.value) return best.value != null && result.value.durationMs <= best.value ? 'Готово — лучший результат' : 'Готово'
  if (!isConnected.value) return 'Подключитесь к адаптеру'
  if (!armed.value) return 'Остановитесь и нажмите «Старт»'
  if (state.value === 'running') return 'Идёт замер…'
  if (waitingForStop.value) return 'Остановитесь полностью — замер идёт с места'
  return aborted.value ? 'Попытка сорвана. Жду старта с места…' : 'Готов. Жду начала движения…'
})
</script>

<template>
  <section class="space-y-2">
    <div class="card p-5 text-center">
      <div class="label">0 → 100 км/ч</div>
      <div class="my-2 font-mono text-7xl font-semibold tabular-nums leading-none" :class="result ? 'text-ok' : 'text-[#d5dae2]'">{{ seconds }}<span class="text-3xl muted"> с</span></div>
      <div class="font-mono text-2xl tabular-nums text-[#aab3c0]">{{ num(speed) }} км/ч</div>
      <div class="mt-2 text-sm" :class="armed && waitingForStop && state === 'idle' ? 'text-warn' : 'muted'">{{ hint }}</div>
    </div>

    <div class="flex gap-2">
      <button class="btn flex-1" :disabled="!isConnected || armed" @click="arm">{{ result ? 'Ещё раз' : 'Старт' }}</button>
      <button class="btn-ghost" :disabled="!armed" @click="stop">Стоп</button>
    </div>

    <div v-if="result?.warnings.length" class="border border-warn p-3 text-sm text-warn">
      <p v-for="w in result.warnings" :key="w">{{ w }}: обороты росли, а скорость стояла на месте.</p>
    </div>

    <div class="card p-3"><RpmChart :points="points" :max-t="result ? result.durationMs : 10000" /></div>

    <div v-if="myRuns.length" class="card p-3">
      <div class="mb-1 flex items-baseline justify-between">
        <h2 class="label">История замеров</h2>
        <button class="link" @click="clearRuns">очистить</button>
      </div>
      <dl class="rows">
        <div v-for="r in myRuns.slice(0, 8)" :key="r.at">
          <dt class="font-mono text-xs">{{ dateTime(r.at) }}<span v-if="r.slip" class="text-warn"> · пробуксовка</span></dt>
          <dd :class="r.ms === best ? 'text-ok' : ''">{{ num(r.ms / 1000, 1) }} с{{ r.ms === best ? ' · лучший' : '' }}</dd>
        </div>
      </dl>
    </div>
    <p class="text-xs text-[#5f6978]">Точность ограничена частотой опроса адаптера (несколько раз в секунду) — сравнивайте результаты между собой, а не с паспортными. Замеряйте только там, где это безопасно и разрешено.</p>
  </section>
</template>
