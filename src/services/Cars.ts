import { DEFAULT_OIL, type OilState } from './OilService'

/** Профиль автомобиля. Все поля, кроме id и названия, необязательны. */
export interface Car {
  id: string
  /** Как называть в приложении («Четвёрка», «Папина Нива»). */
  name: string
  make: string
  model: string
  year: number | null
  vin: string
  plate: string
  color: string
  body: string
  engineCode: string
  /** Рабочий объём, л. */
  displacementL: number | null
  powerHp: number | null
  fuel: 'АИ-92' | 'АИ-95' | 'АИ-98' | 'ДТ' | 'Газ' | ''
  transmission: string
  drive: string
  tankL: number | null
  /** Показание одометра на момент ввода, км. */
  odometerKm: number | null
  /** Значение счётчика приложения (trackedTotalKm) в момент ввода одометра — чтобы оценивать текущий пробег. */
  odometerTrackedAt: number
  oilSpec: string
  oilCapacityL: number | null
  tires: string
  notes: string
  /** Масло и пробег, учитываемый приложением — у каждой машины свои. */
  oil: OilState
  trackedTotalKm: number
}

export type CarPreset = Partial<Omit<Car, 'id' | 'oil' | 'trackedTotalKm' | 'odometerKm' | 'odometerTrackedAt'>> & { label: string }

/** Типовые характеристики для быстрого заполнения (можно поправить руками). */
export const CAR_PRESETS: CarPreset[] = [
  { label: 'ВАЗ-2104', name: 'Четвёрка', make: 'ВАЗ', model: '2104', body: 'универсал', engineCode: '21043 / 2104', displacementL: 1.5, powerHp: 72, fuel: 'АИ-92', transmission: 'МКПП-4/5', drive: 'задний', tankL: 39, oilSpec: '5W-30 / 10W-40, API SL', oilCapacityL: 3.5, tires: '175/70 R13' },
  { label: 'ВАЗ-2105', name: 'Пятёрка', make: 'ВАЗ', model: '2105', body: 'седан', engineCode: '2105', displacementL: 1.3, powerHp: 64, fuel: 'АИ-92', transmission: 'МКПП-4/5', drive: 'задний', tankL: 39, oilSpec: '10W-40, API SL', oilCapacityL: 3.75, tires: '165/80 R13' },
  { label: 'ВАЗ-2107', name: 'Семёрка', make: 'ВАЗ', model: '2107', body: 'седан', engineCode: '21067 / 2107', displacementL: 1.6, powerHp: 74, fuel: 'АИ-92', transmission: 'МКПП-5', drive: 'задний', tankL: 39, oilSpec: '10W-40, API SL', oilCapacityL: 3.75, tires: '175/70 R13' },
  { label: 'ВАЗ-2110', name: 'Десятка', make: 'ВАЗ', model: '2110', body: 'седан', engineCode: '2111 / 21124', displacementL: 1.6, powerHp: 82, fuel: 'АИ-92', transmission: 'МКПП-5', drive: 'передний', tankL: 43, oilSpec: '5W-40, API SL', oilCapacityL: 3.5, tires: '175/65 R14' },
  { label: 'ВАЗ-2114', name: 'Самара-2', make: 'ВАЗ', model: '2114', body: 'хэтчбек', engineCode: '21114 / 21124', displacementL: 1.6, powerHp: 82, fuel: 'АИ-92', transmission: 'МКПП-5', drive: 'передний', tankL: 43, oilSpec: '5W-40, API SL', oilCapacityL: 3.5, tires: '175/65 R14' },
  { label: 'ВАЗ-2121 Нива', name: 'Нива', make: 'ВАЗ', model: '2121 Нива', body: 'внедорожник', engineCode: '21213 / 21214', displacementL: 1.7, powerHp: 83, fuel: 'АИ-92', transmission: 'МКПП-5', drive: 'полный', tankL: 42, oilSpec: '10W-40, API SL', oilCapacityL: 3.75, tires: '175/80 R16' },
  { label: 'Lada Granta', name: 'Гранта', make: 'LADA', model: 'Granta', body: 'седан', engineCode: '11186 / 21127', displacementL: 1.6, powerHp: 87, fuel: 'АИ-92', transmission: 'МКПП-5', drive: 'передний', tankL: 50, oilSpec: '5W-40, API SL', oilCapacityL: 3.5, tires: '175/65 R14' },
  { label: 'Lada Kalina', name: 'Калина', make: 'LADA', model: 'Kalina', body: 'хэтчбек', engineCode: '11183 / 21126', displacementL: 1.6, powerHp: 81, fuel: 'АИ-92', transmission: 'МКПП-5', drive: 'передний', tankL: 50, oilSpec: '5W-40, API SL', oilCapacityL: 3.5, tires: '175/65 R14' },
  { label: 'Lada Priora', name: 'Приора', make: 'LADA', model: 'Priora', body: 'седан', engineCode: '21126', displacementL: 1.6, powerHp: 98, fuel: 'АИ-95', transmission: 'МКПП-5', drive: 'передний', tankL: 43, oilSpec: '5W-40, API SL', oilCapacityL: 3.5, tires: '185/65 R14' },
]

let seq = 0
export function newCar(init: Partial<Car> = {}): Car {
  return {
    id: `car${Date.now().toString(36)}${(seq++).toString(36)}`,
    name: 'Моя машина', make: '', model: '', year: null, vin: '', plate: '', color: '', body: '',
    engineCode: '', displacementL: null, powerHp: null, fuel: '', transmission: '', drive: '',
    tankL: null, odometerKm: null, odometerTrackedAt: 0, oilSpec: '', oilCapacityL: null, tires: '', notes: '',
    oil: { ...DEFAULT_OIL }, trackedTotalKm: 0,
    ...init,
  }
}

export function carTitle(c: Car): string {
  const model = [c.make, c.model].filter(Boolean).join(' ')
  return c.name && model && c.name !== model ? `${c.name} · ${model}` : c.name || model || 'Автомобиль'
}

/** Короткая подпись для шапки. */
export function carShort(c: Car): string {
  return (c.name || [c.make, c.model].filter(Boolean).join(' ') || 'Автомобиль').toUpperCase()
}

/** Оценка текущего показания одометра: введённое значение + пробег, намеренный приложением после ввода. */
export function currentOdometer(c: Car): number | null {
  if (c.odometerKm == null || !Number.isFinite(c.odometerKm)) return null
  return c.odometerKm + Math.max(0, c.trackedTotalKm - (c.odometerTrackedAt ?? 0))
}
