import { describe, expect, it } from 'vitest'
import { BleTransport, ELMService, parseDtcResponse, pickElmChars, type BleLike } from '@/services/ELMService'
import { oilStatus, DEFAULT_OIL } from '@/services/OilService'
import { TripRecorder, tripAvgSpeed, tripConsumption } from '@/services/TripRecorder'
import type { BleService } from '@capacitor-community/bluetooth-le'

const props = (o: Record<string, boolean>) => ({ broadcast: false, read: false, writeWithoutResponse: false, write: false, notify: false, indicate: false, authenticatedSignedWrites: false, reliableWrite: false, writableAuxiliaries: false, extendedProperties: false, notifyEncryptionRequired: false, indicateEncryptionRequired: false, ...o })
const svc = (uuid: string, chars: [string, Record<string, boolean>][]): BleService => ({
  uuid, characteristics: chars.map(([u, p]) => ({ uuid: u, properties: props(p), descriptors: [] })),
})

describe('BLE', () => {
  it('pickElmChars: FFF0 (раздельные notify/write) и пропуск стандартных сервисов', () => {
    const r = pickElmChars([
      svc('00001800-0000-1000-8000-00805f9b34fb', [['2a00', { read: true }]]),
      svc('0000fff0-0000-1000-8000-00805f9b34fb', [['fff1', { notify: true }], ['fff2', { writeWithoutResponse: true }]]),
    ])
    expect(r).toEqual({ service: '0000fff0-0000-1000-8000-00805f9b34fb', notify: 'fff1', write: 'fff2', writeNoResponse: true })
  })
  it('pickElmChars: одна характеристика и notify и write', () => {
    const r = pickElmChars([svc('0000ffe0-0000-1000-8000-00805f9b34fb', [['ffe1', { notify: true, write: true }]])])
    expect(r).toMatchObject({ notify: 'ffe1', write: 'ffe1', writeNoResponse: false })
  })
  it('pickElmChars: нет подходящих → null', () => {
    expect(pickElmChars([svc('0000180a-0000-1000-8000-00805f9b34fb', [['2a29', { read: true }]])])).toBeNull()
  })

  it('BleTransport + ELMService: ответ приходит кусками по 20 байт, разрыв вызывает onLost', async () => {
    let notify: (v: DataView) => void = () => {}
    let dropped: (id: string) => void = () => {}
    const enc = new TextEncoder()
    const fake: BleLike = {
      connect: async (_id, onDisc) => { dropped = onDisc ?? (() => {}) },
      disconnect: async () => {},
      getServices: async () => [svc('0000fff0-0000-1000-8000-00805f9b34fb', [['fff1', { notify: true }], ['fff2', { write: true }]])],
      startNotifications: async (_i, _s, _c, cb) => { notify = cb },
      stopNotifications: async () => {},
      write: async (_i, _s, _c, v) => {
        const cmd = new TextDecoder().decode(v).trim()
        const reply = cmd === '010C' ? '41 0C 1A F8\r\r>' : 'OK\r\r>'
        for (let i = 0; i < reply.length; i += 7) setTimeout(() => notify(new DataView(enc.encode(reply.slice(i, i + 7)).buffer)), 1)
      },
      writeWithoutResponse: async () => {},
    }
    const elm = new ELMService(new BleTransport('AA:BB', fake), { host: '', port: 0, timeoutMs: 1000 })
    await elm.connect()
    expect(await elm.readRpm()).toBe(1726)
    let lost = false
    elm.onLost = () => { lost = true }
    dropped('AA:BB')
    expect(lost).toBe(true)
    expect(elm.connected).toBe(false)
  })

  it('ручное отключение не считается потерей связи', async () => {
    let dropped: (id: string) => void = () => {}
    const fake: BleLike = {
      connect: async (_i, cb) => { dropped = cb ?? (() => {}) }, disconnect: async () => { dropped('x') },
      getServices: async () => [svc('0000fff0-0000-1000-8000-00805f9b34fb', [['fff1', { notify: true }], ['fff2', { write: true }]])],
      startNotifications: async () => {}, stopNotifications: async () => {}, write: async () => {}, writeWithoutResponse: async () => {},
    }
    const t = new BleTransport('x', fake)
    let lost = false
    t.onClose(() => { lost = true })
    await t.connect()
    await t.close()
    expect(lost).toBe(false)
  })
})

describe('режим 07', () => {
  it('разбор ответа 47', () => {
    expect(parseDtcResponse('47 01 23 00 00 00 00', '47')).toEqual(['P0123'])
    expect(parseDtcResponse('47 01 23', '43')).toEqual([])
  })
})

describe('TripRecorder', () => {
  it('интегрирует расстояние, время движения/стоянки и топливо', () => {
    const r = new TripRecorder()
    r.begin(0)
    for (let t = 0; t <= 10_000; t += 1000) r.feed(t, 0, 2.5) // 10 с стоим
    let km = 0
    for (let t = 11_000; t <= 3_611_000; t += 1000) km += r.feed(t, 60, 12) // час на 60 км/ч (+1с разгона)
    const trip = r.end(3_611_000)!
    expect(trip.distanceKm).toBeGreaterThan(59.5)
    expect(trip.distanceKm).toBeLessThan(60.5)
    expect(km).toBeCloseTo(trip.distanceKm, 5)
    expect(trip.stoppedMs).toBe(10_000)
    expect(tripAvgSpeed(trip)).toBeCloseTo(60, 0)
    expect(tripConsumption(trip)!).toBeGreaterThan(5)
    expect(trip.maxSpeedKmh).toBe(60)
  })
  it('пропуск данных > 5 с не интегрируется; короткие поездки отбрасываются', () => {
    const r = new TripRecorder()
    r.begin(0)
    r.feed(0, 100, null)
    expect(r.feed(60_000, 100, null)).toBe(0)
    expect(r.end(60_000)).toBeNull()
  })
})

describe('OilService', () => {
  it('прогресс, остаток и уровни', () => {
    const o = { ...DEFAULT_OIL, dateISO: '2026-01-01', offsetKm: 2000, trackedAtSet: 500 }
    const s = oilStatus(o, 3500, new Date('2026-11-09'))
    expect(s.sinceKm).toBe(5000)
    expect(s.leftKm).toBe(5000)
    expect(s.level).toBe('ok')
    expect(oilStatus(o, 6500).level).toBe('warn')
    expect(oilStatus(o, 8500).level).toBe('bad')
    expect(s.daysSince).toBeGreaterThan(300)
  })
  it('без даты — не настроено', () => {
    expect(oilStatus(DEFAULT_OIL, 1000).configured).toBe(false)
  })
})
