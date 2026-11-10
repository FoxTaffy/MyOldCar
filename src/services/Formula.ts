/** Безопасный разбор формул PID вида `(A*256+B)/4-40` без eval. Переменные A–D — байты ответа. */

export type Formula = (bytes: number[]) => number

type Tok = { t: 'num'; v: number } | { t: 'var'; i: number } | { t: 'op'; v: string }

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  const re = /\s*(?:(\d+(?:[.,]\d+)?)|([A-Da-d])|([-+*/()]))/y
  let pos = 0
  while (pos < src.length) {
    re.lastIndex = pos
    const m = re.exec(src)
    if (!m) {
      if (/^\s*$/.test(src.slice(pos))) break
      throw new Error(`Недопустимый символ в формуле: «${src.slice(pos).trim()[0]}»`)
    }
    pos = re.lastIndex
    if (m[1]) out.push({ t: 'num', v: parseFloat(m[1].replace(',', '.')) })
    else if (m[2]) out.push({ t: 'var', i: m[2].toUpperCase().charCodeAt(0) - 65 })
    else out.push({ t: 'op', v: m[3] })
  }
  return out
}

/** Компилирует формулу в функцию. Бросает Error при синтаксической ошибке. */
export function compileFormula(src: string): Formula {
  const toks = tokenize(src)
  if (!toks.length) throw new Error('Пустая формула')
  let p = 0
  type Node = (b: number[]) => number

  const peek = () => toks[p]
  const isOp = (v: string) => toks[p]?.t === 'op' && (toks[p] as { v: string }).v === v

  function primary(): Node {
    const tk = toks[p++]
    if (!tk) throw new Error('Формула оборвана')
    if (tk.t === 'num') { const v = tk.v; return () => v }
    if (tk.t === 'var') { const i = tk.i; return (b) => b[i] ?? NaN }
    if (tk.v === '(') {
      const e = expr()
      if (!isOp(')')) throw new Error('Нет закрывающей скобки')
      p++
      return e
    }
    if (tk.v === '-') { const e = primary(); return (b) => -e(b) }
    if (tk.v === '+') return primary()
    throw new Error(`Неожиданный знак «${tk.v}»`)
  }
  function term(): Node {
    let l = primary()
    while (isOp('*') || isOp('/')) {
      const op = (toks[p++] as { v: string }).v
      const r = primary()
      const a = l
      l = op === '*' ? (b) => a(b) * r(b) : (b) => a(b) / r(b)
    }
    return l
  }
  function expr(): Node {
    let l = term()
    while (isOp('+') || isOp('-')) {
      const op = (toks[p++] as { v: string }).v
      const r = term()
      const a = l
      l = op === '+' ? (b) => a(b) + r(b) : (b) => a(b) - r(b)
    }
    return l
  }

  const root = expr()
  if (peek()) throw new Error('Лишние символы в конце формулы')
  return (bytes) => {
    const v = root(bytes)
    return Number.isFinite(v) ? v : NaN
  }
}
