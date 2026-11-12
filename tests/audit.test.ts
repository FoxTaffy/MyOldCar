/* Регрессионные тесты на ошибки, найденные при ревизии приложения. */
import { describe, expect, it } from 'vitest'
import { codeAt } from '@/data/dtcData'
import { allDtcs, describeDtc, dtcAdvice, DTC_COUNT, findDtcs, isDtcCode } from '@/data/dtcDictionary'
import { DTC_MATRIX, diagnose } from '@/services/DiagnosticEngine'
import { CapacitorTcpTransport, ELMService, MockTransport, parseDtcResponse, parsePid, type TcpPlugin, type Transport } from '@/services/ELMService'
import { oilStatus, DEFAULT_OIL } from '@/services/OilService'
import { PerformanceTimer } from '@/services/PerformanceTimer'
import { TripSession } from '@/services/TripSession'
import { currentOdometer, newCar } from '@/services/Cars'
import { DEFAULT_SETTINGS, type SensorSnapshot } from '@/types'

const obd = (t: number, o: Partial<SensorSnapshot> = {}): SensorSnapshot => ({ rpm: 900, speedKmh: 0, coolantTempC: 90, mafGs: 3, timestamp: t, ...o })

/** Транспорт, отвечающий по таблице «команда → ответ». */
function scripted(replies: Record<string, string | (() => string)>): Transport {
  let cb: (s: string) => void = () => {}
  return {
    connect: async () => {},
    onData: (f) => { cb = f },
    close: async () => {},
    write: async (data) => {
      const cmd = data.trim().toUpperCase()
      const r = replies[cmd] ?? (cmd.startsWith('AT') ? 'OK' : 'NO DATA')
      setTimeout(() => cb((typeof r === 'function' ? r() : r) + '\r\r>'), 1)
    },
  }
}
const CFG = { host: 'x', port: 1, timeoutMs: 500, probeMs: 200, searchMs: 200 }

describe('Коды ошибок: форматы ответа', () => {
  it('CAN: после заголовка идёт число кодов — оно не должно превращаться в код', () => {
    expect(parseDtcResponse('43 02 01 71 03 01')).toEqual(['P0171', 'P0301'])
    expect(parseDtcResponse('43 01 01 71')).toEqual(['P0171'])
    expect(parseDtcResponse('43 00')).toEqual([])
  })
  it('CAN: многокадровый ответ ISO-TP склеивается', () => {
    expect(parseDtcResponse('00A\r0: 43 04 01 71 03 01\r1: 03 02 04 20 00 00 00')).toEqual(['P0171', 'P0301', 'P0302', 'P0420'])
  })
  it('К-линия: несколько строк по три кода, «BUS INIT: OK» перед ответом не мешает', () => {
    expect(parseDtcResponse('BUS INIT: OK\r43 01 71 03 01 03 02\r43 04 20 00 00 00 00')).toEqual(['P0171', 'P0301', 'P0302', 'P0420'])
    expect(parseDtcResponse('47 01 23 00 00 00 00', '47')).toEqual(['P0123'])
  })
  it('parsePid ищет заголовок только на границе байта', () => {
    expect(parsePid('41 0D 3C', '0D')).toEqual([0x3c])
    expect(parsePid('04 10 D3', '0D')).toBeNull() // «410D» есть только со сдвигом на полбайта
    expect(parsePid('42 0C 00 0D 98', '0C', '42')).toEqual([0x00, 0x0d, 0x98])
  })
  it('сбой связи при чтении кодов — ошибка, а не «ошибок нет»', async () => {
    const elm = new ELMService(scripted({ '0100': '41 00 BE 3E B8 11', '03': 'BUS INIT: ...ERROR', '07': 'NO DATA' }), CFG)
    await elm.connect()
    await expect(elm.readDtcs()).rejects.toThrow(/не ответил/)
    expect(await elm.readPendingDtcs()).toEqual([])
  })
})

describe('ELMService', () => {
  it('стоп-кадр (режим 02) читается из демо-ЭБУ', async () => {
    const elm = new ELMService(new MockTransport(), CFG)
    await elm.connect()
    const f = await elm.readFreezeFrame()
    expect(f?.dtc).toBe('P0171')
    expect(f?.rpm).toBe(870)
    expect(f?.speedKmh).toBe(0)
    expect(f?.coolantTempC).toBe(88)
    expect(f!.ltft!).toBeGreaterThan(10)
  })
  it('нет стоп-кадра → null', async () => {
    const elm = new ELMService(new MockTransport({ dtcs: [], pending: [], lowMaf: false }), CFG)
    await elm.connect()
    expect(await elm.readFreezeFrame()).toBeNull()
  })
  it('дополнительные PID не отключаются навсегда, пока ЭБУ молчит (выключили зажигание)', async () => {
    let ignition = true
    const live = (v: string) => () => (ignition ? v : 'NO DATA')
    const elm = new ELMService(scripted({
      '0100': '41 00 BE 3E B8 11', '010C': live('41 0C 0D 48'), '010D': live('41 0D 00'), '0105': live('41 05 7E'), '0110': live('41 10 00 BE'),
      '0104': live('41 04 38'), '0111': live('41 11 21'), '0142': live('41 42 37 78'),
    }), CFG)
    await elm.connect()
    expect((await elm.readExtended()).loadPct).toBeCloseTo(22, 0)
    ignition = false
    for (let i = 0; i < 5; i++) { await elm.readSnapshot(); await elm.readExtended() }
    await new Promise((r) => setTimeout(r, 10))
    ignition = true
    await elm.readSnapshot()
    const ext = await elm.readExtended()
    expect(ext.loadPct).toBeCloseTo(22, 0)
    expect(ext.voltage).toBeCloseTo(14.2, 1)
    // А вот PID, которого у ЭБУ нет (при живом ЭБУ), после нескольких отказов больше не запрашивается.
    expect(ext.stft).toBeNull()
  })
  it('Wi-Fi: закрытие сокета сразу сообщается как потеря связи', async () => {
    let dead = false
    const fake: TcpPlugin = {
      connect: async () => ({ client: 1 }),
      send: async () => {},
      read: async () => {
        await new Promise((r) => setTimeout(r, 2))
        throw Object.assign(new Error('x'), { code: dead ? 'EOF' : 'TIMEOUT' })
      },
      disconnect: async () => {},
    }
    const t = new CapacitorTcpTransport(CFG, fake)
    let lost = 0
    t.onClose(() => lost++)
    await t.connect()
    dead = true
    await new Promise((r) => setTimeout(r, 20))
    expect(lost).toBe(1)
  })
})

describe('Поездка: найденные ошибки логики', () => {
  it('опоздавшие точки GPS (журнал службы) закрывают пропуск, пока приложение спало', () => {
    const s = new TripSession()
    let t = 0
    for (let i = 0; i < 30; i++, t += 1000) {
      s.feedObd(t, obd(t, { speedKmh: 40 }))
      s.feedGps(t, { t, lat: 55.75 + i * 0.0001, lon: 37.62, speedKmh: 40, accuracy: 5 })
    }
    const before = s.trip!.distanceKm
    const sleptFrom = t - 1000
    // 5 минут сна; приложение проснулось — первым пришёл свежий снимок OBD…
    const wake = sleptFrom + 5 * 60_000
    s.feedObd(wake, obd(wake, { speedKmh: 40 }))
    expect(s.trip!.distanceKm).toBeCloseTo(before, 5)
    // …и только потом журнал GPS с точками за время сна (раз в 30 с, ~333 м между точками).
    let lat = 55.75 + 29 * 0.0001
    for (let ts = sleptFrom + 30_000; ts < wake; ts += 30_000) {
      lat += 0.003
      s.feedGps(ts, { t: ts, lat, lon: 37.62, speedKmh: null, accuracy: 10 })
    }
    expect(s.trip!.distanceKm - before).toBeGreaterThan(2.5)
    expect(s.trip!.distanceKm - before).toBeLessThan(3.5)
    // Точки сна попали в трек, и трек остался упорядочен по времени.
    const ts = s.points.map((p) => p.t)
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
    expect(s.points.filter((p) => p.t > sleptFrom && p.t < wake).length).toBeGreaterThan(5)
  })
  it('опоздавшая точка без пропуска в данных пробег не добавляет', () => {
    const s = new TripSession()
    let t = 0
    for (let i = 0; i < 30; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 40 }))
    const before = s.trip!.distanceKm
    s.feedGps(t - 20_000, { t: t - 20_000, lat: 55.75, lon: 37.62, speedKmh: 40, accuracy: 5 })
    s.feedGps(t - 10_000, { t: t - 10_000, lat: 55.751, lon: 37.62, speedKmh: 40, accuracy: 5 })
    expect(s.trip!.distanceKm).toBe(before)
  })
  it('датчик скорости молчит (OBD = 0), а GPS показывает езду — пробег считается по GPS', () => {
    const s = new TripSession()
    let t = 0
    for (let i = 0; i < 60; i++, t += 1000) {
      s.feedObd(t, obd(t, { speedKmh: 0, rpm: 2500 }))
      s.feedGps(t + 1, { t: t + 1, lat: 55.75 + i * 0.00015, lon: 37.62, speedKmh: 60, accuracy: 5 })
    }
    expect(s.trip!.distanceKm).toBeGreaterThan(0.8)
    expect(s.trip!.maxSpeedKmh).toBe(60)
  })
  it('простой с включённым зажиганием после остановки не входит во время поездки', () => {
    const s = new TripSession()
    let t = 0
    for (let i = 0; i < 120; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 50 }))
    const lastActive = t - 1000
    // Двигатель заглушили, зажигание осталось: 35 минут нулей.
    for (let i = 0; i < 35 * 60; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 0, rpm: 0 }))
    const done = s.tick(t)!
    expect(done.trip.end).toBe(lastActive)
    // допуск — один шаг опроса (отсчёт, на котором скорость упала до нуля)
    expect(done.trip.movingMs + done.trip.stoppedMs).toBeLessThanOrEqual(done.trip.end - done.trip.start + 1000)
  })
  it('демо-поездка помечается и не смешивается с реальными', () => {
    const s = new TripSession('c1')
    s.demo = true
    for (let t = 0; t < 60_000; t += 1000) s.feedObd(t, obd(t, { speedKmh: 60 }))
    expect(s.finish(60_000)!.trip.demo).toBe(true)
    s.demo = false
    for (let t = 100_000; t < 160_000; t += 1000) s.feedObd(t, obd(t, { speedKmh: 60 }))
    expect(s.finish(160_000)!.trip.demo).toBeUndefined()
  })
})

describe('Замер 0–100', () => {
  it('не стартует на ходу: сначала нужна полная остановка', () => {
    const t = new PerformanceTimer()
    t.feed(0, 40, 2500)
    t.feed(500, 60, 3000)
    expect(t.state).toBe('idle')
    expect(t.waitingForStop).toBe(true)
    t.feed(1000, 0, 900)
    expect(t.waitingForStop).toBe(false)
    t.feed(2000, 10, 3000)
    expect(t.state).toBe('running')
  })
  it('сорванная попытка (остановились до 100) сбрасывается, следующий старт считается заново', () => {
    const t = new PerformanceTimer()
    t.feed(0, 0, 900); t.feed(1000, 20, 3000); t.feed(3000, 50, 4000); t.feed(6000, 0, 900)
    expect(t.state).toBe('idle')
    expect(t.aborted).toBe(1)
    t.feed(10_000, 10, 3000); t.feed(15_000, 60, 4000); t.feed(20_000, 100, 5000)
    expect(t.state).toBe('finished')
    expect(t.result!.durationMs).toBe(10_000)
  })
})

describe('Масло и одометр', () => {
  it('прошёл год — пора менять, даже если пробег не вышел', () => {
    const o = { ...DEFAULT_OIL, dateISO: '2025-01-01' }
    const s = oilStatus(o, 500, new Date('2026-03-01'))
    expect(s.pct).toBeLessThan(10)
    expect(s.overdueByTime).toBe(true)
    expect(s.level).toBe('bad')
    expect(oilStatus(o, 500, new Date('2025-06-01')).level).toBe('ok')
  })
  it('оценка одометра = введённое значение + пробег, записанный после ввода', () => {
    const c = newCar({ odometerKm: 120_000, odometerTrackedAt: 300, trackedTotalKm: 450 })
    expect(currentOdometer(c)).toBe(120_150)
    expect(currentOdometer(newCar())).toBeNull()
  })
})

describe('Справочник: нумерация и полнота', () => {
  it('номера кодов идут по-десятичному: после P0139 — P0140', () => {
    expect(codeAt('P0136', 4)).toBe('P0140')
    expect(codeAt('P2A00', 3)).toBe('P2A03')
    expect(describeDtc('P0140').title).toMatch(/банк 1, датчик 2.*нет активности/)
    expect(describeDtc('P0141').title).toMatch(/банк 1, датчик 2.*подогрев/)
    expect(describeDtc('P0160').title).toMatch(/банк 2, датчик 2.*нет активности/)
  })
  it('форсунки, пропуски и катушки цилиндров 4–12 привязаны к правильным кодам', () => {
    expect(describeDtc('P0270').title).toMatch(/цилиндра 4: низкий/)
    expect(describeDtc('P0272').title).toMatch(/цилиндра 4: разбаланс/)
    expect(describeDtc('P0310').title).toMatch(/цилиндре 10/)
    expect(describeDtc('P0212').title).toMatch(/цилиндра 12/)
    expect(describeDtc('P0360').title).toMatch(/цилиндр 10/)
    for (const bogus of ['P026A', 'P030A', 'P020A', 'P035A']) expect(describeDtc(bogus).known).toBe(false)
  })
  it('справочник расширен: P0/P2/P3/U/C/B и заводские ВАЗ', () => {
    expect(DTC_COUNT).toBeGreaterThan(1700)
    const known = ['P0011', 'P0016', 'P0087', 'P0299', 'P0363', 'P0420', 'P0615', 'P0741', 'P0999', 'P2096', 'P2135', 'P2187', 'P2302', 'P2A00', 'P3401', 'U0001', 'U0121', 'U0155', 'U0401', 'C0035', 'B0001', 'P1602', 'P1135', 'P1386']
    for (const c of known) expect(describeDtc(c).known, c).toBe(true)
    for (const d of allDtcs()) {
      expect(d.code).toMatch(/^[PBCU][0-9A-F]{4}$/)
      expect(d.title.length, d.code).toBeGreaterThan(8)
      expect(d.title, d.code).not.toMatch(/undefined|\|/)
    }
  })
  it('универсальный/заводской определяется по группе', () => {
    expect(describeDtc('P3401').kind).toBe('generic')
    expect(describeDtc('P3100').kind).toBe('manufacturer')
    expect(describeDtc('U0100').kind).toBe('generic')
    expect(describeDtc('U1000').kind).toBe('manufacturer')
    expect(describeDtc('U0100').subsystem).toMatch(/потеря связи/)
  })
  it('поиск: несколько слов, коды по префиксу — первыми, общее число совпадений', () => {
    const r = findDtcs('форсунка 3')
    expect(r.items[0].title).toMatch(/Форсунка цилиндра 3/)
    expect(findDtcs('p03').items[0].code).toBe('P0300')
    const many = findDtcs('датчик', 10)
    expect(many.items).toHaveLength(10)
    expect(many.total).toBeGreaterThan(100)
    expect(findDtcs('ё').total).toBe(findDtcs('е').total)
    expect(isDtcCode(' p0171 ')).toBe(true)
    expect(isDtcCode('лямбда')).toBe(false)
  })
  it('подсказка «что проверить» есть для любого кода', () => {
    expect(dtcAdvice('P0301')).toMatch(/свечи/i)
    expect(dtcAdvice('P0171')).toMatch(/подсос/i)
    expect(dtcAdvice('U0121')).toMatch(/CAN/)
    expect(dtcAdvice('P0118')).toMatch(/Прозвоните/)
    expect(dtcAdvice('P0117')).toMatch(/замыкание на массу/)
    expect(dtcAdvice('P1F00')).toMatch(/Заводской/)
  })
})

describe('Матрица причин', () => {
  it('у каждого кода есть причины (свои или по ссылке), базовые веса положительны', () => {
    for (const [code, e] of Object.entries(DTC_MATRIX)) {
      const causes = e.alias ? DTC_MATRIX[e.alias]?.causes : e.causes
      expect(causes?.length, code).toBeGreaterThan(1)
      for (const c of causes!) expect(c.base, code).toBeGreaterThan(0)
      const r = diagnose(code, null, DEFAULT_SETTINGS)
      expect(r.modeled).toBe(true)
      expect(r.causes.reduce((a, c) => a + c.probability, 0), code).toBe(100)
    }
  })
  it('код без модели: расшифровка и подсказка вместо «100 %»', () => {
    const r = diagnose('P0011', null, DEFAULT_SETTINGS)
    expect(r.modeled).toBe(false)
    expect(r.title).toMatch(/Фазы впускного распредвала/)
    expect(r.causes[0].recommendation.length).toBeGreaterThan(20)
  })
  it('P0500: обороты есть, скорость 0 — подозрение на датчик скорости растёт', () => {
    const base = diagnose('P0500', obd(0, { rpm: 900 }), DEFAULT_SETTINGS).causes.find((c) => c.id === 'sensor')!.probability
    const hot = diagnose('P0500', obd(0, { rpm: 2600 }), DEFAULT_SETTINGS).causes.find((c) => c.id === 'sensor')!.probability
    expect(hot).toBeGreaterThan(base)
  })
})
