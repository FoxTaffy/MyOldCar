import { Capacitor } from '@capacitor/core'
import { parseStatus, type EcuStatus } from './EcuStatus'
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
  '1': 'SAE J1850 PWM',
  '2': 'SAE J1850 VPW',
  '3': 'ISO 9141-2',
  '4': 'ISO 14230-4 (5-бод)',
  '5': 'ISO 14230-4 (быстрая инициализация)',
  '6': 'CAN 11 бит / 500 кбит',
  '7': 'CAN 29 бит / 500 кбит',
  '8': 'CAN 11 бит / 250 кбит',
  '9': 'CAN 29 бит / 250 кбит',
  A: 'SAE J1939 (CAN)',
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
  private closeCb: () => void = () => {}
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
    // Сокет закрылся сам (адаптер выключили, телефон ушёл из сети Wi-Fi) — сообщаем сразу, а не через таймауты опроса.
    if (this.reading && this.client === client) {
      this.reading = false
      this.closeCb()
    }
  }

  write(data: string): Promise<void> {
    return this.plugin.send({ client: this.client, data })
  }
  onData(cb: (chunk: string) => void): void {
    this.cb = cb
  }
  onClose(cb: () => void): void {
    this.closeCb = cb
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
  private closeCb: () => void = () => {}
  private manual = false
  constructor(private readonly cfg: ElmConfig) {}

  connect(): Promise<void> {
    this.manual = false
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.cfg.host}:${this.cfg.port}`)
      ws.onopen = () => resolve()
      ws.onerror = () => reject(new Error('В браузере Wi-Fi-адаптер доступен только через мост ws:// — он не отвечает. На телефоне используется прямое TCP-подключение.'))
      ws.onclose = () => { if (!this.manual) this.closeCb() }
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
  onClose(cb: () => void): void {
    this.closeCb = cb
  }
  async close(): Promise<void> {
    this.manual = true
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
      case '0103': return '41 03 02 00'
      case '0121': return '41 21 00 00'
      case '010B': return `41 0B ${hex(30 + s.speed * 0.5 + (s.rpm - 850) * 0.01, 1)}`
      case '010E': return `41 0E ${hex((12 + s.rpm * 0.004) * 2 + 128, 1)}`
      case '0114': return `41 14 ${hex((0.45 + Math.sin(Date.now() / 400) * 0.4) * 200, 1)} 84`
      case '011F': return `41 1F ${hex((Date.now() - this.t0) / 1000, 2)}`
      case '0133': return `41 33 ${hex(99, 1)}`
      case '0146': return `41 46 ${hex(12 + 40, 1)}`
      case '012F': return `41 2F ${hex(0.62 * 255, 1)}`
      case '0142': return `41 42 ${hex(14200 + Math.sin(Date.now() / 3000) * 150, 2)}`
      case '0101': { // лампа загорается через 20 с демо; младшие 7 бит — число сохранённых кодов
        const on = Date.now() - this.t0 > 20000
        return `41 01 ${hex(on ? 0x80 | this.opts.dtcs.length : 0, 1)} 07 E5 00`
      }
      case '0902': return '014\n0: 49 02 01 58 54 41\n1: 32 31 30 34 30 30 59\n2: 31 32 33 34 35 36 37'
      case '03': return `43 ${this.opts.dtcs.length ? this.opts.dtcs.map(encodeDtc).join(' ') : '00 00 00 00 00 00'}`
      case '07': return `47 ${this.opts.pending.length ? this.opts.pending.map(encodeDtc).join(' ') : '00 00 00 00 00 00'}`
      // Стоп-кадр (режим 02, кадр 00): условия в момент появления первой ошибки — прогретый холостой ход.
      case '020200': return this.opts.dtcs.length ? `42 02 00 ${encodeDtc(this.opts.dtcs[0])}` : '42 02 00 00 00'
      case '020C00': return `42 0C 00 ${hex(870 * 4, 2)}`
      case '020D00': return '42 0D 00 00'
      case '020500': return `42 05 00 ${hex(88 + 40, 1)}`
      case '020400': return `42 04 00 ${hex(0.22 * 255, 1)}`
      case '020600': return `42 06 00 ${hex(107 * 1.28, 1)}`
      case '020700': return `42 07 00 ${hex(112 * 1.28, 1)}`
      case '021100': return `42 11 00 ${hex(0.13 * 255, 1)}`
      case '021000': return `42 10 00 ${hex(190, 2)}`
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

/**
 * Делит ответ адаптера на посылки в виде строк hex-цифр. Многокадровый ответ CAN (ISO-TP:
 * строка длины «00A», затем кадры «0: 43 04 …», «1: …») склеивается в одну посылку нужной длины.
 */
function responseFrames(raw: string): string[] {
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

function dtcFromWord(word: string): string {
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
const NO_ANSWER = /NO DATA|UNABLE|ERROR|STOPPED|BUFFER FULL|\?/i

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
    this.progress('Сброс адаптера…')
    await this.send('ATZ', 8000)
    // ATE0 — без эха, ATL0 — без переводов строк, ATH0 — без заголовков, ATAT1 — адаптивный таймаут
    // (К-линия отвечает медленнее CAN). Пробелы в ответах не отключаем: разбор к ним устойчив.
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
  private misses = new Map<string, { n: number; answers: number }>()
  /** Сколько раз ЭБУ ответил данными (на любой запрос). */
  private answers = 0

  private async pid(pid: string, optional = false): Promise<number[] | null> {
    if (optional && this.unsupported.has(pid)) return null
    const raw = await this.send('01' + pid)
    const data = NO_ANSWER.test(raw) ? null : parsePid(raw, pid)
    if (data?.length) {
      this.answers++
      this.misses.delete(pid)
      return data
    }
    // «Не поддерживается» — только если между отказами ЭБУ отвечал на другие запросы, то есть был на связи.
    // Иначе одно выключение зажигания навсегда отключало бы все дополнительные датчики до переподключения.
    if (optional) {
      const m = this.misses.get(pid)
      if (!m) this.misses.set(pid, { n: 1, answers: this.answers })
      else if (this.answers > m.answers) {
        m.n++
        m.answers = this.answers
        if (m.n >= 3) this.unsupported.add(pid)
      }
    }
    return null
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
      milOn: mil ? (mil[0] & 0x80) !== 0 : null,
      dtcCount: mil ? mil[0] & 0x7f : null,
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
    if (NO_ANSWER.test(raw)) return null
    return parseVinResponse(raw)
  }

  /** Коды из ответа; если ответа с нужным заголовком нет, а адаптер сообщил о сбое связи — ошибка, а не «кодов нет». */
  private dtcs(raw: string, header: string, what: string): string[] {
    if (responseFrames(raw).some((f) => f.startsWith(header))) return parseDtcResponse(raw, header)
    if (/UNABLE|ERROR|STOPPED|BUFFER FULL/i.test(raw)) {
      throw new ELMError(`ЭБУ не ответил на запрос ${what} (${raw.replace(/\s+/g, ' ').trim().slice(0, 40)}). Включите зажигание и повторите.`)
    }
    return []
  }

  /** Произвольный PID режима 01 (только чтение): сырые байты данных или null, если ЭБУ не поддерживает. */
  async readPidBytes(pid: string): Promise<number[] | null> {
    return this.pid(pid.toUpperCase(), true)
  }

  /** Статус ЭБУ: лампа Check Engine, число кодов, тесты готовности, режим топливоподачи. */
  async readStatus(): Promise<EcuStatus | null> {
    return parseStatus(await this.pid('01', true), await this.pid('03', true))
  }

  /** Режим 03 — сохранённые (подтверждённые) коды неисправностей. */
  async readDtcs(): Promise<string[]> {
    return this.dtcs(await this.send('03'), '43', 'сохранённых кодов')
  }

  /** Режим 07 — временные (ожидающие подтверждения) коды. Не все ЭБУ поддерживают. */
  async readPendingDtcs(): Promise<string[]> {
    return this.dtcs(await this.send('07'), '47', 'временных кодов')
  }

  /**
   * Режим 02 — стоп-кадр: показания датчиков, которые ЭБУ запомнил в момент появления ошибки.
   * null, если кадра нет или ЭБУ режим не поддерживает (на старых блоках это обычное дело).
   */
  async readFreezeFrame(): Promise<FreezeFrame | null> {
    // Ответ: «42 <PID> <номер кадра> <данные>» — первый байт данных отбрасываем.
    const ff = async (pid: string): Promise<number[] | null> => {
      const raw = await this.send(`02${pid}00`)
      const d = NO_ANSWER.test(raw) ? null : parsePid(raw, pid, '42')
      return d && d.length > 1 ? d.slice(1) : null
    }
    const cause = await ff('02')
    if (!cause || cause.length < 2 || (cause[0] === 0 && cause[1] === 0)) return null
    const dtc = dtcFromWord(cause.slice(0, 2).map((b) => b.toString(16).padStart(2, '0')).join(''))
    const rpm = await ff('0C')
    const speed = await ff('0D')
    const ect = await ff('05')
    const load = await ff('04')
    const thr = await ff('11')
    const maf = await ff('10')
    const stft = await ff('06')
    const ltft = await ff('07')
    return {
      dtc,
      rpm: rpm && rpm.length >= 2 ? (rpm[0] * 256 + rpm[1]) / 4 : null,
      speedKmh: speed ? speed[0] : null,
      coolantTempC: ect ? ect[0] - 40 : null,
      loadPct: load ? (load[0] * 100) / 255 : null,
      throttlePct: thr ? (thr[0] * 100) / 255 : null,
      mafGs: maf && maf.length >= 2 ? (maf[0] * 256 + maf[1]) / 100 : null,
      stft: stft ? (stft[0] * 100) / 128 - 100 : null,
      ltft: ltft ? (ltft[0] * 100) / 128 - 100 : null,
    }
  }

  /** Название найденного протокола обмена с ЭБУ. */
  get protocolName(): string | null {
    return this.protocol ? PROTOCOL_NAMES[this.protocol.toUpperCase()] ?? `протокол ${this.protocol}` : null
  }
}

export interface ConnectTarget {
  kind: ConnectionKind
  host?: string
  port?: number
  bleId?: string
  protocol?: string
  /** Ожидание ответа адаптера, мс. */
  timeoutMs?: number
  /** Попыток подключения по Bluetooth. */
  attempts?: number
}

/** Фабрика сервиса под выбранный способ связи. */
export function createElmService(t: ConnectTarget): ELMService {
  const cfg = { ...DEFAULT_ELM_CONFIG, host: t.host ?? DEFAULT_ELM_CONFIG.host, port: t.port ?? DEFAULT_ELM_CONFIG.port, protocol: t.protocol || undefined, timeoutMs: t.timeoutMs ?? DEFAULT_ELM_CONFIG.timeoutMs }
  if (t.kind === 'mock') return new ELMService(new MockTransport(), cfg)
  if (t.kind === 'ble') {
    if (!t.bleId) throw new Error('Bluetooth-адаптер не выбран')
    return new ELMService(new BleTransport(t.bleId, undefined, t.attempts ? { attempts: t.attempts } : {}), cfg)
  }
  // В браузере «сырого» TCP нет — остаётся только мост ws:// (для разработки).
  return new ELMService(Capacitor.isNativePlatform() ? new CapacitorTcpTransport(cfg) : new WebSocketTransport(cfg), cfg)
}
