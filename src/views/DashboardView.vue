<script setup lang="ts">
import { computed, watch } from 'vue'
import GaugeTile from '@/components/GaugeTile.vue'
import { useVehicle } from '@/composables/useVehicle'
import { Ema, fuelLitersPer100Km, fuelLitersPerHour } from '@/services/FuelCalculator'
import type { Level } from '@/types'

const { snapshot, pollMode, isConnected } = useVehicle()
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
  // Читаем snapshot, чтобы computed пересчитывался вместе с watch.
  void snapshot.value
  return l100Value !== null
    ? { value: fmt(l100Value, 1), unit: 'л / 100 км', level: fuelLevel(l100Value) }
    : { value: fmt(lhValue, 1), unit: 'л / час (стоим)', level: 'ok' as Level }
})
</script>

<template>
  <p v-if="!isConnected" class="card mt-2 p-4 text-center text-slate-400">Нажми «Подключить» — в режиме Mock данные симулируются.</p>
  <div class="mt-2 grid grid-cols-2 gap-3">
    <GaugeTile label="Скорость" :value="fmt(snapshot?.speedKmh)" unit="км/ч" :level="speedLevel(snapshot?.speedKmh ?? null)" />
    <GaugeTile label="Обороты" :value="fmt(snapshot?.rpm)" unit="об/мин" :level="rpmLevel(snapshot?.rpm ?? null)" />
    <GaugeTile label="Темп. ОЖ" :value="fmt(snapshot?.coolantTempC)" unit="°C" :level="tempLevel(snapshot?.coolantTempC ?? null)" />
    <GaugeTile label="Расход" :value="fuel.value" :unit="fuel.unit" :level="fuel.level" :hint="snapshot?.mafGs != null ? `ДМРВ ${fmt(snapshot.mafGs * 3.6, 1)} кг/ч` : undefined" />
  </div>
</template>
