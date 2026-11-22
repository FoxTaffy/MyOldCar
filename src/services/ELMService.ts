import { Capacitor } from '@capacitor/core'
import { parseStatus, type EcuStatus } from './EcuStatus'
import { parseAdapterVoltage } from './Battery'
import type { ConnectionKind, SensorSnapshot } from '@/types'
import { dtcFromWord, NO_ANSWER, parseDtcResponse, parsePid, parseVinResponse, responseFrames, type FreezeFrame } from './elm/parse'
import { BleTransport, CapacitorTcpTransport, DEFAULT_ELM_CONFIG, MockTransport, PROTOCOL_NAMES, WebSocketTransport, type ElmConfig, type Transport } from './elm/transports'

// Транспорты и разбор ответов живут в ./elm/*; реэкспорт сохраняет прежние импорты из ELMService.
export * from './elm/parse'
export * from './elm/transports'

/* ------------------------------------------------------------------ */
/* Сервис                                                              */
/* ------------------------------------------------------------------ */

export class ELMError extends Error {}

export interface AdapterInfo {
  /** Строка версии из ответа ATZ, например «ELM327 v1.5». */
  version: string | null
  /** Предупреждение о возможном клоне или null. */
  warning: string | null
}

/**
 * Настоящих ELM327 версии 2.x почти не бывает в продаже: «v2.1» — характерная прошивка дешёвых клонов,
 * которые плохо держат К-линию (старые ВАЗ, ЭБУ Январь/М73) и теряют ответы. «v1.5» — тоже обычно клон,
 * но рабочий. Адаптеры вроде OBDLink, vLinker, Kingbolen отвечают своим именем и проблем не вызывают.
 */
export function adapterInfo(atz: string): AdapterInfo {
  const m = /(ELM327|STN\d+|OBDLink|vLinker|OBDII)[^\r\n>]*?v?(\d+\.\d+[a-z]?)/i.exec(atz)
  const version = m ? `${m[1]} v${m[2]}` : (atz.replace(/[\r\n>]+/g, ' ').trim().slice(0, 40) || null)
  let warning: string | null = null
  if (/ELM327/i.test(atz) && /v2\.[1-3]/i.test(atz)) {
    warning = 'Похоже на дешёвый клон ELM327 v2.1: с К-линией (старые ВАЗ, М73, Январь) такие часто теряют ответы и не находят ЭБУ. Если связь нестабильна — возьмите адаптер на прошивке v1.5 или vLinker/OBDLink.'
  }
  return { version, warning }
}

/**
 * ТОЛЬКО ЧТЕНИЕ. Приложение не должно ничего менять в ЭБУ и сбрасывать.
 * Белый список: служебные AT-команды самого адаптера (в т.ч. ATRV — напряжение бортсети, которое меряет адаптер) и запросы OBD-II на чтение
 * (01 — текущие данные, 02 — стоп-кадр, 03/07/0A — коды ошибок, 09 — сведения об авто).
 * Режимы 04 (сброс ошибок), 08 (управление), 05/06 и любые сервисы записи/диагностических
 * сессий (10, 11, 14, 27, 2E, 2F, 31, 3B, 3D…) блокируются до отправки в адаптер.
 */
const SAFE_AT = /^AT(Z|E0|L0|H0|S0|AT1|SP[0-9A-C]|DPN|DP|I|RV)$/
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
  /** Прошлая команда осталась без ответа: её запоздалый ответ может прийти вместо ответа на следующую. */
  private dirty = false
  /** Транспорт сообщил о разрыве: новые команды сразу получают отказ, а не ждут таймаут. */
  private closed = false
  /** Ожидание ответа адаптера на служебную команду ресинхронизации. */
  private drain: (() => void) | null = null

  constructor(
    private readonly transport: Transport,
    private readonly cfg: ElmConfig = DEFAULT_ELM_CONFIG,
  ) {
    transport.onData((chunk) => this.onChunk(chunk))
    transport.onClose?.(() => {
      this.connected = false
      this.closed = true
      // Команда, ждущая ответа, не должна висеть до таймаута: связи уже нет.
      const p = this.pending
      if (p) {
        clearTimeout(p.timer)
        this.pending = null
        p.reject(new ELMError('Связь с адаптером потеряна'))
      }
      this.drain?.()
      this.onLost?.()
    })
  }

  /** Вызывается при неожиданном разрыве (например, адаптер выключили). */
  onLost?: () => void

  private onChunk(chunk: string): void {
    this.buffer += chunk
    if (!this.pending) {
      // Идёт ресинхронизация: запоздалые ответы на прошлые команды выбрасываем, ждём ответ на ATI.
      if (this.drain && this.buffer.includes('>')) {
        const end = this.buffer.lastIndexOf('>')
        const text = this.buffer.slice(0, end)
        this.buffer = this.buffer.slice(end + 1)
        if (/ELM|OK|v\d\.\d/i.test(text)) this.drain()
      }
      return
    }
    if (!this.buffer.includes('>')) return
    this.dirty = false
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
    return this.exec(cmd, timeoutMs)
  }

  /** Отправка без проверки белого списка — только для clearDtcs(). */
  private exec(cmd: string, timeoutMs: number): Promise<string> {
    const run = async (): Promise<string> => {
      if (this.closed) throw new ELMError('Связь с адаптером потеряна')
      if (this.dirty && cmd.trim() !== '') await this.resync()
      return new Promise<string>((resolve, reject) => {
        this.buffer = ''
        const timer = setTimeout(() => {
          this.pending = null
          this.dirty = true
          reject(new ELMError(`Таймаут ответа на ${cmd}`))
        }, timeoutMs)
        this.pending = { resolve, reject, timer }
        this.transport.write(cmd + '\r').catch((e) => {
          clearTimeout(timer)
          this.pending = null
          reject(e instanceof Error ? e : new ELMError(String(e)))
        })
      })
    }
    const next = this.chain.then(run, run)
    this.chain = next.catch(() => undefined)
    return next
  }

  /**
   * После таймаута: отправляем безвредную ATI и ждём именно её ответ, выбрасывая всё, что пришло раньше.
   * Иначе опоздавший ответ на прошлую команду принимается за ответ на следующую, и показания «съезжают».
   */
  private async resync(): Promise<void> {
    this.dirty = false
    const ms = Math.min(1500, Math.max(100, this.cfg.timeoutMs / 2))
    this.buffer = ''
    await new Promise<void>((resolve) => {
      const done = (): void => { clearTimeout(timer); this.drain = null; resolve() }
      const timer = setTimeout(done, ms)
      this.drain = done
      this.transport.write('ATI\r').catch(done)
    })
    this.buffer = ''
  }

  async connect(): Promise<void> {
    this.closed = false
    await this.transport.connect()
    this.progress('Сброс адаптера…')
    // Первая команда после подключения по Bluetooth иногда теряется — один повтор вместо провала всей попытки.
    const id = await this.send('ATZ', 8000).catch(() => this.send('ATZ', 8000))
    this.adapter = adapterInfo(id)
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

  /** Что за адаптер (по ответу на ATZ) и не похож ли он на проблемный клон. */
  adapter: AdapterInfo | null = null

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
   * Режим 04 — сброс кодов ошибок и стоп-кадра, гасит Check Engine. ЕДИНСТВЕННАЯ команда, меняющая состояние ЭБУ.
   * Вызывается только после явного подтверждения пользователя и только если сброс разрешён в настройках
   * (проверка в интерфейсе); send() режим 04 по-прежнему не пропускает.
   * Вместе с кодами стираются тесты готовности — после сброса машине нужно 2–3 дня поездок, чтобы их пройти.
   */
  async clearDtcs(): Promise<void> {
    const r = (await this.exec('04', Math.max(this.cfg.timeoutMs, 10000))).replace(/\s/g, '').toUpperCase()
    if (/^7F04/.test(r) || r.includes('7F04')) throw new ELMError('ЭБУ отказал в сбросе: заглушите двигатель, оставьте зажигание включённым и повторите')
    if (!r.includes('44')) throw new ELMError(NO_ANSWER.test(r) ? 'ЭБУ не ответил на сброс — включено ли зажигание?' : `Неожиданный ответ на сброс: ${r}`)
  }

  /** Напряжение бортсети, которое меряет сам адаптер (работает и при выключенном зажигании). */
  async readAdapterVoltage(): Promise<number | null> {
    try { return parseAdapterVoltage(await this.send('ATRV', 2000)) } catch { return null }
  }

  /** Пробег, прогревы и время работы с момента последнего сброса ошибок (PID 30, 31, 4E). */
  async readSinceClear(): Promise<{ warm: number[] | null; dist: number[] | null; time: number[] | null }> {
    return { warm: await this.pid('30', true), dist: await this.pid('31', true), time: await this.pid('4E', true) }
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
  /** Журнал этапов подключения. */
  log?: (msg: string) => void
}

/** Фабрика сервиса под выбранный способ связи. */
export function createElmService(t: ConnectTarget): ELMService {
  const cfg = { ...DEFAULT_ELM_CONFIG, host: t.host ?? DEFAULT_ELM_CONFIG.host, port: t.port ?? DEFAULT_ELM_CONFIG.port, protocol: t.protocol || undefined, timeoutMs: t.timeoutMs ?? DEFAULT_ELM_CONFIG.timeoutMs }
  if (t.kind === 'mock') return new ELMService(new MockTransport(), cfg)
  if (t.kind === 'ble') {
    if (!t.bleId) throw new Error('Bluetooth-адаптер не выбран')
    return new ELMService(new BleTransport(t.bleId, undefined, { ...(t.attempts ? { attempts: t.attempts } : {}), log: t.log }), cfg)
  }
  // В браузере «сырого» TCP нет — остаётся только мост ws:// (для разработки).
  return new ELMService(Capacitor.isNativePlatform() ? new CapacitorTcpTransport(cfg) : new WebSocketTransport(cfg), cfg)
}
