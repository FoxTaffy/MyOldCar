import { describe, expect, it } from 'vitest'
import { newCar } from '@/services/Cars'
import { docStatus, plural, suggestUntil, type CarDoc } from '@/services/CarDocs'
import { dueReminders, freshReminders, plannedDocNotices } from '@/services/Reminders'

const doc = (untilISO: string, kind: CarDoc['kind'] = 'osago'): CarDoc => ({ id: 'd1', kind, title: 'ОСАГО', untilISO })
const NOW = new Date('2026-11-22T12:00:00')

describe('документы', () => {
  it('статус по дням', () => {
    expect(docStatus(doc('2026-12-31'), NOW, 14)).toMatchObject({ level: 'ok', daysLeft: 39 })
    expect(docStatus(doc('2026-12-01'), NOW, 14)).toMatchObject({ level: 'warn', text: 'Осталось 9 дней' })
    expect(docStatus(doc('2026-11-22'), NOW).level).toBe('bad')
    expect(docStatus(doc('2026-11-20'), NOW).text).toBe('Истёк 2 дня назад')
  })
  it('склонение', () => {
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n))).toEqual(['день', 'дня', 'дней', 'дней', 'день', 'дня', 'дней'])
  })
  it('предложенный срок', () => {
    expect(suggestUntil('osago', NOW)).toBe('2027-11-21')
    expect(suggestUntil('license', NOW)).toBe('2036-11-21')
    expect(suggestUntil('tax', NOW)).toBe('2026-12-01')
  })
})

describe('напоминания', () => {
  const car = newCar({ name: 'Четвёрка', make: 'ВАЗ', model: '2104' })
  car.oil = { dateISO: '2026-01-01', offsetKm: 0, trackedAtSet: 0, intervalKm: 10000 }
  car.trackedTotalKm = 9500
  car.docs = [doc('2026-11-30'), { ...doc('2027-06-01', 'to'), id: 'd2', title: 'Техосмотр' }]

  it('собирает масло и документ, которые подошли', () => {
    const r = dueReminders([car], 80, 14, NOW)
    expect(r.map((x) => x.key)).toEqual([`${car.id}:oil`, `${car.id}:doc:d1:2026-11-30`])
    expect(r[0].text).toMatch(/осталось 500 км/)
  })
  it('не повторяет чаще раза в неделю', () => {
    const r = dueReminders([car], 80, 14, NOW)
    const now = NOW.getTime()
    expect(freshReminders(r, { [r[0].key]: now - 86400000 }, now)).toHaveLength(1)
    expect(freshReminders(r, { [r[0].key]: now - 8 * 86400000 }, now)).toHaveLength(2)
  })
  it('планирует уведомления на будущие даты', () => {
    const p = plannedDocNotices([car], 14, NOW)
    // ОСАГО: заранее уже прошло, остаётся последний день; техосмотр: заранее и последний день.
    expect(p).toHaveLength(3)
    expect(p[0].at.toISOString().slice(0, 10)).toBe(new Date('2026-11-30T10:00:00').toISOString().slice(0, 10))
    expect(new Set(p.map((x) => x.id)).size).toBe(3)
  })
  it('пустой профиль новичка не напоминает', () => {
    expect(dueReminders([{ ...car, placeholder: true }], 80, 14, NOW)).toEqual([])
  })
})
