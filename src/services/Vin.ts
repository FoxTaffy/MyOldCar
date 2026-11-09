/* VIN: проверка, офлайн-расшифровка и разбор текста, считанного сканером/камерой. */

export interface VinInfo {
  vin: string
  valid: boolean
  /** Проверка контрольной цифры (поз. 9). Обязательна только в Северной Америке/Китае. */
  checkDigitOk: boolean
  wmi: string
  country: string | null
  maker: string | null
  /** Модельный год по 10-му знаку (может быть неоднозначным: цикл 30 лет). */
  year: number | null
  plantCode: string
  serial: string
  problems: string[]
}

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export function checkDigit(vin: string): string {
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const c = vin[i]
    sum += (/\d/.test(c) ? Number(c) : TRANSLIT[c] ?? 0) * WEIGHTS[i]
  }
  const r = sum % 11
  return r === 10 ? 'X' : String(r)
}

/** Знаки модельного года: A..Y без I,O,Q,U,Z и 1..9 (цикл 30 лет, 1980 → 2010 → 2040). */
const YEAR_CHARS = 'ABCDEFGHJKLMNPRSTVWXY123456789'

export function modelYear(ch: string, now = new Date().getFullYear()): number | null {
  const i = YEAR_CHARS.indexOf(ch)
  if (i < 0) return null
  // Выбираем самый поздний год цикла, не позже следующего года (модельный год может опережать календарный).
  let y = 1980 + i
  while (y + 30 <= now + 1) y += 30
  return y
}

const COUNTRIES: [string, string][] = [
  ['X3', 'Россия'], ['X4', 'Россия'], ['X5', 'Россия'], ['X6', 'Россия'], ['X7', 'Россия'], ['X8', 'Россия'], ['X9', 'Россия'], ['XT', 'Россия'], ['XU', 'Россия'], ['XW', 'Россия'], ['XL', 'Нидерланды'],
  ['Y3', 'Беларусь'], ['Y6', 'Украина'], ['Z6', 'Россия'], ['Z7', 'Россия'], ['Z8', 'Россия'], ['Z9', 'Россия'], ['ZA', 'Италия'], ['ZF', 'Италия'],
  ['WA', 'Германия'], ['WB', 'Германия'], ['WD', 'Германия'], ['WF', 'Германия'], ['WV', 'Германия'], ['W0', 'Германия'],
  ['VF', 'Франция'], ['VS', 'Испания'], ['VN', 'Франция'],
  ['SA', 'Великобритания'], ['SB', 'Великобритания'], ['SJ', 'Великобритания'],
  ['TM', 'Чехия'], ['TR', 'Венгрия'], ['TS', 'Венгрия'], ['UU', 'Румыния'],
  ['JH', 'Япония'], ['JM', 'Япония'], ['JN', 'Япония'], ['JS', 'Япония'], ['JT', 'Япония'],
  ['KL', 'Южная Корея'], ['KM', 'Южная Корея'], ['KN', 'Южная Корея'],
  ['LS', 'Китай'], ['LV', 'Китай'], ['LF', 'Китай'], ['LB', 'Китай'], ['LG', 'Китай'], ['LH', 'Китай'], ['LJ', 'Китай'],
  ['MA', 'Индия'], ['MB', 'Индонезия'], ['MR', 'Таиланд'], ['PE', 'Малайзия'],
  ['1', 'США'], ['4', 'США'], ['5', 'США'], ['2', 'Канада'], ['3', 'Мексика'],
  ['6', 'Австралия'], ['9', 'Бразилия'], ['8', 'Аргентина/Чили'],
]

const MAKERS: [string, string][] = [
  ['XTA', 'АвтоВАЗ (LADA / ВАЗ)'], ['XTB', 'АвтоВАЗ (ЛАДА)'], ['XTH', 'ГАЗ'], ['XTT', 'УАЗ'], ['XTN', 'КАМАЗ'], ['XTC', 'КАМАЗ'], ['XTM', 'Москвич/АЗЛК'], ['XTY', 'ЛиАЗ'],
  ['XU6', 'ТагАЗ'], ['XUF', 'General Motors (Россия)'], ['XW8', 'Volkswagen Group Rus'], ['XWE', 'Автотор (Kia/Hyundai)'], ['XWB', 'UzAuto / Daewoo'],
  ['X7L', 'Renault Россия'], ['X7M', 'Hyundai (ТагАЗ)'], ['X9F', 'Ford (Россия)'], ['X9L', 'GM-АвтоВАЗ (Chevrolet Niva)'], ['XLB', 'Volvo (Нидерланды)'],
  ['Z8N', 'Nissan (Россия)'], ['Z94', 'Hyundai (Россия)'], ['Z8T', 'Peugeot-Citroen (Россия)'], ['Z7C', 'Isuzu/ГАЗ'],
  ['Y6D', 'ЗАЗ (Украина)'], ['Y6J', 'ЗАЗ/Богдан'], ['Y39', 'МАЗ'], ['Y3M', 'МАЗ'],
  ['WVW', 'Volkswagen'], ['WVG', 'Volkswagen SUV'], ['WAU', 'Audi'], ['WBA', 'BMW'], ['WBS', 'BMW M'], ['WDB', 'Mercedes-Benz'], ['WDD', 'Mercedes-Benz'], ['WF0', 'Ford (Германия)'], ['W0L', 'Opel'], ['WP0', 'Porsche'],
  ['VF1', 'Renault'], ['VF3', 'Peugeot'], ['VF7', 'Citroën'], ['SAL', 'Land Rover'], ['SAJ', 'Jaguar'],
  ['TMB', 'Škoda'], ['TRU', 'Audi (Венгрия)'], ['ZFA', 'Fiat'], ['ZAR', 'Alfa Romeo'],
  ['JTD', 'Toyota'], ['JTE', 'Toyota'], ['JHM', 'Honda'], ['JN1', 'Nissan'], ['JMZ', 'Mazda'], ['JS3', 'Suzuki'], ['JF1', 'Subaru'], ['JMB', 'Mitsubishi'],
  ['KMH', 'Hyundai'], ['KNA', 'Kia'], ['KND', 'Kia'], ['KLA', 'Daewoo/Chevrolet'],
  ['LSV', 'SAIC-VW'], ['LFV', 'FAW-VW'], ['LVS', 'Ford (Китай)'], ['LGX', 'BYD'], ['LGW', 'Great Wall'], ['LB3', 'Geely'], ['LVV', 'Chery'],
  ['1G1', 'Chevrolet'], ['1FA', 'Ford'], ['1HG', 'Honda'], ['2HG', 'Honda (Канада)'], ['5YJ', 'Tesla'],
]

/** Приводит ввод к виду VIN: верхний регистр, без пробелов/дефисов; I→1, O→0, Q→0 (в VIN этих букв не бывает). */
export function cleanVin(text: string): string {
  return text.toUpperCase().replace(/[\s\-_.:]/g, '').replace(/[IOQ]/g, (c) => (c === 'I' ? '1' : '0'))
}

/** Ищет VIN в произвольном тексте (QR/штрихкод/OCR): сначала строгое совпадение, потом через очистку. */
export function extractVin(text: string): string | null {
  const up = text.toUpperCase()
  const strict = up.match(/[A-HJ-NPR-Z0-9]{17}/)
  if (strict) return strict[0]
  const cleaned = cleanVin(text)
  const m = cleaned.match(/[A-HJ-NPR-Z0-9]{17}/)
  return m ? m[0] : null
}

export function decodeVin(input: string, now = new Date().getFullYear()): VinInfo {
  const vin = cleanVin(input)
  const problems: string[] = []
  if (vin.length !== 17) problems.push(`Длина ${vin.length} знаков, нужно 17`)
  else if (!VIN_CHARS.test(vin)) problems.push('Недопустимые символы (в VIN нет букв I, O, Q)')
  const shape = vin.length === 17 && VIN_CHARS.test(vin)
  const wmi = vin.slice(0, 3)
  const country = COUNTRIES.find(([p]) => wmi.startsWith(p))?.[1] ?? null
  const maker = MAKERS.find(([p]) => wmi === p)?.[1] ?? null
  const checkDigitOk = shape && checkDigit(vin) === vin[8]
  if (shape && !checkDigitOk) problems.push('Контрольная цифра не сходится (для российских и европейских VIN это нормально)')
  return {
    vin,
    valid: shape,
    checkDigitOk,
    wmi,
    country,
    maker,
    year: shape ? modelYear(vin[9], now) : null,
    plantCode: vin[10] ?? '',
    serial: vin.slice(11),
    problems,
  }
}
