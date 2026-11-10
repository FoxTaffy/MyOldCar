// Запускается после `npx cap add android`: добавляет в сгенерированный проект всё для постоянного уведомления
// (foreground-сервис), т.к. папка android/ не хранится в репозитории. Идемпотентен.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = join(root, 'android/app/src/main/AndroidManifest.xml')
if (!existsSync(manifestPath)) throw new Error('Нет android/ — сначала выполните `npx cap add android`')

let xml = readFileSync(manifestPath, 'utf8')

const perms = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.WAKE_LOCK',
  // Фоновая запись поездок (GPS): точная/примерная геопозиция, «всегда» и служба геопозиции.
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.FOREGROUND_SERVICE_LOCATION',
  // Сканер VIN (камера, ML Kit).
  'android.permission.CAMERA',
]
const missing = perms.filter((p) => !xml.includes(`"${p}"`))
if (missing.length) {
  xml = xml.replace('</manifest>', missing.map((p) => `    <uses-permission android:name="${p}" />`).join('\n') + '\n</manifest>')
}

if (!xml.includes('AndroidForegroundService')) {
  const block = `
        <receiver android:name="io.capawesome.capacitorjs.plugins.foregroundservice.NotificationActionBroadcastReceiver" />
        <service
            android:name="io.capawesome.capacitorjs.plugins.foregroundservice.AndroidForegroundService"
            android:exported="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="Постоянное уведомление и опрос OBD-II адаптера, пока машина подключена" />
        </service>
`
  xml = xml.replace('</application>', block + '    </application>')
}
// ML Kit: заранее скачать модуль сканера штрихкодов вместе с установкой приложения.
const mlkit = '<meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui" />'
if (!xml.includes('com.google.mlkit.vision.DEPENDENCIES')) xml = xml.replace('</application>', `        ${mlkit}\n    </application>`)

writeFileSync(manifestPath, xml)

const drawable = join(root, 'android/app/src/main/res/drawable')
mkdirSync(drawable, { recursive: true })
copyFileSync(join(root, 'resources/notification/ic_stat_car.xml'), join(drawable, 'ic_stat_car.xml'))
console.log('android: манифест и иконка уведомления обновлены')

// Постоянная подпись: без неё каждая CI-сборка подписывается новым debug-ключом и Android
// отказывается ставить её поверх старой (пришлось бы удалять приложение).
// Ключ в репозиторий не кладём: CI восстанавливает его из секретов GitHub и передаёт путь/пароли через env.
const gradlePath = join(root, 'android/app/build.gradle')
let gradle = readFileSync(gradlePath, 'utf8')
const ks = process.env.KEYSTORE_PATH
if (ks && !gradle.includes('KEYSTORE_PATH')) {
  gradle = gradle.replace(
    /android\s*\{/,
    `android {
    signingConfigs {
        debug {
            storeFile file(System.getenv("KEYSTORE_PATH"))
            storePassword System.getenv("KEYSTORE_PASSWORD")
            keyAlias System.getenv("KEY_ALIAS")
            keyPassword System.getenv("KEY_PASSWORD")
        }
    }`,
  )
} else if (!ks) {
  console.warn('ВНИМАНИЕ: KEYSTORE_PATH не задан — APK подписан временным ключом, поверх прошлых сборок он НЕ установится')
}
// versionCode обязан расти от сборки к сборке, иначе обновление не установится.
const code = process.env.VERSION_CODE || '1'
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${code}`).replace(/versionName\s+"[^"]*"/, `versionName "${pkg.version}"`)
writeFileSync(gradlePath, gradle)
console.log(`android: версия ${pkg.version} (${code}), подпись: ${ks ? 'постоянный ключ' : 'временная'}`)
