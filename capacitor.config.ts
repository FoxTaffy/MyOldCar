import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.myoldcar.scanner',
  appName: 'MyOldCar',
  webDir: 'dist',
  // useLegacyBridge: без него Android через ~5 минут в фоне перестаёт доставлять в WebView
  // точки GPS от фоновой службы — поездка «замирала» на первых секундах.
  android: { allowMixedContent: true, useLegacyBridge: true },
}
export default config
