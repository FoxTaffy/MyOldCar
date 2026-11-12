<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import Keypad from '@/components/Keypad.vue'
import Sheet from '@/components/Sheet.vue'
import ToggleRow from '@/components/ToggleRow.vue'
import { useGarage } from '@/composables/useGarage'
import { useUi } from '@/composables/useUi'
import { CATS, litersFor, type Expense, type ExpenseCat } from '@/services/Expenses'
import { currentOdometer } from '@/services/Cars'
import { num, todayISO } from '@/utils/format'

const props = defineProps<{ edit?: Expense | null; cat?: ExpenseCat }>()
const emit = defineEmits<{ close: [] }>()
const { garage, car, addExpense, updateExpense, removeExpense } = useGarage()
const { ui } = useUi()

const e = props.edit
const cat = ref<ExpenseCat>(e?.cat ?? props.cat ?? 'fuel')
const step = ref<1 | 2>(e ? 2 : 1)
const amount = ref(e ? String(e.amount).replace('.', ',') : '')
const picking = ref(false)
const odo = currentOdometer(car())
const f = reactive({
  date: e?.date ?? todayISO(),
  place: e?.place ?? '',
  note: e?.note ?? '',
  odometer: (e?.odometerKm ?? (odo != null ? Math.round(odo) : '')) as number | '',
  fuelType: e?.fuelType ?? (car().fuel || 'АИ-92'),
  price: (e?.pricePerL ?? garage.fuelPrice) as number | '',
  full: e?.full ?? true,
  diy: e?.diy ?? false,
  items: (e?.items ?? []).map((i) => ({ ...i })) as { name: string; amount: number | ''; note?: string }[],
})
const value = computed(() => Number(amount.value.replace(',', '.')) || 0)
const liters = computed(() => (cat.value === 'fuel' && typeof f.price === 'number' ? litersFor(value.value, f.price) : null))
const title = computed(() => CATS.find((c) => c.id === cat.value)?.title ?? '')
const icon = computed(() => CATS.find((c) => c.id === cat.value)?.icon ?? 'wallet')
const COMMON = ['Замена масла', 'Колодки', 'Шиномонтаж', 'Страховка', 'Налог', 'Запчасти', 'Диагностика', 'Парковка', 'Штраф']
const FUELS = ['АИ-92', 'АИ-95', 'АИ-98', 'ДТ', 'Газ']
const fmtAmount = computed(() => (amount.value ? amount.value : ''))

function save(): void {
  if (!(value.value > 0)) return
  const data: Omit<Expense, 'id' | 'carId'> = {
    cat: cat.value, date: f.date || todayISO(), amount: value.value, place: f.place.trim() || undefined, note: f.note.trim() || undefined,
    odometerKm: typeof f.odometer === 'number' ? f.odometer : null,
  }
  if (cat.value === 'fuel') Object.assign(data, { fuelType: f.fuelType, pricePerL: typeof f.price === 'number' ? f.price : null, liters: liters.value, full: f.full })
  if (cat.value === 'service') Object.assign(data, { diy: f.diy, items: f.items.filter((i) => i.name.trim()).map((i) => ({ name: i.name.trim(), amount: Number(i.amount) || 0, note: i.note })) })
  if (e) updateExpense(e.id, data)
  else {
    addExpense(data)
    // Цена заправки становится ценой по умолчанию для расчёта стоимости поездок.
    if (cat.value === 'fuel' && typeof f.price === 'number' && f.price > 0) garage.fuelPrice = f.price
  }
  emit('close')
}
function del(): void { if (e && confirm('Удалить запись?')) { removeExpense(e.id); emit('close') } }
</script>

<template>
  <Sheet full @close="emit('close')">
    <template #right><button v-if="e" class="flex h-11 w-11 items-center justify-center rounded-full text-bad active:bg-night-700" aria-label="Удалить запись" @click="del"><AppIcon name="trash" /></button></template>
    <div class="relative">
      <button class="mx-auto mt-1 flex items-center gap-2 rounded-full py-1 pl-1 pr-3 active:bg-night-700" aria-haspopup="listbox" @click="picking = !picking">
        <span class="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-on"><AppIcon :name="icon" :size="20" /></span>
        <span class="text-lg font-bold">{{ title }}</span><AppIcon name="down" :size="18" class="text-mute" />
      </button>
      <div v-if="picking" class="card absolute inset-x-8 top-12 z-10 overflow-hidden" role="listbox">
        <button v-for="c in CATS" :key="c.id" class="row" role="option" :aria-selected="c.id === cat" @click="cat = c.id; picking = false"><span class="flex items-center gap-3"><AppIcon :name="c.icon" class="text-accent" />{{ c.title }}</span><AppIcon v-if="c.id === cat" name="check" class="text-accent" :size="18" /></button>
      </div>
    </div>

    <!-- Шаг 1: сумма -->
    <template v-if="step === 1">
      <div class="flex min-h-[30vh] flex-col items-center justify-center">
        <div v-if="amount" class="text-5xl font-bold tabular-nums">{{ fmtAmount }} <span class="text-3xl text-mute">{{ ui.currency }}</span></div>
        <div v-else class="text-3xl text-faint">Введите сумму</div>
        <div v-if="cat === 'fuel' && liters" class="mt-2 text-xl text-mute tabular-nums">{{ num(liters, 2) }} л</div>
      </div>
    </template>

    <!-- Шаг 2: детали -->
    <template v-else>
      <button class="mx-auto mb-2 mt-3 block text-5xl font-bold tabular-nums" aria-label="Изменить сумму" @click="step = 1">{{ ui.currency }}{{ amount }}</button>
      <p v-if="cat === 'fuel' && liters" class="text-center text-xl text-mute tabular-nums">{{ num(liters, 2) }} л</p>
      <div class="card mt-3 overflow-hidden">
        <label class="row"><span class="row-title">Дата</span><input v-model="f.date" type="date" :max="todayISO()" class="bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
        <label class="row"><span class="row-title">Место</span><input v-model="f.place" class="min-w-0 flex-1 bg-transparent text-right text-sm outline-none placeholder:text-faint" :placeholder="cat === 'fuel' ? 'АЗС' : cat === 'wash' ? 'Мойка' : 'Сервис'"></label>
        <label class="row"><span class="row-title">Пробег, км</span><input v-model.number="f.odometer" type="number" inputmode="numeric" min="0" class="w-32 bg-transparent text-right text-sm outline-none placeholder:text-faint" placeholder="одометр"></label>
        <template v-if="cat === 'fuel'">
          <label class="row"><span class="row-title">Тип топлива</span><select v-model="f.fuelType" class="bg-transparent text-right text-sm font-medium text-accent outline-none"><option v-for="t in FUELS" :key="t">{{ t }}</option></select></label>
          <label class="row"><span class="row-title">Цена за литр, {{ ui.currency }}</span><input v-model.number="f.price" type="number" inputmode="decimal" step="0.01" min="0" class="w-24 bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
          <ToggleRow v-model="f.full" title="Полный бак" sub="Нужно для точного расчёта расхода по заправкам" />
        </template>
        <template v-if="cat === 'service'">
          <ToggleRow v-model="f.diy" title="Самостоятельное обслуживание" />
        </template>
        <label class="row"><span class="row-title">Заметка</span><input v-model="f.note" class="min-w-0 flex-1 bg-transparent text-right text-sm outline-none placeholder:text-faint" placeholder="Введите заметку"></label>
      </div>
      <div v-if="cat === 'service'" class="card mt-3 p-3">
        <div v-for="(it, i) in f.items" :key="i" class="mb-3 space-y-2 rounded-xl bg-night-900 p-3">
          <div class="flex items-center gap-2"><input v-model="it.name" class="field !py-2" placeholder="Что сделали" list="svc-names"><button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-faint active:bg-night-700" aria-label="Убрать" @click="f.items.splice(i, 1)"><AppIcon name="close" :size="18" /></button></div>
          <input v-model.number="it.amount" type="number" inputmode="decimal" class="field !py-2" :placeholder="`Стоимость, ${ui.currency}`">
        </div>
        <datalist id="svc-names"><option v-for="n in COMMON" :key="n" :value="n" /></datalist>
        <button class="btn-ghost w-full" @click="f.items.push({ name: '', amount: '' })">+ Добавить элемент</button>
        <p class="mt-2 text-xs text-faint">Элементы — для себя: что именно входило в сумму. Общая сумма берётся сверху.</p>
      </div>
    </template>

    <template #footer>
      <Keypad v-if="step === 1" v-model="amount" class="-mx-3 mb-2" />
      <button v-if="step === 1" class="btn w-full" :disabled="!(value > 0)" @click="step = 2">Далее</button>
      <button v-else class="btn w-full" :disabled="!(value > 0)" @click="save">Сохранить</button>
    </template>
  </Sheet>
</template>
