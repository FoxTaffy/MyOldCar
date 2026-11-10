// Дописывает в сгенерированный android/app/src/main/AndroidManifest.xml разрешения для
// фоновой записи поездок (GPS + служба переднего плана) и сканера VIN (камера, ML Kit).
// Запускать после `npx cap add android` (папка android/ в репозитории не хранится).
import { readFileSync, writeFileSync } from 'node:fs'
import nodePath from 'node:path'

// Версия APK = версия из package.json: versionName как есть, versionCode = major*10000 + minor*100 + patch.
const [maj, min, pat] = JSON.parse(readFileSync('package.json', 'utf8')).version.split('.').map(Number)
const versionCode = maj * 10000 + min * 100 + pat

const path = process.argv[2] ?? 'android/app/src/main/AndroidManifest.xml'
let xml = readFileSync(path, 'utf8')

const perms = [
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  // Геопозиция «всегда»: без неё Android 10+ не даёт писать поездку при выключенном экране.
  'ACCESS_BACKGROUND_LOCATION',
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

// Версия приложения: Capacitor генерирует versionName "1.0" и versionCode 1, берём их из package.json.
// android/app/src/main/AndroidManifest.xml -> android/app/build.gradle
const gradlePath = nodePath.resolve(nodePath.dirname(path), '../../build.gradle')
try {
  let gradle = readFileSync(gradlePath, 'utf8')
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`).replace(/versionName\s+"[^"]*"/, `versionName "${maj}.${min}.${pat}"`)
  writeFileSync(gradlePath, gradle)
  console.log(`app version ${maj}.${min}.${pat} (code ${versionCode})`)
} catch {
  console.warn(`build.gradle не найден (${gradlePath}), версия APK не обновлена`)
}
