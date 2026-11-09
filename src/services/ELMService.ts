import { TcpSocket } from 'capacitor-tcp-socket'
import { BleClient, type BleService, type ScanResult } from '@capacitor-community/bluetooth-le'
import type { ConnectionKind, SensorSnapshot } from '@/types'

/* ------------------------------------------------------------------ */
/* Транспорт                                                           */
/* ------------------------------------------------------------------ */

/** Минимальный интерфейс канала связи с адаптером. */
export interface Transport {
  connect(): Promise<void>
  write(data: string): Promise<void>
  onData(cb: (chunk: string) => void): void
  /** Необязательно: уведомление о неожиданном разрыве связи. */
  onClose?(cb: () => void): void
  close(): Promise<void>
}

export interface ElmConfig {
  host: string
  port: number
  /** Таймаут ответа на одну команду, мс. */
  timeoutMs: number
  /** Ранее найденный номер протокола ELM (ATSP): пробуется первым. */
  protocol?: string
  /** Сколько ждать авто-поиска протокола (ATSP0), мс. */
  searchMs?: number
  /** Сколько ждать ответа ЭБУ при явно заданном протоколе, мс. */
  probeMs?: number
}

export const DEFAULT_ELM_CONFIG: ElmConfig = { host: '192.168.0.10', port: 35000, timeoutMs: 5000 }

/** Номера протоколов ELM327, актуальные для ВАЗ с ЭБУ М73: К-линия (KWP2000 / ISO 9141) и CAN на новых. */
export const PROTOCOL_NAMES: Record<string, string> = {
  '0': 'авто',
  '5': 'ISO 14230-4 (быстрая инициализация)',
  '4': 'ISO 14230-4 (5-бод)',
  '3': 'ISO 9141-2',
  '6': 'CAN 11 бит / 500 кбит',
}

/** Подмножество API плагина capacitor-tcp-socket, которое нам нужно (вынесено для подмены в тестах). */
export interface TcpPlugin {
  connect(o: { ipAddress: string; port?: number; timeout?: number }): Promise<{ client: number }>
  send(o: { client: number; data: string }): Promise<void>
  read(o: { client: number; expectLen?: number; timeout?: number }): Promise<{ result: string; encoding: string }>
  disconnect(o: { client: number }): Promise<unknown>
}

/**
 * ELM327 Wi-Fi говорит по «сырому» TCP — браузерный WebSocket к нему не подключится.
 * Используем нативный плагин capacitor-tcp-socket. Он без событий: данные забираются через read(),
 * поэтому после connect() крутится фоновый цикл чтения, который отдаёт чанки в onData.
 */
export class CapacitorTcpTransport implements Transport {
  private client = -1
  private cb: (chunk: string) => void = () => {}
  private reading = false

  constructor(
    private readonly cfg: ElmConfig,
    private readonly plugin: TcpPlugin = TcpSocket as unknown as TcpPlugin,
  ) {}

  async connect(): Promise<void> {
    const timeoutSec = Math.max(1, Math.ceil(this.cfg.timeoutMs / 1000))
    const { client } = await this.plugin.connect({ ipAddress: this.cfg.host, port: this.cfg.port, timeout: timeoutSec })
    this.client = client
    this.reading = true
    void this.readLoop(client)
  }

  private async readLoop(client: number): Promise<void> {
    while (this.reading && this.client === client) {
      try {
        // Короткий таймаут, чтобы цикл быстро замечал закрытие; TIMEOUT — штатная ситуация.
        const r = await this.plugin.read({ client, expectLen: 1024, timeout: 1 })
        if (r.result) this.cb(r.result)
      } catch (e) {
        const code = (e as { code?: string }).code
        if (code === 'TIMEOUT') continue
        if (code === 'EOF' || code === 'CLOSED' || code === 'IO_ERROR') break
        await new Promise((res) => setTimeout(res, 100))
      }
    }
  }

  write(data: string): Promise<void> {
    return this.plugin.send({ client: this.client, data })
  }
  onData(cb: (chunk: string) => void): void {
    this.cb = cb
  }
  async close(): Promise<void> {
    this.reading = false
    const c = this.client
    this.client = -1
    if (c >= 0) await this.plugin.disconnect({ client: c })
  }
}

/* ------------------------------------------------------------------ */
/* Bluetooth LE                                                        */
/* ------------------------------------------------------------------ */

/** Подмножество BleClient, нужное транспорту (для подмены в тестах). */
export interface BleLike {
  initialize?(): Promise<void>
  requestLEScan?(o: Record<string, never>, cb: (r: ScanResult) => void): Promise<void>
  stopLEScan?(): Promise<void>
  connect(id: string, onDisconnect?: (id: string) => void, o?: { timeout?: number }): Promise<void>
  disconnect(id: string): Promise<void>
  getServices(id: string): Promise<BleService[]>
  startNotifications(id: string, svc: string, ch: string, cb: (v: DataView) => void): Promise<void>
  stopNotifications(id: string, svc: string, ch: string): Promise<void>
  write(id: string, svc: string, ch: string, v: DataView): Promise<void>
  writeWithoutResponse(id: string, svc: string, ch: string, v: DataView): Promise<void>
}

/** Сервисы, которые обычно используют BLE-адаптеры ELM327 (нужны вебу; на Android — подсказка). */
export const ELM_BLE_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
]

export interface ElmChars {
  service: string
  notify: string
  write: string
  writeNoResponse: boolean
}

const STANDARD_SERVICE = /^0000(1800|1801|180a)-/i

/** Находит пару характеристик «уведомления + запись» у адаптера, не зная его модели. */
export function pickElmChars(services: BleService[]): ElmChars | null {
  for (const svc of services) {
    if (STANDARD_SERVICE.test(svc.uuid)) continue
    const notify = svc.characteristics.find((c) => c.properties.notify || c.properties.indicate)
    if (!notify) continue
    const writers = svc.characteristics.filter((c) => c.properties.write || c.properties.writeWithoutResponse)
    const write = writers.find((c) => c.uuid !== notify.uuid) ?? writers[0]
    if (!write) continue
    return { service: svc.uuid, notify: notify.uuid, write: write.uuid, writeNoResponse: !write.properties.write && !!write.properties.writeWithoutResponse }
  }
  return null
}

export interface PairedDevice { deviceId: string; name: string }

/** Системное окно выбора устройства (первое сопряжение). Запрашивает разрешения Bluetooth. */
export async function pickBleDevice(): Promise<PairedDevice> {
  await BleClient.initialize()
  const d = await BleClient.requestDevice({ optionalServices: ELM_BLE_SERVICES })
  return { deviceId: d.deviceId, name: d.name ?? 'OBDII' }
}

/** Расшифровка типичных сбоев Android BLE (status 133 = общий GATT_ERROR). */
export function friendlyBleError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e)
  if (/133|GATT/i.test(raw)) {
    return `${raw}. Обычно адаптер занят другим приложением: закройте Car Scanner и другие OBD-программы (в т.ч. в фоне), включите зажигание и повторите; если не помогло — выньте адаптер на 10 секунд и выключите/включите Bluetooth на телефоне.`
  }
  if (/permission|denied/i.test(raw)) return `${raw}. Разрешите приложению доступ к Bluetooth/«Устройствам поблизости» в настройках телефона.`
  if (/disabled|not enabled|powered off/i.test(raw)) return `${raw}. Включите Bluetooth на телефоне.`
  return raw
}

export class BleTransport implements Transport {
  private cb: (chunk: string) => void = () => {}
  private closeCb: () => void = () => {}
  private chars: ElmChars | null = null
  private manual = false
  private decoder = new TextDecoder()

  constructor(
    private readonly deviceId: string,
    private readonly ble: BleLike = BleClient as unknown as BleLike,
    private readonly opts: { attempts?: number; retryMs?: number; scanMs?: number } = {},
  ) {}

  private get attempts(): number { return this.opts.attempts ?? 3 }
  private get retryMs(): number { return this.opts.retryMs ?? 1200 }
  private get scanMs(): number { return this.opts.scanMs ?? 4000 }

  /** Короткое сканирование: Android надёжнее подключается к устройству, которое только что «видел». */
  private async refresh(): Promise<void> {
    const { ble, deviceId } = this
    if (!ble.requestLEScan || !ble.stopLEScan) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, this.scanMs)
      ble.requestLEScan!({}, (r) => {
        if (r.device.deviceId === deviceId) { clearTimeout(timer); resolve() }
      }).catch(() => { clearTimeout(timer); resolve() })
    })
    await ble.stopLEScan().catch(() => undefined)
  }

  async connect(): Promise<void> {
    this.manual = false
    // Без initialize() Android не выдаёт разрешения и не поднимает BLE-стек (после перезапуска приложения).
    await this.ble.initialize?.()
    let lastErr: unknown
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        await this.refresh()
        await this.ble.connect(this.deviceId, () => { if (!this.manual) this.closeCb() }, { timeout: 8000 })
        lastErr = undefined
        break
      } catch (e) {
        lastErr = e
        // Освобождаем зависший GATT-клиент, иначе следующая попытка снова даст 133.
        await this.ble.disconnect(this.deviceId).catch(() => undefined)
        if (attempt < this.attempts) await new Promise((r) => setTimeout(r, this.retryMs * attempt))
      }
    }
    if (lastErr !== undefined) throw new Error(friendlyBleError(lastErr))

    const chars = pickElmChars(await this.ble.getServices(this.deviceId))
    if (!chars) {
      await this.ble.disconnect(this.deviceId).catch(() => undefined)
      throw new Error('Не найдены характеристики ELM327 у этого Bluetooth-устройства')
    }
    this.chars = chars
    await this.ble.startNotifications(this.deviceId, chars.service, chars.notify, (v) => this.cb(this.decoder.decode(v)))
  }

  async write(data: string): Promise<void> {
    const c = this.chars
    if (!c) throw new Error('Bluetooth не подключён')
    const bytes = new TextEncoder().encode(data)
    // Пакеты BLE по умолчанию — 20 байт; команды ELM короче, но режем на всякий случай.
    for (let i = 0; i < bytes.length; i += 20) {
      const view = new DataView(bytes.slice(i, i + 20).buffer)
      if (c.writeNoResponse) await this.ble.writeWithoutResponse(this.deviceId, c.service, c.write, view)
      else await this.ble.write(this.deviceId, c.service, c.write, view)
    }
  }
  onData(cb: (chunk: string) => void): void {
    this.cb = cb
  }
  onClose(cb: () => void): void {
    this.closeCb = cb
  }
  async close(): Promise<void> {
    this.manual = true
    const c = this.chars
    this.chars = null
    if (c) await this.ble.stopNotifications(this.deviceId, c.service, c.notify).catch(() => undefined)
    await this.ble.disconnect(this.deviceId).catch(() => undefined)
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
  /** Временные (pending) ошибки — режим 07. */
  pending: string[]
  /** Имитировать «подсос воздуха»: низкий ДМРВ на холостом. */
  lowMaf: boolean
}

export class MockTransport implements Transport {
  private cb: (chunk: string) => void = () => {}
  private t0 = Date.now()
  constructor(private readonly opts: MockOptions = { dtcs: ['P0171', 'P0301'], pending: ['P0123'], lowMaf: true }) {}

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
    if (cmd.startsWith('AT')) return cmd === 'ATZ' ? 'ELM327 v1.5' : cmd === 'ATDPN' ? 'A5' : 'OK'
    const s = this.sim()
    const hex = (n: number, bytes: number) =>
      Math.max(0, Math.round(n)).toString(16).toUpperCase().padStart(bytes * 2, '0').replace(/(..)/g, '$1 ').trim()
    switch (cmd) {
      case '0100': return '41 00 BE 3E B8 11'
      case '010C': return `41 0C ${hex(s.rpm * 4, 2)}`
      case '010D': return `41 0D ${hex(s.speed, 1)}`
      case '0105': return `41 05 ${hex(s.temp + 40, 1)}`
      case '0110': return `41 10 ${hex(s.maf * 100, 2)}`
      case '0104': return `41 04 ${hex((Math.min(100, 18 + s.speed * 0.4 + (s.rpm - 850) * 0.006) / 100) * 255, 1)}`
      case '0111': return `41 11 ${hex((Math.min(100, 12 + s.speed * 0.5) / 100) * 255, 1)}`
      case '010F': return `41 0F ${hex(28 + 40, 1)}`
      case '0106': return `41 06 ${hex(((this.opts.lowMaf ? 6 : 1) + 100) * 1.28, 1)}`
      case '0107': return `41 07 ${hex(((this.opts.lowMaf ? 9 : 2) + 100) * 1.28, 1)}`
      case '0142': return `41 42 ${hex(14200 + Math.sin(Date.now() / 3000) * 150, 2)}`
      case '0101': return Date.now() - this.t0 > 20000 ? '41 01 81 07 E5 00' : '41 01 00 07 E5 00' // лампа загорается через 20 с демо
      case '0902': return '014\n0: 49 02 01 58 54 41\n1: 32 31 30 34 30 30 59\n2: 31 32 33 34 35 36 37'
      case '03': return `43 ${this.opts.dtcs.length ? this.opts.dtcs.map(encodeDtc).join(' ') : '00 00 00 00 00 00'}`
      case '07': return `47 ${this.opts.pending.length ? this.opts.pending.map(encodeDtc).join(' ') : '00 00 00 00 00 00'}`
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
export function parseDtcResponse(raw: string, header = '43'): string[] {
  const codes: string[] = []
  for (const line of raw.split(/[\r\n]+/)) {
    const bytes = line.replace(/[^0-9A-Fa-f]/g, ' ').trim().split(/\s+/).filter(Boolean)
    // Допускаем и «43 01 71…», и склеенное «4301710000…».
    const flat = bytes.join('')
    if (!flat.startsWith(header)) continue
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

/**
 * ТОЛЬКО ЧТЕНИЕ. Приложение не должно ничего менять в ЭБУ и сбрасывать.
 * Белый список: служебные AT-команды самого адаптера и запросы OBD-II на чтение
 * (01 — текущие данные, 02 — стоп-кадр, 03/07/0A — коды ошибок, 09 — сведения об авто).
 * Режимы 04 (сброс ошибок), 08 (управление), 05/06 и любые сервисы записи/диагностических
 * сессий (10, 11, 14, 27, 2E, 2F, 31, 3B, 3D…) блокируются до отправки в адаптер.
 */
const SAFE_AT = /^AT(Z|E0|L0|H0|S0|AT1|SP[0-9A-C]|DPN|DP|I)$/
const SAFE_OBD = /^(01|02|03|07|09|0A)([0-9A-F]{2}){0,3}$/

export function isReadOnlyCommand(cmd: string): boolean {
  const c = cmd.replace(/\s/g, '').toUpperCase()
  // Пустая строка (bare CR) нужна только чтобы прервать поиск протокола.
  return c === '' || SAFE_AT.test(c) || SAFE_OBD.test(c)
}

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
    transport.onClose?.(() => {
      this.connected = false
      this.onLost?.()
    })
  }

  /** Вызывается при неожиданном разрыве (например, адаптер выключили). */
  onLost?: () => void

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
  send(cmd: string, timeoutMs = this.cfg.timeoutMs): Promise<string> {
    if (!isReadOnlyCommand(cmd)) {
      return Promise.reject(new ELMError(`Команда ${cmd} заблокирована: приложение работает только на чтение`))
    }
    const run = () =>
      new Promise<string>((resolve, reject) => {
        this.buffer = ''
        const timer = setTimeout(() => {
          this.pending = null
          reject(new ELMError(`Таймаут ответа на ${cmd}`))
        }, timeoutMs)
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
    this.progress('Сброс адаптера…')
    await this.send('ATZ', 8000)
    // ATE0 — без эха, ATL0 — без переводов строк, ATH0 — без заголовков, ATS0 — без пробелов не нужен (разбор устойчив),
    // ATAT1 — адаптивный таймаут (К-линия отвечает медленнее CAN).
    for (const cmd of ['ATE0', 'ATL0', 'ATH0', 'ATAT1']) await this.send(cmd)

    // Сначала сохранённый протокол, затем авто-поиск, затем явный перебор К-линий и CAN.
    const order = [...new Set([this.cfg.protocol, '0', '5', '4', '3', '6'].filter((x): x is string => !!x))]
    for (const p of order) {
      this.progress(p === '0' ? 'Поиск протокола ЭБУ (авто)…' : `Протокол: ${PROTOCOL_NAMES[p] ?? p}…`)
      if (await this.probe(p)) {
        this.protocol = (await this.send('ATDPN').catch(() => '')).replace(/^A/i, '').trim().slice(0, 1) || p
        this.connected = true
        this.progress(null)
        return
      }
    }
    this.progress(null)
    throw new ELMError('Адаптер на связи, но ЭБУ не отвечает. Включите зажигание (лучше заведите двигатель), проверьте, что адаптер плотно вставлен в разъём, и повторите.')
  }

  /** Найденный протокол (номер ATDPN) — сохраняется, чтобы в следующий раз подключаться быстрее. */
  protocol: string | null = null
  onProgress?: (msg: string | null) => void
  private progress(msg: string | null): void {
    this.onProgress?.(msg)
  }

  /** Пробует протокол: ATSP<p>, затем запрос 0100. true — ЭБУ ответил данными. */
  private async probe(p: string): Promise<boolean> {
    await this.send('ATSP' + p)
    const wait = p === '0' ? (this.cfg.searchMs ?? 30000) : (this.cfg.probeMs ?? 12000)
    try {
      const r = await this.send('0100', wait)
      return r.replace(/[\s]/g, '').includes('4100')
    } catch {
      // Таймаут: ELM может всё ещё искать — прерываем поиск и дожидаемся приглашения.
      await this.send('', 3000).catch(() => undefined)
      await new Promise((r) => setTimeout(r, 300))
      return false
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false
    await this.transport.close()
  }

  /** Необязательные PID, которые ЭБУ не поддержал, — больше не опрашиваем. */
  private unsupported = new Set<string>()

  private async pid(pid: string, optional = false): Promise<number[] | null> {
    if (optional && this.unsupported.has(pid)) return null
    const raw = await this.send('01' + pid)
    if (/NO DATA|UNABLE|ERROR|\?/i.test(raw)) {
      if (optional) this.unsupported.add(pid)
      return null
    }
    return parsePid(raw, pid)
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

  /** Основные показания; extended=true добавляет редкие PID (опрашиваются реже). */
  async readSnapshot(extended = false): Promise<SensorSnapshot> {
    const rpm = await this.readRpm()
    const speedKmh = await this.readSpeed()
    const coolantTempC = await this.readCoolantTemp()
    const mafGs = await this.readMaf()
    const snap: SensorSnapshot = { rpm, speedKmh, coolantTempC, mafGs, timestamp: Date.now() }
    return extended ? { ...snap, ...(await this.readExtended()) } : snap
  }

  async readExtended(): Promise<Partial<SensorSnapshot>> {
    const load = await this.pid('04', true)
    const stft = await this.pid('06', true)
    const ltft = await this.pid('07', true)
    const intake = await this.pid('0F', true)
    const thr = await this.pid('11', true)
    const volt = await this.pid('42', true)
    const mil = await this.pid('01', true)
    return {
      milOn: mil && mil.length >= 1 ? (mil[0] & 0x80) !== 0 : null,
      dtcCount: mil && mil.length >= 1 ? mil[0] & 0x7f : null,
      loadPct: load ? (load[0] * 100) / 255 : null,
      stft: stft ? (stft[0] * 100) / 128 - 100 : null,
      ltft: ltft ? (ltft[0] * 100) / 128 - 100 : null,
      intakeTempC: intake ? intake[0] - 40 : null,
      throttlePct: thr ? (thr[0] * 100) / 255 : null,
      voltage: volt && volt.length >= 2 ? (volt[0] * 256 + volt[1]) / 1000 : null,
    }
  }

  /** Режим 09 PID 02 — VIN из ЭБУ. null, если ЭБУ не поддерживает (старые К-линейные М73 часто не умеют). */
  async readVin(): Promise<string | null> {
    const raw = await this.send('0902', 8000)
    if (/NO DATA|UNABLE|ERROR|\?/i.test(raw)) return null
    return parseVinResponse(raw)
  }

  /** Режим 03 — сохранённые (подтверждённые) коды неисправностей. */
  async readDtcs(): Promise<string[]> {
    const raw = await this.send('03')
    return /NO DATA/i.test(raw) ? [] : parseDtcResponse(raw)
  }

  /** Режим 07 — временные (ожидающие подтверждения) коды. Не все ЭБУ поддерживают. */
  async readPendingDtcs(): Promise<string[]> {
    const raw = await this.send('07')
    return /NO DATA|UNABLE|\?/i.test(raw) ? [] : parseDtcResponse(raw, '47')
  }
}

export interface ConnectTarget {
  kind: ConnectionKind
  host?: string
  port?: number
  bleId?: string
  protocol?: string
}

/** Фабрика сервиса под выбранный способ связи. */
export function createElmService(t: ConnectTarget): ELMService {
  const cfg = { ...DEFAULT_ELM_CONFIG, host: t.host ?? DEFAULT_ELM_CONFIG.host, port: t.port ?? DEFAULT_ELM_CONFIG.port, protocol: t.protocol || undefined }
  if (t.kind === 'mock') return new ELMService(new MockTransport(), cfg)
  if (t.kind === 'ble') {
    if (!t.bleId) throw new Error('Bluetooth-адаптер не выбран')
    return new ELMService(new BleTransport(t.bleId), cfg)
  }
  return new ELMService(new CapacitorTcpTransport(cfg), cfg)
}
