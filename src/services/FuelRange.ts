import type { Expense } from './Expenses'

/**
 * Запас хода: сколько ещё можно проехать на том, что в баке.
 * Литры в баке — по датчику уровня (PID 2F) и объёму бака, а если датчика нет — от последней заправки «до полного»:
 * объём бака минус расход на пройденные с неё километры. Расход — средний по заправкам или поездкам.
 */
export interface FuelRange {
  litersLeft: number
  km: number
  /** Откуда взяты литры. */
  source: 'sensor' | 'fill'
  l100: number
  /** Мало топлива: меньше 50 км или 10 % бака. */
  low: boolean
}

export function fuelRange(opts: {
  tankL: number | null
  levelPct: number | null
  l100: number | null
  odometerKm: number | null
  fills: Expense[]
}): FuelRange | null {
  const { tankL, levelPct, l100, odometerKm, fills } = opts
  if (!tankL || tankL <= 0 || !l100 || l100 <= 0) return null
  let litersLeft: number | null = null
  let source: FuelRange['source'] = 'sensor'
  if (levelPct != null && levelPct >= 0 && levelPct <= 100) {
    litersLeft = (levelPct / 100) * tankL
  } else if (odometerKm != null) {
    const last = fills
      .filter((e) => e.cat === 'fuel' && e.full && e.odometerKm != null && e.odometerKm <= odometerKm)
      .sort((a, b) => (b.odometerKm as number) - (a.odometerKm as number))[0]
    if (last) {
      // Доливы после полного бака тоже в баке.
      const topUps = fills.filter((e) => e.cat === 'fuel' && !e.full && e.liters && e.odometerKm != null && e.odometerKm > (last.odometerKm as number) && e.odometerKm <= odometerKm)
      const added = topUps.reduce((s, e) => s + (e.liters as number), 0)
      const used = ((odometerKm - (last.odometerKm as number)) * l100) / 100
      litersLeft = Math.min(tankL, Math.max(0, tankL + added - used))
      source = 'fill'
    }
  }
  if (litersLeft == null) return null
  const km = (litersLeft / l100) * 100
  return { litersLeft, km, source, l100, low: km < 50 || litersLeft < tankL * 0.1 }
}
