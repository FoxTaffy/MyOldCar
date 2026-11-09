import { computed, reactive, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { createElmService, type ELMService } from '@/services/ELMService'
import { TripRecorder } from '@/services/TripRecorder'
import { useGarage } from '@/composables/useGarage'
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
  /** Подключаться при запуске и переподключаться при потере связи. */
  autoConnect: true,
  /** Пройден ли мастер первого запуска. */
  onboarded: false,
}))
watch(prefs, (v) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

const settings = reactive<AppSettings>(load(LS_KEY, { ...DEFAULT_SETTINGS }))
watch(settings, (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

const status = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
const via = ref<ConnectionKind | null>(null)
const error = ref<string | null>(null)
const snapshot = ref<SensorSnapshot | null>(null)
/** normal — полный цикл PID; fast — только скорость+обороты; off — опрос на паузе. */
const pollMode = ref<'normal' | 'fast' | 'off'>('normal')
/** Данные текущей поездки (для реактивного показа). */
const tripLive = ref({ distanceKm: 0, fuelL: 0, movingMs: 0, stoppedMs: 0, maxSpeedKmh: 0 })

const garage = useGarage()
const recorder = new TripRecorder()

let elm: ELMService | null = null
let loopToken = 0
let manualStop = false
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
        const rpm = await service.readRpm()
        const speedKmh = await service.readSpeed()
        snap = { ...(snapshot.value ?? { coolantTempC: null, mafGs: null }), rpm, speedKmh, timestamp: Date.now() }
      } else {
        const core = await service.readSnapshot(false)
        // Редкие PID читаем раз в несколько циклов, между ними показываем последние значения.
        if (cycle++ % EXTENDED_EVERY === 0) ext = await service.readExtended()
        snap = { ...core, ...ext }
      }
      if (token !== loopToken) return
      errors = 0
      snapshot.value = snap
      trackTrip(snap)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      if (++errors >= MAX_ERRORS && token === loopToken) {
        handleLost('Связь с адаптером потеряна')
        return
      }
      await new Promise((r) => setTimeout(r, 400))
    }
  }
}

function trackTrip(s: SensorSnapshot): void {
  const km = recorder.feed(s.timestamp, s.speedKmh, s.mafGs)
  const t = recorder.current
  if (!t) return
  tripLive.value = { distanceKm: t.distanceKm, fuelL: t.fuelL, movingMs: t.movingMs, stoppedMs: t.stoppedMs, maxSpeedKmh: t.maxSpeedKmh }
  garage.addDistance(km, t)
}

function endTrip(): void {
  garage.finishTrip(recorder.end(Date.now()))
  tripLive.value = { distanceKm: 0, fuelL: 0, movingMs: 0, stoppedMs: 0, maxSpeedKmh: 0 }
}

/* ---------- подключение ---------- */

function withTimeout<T>(p: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

async function tryKind(kind: ConnectionKind): Promise<ELMService> {
  const svc = createElmService({ kind, host: prefs.host, port: prefs.port, bleId: prefs.bleId })
  try {
    await withTimeout(svc.connect(), kind === 'ble' ? 60000 : 25000, kind === 'ble' ? 'Bluetooth: адаптер не отвечает' : 'Wi-Fi: адаптер не отвечает')
    return svc
  } catch (e) {
    await svc.disconnect().catch(() => undefined)
    throw e
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
  endTrip()
  status.value = 'disconnected'
  via.value = null
  snapshot.value = null
  error.value = msg
  scheduleReconnect()
}

async function connect(auto = false): Promise<void> {
  if (status.value !== 'disconnected') return
  if (!auto) manualStop = false
  clearReconnect()
  status.value = 'connecting'
  error.value = null
  const errors: string[] = []
  for (const kind of plan()) {
    try {
      const svc = await tryKind(kind)
      elm = svc
      via.value = kind
      status.value = 'connected'
      recorder.begin(Date.now())
      svc.onLost = () => handleLost('Адаптер отключился')
      void pollLoop(++loopToken, svc)
      return
    } catch (e) {
      errors.push(`${kind === 'ble' ? 'Bluetooth' : kind === 'wifi' ? 'Wi-Fi' : 'Демо'}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  error.value = errors.join(' · ')
  status.value = 'disconnected'
  scheduleReconnect()
}

async function disconnect(): Promise<void> {
  manualStop = true
  clearReconnect()
  loopToken++
  const old = elm
  elm = null
  await old?.disconnect().catch(() => undefined)
  endTrip()
  status.value = 'disconnected'
  via.value = null
  snapshot.value = null
}

/** Вызывать один раз при старте приложения. */
function autoStart(): void {
  if (prefs.onboarded && prefs.autoConnect && prefs.mode !== 'mock') void connect(true)
  if (typeof document !== 'undefined') {
    // Вернулись в приложение — пробуем сразу, не ждём таймер.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && status.value === 'disconnected' && !manualStop && prefs.autoConnect && prefs.onboarded && prefs.mode !== 'mock') {
        void connect(true)
      }
    })
  }
}

export function useVehicle() {
  return {
    prefs, settings, status, via, error, snapshot, pollMode, tripLive,
    isConnected: computed(() => status.value === 'connected'),
    connect: () => connect(false),
    disconnect, autoStart,
    getElm: (): ELMService => {
      if (!elm) throw new Error('Нет подключения к адаптеру')
      return elm
    },
  }
}
