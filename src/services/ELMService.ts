import { registerPlugin } from '@capacitor/core'
import type { SensorSnapshot } from '@/types'

/* ------------------------------------------------------------------ */
/* Транспорт                                                           */
/* ------------------------------------------------------------------ */

/** Минимальный интерфейс канала связи с адаптером. */
export interface Transport {
  connect(): Promise<void>
  write(data: string): Promise<void>
  onData(cb: (chunk: string) => void): void
  close(): Promise<void>
}

export interface ElmConfig {
  host: string
  port: number
  /** Таймаут ответа на одну команду, мс. */
  timeoutMs: number
}

export const DEFAULT_ELM_CONFIG: ElmConfig = { host: '192.168.0.10', port: 35000, timeoutMs: 4000 }

/**
 * ELM327 Wi-Fi говорит по «сырому» TCP — браузерный WebSocket к нему напрямую не подключится.
 * В Capacitor нужен нативный TCP-плагин. Ниже — контракт, который он должен реализовать
 * (подойдёт любой плагин с такими методами/событием; имя плагина — 'TcpSocket').
 */
interface TcpSocketPlugin {
  connect(o: { ipAddress: string; port: number }): Promise<{ client: number }>
  send(o: { client: number; data: string }): Promise<void>
  disconnect(o: { client: number }): Promise<void>
  addListener(
    event: 'data',
    cb: (e: { client: number; data: string }) => void,
  ): Promise<{ remove: () => Promise<void> }>
}

export class CapacitorTcpTransport implements Transport {
  private plugin = registerPlugin<TcpSocketPlugin>('TcpSocket')
  private client = -1
  private cb: (chunk: string) => void = () => {}
  private handle: { remove: () => Promise<void> } | null = null

  constructor(private readonly cfg: ElmConfig) {}

  async connect(): Promise<void> {
    const { client } = await this.plugin.connect({ ipAddress: this.cfg.host, port: this.cfg.port })
    this.client = client
    this.handle = await this.plugin.addListener('data', (e) => {
      if (e.client === this.client) this.cb(e.data)
    })
  }
  write(data: string): Promise<void> {
    return this.plugin.send({ client: this.client, data })
  }
  onData(cb: (chunk: string) => void): void {
    this.cb = cb
  }
  async close(): Promise<void> {
    await this.handle?.remove()
    if (this.client >= 0) await this.plugin.disconnect({ client: this.client })
    this.client = -1
  }
}

/** WebSocket-вариант: для ELM-адаптеров/прокси, которые выставляют ws:// мост. */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null
  private cb: (chunk: string) => void = () => {}
  constructor(private readonly cfg: ElmConfig) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.cfg.host}:${this.cfg.port}`)
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('WebSocket: не удалось подключиться'))
      ws.onmessage = (e) => this.cb(typeof e.data === 'string' ? e.data : '')
      this.ws = ws
    })
  }
  async write(data: string): Promise<void> {
    this.ws?.send(data)
  }
  onData(cb: (chunk: string) => void): void {
    this.cb = cb
  }
  async close(): Promise<void> {
    this.ws?.close()
  }
}

/* ------------------------------------------------------------------ */
/* Mock-транспорт: имитация ЭБУ для разработки в браузере              */
/* ------------------------------------------------------------------ */

export interface MockOptions {
  dtcs: string[]
  /** Имитировать «подсос воздуха»: низкий ДМРВ на холостом. */
  lowMaf: boolean
}

export class MockTransport implements Transport {
  private cb: (chunk: string) => void = () => {}
  private t0 = Date.now()
  constructor(private readonly opts: MockOptions = { dtcs: ['P0171'], lowMaf: true }) {}

  async connect(): Promise<void> {
    this.t0 = Date.now()
  }
  onData(cb: (chunk: string) => void): void {
    this.cb = cb
  }
  async close(): Promise<void> {}

  async write(data: string): Promise<void> {
    const cmd = data.replace(/[\r\n\s]/g, '').toUpperCase()
    setTimeout(() => this.cb(this.reply(cmd) + '\r\r>'), 15)
  }

  /** Простая цикличная «поездка»: 0→110 км/ч за ~18 с, потом пауза на холостом. */
  private sim(): { rpm: number; speed: number; temp: number; maf: number } {
    const t = ((Date.now() - this.t0) / 1000) % 40
    const speed = t < 3 ? 0 : t < 21 ? Math.min(110, (t - 3) * 6.1) : t < 30 ? Math.max(0, 110 - (t - 21) * 12.2) : 0
    const gear = Math.min(5, Math.floor(speed / 22) + 1)
    const rpm = speed < 1 ? 850 + Math.sin(t * 3) * 25 : 900 + (speed % 22) * 85 + gear * 120
    const idle = speed < 1
    const maf = idle ? (this.opts.lowMaf ? 1.8 : 2.6) : 2.5 + speed * 0.13 + (rpm - 900) * 0.0035
    const temp = Math.min(92, 70 + (Date.now() - this.t0) / 2500)
    return { rpm, speed, temp, maf }
  }

  private reply(cmd: string): string {
    if (cmd.startsWith('AT')) return cmd === 'ATZ' ? 'ELM327 v1.5' : 'OK'
    const s = this.sim()
    const hex = (n: number, bytes: number) =>
      Math.max(0, Math.round(n)).toString(16).toUpperCase().padStart(bytes * 2, '0').replace(/(..)/g, '$1 ').trim()
    switch (cmd) {
      case '010C': return `41 0C ${hex(s.rpm * 4, 2)}`
      case '010D': return `41 0D ${hex(s.speed, 1)}`
      case '0105': return `41 05 ${hex(s.temp + 40, 1)}`
      case '0110': return `41 10 ${hex(s.maf * 100, 2)}`
      case '03': {
        if (!this.opts.dtcs.length) return '43 00 00 00 00 00 00'
        const bytes = this.opts.dtcs.map(encodeDtc).join(' ')
        return `43 ${bytes}`
      }
      case '04': this.opts.dtcs = []; return '44'
      default: return 'NO DATA'
    }
  }
}

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

/** Разбор ответа на режим 03 → ['P0171', ...]. Устойчив к переносам строк и «43» в начале каждой строки. */
export function parseDtcResponse(raw: string): string[] {
  const codes: string[] = []
  for (const line of raw.split(/[\r\n]+/)) {
    const bytes = line.replace(/[^0-9A-Fa-f]/g, ' ').trim().split(/\s+/).filter(Boolean)
    // Допускаем и «43 01 71…», и склеенное «4301710000…».
    const flat = bytes.join('')
    if (!flat.startsWith('43')) continue
    const body = flat.slice(2)
    for (let i = 0; i + 4 <= body.length; i += 4) {
      const word = body.slice(i, i + 4)
      if (word === '0000') continue
      const v = parseInt(word, 16)
      const letter = DTC_LETTER[(v >> 14) & 3]
      const d1 = (v >> 12) & 3
      codes.push(`${letter}${d1}${(v & 0xfff).toString(16).toUpperCase().padStart(3, '0')}`)
    }
  }
  return [...new Set(codes)]
}

/** Возвращает байты данных после заголовка «41 xx». */
export function parsePid(raw: string, pid: string): number[] | null {
  const flat = raw.replace(/[^0-9A-Fa-f]/g, '')
  const marker = '41' + pid.toUpperCase()
  const at = flat.toUpperCase().indexOf(marker)
  if (at < 0) return null
  const out: number[] = []
  const data = flat.slice(at + marker.length)
  for (let i = 0; i + 2 <= data.length; i += 2) out.push(parseInt(data.slice(i, i + 2), 16))
  return out
}

/* ------------------------------------------------------------------ */
/* Сервис                                                              */
/* ------------------------------------------------------------------ */

export class ELMError extends Error {}

export class ELMService {
  private buffer = ''
  private pending: { resolve: (s: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null
  private chain: Promise<unknown> = Promise.resolve()
  connected = false

  constructor(
    private readonly transport: Transport,
    private readonly cfg: ElmConfig = DEFAULT_ELM_CONFIG,
  ) {
    transport.onData((chunk) => this.onChunk(chunk))
  }

  private onChunk(chunk: string): void {
    this.buffer += chunk
    if (!this.buffer.includes('>') || !this.pending) return
    const text = this.buffer.split('>')[0]
    this.buffer = ''
    clearTimeout(this.pending.timer)
    const p = this.pending
    this.pending = null
    p.resolve(text.replace(/SEARCHING\.\.\./gi, '').trim())
  }

  /** Отправить команду и дождаться приглашения «>». Команды выполняются строго по очереди. */
  send(cmd: string): Promise<string> {
    const run = () =>
      new Promise<string>((resolve, reject) => {
        this.buffer = ''
        const timer = setTimeout(() => {
          this.pending = null
          reject(new ELMError(`Таймаут ответа на ${cmd}`))
        }, this.cfg.timeoutMs)
        this.pending = { resolve, reject, timer }
        this.transport.write(cmd + '\r').catch((e) => {
          clearTimeout(timer)
          this.pending = null
          reject(e instanceof Error ? e : new ELMError(String(e)))
        })
      })
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }

  async connect(): Promise<void> {
    await this.transport.connect()
    // ATZ — сброс, ATE0 — без эха, ATL0 — без переводов строк, ATSP0 — авто-протокол.
    // Для ВАЗ с М73 фактически будет ISO 14230 (KWP2000) или ISO 9141 — выбирает адаптер.
    for (const cmd of ['ATZ', 'ATE0', 'ATL0', 'ATSP0']) await this.send(cmd)
    // Первый запрос запускает определение протокола (может занять несколько секунд).
    await this.send('0100').catch(() => undefined)
    this.connected = true
  }

  async disconnect(): Promise<void> {
    this.connected = false
    await this.transport.close()
  }

  private async pid(pid: string): Promise<number[] | null> {
    const raw = await this.send('01' + pid)
    return /NO DATA|UNABLE|ERROR|\?/i.test(raw) ? null : parsePid(raw, pid)
  }

  async readRpm(): Promise<number | null> {
    const d = await this.pid('0C')
    return d && d.length >= 2 ? (d[0] * 256 + d[1]) / 4 : null
  }
  async readSpeed(): Promise<number | null> {
    const d = await this.pid('0D')
    return d && d.length >= 1 ? d[0] : null
  }
  async readCoolantTemp(): Promise<number | null> {
    const d = await this.pid('05')
    return d && d.length >= 1 ? d[0] - 40 : null
  }
  /** ДМРВ, г/с. */
  async readMaf(): Promise<number | null> {
    const d = await this.pid('10')
    return d && d.length >= 2 ? (d[0] * 256 + d[1]) / 100 : null
  }

  async readSnapshot(): Promise<SensorSnapshot> {
    const rpm = await this.readRpm()
    const speedKmh = await this.readSpeed()
    const coolantTempC = await this.readCoolantTemp()
    const mafGs = await this.readMaf()
    return { rpm, speedKmh, coolantTempC, mafGs, timestamp: Date.now() }
  }

  /** Режим 03 — сохранённые коды неисправностей. */
  async readDtcs(): Promise<string[]> {
    const raw = await this.send('03')
    return /NO DATA/i.test(raw) ? [] : parseDtcResponse(raw)
  }

  /** Режим 04 — сброс ошибок. */
  async clearDtcs(): Promise<void> {
    await this.send('04')
  }
}

/** Фабрика: в dev без железа — Mock, на устройстве — TCP. Переопределяется ?mock=0/1. */
export function createElmService(opts: { mock: boolean; cfg?: Partial<ElmConfig> }): ELMService {
  const cfg = { ...DEFAULT_ELM_CONFIG, ...opts.cfg }
  const transport = opts.mock ? new MockTransport() : new CapacitorTcpTransport(cfg)
  return new ELMService(transport, cfg)
}
