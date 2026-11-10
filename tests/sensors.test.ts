import { describe, expect, it } from 'vitest'
import { BUILTIN_SENSORS, levelOf, parseSensorImport, exportSensors } from '@/data/sensors'
import { compileFormula } from '@/services/Formula'
import { SensorStatsRecorder } from '@/services/SensorStats'
import { TripRecorder } from '@/services/TripRecorder'
import { sensorLines, tripReport, tripSummaryText } from '@/services/TripSummary'
import { elapsedText, notificationBody } from '@/services/Notifier'

const def = (id: string) => BUILTIN_SENSORS.find((d) => d.id === id)!

describe('Formula', () => {
  it('считает типовые формулы OBD', () => {
    expect(compileFormula('A-40')([90])).toBe(50)
    expect(compileFormula('(A*256+B)/4')([0x1a, 0xf8])).toBe(1726)
    expect(compileFormula('A*100/255')([255])).toBe(100)
    expect(compileFormula('-(A+B)*2')([1, 2])).toBe(-6)
  })
  it('отклоняет небезопасные и битые формулы', () => {
    for (const bad of ['', 'alert(1)', 'A+', '(A', 'A B', 'process', 'A**2']) expect(() => compileFormula(bad)).toThrow()
  })
  it('нет нужного байта или деление на 0 → NaN', () => {
    expect(compileFormula('A+B')([1])).toBeNaN()
    expect(compileFormula('A/0')([1])).toBeNaN()
  })
})

describe('Зоны датчиков', () => {
  it('температура ОЖ: холодный — оранжевый, норма — зелёный, перегрев — красный', () => {
    expect(levelOf(def('coolant'), 40)).toBe('warn')
    expect(levelOf(def('coolant'), 90)).toBe('ok')
    expect(levelOf(def('coolant'), 105)).toBe('warn')
    expect(levelOf(def('coolant'), 112)).toBe('bad')
  })
  it('напряжение и коррекции', () => {
    expect(levelOf(def('voltage'), 14.1)).toBe('ok')
    expect(levelOf(def('voltage'), 12.8)).toBe('warn')
    expect(levelOf(def('voltage'), 11.9)).toBe('bad')
    expect(levelOf(def('ltft'), 12)).toBe('warn')
    expect(levelOf(def('ltft'), -25)).toBe('bad')
  })
  it('топливо: ниже порога хуже; без зон / без значения — норма', () => {
    expect(levelOf(def('fuellvl'), 50)).toBe('ok')
    expect(levelOf(def('fuellvl'), 12)).toBe('warn')
    expect(levelOf(def('fuellvl'), 5)).toBe('bad')
    expect(levelOf(def('maf'), 99)).toBe('ok')
    expect(levelOf(def('rpm'), null)).toBe('ok')
  })
})

describe('Импорт датчиков', () => {
  const compile = (f: string) => compileFormula(f)
  it('принимает корректный JSON, нормализует PID', () => {
    const r = parseSensorImport('{"sensors":[{"name":"Тест","pid":"0143","unit":"%","formula":"(A*256+B)*100/255","ok":[0,90],"warn":[0,110],"scale":[0,120]}]}', compile)
    expect(r.errors).toEqual([])
    expect(r.sensors).toHaveLength(1)
    expect(r.sensors[0]).toMatchObject({ pid: '43', custom: true, ok: [0, 90], scale: [0, 120] })
    expect(levelOf(r.sensors[0], 100)).toBe('warn')
  })
  it('отклоняет не-PID (запись/сервис) и битые формулы, не падает на мусоре', () => {
    const r = parseSensorImport('[{"name":"a","pid":"04","formula":"A"},{"name":"b","pid":"ZZ","formula":"A"},{"name":"c","pid":"0B","formula":"A+"},{"pid":"0B","formula":"A"}]', compile)
    expect(r.sensors.map((s) => s.name)).toEqual(['a'])
    expect(r.errors).toHaveLength(3)
    expect(parseSensorImport('не json', compile).errors).toHaveLength(1)
    expect(parseSensorImport('{}', compile).errors).toHaveLength(1)
  })
  it('экспорт можно импортировать обратно', () => {
    const r = parseSensorImport(exportSensors(BUILTIN_SENSORS), compile)
    expect(r.errors).toEqual([])
    expect(r.sensors.length).toBe(BUILTIN_SENSORS.filter((d) => d.pid).length)
  })
})

describe('Запись датчиков в поездку и сводка', () => {
  function drive(): ReturnType<TripRecorder['end']> {
    const rec = new TripRecorder(() => BUILTIN_SENSORS)
    rec.begin(0)
    // 10 минут по 1 с; температура ОЖ растёт с 60 до 112 °C (оранжевая, зелёная, красная зоны)
    for (let s = 0; s <= 600; s++) {
      rec.feed(s * 1000, 60, 8, { speed: 60, coolant: 60 + (s / 600) * 52, voltage: 14.2, rpm: 3000, load: 40 })
    }
    return rec.end(600_000)
  }
  it('считает min/avg/max и время в зонах', () => {
    const t = drive()!
    const c = t.sensors!.coolant
    expect(c.min).toBe(60)
    expect(c.max).toBeCloseTo(112, 5)
    expect(c.okMs + c.warnMs + c.badMs).toBe(600_000)
    expect(c.badMs).toBeGreaterThan(0)
    expect(t.sensors!.voltage.warnMs + t.sensors!.voltage.badMs).toBe(0)
  })
  it('прореживает ряд графика, не превышая лимит', () => {
    const t = drive()!
    expect(t.series!.t.length).toBeLessThanOrEqual(180)
    expect(t.series!.t.length).toBeGreaterThan(20)
    expect(t.series!.data.speed.length).toBe(t.series!.t.length)
  })
  it('текст сводки: помечает перегрев и хвалит нормальные датчики', () => {
    const t = drive()!
    const lines = sensorLines(t)
    expect(lines.find((l) => l.id === 'coolant')!.level).toBe('bad')
    expect(lines.find((l) => l.id === 'voltage')!.level).toBe('ok')
    const text = tripSummaryText(t, 60).join('\n')
    expect(text).toContain('Требует внимания: Темп. ОЖ')
    expect(tripReport(t, 60)).toContain('• Напряжение: 14,2 … 14,2 В')
  })
  it('старая поездка без датчиков не ломает сводку', () => {
    const old = { id: '1', start: 0, end: 60000, distanceKm: 1, fuelL: 0.1, movingMs: 60000, stoppedMs: 0, maxSpeedKmh: 50 }
    expect(sensorLines(old)).toEqual([])
    expect(tripSummaryText(old, 60).join(' ')).toContain('Данных по датчикам нет')
  })
  it('пропуск в данных >5 с не засчитывается во время в зоне', () => {
    const r = new SensorStatsRecorder(() => BUILTIN_SENSORS)
    r.feed(0, { coolant: 90 })
    r.feed(1000, { coolant: 90 })
    r.feed(60_000, { coolant: 90 })
    expect(r.agg.coolant.okMs).toBe(1000)
  })
})

describe('Уведомление', () => {
  it('формат времени и текст', () => {
    expect(elapsedText(45_000)).toBe('45 с')
    expect(elapsedText(12 * 60_000 + 5000)).toBe('12 мин 05 с')
    expect(elapsedText(3_900_000)).toBe('1 ч 05 мин')
    expect(notificationBody({ since: 0, via: 'ble', values: { speed: 61.2, coolant: 88.4, voltage: 14.12 } }, 3_900_000)).toBe('Работает 1 ч 05 мин · 61 км/ч · ОЖ 88 °C · 14.1 В')
    expect(notificationBody({ since: 0, via: 'ble', values: {} }, 5000)).toBe('Работает 5 с')
  })
})

import { fuelSystemText, parseStatus } from '@/services/EcuStatus'

describe('Статус ЭБУ (данные реальной ВАЗ-2104)', () => {
  // 41 01 00 07 65 40 + 41 03 02 00 — как в Car Scanner: лампа выкл., кодов 0, замкнутый контур
  const st = parseStatus([0x00, 0x07, 0x65, 0x40], [0x02, 0x00])!
  it('лампа, коды, топливная система', () => {
    expect(st.mil).toBe(false)
    expect(st.dtcCount).toBe(0)
    expect(fuelSystemText(st.fuelSystem)).toMatchObject({ level: 'ok' })
    expect(parseStatus([0x83, 0, 0, 0], null)).toMatchObject({ mil: true, dtcCount: 3 })
    expect(parseStatus(null, null)).toBeNull()
  })
  it('тесты готовности совпадают с экраном сканера', () => {
    const m = Object.fromEntries(st.monitors.map((x) => [x.name, x]))
    expect(m['Катализатор']).toMatchObject({ supported: true, complete: true })
    expect(m['Обогреваемый катализатор'].supported).toBe(false)
    expect(m['Датчик кислорода']).toMatchObject({ supported: true, complete: true })
    expect(m['Нагреватель датчика кислорода']).toMatchObject({ supported: true, complete: false })
    expect(m['Система EGR'].supported).toBe(false)
    expect(m['Пропуски зажигания']).toMatchObject({ supported: true, complete: true })
  })
})
