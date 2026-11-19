<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import { useWeather } from '@/composables/useWeather'
import { condIcon, condText, dayRepresentative, fmtTemp, ROAD_TEXT, windLabel, type RoadState, type TipLevel } from '@/services/WeatherAdvice'
import { num, time } from '@/utils/format'

const { data, advice, loading, error, note, noLocation, refresh } = useWeather()
onMounted(() => { void refresh() })

const open = ref(false)
const VISIBLE = 3
const tips = computed(() => advice.value?.tips ?? [])
const shown = computed(() => (open.value ? tips.value : tips.value.slice(0, VISIBLE)))

const isNight = (h: number): boolean => h < 6 || h >= 21
const now = computed(() => data.value?.now ?? null)
const gust = computed(() => (now.value && now.value.gustMs - now.value.windMs >= 3 ? ` · порывы ${num(now.value.gustMs)}` : ''))

interface Col { label: string; icon: string; text: string; min: number; max: number; prec: number }
const cols = computed<Col[]>(() => {
  const d = data.value
  if (!d) return []
  const out: Col[] = []
  const dates = d.days.map((x) => x.date)
  const today = d.now.date
  const tomorrow = dates.find((x) => x > today)
  for (const [label, date] of [['Сегодня', today], ['Завтра', tomorrow]] as const) {
    const day = d.days.find((x) => x.date === date)
    const rep = dayRepresentative(d.hours.filter((h) => h.date === date))
    if (day && rep) out.push({ label, icon: condIcon(rep), text: condText(rep), min: day.minC, max: day.maxC, prec: day.precMm })
  }
  return out
})

const ROAD_TONE: Record<RoadState, string> = { dry: 'text-ok', wet: 'text-warn', snow: 'text-warn', ice: 'text-bad' }
const TIP_TONE: Record<TipLevel, string> = { bad: 'border-bad/40 bg-bad/10', warn: 'border-warn/40 bg-warn/10', info: 'border-night-600 bg-night-700/50', ok: 'border-ok/30 bg-ok/10' }
const updated = computed(() => (data.value ? time(data.value.fetchedAt) : ''))
</script>

<template>
  <div class="card space-y-3 p-4" aria-label="Погода и дорога">
    <div class="flex items-start gap-3">
      <span v-if="now" class="text-4xl leading-none" aria-hidden="true">{{ condIcon(now, isNight(now.h)) }}</span>
      <div class="min-w-0 flex-1">
        <template v-if="now">
          <div class="flex items-baseline gap-2"><span class="text-3xl font-bold tabular-nums">{{ fmtTemp(now.tempC) }}</span><span class="truncate text-sm text-mute">ощущается {{ fmtTemp(now.feelsC) }}</span></div>
          <div class="truncate text-sm text-soft">{{ condText(now) }}</div>
        </template>
        <template v-else>
          <div class="text-base font-bold">Погода и дорога</div>
          <div class="text-sm text-mute">{{ loading ? 'Загружаю прогноз…' : noLocation ? 'Не знаю, где вы. Нажмите «обновить» и разрешите геолокацию.' : 'Прогноз ещё не загружен' }}</div>
        </template>
      </div>
      <button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-mute active:bg-night-700" :class="loading ? 'animate-spin' : ''" aria-label="Обновить погоду" @click="refresh(true)"><AppIcon name="refresh" :size="20" /></button>
    </div>

    <div v-if="cols.length" class="grid grid-cols-2 gap-2">
      <div v-for="c in cols" :key="c.label" class="rounded-2xl bg-night-700/50 px-3 py-2">
        <div class="flex items-center justify-between text-xs text-mute"><span>{{ c.label }}</span><span aria-hidden="true">{{ c.icon }}</span></div>
        <div class="mt-0.5 text-[15px] font-semibold tabular-nums">{{ fmtTemp(c.min) }} … {{ fmtTemp(c.max) }}</div>
        <div class="truncate text-[11px] text-faint">{{ c.text }}<template v-if="c.prec >= 0.5"> · {{ num(c.prec, c.prec < 10 ? 1 : 0) }} мм</template></div>
      </div>
    </div>

    <div v-if="now && advice" class="flex flex-wrap gap-1.5 text-xs">
      <span class="rounded-full bg-night-700 px-2.5 py-1">Дорога: <b :class="ROAD_TONE[advice.roadNow]">{{ ROAD_TEXT[advice.roadNow] }}</b><template v-if="advice.roadTomorrow"> · завтра <b :class="ROAD_TONE[advice.roadTomorrow]">{{ ROAD_TEXT[advice.roadTomorrow] }}</b></template></span>
      <span class="rounded-full bg-night-700 px-2.5 py-1">Ветер: <b>{{ now.windMs < 1 ? 'штиль' : `${num(now.windMs)} м/с, ${windLabel(now.windMs)}` }}</b>{{ gust }}</span>
      <span v-if="now.visM != null" class="rounded-full bg-night-700 px-2.5 py-1">Видимость: <b :class="now.visM < 1000 ? 'text-warn' : ''">{{ now.visM >= 10_000 ? '10+ км' : now.visM >= 1000 ? `${num(now.visM / 1000, 1)} км` : `${Math.round(now.visM / 10) * 10} м` }}</b></span>
    </div>

    <ul v-if="shown.length" class="space-y-1.5">
      <li v-for="t in shown" :key="t.id" class="flex items-start gap-2.5 rounded-2xl border px-3 py-2.5 text-sm leading-snug" :class="TIP_TONE[t.level]">
        <span class="mt-px text-lg leading-none" aria-hidden="true">{{ t.icon }}</span>
        <span class="min-w-0 flex-1">{{ t.text }}</span>
      </li>
    </ul>
    <button v-if="tips.length > VISIBLE" class="w-full py-1 text-center text-xs text-accent" @click="open = !open">{{ open ? 'Свернуть' : `Ещё ${tips.length - VISIBLE}` }}</button>

    <p v-if="error || note" class="text-xs text-warn">{{ error ?? note }}</p>
    <p v-if="data" class="text-[11px] text-faint">{{ data.source === 'yandex' ? 'Яндекс.Погода' : 'Open-Meteo' }} · обновлено в {{ updated }}</p>
  </div>
</template>
