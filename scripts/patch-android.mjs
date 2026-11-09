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
writeFileSync(manifestPath, xml)

const drawable = join(root, 'android/app/src/main/res/drawable')
mkdirSync(drawable, { recursive: true })
copyFileSync(join(root, 'resources/notification/ic_stat_car.xml'), join(drawable, 'ic_stat_car.xml'))
console.log('android: манифест и иконка уведомления обновлены')
