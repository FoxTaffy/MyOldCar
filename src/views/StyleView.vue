<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BarChart from '@/components/BarChart.vue'
import PageHeader from '@/components/PageHeader.vue'
import RingGauge from '@/components/RingGauge.vue'
import Segmented from '@/components/Segmented.vue'
import { useMyTrips } from '@/composables/useMyTrips'
import { useUi } from '@/composables/useUi'
import { avgScore, scoreByDay, scoreLabel, summarize, type StyleKind } from '@/services/DrivingStyle'
import { dayKey, int, num, span } from '@/utils/format'

const { trips } = useMyTrips()
const { ui } = useUi()
const kind = ref<StyleKind>('safety')
const mode = ref<'day' | 'month'>('day')
const MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']

const now = new Date()
const todayKey = dayKey(now.getTime())
const sel = ref(todayKey)
const monthOf = (k: string): string => k.slice(0, 7)

/** Столбики: 14 последних дней или 6 последних месяцев. */
const days = computed(() => Array.from({ length: 14 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (13 - i)); return { key: dayKey(d.getTime()), label: String(d.getDate()) } }))
const months = computed(() => Array.from({ length: 6 }, (_, i) => { const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1); return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: MONTHS[d.getMonth()] } }))
const byDay = computed(() => scoreByDay(trips.value, kind.value))
const items = computed(() => (mode.value === 'day'
  ? days.value.map((d) => ({ ...d, value: byDay.value[d.key] ?? null }))
  : months.value.map((m) => ({ ...m, value: avgScore(trips.value.filter((t) => monthOf(dayKey(t.start)) === m.key), kind.value) }))))
function setMode(m: string): void { mode.value = m as 'day' | 'month'; sel.value = m === 'day' ? todayKey : monthOf(todayKey) }

const inPeriod = computed(() => trips.value.filter((t) => (mode.value === 'day' ? dayKey(t.start) === sel.value : monthOf(dayKey(t.start)) === sel.value)))
const score = computed(() => avgScore(inPeriod.value, kind.value))
const sum = computed(() => summarize(inPeriod.value))
const titleOfPeriod = computed(() => {
  if (mode.value === 'month') return MONTHS[Number(sel.value.slice(5)) - 1]
  const [, m, d] = sel.value.split('-').map(Number)
  return sel.value === todayKey ? 'сегодня' : `${d} ${MONTHS[m - 1]}`
})
const tone = computed(() => (score.value == null ? 'text-faint' : score.value >= 75 ? 'text-ok' : score.value >= 55 ? 'text-warn' : 'text-bad'))
const noStyle = computed(() => inPeriod.value.length > 0 && inPeriod.value.every((t) => !t.style))
const hm = (ms: number): string => (ms > 0 ? span(ms) : '0 м')

const rows = computed(() => [
  { icon: 'route', k: 'Дистанция', v: `${num(sum.value.km, 1)} км` },
  { icon: 'stopwatch', k: 'Время в пути', v: hm(sum.value.movingMs + sum.value.stoppedMs) },
  { icon: 'gauge', k: 'Средняя скорость', v: `${num(sum.value.avgSpeed, 0)} км/ч` },
  { icon: 'up', k: 'Макс. скорость', v: `${num(sum.value.maxSpeed, 0)} км/ч` },
  { icon: 'engine', k: 'Средние обороты', v: sum.value.avgRpm != null ? `${int(sum.value.avgRpm)} об/мин` : '—' },
  { icon: 'up', k: 'Макс. обороты', v: sum.value.maxRpm != null ? `${int(sum.value.maxRpm)} об/мин` : '—' },
  { icon: 'warn', k: 'Превышение скорости', s: `Скорость выше ${ui.speedLimit} км/ч дольше 3 секунд`, v: `${sum.value.over} раз`, v2: `${num(sum.value.overKm, 1)} км` },
  { icon: 'route', k: 'Резкое ускорение', s: 'Разгон быстрее 7 км/ч за секунду', v: `${sum.value.accel} раз` },
  { icon: 'down', k: 'Резкое торможение', s: 'Замедление быстрее 9 км/ч за секунду', v: `${sum.value.brake} раз` },
  { icon: 'moon', k: 'Ночное вождение', s: 'С 22:00 до 06:00', v: hm(sum.value.nightMs), v2: `${num(sum.value.nightKm, 1)} км` },
])
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Стиль вождения" />
    <div class="card px-2"><Segmented :options="[{ id: 'safety', label: 'Безопасность' }, { id: 'eco', label: 'Эко' }]" :model-value="kind" underline @update:model-value="kind = $event as StyleKind" /></div>

    <div class="card flex items-center gap-4 p-5">
      <div class="min-w-0 flex-1">
        <div class="text-sm font-semibold text-mute">{{ titleOfPeriod }}</div>
        <div class="mt-1 text-2xl font-bold leading-tight" :class="tone">{{ scoreLabel(score) }}</div>
        <p class="mt-2 text-xs leading-snug text-faint">{{ kind === 'safety' ? 'Оценка складывается из резких разгонов и торможений и превышений скорости: чем плавнее, тем выше.' : 'Оценка учитывает простои с работающим двигателем, высокие обороты и резкие манёвры.' }}</p>
      </div>
      <div class="relative shrink-0">
        <RingGauge :value="score" :min="0" :max="100" :level="score == null ? 'ok' : score >= 75 ? 'ok' : score >= 55 ? 'warn' : 'bad'" :size="116" />
        <span class="absolute inset-0 flex items-center justify-center text-4xl font-black tabular-nums">{{ score ?? '—' }}</span>
      </div>
    </div>

    <div class="card p-4">
      <div class="mb-3 flex items-center justify-between"><h2 class="text-lg font-bold">Отчёт</h2><Segmented :options="[{ id: 'day', label: 'день' }, { id: 'month', label: 'месяц' }]" :model-value="mode" @update:model-value="setMode" /></div>
      <BarChart :items="items" :selected="sel" :max="100" :marks="[70]" @pick="sel = $event" />
      <p class="mt-2 text-center text-xs text-faint">Нажмите на столбик, чтобы посмотреть детали за этот {{ mode === 'day' ? 'день' : 'месяц' }}.</p>
    </div>

    <h2 class="h-section">Детали вождения · {{ titleOfPeriod }}</h2>
    <p v-if="!inPeriod.length" class="card p-4 text-center text-sm text-mute">За этот период поездок нет. Запись идёт автоматически, пока приложение подключено к сканеру или GPS.</p>
    <p v-else-if="noStyle" class="rounded-xl bg-warn/10 px-3 py-2 text-xs text-warn">Эти поездки записаны до появления оценки стиля — разгоны, торможения и превышения для них не посчитаны.</p>
    <div v-if="inPeriod.length" class="card divide-y divide-night-600">
      <div v-for="r in rows" :key="r.k" class="flex items-center gap-3 px-4 py-3">
        <AppIcon :name="r.icon" :size="22" class="shrink-0 text-faint" />
        <div class="min-w-0 flex-1"><div class="text-[15px]">{{ r.k }}</div><div v-if="r.s" class="text-[11px] leading-tight text-faint">{{ r.s }}</div></div>
        <div class="text-right font-bold tabular-nums"><div>{{ r.v }}</div><div v-if="r.v2" class="text-xs font-medium text-mute">{{ r.v2 }}</div></div>
      </div>
    </div>
  </section>
</template>
