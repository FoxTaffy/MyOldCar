<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import AddCarSheet from '@/components/AddCarSheet.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { CAR_PRESETS, carTitle, currentOdometer, type Car } from '@/services/Cars'
import { decodeVin } from '@/services/Vin'
import { decodeVinOnline, scanVinWithCamera } from '@/services/VinScanner'
import { int } from '@/utils/format'

const router = useRouter()
const { garage, car, selectCar, addCar, removeCar, setOdometer } = useGarage()
const { isConnected, getElm, tripActive } = useVehicle()

const editing = ref<string | null>(car().id)
const edited = computed<Car | null>(() => garage.cars.find((c) => c.id === editing.value) ?? null)
const msg = ref<string | null>(null)
const msgBad = ref(false)
const busy = ref<'ecu' | 'cam' | 'web' | null>(null)

const say = (m: string, bad = false): void => { msg.value = m; msgBad.value = bad }

const wizard = ref(false)
function add(): void { wizard.value = true }
function created(init: Partial<Car>): void {
  wizard.value = false
  const c = addCar({ name: `Машина ${garage.cars.length + 1}`, ...init })
  editing.value = c.id
  say('Автомобиль добавлен — дополните данные, если нужно')
}

function remove(c: Car): void {
  if (garage.cars.length <= 1) return say('Нельзя удалить единственную машину', true)
  if (confirm(`Удалить «${carTitle(c)}» вместе с её поездками?`)) {
    removeCar(c.id)
    editing.value = car().id
  }
}

function pick(c: Car): void {
  if (c.id !== garage.activeCarId && tripActive.value && !confirm('Идёт запись поездки. Она будет завершена и сохранена на прежней машине. Переключить?')) return
  selectCar(c.id)
  editing.value = c.id
}

/** Одометр вводится как точка отсчёта: запоминаем вместе с ним счётчик приложения. */
function onOdometer(e: Event): void {
  const c = edited.value
  if (!c) return
  const raw = (e.target as HTMLInputElement).value
  setOdometer(c.id, raw === '' ? null : Number(raw))
}

/** Числовые поля: пустая строка из инпута — это «не задано», а не ''. */
function numField(key: 'year' | 'displacementL' | 'powerHp' | 'tankL' | 'oilCapacityL', e: Event): void {
  const c = edited.value
  if (!c) return
  const raw = (e.target as HTMLInputElement).value
  c[key] = raw === '' || !Number.isFinite(Number(raw)) ? null : Number(raw)
}

const presetIdx = ref('')
function applyPreset(): void {
  const c = edited.value
  const p = CAR_PRESETS[Number(presetIdx.value)]
  if (!c || !p) return
  const { label, ...rest } = p
  void label
  Object.assign(c, rest)
  presetIdx.value = ''
  say('Шаблон применён — проверьте цифры для вашего экземпляра')
}

const vinInfo = computed(() => (edited.value?.vin ? decodeVin(edited.value.vin) : null))

function useDecoded(): void {
  const c = edited.value
  const i = vinInfo.value
  if (!c || !i?.valid) return
  c.vin = i.vin
  if (i.year && !c.year) c.year = i.year
  if (i.maker && !c.make) c.make = i.maker.split(' ')[0]
  say(i.year || i.maker ? 'VIN приведён к стандартному виду, год и марка добавлены в пустые поля' : 'VIN приведён к стандартному виду')
}

async function fromEcu(): Promise<void> {
  const c = edited.value
  if (!c) return
  busy.value = 'ecu'
  try {
    const vin = await getElm().readVin()
    if (!vin) return say('ЭБУ не отдаёт VIN (на старых К-линейных блоках М73 это нормально). Отсканируйте камерой или введите вручную.', true)
    c.vin = vin
    say('VIN прочитан из ЭБУ')
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), true)
  } finally {
    busy.value = null
  }
}

async function fromCamera(): Promise<void> {
  const c = edited.value
  if (!c) return
  busy.value = 'cam'
  try {
    c.vin = await scanVinWithCamera()
    say('VIN отсканирован')
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), true)
  } finally {
    busy.value = null
  }
}

async function online(): Promise<void> {
  const c = edited.value
  const i = vinInfo.value
  if (!c || !i?.valid) return say('Сначала введите корректный VIN', true)
  busy.value = 'web'
  try {
    const d = await decodeVinOnline(i.vin)
    // Не затираем то, что владелец уже заполнил.
    for (const [k, v] of Object.entries(d)) if (!(c as unknown as Record<string, unknown>)[k]) (c as unknown as Record<string, unknown>)[k] = v
    say('Данные из базы NHTSA добавлены в пустые поля')
  } catch (e) {
    say(e instanceof Error ? e.message : String(e), true)
  } finally {
    busy.value = null
  }
}

const fuels = ['', 'АИ-92', 'АИ-95', 'АИ-98', 'ДТ', 'Газ'] as const
</script>

<template>
  <section class="space-y-2">
    <PageHeader title="Мои автомобили">
      <template #right><button class="flex h-11 w-11 items-center justify-center rounded-full text-accent active:bg-night-700" aria-label="Добавить автомобиль" @click="add"><span class="text-3xl leading-none">+</span></button></template>
    </PageHeader>
    <AddCarSheet v-if="wizard" @close="wizard = false" @done="created" />

    <div class="space-y-2">
      <article v-for="c in garage.cars" :key="c.id" class="card flex items-center gap-3 p-3" :class="c.id === garage.activeCarId ? '!border-accent' : ''">
        <button class="min-w-0 flex-1 text-left" @click="pick(c)">
          <span class="block truncate font-semibold">{{ carTitle(c) }}</span>
          <span class="block truncate font-mono text-xs muted">
            {{ [c.year, c.plate, c.displacementL ? c.displacementL + ' л' : '', c.powerHp ? c.powerHp + ' л.с.' : ''].filter(Boolean).join(' · ') || 'без данных' }}
          </span>
          <span class="block truncate font-mono text-xs text-faint">{{ currentOdometer(c) != null ? `одометр ≈ ${int(currentOdometer(c))} км · ` : '' }}записано приложением: {{ int(c.trackedTotalKm) }} км</span>
        </button>
        <span v-if="c.id === garage.activeCarId" class="label text-ok">активна</span>
        <button v-else class="btn-ghost btn-sm" @click="pick(c)">Выбрать</button>
      </article>
    </div>

    <p v-if="msg" class="text-sm" :class="msgBad ? 'text-bad' : 'text-ok'">{{ msg }}</p>

    <div v-if="edited" class="card space-y-3 p-4">
      <div class="flex items-center justify-between">
        <h3 class="label">Профиль: {{ carTitle(edited) }}</h3>
        <button v-if="garage.cars.length > 1" class="link !text-bad" @click="remove(edited)">удалить</button>
      </div>

      <label class="block text-xs muted">Заполнить по шаблону
        <select v-model="presetIdx" class="field mt-1" @change="applyPreset">
          <option value="">— выберите модель —</option>
          <option v-for="(p, i) in CAR_PRESETS" :key="p.label" :value="String(i)">{{ p.label }}</option>
        </select>
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="col-span-2 text-xs muted">Название<input v-model="edited.name" class="field mt-1" /></label>
        <label class="text-xs muted">Марка<input v-model="edited.make" class="field mt-1" /></label>
        <label class="text-xs muted">Модель<input v-model="edited.model" class="field mt-1" /></label>
        <label class="text-xs muted">Год<input :value="edited.year ?? ''" type="number" inputmode="numeric" min="1950" max="2100" class="field mt-1" @input="numField('year', $event)" /></label>
        <label class="text-xs muted">Госномер<input v-model="edited.plate" class="field mt-1 uppercase" /></label>
        <label class="text-xs muted">Цвет<input v-model="edited.color" class="field mt-1" /></label>
        <label class="text-xs muted">Кузов<input v-model="edited.body" class="field mt-1" /></label>
      </div>

      <div class="rounded-xl space-y-2 border border-night-600 p-3">
        <div class="label">VIN</div>
        <input v-model="edited.vin" maxlength="24" placeholder="17 знаков" class="field uppercase tracking-wider" autocapitalize="characters" spellcheck="false" />
        <div class="grid grid-cols-2 gap-2">
          <button class="btn-ghost btn-sm" :disabled="busy !== null" @click="fromCamera">{{ busy === 'cam' ? 'Сканирую…' : 'Сканировать камерой' }}</button>
          <button class="btn-ghost btn-sm" :disabled="!isConnected || busy !== null" :title="isConnected ? '' : 'Нужно подключение к адаптеру'" @click="fromEcu">{{ busy === 'ecu' ? 'Читаю…' : 'Считать из ЭБУ' }}</button>
        </div>
        <div v-if="vinInfo" class="space-y-1 text-sm">
          <dl v-if="vinInfo.valid" class="divide-y divide-night-600">
            <div class="flex justify-between py-1"><dt class="muted">Страна</dt><dd>{{ vinInfo.country ?? 'не определена' }}</dd></div>
            <div class="flex justify-between py-1"><dt class="muted">Изготовитель (WMI {{ vinInfo.wmi }})</dt><dd class="text-right">{{ vinInfo.maker ?? 'нет в базе' }}</dd></div>
            <div class="flex justify-between py-1"><dt class="muted">Модельный год</dt><dd class="font-mono">{{ vinInfo.year ?? '—' }}</dd></div>
            <div class="flex justify-between py-1"><dt class="muted">Завод (11-й знак) / №</dt><dd class="font-mono">{{ vinInfo.plantCode }} / {{ vinInfo.serial }}</dd></div>
          </dl>
          <p v-for="p in vinInfo.problems" :key="p" class="text-xs" :class="vinInfo.valid ? 'text-warn' : 'text-bad'">{{ p }}</p>
          <div v-if="vinInfo.valid" class="grid grid-cols-2 gap-2 pt-1">
            <button class="btn-ghost btn-sm" @click="useDecoded">Применить к профилю</button>
            <button class="btn-ghost btn-sm" :disabled="busy !== null" @click="online">{{ busy === 'web' ? 'Запрос…' : 'Найти в базе NHTSA' }}</button>
          </div>
          <p v-if="vinInfo.valid" class="text-[11px] text-faint">«Найти в базе» отправляет VIN на vpic.nhtsa.dot.gov — только по этой кнопке.</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="text-xs muted">Код двигателя<input v-model="edited.engineCode" class="field mt-1" /></label>
        <label class="text-xs muted">Объём, л<input :value="edited.displacementL ?? ''" type="number" step="0.1" min="0" inputmode="decimal" class="field mt-1" @input="numField('displacementL', $event)" /></label>
        <label class="text-xs muted">Мощность, л.с.<input :value="edited.powerHp ?? ''" type="number" min="0" inputmode="numeric" class="field mt-1" @input="numField('powerHp', $event)" /></label>
        <label class="text-xs muted">Топливо
          <select v-model="edited.fuel" class="field mt-1"><option v-for="f in fuels" :key="f" :value="f">{{ f || '—' }}</option></select>
        </label>
        <label class="text-xs muted">КПП<input v-model="edited.transmission" class="field mt-1" /></label>
        <label class="text-xs muted">Привод<input v-model="edited.drive" class="field mt-1" /></label>
        <label class="text-xs muted">Бак, л<input :value="edited.tankL ?? ''" type="number" min="0" inputmode="numeric" class="field mt-1" @input="numField('tankL', $event)" /></label>
        <label class="text-xs muted">Одометр на приборке, км<input :value="edited.odometerKm ?? ''" type="number" min="0" inputmode="numeric" class="field mt-1" @change="onOdometer" /></label>
        <label class="text-xs muted">Масло (вязкость/класс)<input v-model="edited.oilSpec" class="field mt-1" /></label>
        <label class="text-xs muted">Объём масла, л<input :value="edited.oilCapacityL ?? ''" type="number" step="0.1" min="0" inputmode="decimal" class="field mt-1" @input="numField('oilCapacityL', $event)" /></label>
        <label class="col-span-2 text-xs muted">Шины<input v-model="edited.tires" class="field mt-1" /></label>
        <label class="col-span-2 text-xs muted">Заметки<textarea v-model="edited.notes" rows="3" class="field mt-1 font-sans" /></label>
      </div>

      <p class="text-xs text-faint">Изменения сохраняются автоматически. У каждой машины свои поездки, масло и счётчик пробега; новые поездки пишутся на активную машину.</p>
      <button class="btn w-full" @click="router.push('/')">Готово</button>
    </div>
  </section>
</template>
