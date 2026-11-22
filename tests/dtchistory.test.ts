import { describe, expect, it } from 'vitest'
import { addScan, codeStats, goneSince, scansFor, trends, type DtcScan } from '@/services/DtcHistory'
import { parseSinceClear, parseStatus, readiness, recentlyCleared } from '@/services/EcuStatus'
import { ELMService, MockTransport } from '@/services/ELMService'

const scan = (at: number, stored: string[], pending: string[] = [], extra: Partial<DtcScan> = {}): DtcScan => ({
  id: `s${at}`, carId: 'a', at, odometerKm: null, stored, pending, milOn: null, ...extra,
})

describe('история чтений', () => {
  it('новая, повтор, вернулась', () => {
    const h = [scan(1, ['P0171']), scan(2, ['P0300']), scan(3, ['P0300', 'P0171', 'P0420'])]
    expect(trends(h, h[2])).toEqual({ P0300: 'repeat', P0171: 'returned', P0420: 'new' })
    expect(goneSince(h, h[1])).toEqual(['P0171'])
  })

  it('после сброса код считается вернувшимся, а не повтором', () => {
    const h = [scan(1, ['P0171']), scan(2, ['P0171'], [], { cleared: true }), scan(3, ['P0171'])]
    expect(trends(h, h[2])).toEqual({ P0171: 'returned' })
  })

  it('лимит на машину и разделение демо', () => {
    let l: DtcScan[] = []
    for (let i = 0; i < 5; i++) l = addScan(l, scan(i, []), 3)
    l = addScan(l, { ...scan(10, []), carId: 'b' }, 3)
    expect(scansFor(l, 'a')).toHaveLength(3)
    expect(scansFor(l, 'a')[0].at).toBe(2)
    expect(scansFor([...l, scan(20, [], [], { demo: true })], 'a', true)).toHaveLength(1)
  })

  it('частые коды', () => {
    const st = codeStats([scan(1, ['P0171']), scan(2, ['P0171', 'P0300']), scan(3, ['P0171'], [], { cleared: true })])
    expect(st[0]).toMatchObject({ code: 'P0171', times: 2 })
  })
})

describe('тесты готовности', () => {
  // B=0x07: все непрерывные поддерживаются и завершены; C=0xE5 поддерживаются 5 тестов; D — какие не завершены.
  it('все завершены — готов', () => {
    expect(readiness(parseStatus([0x00, 0x07, 0xe5, 0x00], null))).toMatchObject({ ready: true, incomplete: [], level: 'ok' })
  })
  it('много незавершённых — не готов, и это признак сброса', () => {
    const rd = readiness(parseStatus([0x00, 0x07, 0xe5, 0xe5], null))
    expect(rd?.ready).toBe(false)
    expect(rd?.incomplete.length).toBe(5)
    const sc = parseSinceClear([2], [0, 15], [0, 30])
    expect(sc).toEqual({ warmups: 2, km: 15, minutes: 30 })
    expect(recentlyCleared(sc, rd)?.suspicious).toBe(true)
  })
  it('для машин до 2000 года допускается 2 незавершённых', () => {
    const st = parseStatus([0x00, 0x07, 0xe5, 0x05], null)
    expect(readiness(st, 2012)?.ready).toBe(false)
    expect(readiness(st, 1999)?.ready).toBe(true)
  })
  it('горит лампа — не готов', () => {
    expect(readiness(parseStatus([0x81, 0x07, 0xe5, 0x00], null))?.level).toBe('bad')
  })
  it('давний сброс не подозрителен', () => {
    expect(recentlyCleared(parseSinceClear([120], [0x30, 0x00], null), null)?.suspicious).toBe(false)
  })
})

describe('сброс ошибок', () => {
  const CFG = { host: '', port: 0, timeoutMs: 500 }
  it('send(04) по-прежнему заблокирован, clearDtcs стирает коды', async () => {
    const elm = new ELMService(new MockTransport({ dtcs: ['P0171'], pending: ['P0300'], lowMaf: false }), CFG)
    await expect(elm.send('04')).rejects.toThrow(/только на чтение/)
    expect(await elm.readDtcs()).toEqual(['P0171'])
    await elm.clearDtcs()
    expect(await elm.readDtcs()).toEqual([])
    expect(await elm.readPendingDtcs()).toEqual([])
    const st = await elm.readStatus()
    expect(st?.mil).toBe(false)
  })
  it('отказ ЭБУ (7F 04 22) даёт понятную ошибку', async () => {
    const t = new MockTransport()
    ;(t as unknown as { reply: (c: string) => string }).reply = () => '7F 04 22'
    const elm = new ELMService(t, CFG)
    await expect(elm.clearDtcs()).rejects.toThrow(/заглушите двигатель/)
  })
})

describe('признаки сброса', () => {
  it('все тесты пройдены и мало км, но много прогревов — не подозрительно', () => {
    const rd = readiness(parseStatus([0x00, 0x07, 0xe5, 0x00], null))
    expect(recentlyCleared(parseSinceClear([40], [0, 45], [0, 30]), rd)?.suspicious).toBe(false)
    expect(recentlyCleared(parseSinceClear([40], [0, 45], [0, 30]), rd)?.text).toMatch(/30 мин работы/)
  })
})
