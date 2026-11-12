<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import { useGarage } from '@/composables/useGarage'
import { useMyTrips } from '@/composables/useMyTrips'
import { useUi } from '@/composables/useUi'
import { useVehicle } from '@/composables/useVehicle'
import { carTitle } from '@/services/Cars'
import { computeStat } from '@/services/HomeStats'
import { READY_C } from '@/services/WarmupTracker'
import { num } from '@/utils/format'

const router = useRouter()
const v = useVehicle()
const { garage, car, serviceItems, oil } = useGarage()
const { since } = useMyTrips()
const { ui, menu } = useUi()
v.pollMode.value = 'normal'

const stats = computed(() => ui.homeStats.slice(0, 3).map((id) => computeStat(id, since(30), car(), garage.fuelPrice, ui.currency)))
const TONES = ['border-[#9b7bff]', 'border-[#4ecda0]', 'border-[#f4b84c]']

/** Что пора обслужить: масло и позиции журнала, у которых выработано ≥ порога или вышел срок. */
const due = computed(() => {
  const list: { name: string; pct: number; bad: boolean }[] = []
  const o = oil()
  if (o.configured && (o.pct >= ui.warnPct || o.overdueByTime)) list.push({ name: 'Моторное масло', pct: o.pct, bad: o.level === 'bad' })
  for (const { it, st } of serviceItems()) if (st.configured && (st.pct >= ui.warnPct || st.overdueByTime)) list.push({ name: it.name, pct: st.pct, bad: st.level === 'bad' })
  return list.sort((a, b) => b.pct - a.pct)
})

const live = computed(() => {
  const s = v.snapshot.value
  return [
    { k: 'Скорость', v: num(s?.speedKmh), u: 'км/ч' },
    { k: 'Обороты', v: num(s?.rpm), u: 'об/мин' },
    { k: 'Темп. ОЖ', v: num(s?.coolantTempC), u: '°C' },
    { k: 'Бортсеть', v: num(s?.voltage, 1), u: 'В' },
  ]
})
const go = (to: string): void => { void router.push(to) }
</script>

<template>
  <section class="space-y-3">
    <!-- Карточка автомобиля -->
    <div class="card overflow-hidden">
      <div class="flex items-center gap-3 px-4 py-3">
        <button class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="go('/garage')">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><AppIcon name="car" /></span>
          <span class="min-w-0"><span class="block truncate text-base font-bold">{{ carTitle(car()) }}</span><span class="block truncate text-xs text-mute">{{ car().engineCode || car().fuel || 'Нажмите, чтобы изменить' }}</span></span>
        </button>
        <button v-if="v.status.value === 'disconnected'" class="shrink-0 rounded-full border border-accent px-4 py-1.5 text-sm font-semibold text-accent active:bg-accent-soft" @click="v.connect()">Соединение</button>
        <button v-else class="shrink-0 rounded-full border border-night-600 px-4 py-1.5 text-sm font-semibold text-mute active:bg-night-700" @click="v.disconnect()">{{ v.status.value === 'connecting' ? 'Отмена' : 'Отключить' }}</button>
      </div>
      <button class="grid w-full grid-cols-3 text-left" aria-label="Изменить показатели" @click="go('/edit-home')">
        <div v-for="(s, i) in stats" :key="i" class="min-w-0 border-t-[3px] px-4 pb-3 pt-2.5" :class="TONES[i]">
          <div class="truncate text-xs text-mute">{{ s.label }}</div>
          <div class="mt-1 truncate text-xl font-bold tabular-nums">{{ s.value }}</div>
          <div class="truncate text-[11px] text-faint">{{ s.unit || ' ' }}</div>
        </div>
      </button>
    </div>

    <!-- Живые показания или призыв подключиться -->
    <button v-if="!v.isConnected.value && v.status.value !== 'connecting'" class="flex w-full items-center gap-3 rounded-2xl bg-gradient-to-br from-[#3b2a8f] to-[#1c1450] border border-white/10 p-4 text-left text-white shadow-card active:opacity-90" @click="go('/connection')">
      <span class="min-w-0 flex-1"><span class="block text-xs text-white/70">Сначала нужно подключить сканер</span><span class="mt-0.5 block text-base font-bold">Перейти к подключению сканера ›</span></span>
      <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15"><AppIcon name="bluetooth" :size="28" /></span>
    </button>
    <div v-else class="card p-3">
      <div class="grid grid-cols-4 gap-1 text-center">
        <div v-for="l in live" :key="l.k" class="min-w-0"><div class="truncate text-[11px] text-mute">{{ l.k }}</div><div class="text-xl font-bold tabular-nums">{{ l.v }}</div><div class="text-[10px] text-faint">{{ l.u }}</div></div>
      </div>
      <template v-if="v.warmupInfo.value.state === 'warming'">
        <div class="mt-3 flex items-baseline justify-between text-xs"><b class="text-warn">Двигатель прогревается</b><span class="text-mute">{{ num(v.warmupInfo.value.tempC) }} / {{ READY_C }} °C<template v-if="v.warmupInfo.value.etaMin != null"> · ~{{ v.warmupInfo.value.etaMin }} мин</template></span></div>
        <div class="mt-1.5 h-2 overflow-hidden rounded-full bg-night-700"><div class="h-full rounded-full bg-warn transition-all" :style="{ width: Math.round(v.warmupInfo.value.progress * 100) + '%' }" /></div>
      </template>
      <p v-else-if="v.warmupInfo.value.state === 'ready' && (v.snapshot.value?.coolantTempC ?? 0) >= READY_C" class="mt-2 text-center text-xs font-medium text-ok">Двигатель прогрет — можно ехать</p>
      <p v-if="v.tripActive.value" class="mt-2 text-center text-xs font-medium text-ok">● Идёт запись поездки</p>
    </div>

    <RouterLink v-if="v.milOn.value" to="/diagnostics" class="flex items-center gap-3 rounded-2xl border border-bad/40 bg-bad/10 p-3 text-bad">
      <span class="mil h-9 w-9 text-xl">!</span>
      <span class="text-sm"><b>Горит Check Engine.</b> Нажмите, чтобы считать коды ошибок.</span>
    </RouterLink>

    <RouterLink v-if="due.length" to="/service" class="flex items-center gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-3">
      <AppIcon name="wrench" class="shrink-0 text-warn" />
      <span class="min-w-0 text-sm"><b class="text-warn">Пора обслужить:</b> <span class="text-soft">{{ due.slice(0, 3).map((d) => d.name.toLowerCase()).join(', ') }}<template v-if="due.length > 3"> и ещё {{ due.length - 3 }}</template></span></span>
    </RouterLink>

    <!-- Плитки разделов -->
    <div class="grid grid-cols-3 gap-2.5">
      <RouterLink v-for="m in menu()" :key="m.id" :to="m.to" class="card flex min-h-[7.25rem] flex-col items-center justify-center gap-2.5 px-1.5 py-3 text-center transition active:scale-[0.97] active:bg-night-700">
        <AppIcon :name="m.icon" :size="34" class="text-accent" />
        <span class="text-[13px] font-medium leading-tight text-ink">{{ m.title }}</span>
      </RouterLink>
    </div>
    <RouterLink to="/edit-home" class="block py-2 text-center text-xs text-faint underline underline-offset-2">Настроить главный экран</RouterLink>
  </section>
</template>
