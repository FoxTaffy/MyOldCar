/** Снимок показаний датчиков (стоп-кадр / текущие значения). */
export interface SensorSnapshot {
  rpm: number | null
  speedKmh: number | null
  coolantTempC: number | null
  /** Массовый расход воздуха, г/с (PID 01 10). */
  mafGs: number | null
  /** Напряжение бортсети, В (PID 01 42), если доступно. */
  voltage?: number | null
  timestamp: number
}

export type Level = 'ok' | 'warn' | 'bad'

export interface AppSettings {
  /** Недавно обслуживались топливные магистрали / бак. */
  recentFuelServicing: boolean
  /** Недавно меняли свечи / провода / модуль зажигания. */
  recentIgnitionServicing: boolean
  /** Недавно снимали/меняли ДМРВ или воздушный фильтр/гофру. */
  recentAirIntakeServicing: boolean
  /** Двигатель холодный в момент ошибки. */
  coldStartOnly: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  recentFuelServicing: false,
  recentIgnitionServicing: false,
  recentAirIntakeServicing: false,
  coldStartOnly: false,
}

export interface CauseResult {
  id: string
  title: string
  /** Итоговая вероятность, % (сумма по всем причинам = 100). */
  probability: number
  recommendation: string
}

export interface DiagnosisResult {
  code: string
  title: string
  causes: CauseResult[]
  /** Какие правила сработали — для прозрачности «ИИ». */
  notes: string[]
}
