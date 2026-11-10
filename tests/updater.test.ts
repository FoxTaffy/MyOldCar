import { describe, expect, it } from 'vitest'
import { checkForUpdate, isNewer, parseVersion, pickUpdate } from '@/services/Updater'

const rel = (tag: string, name = 'MyOldCar.apk') => ({ tag_name: tag, body: 'notes', assets: [{ name: 'x.zip', browser_download_url: 'z' }, { name, browser_download_url: `https://x/${name}` }] })

describe('Updater', () => {
  it('сравнивает версии по числам, а не по строкам', () => {
    expect(parseVersion('v1.10.0')).toEqual([1, 10, 0])
    expect(parseVersion('abc')).toBeNull()
    expect(isNewer('v0.10.0', '0.9.5')).toBe(true)
    expect(isNewer('v0.2.0', '0.2.0')).toBe(false)
    expect(isNewer('0.1.9', '0.2.0')).toBe(false)
    expect(isNewer('junk', '0.2.0')).toBe(false)
  })
  it('берёт именно .apk, новее только если версия выше', () => {
    expect(pickUpdate(rel('v0.3.0'), '0.2.0')).toEqual({ version: '0.3.0', apkUrl: 'https://x/MyOldCar.apk', notes: 'notes' })
    expect(pickUpdate(rel('v0.2.0'), '0.2.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v9.0.0', assets: [{ name: 'a.zip', browser_download_url: 'z' }] }, '0.2.0')).toBeNull()
    expect(pickUpdate({ ...rel('v9.0.0'), prerelease: true }, '0.2.0')).toBeNull()
  })
  it('404 — релизов нет; ошибка сети/сервера пробрасывается', async () => {
    expect(await checkForUpdate((async () => new Response('', { status: 404 })) as typeof fetch)).toBeNull()
    await expect(checkForUpdate((async () => new Response('', { status: 500 })) as typeof fetch)).rejects.toThrow('500')
    expect(await checkForUpdate((async () => new Response(JSON.stringify(rel('v99.0.0')))) as typeof fetch)).toMatchObject({ version: '99.0.0' })
  })
})
