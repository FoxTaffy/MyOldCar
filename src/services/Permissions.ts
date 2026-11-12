import { Capacitor } from '@capacitor/core'

/** Состояние разрешения для экрана «Разрешения приложения». */
export type PermState = 'granted' | 'denied' | 'prompt' | 'unknown'

export interface PermInfo {
  id: 'location' | 'background' | 'bluetooth' | 'notifications' | 'camera' | 'battery'
  title: string
  /** Что рекомендуется выставить. */
  recommended: string
  desc: string[]
  state: PermState
  /** Нельзя проверить из приложения — показываем только инструкцию. */
  manual?: boolean
}

export const STATE_TEXT: Record<PermState, string> = { granted: 'Разрешено', denied: 'Не разрешено', prompt: 'Не запрошено', unknown: 'Проверьте' }

const native = Capacitor.isNativePlatform()
const norm = (s: string | undefined): PermState => (s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : s === 'prompt' || s === 'prompt-with-rationale' ? 'prompt' : 'unknown')

/** Запрос в браузере через Permissions API — для разработки; на телефоне всё идёт через плагины. */
async function webState(name: string): Promise<PermState> {
  try { return norm((await navigator.permissions.query({ name: name as PermissionName })).state) } catch { return 'unknown' }
}

export async function checkPermissions(): Promise<PermInfo[]> {
  let location: PermState = 'unknown'
  let background: PermState = 'unknown'
  let notifications: PermState = 'unknown'
  let camera: PermState = 'unknown'
  let bluetooth: PermState = 'unknown'
  if (native) {
    try {
      const { BackgroundGeolocation } = await import('@capgo/background-geolocation')
      const p = await BackgroundGeolocation.checkPermissions()
      location = norm(p.location)
      background = norm(p.backgroundLocation)
    } catch { /* плагин недоступен */ }
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications')
      notifications = norm((await LocalNotifications.checkPermissions()).display)
    } catch { /* ignore */ }
    try {
      const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
      camera = norm((await BarcodeScanner.checkPermissions()).camera)
    } catch { /* ignore */ }
    try {
      const { BleClient } = await import('@capacitor-community/bluetooth-le')
      await BleClient.initialize()
      bluetooth = (await BleClient.isEnabled()) ? 'granted' : 'denied'
    } catch { bluetooth = 'denied' }
  } else {
    location = await webState('geolocation')
    notifications = await webState('notifications')
    camera = await webState('camera')
  }
  return [
    { id: 'location', title: 'Доступ к геопозиции', recommended: 'Разрешить', state: location, desc: ['Нужна, чтобы записывать маршрут и пробег поездок и считать скорость, если датчик скорости машины молчит.', 'Точность лучше, когда включена «точная геопозиция».'] },
    { id: 'background', title: 'Геопозиция «Всегда»', recommended: 'Разрешить всегда', state: background, desc: ['Без неё запись поездки остановится, когда экран погаснет или приложение свёрнуто.', 'Android выдаёт «Всегда» отдельным шагом в настройках приложения → Геопозиция.'] },
    { id: 'bluetooth', title: 'Bluetooth и устройства рядом', recommended: 'Разрешить', state: bluetooth, desc: ['Нужно, чтобы найти OBD-адаптер и подключиться к нему.', 'Если стоит «Не разрешено» — включите Bluetooth в шторке или выдайте право «Устройства поблизости».'] },
    { id: 'notifications', title: 'Уведомления', recommended: 'Разрешить', state: notifications, desc: ['Уведомление службы записи поездки и сообщение «двигатель прогрет — можно ехать».', 'Без него Android может остановить фоновую запись.'] },
    { id: 'camera', title: 'Камера', recommended: 'Разрешить', state: camera, desc: ['Нужна только для сканирования штрихкода VIN при добавлении автомобиля.'] },
    { id: 'battery', title: 'Экономия заряда', recommended: 'Без ограничений', state: 'unknown', manual: true, desc: ['Если прошивка усыпляет приложение, запись обрывается. Откройте настройки приложения → Батарея → «Без ограничений».', 'Особенно важно на Xiaomi, Huawei, Samsung: отключите «экономию батареи» и разрешите автозапуск.'] },
  ]
}

/** Показывает системный запрос разрешения; для «Всегда» Android требует отдельного шага. */
export async function requestPermission(id: PermInfo['id']): Promise<void> {
  if (!native) {
    if (id === 'location' || id === 'background') await new Promise<void>((res) => navigator.geolocation.getCurrentPosition(() => res(), () => res()))
    if (id === 'notifications' && 'Notification' in window) await Notification.requestPermission()
    return
  }
  if (id === 'location' || id === 'background') {
    const { BackgroundGeolocation } = await import('@capgo/background-geolocation')
    await BackgroundGeolocation.requestPermissions({ permissions: id === 'background' ? ['backgroundLocation'] : ['location', 'notification'] })
  } else if (id === 'notifications') {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    await LocalNotifications.requestPermissions()
  } else if (id === 'camera') {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning')
    await BarcodeScanner.requestPermissions()
  } else if (id === 'bluetooth') {
    const { BleClient } = await import('@capacitor-community/bluetooth-le')
    await BleClient.initialize()
    await BleClient.requestEnable().catch(() => undefined)
  }
}

export async function openAppSettings(): Promise<void> {
  if (!native) return
  const { BackgroundGeolocation } = await import('@capgo/background-geolocation')
  await BackgroundGeolocation.openSettings().catch(() => undefined)
}
export const isNative = native
