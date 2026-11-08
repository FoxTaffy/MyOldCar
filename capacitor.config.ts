import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'ru.myoldcar.scanner',
  appName: 'MyOldCar',
  webDir: 'dist',
  android: { allowMixedContent: true },
}
export default config
