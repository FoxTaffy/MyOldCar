/*
 * Справочник кодов неисправностей OBD-II на русском: расшифровка, поиск, подсказка «что проверить».
 * Универсальные коды SAE J2012 (P0xxx, P2xxx, P34xx, U0xxx, часть B/C) и заводские P1xxx для ВАЗ/LADA
 * (Январь 5.1/7.2, Bosch M7.9.7, М73/М74). Данные — в dtcData.ts / dtcLists.ts.
 */
import { DTC_ENTRIES } from './dtcData'

export interface DtcInfo {
  code: string
  /** Описание из справочника или построенное по структуре кода. */
  title: string
  /** Найден ли код в справочнике (иначе описание общее). */
  known: boolean
  system: string
  kind: 'generic' | 'manufacturer'
  subsystem: string | null
}

const SYSTEMS: Record<string, string> = { P: 'Силовой агрегат (двигатель/трансмиссия)', B: 'Кузов', C: 'Шасси', U: 'Сеть/связь между блоками' }

const P_SUBSYSTEM: Record<string, string> = {
  '0': 'топливо и воздух, вспомогательные системы выбросов',
  '1': 'топливо и воздух',
  '2': 'топливо и воздух (цепи форсунок)',
  '3': 'система зажигания и пропуски',
  '4': 'вспомогательные системы контроля выбросов',
  '5': 'скорость, холостой ход, вспомогательные входы',
  '6': 'компьютер и выходные цепи',
  '7': 'трансмиссия',
  '8': 'трансмиссия',
  '9': 'трансмиссия',
  A: 'гибридная силовая установка',
}

const U_SUBSYSTEM: Record<string, string> = {
  '0': 'шины данных',
  '1': 'потеря связи с блоком',
  '2': 'потеря связи с блоком',
  '3': 'несовместимость программного обеспечения',
  '4': 'неверные данные от блока',
}

const CODE_RE = /^[PBCU][0-9A-F]{4}$/

/** Похоже ли на код неисправности (P0171, U0100…). */
export function isDtcCode(raw: string): boolean {
  return CODE_RE.test(normalizeDtc(raw))
}

/**
 * Универсальный (SAE/ISO) или заводской. P0/P2 и P34–P39 — универсальные, P1 и P30–P33 — заводские;
 * у B/C/U универсальные — группы 0 и 3.
 */
function kindOf(code: string): 'generic' | 'manufacturer' {
  const d = code[1]
  if (d === '0') return 'generic'
  if (code[0] === 'P') {
    if (d === '2') return 'generic'
    return d === '3' && code[2] >= '4' ? 'generic' : 'manufacturer'
  }
  return d === '3' ? 'generic' : 'manufacturer'
}

export function normalizeDtc(code: string): string {
  return code.trim().toUpperCase()
}

/** Расшифровка любого кода: из справочника, а если там нет — по структуре (система, тип, подсистема). */
export function describeDtc(raw: string): DtcInfo {
  const code = normalizeDtc(raw)
  const kind = kindOf(code)
  const subsystem = (code[0] === 'P' ? P_SUBSYSTEM[code[2]] : code[0] === 'U' && code[1] === '0' ? U_SUBSYSTEM[code[2]] : null) ?? null
  const system = SYSTEMS[code[0]] ?? 'Неизвестная система'
  const text = DTC_ENTRIES.get(code)
  if (text) return { code, title: text, known: true, system, kind, subsystem }
  const what = kind === 'generic' ? 'универсальный код OBD-II' : 'заводской код производителя'
  const sub = subsystem ? `, подсистема: ${subsystem}` : ''
  return {
    code,
    title: `Код ${code} — ${what}${sub}. Точной расшифровки в справочнике нет`,
    known: false, system, kind, subsystem,
  }
}

/**
 * Что проверять в первую очередь — по виду неисправности в тексте расшифровки.
 * Это общая логика поиска (обрыв / замыкание / неправдоподобный сигнал), а не диагноз.
 */
export function dtcAdvice(raw: string): string {
  const info = describeDtc(raw)
  const t = info.title.toLowerCase()
  if (!info.known) {
    return info.kind === 'manufacturer'
      ? 'Заводской код: точное значение зависит от блока управления — смотрите документацию на свой ЭБУ.'
      : 'Уточните расшифровку по SAE J2012 или документации производителя.'
  }
  if (/пропуски зажигания/.test(t)) return 'Проверьте свечи, высоковольтные провода и катушку (модуль) этого цилиндра, затем форсунку и компрессию. Переставьте свечу/катушку на другой цилиндр — если пропуск «переехал», виновата она.'
  if (/бедная смесь|смесь бедная/.test(t)) return 'Ищите подсос воздуха после ДМРВ, проверьте давление топлива и чистоту ДМРВ; посмотрите долговременную коррекцию на панели.'
  if (/богатая смесь|смесь богатая/.test(t)) return 'Проверьте давление топлива и регулятор, льющие форсунки, клапан адсорбера, ДМРВ и датчик температуры ОЖ.'
  if (/потеря связи|шина|bus off|неверные данные/.test(t)) return 'Проверьте питание и массу названного блока, предохранители, разъёмы и провода шины CAN (обрыв, замыкание, окислы).'
  if (/контроллер \(эбу\)|блок управления/.test(t) && /памят|озу|пзу|eeprom|процессор/.test(t)) return 'Проверьте питание и массу ЭБУ, напряжение бортсети и клеммы АКБ. Если код возвращается после сброса питания — нужна диагностика самого блока.'
  if (/перемежающ|нестабил/.test(t)) return 'Плавающий контакт: при работающем двигателе пошевелите жгут и разъём узла, проверьте окислы в колодке и надёжность массы.'
  if (/обрыв/.test(t) && !/замыкание/.test(t)) return 'Прозвоните цепь от разъёма узла до ЭБУ, проверьте контакты колодки и сопротивление самого узла.'
  if (/высокий (уровень )?сигнал|высокий уровень|высокое напряжение|замыкание на (питание|бортсеть|\+)/.test(t)) return 'Проверьте цепь на обрыв и замыкание на питание, контакт массы узла, затем сам узел.'
  if (/низкий (уровень )?сигнал|низкий уровень|низкое напряжение|замыкание на массу/.test(t)) return 'Проверьте питание узла и цепь на замыкание на массу (перетёртый жгут), затем сам узел.'
  if (/вне (допустимого )?диапазона|не соответств|не совпада|не согласован/.test(t)) return 'Сигнал есть, но неправдоподобный: сравните показания с реальными на панели, проверьте загрязнение, механику и крепление узла.'
  if (/заклинил|завис|не срабатывает|не выключается|не включается/.test(t)) return 'Проверьте механику узла (закоксовка, заедание) и его питание; подайте управление и убедитесь, что узел срабатывает.'
  if (/утечка|подсос/.test(t)) return 'Ищите негерметичность: шланги, прокладки, крышку бака; надёжнее всего — дымогенератором.'
  if (/эффективность/.test(t)) return 'Сначала исключите пропуски зажигания, подсос воздуха в выпуске и неисправность лямбда-зондов, только потом меняйте дорогой узел.'
  return 'Проверьте цепь указанного узла (разъём, проводка, питание/масса), затем сам узел. После ремонта смотрите, возвращается ли код.'
}

const SORTED_CODES = [...DTC_ENTRIES.keys()].sort()
const SEARCH_INDEX = SORTED_CODES.map((code) => ({ code, text: (DTC_ENTRIES.get(code) ?? '').toLowerCase().replace(/ё/g, 'е') }))

/** Сколько кодов в справочнике. */
export const DTC_COUNT = SORTED_CODES.length

/** Все известные коды (для экрана-справочника). */
export function allDtcs(): DtcInfo[] {
  return SORTED_CODES.map(describeDtc)
}

export interface DtcSearchResult {
  items: DtcInfo[]
  /** Сколько всего кодов подошло (items обрезан по limit). */
  total: number
}

/**
 * Поиск по коду или словам описания. Несколько слов — все должны встретиться («форсунка 3», «лямбда подогрев»).
 * Сначала идут коды, начинающиеся с запроса, затем остальные совпадения.
 */
export function findDtcs(query: string, limit = 60): DtcSearchResult {
  const words = query.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean)
  if (!words.length) return { items: [], total: 0 }
  const first: string[] = []
  const rest: string[] = []
  // Короткое число («форсунка 3») — это номер цилиндра/датчика в описании, а не кусок кода P0213.
  const tests = words.map((w) => {
    if (!/^\d{1,2}$/.test(w)) return (lc: string, text: string) => lc.includes(w) || text.includes(w)
    const re = new RegExp(`(^|\\D)${w}(\\D|$)`)
    return (_lc: string, text: string) => re.test(text)
  })
  for (const { code, text } of SEARCH_INDEX) {
    const lc = code.toLowerCase()
    if (!tests.every((t) => t(lc, text))) continue
    if (lc.startsWith(words[0])) first.push(code)
    else rest.push(code)
  }
  const all = [...first, ...rest]
  return { items: all.slice(0, limit).map(describeDtc), total: all.length }
}

export function searchDtcs(query: string, limit = 60): DtcInfo[] {
  return findDtcs(query, limit).items
}
