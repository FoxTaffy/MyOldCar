import { describe, expect, it } from 'vitest'
import { diagnose } from '@/services/DiagnosticEngine'
import { parseDtcResponse, encodeDtc, parsePid } from '@/services/ELMService'
import { fuelLitersPer100Km, fuelLitersPerHour } from '@/services/FuelCalculator'
import { PerformanceTimer } from '@/services/PerformanceTimer'
import { DEFAULT_SETTINGS, type SensorSnapshot } from '@/types'

const idle = (mafGs: number): SensorSnapshot => ({ rpm: 850, speedKmh: 0, coolantTempC: 90, mafGs, timestamp: 0 })

describe('DiagnosticEngine', () => {
  it('P0171: низкий ДМРВ на холостом выводит подсос на первое место, сумма 100%', () => {
    const r = diagnose('p0171', idle(1.8), DEFAULT_SETTINGS)
    expect(r.causes[0].id).toBe('vacuum_leak')
    expect(r.causes.reduce((a, c) => a + c.probability, 0)).toBe(100)
    expect(r.causes[0].probability).toBeGreaterThan(50)
  })
  it('P0171: флаг «обслуживали топливные магистрали» поднимает давление топлива', () => {
    const base = diagnose('P0171', idle(2.6), DEFAULT_SETTINGS)
    const svc = diagnose('P0171', idle(2.6), { ...DEFAULT_SETTINGS, recentFuelServicing: true })
    const p = (r: typeof base) => r.causes.find((c) => c.id === 'fuel_pressure')!.probability
    expect(p(svc)).toBeGreaterThan(p(base))
    expect(svc.causes[0].id).toBe('fuel_pressure')
  })
  it('алиасы и неизвестные коды', () => {
    expect(diagnose('P0302', null, DEFAULT_SETTINGS).causes.length).toBeGreaterThan(1)
    expect(diagnose('P9999', null, DEFAULT_SETTINGS).causes[0].id).toBe('unknown')
  })
})

describe('ELM parsing', () => {
  it('DTC encode/decode', () => {
    expect(encodeDtc('P0171')).toBe('01 71')
    expect(parseDtcResponse('43 01 71 00 00 00 00')).toEqual(['P0171'])
    expect(parseDtcResponse('43 01 71 03 35 00 00')).toEqual(['P0171', 'P0335'])
    expect(parseDtcResponse('43 00 00 00 00 00 00')).toEqual([])
    expect(parseDtcResponse('4301710000')).toEqual(['P0171'])
  })
  it('PID', () => {
    expect(parsePid('41 0C 1A F8', '0C')).toEqual([0x1a, 0xf8])
  })
})

describe('Fuel', () => {
  it('расход ~ реалистичный', () => {
    // 2.5 г/с на холостом ≈ 0.82 л/ч
    expect(fuelLitersPerHour(2.5)).toBeCloseTo(0.82, 1)
    expect(fuelLitersPer100Km(16, 90)!).toBeCloseTo(5.84, 1)
    expect(fuelLitersPer100Km(10, 0)).toBeNull()
  })
})

describe('PerformanceTimer', () => {
  it('старт >0, финиш на 100 с интерполяцией', () => {
    const t = new PerformanceTimer()
    t.feed(0, 0, 850)
    expect(t.state).toBe('idle')
    t.feed(1000, 5, 3000)
    t.feed(5000, 60, 4000)
    t.feed(10000, 95, 4500)
    t.feed(11000, 105, 4800)
    expect(t.state).toBe('finished')
    expect(t.result!.durationMs).toBeCloseTo(9500, 0) // t0=1000; порог 100 посередине между 95 и 105
  })
  it('пробуксовка: RPM растёт, скорость стоит', () => {
    const t = new PerformanceTimer()
    t.feed(0, 10, 3000); t.feed(300, 10, 3400); t.feed(600, 10, 4000); t.feed(900, 100, 4000)
    expect(t.result!.warnings).toContain('Возможна пробуксовка сцепления')
  })
})

import { CapacitorTcpTransport, ELMService, type TcpPlugin } from '@/services/ELMService'

describe('CapacitorTcpTransport (подставной плагин)', () => {
  it('read-цикл доставляет ответ ELM и корректно останавливается', async () => {
    const inbox: string[] = []
    let closed = false
    const fake: TcpPlugin = {
      connect: async () => ({ client: 7 }),
      send: async ({ data }) => { inbox.push(data) },
      read: async () => {
        if (closed) throw Object.assign(new Error('closed'), { code: 'CLOSED' })
        if (inbox.length) {
          const cmd = inbox.shift()!.trim()
          return { result: cmd === '010D' ? '41 0D 3C\r\r>' : cmd === '0100' ? '41 00 BE 3E B8 11\r\r>' : 'OK\r\r>', encoding: 'utf8' }
        }
        await new Promise((r) => setTimeout(r, 5))
        throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' })
      },
      disconnect: async () => { closed = true },
    }
    const elm = new ELMService(new CapacitorTcpTransport({ host: 'x', port: 1, timeoutMs: 1000 }, fake), { host: 'x', port: 1, timeoutMs: 1000 })
    await elm.connect()
    expect(await elm.readSpeed()).toBe(60)
    await elm.disconnect()
    expect(closed).toBe(true)
  })
})
