import { describe, expect, it } from 'vitest'
import { carHint, knowledgeFor } from '@/data/carKnowledge'
import { BUILTIN_SENSORS } from '@/data/sensors'
import { CAR_PRESETS, newCar } from '@/services/Cars'
import { compileFormula } from '@/services/Formula'
import { decodeVin } from '@/services/Vin'

describe('Kia Rio 2', () => {
  const preset = CAR_PRESETS.find((p) => p.model === 'Rio')!
  it('шаблон профиля даёт машину, для которой есть база знаний', () => {
    const { label: _l, ...rest } = preset
    const car = newCar(rest)
    expect(knowledgeFor(car)?.id).toBe('kia-rio-jb')
    expect(carHint(knowledgeFor(car), 'P0301')).toMatch(/катушк/)
    expect(carHint(knowledgeFor(car), 'P0303')).toMatch(/катушка/)
    expect(carHint(knowledgeFor(car), 'P0705')).toMatch(/A4CF1/)
    expect(carHint(knowledgeFor(car), 'P9999')).toBeNull()
  })
  it('для ВАЗ подсказок Kia нет', () => {
    expect(knowledgeFor(newCar({ make: 'ВАЗ', model: '2104' }))).toBeNull()
  })
  it('VIN распознаётся: Россия, Автотор, модельный год 2012 (10-й знак C)', () => {
    const v = decodeVin('XWEDH411BC0010941', 2026)
    expect(v.valid).toBe(true)
    expect(v.maker).toMatch(/Автотор/)
    expect(v.year).toBe(2012)
  })
  it('новые датчики: формулы по примерам со скриншота', () => {
    const f = (id: string, b: number[]) => compileFormula(BUILTIN_SENSORS.find((s) => s.id === id)!.formula!)(b)
    expect(f('fuelrate', [0, 13])).toBeCloseTo(0.65, 2)
    expect(f('cattemp', [0x0d, 0x6a])).toBeCloseTo(303.4, 1)
    expect(f('distclr', [0x2f, 0xd7])).toBe(12247)
    expect(new Set(BUILTIN_SENSORS.map((s) => s.id)).size).toBe(BUILTIN_SENSORS.length)
  })
})
