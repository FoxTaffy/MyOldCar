/** Транспорты до адаптера ELM327: Wi-Fi (TCP), Bluetooth LE, WebSocket-мост (браузер) и симулятор (демо). */
import { TcpSocket } from 'capacitor-tcp-socket'
import { BleClient, type BleService, type ScanResult } from '@capacitor-community/bluetooth-le'
import { encodeDtc } from './parse'

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
  /** Номер попытки подключения: close() увеличивает его, и цикл повторов сразу прекращается. */
  private epoch = 0
  private decoder = new TextDecoder()

  constructor(
    private readonly deviceId: string,
    private readonly ble: BleLike = BleClient as unknown as BleLike,
    private readonly opts: { attempts?: number; retryMs?: number; scanMs?: number; settleMs?: number; log?: (msg: string) => void } = {},
  ) {}

  private get attempts(): number { return this.opts.attempts ?? 3 }
  private get retryMs(): number { return this.opts.retryMs ?? 1200 }
  private get scanMs(): number { return this.opts.scanMs ?? 4000 }
  private log(msg: string): void { this.opts.log?.(msg) }

  /** Короткое сканирование: Android надёжнее подключается к устройству, которое только что «видел». Выходит сразу, как адаптер найден или попытку отменили. */
  private async refresh(cancelled: () => boolean): Promise<void> {
    const { ble, deviceId } = this
    if (!ble.requestLEScan || !ble.stopLEScan) return
    let found = false
    await new Promise<void>((resolve) => {
      const done = (): void => { clearTimeout(timer); clearInterval(watch); resolve() }
      const timer = setTimeout(done, this.scanMs)
      const watch = setInterval(() => { if (cancelled()) done() }, 150)
      ble.requestLEScan!({}, (r) => {
        if (r.device.deviceId === deviceId) { found = true; done() }
      }).catch(done)
    })
    this.log(found ? 'Адаптер найден при сканировании' : 'Адаптер не появился в эфире за время сканирования — пробуем подключиться напрямую')
    await ble.stopLEScan().catch(() => undefined)
  }

  async connect(): Promise<void> {
    this.manual = false
    const epoch = ++this.epoch
    const cancelled = (): boolean => this.epoch !== epoch
    const cancelErr = (): Error => new Error('Подключение отменено')
    // Без initialize() Android не выдаёт разрешения и не поднимает BLE-стек (после перезапуска приложения).
    await this.ble.initialize?.()
    let lastErr: unknown
    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      if (cancelled()) throw cancelErr()
      try {
        // Сканируем один раз перед первой попыткой: частые перезапуски скана Android ограничивает.
        if (attempt === 1) await this.refresh(cancelled)
        if (cancelled()) throw cancelErr()
        this.log(`Bluetooth: подключение, попытка ${attempt} из ${this.attempts}`)
        await this.ble.connect(this.deviceId, () => { if (!this.manual && this.chars) this.closeCb() }, { timeout: 8000 })
        // Пока шло подключение, пользователь нажал «Отмена» — не оставляем «бесхозное» соединение: адаптер принимает только одного клиента.
        if (cancelled()) throw cancelErr()
        lastErr = undefined
        break
      } catch (e) {
        lastErr = e
        // Освобождаем зависший GATT-клиент, иначе следующая попытка снова даст 133.
        await this.ble.disconnect(this.deviceId).catch(() => undefined)
        if (cancelled()) throw cancelErr()
        this.log(`Bluetooth: попытка ${attempt} не удалась — ${e instanceof Error ? e.message : String(e)}`)
        if (attempt < this.attempts) await new Promise((r) => setTimeout(r, this.retryMs * attempt))
      }
    }
    if (lastErr !== undefined) throw new Error(friendlyBleError(lastErr))

    try {
      const chars = pickElmChars(await this.ble.getServices(this.deviceId))
      if (!chars) throw new Error('Не найдены характеристики ELM327 у этого Bluetooth-устройства')
      if (cancelled()) throw cancelErr()
      this.log('Bluetooth: подписка на уведомления адаптера')
      await this.ble.startNotifications(this.deviceId, chars.service, chars.notify, (v) => this.cb(this.decoder.decode(v)))
      this.chars = chars
      // Даём адаптеру «выдохнуть» после подписки: первая команда сразу после неё на дешёвых модулях теряется.
      await new Promise((r) => setTimeout(r, this.opts.settleMs ?? 300))
      if (cancelled()) throw cancelErr()
    } catch (e) {
      this.chars = null
      await this.ble.disconnect(this.deviceId).catch(() => undefined)
      throw e
    }
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
    this.epoch++
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
  /** Демо: ошибки стёрли (режим 04) — коды и лампа пропадают, тесты готовности не завершены. */
  private cleared = false
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
    if (cmd === 'ATRV') return '12.5V'
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
      case '0130': return `41 30 ${hex(this.cleared ? 0 : 3, 1)}`
      case '0131': return `41 31 ${hex(this.cleared ? 0 : 45, 2)}`
      case '014E': return `41 4E ${hex(this.cleared ? 0 : 95, 2)}`
      case '04':
        this.opts.dtcs = []
        this.opts.pending = []
        this.cleared = true
        return '44'
      case '0101': { // лампа загорается через 20 с демо; младшие 7 бит — число сохранённых кодов
        const on = !this.cleared && Date.now() - this.t0 > 20000
        return this.cleared ? '41 01 00 07 E5 E5' : `41 01 ${hex(on ? 0x80 | this.opts.dtcs.length : 0, 1)} 07 E5 00`
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
