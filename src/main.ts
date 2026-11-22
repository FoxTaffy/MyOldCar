import { createApp } from 'vue'
import { restoreIfLost, startMirroring } from './services/DurableStore'
import { installErrorLog, logError } from './services/ErrorLog'
import '@fontsource/ibm-plex-sans/cyrillic-400.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/cyrillic-500.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/cyrillic-600.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans-condensed/latin-500.css'
import '@fontsource/ibm-plex-sans-condensed/latin-600.css'
import '@fontsource/ibm-plex-mono/cyrillic-500.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './style.css'

// Хранилище проверяем ДО загрузки интерфейса: модули машин, поездок и настроек читают localStorage при импорте.
async function boot(): Promise<void> {
  const restored = await restoreIfLost().catch(() => 0)
  if (restored) sessionStorage.setItem('myoldcar-restored', String(restored))
  const [{ default: App }, { router }, { setupBackButton }] = await Promise.all([import('./App.vue'), import('./router'), import('./services/BackHandler')])
  setupBackButton(router)
  const app = createApp(App).use(router)
  installErrorLog(app, () => router.currentRoute.value.fullPath)
  app.mount('#app')
  startMirroring(__APP_VERSION__)
}

boot().catch((e) => {
  logError('boot', e)
  document.body.textContent = `Не удалось запустить приложение: ${e instanceof Error ? e.message : String(e)}`
})
