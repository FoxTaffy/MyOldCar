/** Снимок показаний датчиков (стоп-кадр / текущие значения). */
export interface SensorSnapshot {
  rpm: number | null
  speedKmh: number | null
  coolantTempC: number | null
  /** Массовый расход воздуха, г/с (PID 01 10). */
  mafGs: number | null
  /** Напряжение бортсети, В (PID 01 42), если доступно. */
  voltage?: number | null
  /** Расчётная нагрузка двигателя, % (PID 01 04). */
  loadPct?: number | null
  /** Положение дросселя, % (PID 01 11). */
  throttlePct?: number | null
  /** Температура воздуха на впуске, °C (PID 01 0F). */
  intakeTempC?: number | null
  /** Кратковременная / долговременная коррекция топливоподачи, % (PID 01 06 / 07). */
  stft?: number | null
  ltft?: number | null
  /** Лампа Check Engine горит (PID 01 01, бит 7). */
  milOn?: boolean | null
  /** Число сохранённых ошибок по данным ЭБУ (PID 01 01). */
  dtcCount?: number | null
  timestamp: number
}

export type ConnectionMode = 'auto' | 'ble' | 'wifi' | 'mock'
export type ConnectionKind = 'ble' | 'wifi' | 'mock'

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
  /** confirmed — сохранённая (режим 03), pending — временная (режим 07). */
  status?: 'confirmed' | 'pending'
  title: string
  causes: CauseResult[]
  /** Какие правила сработали — для прозрачности «ИИ». */
  notes: string[]
}
