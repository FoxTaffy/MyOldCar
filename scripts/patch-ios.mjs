// Запускается после `npx cap add ios`: добавляет в Info.plist описания разрешений и фоновые режимы,
// т.к. папка ios/ не хранится в репозитории. Идемпотентен.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const plistPath = join(root, 'ios/App/App/Info.plist')
if (!existsSync(plistPath)) throw new Error('Нет ios/ — сначала выполните `npx cap add ios`')

let plist = readFileSync(plistPath, 'utf8')
const str = (k, v) => `\t<key>${k}</key>\n\t<string>${v}</string>\n`

const entries = [
  ['NSBluetoothAlwaysUsageDescription', 'Bluetooth нужен для связи с OBD-II адаптером ELM327.'],
  ['NSLocationWhenInUseUsageDescription', 'Геопозиция нужна для записи маршрута и скорости поездки.'],
  ['NSLocationAlwaysAndWhenInUseUsageDescription', 'Геопозиция в фоне нужна, чтобы запись поездки не прерывалась при свёрнутом приложении.'],
  ['NSCameraUsageDescription', 'Камера нужна для сканирования VIN-кода.'],
  ['NSLocalNetworkUsageDescription', 'Локальная сеть нужна для подключения к Wi-Fi OBD-II адаптеру.'],
]
let add = ''
for (const [k, v] of entries) if (!plist.includes(`<key>${k}</key>`)) add += str(k, v)

if (!plist.includes('<key>UIBackgroundModes</key>')) {
  add += '\t<key>UIBackgroundModes</key>\n\t<array>\n\t\t<string>location</string>\n\t\t<string>bluetooth-central</string>\n\t</array>\n'
}
if (add) plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${add}</dict>\n</plist>\n`)
writeFileSync(plistPath, plist)
console.log('ios: Info.plist обновлён')
