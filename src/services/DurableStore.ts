import { Capacitor } from '@capacitor/core'

/**
 * Надёжность хранения. Данные приложения живут в localStorage (синхронно и просто), но WebView может его потерять:
 * очистка «кэша» в настройках Android, сбой обновления WebView, нехватка места. Поэтому:
 *  1) зеркало — снимок всех ключей myoldcar.* регулярно пишется файлом в личную папку приложения;
 *     если при запуске localStorage пуст, а зеркало есть — данные восстанавливаются до старта интерфейса;
 *  2) автокопии — раз в неделю снимок сохраняется отдельным файлом (хранятся последние 4),
 *     их можно восстановить или отправить из «Настройки → Данные»;
 *  3) в браузере просим «постоянное» хранилище (navigator.storage.persist), чтобы его не чистили при нехватке места.
 */

export const PREFIX = 'myoldcar.'
/** Без этого ключа считаем, что данных нет (машины лежат в нём). */
export const MARKER_KEY = 'myoldcar.garage.v2'
/** Служебные ключи, которые не нужно переносить между копиями. */
const VOLATILE = new Set(['myoldcar.errors.v1', 'myoldcar.durable.v1'])
const META_KEY = 'myoldcar.durable.v1'
const MIRROR = 'store/mirror.json'
const BACKUP_DIR = 'backups'
export const BACKUP_EVERY_MS = 7 * 24 * 3600 * 1000
export const KEEP_BACKUPS = 4

export interface Snapshot {
  app: 'myoldcar'
  version: string
  at: string
  data: Record<string, string>
}

interface StorageLike {
  readonly length: number
  key(i: number): string | null
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

/** Все ключи приложения. */
export function collect(st: StorageLike): Record<string, string> {
  const data: Record<string, string> = {}
  for (let i = 0; i < st.length; i++) {
    const k = st.key(i)
    if (k && k.startsWith(PREFIX) && !VOLATILE.has(k)) data[k] = st.getItem(k) ?? ''
  }
  return data
}

export function makeSnapshot(st: StorageLike, version: string, now = new Date()): Snapshot {
  return { app: 'myoldcar', version, at: now.toISOString(), data: collect(st) }
}

/** Разбор файла копии; бросает понятную ошибку, если файл чужой или пустой. */
export function parseSnapshot(text: string): Snapshot {
  let j: Partial<Snapshot>
  try { j = JSON.parse(text) } catch { throw new Error('Файл повреждён или это не JSON') }
  if (j?.app !== 'myoldcar' || !j.data || typeof j.data !== 'object') throw new Error('Это не копия MyOldCar')
  const data: Record<string, string> = {}
  for (const [k, v] of Object.entries(j.data)) if (k.startsWith(PREFIX) && typeof v === 'string' && !VOLATILE.has(k)) data[k] = v
  if (!Object.keys(data).length) throw new Error('В копии нет данных')
  return { app: 'myoldcar', version: String(j.version ?? '?'), at: String(j.at ?? ''), data }
}

export function applySnapshot(st: StorageLike, s: Snapshot): number {
  let n = 0
  for (const [k, v] of Object.entries(s.data)) {
    try { st.setItem(k, v); n++ } catch { /* место кончилось — пишем, что влезло */ }
  }
  return n
}

/** Нужно ли восстанавливать: данных нет, а в зеркале есть машины. */
export function needsRestore(st: StorageLike, mirror: Snapshot | null): boolean {
  return !st.getItem(MARKER_KEY) && !!mirror?.data[MARKER_KEY]
}

/** Какие автокопии удалить, чтобы осталось keep самых свежих (имена с датой сортируются как строки). */
export function backupsToDrop(names: string[], keep = KEEP_BACKUPS): string[] {
  return names.filter((n) => /^myoldcar-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse().slice(keep)
}

export const backupName = (d = new Date()): string => `myoldcar-${d.toISOString().slice(0, 10)}.json`

/* ------------------------------------------------------------------ */
/* Файлы (только на телефоне)                                          */
/* ------------------------------------------------------------------ */

const native = (): boolean => Capacitor.isNativePlatform()
const fs = () => import('@capacitor/filesystem')

async function readFile(path: string): Promise<string | null> {
  const { Filesystem, Directory, Encoding } = await fs()
  try {
    const r = await Filesystem.readFile({ path, directory: Directory.Data, encoding: Encoding.UTF8 })
    return typeof r.data === 'string' ? r.data : await r.data.text()
  } catch {
    return null
  }
}

async function writeFile(path: string, text: string): Promise<void> {
  const { Filesystem, Directory, Encoding } = await fs()
  await Filesystem.writeFile({ path, data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true })
}

interface Meta { lastBackup: number }
function meta(): Meta {
  try { return { lastBackup: 0, ...JSON.parse(localStorage.getItem(META_KEY) ?? '{}') } } catch { return { lastBackup: 0 } }
}

/**
 * Вызывается ДО создания приложения: если localStorage потерян, а зеркало есть — восстанавливаем.
 * Возвращает число восстановленных ключей (0 — ничего не делали).
 */
export async function restoreIfLost(): Promise<number> {
  try { void navigator.storage?.persist?.() } catch { /* ignore */ }
  if (!native()) return 0
  try {
    const text = await readFile(MIRROR)
    const mirror = text ? parseSnapshot(text) : null
    if (mirror && needsRestore(localStorage, mirror)) return applySnapshot(localStorage, mirror)
  } catch { /* зеркало повреждено — работаем с тем, что есть */ }
  return 0
}

let lastMirror = ''
let busy = false

/** Записать зеркало (если что-то поменялось) и, раз в неделю, автокопию. */
export async function flush(version: string): Promise<void> {
  if (!native() || busy) return
  busy = true
  try {
    const snap = makeSnapshot(localStorage, version)
    // Пустое хранилище не должно затирать хорошее зеркало.
    if (!snap.data[MARKER_KEY]) return
    const data = JSON.stringify(snap.data)
    if (data !== lastMirror) {
      await writeFile(MIRROR, JSON.stringify(snap))
      lastMirror = data
    }
    const m = meta()
    if (Date.now() - m.lastBackup >= BACKUP_EVERY_MS) {
      await writeFile(`${BACKUP_DIR}/${backupName()}`, JSON.stringify(snap))
      try { localStorage.setItem(META_KEY, JSON.stringify({ ...m, lastBackup: Date.now() })) } catch { /* ignore */ }
      await pruneBackups()
    }
  } catch (e) {
    console.warn('durable: не удалось сохранить зеркало', e)
  } finally {
    busy = false
  }
}

async function pruneBackups(): Promise<void> {
  const { Filesystem, Directory } = await fs()
  const list = await listBackups()
  for (const n of backupsToDrop(list.map((b) => b.name))) {
    try { await Filesystem.deleteFile({ path: `${BACKUP_DIR}/${n}`, directory: Directory.Data }) } catch { /* ignore */ }
  }
}

export interface BackupFile { name: string; size: number; mtime: number }

export async function listBackups(): Promise<BackupFile[]> {
  if (!native()) return []
  const { Filesystem, Directory } = await fs()
  try {
    const r = await Filesystem.readdir({ path: BACKUP_DIR, directory: Directory.Data })
    return r.files
      .filter((f) => f.type === 'file' && f.name.endsWith('.json'))
      .map((f) => ({ name: f.name, size: f.size, mtime: f.mtime }))
      .sort((a, b) => b.name.localeCompare(a.name))
  } catch {
    return []
  }
}

export async function readBackup(name: string): Promise<Snapshot> {
  const text = await readFile(`${BACKUP_DIR}/${name}`)
  if (!text) throw new Error('Файл копии не найден')
  return parseSnapshot(text)
}

/** Сделать автокопию прямо сейчас (кнопка в настройках). */
export async function backupNow(version: string): Promise<string | null> {
  if (!native()) return null
  const snap = makeSnapshot(localStorage, version)
  const name = backupName()
  await writeFile(`${BACKUP_DIR}/${name}`, JSON.stringify(snap))
  try { localStorage.setItem(META_KEY, JSON.stringify({ ...meta(), lastBackup: Date.now() })) } catch { /* ignore */ }
  await pruneBackups()
  return name
}

/** Периодическое зеркалирование: раз в минуту и при уходе приложения в фон. */
export function startMirroring(version: string): void {
  if (!native()) return
  const run = () => void flush(version)
  setTimeout(run, 5000)
  setInterval(run, 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') run() })
  window.addEventListener('pagehide', run)
}
