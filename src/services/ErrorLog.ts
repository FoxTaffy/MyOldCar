import { ref } from 'vue'

/**
 * Журнал ошибок приложения: падения интерфейса, необработанные исключения и отказы промисов.
 * Хранится на телефоне (последние 50), смотрится и копируется в «Настройки → Журнал ошибок».
 * Ничего никуда не отправляется само — пользователь решает, кому переслать текст.
 */
export interface ErrorEntry {
  at: number
  /** Откуда: vue, window, promise, manual. */
  source: string
  message: string
  stack?: string
  /** Экран (маршрут), на котором случилась ошибка. */
  route?: string
  count: number
}

const KEY = 'myoldcar.errors.v1'
export const MAX_ERRORS = 50

function load(): ErrorEntry[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

export const errorLog = ref<ErrorEntry[]>(load())

function persist(): void {
  try { localStorage.setItem(KEY, JSON.stringify(errorLog.value)) } catch { /* ignore */ }
}

/** Повторяющаяся подряд ошибка не плодит записи, а увеличивает счётчик. */
export function pushError(list: ErrorEntry[], e: Omit<ErrorEntry, 'count'>, max = MAX_ERRORS): ErrorEntry[] {
  const last = list[list.length - 1]
  if (last && last.message === e.message && last.source === e.source) {
    return [...list.slice(0, -1), { ...last, at: e.at, count: last.count + 1 }]
  }
  return [...list, { ...e, count: 1 }].slice(-max)
}

export function describe(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message || err.name, stack: err.stack?.split('\n').slice(0, 8).join('\n') }
  if (typeof err === 'string') return { message: err }
  try { return { message: JSON.stringify(err) } } catch { return { message: String(err) } }
}

let routeOf: () => string | undefined = () => undefined

export function logError(source: string, err: unknown): void {
  const d = describe(err)
  // Отмена пользователем и обрывы сети — не ошибки приложения.
  if (/AbortError|canceled|cancelled/i.test(d.message)) return
  errorLog.value = pushError(errorLog.value, { at: Date.now(), source, route: routeOf(), ...d })
  persist()
  console.error(`[${source}]`, err)
}

export function clearErrors(): void {
  errorLog.value = []
  persist()
}

/** Текст для пересылки разработчику. */
export function errorReport(list: ErrorEntry[], version: string, ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''): string {
  const head = `MyOldCar ${version}\n${ua}\nОшибок: ${list.length}`
  const body = list
    .slice()
    .reverse()
    .map((e) => `${new Date(e.at).toISOString()} [${e.source}${e.route ? ' ' + e.route : ''}]${e.count > 1 ? ` ×${e.count}` : ''}\n${e.message}${e.stack ? '\n' + e.stack : ''}`)
    .join('\n\n')
  return `${head}\n\n${body}`
}

/** Подключить перехват: Vue, window.onerror, необработанные промисы. */
export function installErrorLog(app: { config: { errorHandler?: unknown } }, getRoute: () => string | undefined): void {
  routeOf = getRoute
  app.config.errorHandler = (err: unknown) => logError('vue', err)
  window.addEventListener('error', (ev) => logError('window', ev.error ?? ev.message))
  window.addEventListener('unhandledrejection', (ev) => logError('promise', ev.reason))
}
