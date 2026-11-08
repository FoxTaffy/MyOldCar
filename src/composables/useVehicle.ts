import { computed, reactive, ref, watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { createElmService, type ELMService } from '@/services/ELMService'
import { DEFAULT_SETTINGS, type AppSettings, type SensorSnapshot } from '@/types'

/* Модульный синглтон: одно соединение с адаптером на всё приложение. */

const LS_KEY = 'myoldcar.settings.v1'

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

const PREFS_KEY = 'myoldcar.prefs.v1'
const prefs = reactive(load(PREFS_KEY, {
  // Вне телефона (браузер) по умолчанию работаем на заглушке.
  mock: !Capacitor.isNativePlatform(),
  host: '192.168.0.10',
  port: 35000,
  /** Пройден ли мастер первого запуска. */
  onboarded: false,
}))
watch(prefs, (v) => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })
const settings = reactive<AppSettings>(load(LS_KEY, { ...DEFAULT_SETTINGS }))
watch(settings, (v) => { try { localStorage.setItem(LS_KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

const status = ref<'disconnected' | 'connecting' | 'connected'>('disconnected')
const error = ref<string | null>(null)
const snapshot = ref<SensorSnapshot | null>(null)
/** normal — полный цикл PID; fast — только скорость+обороты (замер разгона). */
const pollMode = ref<'normal' | 'fast' | 'off'>('normal')

let elm: ELMService | null = null
let loopToken = 0

async function pollLoop(token: number): Promise<void> {
  while (token === loopToken && elm?.connected) {
    try {
      if (pollMode.value === 'off') {
        await new Promise((r) => setTimeout(r, 100))
      } else if (pollMode.value === 'fast') {
        const rpm = await elm.readRpm()
        const speedKmh = await elm.readSpeed()
        snapshot.value = { ...(snapshot.value ?? { coolantTempC: null, mafGs: null }), rpm, speedKmh, timestamp: Date.now() }
      } else {
        snapshot.value = await elm.readSnapshot()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

async function connect(): Promise<void> {
  if (status.value !== 'disconnected') return
  status.value = 'connecting'
  error.value = null
  try {
    elm = createElmService({ mock: prefs.mock, cfg: { host: prefs.host, port: prefs.port } })
    await elm.connect()
    status.value = 'connected'
    void pollLoop(++loopToken)
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    status.value = 'disconnected'
    elm = null
  }
}

async function disconnect(): Promise<void> {
  loopToken++
  await elm?.disconnect().catch(() => undefined)
  elm = null
  status.value = 'disconnected'
  snapshot.value = null
}

export function useVehicle() {
  return {
    prefs, settings, status, error, snapshot, pollMode,
    isConnected: computed(() => status.value === 'connected'),
    connect, disconnect,
    getElm: (): ELMService => {
      if (!elm) throw new Error('Нет подключения к адаптеру')
      return elm
    },
  }
}
