<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import WeatherCard from '@/components/WeatherCard.vue'
import { useGarage } from '@/composables/useGarage'
import { useMyTrips } from '@/composables/useMyTrips'
import { useUi } from '@/composables/useUi'
import { useWash } from '@/composables/useWash'
import { useVehicle } from '@/composables/useVehicle'
import { carTitle } from '@/services/Cars'
import { computeStat } from '@/services/HomeStats'
import { MOTION_TEXT } from '@/services/MotionState'
import { READY_C } from '@/services/WarmupTracker'
import { num } from '@/utils/format'

const router = useRouter()
const v = useVehicle()
const { garage, car, serviceItems, oil } = useGarage()
const { since } = useMyTrips()
const { ui, menu } = useUi()
const wash = useWash()
onMounted(() => { void wash.refresh() })
v.pollMode.value = 'normal'

const stats = computed(() => ui.homeStats.slice(0, 3).map((id) => computeStat(id, since(30), car(), garage.fuelPrice, ui.currency)))

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
    <!-- Карточка автомобиля: шапка + три показателя в одной строке, как шкалы щитка -->
    <div class="card overflow-hidden">
      <div class="flex items-center gap-3 px-4 py-3">
        <button class="flex min-w-0 flex-1 items-center gap-3 text-left" @click="go('/garage')">
          <BrandLogo :make="car().make" :size="40" />
          <span class="min-w-0">
            <span class="block truncate text-base font-semibold">{{ carTitle(car()) }}</span>
            <span class="mt-0.5 block truncate text-xs text-mute"><span v-if="car().engineCode" class="plate">{{ car().engineCode }}</span><template v-else>{{ car().fuel || 'Нажмите, чтобы изменить' }}</template></span>
          </span>
        </button>
        <button v-if="v.status.value === 'disconnected'" class="btn btn-sm shrink-0" @click="v.connect()">Соединение</button>
        <button v-else class="btn-ghost btn-sm shrink-0" @click="v.disconnect()">{{ v.status.value === 'connecting' ? 'Отмена' : 'Отключить' }}</button>
      </div>
      <button class="grid w-full grid-cols-3 divide-x divide-night-600 border-t border-night-600 text-left" aria-label="Изменить показатели" @click="go('/edit-home')">
        <div v-for="(s, i) in stats" :key="i" class="min-w-0 px-4 pb-3 pt-2.5">
          <div class="truncate text-xs text-mute">{{ s.label }}</div>
          <div class="mt-1 truncate text-2xl font-semibold tabular-nums">{{ s.value }}</div>
          <div class="truncate text-[11px] text-faint">{{ s.unit || ' ' }}</div>
        </div>
      </button>
    </div>

    <!-- Автоподключение остановилось: ждём ручного нажатия -->
    <div v-if="v.awaitingManual.value && v.status.value === 'disconnected'" class="flex items-center gap-3 rounded-lg border border-warn/50 bg-warn/10 p-3">
      <span class="min-w-0 flex-1 text-sm"><b class="text-warn">Адаптер не найден.</b> <span class="text-soft">Поиск остановлен, чтобы не разряжать телефон. Подключитесь, когда будете рядом с машиной.</span></span>
      <button class="btn btn-sm shrink-0" @click="v.connect()">Подключить</button>
    </div>

    <!-- Живые показания или призыв подключиться -->
    <button v-else-if="!v.isConnected.value && v.status.value !== 'connecting'" class="flex w-full items-center gap-3 rounded-xl bg-accent p-4 text-left text-accent-on active:bg-accent-glow" @click="go('/connection')">
      <span class="min-w-0 flex-1"><span class="block text-xs opacity-80">Сканер не подключён</span><span class="mt-0.5 block text-base font-semibold">Подключить сканер</span></span>
      <AppIcon name="bluetooth" :size="26" />
    </button>
    <div v-else class="card">
      <div class="grid grid-cols-4 divide-x divide-night-600">
        <div v-for="l in live" :key="l.k" class="min-w-0 px-2 py-3 text-center"><div class="truncate text-[11px] text-mute">{{ l.k }}</div><div class="text-2xl font-semibold tabular-nums">{{ l.v }}</div><div class="text-[10px] text-faint">{{ l.u }}</div></div>
      </div>
      <div v-if="v.warmupInfo.value.state === 'warming' || v.motion.value || v.tripActive.value || (v.warmupInfo.value.state === 'ready' && (v.snapshot.value?.coolantTempC ?? 0) >= READY_C)" class="border-t border-night-600 px-4 py-2.5">
        <template v-if="v.warmupInfo.value.state === 'warming'">
          <div class="flex items-baseline justify-between text-xs"><b class="text-warn">Двигатель прогревается</b><span class="text-mute">{{ num(v.warmupInfo.value.tempC) }} / {{ READY_C }} °C<template v-if="v.warmupInfo.value.etaMin != null"> · ~{{ v.warmupInfo.value.etaMin }} мин</template></span></div>
          <div class="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-night-700"><div class="h-full bg-warn transition-all" :style="{ width: Math.round(v.warmupInfo.value.progress * 100) + '%' }" /></div>
        </template>
        <p v-else-if="v.warmupInfo.value.state === 'ready' && (v.snapshot.value?.coolantTempC ?? 0) >= READY_C" class="text-xs font-medium text-ok">Двигатель прогрет — можно ехать</p>
        <p v-if="v.motion.value" class="text-xs font-medium" :class="v.motion.value.kind === 'driving' ? 'text-ok' : 'text-mute'">
          {{ MOTION_TEXT[v.motion.value.kind] }}<template v-if="v.motion.value.gear"> · {{ v.motion.value.gear }}-я передача</template>
          <template v-if="v.motion.value.obdSpeedSuspect"> · датчик скорости OBD врёт, беру GPS</template>
        </p>
        <p v-if="v.tripActive.value" class="text-xs font-medium text-ok">Идёт запись поездки</p>
      </div>
    </div>

    <RouterLink v-if="v.milOn.value" to="/diagnostics" class="flex items-center gap-3 rounded-lg border border-bad/50 bg-bad/10 p-3 text-bad">
      <span class="mil h-9 w-9 text-xl">!</span>
      <span class="text-sm"><b>Горит Check Engine.</b> Нажмите, чтобы считать коды ошибок.</span>
    </RouterLink>

    <RouterLink v-if="due.length" to="/service" class="flex items-center gap-3 rounded-lg border border-warn/50 bg-warn/10 p-3">
      <AppIcon name="wrench" class="shrink-0 text-warn" />
      <span class="min-w-0 text-sm"><b class="text-warn">Пора обслужить:</b> <span class="text-soft">{{ due.slice(0, 3).map((d) => d.name.toLowerCase()).join(', ') }}<template v-if="due.length > 3"> и ещё {{ due.length - 3 }}</template></span></span>
    </RouterLink>

    <RouterLink v-if="wash.advice.value.level === 'now' || wash.advice.value.level === 'soon' || wash.advice.value.level === 'frost' || wash.advice.value.level === 'wait'" to="/wash" class="flex items-center gap-3 rounded-lg border border-night-600 bg-accent-soft p-3">
      <AppIcon name="shower" class="shrink-0 text-accent" />
      <span class="min-w-0 text-sm"><b class="text-accent">{{ wash.advice.value.title }}.</b> <span class="text-soft">{{ wash.advice.value.reasons[wash.advice.value.reasons.length - 1] }}</span></span>
    </RouterLink>

    <WeatherCard v-if="ui.weatherCard" />

    <!-- Разделы: список-сетка с тонкими разделителями, иконка слева от названия -->
    <div class="tiles grid-cols-2">
      <RouterLink v-for="m in menu()" :key="m.id" :to="m.to" class="flex min-h-[3.5rem] items-center gap-3 bg-night-800 px-3 py-2.5 text-left transition-colors active:bg-night-700">
        <AppIcon :name="m.icon" :size="24" class="shrink-0 text-accent" />
        <span class="min-w-0 text-sm font-medium leading-tight text-ink">{{ m.title }}</span>
      </RouterLink>
    </div>
    <RouterLink to="/edit-home" class="block py-2 text-center text-xs text-mute underline underline-offset-2">Настроить главный экран</RouterLink>
  </section>
</template>
