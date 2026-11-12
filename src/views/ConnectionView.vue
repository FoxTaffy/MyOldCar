<script setup lang="ts">
import { computed, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import ChoiceSheet from '@/components/ChoiceSheet.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToggleRow from '@/components/ToggleRow.vue'
import { useVehicle } from '@/composables/useVehicle'
import { PROTOCOL_NAMES, pickBleDevice } from '@/services/ELMService'
import type { ConnectionMode } from '@/types'

const v = useVehicle()
const { prefs, status } = v
const linkKey = (): string => [prefs.mode, prefs.host.trim(), prefs.port, prefs.bleId, prefs.protocol, prefs.timeoutMs, prefs.attempts].join('|')
const before = ref(linkKey())
const changed = computed(() => linkKey() !== before.value)

const MODES: { id: ConnectionMode; label: string; sub: string }[] = [
  { id: 'auto', label: 'Авто', sub: 'Сначала Bluetooth (если адаптер выбран), затем Wi-Fi' },
  { id: 'ble', label: 'Bluetooth LE 4.0', sub: 'Адаптеры с Bluetooth 4.0 и новее (в списке обычно «OBDII»)' },
  { id: 'wifi', label: 'Wi-Fi', sub: 'ELM327 Wi-Fi: сначала подключите телефон к сети адаптера' },
  { id: 'mock', label: 'Демо', sub: 'Симуляция машины, чтобы посмотреть приложение без адаптера' },
]
const modeLabel = computed(() => MODES.find((m) => m.id === prefs.mode)?.label ?? '')
const PROTOS = [{ id: '', label: '0) AUTO', sub: 'Рекомендуется: приложение само найдёт протокол и запомнит его' }, ...Object.entries(PROTOCOL_NAMES).filter(([k]) => k !== '0').map(([k, n]) => ({ id: k, label: `${k}) ${n}`, sub: undefined as string | undefined }))]
const protoLabel = computed(() => PROTOS.find((p) => p.id === prefs.protocol)?.label ?? `протокол ${prefs.protocol}`)
const TIMEOUTS = [2000, 3000, 5000, 8000, 12000].map((n) => ({ id: String(n), label: `${n} мс`, sub: n === 5000 ? 'По умолчанию — надёжно на медленной К-линии' : n <= 3000 ? 'Быстрее, но на старых ЭБУ возможны потери ответов' : 'Для плохой связи и дешёвых адаптеров' }))
const ATTEMPTS = [1, 2, 3, 5, 8].map((n) => ({ id: String(n), label: String(n), sub: n === 3 ? 'По умолчанию' : undefined }))

const pick = ref<'mode' | 'proto' | 'timeout' | 'attempts' | null>(null)
const bleBusy = ref(false)
const bleError = ref<string | null>(null)
const showWifi = computed(() => prefs.mode === 'auto' || prefs.mode === 'wifi')
const showBle = computed(() => prefs.mode === 'auto' || prefs.mode === 'ble')
const portText = ref(String(prefs.port))
const portOk = computed(() => /^\d{1,5}$/.test(portText.value.trim()) && Number(portText.value) > 0 && Number(portText.value) < 65536)
const hostOk = computed(() => /^[A-Za-z0-9.\-:]+$/.test(prefs.host.trim()))
function setPort(): void { if (portOk.value) prefs.port = Number(portText.value) }

async function findAdapter(): Promise<void> {
  bleBusy.value = true
  bleError.value = null
  try {
    const d = await pickBleDevice()
    prefs.bleId = d.deviceId
    prefs.bleName = d.name
    prefs.protocol = ''
  } catch (e) {
    const t = e instanceof Error ? e.message : String(e)
    bleError.value = /cancel/i.test(t) ? null : t
  } finally { bleBusy.value = false }
}

async function apply(): Promise<void> {
  prefs.host = prefs.host.trim()
  if (!(prefs.mode === 'ble' && !prefs.bleId)) {
    await v.disconnect()
    await v.connect()
  }
  before.value = linkKey()
}
const statusLine = computed(() => status.value === 'connected' ? (v.ecuSilent.value ? 'Адаптер на связи, ЭБУ молчит — включите зажигание' : `На связи${v.protocolName.value ? ' · ' + v.protocolName.value : ''}`) : status.value === 'connecting' ? v.note.value ?? 'Подключение…' : 'Нет связи с адаптером')
const dot = computed(() => (status.value === 'connected' ? (v.ecuSilent.value ? 'bg-warn' : 'bg-ok') : status.value === 'connecting' ? 'bg-accent animate-pulse' : 'bg-faint'))
const help = ref(false)
const STEPS = [
  'Вставьте адаптер в разъём OBD-II (у ВАЗ — под рулём, у ручки капота или в бардачке) и включите зажигание, лучше заведите двигатель.',
  'Bluetooth: не соединяйте адаптер в системных настройках Bluetooth — приложение ищет его само. Выберите его кнопкой «Найти адаптер».',
  'Wi-Fi: подключите телефон к сети адаптера (обычно «WiFi_OBDII» или «OBDII»), отключив мобильный интернет, и проверьте IP 192.168.0.10, порт 35000.',
  'Если соединение рвётся, увеличьте тайм-аут ответа до 8000 мс и число попыток подключения.',
  'На старых машинах (К-линия) оставьте протокол «AUTO»: первый поиск может занять до минуты.',
  'Выдайте приложению разрешения «Устройства поблизости» и «Геопозиция» — без них Android не покажет Bluetooth-адаптеры.',
]
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Подключение сканера" />

    <div class="card p-4">
      <div class="flex items-center gap-3"><span class="h-3 w-3 shrink-0 rounded-full" :class="dot" /><span class="min-w-0 flex-1 text-sm font-medium">{{ statusLine }}</span></div>
      <div class="mt-3 flex gap-2">
        <button v-if="status === 'disconnected'" class="btn flex-1" @click="v.connect()">Подключить</button>
        <button v-else class="btn-ghost flex-1" @click="v.disconnect()">{{ status === 'connecting' ? 'Отмена' : 'Отключить' }}</button>
      </div>
      <p v-if="v.error.value" class="mt-2 text-xs text-bad">{{ v.error.value }}</p>
    </div>

    <div v-if="changed" class="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent-soft p-3">
      <span class="flex-1 text-sm text-soft">Параметры связи изменены.</span>
      <button class="btn btn-sm" @click="apply">Применить</button>
    </div>

    <button class="flex w-full items-center gap-3 rounded-2xl bg-accent-soft p-4 text-left" :aria-expanded="help" @click="help = !help">
      <span class="min-w-0 flex-1"><span class="block text-xs text-mute">Проблемы с подключением?</span><span class="block text-lg font-bold leading-tight text-ink">Проверить, что не так</span></span>
      <AppIcon name="book" :size="40" class="shrink-0 text-accent" />
    </button>
    <ol v-if="help" class="card list-decimal space-y-2 py-4 pl-9 pr-4 text-sm leading-relaxed text-soft"><li v-for="s in STEPS" :key="s">{{ s }}</li></ol>

    <div class="card overflow-hidden">
      <button class="row" @click="pick = 'mode'"><span class="row-title">Тип соединения</span><span class="row-val">{{ modeLabel }}</span></button>
      <template v-if="showBle">
        <div class="row">
          <span class="min-w-0"><span class="row-title">Bluetooth-адаптер</span><span class="row-sub">{{ prefs.bleName || (prefs.bleId ? 'выбран' : 'не выбран') }}</span></span>
          <span class="flex shrink-0 gap-2">
            <button v-if="prefs.bleId" class="text-sm text-faint" @click="prefs.bleId = ''; prefs.bleName = ''">Забыть</button>
            <button class="btn btn-sm" :disabled="bleBusy" @click="findAdapter">{{ bleBusy ? 'Поиск…' : 'Найти адаптер' }}</button>
          </span>
        </div>
      </template>
      <template v-if="showWifi">
        <label class="row"><span class="row-title">IP-адрес адаптера</span><input v-model="prefs.host" inputmode="decimal" class="w-36 bg-transparent text-right text-sm font-medium outline-none" :class="hostOk ? 'text-accent' : 'text-bad'"></label>
        <label class="row"><span class="row-title">Порт</span><input v-model="portText" inputmode="numeric" class="w-20 bg-transparent text-right text-sm font-medium outline-none" :class="portOk ? 'text-accent' : 'text-bad'" @change="setPort"></label>
      </template>
      <button class="row" @click="pick = 'proto'"><span class="min-w-0"><span class="row-title">Тип протокола</span><span class="row-sub">Если подключение не удаётся, выберите протокол вручную</span></span><span class="row-val">{{ protoLabel }}</span></button>
      <button class="row" @click="pick = 'timeout'"><span class="min-w-0"><span class="row-title">Тайм-аут ответа</span><span class="row-sub">Чем короче, тем быстрее опрос, но выше риск потерь данных</span></span><span class="row-val">{{ prefs.timeoutMs }} мс</span></button>
      <button v-if="showBle" class="row" @click="pick = 'attempts'"><span class="min-w-0"><span class="row-title">Попыток подключения</span><span class="row-sub">Bluetooth за один заход; пауза между попытками растёт</span></span><span class="row-val">{{ prefs.attempts }}</span></button>
    </div>
    <p v-if="bleError" class="rounded-xl bg-bad/10 px-3 py-2 text-xs text-bad">{{ bleError }}</p>

    <div class="card overflow-hidden">
      <ToggleRow v-model="prefs.autoConnect" title="Автоподключение" sub="Подключаться при запуске и переподключаться при потере связи" />
      <ToggleRow v-model="prefs.backgroundTracking" title="Запись поездок в фоне" sub="GPS-служба с уведомлением: работает при свёрнутом приложении и выключенном экране" />
    </div>
    <div class="card overflow-hidden">
      <RouterLink to="/permissions" class="row"><span class="row-title">Разрешения приложения</span><AppIcon name="chevron" :size="18" class="text-faint" /></RouterLink>
    </div>

    <ChoiceSheet v-if="pick === 'mode'" title="Тип соединения" :options="MODES" :model-value="prefs.mode" @update:model-value="prefs.mode = $event as ConnectionMode" @close="pick = null" />
    <ChoiceSheet v-if="pick === 'proto'" title="Тип протокола" :options="PROTOS" :model-value="prefs.protocol" @update:model-value="prefs.protocol = $event" @close="pick = null" />
    <ChoiceSheet v-if="pick === 'timeout'" title="Тайм-аут ответа" :options="TIMEOUTS" :model-value="String(prefs.timeoutMs)" @update:model-value="prefs.timeoutMs = Number($event)" @close="pick = null" />
    <ChoiceSheet v-if="pick === 'attempts'" title="Попыток подключения" :options="ATTEMPTS" :model-value="String(prefs.attempts)" @update:model-value="prefs.attempts = Number($event)" @close="pick = null" />
  </section>
</template>
