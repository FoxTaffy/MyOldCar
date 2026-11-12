export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
export const REPO = 'FoxTaffy/MyOldCar'

export interface UpdateInfo {
  version: string
  /** Прямая ссылка на .apk (не zip). */
  apkUrl: string
  notes: string
}

/** «v1.2.3» → [1,2,3]; мусор → null. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

export function isNewer(remote: string, local: string): boolean {
  const a = parseVersion(remote)
  const b = parseVersion(local)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i]
  return false
}

interface GhRelease { tag_name?: string; body?: string; draft?: boolean; prerelease?: boolean; assets?: { name?: string; browser_download_url?: string }[] }

/** Последний релиз с .apk-вложением, если он новее текущей версии. */
export function pickUpdate(rel: GhRelease, local = APP_VERSION): UpdateInfo | null {
  if (!rel.tag_name || rel.draft || rel.prerelease || !isNewer(rel.tag_name, local)) return null
  const apk = rel.assets?.find((a) => a.name?.toLowerCase().endsWith('.apk') && a.browser_download_url)
  if (!apk?.browser_download_url) return null
  return { version: rel.tag_name.replace(/^v/, ''), apkUrl: apk.browser_download_url, notes: (rel.body ?? '').trim() }
}

export async function checkForUpdate(fetchFn: typeof fetch = fetch): Promise<UpdateInfo | null> {
  const r = await fetchFn(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
  if (r.status === 404) return null // релизов ещё нет
  if (!r.ok) throw new Error(`GitHub вернул ${r.status}`)
  return pickUpdate((await r.json()) as GhRelease)
}
