import { computed, reactive, ref, shallowRef, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { createElmService, type ELMService } from '@/services/ELMService'
import { GpsService, type GpsState } from '@/services/GpsService'
import { TripSession, type GpsFix } from '@/services/TripSession'
import { destinationPoint } from '@/services/TripAnalysis'
import { ensureNotifyPermission, notify } from '@/services/ReadyNotifier'
import { useSensors } from '@/composables/useSensors'
import { compileFormula, type Formula } from '@/services/Formula'
import type { EcuStatus } from '@/services/EcuStatus'
import { Notifier } from '@/services/Notifier'
import type { SensorDef } from '@/data/sensors'
import { WarmupTracker, type WarmupInfo } from '@/services/WarmupTracker'
import { useGarage } from '@/composables/useGarage'
import { useUi } from '@/composables/useUi'
import { DEFAULT_SETTINGS, type AppSettings, type ConnectionKind, type ConnectionMode, type SensorSnapshot } from '@/types'

/* Модульный синглтон: одно соединение с адаптером на всё приложение. */

const LS_KEY = 'myoldcar.settings.v1'
const PREFS_KEY = 'myoldcar.prefs.v2'

function load<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

const native = Capacitor.isNativePlatform()

const prefs = reactive(load(PREFS_KEY, {
  // В браузере по умолчанию демо; на телефоне — автоподбор (Bluetooth, затем Wi-Fi).
  mode: (native ? 'auto' : 'mock') as ConnectionMode,
  host: '192.168.0.10',
  port: 35000,
  bleId: '',
  bleName: '',
  /** Протокол ЭБУ, найденный при последнем успешном подключении (номер ATSP). */
  protocol: '',
  /** Подключаться при запуске и переподключаться при потере связи. */
  autoConnect: true,
  /** Пройден ли мастер первого запуска. */
  onboarded: false,
  /** Фоновая запись поездок: GPS + службой переднего плана (работает при свёрнутом приложении). */
  backgroundTracking: true,
  /** Сколько ждать ответа адаптера, мс (короче — быстрее опрос, но на К-линии выше риск потери ответов). */
  timeoutMs: 5000,
  /** Попыток подключения по Bluetooth за один заход. */
  attempts: 3,
}))
watch(prefs, (v) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

const settings = reactive<AppSettings>(load(LS_KEY, { ...DEFAULT_SETTINGS }))
watch(settings, (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

const status = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
const via = ref<ConnectionKind | null>(null)
const error = ref<string | null>(null)
/** Что сейчас делает подключение («Поиск протокола ЭБУ…»). */
const note = ref<string | null>(null)
const snapshot = ref<SensorSnapshot | null>(null)
/** normal — полный цикл PID; fast — только скорость+обороты; off — опрос на паузе. */
const pollMode = ref<'normal' | 'fast' | 'off'>('normal')
/** Данные текущей поездки (для реактивного показа). */
const NO_TRIP = { start: 0, distanceKm: 0, fuelL: 0, movingMs: 0, stoppedMs: 0, maxSpeedKmh: 0 }
const tripLive = ref({ ...NO_TRIP })
/** Название протокола обмена с ЭБУ текущего подключения. */
const protocolName = ref<string | null>(null)

const garage = useGarage()
const sensors = useSensors()
const session = new TripSession(garage.car().id, () => sensors.allDefs.value)
const { ui } = useUi()
watch(() => ui.speedLimit, (n) => { session.speedLimit = n }, { immediate: true })
const notifier = new Notifier()
/** Значения всех датчиков по id (ядро из снимка + PID-датчики), обновляются каждый цикл. */
const values = shallowRef<Record<string, number | null>>({})
/** Последние ~90 точек каждого датчика для мини-графиков. */
const history = shallowRef<Record<string, number[]>>({})
/** Время подключения к машине (для «работает с …»). */
const connectedAt = ref<number | null>(null)
/** Статус ЭБУ (лампа, коды, тесты, режим топливоподачи); обновляется редко. */
const ecuStatus = ref<EcuStatus | null>(null)
const HISTORY_LEN = 90
const EXTRA_PER_CYCLE = 3
const STATUS_EVERY = 30
const extras: Record<string, number | null> = {}
const formulas = new Map<string, { src: string; fn: Formula | null }>()
let extraCursor = 0
const gps = new GpsService()
const gpsState = ref<GpsState>('off')
const gpsFix = ref<GpsFix | null>(null)
const gpsError = ref<string | null>(null)
/** Лампа Check Engine горит (по данным ЭБУ). */
const milOn = ref(false)
/** Идёт ли запись поездки. */
const tripActive = ref(false)
const IDLE_CHECK_MS = 30_000

/** Прогрев двигателя после подключения: уведомление, когда можно ехать. */
const warmup = new WarmupTracker()
const warmupInfo = ref<WarmupInfo>(warmup.info())
warmup.onReady = (t) => {
  void notify('Двигатель прогрет — можно ехать', `Температура ОЖ ${Math.round(t)} °C. Трогайтесь без резких нагрузок, пока не дойдёт до рабочей.`)
}

let elm: ELMService | null = null
/** Сервис, который сейчас пытается подключиться (чтобы попытку можно было отменить). */
let connecting: ELMService | null = null
let connectToken = 0
let loopToken = 0
let manualStop = false
/** Текст в error — от цикла опроса (его снимаем сами, когда опрос снова пошёл). */
let pollError = false
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

const RECONNECT_MS = 6000
const MAX_ERRORS = 4
const EXTENDED_EVERY = 4

/* ---------- опрос ---------- */

async function pollLoop(token: number, service: ELMService): Promise<void> {
  let cycle = 0
  let errors = 0
  let ext: Partial<SensorSnapshot> = {}
  while (token === loopToken && service.connected) {
    try {
      if (pollMode.value === 'off') {
        await new Promise((r) => setTimeout(r, 100))
        continue
      }
      let snap: SensorSnapshot
      if (pollMode.value === 'fast') {
        // Замер разгона: скорость и обороты — каждый цикл, ДМРВ — раз в три (нужен, чтобы расход поездки не терялся).
        const rpm = await service.readRpm()
        const speedKmh = await service.readSpeed()
        const mafGs = cycle++ % 3 === 0 ? await service.readMaf() : snapshot.value?.mafGs ?? null
        snap = { ...(snapshot.value ?? { coolantTempC: null }), rpm, speedKmh, mafGs, timestamp: Date.now() }
      } else {
        const core = await service.readSnapshot(false)
        // Редкие PID читаем раз в несколько циклов, между ними показываем последние значения.
        if (cycle % EXTENDED_EVERY === 0) ext = await service.readExtended()
        if (cycle % STATUS_EVERY === 0) ecuStatus.value = await service.readStatus()
        cycle++
        snap = { ...core, ...ext }
      }
      if (token !== loopToken) return
      errors = 0
      if (pollError) { pollError = false; error.value = null }
      snapshot.value = snap
      if (pollMode.value === 'normal') await pollExtras(service)
      trackTrip(snap)
    } catch (e) {
      if (token !== loopToken) return
      pollError = true
      error.value = e instanceof Error ? e.message : String(e)
      if (++errors >= MAX_ERRORS && token === loopToken) {
        handleLost('Связь с адаптером потеряна')
        return
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}

/** Опрос PID-датчиков из каталога (встроенных и импортированных) по несколько штук за цикл. */
async function pollExtras(service: ELMService): Promise<void> {
  const defs = sensors.allDefs.value.filter((d) => d.pid && d.formula)
  if (!defs.length) return
  for (let k = 0; k < Math.min(EXTRA_PER_CYCLE, defs.length); k++) {
    const def = defs[extraCursor++ % defs.length]
    let f = formulas.get(def.id)
    if (!f || f.src !== def.formula) {
      let fn: Formula | null = null
      try { fn = compileFormula(def.formula!) } catch { /* битая формула — датчик молчит */ }
      f = { src: def.formula!, fn }
      formulas.set(def.id, f)
    }
    if (!f.fn) { extras[def.id] = null; continue }
    const bytes = await service.readPidBytes(def.pid!)
    const v = bytes && bytes.length ? f.fn(bytes) : NaN
    extras[def.id] = Number.isNaN(v) ? null : v
  }
}

function buildValues(s: SensorSnapshot, defs: SensorDef[]): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  for (const d of defs) {
    if (d.field) out[d.id] = (s[d.field] as number | null | undefined) ?? null
    else out[d.id] = extras[d.id] ?? null
  }
  return out
}

function refreshTripLive(): void {
  const t = session.trip
  tripActive.value = t != null
  tripLive.value = t
    ? { start: t.start, distanceKm: t.distanceKm, fuelL: t.fuelL, movingMs: t.movingMs, stoppedMs: t.stoppedMs, maxSpeedKmh: t.maxSpeedKmh }
    : { ...NO_TRIP }
  garage.saveActive(t, session.points)
}

/** Пробег идёт в счётчик машины (масло, одометр) — кроме демо: симулятор не должен «накручивать» реальную машину. */
function addDistance(km: number): void {
  if (!session.demo) garage.addDistance(km)
}

function trackTrip(s: SensorSnapshot): void {
  milOn.value = s.milOn === true
  warmupInfo.value = warmup.feed(s.timestamp, s.coolantTempC, s.rpm)
  const vals = buildValues(s, sensors.allDefs.value)
  values.value = vals
  const h = { ...history.value }
  for (const [id, v] of Object.entries(vals)) {
    if (v == null) continue
    const arr = (h[id] ?? []).concat(v)
    if (arr.length > HISTORY_LEN) arr.shift()
    h[id] = arr
  }
  history.value = h
  addDistance(session.feedObd(s.timestamp, s, vals))
  refreshTripLive()
  if (via.value === 'mock') mockGps(s)
}

/** Завершает поездку и сохраняет её (вместе с треком). */
/** Сбрасывает показания датчиков при отключении (поездка при этом не трогается). */
function clearReadings(): void {
  history.value = {}
  values.value = {}
  ecuStatus.value = null
  for (const k of Object.keys(extras)) delete extras[k]
  connectedAt.value = null
  void notifier.stop()
}

function endTrip(): void {
  garage.finishTrip(session.finish(Date.now()))
  refreshTripLive()
}

/** Раз в 30 с: дочитываем пропущенные точки GPS и проверяем — если все датчики молчат 30 минут, поездка сохраняется. */
async function idleCheck(): Promise<void> {
  // Сначала дочитываем точки, которые служба GPS записала, пока приложение спало, — иначе поездку закроет таймер простоя.
  await gps.syncLog()
  const done = session.tick(Date.now())
  if (done) {
    garage.finishTrip(done)
    refreshTripLive()
  }
}
let idleTimer: ReturnType<typeof setInterval> | null = null

session.onMil = (ev) => {
  // Лампа только что загорелась: читаем, какие коды её включили, и запоминаем рядом с точкой на карте.
  if (!elm?.connected) return
  elm.readDtcs().then((codes) => { ev.codes = codes; garage.saveActive(session.trip, session.points) }).catch(() => undefined)
}

gps.onFix = (fix) => {
  gpsFix.value = fix
  addDistance(session.feedGps(fix.t, fix))
  refreshTripLive()
}
gps.onState = (st, msg) => { gpsState.value = st; gpsError.value = msg ?? null }
/** Попросить права и включить фоновый GPS (кнопка на экране или после мастера). */
function openGpsSettings(): Promise<void> { return gps.openSettings() }

/** Демо: имитация GPS по скорости симулятора (круговой маршрут вокруг Москвы). */
const mock = { lat: 55.7539, lon: 37.6208, bearing: 40, at: 0 }
function mockGps(s: SensorSnapshot): void {
  const dt = mock.at ? Math.min(2, (s.timestamp - mock.at) / 1000) : 0
  mock.at = s.timestamp
  const speed = s.speedKmh ?? 0
  mock.bearing = (mock.bearing + (speed > 5 ? dt * 4 : 0)) % 360
  const next = destinationPoint(mock, mock.bearing, (speed / 3.6) * dt)
  mock.lat = next.lat
  mock.lon = next.lon
  gps.push(mock.lat, mock.lon, speed / 3.6, 5, mock.bearing)
}

const wantGps = (): boolean => prefs.backgroundTracking && prefs.mode !== 'mock' && prefs.onboarded

function startGps(): void {
  if (wantGps()) void gps.start()
}

// Настройки изменили (выключили фоновую запись, перешли в демо) — GPS должен остановиться, а не работать до перезапуска.
watch(wantGps, (want) => {
  if (want) void gps.start()
  else void gps.stop()
})

// Сменили активную машину: текущая поездка закрывается на прежней машине, новая начнётся уже на выбранной.
watch(() => garage.garage.activeCarId, (id) => {
  if (session.active) endTrip()
  session.setCar(id)
})

/* ---------- подключение ---------- */

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

async function tryKind(kind: ConnectionKind): Promise<ELMService> {
  const svc = createElmService({ kind, host: prefs.host.trim(), port: prefs.port, bleId: prefs.bleId, protocol: prefs.protocol, timeoutMs: prefs.timeoutMs, attempts: prefs.attempts })
  svc.onProgress = (m) => { note.value = m }
  connecting = svc
  try {
    await withTimeout(svc.connect(), 150000, kind === 'ble' ? 'Bluetooth: адаптер не отвечает' : 'Wi-Fi: адаптер не отвечает')
    return svc
  } catch (e) {
    await svc.disconnect().catch(() => undefined)
    throw e
  } finally {
    if (connecting === svc) connecting = null
  }
}

/** Порядок попыток по выбранному режиму. */
function plan(): ConnectionKind[] {
  switch (prefs.mode) {
    case 'mock': return ['mock']
    case 'ble': return ['ble']
    case 'wifi': return ['wifi']
    default: return [...(prefs.bleId ? (['ble'] as const) : []), 'wifi']
  }
}

function clearReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
}

function scheduleReconnect(): void {
  clearReconnect()
  if (manualStop || !prefs.autoConnect || prefs.mode === 'mock' || !prefs.onboarded) return
  reconnectTimer = setTimeout(() => { void connect(true) }, RECONNECT_MS)
}

function handleLost(msg: string): void {
  if (status.value === 'disconnected') return
  loopToken++
  const old = elm
  elm = null
  void old?.disconnect().catch(() => undefined)
  // Поездка не обрывается: GPS продолжает запись, а если и он молчит — её закроет 30-минутный таймер.
  status.value = 'disconnected'
  via.value = null
  snapshot.value = null
  milOn.value = false
  warmup.reset()
  warmupInfo.value = warmup.info()
  clearReadings()
  pollError = false
  error.value = msg
  scheduleReconnect()
}

async function connect(auto = false): Promise<void> {
  if (status.value !== 'disconnected') return
  if (!auto) manualStop = false
  clearReconnect()
  const token = ++connectToken
  status.value = 'connecting'
  error.value = null
  pollError = false
  const errors: string[] = []
  for (const kind of plan()) {
    try {
      const svc = await tryKind(kind)
      if (token !== connectToken) {
        // Пока подключались, пользователь нажал «Отмена».
        await svc.disconnect().catch(() => undefined)
        return
      }
      elm = svc
      if (svc.protocol && kind !== 'mock') prefs.protocol = svc.protocol
      protocolName.value = kind === 'mock' ? 'демо' : svc.protocolName
      note.value = null
      via.value = kind
      status.value = 'connected'
      // Реальная поездка (по GPS) не должна продолжиться как демо и наоборот.
      if (session.active && session.demo !== (kind === 'mock')) endTrip()
      session.demo = kind === 'mock'
      session.setCar(garage.car().id)
      warmup.reset()
      warmupInfo.value = warmup.info()
      void ensureNotifyPermission()
      connectedAt.value = Date.now()
      void notifier.start(() => ({ since: connectedAt.value ?? Date.now(), values: values.value, via: kind }))
      svc.onLost = () => handleLost('Адаптер отключился')
      void pollLoop(++loopToken, svc)
      return
    } catch (e) {
      if (token !== connectToken) return
      errors.push(`${kind === 'ble' ? 'Bluetooth' : kind === 'wifi' ? 'Wi-Fi' : 'Демо'}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  error.value = errors.join(' · ')
  note.value = null
  status.value = 'disconnected'
  scheduleReconnect()
}

/** Отключиться или отменить идущую попытку подключения. */
async function disconnect(): Promise<void> {
  manualStop = true
  clearReconnect()
  loopToken++
  connectToken++
  const old = elm
  const pending = connecting
  elm = null
  connecting = null
  const wasMock = via.value === 'mock'
  status.value = 'disconnected'
  via.value = null
  note.value = null
  snapshot.value = null
  milOn.value = false
  warmup.reset()
  warmupInfo.value = warmup.info()
  clearReadings()
  if (pollError) { pollError = false; error.value = null }
  if (wasMock) {
    endTrip() // демо-поездка заканчивается вместе с демо-подключением
    session.demo = false
  }
  await Promise.all([old?.disconnect().catch(() => undefined), pending?.disconnect().catch(() => undefined)])
}

/** Вызывать один раз при старте приложения. */
function autoStart(): void {
  if (!idleTimer) idleTimer = setInterval(() => { void idleCheck() }, IDLE_CHECK_MS)
  startGps()
  if (prefs.onboarded && prefs.autoConnect && prefs.mode !== 'mock') void connect(true)
  if (typeof document !== 'undefined') {
    // Вернулись в приложение — пробуем сразу, не ждём таймер.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void idleCheck()
      if (!document.hidden && status.value === 'disconnected' && !manualStop && prefs.autoConnect && prefs.onboarded && prefs.mode !== 'mock') {
        void connect(true)
      }
    })
  }
}

const ecuSilent = computed(() => {
  const s = snapshot.value
  return status.value === 'connected' && s != null && s.rpm == null && s.speedKmh == null && s.coolantTempC == null
})

export function useVehicle() {
  return {
    prefs, settings, status, via, error, note, snapshot, pollMode, tripLive, gpsState, gpsFix, gpsError, milOn, tripActive, protocolName, warmupInfo,
    values, history, connectedAt, ecuStatus,
    liveTrip: () => session.snapshot(),
    session,
    isConnected: computed(() => status.value === 'connected'),
    /** Адаптер на связи, но ЭБУ не отдаёт ни один основной параметр (обычно выключено зажигание). */
    ecuSilent,
    clearError: () => { error.value = null; pollError = false },
    connect: () => connect(false),
    disconnect, autoStart, startGps, endTrip,
    stopGps: () => gps.stop(),
    openGpsSettings,
    getElm: (): ELMService => {
      if (!elm) throw new Error('Нет подключения к адаптеру')
      return elm
    },
  }
}
