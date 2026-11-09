<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { CAR_PRESETS, carTitle, type Car } from '@/services/Cars'
import { decodeVin } from '@/services/Vin'
import { decodeVinOnline, scanVinWithCamera } from '@/services/VinScanner'
import { num } from '@/utils/format'

const router = useRouter()
const { garage, car, selectCar, addCar, removeCar } = useGarage()
const { isConnected, getElm } = useVehicle()

const editing = ref<string | null>(car().id)
const edited = computed<Car | null>(() => garage.cars.find((c) => c.id === editing.value) ?? null)
const msg = ref<string | null>(null)
const msgBad = ref(false)
const busy = ref<'ecu' | 'cam' | 'web' | null>(null)

const say = (m: string, bad = false): void => { msg.value = m; msgBad.value = bad }

function add(): void {
  const c = addCar({ name: `Машина ${garage.cars.length + 1}` })
  editing.value = c.id
  say('Добавлена новая машина — заполните данные или выберите шаблон')
}

function remove(c: Car): void {
  if (garage.cars.length <= 1) return say('Нельзя удалить единственную машину', true)
  if (confirm(`Удалить «${carTitle(c)}» вместе с её поездками?`)) {
    removeCar(c.id)
    editing.value = car().id
  }
}

function pick(c: Car): void {
  selectCar(c.id)
  editing.value = c.id
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
  say('VIN применён к профилю')
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
    <div class="flex items-center justify-between">
      <h2 class="label">Мои автомобили</h2>
      <button class="btn !px-3 !py-2 !text-xs" @click="add">+ Добавить</button>
    </div>

    <div class="space-y-2">
      <article v-for="c in garage.cars" :key="c.id" class="card flex items-center gap-3 p-3" :class="c.id === garage.activeCarId ? '!border-accent' : ''">
        <div class="min-w-0 flex-1" @click="pick(c)">
          <div class="truncate font-semibold">{{ carTitle(c) }}</div>
          <div class="truncate font-mono text-xs text-[#7b8696]">
            {{ [c.year, c.plate, c.displacementL ? c.displacementL + ' л' : '', c.powerHp ? c.powerHp + ' л.с.' : ''].filter(Boolean).join(' · ') || 'без данных' }}
          </div>
          <div class="font-mono text-xs text-[#5f6978]">учтено приложением: {{ num(c.trackedTotalKm, 0) }} км</div>
        </div>
        <span v-if="c.id === garage.activeCarId" class="label text-ok">активна</span>
        <button v-else class="btn-ghost !px-3 !py-2 !text-xs" @click="pick(c)">Выбрать</button>
      </article>
    </div>

    <p v-if="msg" class="text-sm" :class="msgBad ? 'text-bad' : 'text-ok'">{{ msg }}</p>

    <div v-if="edited" class="card space-y-3 p-4">
      <div class="flex items-center justify-between">
        <h3 class="label">Профиль: {{ carTitle(edited) }}</h3>
        <button class="text-xs text-bad underline" @click="remove(edited)">удалить</button>
      </div>

      <label class="block text-xs text-[#7b8696]">Заполнить по шаблону
        <select v-model="presetIdx" class="field mt-1" @change="applyPreset">
          <option value="">— выберите модель —</option>
          <option v-for="(p, i) in CAR_PRESETS" :key="p.label" :value="String(i)">{{ p.label }}</option>
        </select>
      </label>

      <div class="grid grid-cols-2 gap-3">
        <label class="col-span-2 text-xs text-[#7b8696]">Название<input v-model="edited.name" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Марка<input v-model="edited.make" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Модель<input v-model="edited.model" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Год<input v-model.number="edited.year" type="number" inputmode="numeric" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Госномер<input v-model="edited.plate" class="field mt-1 uppercase" /></label>
        <label class="text-xs text-[#7b8696]">Цвет<input v-model="edited.color" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Кузов<input v-model="edited.body" class="field mt-1" /></label>
      </div>

      <div class="space-y-2 border border-night-600 p-3">
        <div class="label">VIN</div>
        <input v-model="edited.vin" maxlength="24" placeholder="17 знаков" class="field uppercase tracking-wider" autocapitalize="characters" spellcheck="false" />
        <div class="grid grid-cols-2 gap-2">
          <button class="btn-ghost !px-2 !py-2 !text-xs" :disabled="busy !== null" @click="fromCamera">{{ busy === 'cam' ? 'Сканирую…' : 'Сканировать камерой' }}</button>
          <button class="btn-ghost !px-2 !py-2 !text-xs" :disabled="!isConnected || busy !== null" :title="isConnected ? '' : 'Нужно подключение к адаптеру'" @click="fromEcu">{{ busy === 'ecu' ? 'Читаю…' : 'Считать из ЭБУ' }}</button>
        </div>
        <div v-if="vinInfo" class="space-y-1 text-sm">
          <dl v-if="vinInfo.valid" class="divide-y divide-night-600">
            <div class="flex justify-between py-1"><dt class="text-[#7b8696]">Страна</dt><dd>{{ vinInfo.country ?? 'не определена' }}</dd></div>
            <div class="flex justify-between py-1"><dt class="text-[#7b8696]">Изготовитель (WMI {{ vinInfo.wmi }})</dt><dd class="text-right">{{ vinInfo.maker ?? 'нет в базе' }}</dd></div>
            <div class="flex justify-between py-1"><dt class="text-[#7b8696]">Модельный год</dt><dd class="font-mono">{{ vinInfo.year ?? '—' }}</dd></div>
            <div class="flex justify-between py-1"><dt class="text-[#7b8696]">Завод (11-й знак) / №</dt><dd class="font-mono">{{ vinInfo.plantCode }} / {{ vinInfo.serial }}</dd></div>
          </dl>
          <p v-for="p in vinInfo.problems" :key="p" class="text-xs" :class="vinInfo.valid ? 'text-warn' : 'text-bad'">{{ p }}</p>
          <div v-if="vinInfo.valid" class="grid grid-cols-2 gap-2 pt-1">
            <button class="btn-ghost !px-2 !py-2 !text-xs" @click="useDecoded">Применить к профилю</button>
            <button class="btn-ghost !px-2 !py-2 !text-xs" :disabled="busy !== null" @click="online">{{ busy === 'web' ? 'Запрос…' : 'Найти в базе NHTSA' }}</button>
          </div>
          <p v-if="vinInfo.valid" class="text-[11px] text-[#5f6978]">«Найти в базе» отправляет VIN на vpic.nhtsa.dot.gov — только по этой кнопке.</p>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <label class="text-xs text-[#7b8696]">Код двигателя<input v-model="edited.engineCode" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Объём, л<input v-model.number="edited.displacementL" type="number" step="0.1" inputmode="decimal" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Мощность, л.с.<input v-model.number="edited.powerHp" type="number" inputmode="numeric" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Топливо
          <select v-model="edited.fuel" class="field mt-1"><option v-for="f in fuels" :key="f" :value="f">{{ f || '—' }}</option></select>
        </label>
        <label class="text-xs text-[#7b8696]">КПП<input v-model="edited.transmission" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Привод<input v-model="edited.drive" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Бак, л<input v-model.number="edited.tankL" type="number" inputmode="numeric" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Одометр, км<input v-model.number="edited.odometerKm" type="number" inputmode="numeric" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Масло (вязкость/класс)<input v-model="edited.oilSpec" class="field mt-1" /></label>
        <label class="text-xs text-[#7b8696]">Объём масла, л<input v-model.number="edited.oilCapacityL" type="number" step="0.1" inputmode="decimal" class="field mt-1" /></label>
        <label class="col-span-2 text-xs text-[#7b8696]">Шины<input v-model="edited.tires" class="field mt-1" /></label>
        <label class="col-span-2 text-xs text-[#7b8696]">Заметки<textarea v-model="edited.notes" rows="3" class="field mt-1 font-sans" /></label>
      </div>

      <p class="text-xs text-[#5f6978]">Изменения сохраняются автоматически. У каждой машины свои поездки, масло и счётчик пробега; новые поездки пишутся на активную машину.</p>
      <button class="btn w-full" @click="router.push('/')">Готово</button>
    </div>
  </section>
</template>
