/** Разбор ответов ELM327: коды ошибок, PID, VIN, стоп-кадр. Чистые функции без ввода-вывода. */
/* ------------------------------------------------------------------ */
/* Разбор ответов                                                      */
/* ------------------------------------------------------------------ */

const DTC_LETTER = ['P', 'C', 'B', 'U']

export function encodeDtc(code: string): string {
  const l = DTC_LETTER.indexOf(code[0])
  const first = (l << 2) | parseInt(code[1], 16)
  const b1 = (first << 4) | parseInt(code[2], 16)
  const b2 = parseInt(code.slice(3, 5), 16)
  return [b1, b2].map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

/**
 * Делит ответ адаптера на посылки в виде строк hex-цифр. Многокадровый ответ CAN (ISO-TP:
 * строка длины «00A», затем кадры «0: 43 04 …», «1: …») склеивается в одну посылку нужной длины.
 */
export function responseFrames(raw: string): string[] {
  const hex = (t: string) => t.replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
  const out: string[] = []
  let multi: string | null = null
  let total = 0
  for (const line of raw.split(/[\r\n]+/).map((l) => l.trim())) {
    if (!line) continue
    const frame = /^[0-9A-Fa-f]:\s*(.*)$/.exec(line)
    if (frame) { multi = (multi ?? '') + hex(frame[1]); continue }
    if (/^[0-9A-Fa-f]{3}$/.test(line)) { total = parseInt(line, 16); continue }
    out.push(hex(line))
  }
  if (multi != null) out.push(total ? multi.slice(0, total * 2) : multi)
  return out
}

export function dtcFromWord(word: string): string {
  const v = parseInt(word, 16)
  return `${DTC_LETTER[(v >> 14) & 3]}${(v >> 12) & 3}${(v & 0xfff).toString(16).toUpperCase().padStart(3, '0')}`
}

/**
 * Разбор ответа на режимы 03/07 → ['P0171', ...]. Понимает оба формата:
 * К-линия — «43 01 71 00 00 00 00» (пары байт, по строке на каждые 3 кода, допускается слитно);
 * CAN — «43 02 01 71 03 01» (после заголовка идёт байт количества кодов), в т.ч. многокадровый ответ.
 */
export function parseDtcResponse(raw: string, header = '43'): string[] {
  const codes: string[] = []
  for (const flat of responseFrames(raw)) {
    if (!flat.startsWith(header)) continue
    let body = flat.slice(2)
    let limit = Infinity
    // У CAN тело = 1 байт количества + пары байт, то есть нечётное число байт; у К-линии — всегда чётное.
    if ((body.length >> 1) % 2 === 1) {
      limit = parseInt(body.slice(0, 2), 16)
      body = body.slice(2)
    }
    for (let i = 0, n = 0; i + 4 <= body.length && n < limit; i += 4) {
      const word = body.slice(i, i + 4)
      if (word === '0000') continue
      codes.push(dtcFromWord(word))
      n++
    }
  }
  return [...new Set(codes)]
}

/**
 * Разбор ответа на 09 02: одной строкой «49 02 01 …» или кадрами ISO-TP «0: 49 02 01 …», «1: …».
 * Возвращает 17-символьный VIN или null.
 */
export function parseVinResponse(raw: string): string | null {
  let bytes = ''
  for (const line of raw.split(/[\r\n]+/)) {
    if (/^\s*[0-9A-Fa-f]{3}\s*$/.test(line)) continue // строка «014» — длина ответа ISO-TP
    const l = line.trim().replace(/^[0-9A-Fa-f]{1,3}:\s*/, '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
    if (!l) continue
    // Заголовок 4902 + номер 01 — в начале ответа (на К-линии — в начале каждой строки).
    bytes += l.startsWith('4902') ? l.slice(6) : l
  }
  let text = ''
  for (let i = 0; i + 2 <= bytes.length; i += 2) {
    const c = parseInt(bytes.slice(i, i + 2), 16)
    if (c >= 0x30 && c <= 0x5a) text += String.fromCharCode(c)
  }
  const m = text.match(/[A-HJ-NPR-Z0-9]{17}/)
  return m ? m[0] : null
}

/**
 * Возвращает байты данных после заголовка «41 xx» (mode — байт ответа: 41 для режима 01, 42 для режима 02).
 * Заголовок ищется только на границе байта, чтобы не принять за него середину данных.
 */
export function parsePid(raw: string, pid: string, mode = '41'): number[] | null {
  const marker = (mode + pid).toUpperCase()
  for (const flat of responseFrames(raw)) {
    for (let at = flat.indexOf(marker); at >= 0; at = flat.indexOf(marker, at + 1)) {
      if (at % 2) continue
      const out: number[] = []
      for (let i = at + marker.length; i + 2 <= flat.length; i += 2) out.push(parseInt(flat.slice(i, i + 2), 16))
      return out
    }
  }
  return null
}

/** Ответы адаптера, означающие «данных нет»: ЭБУ молчит, шина не поднялась, команда не понята. */
export const NO_ANSWER = /NO DATA|UNABLE|ERROR|STOPPED|BUFFER FULL|\?/i

/** Стоп-кадр (режим 02): условия работы двигателя в момент, когда ЭБУ записал ошибку. */
export interface FreezeFrame {
  /** Код, из-за которого сохранён кадр. */
  dtc: string
  rpm: number | null
  speedKmh: number | null
  coolantTempC: number | null
  loadPct: number | null
  throttlePct: number | null
  mafGs: number | null
  stft: number | null
  ltft: number | null
}
