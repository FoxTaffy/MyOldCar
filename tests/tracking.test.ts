import { describe, expect, it } from 'vitest'
import { allDtcs, describeDtc, searchDtcs } from '@/data/dtcDictionary'
import { BUILTIN_SENSORS } from '@/data/sensors'
import { parseVinResponse } from '@/services/ELMService'
import { analyzeTrack, nearestPoint } from '@/services/TripAnalysis'
import { IDLE_END_MS, TripSession, type GpsFix } from '@/services/TripSession'
import { checkDigit, decodeVin, extractVin, modelYear } from '@/services/Vin'
import type { SensorSnapshot } from '@/types'

const MIN = 60_000
const obd = (t: number, o: Partial<SensorSnapshot> = {}): SensorSnapshot => ({ rpm: 900, speedKmh: 0, coolantTempC: 90, mafGs: 3, timestamp: t, ...o })
const fix = (t: number, kmh: number, lat = 55.75, lon = 37.62): GpsFix => ({ t, lat, lon, speedKmh: kmh, accuracy: 5 })

describe('TripSession: автозапись и 30-минутный таймаут', () => {
  it('поездка стартует сама по данным OBD и заканчивается через 30 минут тишины, конец = последняя активность', () => {
    const s = new TripSession('c1')
    let t = 1_000_000
    for (let i = 0; i < 60; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 50 }))
    expect(s.active).toBe(true)
    const lastActive = t - 1000
    expect(s.tick(lastActive + IDLE_END_MS - 1)).toBeNull() // 29:59 — ещё идёт
    const done = s.tick(lastActive + IDLE_END_MS)
    expect(done).not.toBeNull()
    expect(done!.trip.end).toBe(lastActive)
    expect(done!.trip.distanceKm).toBeGreaterThan(0.5)
    expect(done!.trip.carId).toBe('c1')
    expect(done!.points.length).toBeGreaterThan(5)
    expect(s.active).toBe(false)
  })

  it('потеря OBD не обрывает поездку: GPS продолжает запись', () => {
    const s = new TripSession()
    let t = 0
    for (let i = 0; i < 20; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 40 }))
    // адаптер пропал, дальше только GPS
    for (let i = 0; i < 60; i++, t += 1000) s.feedGps(t, fix(t, 60, 55.75 + i * 0.0001))
    expect(s.active).toBe(true)
    expect(s.tick(t + 5 * MIN)).toBeNull()
    const done = s.finish(t)!
    expect(done.trip.source).toBe('both')
    expect(done.trip.distanceKm).toBeGreaterThan(1)
    expect(done.points.some((p) => p.lat != null)).toBe(true)
  })

  it('редкие точки GPS (фон, раз в 30 с) дают полную поездку, а не несколько секунд', () => {
    const s = new TripSession()
    let t = 0
    // 40 минут, точка раз в 30 с, ~333 м между точками ≈ 40 км/ч; у половины точек нет скорости
    for (let i = 0; i <= 80; i++, t += 30_000) s.feedGps(t, { t, lat: 55.75 + i * 0.003, lon: 37.62, speedKmh: i % 2 ? 40 : null, accuracy: 15 })
    const trip = s.trip!
    expect(trip.movingMs + trip.stoppedMs).toBeGreaterThanOrEqual(39 * MIN) // первая точка без скорости только задаёт начало отсчёта
    expect(trip.distanceKm).toBeGreaterThan(25)
    expect(trip.distanceKm).toBeLessThan(28)
  })

  it('редкие точки на стоянке пробег не накручивают, скачок GPS не считается ездой', () => {
    const s = new TripSession()
    s.feedObd(0, obd(0, { rpm: 800, speedKmh: null }))
    let t = 1000
    for (let i = 0; i < 20; i++, t += 30_000) s.feedGps(t, { t, lat: 55.75 + (i % 2) * 0.00005, lon: 37.62, speedKmh: null, accuracy: 20 })
    expect(s.trip!.distanceKm).toBe(0)
    s.feedGps(t, { t, lat: 56.75, lon: 37.62, speedKmh: null, accuracy: 20 }) // 111 км за 30 с
    expect(s.trip!.distanceKm).toBe(0)
  })

  it('опоздавшая точка GPS (старее уже учтённых данных) игнорируется', () => {
    const s = new TripSession()
    let t = 100_000
    for (let i = 0; i < 10; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 50 }))
    const before = { ...s.trip! }
    s.feedGps(50_000, fix(50_000, 80))
    expect(s.trip).toEqual(before)
  })

  it('без активности поездка не начинается (двигатель заглушен, GPS стоит)', () => {
    const s = new TripSession()
    for (let t = 0; t < 10_000; t += 1000) s.feedGps(t, fix(t, 0))
    expect(s.active).toBe(false)
  })

  it('шум GPS на стоянке (<2 км/ч) пробег не накручивает', () => {
    const s = new TripSession()
    s.feedObd(0, obd(0, { rpm: 800, speedKmh: null }))
    for (let t = 1000; t < 30_000; t += 1000) s.feedGps(t, fix(t, 1.4))
    expect(s.trip!.distanceKm).toBe(0)
  })

  it('GPS без скорости: скорость и пробег считаются по смещению координат', () => {
    const s = new TripSession()
    let t = 0
    // ~11 м за секунду по широте ≈ 40 км/ч
    for (let i = 0; i < 60; i++, t += 1000) s.feedGps(t, { t, lat: 55.75 + i * 0.0001, lon: 37.62, speedKmh: null, accuracy: 4 })
    expect(s.active).toBe(true)
    expect(s.trip!.distanceKm).toBeGreaterThan(0.5)
    expect(s.trip!.maxSpeedKmh).toBeGreaterThan(30)
    expect(s.trip!.maxSpeedKmh).toBeLessThan(50)
  })

  it('GPS без скорости на стоянке: дрожание координат в пределах погрешности пробег не накручивает', () => {
    const s = new TripSession()
    s.feedObd(0, obd(0, { rpm: 800, speedKmh: null }))
    for (let t = 1000; t < 60_000; t += 1000) s.feedGps(t, { t, lat: 55.75 + (t % 2000 ? 0.00002 : 0), lon: 37.62, speedKmh: null, accuracy: 8 })
    expect(s.trip!.distanceKm).toBe(0)
  })

  it('плохая точность GPS отбрасывается', () => {
    const s = new TripSession()
    s.feedGps(0, { ...fix(0, 50), accuracy: 200 })
    expect(s.active).toBe(false)
  })

  it('загорание Check Engine фиксируется событием и точкой трека', () => {
    const s = new TripSession()
    const events: number[] = []
    s.onMil = (e) => events.push(e.t)
    let t = 0
    for (let i = 0; i < 10; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 30, milOn: false }))
    for (let i = 0; i < 10; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 30, milOn: true }))
    expect(events).toHaveLength(1)
    expect(s.trip!.events).toHaveLength(1)
    const a = analyzeTrack(s.points)
    expect(a.milPoints).toHaveLength(1)
    expect(a.milPoints[0].mil).toBe(true)
  })

  it('длинная поездка прореживается и не превышает лимит точек', () => {
    const s = new TripSession()
    let t = 0
    for (let i = 0; i < 20_000; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 60 }))
    expect(s.points.length).toBeLessThanOrEqual(1200)
    expect(s.points[0].t).toBe(0)
  })
})

describe('Анализ трека', () => {
  it('находит остановки от 2 минут и игнорирует короткие', () => {
    const pts = []
    let t = 0
    const add = (spd: number, n: number, rpm = 800) => { for (let i = 0; i < n; i++, t += 10_000) pts.push({ t, lat: 55 + t * 1e-8, lon: 37, spd, rpm, ect: 90, maf: 3, load: null, thr: null, volt: null, mil: false }) }
    add(50, 6); add(0, 7); add(50, 6); add(0, 3); add(50, 3) // стоянка 60 с и 20 с? (7 точек = 60 с)
    add(0, 20) // 190 с
    const a = analyzeTrack(pts as never)
    expect(a.stops).toHaveLength(1)
    expect(a.stops[0].end - a.stops[0].start).toBeGreaterThanOrEqual(2 * MIN)
    expect(a.stops[0].engineOn).toBe(true)
  })

  it('nearestPoint выбирает ближайшую точку', () => {
    const p = (lat: number, lon: number) => ({ t: 0, lat, lon, spd: 0, rpm: 0, ect: 0, maf: 0, load: 0, thr: 0, volt: 0, mil: false })
    const pts = [p(55, 37), p(55.1, 37.1), p(55.2, 37.2)]
    expect(nearestPoint(pts, 55.11, 37.09)).toBe(pts[1])
  })
})

describe('VIN', () => {
  it('контрольная цифра: эталонный VIN 1M8GDM9AXKP042788', () => {
    expect(checkDigit('1M8GDM9AXKP042788')).toBe('X')
    expect(decodeVin('1M8GDM9AXKP042788').checkDigitOk).toBe(true)
  })

  it('российский ВАЗ: страна, изготовитель, год; контрольная цифра не обязательна', () => {
    const i = decodeVin('XTA21043051234567', 2026)
    expect(i.valid).toBe(true)
    expect(i.country).toBe('Россия')
    expect(i.maker).toMatch(/ВАЗ/)
    expect(i.year).toBe(2005)
  })

  it('год: цикл 30 лет', () => {
    expect(modelYear('Y', 2026)).toBe(2000)
    expect(modelYear('A', 2026)).toBe(2010)
    expect(modelYear('T', 2026)).toBe(2026)
    expect(modelYear('U', 2026)).toBeNull()
  })

  it('исправляет типичные ошибки ввода (I/O/Q) и режет пробелы', () => {
    expect(decodeVin('xta 2104 3O5 1234567').vin).toBe('XTA21043051234567')
    expect(decodeVin('XTA2104').valid).toBe(false)
  })

  it('достаёт VIN из текста штрихкода', () => {
    expect(extractVin('VIN: XTA21043051234567\n')).toBe('XTA21043051234567')
    expect(extractVin('мусор')).toBeNull()
  })

  it('разбор ответа ЭБУ 09 02: кадры ISO-TP и К-линия', () => {
    const iso = '014\r0: 49 02 01 58 54 41\r1: 32 31 30 34 33 30 35\r2: 31 32 33 34 35 36 37'
    expect(parseVinResponse(iso)).toBe('XTA21043051234567')
    const kline = '49 02 01 00 00 00 58\r49 02 02 54 41 32 31\r49 02 03 30 34 33 30\r49 02 04 35 31 32 33\r49 02 05 34 35 36 37'
    expect(parseVinResponse(kline)).toBe('XTA21043051234567')
    expect(parseVinResponse('NO DATA')).toBeNull()
  })
})

describe('Справочник DTC', () => {
  it('расшифровывает известные коды (в т.ч. сгенерированные семейства)', () => {
    expect(describeDtc('P0171').title).toMatch(/Бедная смесь/)
    expect(describeDtc('p0134').title).toMatch(/Лямбда-зонд \(банк 1, датчик 1.*нет активности/)
    expect(describeDtc('P0302').title).toMatch(/цилиндре 2/)
    expect(describeDtc('P0203').title).toMatch(/Форсунка цилиндра 3/)
    expect(describeDtc('P0355').title).toMatch(/Катушка зажигания E/)
    expect(describeDtc('P1123').known).toBe(true)
  })

  it('для неизвестного кода строит описание по структуре', () => {
    const d = describeDtc('P0999X'.slice(0, 5))
    expect(d.known).toBe(true) // P0999 есть
    const u = describeDtc('P0F00')
    expect(u.known).toBe(false)
    expect(u.kind).toBe('generic')
    expect(describeDtc('P1F00').kind).toBe('manufacturer')
    expect(describeDtc('U0100').system).toMatch(/Сеть/)
  })

  it('все коды справочника имеют корректный формат и непустой текст, нет дублей по семантике P0300-P0304', () => {
    const all = allDtcs()
    expect(all.length).toBeGreaterThan(400)
    for (const d of all) {
      expect(d.code).toMatch(/^[PBCU][0-9A-F]{4}$/)
      expect(d.title.length).toBeGreaterThan(8)
    }
  })

  it('поиск по слову и по коду', () => {
    expect(searchDtcs('лямбда').length).toBeGreaterThan(10)
    expect(searchDtcs('P0420')[0].code).toBe('P0420')
    expect(searchDtcs('')).toEqual([])
  })
})

describe('TripSession: статистика датчиков попадает в поездку', () => {
  it('значения датчиков передаются в поездку и сохраняются при завершении', () => {
    const s = new TripSession('c1', () => BUILTIN_SENSORS)
    let t = 0
    for (let i = 0; i < 30; i++, t += 1000) s.feedObd(t, obd(t, { speedKmh: 50 }), { speed: 50, rpm: 2100 })
    expect(s.snapshot()!.sensors).toBeDefined()
    const done = s.finish(t)!
    expect(Object.keys(done.trip.sensors ?? {})).toEqual(expect.arrayContaining(['speed', 'rpm']))
    expect(done.trip.series).toBeDefined()
  })
})
