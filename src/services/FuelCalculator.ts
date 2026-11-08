/** Стехиометрическое соотношение воздух:бензин. */
export const STOICH_AFR = 14.7
/** Плотность бензина, г/л (≈0.745 кг/л). */
export const GASOLINE_DENSITY_G_PER_L = 745

/** Мгновенный расход топлива, л/ч, по ДМРВ (г/с) в стехиометрии. */
export function fuelLitersPerHour(mafGs: number, afr = STOICH_AFR, density = GASOLINE_DENSITY_G_PER_L): number {
  if (!(mafGs > 0)) return 0
  const fuelGs = mafGs / afr
  return (fuelGs / density) * 3600
}

/**
 * Мгновенный расход, л/100 км. На скорости < minSpeed (стоянка/холостой ход)
 * л/100км не определён — возвращаем null, UI показывает л/ч.
 */
export function fuelLitersPer100Km(mafGs: number, speedKmh: number, minSpeed = 3): number | null {
  if (!(speedKmh >= minSpeed)) return null
  return (fuelLitersPerHour(mafGs) / speedKmh) * 100
}

/** Сглаживание экспоненциальным средним, чтобы цифра не прыгала. */
export class Ema {
  private value: number | null = null
  constructor(private readonly alpha = 0.2) {}
  push(x: number): number {
    this.value = this.value === null ? x : this.value + this.alpha * (x - this.value)
    return this.value
  }
  reset(): void {
    this.value = null
  }
}
