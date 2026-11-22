/** Разбор статуса ЭБУ: PID 01 01 (лампа, коды, тесты готовности) и PID 01 03 (режим топливоподачи). */

export interface Monitor {
  name: string
  supported: boolean
  /** Тест завершён с момента сброса. */
  complete: boolean
}

export interface EcuStatus {
  mil: boolean
  dtcCount: number
  monitors: Monitor[]
  /** Код режима топливоподачи (бит-маска PID 03) или null. */
  fuelSystem: number | null
}

const CONTINUOUS = ['Пропуски зажигания', 'Топливная система', 'Компоненты']
const NONCONT = ['Катализатор', 'Обогреваемый катализатор', 'Испарительная система', 'Вторичная подача воздуха', 'Хладагент кондиционера', 'Датчик кислорода', 'Нагреватель датчика кислорода', 'Система EGR']

/** bytes = A B C D из ответа «41 01 …» (бензиновый ЭБУ). */
export function parseStatus(bytes: number[] | null, fuel: number[] | null): EcuStatus | null {
  if (!bytes || bytes.length < 4) return null
  const [a, b, c, d] = bytes
  const monitors: Monitor[] = [
    ...CONTINUOUS.map((name, i) => ({ name, supported: !!(b & (1 << i)), complete: !(b & (1 << (4 + i))) })),
    // C — какие тесты поддерживаются, D — какие ещё НЕ завершены.
    ...NONCONT.map((name, i) => ({ name, supported: !!(c & (1 << i)), complete: !(d & (1 << i)) })),
  ]
  return { mil: !!(a & 0x80), dtcCount: a & 0x7f, monitors, fuelSystem: fuel && fuel.length ? fuel[0] : null }
}

export type StatusLevel = 'ok' | 'warn' | 'bad'

/** Человекочитаемый режим топливоподачи + цвет. */
export function fuelSystemText(code: number | null): { text: string; level: StatusLevel } | null {
  switch (code) {
    case null: return null
    case 0: return { text: 'Нет данных', level: 'ok' }
    case 1: return { text: 'Разомкнутый контур: прогрев (низкая температура)', level: 'warn' }
    case 2: return { text: 'Замкнутый контур: коррекция по датчику кислорода', level: 'ok' }
    case 4: return { text: 'Разомкнутый контур: нагрузка / торможение двигателем', level: 'ok' }
    case 8: return { text: 'Разомкнутый контур: неисправность системы', level: 'bad' }
    case 16: return { text: 'Замкнутый контур: неисправность датчика кислорода', level: 'bad' }
    default: return { text: `Код режима ${code}`, level: 'warn' }
  }
}

/**
 * Готовность мониторов, как её проверяют при OBD-инспекции: лампа не горит и не завершено
 * не больше 1 теста (для машин 2001 года и новее) или 2 тестов (1996–2000).
 * Много незавершённых тестов — признак того, что недавно стирали ошибки или отключали аккумулятор.
 */
export interface Readiness {
  supported: number
  incomplete: string[]
  ready: boolean
  allowed: number
  text: string
  level: StatusLevel
}

export function readiness(st: EcuStatus | null, modelYear?: number | null): Readiness | null {
  if (!st) return null
  const sup = st.monitors.filter((m) => m.supported)
  if (!sup.length) return null
  const incomplete = sup.filter((m) => !m.complete).map((m) => m.name)
  const allowed = modelYear && modelYear <= 2000 ? 2 : 1
  const ready = !st.mil && incomplete.length <= allowed
  let text: string
  let level: StatusLevel
  if (st.mil) { text = 'Не готов: горит Check Engine'; level = 'bad' }
  else if (!incomplete.length) { text = 'Все тесты завершены'; level = 'ok' }
  else if (ready) { text = `Готов: не завершено тестов — ${incomplete.length} (допускается ${allowed})`; level = 'ok' }
  else { text = `Не готов: не завершено тестов — ${incomplete.length}. Проездите 2–3 дня в разных режимах`; level = 'warn' }
  return { supported: sup.length, incomplete, ready, allowed, text, level }
}

/** Сведения «с момента сброса ошибок» (PID 01 30, 31, 4E). */
export interface SinceClear {
  warmups: number | null
  km: number | null
  minutes: number | null
}

export function parseSinceClear(warm: number[] | null, dist: number[] | null, time: number[] | null): SinceClear | null {
  const s: SinceClear = {
    warmups: warm && warm.length >= 1 ? warm[0] : null,
    km: dist && dist.length >= 2 ? dist[0] * 256 + dist[1] : null,
    minutes: time && time.length >= 2 ? time[0] * 256 + time[1] : null,
  }
  return s.warmups == null && s.km == null && s.minutes == null ? null : s
}

/**
 * Проверка при покупке: стирали ли ошибки незадолго до осмотра.
 * Признаки: мало прогревов/километров с момента сброса и незавершённые тесты.
 */
export function recentlyCleared(sc: SinceClear | null, rd: Readiness | null): { suspicious: boolean; text: string } | null {
  if (!sc && !rd) return null
  const fewKm = sc?.km != null && sc.km < 200
  const fewWarm = sc?.warmups != null && sc.warmups < 10
  const manyIncomplete = !!rd && rd.incomplete.length >= 2
  const suspicious = (fewKm || fewWarm) && (manyIncomplete || fewKm)
  const parts: string[] = []
  if (sc?.km != null) parts.push(`${sc.km} км`)
  if (sc?.warmups != null) parts.push(`${sc.warmups} прогревов`)
  if (sc?.minutes != null) parts.push(`${Math.floor(sc.minutes / 60)} ч ${sc.minutes % 60} мин работы двигателя`)
  const since = parts.length ? `С момента сброса ошибок: ${parts.join(', ')}.` : ''
  return {
    suspicious,
    text: suspicious
      ? `${since} Похоже, ошибки стирали недавно — при покупке это повод насторожиться и прочитать их ещё раз через несколько дней.`
      : since || 'Признаков недавнего сброса ошибок нет.',
  }
}
