<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { pickBleDevice } from '@/services/ELMService'
import { todayISO } from '@/utils/format'
import type { AppSettings, ConnectionMode } from '@/types'

const emit = defineEmits<{ done: [] }>()
const { prefs, settings, connect, status, startGps } = useVehicle()
const { garage, car, setOil } = useGarage()

const step = ref(0)
const total = 4
const connectNow = ref(true)
const bleBusy = ref(false)
const bleError = ref<string | null>(null)

const modes: { k: ConnectionMode; t: string; d: string }[] = [
  { k: 'auto', t: 'Авто', d: 'Сначала Bluetooth (если адаптер выбран), затем Wi-Fi' },
  { k: 'ble', t: 'Bluetooth LE', d: 'Адаптер с Bluetooth 4.0 (как «OBDII» в Car Scanner)' },
  { k: 'wifi', t: 'Wi-Fi', d: 'ELM327 Wi-Fi: подключите телефон к сети адаптера' },
  { k: 'mock', t: 'Демо', d: 'Симуляция машины, чтобы посмотреть интерфейс' },
]
const showBle = computed(() => prefs.mode === 'auto' || prefs.mode === 'ble')
const showWifi = computed(() => prefs.mode === 'auto' || prefs.mode === 'wifi')

const portText = computed({
  get: () => String(prefs.port),
  set: (v: string) => { const n = parseInt(v, 10); if (n > 0 && n < 65536) prefs.port = n },
})

async function findAdapter(): Promise<void> {
  bleBusy.value = true
  bleError.value = null
  try {
    const d = await pickBleDevice()
    prefs.bleId = d.deviceId
    prefs.bleName = d.name
  } catch (e) {
    bleError.value = e instanceof Error ? e.message : String(e)
  } finally {
    bleBusy.value = false
  }
}

const toggles: { key: keyof AppSettings; label: string; hint: string }[] = [
  { key: 'recentFuelServicing', label: 'Недавно обслуживались топливные магистрали / бак', hint: 'Повышает вероятность проблем с давлением топлива' },
  { key: 'recentAirIntakeServicing', label: 'Недавно трогали впуск (ДМРВ, гофра, фильтр)', hint: 'Повышает вероятность подсоса воздуха' },
  { key: 'recentIgnitionServicing', label: 'Недавно меняли свечи / провода / модуль зажигания', hint: 'Учитывается при пропусках зажигания' },
  { key: 'coldStartOnly', label: 'Неисправность проявляется только на холодном', hint: 'Влияет на оценку модуля зажигания' },
]

const oil = reactive({ date: car().oil.dateISO ?? '', since: 0, interval: car().oil.intervalKm })
const summary = computed(() => {
  const m = prefs.mode
  const ble = prefs.bleName ? `Bluetooth ${prefs.bleName}` : 'Bluetooth (не выбран)'
  const wifi = `Wi-Fi ${prefs.host}:${prefs.port}`
  return m === 'mock' ? 'демо' : m === 'ble' ? ble : m === 'wifi' ? wifi : `авто: ${prefs.bleId ? ble + ' → ' : ''}${wifi}`
})

async function finish(): Promise<void> {
  if (oil.date) setOil(oil.date, oil.since, oil.interval)
  prefs.onboarded = true
  startGps()
  emit('done')
  if (connectNow.value && status.value === 'disconnected') await connect()
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/80 sm:items-center">
    <div class="card max-h-full w-full max-w-md space-y-4 overflow-y-auto bg-night-900 p-5">
      <div class="flex items-center justify-between">
        <span class="label">Настройка</span>
        <span class="font-mono text-xs text-[#7b8696]">{{ step + 1 }} / {{ total }}</span>
      </div>
      <div class="h-px bg-night-600"><div class="h-px bg-accent" :style="{ width: ((step + 1) / total) * 100 + '%' }" /></div>

      <section v-if="step === 0" class="space-y-2">
        <h2 class="text-base font-semibold uppercase tracking-wider">Подключение</h2>
        <label v-for="m in modes" :key="m.k" class="flex items-start gap-3 border p-3" :class="prefs.mode === m.k ? 'border-accent' : 'border-night-600'">
          <input type="radio" name="mode" class="mt-1" :checked="prefs.mode === m.k" @change="prefs.mode = m.k" />
          <span><b>{{ m.t }}</b><br /><span class="text-xs text-[#7b8696]">{{ m.d }}</span></span>
        </label>

        <div v-if="showBle" class="border border-night-600 p-3">
          <div class="label mb-1">Bluetooth-адаптер</div>
          <div class="flex items-center gap-2">
            <span class="mr-auto font-mono text-sm">{{ prefs.bleName || 'не выбран' }}</span>
            <button class="btn-ghost !px-3 !py-2 !text-xs" :disabled="bleBusy" @click="findAdapter">{{ bleBusy ? 'Поиск…' : prefs.bleId ? 'Сменить' : 'Найти адаптер' }}</button>
          </div>
          <p class="mt-1 text-xs text-[#5f6978]">Включите зажигание, вставьте адаптер и нажмите «Найти». Разрешите доступ к Bluetooth. Выберите «OBDII» (или похожее) в списке. Перед этим закройте Car Scanner и другие OBD-приложения: BLE-адаптер принимает только одно подключение.</p>
          <p v-if="bleError" class="mt-1 font-mono text-xs text-bad">{{ bleError }}</p>
        </div>

        <div v-if="showWifi" class="grid grid-cols-3 gap-3 border border-night-600 p-3">
          <label class="col-span-2 text-xs text-[#7b8696]">IP адаптера (Wi-Fi)
            <input v-model="prefs.host" inputmode="decimal" class="field mt-1" />
          </label>
          <label class="text-xs text-[#7b8696]">Порт
            <input v-model="portText" inputmode="numeric" class="field mt-1" />
          </label>
        </div>

        <label v-if="prefs.mode !== 'mock'" class="flex items-center gap-3 text-sm">
          <input v-model="prefs.autoConnect" type="checkbox" /> Подключаться автоматически и переподключаться при обрыве
        </label>
        <label v-if="prefs.mode !== 'mock'" class="flex items-start gap-3 text-sm">
          <input v-model="prefs.backgroundTracking" type="checkbox" class="mt-1" />
          <span>Записывать поездки в фоне (GPS + датчики, с уведомлением). Запись сама завершится, если 30 минут нет данных.</span>
        </label>
      </section>

      <section v-else-if="step === 1" class="space-y-2">
        <h2 class="text-base font-semibold uppercase tracking-wider">Состояние машины</h2>
        <p class="text-sm text-[#7b8696]">Помогает диагносту точнее оценить причины ошибок. Можно изменить позже на экране «Ошибки».</p>
        <label v-for="t in toggles" :key="t.key" class="flex items-start gap-3 border border-night-600 p-3">
          <input v-model="settings[t.key]" type="checkbox" class="mt-1" />
          <span class="text-sm">{{ t.label }}<br /><span class="text-xs text-[#5f6978]">{{ t.hint }}</span></span>
        </label>
      </section>

      <section v-else-if="step === 2" class="space-y-3">
        <h2 class="text-base font-semibold uppercase tracking-wider">Масло и топливо</h2>
        <p class="text-sm text-[#7b8696]">Можно пропустить и заполнить позже на вкладке «Сервис».</p>
        <label class="block text-xs text-[#7b8696]">Дата последней замены масла
          <div class="mt-1 flex gap-2"><input v-model="oil.date" type="date" class="field" /><button class="btn-ghost !px-3 !py-2 !text-xs" @click="oil.date = todayISO()">Сегодня</button></div>
        </label>
        <label class="block text-xs text-[#7b8696]">Сколько км проехали с замены
          <input v-model.number="oil.since" type="number" min="0" inputmode="numeric" class="field mt-1" />
        </label>
        <label class="block text-xs text-[#7b8696]">Интервал замены, км
          <input v-model.number="oil.interval" type="number" min="1000" step="500" inputmode="numeric" class="field mt-1" />
        </label>
        <label class="block text-xs text-[#7b8696]">Цена бензина, ₽/л
          <input v-model.number="garage.fuelPrice" type="number" min="0" step="0.5" inputmode="decimal" class="field mt-1" />
        </label>
      </section>

      <section v-else class="space-y-3">
        <h2 class="text-base font-semibold uppercase tracking-wider">Готово</h2>
        <p class="text-sm text-[#7b8696]">Подключение: <b class="text-[#d5dae2]">{{ summary }}</b>. Настройки можно открыть снова кнопкой «Настр.» вверху.</p>
        <label class="flex items-center gap-3 text-sm"><input v-model="connectNow" type="checkbox" /> Подключиться сразу</label>
      </section>

      <div class="flex gap-3 pt-1">
        <button v-if="step > 0" class="btn-ghost" @click="step--">Назад</button>
        <button v-if="step < total - 1" class="btn flex-1" @click="step++">Далее</button>
        <button v-else class="btn flex-1" @click="finish">Начать</button>
      </div>
    </div>
  </div>
</template>
