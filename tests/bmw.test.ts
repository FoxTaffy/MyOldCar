import { describe, expect, it } from 'vitest'
import { BRANDS, CATALOG } from '@/data/carCatalog'
import { carHint, knowledgeFor } from '@/data/carKnowledge'
import { CAR_PRESETS, newCar } from '@/services/Cars'
import { decodeVin } from '@/services/Vin'

describe('BMW E90 LCI 320i', () => {
  const preset = CAR_PRESETS.find((p) => p.make === 'BMW')!
  it('есть в справочнике и шаблонах', () => {
    expect(BRANDS).toContain('BMW')
    expect(CATALOG.BMW).toContain(preset.model)
  })
  it('для шаблона есть подсказки по кодам', () => {
    const { label: _l, ...rest } = preset
    const car = newCar({ ...rest, vin: 'X4XPG98469VK28030' })
    const k = knowledgeFor(car)
    expect(k?.id).toBe('bmw-e90')
    expect(carHint(k, 'P0301')).toMatch(/катушк/)
    expect(carHint(k, 'P0011')).toMatch(/VANOS/)
    expect(carHint(k, 'P1083')).toMatch(/BMW/)
    expect(carHint(k, 'U0100')).toMatch(/АКБ/)
    expect(knowledgeFor(newCar({ make: 'Kia', model: 'Rio' }))?.id).toBe('kia-rio-jb')
  })
  it('VIN распознаётся как BMW Автотор', () => {
    const v = decodeVin('X4XPG98469VK28030', 2026)
    expect(v.valid).toBe(true)
    expect(v.maker).toMatch(/BMW/)
    expect(v.country).toMatch(/Росс/)
  })
})
