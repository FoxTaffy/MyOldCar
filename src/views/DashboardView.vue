<script setup lang="ts">
import { computed, watch } from 'vue'
import GaugeTile from '@/components/GaugeTile.vue'
import OilGauge from '@/components/OilGauge.vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { Ema, fuelLitersPer100Km, fuelLitersPerHour } from '@/services/FuelCalculator'
import { duration, num } from '@/utils/format'
import type { Level } from '@/types'

const { snapshot, pollMode, isConnected, tripLive, milOn, gpsState, gpsFix, tripActive, endTrip } = useVehicle()
const { garage, car, oil } = useGarage()
pollMode.value = 'normal'

const fmt = (n: number | null | undefined, digits = 0): string => (n == null || Number.isNaN(n) ? '—' : n.toFixed(digits))

const speedLevel = (v: number | null): Level => (v == null || v < 90 ? 'ok' : v < 110 ? 'warn' : 'bad')
const rpmLevel = (v: number | null): Level => (v == null || v < 4000 ? 'ok' : v < 5500 ? 'warn' : 'bad')
// Холодный двигатель — жёлтый, нормальный — зелёный, перегрев — красный.
const tempLevel = (v: number | null): Level => (v == null ? 'ok' : v < 70 ? 'warn' : v <= 100 ? 'ok' : v <= 108 ? 'warn' : 'bad')
const fuelLevel = (v: number | null): Level => (v == null || v < 9 ? 'ok' : v < 13 ? 'warn' : 'bad')

const emaHour = new Ema(0.25)
const emaPer100 = new Ema(0.15)
let lhValue: number | null = null
let l100Value: number | null = null

watch(snapshot, (s) => {
  if (!s || s.mafGs == null) return
  lhValue = emaHour.push(fuelLitersPerHour(s.mafGs))
  const inst = fuelLitersPer100Km(s.mafGs, s.speedKmh ?? 0)
  if (inst === null) emaPer100.reset()
  l100Value = inst === null ? null : emaPer100.push(inst)
})

const fuel = computed(() => {
  void snapshot.value // пересчёт вместе с watch
  return l100Value !== null
    ? { value: fmt(l100Value, 1), unit: 'л/100 км', level: fuelLevel(l100Value) }
    : { value: fmt(lhValue, 1), unit: 'л/ч (стоим)', level: 'ok' as Level }
})

/** Допустимые значения: коррекции топливоподачи в пределах ±10% — норма, до ±20% — внимание. */
const trimLevel = (v: number | null | undefined): Level => (v == null || Math.abs(v) <= 10 ? 'ok' : Math.abs(v) <= 20 ? 'warn' : 'bad')
const voltLevel = (v: number | null | undefined): Level => (v == null || (v >= 13.2 && v <= 14.8) ? 'ok' : v >= 12.4 ? 'warn' : 'bad')
const color = (l: Level) => ({ ok: 'text-[#d5dae2]', warn: 'text-warn', bad: 'text-bad' }[l])

const rows = computed(() => {
  const s = snapshot.value
  return [
    { k: 'ДМРВ', v: s?.mafGs != null ? `${num(s.mafGs, 2)} г/с · ${num(s.mafGs * 3.6, 1)} кг/ч` : '—', l: 'ok' as Level },
    { k: 'Нагрузка', v: s?.loadPct != null ? `${num(s.loadPct, 0)} %` : '—', l: 'ok' as Level },
    { k: 'Дроссель', v: s?.throttlePct != null ? `${num(s.throttlePct, 0)} %` : '—', l: 'ok' as Level },
    { k: 'Напряжение', v: s?.voltage != null ? `${num(s.voltage, 1)} В` : '—', l: voltLevel(s?.voltage) },
    { k: 'Темп. впуска', v: s?.intakeTempC != null ? `${num(s.intakeTempC, 0)} °C` : '—', l: 'ok' as Level },
    { k: 'Коррекция STFT', v: s?.stft != null ? `${num(s.stft, 1)} %` : '—', l: trimLevel(s?.stft) },
    { k: 'Коррекция LTFT', v: s?.ltft != null ? `${num(s.ltft, 1)} %` : '—', l: trimLevel(s?.ltft) },
  ]
})

const trip = computed(() => {
  const t = tripLive.value
  return {
    km: t.distanceKm,
    avg: t.movingMs ? t.distanceKm / (t.movingMs / 3_600_000) : 0,
    l100: t.distanceKm >= 0.5 ? (t.fuelL / t.distanceKm) * 100 : null,
    time: t.movingMs + t.stoppedMs,
    cost: t.fuelL * garage.fuelPrice,
  }
})
</script>

<template>
  <div v-if="milOn" class="mb-2 flex items-center gap-3 border border-bad p-3 text-bad">
    <span class="flex h-8 w-8 shrink-0 items-center justify-center border-2 border-bad font-mono text-xl font-bold">!</span>
    <span class="text-sm"><b>Горит Check Engine.</b> Откройте «Ошибки» и считайте коды. Место, где лампа загорелась, будет отмечено «!» на карте поездки.</span>
  </div>
  <p v-if="!isConnected" class="mb-2 border border-night-600 p-3 text-sm text-[#7b8696]">Нет связи с адаптером. Нажмите «Подключить»; в демо-режиме данные симулируются.</p>
  <div class="grid grid-cols-2 gap-2">
    <GaugeTile label="Скорость" :value="fmt(snapshot?.speedKmh)" unit="км/ч" :level="speedLevel(snapshot?.speedKmh ?? null)" />
    <GaugeTile label="Обороты" :value="fmt(snapshot?.rpm)" unit="об/мин" :level="rpmLevel(snapshot?.rpm ?? null)" />
    <GaugeTile label="Темп. ОЖ" :value="fmt(snapshot?.coolantTempC)" unit="°C" :level="tempLevel(snapshot?.coolantTempC ?? null)" />
    <GaugeTile label="Расход" :value="fuel.value" :unit="fuel.unit" :level="fuel.level" />
  </div>

  <div class="card mt-2 p-3">
    <div class="label mb-2">Датчики</div>
    <dl class="divide-y divide-night-600 text-sm">
      <div v-for="r in rows" :key="r.k" class="flex justify-between py-1.5">
        <dt class="text-[#7b8696]">{{ r.k }}</dt>
        <dd class="font-mono tabular-nums" :class="color(r.l)">{{ r.v }}</dd>
      </div>
    </dl>
  </div>

  <div class="card mt-2 p-3">
    <div class="mb-2 flex items-center justify-between">
      <span class="label">Текущая поездка <span v-if="tripActive" class="text-ok">· идёт запись</span></span>
      <span class="font-mono text-[11px] text-[#7b8696]">GPS: {{ gpsState === 'on' ? (gpsFix ? `±${Math.round(gpsFix.accuracy)} м` : 'ищу спутники…') : gpsState === 'denied' ? 'нет доступа' : gpsState === 'off' ? 'выкл' : gpsState === 'starting' ? 'запуск…' : 'ошибка' }}</span>
    </div>
    <dl class="grid grid-cols-4 gap-2 text-center">
      <div><dt class="label">км</dt><dd class="font-mono text-lg">{{ num(trip.km, 1) }}</dd></div>
      <div><dt class="label">км/ч ср.</dt><dd class="font-mono text-lg">{{ num(trip.avg, 0) }}</dd></div>
      <div><dt class="label">л/100</dt><dd class="font-mono text-lg">{{ num(trip.l100, 1) }}</dd></div>
      <div><dt class="label">время</dt><dd class="font-mono text-lg">{{ duration(trip.time) }}</dd></div>
    </dl>
  </div>

  <div v-if="tripActive" class="mt-2 grid grid-cols-2 gap-2">
    <RouterLink to="/trip/live" class="btn-ghost text-center">Карта поездки</RouterLink>
    <button class="btn-ghost" @click="endTrip()">Завершить поездку</button>
  </div>

  <RouterLink to="/service" class="card mt-2 block p-3">
    <OilGauge :status="oil()" :interval-km="car().oil.intervalKm" :changed-at="car().oil.dateISO" />
  </RouterLink>
</template>
