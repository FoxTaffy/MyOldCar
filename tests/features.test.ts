import { describe, expect, it } from 'vitest'
import { BleTransport, ELMService, friendlyBleError, parseDtcResponse, pickElmChars, type BleLike } from '@/services/ELMService'
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
        const reply = cmd === '010C' ? '41 0C 1A F8\r\r>' : cmd === '0100' ? '41 00 BE 3E B8 11\r\r>' : 'OK\r\r>'
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

describe('BLE: status 133', () => {
  const okSvc = [svc('0000fff0-0000-1000-8000-00805f9b34fb', [['fff1', { notify: true }], ['fff2', { write: true }]])]
  const base = (): BleLike => ({
    connect: async () => {}, disconnect: async () => {}, getServices: async () => okSvc,
    startNotifications: async () => {}, stopNotifications: async () => {}, write: async () => {}, writeWithoutResponse: async () => {},
  })

  it('initialize вызывается до подключения; 133 повторяется, зависший GATT освобождается', async () => {
    const log: string[] = []
    let n = 0
    const fake: BleLike = {
      ...base(),
      initialize: async () => { log.push('init') },
      connect: async () => { log.push('connect'); if (++n < 3) throw new Error('Connection failed with status 133 (GATT_ERROR).') },
      disconnect: async () => { log.push('disconnect') },
    }
    await new BleTransport('x', fake, { retryMs: 1, scanMs: 1 }).connect()
    expect(log).toEqual(['init', 'connect', 'disconnect', 'connect', 'disconnect', 'connect'])
  })

  it('после всех попыток — понятное сообщение про занятый адаптер', async () => {
    const fake: BleLike = { ...base(), connect: async () => { throw new Error('Connection failed with status 133 (GATT_ERROR).') } }
    await expect(new BleTransport('x', fake, { retryMs: 1, scanMs: 1 }).connect()).rejects.toThrow(/Car Scanner/)
  })

  it('свежее сканирование: ждёт появления нужного устройства и останавливает скан', async () => {
    const log: string[] = []
    const fake: BleLike = {
      ...base(),
      requestLEScan: async (_o, cb) => { log.push('scan'); setTimeout(() => cb({ device: { deviceId: 'x' } } as never), 1) },
      stopLEScan: async () => { log.push('stop') },
      connect: async () => { log.push('connect') },
    }
    await new BleTransport('x', fake, { scanMs: 500 }).connect()
    expect(log).toEqual(['scan', 'stop', 'connect'])
  })

  it('friendlyBleError: разрешения и выключенный Bluetooth', () => {
    expect(friendlyBleError(new Error('Permission denied'))).toMatch(/Разрешите/)
    expect(friendlyBleError(new Error('Bluetooth is disabled'))).toMatch(/Включите/)
  })
})

import { ELMError, type Transport } from '@/services/ELMService'

/** Фейковый ELM: ответ зависит от выбранного протокола; undefined — молчание (идёт поиск). */
function scriptedElm(respond: (proto: string, cmd: string) => string | undefined) {
  let cb: (s: string) => void = () => {}
  let proto = '0'
  const sent: string[] = []
  const t: Transport = {
    connect: async () => {}, close: async () => {},
    onData: (f) => { cb = f },
    write: async (data) => {
      const cmd = data.replace(/\r/g, '').trim()
      sent.push(cmd)
      if (cmd.startsWith('ATSP')) proto = cmd.slice(4)
      const r = cmd === '' ? 'STOPPED' : cmd === 'ATDPN' ? 'A' + proto : cmd.startsWith('AT') ? 'OK' : respond(proto, cmd)
      if (r !== undefined) setTimeout(() => cb(r + '\r\r>'), 1)
    },
  }
  return { t, sent }
}
const fast = { host: '', port: 0, timeoutMs: 300, searchMs: 40, probeMs: 40 }

describe('Подключение к ЭБУ', () => {
  it('авто-поиск не нашёл ЭБУ → перебор протоколов, найденный запоминается', async () => {
    const { t, sent } = scriptedElm((p, c) => (c === '0100' ? (p === '5' ? '41 00 BE 3E B8 11' : 'UNABLE TO CONNECT') : 'NO DATA'))
    const progress: (string | null)[] = []
    const elm = new ELMService(t, fast)
    elm.onProgress = (m) => progress.push(m)
    await elm.connect()
    expect(elm.connected).toBe(true)
    expect(elm.protocol).toBe('5')
    expect(sent.filter((c) => c.startsWith('ATSP'))).toEqual(['ATSP0', 'ATSP5'])
    expect(progress.some((m) => m?.includes('ISO 14230'))).toBe(true)
  })

  it('адаптер молчит во время поиска → поиск прерывается, пробуем следующий протокол', async () => {
    const { t, sent } = scriptedElm((p, c) => (c === '0100' ? (p === '3' ? '41 00 BE 3E B8 11' : undefined) : undefined))
    const elm = new ELMService(t, fast)
    await elm.connect()
    expect(elm.protocol).toBe('3')
    expect(sent).toContain('') // отправлен bare CR для прерывания поиска
  })

  it('сохранённый протокол пробуется первым', async () => {
    const { t, sent } = scriptedElm((p, c) => (c === '0100' && p === '4' ? '41 00 BE 3E B8 11' : 'UNABLE TO CONNECT'))
    await new ELMService(t, { ...fast, protocol: '4' }).connect()
    expect(sent.filter((c) => c.startsWith('ATSP'))).toEqual(['ATSP4'])
  })

  it('ЭБУ не отвечает ни на одном протоколе → ошибка, а не «подключено»', async () => {
    const { t } = scriptedElm((_p, c) => (c === '0100' ? 'UNABLE TO CONNECT' : 'NO DATA'))
    const elm = new ELMService(t, fast)
    await expect(elm.connect()).rejects.toThrow(/ЭБУ не отвечает/)
    await expect(elm.connect()).rejects.toBeInstanceOf(ELMError)
    expect(elm.connected).toBe(false)
  })
})

import { isReadOnlyCommand } from '@/services/ELMService'

describe('Только чтение', () => {
  it('разрешены служебные AT и запросы на чтение', () => {
    for (const c of ['ATZ', 'ATE0', 'ATL0', 'ATH0', 'ATAT1', 'ATSP0', 'ATSP5', 'ATDPN', '0100', '010C', '0142', '03', '07', '0A', '0902', '0201 00', '']) {
      expect(isReadOnlyCommand(c), c).toBe(true)
    }
  })
  it('сброс ошибок, управление, запись и диагностические сессии заблокированы', () => {
    for (const c of ['04', '0400', '08', '0801', '05', '06', '10 03', '1003', '11 01', '14 FF 00', '27 01', '2E F1 90', '2F 01 02', '31 01', '3B 00', '3D 00', 'ATSH7E0', 'ATPP FF SV 00', 'ATWS', 'ATD', 'ATCAF0', 'ATBRD 23']) {
      expect(isReadOnlyCommand(c), c).toBe(false)
    }
  })
  it('send() не пропускает запрещённую команду в адаптер', async () => {
    const written: string[] = []
    const t: Transport = { connect: async () => {}, close: async () => {}, onData: () => {}, write: async (d) => { written.push(d) } }
    const elm = new ELMService(t, fast)
    await expect(elm.send('04')).rejects.toThrow(/только на чтение/)
    await expect(elm.send('2E F1 90 00')).rejects.toThrow(/заблокирована/)
    expect(written).toEqual([])
  })
  it('в сервисе больше нет метода сброса ошибок', () => {
    expect((ELMService.prototype as unknown as Record<string, unknown>).clearDtcs).toBeUndefined()
  })
})


describe('BLE: стабильность', () => {
  const okSvc = [svc('0000fff0-0000-1000-8000-00805f9b34fb', [['fff1', { notify: true }], ['fff2', { write: true }]])]
  const base = (): BleLike => ({
    connect: async () => {}, disconnect: async () => {}, getServices: async () => okSvc,
    startNotifications: async () => {}, stopNotifications: async () => {}, write: async () => {}, writeWithoutResponse: async () => {},
  })

  it('отмена во время подключения останавливает повторы и освобождает GATT', async () => {
    const log: string[] = []
    let t!: BleTransport
    const fake: BleLike = {
      ...base(),
      connect: async () => { log.push('connect'); void t.close(); throw new Error('status 133') },
      disconnect: async () => { log.push('disconnect') },
    }
    t = new BleTransport('x', fake, { retryMs: 1, scanMs: 1, settleMs: 0 })
    await expect(t.connect()).rejects.toThrow(/отменено/)
    expect(log.filter((l) => l === 'connect')).toHaveLength(1)
    expect(log).toContain('disconnect')
  })

  it('скан делается один раз, а не перед каждой попыткой', async () => {
    let scans = 0, n = 0
    const fake: BleLike = {
      ...base(),
      requestLEScan: async (_o, cb) => { scans++; setTimeout(() => cb({ device: { deviceId: 'x' } } as never), 1) },
      stopLEScan: async () => {},
      connect: async () => { if (++n < 3) throw new Error('status 133') },
    }
    await new BleTransport('x', fake, { retryMs: 1, settleMs: 0 }).connect()
    expect(scans).toBe(1)
  })

  it('потеря связи мгновенно обрывает ожидающую команду, а не ждёт таймаут', async () => {
    let dropped: (id: string) => void = () => {}
    const fake: BleLike = { ...base(), connect: async (_i, cb) => { dropped = cb ?? (() => {}) } }
    const elm = new ELMService(new BleTransport('x', fake, { settleMs: 0 }), { host: '', port: 0, timeoutMs: 5000 })
    elm.connected = true
    await (elm as unknown as { transport: BleTransport }).transport.connect()
    const p = elm.send('010C')
    const t0 = Date.now()
    dropped('x')
    await expect(p).rejects.toThrow(/потеряна/)
    expect(Date.now() - t0).toBeLessThan(500)
  })

  it('запоздалый ответ на прошлую команду не принимается за ответ на следующую', async () => {
    let cb: (s: string) => void = () => {}
    let first = true
    const t: Transport = {
      connect: async () => {}, close: async () => {}, onData: (f) => { cb = f },
      write: async (data) => {
        const cmd = data.replace(/\r/g, '').trim()
        if (cmd === '010C' && first) { first = false; setTimeout(() => cb('41 0C 1A F8\r\r>'), 120); return } // ответ опоздал
        if (cmd === 'ATI') setTimeout(() => cb('ELM327 v1.5\r\r>'), 160)
        else if (cmd === '010D') setTimeout(() => cb('41 0D 3C\r\r>'), 1)
        else if (cmd === '010C') setTimeout(() => cb('41 0C 0F A0\r\r>'), 1)
      },
    }
    const elm = new ELMService(t, { host: '', port: 0, timeoutMs: 60 })
    await expect(elm.readRpm()).rejects.toThrow(/Таймаут/)
    expect(await elm.readSpeed()).toBe(60) // не 1726/«41 0C…» из опоздавшего ответа
    expect(await elm.readRpm()).toBe(1000)
  })
})
