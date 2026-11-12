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
