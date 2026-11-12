<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import Sheet from '@/components/Sheet.vue'
import { BRANDS, CATALOG, FUEL_TYPES } from '@/data/carCatalog'
import { CAR_PRESETS, type Car } from '@/services/Cars'
import { num } from '@/utils/format'

/** forced — обязательный шаг первого запуска: закрыть окно на первом шаге нельзя. */
const props = defineProps<{ forced?: boolean }>()
const emit = defineEmits<{ close: []; done: [Partial<Car>] }>()
const step = ref(0)
const q = ref('')
const brand = ref('')
const model = ref('')
const fuel = ref<(typeof FUEL_TYPES)[number]['car']>('АИ-92')
const cc = ref(1600)
const manual = ref(false)
const TITLES = ['Выберите производителя', 'Выберите модель', 'Выберите тип топлива', 'Рабочий объём двигателя']

const brands = computed(() => BRANDS.filter((b) => b.toLowerCase().includes(q.value.trim().toLowerCase())))
const models = computed(() => (CATALOG[brand.value] ?? []).filter((m) => m.toLowerCase().includes(q.value.trim().toLowerCase())))
const typed = computed(() => q.value.trim())

function pickBrand(b: string): void { brand.value = b; q.value = ''; step.value = 1 }
function pickModel(m: string): void { model.value = m; q.value = ''; step.value = 2 }
function pickFuel(f: (typeof FUEL_TYPES)[number]['car']): void {
  fuel.value = f
  // Для знакомых моделей подставляем типовой объём из шаблонов.
  const p = CAR_PRESETS.find((x) => x.model === model.value && (x.make === brand.value || (brand.value === 'LADA' && x.make === 'ВАЗ')))
  if (p?.displacementL) cc.value = Math.round(p.displacementL * 1000)
  step.value = 3
}
function finish(): void {
  const p = CAR_PRESETS.find((x) => x.model === model.value && (x.make === brand.value || (brand.value === 'LADA' && x.make === 'ВАЗ')))
  const { label: _l, ...preset } = p ?? { label: '' }
  emit('done', { ...preset, make: brand.value, model: model.value, name: p?.name ?? `${brand.value} ${model.value}`.trim(), fuel: fuel.value, displacementL: cc.value / 1000 })
}
function back(): void { q.value = ''; if (step.value > 0) step.value--; else if (!props.forced) emit('close') }
const size = computed(() => (cc.value < 1000 ? 'Маленький' : cc.value <= 1500 ? 'Малый' : cc.value <= 2500 ? 'Средний' : cc.value <= 4000 ? 'Большой' : 'Очень большой'))
</script>

<template>
  <Sheet full @close="back">
    <template #right><span class="flex gap-1.5 pr-3"><span v-for="n in 4" :key="n" class="h-2 w-2 rounded-full" :class="n - 1 <= step ? 'bg-accent' : 'bg-night-600'" /></span></template>
    <h2 class="mb-3 mt-1 text-2xl font-black leading-tight">{{ TITLES[step].replace(/(производителя|модель|тип топлива|объём двигателя)$/, '') }}<span class="text-accent">{{ TITLES[step].match(/(производителя|модель|тип топлива|объём двигателя)$/)?.[0] }}</span></h2>

    <template v-if="step < 2">
      <input v-model="q" class="field mb-3" :placeholder="step === 0 ? 'Поиск производителя' : 'Поиск или ввод модели'" aria-label="Поиск">
      <div v-if="step === 0" class="grid grid-cols-4 gap-x-2 gap-y-4">
        <button class="flex flex-col items-center gap-1.5 text-xs text-mute" @click="manual = true; pickBrand(typed || 'Своя')"><span class="flex h-14 w-14 items-center justify-center rounded-full border border-night-600 bg-night-800 text-accent"><AppIcon name="plus" /></span>Ручной ввод</button>
        <button v-for="b in brands" :key="b" class="flex flex-col items-center gap-1.5 text-center text-xs text-soft" @click="pickBrand(b)">
          <BrandLogo :make="b" :size="56" /><span class="w-full truncate">{{ b }}</span>
        </button>
      </div>
      <div v-if="step === 1" class="mb-3 flex items-center gap-3"><BrandLogo :make="brand" :size="44" /><span class="text-lg font-bold">{{ brand }}</span></div>
      <div v-if="step === 1" class="card overflow-hidden">
        <button v-if="typed && !models.includes(typed)" class="row text-accent" @click="pickModel(typed)"><span class="row-title !text-accent">Использовать «{{ typed }}»</span><AppIcon name="plus" :size="18" /></button>
        <button v-for="m in models" :key="m" class="row" @click="pickModel(m)"><span class="row-title">{{ m }}</span><AppIcon name="chevron" :size="18" class="text-faint" /></button>
        <p v-if="!models.length && !typed" class="p-4 text-sm text-mute">Моделей нет в справочнике — введите название выше.</p>
      </div>
      <p class="mt-3 rounded-xl bg-night-700 px-3 py-2.5 text-center text-xs text-mute">Если вашей марки или модели нет в списке — используйте «Ручной ввод»: ограничений в приложении не будет.</p>
    </template>

    <div v-else-if="step === 2" class="card overflow-hidden">
      <button v-for="f in FUEL_TYPES" :key="f.id" class="row" @click="pickFuel(f.car)"><span class="row-title" :class="fuel === f.car ? '!text-accent' : ''">{{ f.label }}</span><AppIcon v-if="fuel === f.car" name="check" class="text-accent" /></button>
    </div>

    <template v-else>
      <div class="card p-4">
        <div class="flex items-baseline justify-between"><span class="text-4xl font-black text-accent tabular-nums">{{ cc }}<span class="text-xl">cc</span></span><span class="text-sm text-mute">= {{ num(cc / 1000, 1) }} л</span></div>
        <input v-model.number="cc" type="range" min="400" max="5200" step="100" class="mt-4 w-full" aria-label="Объём двигателя">
        <div class="flex justify-between text-xs text-faint"><span>400cc</span><span>5200cc</span></div>
      </div>
      <div class="mt-3 rounded-xl bg-night-700 p-3 text-xs leading-relaxed text-mute">
        <p>Справочно: малый 1000–1500 · средний 1600–2500 · большой 2600–4000 · очень большой от 4000 см³.</p>
        <p class="mt-1 font-semibold text-soft">Ваш двигатель: {{ size.toLowerCase() }}.</p>
      </div>
      <label class="mt-3 flex items-center justify-between gap-3 text-sm text-mute">Точное значение, см³<input v-model.number="cc" type="number" min="400" max="9000" inputmode="numeric" class="field !w-28 text-right"></label>
    </template>

    <template v-if="step === 3" #footer><button class="btn w-full" @click="finish">Добавить автомобиль</button></template>
  </Sheet>
</template>
