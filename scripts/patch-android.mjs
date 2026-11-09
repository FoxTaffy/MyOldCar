// Дописывает в сгенерированный android/app/src/main/AndroidManifest.xml разрешения для
// фоновой записи поездок (GPS + служба переднего плана) и сканера VIN (камера, ML Kit).
// Запускать после `npx cap add android` (папка android/ в репозитории не хранится).
import { readFileSync, writeFileSync } from 'node:fs'

const path = process.argv[2] ?? 'android/app/src/main/AndroidManifest.xml'
let xml = readFileSync(path, 'utf8')

const perms = [
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  'FOREGROUND_SERVICE',
  'FOREGROUND_SERVICE_LOCATION',
  'POST_NOTIFICATIONS',
  'WAKE_LOCK',
  'CAMERA',
]
const add = perms
  .filter((p) => !xml.includes(`android.permission.${p}"`))
  .map((p) => `    <uses-permission android:name="android.permission.${p}" />`)
if (add.length) xml = xml.replace('</manifest>', `${add.join('\n')}\n</manifest>`)

// ML Kit: заранее скачать модуль сканера штрихкодов вместе с установкой приложения.
const meta = '<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />'
if (!xml.includes('com.google.mlkit.vision.DEPENDENCIES')) xml = xml.replace('</application>', `        ${meta}\n    </application>`)

writeFileSync(path, xml)
console.log(`AndroidManifest patched: +${add.length} permissions`)
