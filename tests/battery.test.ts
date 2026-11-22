import { describe, expect, it } from 'vitest'
import { batteryReport, BatteryTracker, chargeLevel, parseAdapterVoltage, REST_AFTER_MS, restLevel, type BatteryEvent } from '@/services/Battery'
import { ELMService, isReadOnlyCommand, MockTransport } from '@/services/ELMService'

describe('аккумулятор', () => {
  it('покой при подключении к стоящей машине', () => {
    const b = new BatteryTracker(0)
    expect(b.feed({ t: 1000, rpm: null, volt: 12.55 })).toEqual({ t: 1000, kind: 'rest', v: 12.55 })
    // Повтор не раньше чем через 30 минут.
    expect(b.feed({ t: 2000, rpm: null, volt: 12.5 })).toBeNull()
  })

  it('после поездки покой — только через 5 минут', () => {
    const b = new BatteryTracker(0)
    b.feed({ t: 0, rpm: 900, volt: 14.1 })
    expect(b.feed({ t: 60_000, rpm: 0, volt: 12.9 })).toBeNull()
    expect(b.feed({ t: REST_AFTER_MS + 1000, rpm: 0, volt: 12.7 })?.kind).toBe('rest')
  })

  it('зарядка — медиана после минуты на оборотах', () => {
    const b = new BatteryTracker(0)
    const out: unknown[] = []
    for (let t = 0; t <= 70_000; t += 5000) out.push(b.feed({ t, rpm: 2000, volt: t === 50_000 ? 11 : 14.2 }))
    const ev = out.filter(Boolean)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ kind: 'charge', v: 14.2 })
  })

  it('оценки', () => {
    expect(restLevel(12.7).level).toBe('ok')
    expect(restLevel(12.45).level).toBe('warn')
    expect(restLevel(12.1).level).toBe('bad')
    expect(chargeLevel(14.1).level).toBe('ok')
    expect(chargeLevel(13.0).level).toBe('bad')
    expect(chargeLevel(15.2).level).toBe('bad')
  })

  it('тренд напряжения покоя', () => {
    const ev: BatteryEvent[] = Array.from({ length: 10 }, (_, i) => ({ t: i, kind: 'rest', v: i < 5 ? 12.7 : 12.4 }))
    const r = batteryReport(ev)
    expect(r.restTrend).toBeCloseTo(-0.3)
    expect(r.rest?.level).toBe('warn')
  })

  it('ATRV разрешён и разбирается', async () => {
    expect(isReadOnlyCommand('ATRV')).toBe(true)
    expect(parseAdapterVoltage('12.4V')).toBe(12.4)
    expect(parseAdapterVoltage('?')).toBeNull()
    const elm = new ELMService(new MockTransport(), { host: '', port: 0, timeoutMs: 500 })
    expect(await elm.readAdapterVoltage()).toBe(12.5)
  })
})
