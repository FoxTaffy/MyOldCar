<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import BarChart from '@/components/BarChart.vue'
import ExpenseSheet from '@/components/ExpenseSheet.vue'
import Sheet from '@/components/Sheet.vue'
import { useGarage } from '@/composables/useGarage'
import { useUi } from '@/composables/useUi'
import { currentOdometer } from '@/services/Cars'
import { CATS, catTitle, consumptionFromFills, monthKey, monthSeries, monthSummary, shiftMonth, type Expense, type ExpenseCat } from '@/services/Expenses'
import { DEFAULT_ITEMS, itemStatus } from '@/services/Maintenance'
import { int, num, todayISO } from '@/utils/format'

const { garage, car, oil, setOil, expenses, serviceItems, markServiced, addServiceItem, removeServiceItem, setOdometer, save } = useGarage()
const { ui } = useUi()
const cur = ui.currency
const money = (n: number): string => `${cur}${int(n)}`
const MONTHS = ['янв.', 'февр.', 'март', 'апр.', 'май', 'июнь', 'июль', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.']
const mLabel = (ym: string): string => `${MONTHS[Number(ym.slice(5)) - 1]}`
const mFull = (ym: string): string => `${mLabel(ym)} ${ym.slice(0, 4)}`

const ym = ref(monthKey(todayISO()))
const list = computed(() => expenses())
const sum = computed(() => monthSummary(list.value, ym.value))
const prev = computed(() => monthSummary(list.value, shiftMonth(ym.value, -1)))
const series = computed(() => monthSeries(list.value, ym.value, 6).map((m) => ({ key: m.ym, label: mLabel(m.ym), value: m.total || null })))
const diff = (a: number, b: number): string => (a === b ? '0' : `${a > b ? '+' : '−'}${int(Math.abs(a - b))}`)
const monthList = computed(() => list.value.filter((e) => monthKey(e.date) === ym.value))
const cons = computed(() => consumptionFromFills(list.value))
const isCurrentMonth = computed(() => ym.value === monthKey(todayISO()))

// Расходы
const sheet = ref<{ edit?: Expense; cat?: ExpenseCat } | null>(null)
const fmtDate = (d: string): string => `${d.slice(8)}.${d.slice(5, 7)}`

// Обслуживание
interface Row { id: string; name: string; sinceKm: number; intervalKm: number; pct: number; level: 'ok' | 'warn' | 'bad'; configured: boolean; months?: number; custom: boolean; dateISO: string | null; daysSince: number | null }
const rows = computed<Row[]>(() => {
  const o = oil()
  const c = car()
  void c.services.length
  return [
    { id: 'oil', name: 'Моторное масло', sinceKm: o.sinceKm, intervalKm: c.oil.intervalKm, pct: o.pct, level: o.level, configured: o.configured, custom: false, dateISO: c.oil.dateISO, daysSince: o.daysSince, months: 12 },
    ...serviceItems().map(({ it, st }) => ({ id: it.id, name: it.name, sinceKm: st.sinceKm, intervalKm: it.intervalKm, pct: st.pct, level: st.level, configured: st.configured, months: it.months, custom: !DEFAULT_ITEMS.some((d) => d.id === it.id), dateISO: it.dateISO, daysSince: st.daysSince })),
  ]
})
const showAll = ref(false)
const shown = computed(() => (showAll.value ? rows.value : [...rows.value].sort((a, b) => b.pct - a.pct).slice(0, 4)))
const BAR = { ok: 'bg-accent', warn: 'bg-warn', bad: 'bg-bad' } as const
const PCT = { ok: 'bg-accent-soft text-accent', warn: 'bg-warn/15 text-warn', bad: 'bg-bad/15 text-bad' } as const

const itemEdit = ref<string | 'new' | null>(null)
const form = reactive({ name: '', date: todayISO(), since: 0, interval: 10000, months: '' as number | '' })
const editRow = computed(() => rows.value.find((r) => r.id === itemEdit.value))
function openItem(id: string | 'new'): void {
  itemEdit.value = id
  if (id === 'new') { Object.assign(form, { name: '', date: todayISO(), since: 0, interval: 10000, months: '' }); return }
  const r = rows.value.find((x) => x.id === id)
  if (r) Object.assign(form, { name: r.name, date: r.dateISO ?? todayISO(), since: Math.round(r.sinceKm), interval: r.intervalKm, months: r.months && id !== 'oil' ? r.months : '' })
}
const itemProblem = computed(() => {
  if (itemEdit.value === 'new' && !form.name.trim()) return 'Введите название'
  if (!form.date || form.date > todayISO()) return 'Дата замены не может быть в будущем'
  if (typeof form.since !== 'number' || form.since < 0) return 'Пробег с замены — число от 0'
  if (typeof form.interval !== 'number' || form.interval < 500) return 'Интервал — от 500 км'
  return null
})
function saveItem(dateISO = form.date, since = form.since): void {
  const id = itemEdit.value
  if (!id || itemProblem.value) return
  const months = typeof form.months === 'number' && form.months > 0 ? form.months : undefined
  if (id === 'new') {
    const it = addServiceItem(form.name, form.interval, months)
    markServiced(it.id, dateISO, since)
  } else if (id === 'oil') setOil(dateISO, since, form.interval)
  else {
    const it = car().services.find((x) => x.id === id)
    if (it) it.months = months
    markServiced(id, dateISO, since, form.interval)
  }
  itemEdit.value = null
}
function justDone(): void { saveItem(todayISO(), 0) }
function dropItem(): void {
  const id = itemEdit.value
  if (id && id !== 'oil' && id !== 'new' && confirm('Убрать позицию из списка?')) { removeServiceItem(id); itemEdit.value = null }
}

// Пробег и покупка
const showCar = ref(false)
const carForm = reactive({ purchaseISO: '', purchaseKm: '' as number | '', odometer: '' as number | '' })
function openCar(): void {
  carForm.purchaseISO = car().purchaseISO ?? ''
  carForm.purchaseKm = car().purchaseKm ?? ''
  carForm.odometer = car().odometerKm != null ? Math.round(currentOdometer(car()) ?? 0) : ''
  showCar.value = true
}
function saveCar(): void {
  car().purchaseISO = carForm.purchaseISO || null
  car().purchaseKm = typeof carForm.purchaseKm === 'number' ? carForm.purchaseKm : null
  setOdometer(car().id, typeof carForm.odometer === 'number' ? carForm.odometer : null)
  save()
  showCar.value = false
}
const odoNow = computed(() => currentOdometer(car()))
const ownedKm = computed(() => (odoNow.value != null && car().purchaseKm != null ? Math.max(0, odoNow.value - (car().purchaseKm as number)) : null))
const search = (q: string): void => { window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, '_blank') }
void garage
void itemStatus
</script>

<template>
  <section class="space-y-3 pb-16">
    <!-- Месяц и итог -->
    <div class="card p-4">
      <div class="flex items-center justify-between">
        <button class="flex h-9 w-9 items-center justify-center rounded-full text-mute active:bg-night-700" aria-label="Прошлый месяц" @click="ym = shiftMonth(ym, -1)"><AppIcon name="back" :size="20" /></button>
        <span class="text-lg font-bold">{{ mFull(ym) }}</span>
        <button class="flex h-9 w-9 items-center justify-center rounded-full text-mute active:bg-night-700 disabled:opacity-30" :disabled="isCurrentMonth" aria-label="Следующий месяц" @click="ym = shiftMonth(ym, 1)"><AppIcon name="chevron" :size="20" /></button>
      </div>
      <div class="mt-2 text-4xl font-bold tabular-nums">{{ money(sum.total) }}</div>
      <div class="mt-1 text-sm text-mute">По сравнению с прошлым месяцем <b class="tabular-nums" :class="sum.total > prev.total ? 'text-bad' : sum.total < prev.total ? 'text-ok' : ''">{{ diff(sum.total, prev.total) }}</b></div>
      <div class="mt-3"><BarChart :items="series" :selected="ym" :fmt="(n) => int(n)" @pick="ym = $event" /></div>
    </div>

    <div class="card divide-y divide-night-600">
      <button v-for="c in CATS" :key="c.id" class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-night-700" @click="sheet = { cat: c.id }">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><AppIcon :name="c.icon" /></span>
        <span class="min-w-0 flex-1"><span class="block text-[15px] font-semibold">{{ c.title }}</span><span class="text-xs text-faint tabular-nums">{{ num(sum.byCat[c.id].pct, 1) }}%<template v-if="c.id === 'fuel' && sum.liters"> · {{ num(sum.liters, 1) }} л</template></span></span>
        <span class="text-right"><span class="block text-base font-bold tabular-nums">{{ money(sum.byCat[c.id].amount) }}</span><span class="text-xs text-faint tabular-nums">{{ diff(sum.byCat[c.id].amount, prev.byCat[c.id].amount) }}</span></span>
      </button>
    </div>

    <div v-if="cons" class="card flex items-center gap-3 p-4">
      <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"><AppIcon name="leaf" /></span>
      <span class="min-w-0 flex-1 text-sm text-soft">Средний расход по заправкам<span class="block text-xs text-faint">за {{ int(cons.km) }} км, {{ num(cons.liters, 0) }} л</span></span>
      <span class="text-xl font-bold tabular-nums">{{ num(cons.l100, 1) }} <span class="text-xs font-normal text-faint">л/100</span></span>
    </div>

    <!-- Записи месяца -->
    <template v-if="monthList.length">
      <h2 class="h-section">Записи за месяц</h2>
      <div class="card divide-y divide-night-600">
        <button v-for="e in monthList" :key="e.id" class="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-night-700" @click="sheet = { edit: e }">
          <span class="text-xs tabular-nums text-faint">{{ fmtDate(e.date) }}</span>
          <span class="min-w-0 flex-1"><span class="block truncate text-sm font-medium">{{ e.items?.[0]?.name || e.note || catTitle(e.cat) }}</span><span class="block truncate text-xs text-faint">{{ [e.place, e.cat === 'fuel' && e.liters ? `${num(e.liters, 1)} л` : ''].filter(Boolean).join(' · ') || catTitle(e.cat) }}</span></span>
          <span class="font-bold tabular-nums">{{ money(e.amount) }}</span>
        </button>
      </div>
    </template>

    <div class="rounded-2xl bg-night-700 px-4 py-3">
      <p class="text-sm text-soft">Нужен сервис или заправка?</p>
      <div class="mt-2 flex gap-2 overflow-x-auto">
        <button class="chip" @click="search('автосервис')">⚙ Найти автосервисы</button>
        <button class="chip" @click="search('АЗС')">⛽ Найти заправки</button>
        <button class="chip" @click="search('автомойка')">🚿 Найти мойки</button>
      </div>
    </div>

    <!-- Список обслуживания -->
    <div class="flex items-end justify-between px-1 pt-2">
      <h2 class="text-lg font-bold">Список обслуживания</h2>
      <button class="text-sm text-faint" @click="showAll = !showAll">{{ showAll ? 'Свернуть' : 'Показать все' }} ›</button>
    </div>
    <p v-if="!ui.hintJournal" class="flex items-center gap-2 rounded-xl bg-night-700 px-3 py-2.5 text-sm text-soft"><AppIcon name="info" :size="18" class="shrink-0 text-faint" /><span class="flex-1">Показываю самое срочное. Пробег считается по поездкам; нажмите позицию, чтобы отметить замену.</span><button class="text-faint" aria-label="Скрыть" @click="ui.hintJournal = true"><AppIcon name="close" :size="18" /></button></p>
    <div class="card divide-y divide-night-600">
      <button v-for="r in shown" :key="r.id" class="block w-full px-4 py-3.5 text-left active:bg-night-700" @click="openItem(r.id)">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[15px] font-bold">{{ r.name }}</span>
          <span class="rounded-full px-2 py-0.5 text-xs font-bold tabular-nums" :class="PCT[r.level]">{{ r.configured ? Math.round(r.pct) + '%' : 'не задано' }}</span>
        </div>
        <div class="mt-2 h-2 overflow-hidden rounded-full bg-night-700"><div class="h-full rounded-full transition-all" :class="BAR[r.level]" :style="{ width: Math.min(100, r.pct) + '%' }" /></div>
        <div class="mt-1.5 flex justify-between text-xs tabular-nums"><span class="text-accent">{{ int(r.sinceKm) }} км прошло</span><span class="text-faint">{{ int(r.intervalKm) }} км</span></div>
      </button>
    </div>
    <button class="btn-ghost w-full" @click="openItem('new')">+ Добавить позицию</button>

    <!-- Пробег -->
    <h2 class="h-section">Пробег и владение</h2>
    <button class="card block w-full divide-y divide-night-600 text-left" @click="openCar">
      <div class="row"><span class="row-title">Одометр (оценка)</span><span class="row-val">{{ odoNow != null ? int(odoNow) + ' км' : 'не задан' }}</span></div>
      <div class="row"><span class="row-title">Дата начала владения</span><span class="row-val">{{ car().purchaseISO ? car().purchaseISO!.split('-').reverse().join('.') : '—' }}</span></div>
      <div class="row"><span class="row-title">Пробег при покупке</span><span class="row-val">{{ car().purchaseKm != null ? int(car().purchaseKm) + ' км' : '—' }}</span></div>
      <div class="row"><span class="row-title">Проехано за владение</span><span class="row-val">{{ ownedKm != null ? int(ownedKm) + ' км' : '—' }}</span></div>
      <div class="row"><span class="row-title">Записано приложением</span><span class="row-val !text-ink">{{ num(car().trackedTotalKm, 1) }} км</span></div>
    </button>

    <!-- FAB -->
    <button class="fixed bottom-24 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-on shadow-lg active:scale-95" aria-label="Добавить расход" @click="sheet = {}"><AppIcon name="plus" :size="28" /></button>

    <ExpenseSheet v-if="sheet" :edit="sheet.edit" :cat="sheet.cat" @close="sheet = null" />

    <Sheet v-if="itemEdit" :title="itemEdit === 'new' ? 'Новая позиция' : editRow?.name" @close="itemEdit = null">
      <div class="card overflow-hidden">
        <label v-if="itemEdit === 'new'" class="row"><span class="row-title">Название</span><input v-model="form.name" class="min-w-0 flex-1 bg-transparent text-right text-sm outline-none placeholder:text-faint" placeholder="Например, шаровые"></label>
        <label class="row"><span class="row-title">Дата последней замены</span><input v-model="form.date" type="date" :max="todayISO()" class="bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
        <label class="row"><span class="row-title">Пройдено с замены, км</span><input v-model.number="form.since" type="number" min="0" inputmode="numeric" class="w-24 bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
        <label class="row"><span class="row-title">Интервал замены, км</span><input v-model.number="form.interval" type="number" min="500" step="500" inputmode="numeric" class="w-24 bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
        <label v-if="itemEdit !== 'oil'" class="row"><span class="row-title">Срок, месяцев <span class="row-sub">необязательно</span></span><input v-model.number="form.months" type="number" min="1" inputmode="numeric" class="w-20 bg-transparent text-right text-sm font-medium text-accent outline-none" placeholder="—"></label>
      </div>
      <p class="mt-2 px-1 text-xs text-faint">Масло по сроку меняют раз в год независимо от пробега. Пробег по OBD недоступен: приложение прибавляет километры по поездкам — если ездили без него, поправьте вручную.</p>
      <p v-if="itemProblem" class="mt-2 px-1 text-sm text-bad">{{ itemProblem }}</p>
      <template #footer>
        <div class="flex gap-2">
          <button v-if="itemEdit !== 'new'" class="btn-soft flex-1" @click="justDone">Заменил сегодня</button>
          <button class="btn flex-1" :disabled="!!itemProblem" @click="saveItem()">Сохранить</button>
        </div>
        <button v-if="editRow?.custom" class="mt-2 w-full py-2 text-sm text-bad" @click="dropItem">Убрать позицию</button>
      </template>
    </Sheet>

    <Sheet v-if="showCar" title="Информация о владении" @close="showCar = false">
      <div class="card overflow-hidden">
        <label class="row"><span class="row-title">Модель автомобиля</span><span class="text-sm text-mute">{{ car().make }} {{ car().model }}</span></label>
        <label class="row"><span class="row-title">Дата начала владения</span><input v-model="carForm.purchaseISO" type="date" :max="todayISO()" class="bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
        <label class="row"><span class="row-title">Пробег при покупке, км</span><input v-model.number="carForm.purchaseKm" type="number" min="0" inputmode="numeric" class="w-28 bg-transparent text-right text-sm font-medium text-accent outline-none" placeholder="—"></label>
        <label class="row"><span class="row-title">Одометр сейчас, км</span><input v-model.number="carForm.odometer" type="number" min="0" inputmode="numeric" class="w-28 bg-transparent text-right text-sm font-medium text-accent outline-none" placeholder="с приборки"></label>
      </div>
      <p class="mt-2 px-1 text-xs text-faint">Введите показание одометра один раз — дальше приложение прибавляет к нему пробег записанных поездок.</p>
      <template #footer><button class="btn w-full" @click="saveCar">Сохранить</button></template>
    </Sheet>
  </section>
</template>
