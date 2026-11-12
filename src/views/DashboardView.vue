<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import GaugeTile from '@/components/GaugeTile.vue'
import OilGauge from '@/components/OilGauge.vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { Ema, fuelLitersPer100Km, fuelLitersPerHour } from '@/services/FuelCalculator'
import { liters, num, span } from '@/utils/format'
import { READY_C } from '@/services/WarmupTracker'
import type { Level } from '@/types'

const { snapshot, pollMode, isConnected, status, prefs, ecuSilent, tripLive, milOn, gpsState, gpsFix, gpsError, tripActive, warmupInfo, endTrip, startGps, openGpsSettings } = useVehicle()
const { garage, car, oil } = useGarage()
pollMode.value = 'normal'

const speedLevel = (v: number | null): Level => (v == null || v < 90 ? 'ok' : v < 110 ? 'warn' : 'bad')
const rpmLevel = (v: number | null): Level => (v == null || v < 4000 ? 'ok' : v < 5500 ? 'warn' : 'bad')
// Холодный двигатель — жёлтый, нормальный — зелёный, перегрев — красный.
const tempLevel = (v: number | null): Level => (v == null ? 'ok' : v < 70 ? 'warn' : v <= 100 ? 'ok' : v <= 108 ? 'warn' : 'bad')
const fuelLevel = (v: number | null): Level => (v == null || v < 9 ? 'ok' : v < 13 ? 'warn' : 'bad')
const tempHint = (v: number | null | undefined): string | undefined => (v == null ? undefined : v < 70 ? 'прогрев' : v > 108 ? 'ПЕРЕГРЕВ' : v > 100 ? 'горячо' : undefined)

// Сглаженный расход: л/100 км в движении, л/ч на месте. Без данных ДМРВ плитка пустая, а не «залипшая».
const emaHour = new Ema(0.25)
const emaPer100 = new Ema(0.15)
const litersHour = ref<number | null>(null)
const litersPer100 = ref<number | null>(null)

watch(snapshot, (s) => {
  if (!s || s.mafGs == null) {
    emaHour.reset()
    emaPer100.reset()
    litersHour.value = litersPer100.value = null
    return
  }
  litersHour.value = emaHour.push(fuelLitersPerHour(s.mafGs))
  const inst = fuelLitersPer100Km(s.mafGs, s.speedKmh ?? 0)
  if (inst === null) emaPer100.reset()
  litersPer100.value = inst === null ? null : emaPer100.push(inst)
}, { immediate: true })

const fuel = computed(() =>
  litersPer100.value !== null
    ? { value: num(litersPer100.value, 1), unit: 'л/100 км', level: fuelLevel(litersPer100.value) }
    : { value: num(litersHour.value, 1), unit: litersHour.value === null ? 'л/100 км' : 'л/ч · на месте', level: 'ok' as Level },
)

/** Допустимые значения: коррекции топливоподачи в пределах ±10% — норма, до ±20% — внимание. */
const trimLevel = (v: number | null | undefined): Level => (v == null || Math.abs(v) <= 10 ? 'ok' : Math.abs(v) <= 20 ? 'warn' : 'bad')
/** Заведённый двигатель: 13,2–14,8 В — норма. При заглушенном 12+ В — тоже нормально. */
const voltLevel = (v: number | null | undefined, rpm: number | null | undefined): Level => {
  if (v == null) return 'ok'
  if ((rpm ?? 0) < 400) return v >= 12 ? 'ok' : v >= 11.5 ? 'warn' : 'bad'
  return v >= 13.2 && v <= 14.8 ? 'ok' : v >= 12.4 && v <= 15.2 ? 'warn' : 'bad'
}
const color = (l: Level) => ({ ok: 'text-[#d5dae2]', warn: 'text-warn', bad: 'text-bad' }[l])
const signed = (v: number): string => (v > 0 ? '+' : '') + num(v, 1)

const rows = computed(() => {
  const s = snapshot.value
  return [
    { k: 'ДМРВ', v: s?.mafGs != null ? `${num(s.mafGs, 2)} г/с · ${num(s.mafGs * 3.6, 1)} кг/ч` : '—', l: 'ok' as Level },
    { k: 'Нагрузка', v: s?.loadPct != null ? `${num(s.loadPct, 0)} %` : '—', l: 'ok' as Level },
    { k: 'Дроссель', v: s?.throttlePct != null ? `${num(s.throttlePct, 0)} %` : '—', l: 'ok' as Level },
    { k: 'Напряжение', v: s?.voltage != null ? `${num(s.voltage, 1)} В` : '—', l: voltLevel(s?.voltage, s?.rpm) },
    { k: 'Темп. впуска', v: s?.intakeTempC != null ? `${num(s.intakeTempC, 0)} °C` : '—', l: 'ok' as Level },
    { k: 'Коррекция кратковр. (STFT)', v: s?.stft != null ? `${signed(s.stft)} %` : '—', l: trimLevel(s?.stft) },
    { k: 'Коррекция долговр. (LTFT)', v: s?.ltft != null ? `${signed(s.ltft)} %` : '—', l: trimLevel(s?.ltft) },
  ]
})

const trip = computed(() => {
  const t = tripLive.value
  return {
    km: t.distanceKm,
    avg: t.movingMs ? t.distanceKm / (t.movingMs / 3_600_000) : null,
    l100: t.distanceKm >= 0.5 && t.fuelL > 0 ? (t.fuelL / t.distanceKm) * 100 : null,
    time: t.movingMs + t.stoppedMs,
    fuel: t.fuelL > 0 ? t.fuelL : null,
    cost: t.fuelL > 0 ? t.fuelL * garage.fuelPrice : null,
  }
})

const gpsText = computed(() => {
  switch (gpsState.value) {
    case 'on': return gpsFix.value ? `±${Math.round(gpsFix.value.accuracy)} м` : 'ищу спутники…'
    case 'denied': return 'нет доступа'
    case 'starting': return 'запуск…'
    case 'error': return 'ошибка'
    default: return prefs.mode === 'mock' ? 'симуляция' : 'выкл'
  }
})
</script>

<template>
  <section class="space-y-2">
    <RouterLink v-if="milOn" to="/diagnostics" class="flex items-center gap-3 border border-bad p-3 text-bad">
      <span class="mil h-8 w-8 text-xl">!</span>
      <span class="text-sm"><b>Горит Check Engine.</b> Нажмите, чтобы считать коды. Место, где лампа загорелась, отмечено «!» на карте поездки.</span>
    </RouterLink>
    <p v-if="status === 'disconnected'" class="border border-night-600 p-3 text-sm muted">
      Нет связи с адаптером. Нажмите «Подключить»{{ prefs.mode === 'mock' ? ' — в демо-режиме данные симулируются' : '' }}.
    </p>
    <p v-else-if="ecuSilent" class="border border-warn p-3 text-sm text-warn">
      Адаптер на связи, но ЭБУ не отвечает. Включите зажигание — показания появятся сами.
    </p>
    <div v-if="isConnected && warmupInfo.state === 'warming'" class="border border-warn p-3">
      <div class="flex items-baseline justify-between text-sm">
        <b class="text-warn">Двигатель прогревается</b>
        <span class="font-mono text-xs muted">{{ num(warmupInfo.tempC) }} / {{ READY_C }} °C<template v-if="warmupInfo.etaMin != null"> · ~{{ warmupInfo.etaMin }} мин</template></span>
      </div>
      <div class="mt-2 h-1.5 bg-night-600"><div class="h-full bg-warn transition-all" :style="{ width: Math.round(warmupInfo.progress * 100) + '%' }" /></div>
      <p class="mt-2 text-xs muted">Когда ОЖ дойдёт до {{ READY_C }} °C, придёт уведомление — можно ехать.</p>
    </div>
    <div v-else-if="isConnected && warmupInfo.state === 'ready' && (snapshot?.coolantTempC ?? 0) >= READY_C" class="border border-ok p-2 text-sm text-ok">Двигатель прогрет — можно ехать.</div>

    <div class="grid grid-cols-2 gap-2">
      <GaugeTile label="Скорость" :value="num(snapshot?.speedKmh)" unit="км/ч" :level="speedLevel(snapshot?.speedKmh ?? null)" />
      <GaugeTile label="Обороты" :value="num(snapshot?.rpm)" unit="об/мин" :level="rpmLevel(snapshot?.rpm ?? null)" />
      <GaugeTile label="Темп. ОЖ" :value="num(snapshot?.coolantTempC)" unit="°C" :level="tempLevel(snapshot?.coolantTempC ?? null)" :hint="tempHint(snapshot?.coolantTempC)" />
      <GaugeTile label="Расход" :value="fuel.value" :unit="fuel.unit" :level="fuel.level" />
    </div>

    <div class="card p-3">
      <div class="label mb-1">Датчики</div>
      <dl class="rows">
        <div v-for="r in rows" :key="r.k">
          <dt>{{ r.k }}</dt>
          <dd :class="color(r.l)">{{ r.v }}</dd>
        </div>
      </dl>
    </div>

    <div class="card p-3">
      <div class="mb-2 flex items-center justify-between gap-2">
        <span class="label">Поездка<span v-if="tripActive" class="text-ok"> · идёт запись</span></span>
        <span class="shrink-0 font-mono text-[11px] muted">GPS: {{ gpsText }}</span>
      </div>
      <div v-if="gpsState === 'denied' || gpsState === 'error'" class="mb-2 border border-warn p-2 text-xs">
        <p class="font-mono text-warn">{{ gpsError ?? 'GPS недоступен' }}</p>
        <div class="mt-2 flex gap-2">
          <button class="btn-ghost btn-sm" @click="openGpsSettings()">Открыть настройки</button>
          <button class="btn-ghost btn-sm" @click="startGps()">Запросить снова</button>
        </div>
      </div>
      <dl v-if="tripActive" class="grid grid-cols-3 gap-x-2 gap-y-3 text-center">
        <div><dt class="label">км</dt><dd class="font-mono text-lg tabular-nums">{{ num(trip.km, 1) }}</dd></div>
        <div><dt class="label">время</dt><dd class="font-mono text-lg tabular-nums">{{ span(trip.time) }}</dd></div>
        <div><dt class="label">ср. км/ч</dt><dd class="font-mono text-lg tabular-nums">{{ num(trip.avg, 0) }}</dd></div>
        <div><dt class="label">л/100</dt><dd class="font-mono text-lg tabular-nums">{{ num(trip.l100, 1) }}</dd></div>
        <div><dt class="label">литров</dt><dd class="font-mono text-lg tabular-nums">{{ liters(trip.fuel) }}</dd></div>
        <div><dt class="label">₽</dt><dd class="font-mono text-lg tabular-nums">{{ num(trip.cost, 0) }}</dd></div>
      </dl>
      <p v-else class="text-sm muted">Запись начнётся сама, как только заведётся двигатель или машина тронется.</p>
      <div v-if="tripActive" class="mt-3 grid grid-cols-2 gap-2">
        <RouterLink to="/trip/live" class="btn-ghost btn-sm text-center">Карта поездки</RouterLink>
        <button class="btn-ghost btn-sm" @click="endTrip()">Завершить</button>
      </div>
    </div>

    <RouterLink to="/service" class="card block p-3">
      <OilGauge :status="oil()" :interval-km="car().oil.intervalKm" :changed-at="car().oil.dateISO" />
    </RouterLink>
    <p v-if="!isConnected && status === 'connecting'" class="text-center text-xs muted">Идёт подключение — первый поиск протокола ЭБУ может занять до минуты.</p>
  </section>
</template>
