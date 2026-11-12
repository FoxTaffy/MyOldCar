import { describe, expect, it } from 'vitest'
import { classifyMotion, estimateGear } from '../src/services/MotionState'

describe('classifyMotion', () => {
  it('OBD 60 км/ч и 2000 об/мин — едем', () => {
    const r = classifyMotion({ obdSpeed: 60, rpm: 2000, gpsSpeed: 0 })
    expect(r.kind).toBe('driving')
    expect(r.speed).toBe(60)
  })
  it('GPS дрейфует (6 км/ч) при 850 об/мин и OBD 0 — стоим', () => {
    expect(classifyMotion({ obdSpeed: 0, rpm: 850, gpsSpeed: 6 }).kind).toBe('idling')
  })
  it('нейтраль, обороты подняты, GPS 4 км/ч — стоим (обороты не сходятся со скоростью)', () => {
    expect(classifyMotion({ obdSpeed: null, rpm: 2500, gpsSpeed: 4 }).kind).toBe('idling')
  })
  it('OBD 0, GPS 40 км/ч, двигатель работает — датчик скорости врёт, едем по GPS', () => {
    const r = classifyMotion({ obdSpeed: 0, rpm: 2500, gpsSpeed: 40 })
    expect(r.kind).toBe('driving')
    expect(r.source).toBe('gps')
    expect(r.obdSpeedSuspect).toBe(true)
  })
  it('скорость есть, оборотов нет — накат', () => {
    expect(classifyMotion({ obdSpeed: 30, rpm: 0, gpsSpeed: 30 }).kind).toBe('coasting')
  })
  it('всё по нулям — заглушен', () => {
    expect(classifyMotion({ obdSpeed: 0, rpm: 0, gpsSpeed: 0 }).kind).toBe('parked')
  })
  it('только GPS, обороты неизвестны, 5 км/ч — верим GPS', () => {
    expect(classifyMotion({ obdSpeed: null, rpm: null, gpsSpeed: 5 }).kind).toBe('driving')
  })
  it('передача по отношению оборотов к скорости', () => {
    expect(estimateGear(2500, 20)).toBe(1)
    expect(estimateGear(2500, 80)).toBe(5)
    expect(estimateGear(900, 5)).toBeNull()
  })
})
