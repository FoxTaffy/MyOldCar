import { ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { APP_VERSION, REPO, checkForUpdate, type UpdateInfo } from '@/services/Updater'

const update = ref<UpdateInfo | null>(null)
const checking = ref(false)
const error = ref<string | null>(null)
/** null — ещё не проверяли; true — проверили, новее ничего нет. */
const upToDate = ref<boolean | null>(null)

async function check(): Promise<void> {
  if (checking.value) return
  checking.value = true
  error.value = null
  try {
    update.value = await checkForUpdate()
    upToDate.value = update.value === null
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    checking.value = false
  }
}

/** Открывает прямую ссылку на .apk: Android скачает файл и предложит «Обновить» поверх установленного. */
async function install(): Promise<void> {
  const u = update.value
  if (!u) return
  if (Capacitor.isNativePlatform()) {
    const { Browser } = await import('@capacitor/browser')
    // iOS не ставит .apk: открываем страницу релиза, откуда берётся .ipa для AltStore/Sideloadly.
    const url = Capacitor.getPlatform() === 'ios' ? `https://github.com/${REPO}/releases/latest` : u.apkUrl
    await Browser.open({ url })
  } else {
    window.open(u.apkUrl, '_blank')
  }
}

export function useUpdate() {
  return { version: APP_VERSION, update, checking, error, upToDate, check, install }
}
