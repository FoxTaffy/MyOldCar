<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import ExpenseSheet from '@/components/ExpenseSheet.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useWash } from '@/composables/useWash'
import { fmt } from '@/services/Wash'
import { num } from '@/utils/format'

const { advice, lastWash, kmSince, weather, loading, noLocation, refresh } = useWash()
const sheet = ref(false)
onMounted(() => { void refresh() })

const tone = computed(() => ({
  clean: { box: 'border-ok/40 bg-ok/10', text: 'text-ok', bar: 'bg-ok' },
  ok: { box: 'border-ok/40 bg-ok/10', text: 'text-ok', bar: 'bg-ok' },
  soon: { box: 'border-warn/40 bg-warn/10', text: 'text-warn', bar: 'bg-warn' },
  now: { box: 'border-bad/40 bg-bad/10', text: 'text-bad', bar: 'bg-bad' },
  wait: { box: 'border-accent/40 bg-accent-soft', text: 'text-accent', bar: 'bg-accent' },
  frost: { box: 'border-accent/40 bg-accent-soft', text: 'text-accent', bar: 'bg-accent' },
}[advice.value.level]))
const upcoming = computed(() => weather.value.filter((d) => d.date >= new Date().toISOString().slice(0, 10)).slice(0, 4))
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Умная мойка" />

    <div class="rounded-2xl border p-4" :class="tone.box">
      <div class="flex items-center gap-3">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-night-800" :class="tone.text"><AppIcon name="shower" :size="30" /></span>
        <div class="min-w-0"><div class="text-xl font-black leading-tight" :class="tone.text">{{ advice.title }}</div><div class="text-xs text-mute">Загрязнённость {{ advice.dirt }} из 100</div></div>
      </div>
      <div class="mt-3 h-2.5 overflow-hidden rounded-full bg-night-700"><div class="h-full rounded-full transition-all duration-700" :class="tone.bar" :style="{ width: Math.max(4, advice.dirt) + '%' }" /></div>
      <ul class="mt-3 space-y-1.5 text-sm text-soft">
        <li v-for="(r, i) in advice.reasons" :key="i" class="flex gap-2"><span class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-faint" />{{ r }}</li>
      </ul>
    </div>

    <div class="tiles grid-cols-3">
      <div><div class="label">Последняя мойка</div><div class="mt-1 text-base font-bold">{{ lastWash ? fmt(lastWash) : '—' }}</div></div>
      <div><div class="label">Дней назад</div><div class="mt-1 text-base font-bold">{{ advice.daysSince ?? '—' }}</div></div>
      <div><div class="label">Пробег</div><div class="mt-1 text-base font-bold">{{ num(kmSince, 0) }} км</div></div>
    </div>

    <div class="card p-3">
      <div class="mb-2 flex items-center justify-between"><span class="label">Погода рядом</span><button class="link" :disabled="loading" @click="refresh(true)">{{ loading ? 'загрузка…' : 'обновить' }}</button></div>
      <div v-if="upcoming.length" class="grid grid-cols-4 gap-2 text-center">
        <div v-for="d in upcoming" :key="d.date" class="rounded-xl bg-night-700 px-1 py-2">
          <div class="text-[11px] text-mute">{{ d.date.slice(8) }}.{{ d.date.slice(5, 7) }}</div>
          <div class="mt-0.5 text-lg" :class="d.rainMm >= 2 ? 'text-accent' : 'text-soft'">{{ d.rainMm >= 2 ? '🌧' : d.minC != null && d.minC <= -5 ? '❄' : '☀' }}</div>
          <div class="text-[11px] tabular-nums text-faint">{{ d.minC != null ? Math.round(d.minC) + '°' : '' }} {{ d.rainMm >= 0.5 ? num(d.rainMm, 0) + ' мм' : '' }}</div>
        </div>
      </div>
      <p v-else class="text-sm text-mute">{{ noLocation ? 'Прогноз появится, когда приложение узнает ваше место (включите геопозицию и проедьтесь). Совет выше считается и без него.' : 'Прогноз пока не загружен — нужен интернет.' }}</p>
    </div>

    <button class="btn w-full" @click="sheet = true">Я помыл машину — записать</button>
    <p class="text-center text-xs text-faint">Запись попадает в «Журнал обслуживания → Мойка» и сбрасывает счётчик. Совет учитывает дни с мойки, пробег, дожди, сезон соли и прогноз (бесплатный сервис Open-Meteo).</p>
    <ExpenseSheet v-if="sheet" cat="wash" @close="sheet = false" />
  </section>
</template>
