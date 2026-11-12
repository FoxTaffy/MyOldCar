import { App as CapApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import type { Router } from 'vue-router'
import { showToast } from '@/composables/useToast'

/**
 * Системная кнопка «Назад» (Android):
 *  1) закрывает верхнее окно (меню, панель), если оно открыто;
 *  2) иначе возвращает на предыдущий экран (а не на главный);
 *  3) на главном экране первое нажатие предупреждает, второе (в течение 2 секунд) сворачивает приложение.
 */
const overlays: (() => void)[] = []
/** Пока true — «Назад» ничего не закрывает (обязательный шаг первого запуска). */
let locked: () => boolean = () => false
export const EXIT_WINDOW_MS = 2000
let lastBackAt = -Infinity

/** Регистрирует закрываемое окно; возвращает функцию отмены регистрации. */
export function pushBack(close: () => void): () => void {
  overlays.push(close)
  return () => {
    const i = overlays.lastIndexOf(close)
    if (i >= 0) overlays.splice(i, 1)
  }
}

export function setBackLock(fn: () => boolean): void {
  locked = fn
}

export type BackAction = 'overlay' | 'locked' | 'back' | 'home' | 'warn' | 'exit'

/** Один шаг обработки «Назад»; вынесен отдельно, чтобы тестироваться без Android. */
export function handleBack(router: Router, now = Date.now(), exit: () => void = () => undefined): BackAction {
  const top = overlays[overlays.length - 1]
  if (top) { top(); return 'overlay' }
  if (locked()) return 'locked'
  const route = router.currentRoute.value
  if (route.path !== '/') {
    const hasBack = typeof window !== 'undefined' && (window.history.state as { back?: string | null } | null)?.back != null
    if (hasBack) { router.back(); return 'back' }
    void router.replace('/')
    return 'home'
  }
  if (now - lastBackAt <= EXIT_WINDOW_MS) { lastBackAt = -Infinity; exit(); return 'exit' }
  lastBackAt = now
  showToast('Нажмите «Назад» ещё раз, чтобы выйти')
  return 'warn'
}

export function resetBackForTests(): void {
  overlays.length = 0
  lastBackAt = -Infinity
  locked = () => false
}

export function setupBackButton(router: Router): void {
  if (!Capacitor.isNativePlatform()) return
  void CapApp.addListener('backButton', () => {
    // minimizeApp, а не exitApp: запись поездки и уведомление продолжают работать в фоне.
    handleBack(router, Date.now(), () => { void CapApp.minimizeApp() })
  })
}
