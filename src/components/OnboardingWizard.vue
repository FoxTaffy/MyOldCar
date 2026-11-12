<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { pickBleDevice } from '@/services/ELMService'
import { todayISO } from '@/utils/format'
import type { AppSettings, ConnectionMode } from '@/types'

const emit = defineEmits<{ done: [] }>()
const { prefs, settings, connect, disconnect, status, startGps } = useVehicle()
const { garage, car, setOil } = useGarage()

/** Первый запуск — полный мастер; потом это же окно служит настройками (без шага про масло — оно на вкладке «Сервис»). */
const firstRun = !prefs.onboarded
type Step = 'connect' | 'context' | 'oil' | 'done'
const steps: Step[] = firstRun ? ['connect', 'context', 'oil', 'done'] : ['connect', 'context']
const stepNames: Record<Step, string> = { connect: 'Подключение', context: 'Машина', oil: 'Масло', done: 'Готово' }
const step = ref(0)
const current = computed(() => steps[step.value])
const last = computed(() => step.value === steps.length - 1)

const connectNow = ref(true)
const bleBusy = ref(false)
const bleError = ref<string | null>(null)
/** Параметры связи на момент открытия: если их поменяли — после закрытия переподключаемся. */
const linkKey = (): string => [prefs.mode, prefs.host.trim(), prefs.port, prefs.bleId].join('|')
const linkBefore = linkKey()

const modes: { k: ConnectionMode; t: string; d: string }[] = [
  { k: 'auto', t: 'Авто', d: 'Сначала Bluetooth (если адаптер выбран), затем Wi-Fi' },
  { k: 'ble', t: 'Bluetooth LE', d: 'Адаптер с Bluetooth 4.0 и новее (в списке обычно «OBDII»)' },
  { k: 'wifi', t: 'Wi-Fi', d: 'ELM327 Wi-Fi: сначала подключите телефон к сети адаптера' },
  { k: 'mock', t: 'Демо', d: 'Симуляция машины, чтобы посмотреть приложение без адаптера' },
]
const showBle = computed(() => prefs.mode === 'auto' || prefs.mode === 'ble')
const showWifi = computed(() => prefs.mode === 'auto' || prefs.mode === 'wifi')

const portText = ref(String(prefs.port))
const portOk = computed(() => /^\d{1,5}$/.test(portText.value.trim()) && Number(portText.value) > 0 && Number(portText.value) < 65536)
const hostOk = computed(() => /^[A-Za-z0-9.\-:]+$/.test(prefs.host.trim()))
const problem = computed(() => {
  if (current.value !== 'connect') return null
  if (prefs.mode === 'ble' && !prefs.bleId) return 'Выберите Bluetooth-адаптер кнопкой «Найти адаптер»'
  if (showWifi.value && !hostOk.value) return 'Укажите IP-адрес адаптера, например 192.168.0.10'
  if (showWifi.value && !portOk.value) return 'Порт — число от 1 до 65535 (обычно 35000)'
  return null
})

async function findAdapter(): Promise<void> {
  bleBusy.value = true
  bleError.value = null
  try {
    const d = await pickBleDevice()
    prefs.bleId = d.deviceId
    prefs.bleName = d.name
    prefs.protocol = '' // у другого адаптера/машины протокол может отличаться
  } catch (e) {
    const text = e instanceof Error ? e.message : String(e)
    // Пользователь просто закрыл окно выбора — это не ошибка.
    bleError.value = /cancel/i.test(text) ? null : text
  } finally {
    bleBusy.value = false
  }
}

function forgetAdapter(): void {
  prefs.bleId = ''
  prefs.bleName = ''
}

const toggles: { key: keyof AppSettings; label: string; hint: string }[] = [
  { key: 'recentFuelServicing', label: 'Недавно обслуживались топливные магистрали / бак', hint: 'Повышает вероятность проблем с давлением топлива' },
  { key: 'recentAirIntakeServicing', label: 'Недавно трогали впуск (ДМРВ, гофра, фильтр)', hint: 'Повышает вероятность подсоса воздуха' },
  { key: 'recentIgnitionServicing', label: 'Недавно меняли свечи / провода / модуль зажигания', hint: 'Учитывается при пропусках зажигания' },
  { key: 'coldStartOnly', label: 'Неисправность проявляется только на холодном', hint: 'Влияет на оценку модуля зажигания' },
]

const oil = reactive<{ date: string; since: number | ''; interval: number | '' }>({ date: car().oil.dateISO ?? '', since: '', interval: car().oil.intervalKm })
const summary = computed(() => {
  const m = prefs.mode
  const ble = prefs.bleName ? `Bluetooth «${prefs.bleName}»` : 'Bluetooth (адаптер не выбран)'
  const wifi = `Wi-Fi ${prefs.host}:${prefs.port}`
  return m === 'mock' ? 'демо-режим' : m === 'ble' ? ble : m === 'wifi' ? wifi : `авто — ${prefs.bleId ? ble + ', затем ' : ''}${wifi}`
})

function next(): void {
  if (problem.value) return
  if (last.value) void finish()
  else step.value++
}

async function finish(): Promise<void> {
  if (showWifi.value && portOk.value) prefs.port = Number(portText.value)
  prefs.host = prefs.host.trim()
  // Масло спрашиваем только при первом запуске и только если дату указали: иначе счётчик не трогаем.
  if (firstRun && oil.date) setOil(oil.date, oil.since === '' ? 0 : oil.since, oil.interval === '' ? car().oil.intervalKm : oil.interval)
  prefs.onboarded = true
  startGps()
  emit('done')
  const changed = linkKey() !== linkBefore
  if (firstRun) {
    if (connectNow.value && status.value === 'disconnected') await connect()
  } else if (changed) {
    // Способ связи изменили — старое подключение больше не актуально.
    prefs.protocol = ''
    const wasOn = status.value !== 'disconnected'
    await disconnect()
    if (wasOn || prefs.autoConnect) await connect()
  }
}
</script>

<template>
  <div class="fixed inset-0 z-[2000] flex items-end justify-center bg-black/80 sm:items-center" role="dialog" aria-modal="true" :aria-label="firstRun ? 'Первая настройка' : 'Настройки'">
    <div class="card flex max-h-full w-full max-w-md flex-col bg-night-900">
      <div class="space-y-3 p-5 pb-3">
        <div class="flex items-center justify-between">
          <span class="label">{{ firstRun ? 'Первая настройка' : 'Настройки' }}</span>
          <button v-if="!firstRun" class="link" @click="finish">закрыть ✕</button>
          <span v-else class="font-mono text-xs muted">{{ step + 1 }} / {{ steps.length }}</span>
        </div>
        <div class="grid gap-1" :style="{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }">
          <button v-for="(s, i) in steps" :key="s" class="border-t-2 pt-1 text-left text-[10px] font-semibold uppercase tracking-wider" :class="i === step ? 'border-accent text-[#d5dae2]' : i < step ? 'border-accent/50 muted' : 'border-night-600 text-[#4a5260]'" :disabled="i > step && !!problem" @click="step = i">{{ stepNames[s] }}</button>
        </div>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-5">
        <section v-if="current === 'connect'" class="space-y-2">
          <label v-for="m in modes" :key="m.k" class="flex items-start gap-3 border p-3" :class="prefs.mode === m.k ? 'border-accent' : 'border-night-600'">
            <input type="radio" name="mode" class="mt-0.5" :checked="prefs.mode === m.k" @change="prefs.mode = m.k" />
            <span><b>{{ m.t }}</b><br /><span class="text-xs muted">{{ m.d }}</span></span>
          </label>

          <div v-if="showBle" class="border border-night-600 p-3">
            <div class="label mb-1">Bluetooth-адаптер</div>
            <div class="flex items-center gap-2">
              <span class="mr-auto min-w-0 truncate font-mono text-sm">{{ prefs.bleName || 'не выбран' }}</span>
              <button v-if="prefs.bleId" class="link" @click="forgetAdapter">забыть</button>
              <button class="btn-ghost btn-sm shrink-0" :disabled="bleBusy" @click="findAdapter">{{ bleBusy ? 'Поиск…' : prefs.bleId ? 'Сменить' : 'Найти адаптер' }}</button>
            </div>
            <p class="mt-2 text-xs text-[#5f6978]">Включите зажигание, вставьте адаптер и нажмите «Найти». Перед этим закройте Car Scanner и другие OBD-приложения: BLE-адаптер принимает только одно подключение.</p>
            <p v-if="bleError" class="mt-1 font-mono text-xs text-bad">{{ bleError }}</p>
          </div>

          <div v-if="showWifi" class="grid grid-cols-3 gap-3 border border-night-600 p-3">
            <label class="col-span-2 text-xs muted">IP адаптера (Wi-Fi)
              <input v-model="prefs.host" inputmode="decimal" autocomplete="off" spellcheck="false" class="field mt-1" :class="hostOk ? '' : '!border-bad'" />
            </label>
            <label class="text-xs muted">Порт
              <input v-model="portText" inputmode="numeric" class="field mt-1" :class="portOk ? '' : '!border-bad'" />
            </label>
          </div>

          <template v-if="prefs.mode !== 'mock'">
            <label class="flex items-start gap-3 py-1 text-sm">
              <input v-model="prefs.autoConnect" type="checkbox" class="mt-0.5" />
              <span>Подключаться автоматически и переподключаться при обрыве</span>
            </label>
            <label class="flex items-start gap-3 py-1 text-sm">
              <input v-model="prefs.backgroundTracking" type="checkbox" class="mt-0.5" />
              <span>Записывать поездки в фоне (GPS + датчики, с уведомлением).<br /><span class="text-xs muted">Поездка сама завершится, если 30 минут нет движения и двигатель заглушен.</span></span>
            </label>
          </template>
        </section>

        <section v-else-if="current === 'context'" class="space-y-2">
          <p class="text-sm muted">Что недавно делали с машиной — по этому диагност точнее оценивает причины ошибок. Эти же галочки есть на вкладке «Ошибки».</p>
          <label v-for="t in toggles" :key="t.key" class="flex items-start gap-3 border p-3" :class="settings[t.key] ? 'border-accent' : 'border-night-600'">
            <input v-model="settings[t.key]" type="checkbox" class="mt-0.5" />
            <span class="text-sm">{{ t.label }}<br /><span class="text-xs text-[#5f6978]">{{ t.hint }}</span></span>
          </label>
        </section>

        <section v-else-if="current === 'oil'" class="space-y-3">
          <p class="text-sm muted">Можно пропустить и заполнить позже на вкладке «Сервис».</p>
          <label class="block text-xs muted">Дата последней замены масла
            <div class="mt-1 flex gap-2"><input v-model="oil.date" type="date" :max="todayISO()" class="field" /><button class="btn-ghost btn-sm shrink-0" @click="oil.date = todayISO()">Сегодня</button></div>
          </label>
          <div class="grid grid-cols-2 gap-3">
            <label class="block text-xs muted">Пройдено с замены, км
              <input v-model.number="oil.since" type="number" min="0" inputmode="numeric" placeholder="0" class="field mt-1" />
            </label>
            <label class="block text-xs muted">Интервал замены, км
              <input v-model.number="oil.interval" type="number" min="1000" step="500" inputmode="numeric" class="field mt-1" />
            </label>
          </div>
          <label class="block text-xs muted">Цена бензина, ₽/л
            <input v-model.number="garage.fuelPrice" type="number" min="0" step="0.5" inputmode="decimal" class="field mt-1" />
          </label>
        </section>

        <section v-else class="space-y-3">
          <p class="text-sm muted">Подключение: <b class="text-[#d5dae2]">{{ summary }}</b>.</p>
          <p class="text-sm muted">Приложение только читает данные из ЭБУ и ничего в нём не меняет. Настройки открываются кнопкой справа вверху, профиль машины — по её названию в шапке.</p>
          <label class="flex items-center gap-3 text-sm"><input v-model="connectNow" type="checkbox" /> Подключиться сразу</label>
        </section>
      </div>

      <div class="space-y-2 p-5 pt-3">
        <p v-if="problem" class="text-xs text-warn">{{ problem }}</p>
        <div class="flex gap-2">
          <button v-if="step > 0" class="btn-ghost" @click="step--">Назад</button>
          <button class="btn flex-1" :disabled="!!problem" @click="next">{{ last ? (firstRun ? 'Начать' : 'Готово') : 'Далее' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
