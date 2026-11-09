import type { Level } from '@/types'

/** Диапазон [от, до]; null — без ограничения с этой стороны. */
export type Range = [number | null, number | null]

export interface SensorDef {
  id: string
  name: string
  unit: string
  digits: number
  /** Откуда берётся значение: поле снимка (ядро) или произвольный PID режима 01. */
  field?: 'rpm' | 'speedKmh' | 'coolantTempC' | 'mafGs' | 'loadPct' | 'throttlePct' | 'intakeTempC' | 'stft' | 'ltft' | 'voltage'
  /** Для PID-датчиков: 2 hex-символа PID режима 01 и формула по байтам A–D. */
  pid?: string
  formula?: string
  /** Зелёная зона. Вне её, но внутри warn — оранжевая; дальше — красная. Без зон датчик всегда нейтрально-зелёный. */
  ok?: Range
  warn?: Range
  /** Шкала для полоски/спарклайна. */
  scale: [number, number]
  hint?: string
  custom?: boolean
  /** Показывать на вкладке «Датчики». */
  enabled?: boolean
}

const R = (a: number | null, b: number | null): Range => [a, b]

/** Встроенный каталог. Если ЭБУ не отвечает на PID, датчик просто показывает «—». */
export const BUILTIN_SENSORS: SensorDef[] = [
  { id: 'speed', name: 'Скорость', unit: 'км/ч', digits: 0, field: 'speedKmh', ok: R(0, 90), warn: R(0, 110), scale: [0, 160] },
  { id: 'rpm', name: 'Обороты', unit: 'об/мин', digits: 0, field: 'rpm', ok: R(0, 4000), warn: R(0, 5500), scale: [0, 6500], hint: 'Красная зона М73 — выше 5500' },
  { id: 'coolant', name: 'Темп. ОЖ', unit: '°C', digits: 0, field: 'coolantTempC', ok: R(70, 100), warn: R(-50, 108), scale: [-20, 130], hint: 'Холодный — оранжевый, перегрев > 108 — красный' },
  { id: 'maf', name: 'ДМРВ', unit: 'г/с', digits: 2, field: 'mafGs', scale: [0, 40], hint: 'Холостой ≈ 2–3 г/с' },
  { id: 'load', name: 'Нагрузка', unit: '%', digits: 0, field: 'loadPct', ok: R(0, 85), warn: R(0, 95), scale: [0, 100] },
  { id: 'throttle', name: 'Дроссель', unit: '%', digits: 0, field: 'throttlePct', scale: [0, 100] },
  { id: 'voltage', name: 'Напряжение', unit: 'В', digits: 1, field: 'voltage', ok: R(13.2, 14.8), warn: R(12.4, 15.2), scale: [10, 16], hint: 'Ниже 12,4 В при работе — генератор/АКБ' },
  { id: 'intake', name: 'Темп. впуска', unit: '°C', digits: 0, field: 'intakeTempC', ok: R(-30, 55), warn: R(-40, 70), scale: [-30, 90] },
  { id: 'stft', name: 'Коррекция STFT', unit: '%', digits: 1, field: 'stft', ok: R(-10, 10), warn: R(-20, 20), scale: [-30, 30], hint: '± 10 % — норма' },
  { id: 'ltft', name: 'Коррекция LTFT', unit: '%', digits: 1, field: 'ltft', ok: R(-10, 10), warn: R(-20, 20), scale: [-30, 30], hint: 'Стабильный «+» — подсос воздуха/бедная смесь' },
  { id: 'map', name: 'Давление впуска', unit: 'кПа', digits: 0, pid: '0B', formula: 'A', ok: R(15, 110), warn: R(10, 130), scale: [0, 110] },
  { id: 'timing', name: 'Угол опережения', unit: '°', digits: 1, pid: '0E', formula: 'A/2-64', ok: R(-5, 45), warn: R(-15, 55), scale: [-20, 60] },
  { id: 'o2b1s1', name: 'Лямбда до катал.', unit: 'В', digits: 2, pid: '14', formula: 'A/200', ok: R(0.05, 0.95), warn: R(0, 1.1), scale: [0, 1] },
  { id: 'o2b1s2', name: 'Лямбда после катал.', unit: 'В', digits: 2, pid: '15', formula: 'A/200', ok: R(0.05, 0.95), warn: R(0, 1.1), scale: [0, 1] },
  { id: 'runtime', name: 'Время работы ДВС', unit: 'с', digits: 0, pid: '1F', formula: 'A*256+B', scale: [0, 3600] },
  { id: 'baro', name: 'Барометр', unit: 'кПа', digits: 0, pid: '33', formula: 'A', ok: R(85, 108), warn: R(70, 110), scale: [60, 110] },
  { id: 'ambient', name: 'Темп. снаружи', unit: '°C', digits: 0, pid: '46', formula: 'A-40', ok: R(-30, 40), warn: R(-40, 50), scale: [-40, 50] },
  { id: 'fuellvl', name: 'Уровень топлива', unit: '%', digits: 0, pid: '2F', formula: 'A*100/255', ok: R(15, 100), warn: R(8, 100), scale: [0, 100], hint: 'Ниже 15 % — оранжевый, ниже 8 % — красный' },
  { id: 'oiltemp', name: 'Темп. масла', unit: '°C', digits: 0, pid: '5C', formula: 'A-40', ok: R(70, 110), warn: R(-50, 125), scale: [-20, 140] },
]

const within = (v: number, [lo, hi]: Range): boolean => (lo == null || v >= lo) && (hi == null || v <= hi)

/** Цвет значения: green (ok) / orange (warn) / red (bad). Без зон или без значения — ok. */
export function levelOf(def: Pick<SensorDef, 'ok' | 'warn'>, v: number | null | undefined): Level {
  if (v == null || Number.isNaN(v) || !def.ok) return 'ok'
  if (within(v, def.ok)) return 'ok'
  if (def.warn && within(v, def.warn)) return 'warn'
  return 'bad'
}

/* ---------- импорт / экспорт ---------- */

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : x == null || x === '' ? null : Number.isFinite(Number(x)) ? Number(x) : null)
const range = (x: unknown): Range | undefined => (Array.isArray(x) && x.length === 2 ? [num(x[0]), num(x[1])] : undefined)

/**
 * Проверяет и нормализует импортируемые датчики (массив или {sensors:[...]}).
 * Допускаются только PID режима 01 (чтение) — запись и сервисные режимы отклоняются.
 */
export function parseSensorImport(text: string, compile: (f: string) => unknown): { sensors: SensorDef[]; errors: string[] } {
  const errors: string[] = []
  let data: unknown
  try { data = JSON.parse(text) } catch { return { sensors: [], errors: ['Файл — не корректный JSON'] } }
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray((data as { sensors?: unknown })?.sensors) ? (data as { sensors: unknown[] }).sensors : []
  if (!list.length) return { sensors: [], errors: ['В файле нет датчиков (ожидается массив или {"sensors":[…]})'] }
  const sensors: SensorDef[] = []
  list.forEach((raw, i) => {
    const o = (raw ?? {}) as Record<string, unknown>
    const label = `Датчик №${i + 1}${typeof o.name === 'string' ? ` «${o.name}»` : ''}`
    const name = typeof o.name === 'string' ? o.name.trim() : ''
    const pidHex = typeof o.pid === 'string' ? (o.pid.length === 4 && /^01/i.test(o.pid) ? o.pid.slice(2) : o.pid).toUpperCase() : ''
    if (!name) return void errors.push(`${label}: нет name`)
    if (!/^[0-9A-F]{2}$/.test(pidHex)) return void errors.push(`${label}: pid должен быть 2 hex-символа (PID режима 01, например "0B")`)
    if (typeof o.formula !== 'string') return void errors.push(`${label}: нет formula (например "A*100/255")`)
    try { compile(o.formula) } catch (e) { return void errors.push(`${label}: ${e instanceof Error ? e.message : 'ошибка формулы'}`) }
    const scale = range(o.scale)
    const ok = range(o.ok)
    const warn = range(o.warn)
    const id = 'c_' + (typeof o.id === 'string' && o.id ? o.id : pidHex + '_' + name).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '_').slice(0, 40)
    sensors.push({
      id, name, unit: typeof o.unit === 'string' ? o.unit : '', digits: Math.min(4, Math.max(0, num(o.digits) ?? 1)),
      pid: pidHex, formula: o.formula, ok, warn,
      scale: scale && scale[0] != null && scale[1] != null && scale[1] > scale[0] ? [scale[0], scale[1]] : ok && ok[0] != null && ok[1] != null ? [ok[0] - (ok[1] - ok[0]), ok[1] + (ok[1] - ok[0])] : [0, 100],
      hint: typeof o.hint === 'string' ? o.hint : undefined, custom: true, enabled: true,
    })
  })
  return { sensors, errors }
}

export function exportSensors(defs: SensorDef[]): string {
  const strip = ({ field: _f, custom: _c, enabled: _e, ...rest }: SensorDef) => rest
  return JSON.stringify({ sensors: defs.filter((d) => d.pid && d.formula).map(strip) }, null, 2)
}

/** Пример файла для импорта (показывается в интерфейсе). */
export const IMPORT_EXAMPLE = `{
  "sensors": [
    {
      "name": "Нагрузка (абс.)", "pid": "43", "unit": "%", "digits": 0,
      "formula": "(A*256+B)*100/255",
      "ok": [0, 90], "warn": [0, 110], "scale": [0, 120]
    }
  ]
}`
