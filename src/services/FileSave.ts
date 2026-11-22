import { Capacitor } from '@capacitor/core'

/**
 * Отдать пользователю файл (резервная копия, CSV, GPX).
 * В Android/iOS WebView ссылка с download не работает, поэтому на телефоне файл пишется во временную папку
 * приложения и открывается системное окно «Поделиться» (сохранить в Файлы, отправить в мессенджер, на почту).
 * В браузере — обычная загрузка.
 * Возвращает true, если файл отдан (или окно «Поделиться» открыто).
 */
export async function saveTextFile(name: string, mime: string, text: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
    const { Share } = await import('@capacitor/share')
    const res = await Filesystem.writeFile({ path: `export/${name}`, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true })
    try {
      await Share.share({ title: name, files: [res.uri], dialogTitle: 'Сохранить или отправить' })
    } catch (e) {
      // Пользователь закрыл окно — это не ошибка.
      if (/cancel/i.test(String(e))) return false
      throw e
    }
    return true
  }
  const blob = new Blob([text], { type: mime })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  return true
}

/** Имя файла без запрещённых символов. */
export const safeFileName = (s: string): string => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || 'file'
