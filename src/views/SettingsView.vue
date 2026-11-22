<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Capacitor } from '@capacitor/core'
import { useWeather } from '@/composables/useWeather'
import AppIcon from '@/components/AppIcon.vue'
import ChoiceSheet from '@/components/ChoiceSheet.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToggleRow from '@/components/ToggleRow.vue'
import { useGarage } from '@/composables/useGarage'
import { useUpdate } from '@/composables/useUpdate'
import { showWizard, useUi, type ThemeMode } from '@/composables/useUi'
import { useVehicle } from '@/composables/useVehicle'
import type { AppSettings } from '@/types'
import { applySnapshot, backupNow, flush, listBackups, makeSnapshot, parseSnapshot, readBackup, type BackupFile, type Snapshot } from '@/services/DurableStore'
import { clearErrors, errorLog, errorReport } from '@/services/ErrorLog'
import { saveTextFile } from '@/services/FileSave'
import { dateTime, todayISO } from '@/utils/format'

const { ui } = useUi()
const { garage, clearTrips } = useGarage()
const { settings } = useVehicle()
const up = useUpdate()
const THEMES: { id: ThemeMode; label: string; icon: string }[] = [{ id: 'light', label: 'Светлая', icon: 'sun' }, { id: 'dark', label: 'Тёмная', icon: 'moon' }, { id: 'auto', label: 'Как в системе', icon: 'gear' }]
const TIRES: { id: 'auto' | 'summer' | 'winter' | 'all'; label: string }[] = [{ id: 'auto', label: 'Не знаю' }, { id: 'summer', label: 'Летняя' }, { id: 'winter', label: 'Зимняя' }, { id: 'all', label: 'Всесезон' }]
const pick = ref<'limit' | 'warn' | null>(null)
const LIMITS = [90, 100, 110, 120, 130, 140].map((n) => ({ id: String(n), label: `${n} км/ч` }))
const WARNS = [70, 80, 90].map((n) => ({ id: String(n), label: `${n} % интервала` }))
const toggles: { key: keyof AppSettings; label: string; hint: string }[] = [
  { key: 'recentFuelServicing', label: 'Недавно обслуживались топливные магистрали / бак', hint: 'Повышает вероятность проблем с давлением топлива' },
  { key: 'recentAirIntakeServicing', label: 'Недавно трогали впуск (ДМРВ, гофра, фильтр)', hint: 'Повышает вероятность подсоса воздуха' },
  { key: 'recentIgnitionServicing', label: 'Недавно меняли свечи / провода / модуль', hint: 'Учитывается при пропусках зажигания' },
  { key: 'coldStartOnly', label: 'Неисправность проявляется только на холодном', hint: 'Влияет на оценку модуля зажигания' },
]
// Ключ Яндекс.Погоды редактируется как черновик и применяется только по кнопке «Сохранить».
const keyDraft = ref(ui.yandexKey)
const keyDirty = computed(() => keyDraft.value.trim() !== ui.yandexKey)
const saveKey = (): void => {
  ui.yandexKey = keyDraft.value.replace(/\s+/g, '')
  keyDraft.value = ui.yandexKey
  void useWeather().refresh(true)
  flash('Ключ сохранён')
}
const resetKey = (): void => { keyDraft.value = ui.yandexKey }
// Ключ Яндекс.Карт: так же, черновик + «Сохранить» / «Сбросить».
const mapDraft = ref(ui.yandexMapKey)
const mapDirty = computed(() => mapDraft.value.trim() !== ui.yandexMapKey)
const saveMapKey = (): void => {
  ui.yandexMapKey = mapDraft.value.replace(/\s+/g, '')
  mapDraft.value = ui.yandexMapKey
  flash(ui.yandexMapKey ? 'Ключ карт сохранён — откройте карту заново' : 'Ключ карт удалён — будет OpenStreetMap')
}
const resetMapKey = (): void => { mapDraft.value = ui.yandexMapKey }
const msg = ref<string | null>(null)
const flash = (t: string): void => { msg.value = t; setTimeout(() => { if (msg.value === t) msg.value = null }, 3500) }

/** Резервная копия: всё, что приложение хранит на телефоне (машины, поездки, журнал, настройки). */
async function exportBackup(): Promise<void> {
  try {
    const snap = makeSnapshot(localStorage, up.version)
    if (await saveTextFile(`myoldcar-backup-${todayISO()}.json`, 'application/json', JSON.stringify(snap))) flash(isNative ? 'Копия готова — выберите, куда сохранить' : 'Копия сохранена в «Загрузки»')
  } catch (e) { flash(e instanceof Error ? e.message : 'Не удалось сохранить копию') }
}
function restoreSnapshot(snap: Snapshot): void {
  if (!confirm(`Заменить данные на телефоне данными из копии${snap.at ? ' от ' + dateTime(Date.parse(snap.at)) : ''} (${Object.keys(snap.data).length} записей)? Текущие будут перезаписаны.`)) return
  applySnapshot(localStorage, snap)
  flash('Данные восстановлены, перезапускаю…')
  setTimeout(() => location.reload(), 900)
}
function importBackup(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  const rd = new FileReader()
  rd.onload = () => {
    try { restoreSnapshot(parseSnapshot(String(rd.result))) } catch (err) { flash(err instanceof Error ? err.message : 'Не удалось прочитать файл') }
  }
  rd.readAsText(f)
}

/* Автокопии (только на телефоне): раз в неделю, хранятся 4 последние. */
const isNative = Capacitor.isNativePlatform()
const autoBackups = ref<BackupFile[]>([])
const refreshBackups = async (): Promise<void> => { autoBackups.value = await listBackups() }
onMounted(() => { void refreshBackups() })
async function makeBackupNow(): Promise<void> {
  try { await flush(up.version); const n = await backupNow(up.version); await refreshBackups(); if (n) flash('Копия сделана') } catch (e) { flash(e instanceof Error ? e.message : 'Не удалось сделать копию') }
}
async function restoreAuto(name: string): Promise<void> {
  try { restoreSnapshot(await readBackup(name)) } catch (e) { flash(e instanceof Error ? e.message : 'Не удалось прочитать копию') }
}
async function shareAuto(name: string): Promise<void> {
  try { await saveTextFile(name, 'application/json', JSON.stringify(await readBackup(name))) } catch (e) { flash(e instanceof Error ? e.message : 'Не удалось отправить копию') }
}
const kb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} МБ` : `${Math.max(1, Math.round(n / 1024))} КБ`)

/* Журнал ошибок */
const showErrors = ref(false)
async function copyErrors(): Promise<void> {
  try { await navigator.clipboard.writeText(errorReport(errorLog.value, up.version)); flash('Журнал скопирован — отправьте его разработчику') } catch { flash('Не удалось скопировать') }
}
async function shareErrors(): Promise<void> {
  try { await saveTextFile(`myoldcar-errors-${todayISO()}.txt`, 'text/plain', errorReport(errorLog.value, up.version)) } catch (e) { flash(e instanceof Error ? e.message : 'Не удалось отправить') }
}
function wipeTrips(): void { if (confirm('Удалить все поездки? Расходы, машины и масло сохранятся.')) { clearTrips(); flash('Поездки удалены') } }
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Настройки" />

    <h2 class="h-section !pt-1">Интерфейс</h2>
    <div class="card overflow-hidden">
      <div class="px-4 py-3">
        <div class="row-title mb-2">Тема</div>
        <div class="grid grid-cols-3 gap-2">
          <button v-for="t in THEMES" :key="t.id" class="flex flex-col items-center gap-1 rounded-xl border py-3 text-xs font-medium transition" :class="ui.theme === t.id ? 'border-accent bg-accent-soft text-accent' : 'border-night-600 text-mute'" :aria-pressed="ui.theme === t.id" @click="ui.theme = t.id"><AppIcon :name="t.icon" />{{ t.label }}</button>
        </div>
      </div>
      <div class="row">
        <span class="row-title">Размер шрифта</span>
        <span class="flex items-center gap-1">
          <button class="flex h-9 w-9 items-center justify-center rounded-full bg-night-700 active:bg-night-600 disabled:opacity-30" :disabled="ui.fontStep <= -2" aria-label="Мельче" @click="ui.fontStep--"><AppIcon name="minus" :size="18" /></button>
          <span class="w-8 text-center text-sm font-bold tabular-nums">{{ ui.fontStep > 0 ? '+' : '' }}{{ ui.fontStep }}</span>
          <button class="flex h-9 w-9 items-center justify-center rounded-full bg-night-700 active:bg-night-600 disabled:opacity-30" :disabled="ui.fontStep >= 3" aria-label="Крупнее" @click="ui.fontStep++"><AppIcon name="plus" :size="18" /></button>
        </span>
      </div>
      <ToggleRow v-model="ui.animations" title="Анимации интерфейса" />
      <ToggleRow v-model="ui.zoneColors" title="Цвета зон на плитках" sub="Оранжевый и красный, когда значение вышло из нормы" />
      <ToggleRow v-model="ui.graphFill" title="Заливка под графиком" />
      <RouterLink to="/edit-home" class="row"><span class="row-title">Главный экран</span><AppIcon name="chevron" :size="18" class="text-faint" /></RouterLink>
    </div>

    <h2 class="h-section">Вождение и обслуживание</h2>
    <div class="card overflow-hidden">
      <button class="row" @click="pick = 'limit'"><span class="min-w-0"><span class="row-title">Порог превышения скорости</span><span class="row-sub">Для оценки стиля вождения; считается для новых поездок</span></span><span class="row-val">{{ ui.speedLimit }} км/ч</span></button>
      <button class="row" @click="pick = 'warn'"><span class="min-w-0"><span class="row-title">Напоминать об обслуживании</span><span class="row-sub">Когда выработано не меньше этой доли интервала</span></span><span class="row-val">{{ ui.warnPct }} %</span></button>
      <label class="row"><span class="row-title">Цена топлива, {{ ui.currency }}/л</span><input v-model.number="garage.fuelPrice" type="number" min="0" step="0.5" inputmode="decimal" class="w-24 bg-transparent text-right text-sm font-medium text-accent outline-none"></label>
    </div>

    <h2 class="h-section">Погода и дорога</h2>
    <div class="card overflow-hidden">
      <ToggleRow v-model="ui.weatherCard" title="Карточка погоды на главной" sub="Сегодня, завтра и советы: гололёд, дождь, ветер, смена резины" />
      <div class="px-4 py-3">
        <div class="row-title mb-2">Какая резина стоит</div>
        <div class="grid grid-cols-4 gap-2">
          <button v-for="t in TIRES" :key="t.id" class="rounded-xl border py-2 text-xs font-medium transition" :class="ui.tires === t.id ? 'border-accent bg-accent-soft text-accent' : 'border-night-600 text-mute'" :aria-pressed="ui.tires === t.id" @click="ui.tires = t.id">{{ t.label }}</button>
        </div>
        <p class="mt-2 text-xs text-faint">Нужна, чтобы напоминать о переобувании только когда это актуально.</p>
      </div>
      <label class="row"><span class="min-w-0"><span class="row-title">Ключ API Яндекс.Погоды</span><span class="row-sub">Необязательно. Без ключа прогноз берётся из Open-Meteo. Ключ выдаёт кабинет разработчика Яндекса (платный тариф).</span></span><input v-model="keyDraft" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="не задан" class="w-28 bg-transparent text-right text-sm font-medium text-accent outline-none placeholder:text-faint" /></label>
      <div v-if="keyDirty" class="flex gap-2 px-4 pb-3">
        <button type="button" class="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white" @click="saveKey">Сохранить</button>
        <button type="button" class="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium" @click="resetKey">Сбросить</button>
      </div>
    </div>

    <h2 class="h-section">Карта</h2>
    <div class="card overflow-hidden">
      <label class="row"><span class="min-w-0"><span class="row-title">Ключ API Яндекс.Карт</span><span class="row-sub">Необязательно. С ключом карты поездок рисует Яндекс (JS API v3), без него или без интернета — OpenStreetMap. Ключ: кабинет разработчика Яндекса.</span></span><input v-model="mapDraft" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="не задан" class="w-28 bg-transparent text-right text-sm font-medium text-accent outline-none placeholder:text-faint" /></label>
      <div v-if="mapDirty" class="flex gap-2 px-4 pb-3">
        <button type="button" class="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white" @click="saveMapKey">Сохранить</button>
        <button type="button" class="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium" @click="resetMapKey">Сбросить</button>
      </div>
    </div>

    <h2 class="h-section">Подключение</h2>
    <div class="card overflow-hidden">
      <RouterLink to="/connection" class="row"><span class="row-title">Подключение сканера</span><AppIcon name="chevron" :size="18" class="text-faint" /></RouterLink>
      <RouterLink to="/permissions" class="row"><span class="row-title">Разрешения приложения</span><AppIcon name="chevron" :size="18" class="text-faint" /></RouterLink>
      <button class="row" @click="showWizard = true"><span class="row-title">Мастер первой настройки</span><AppIcon name="chevron" :size="18" class="text-faint" /></button>
    </div>

    <h2 class="h-section">Что недавно делали с машиной</h2>
    <p class="-mt-1 px-1 text-xs text-faint">Учитывается при оценке причин ошибок — пересчёт идёт сразу.</p>
    <div class="card overflow-hidden">
      <ToggleRow v-for="t in toggles" :key="t.key" v-model="settings[t.key]" :title="t.label" :sub="t.hint" />
    </div>

    <h2 class="h-section">Данные</h2>
    <div class="card overflow-hidden">
      <button class="row" @click="exportBackup"><span class="min-w-0"><span class="row-title">Сохранить резервную копию</span><span class="row-sub">Машины, поездки, журнал и настройки одним файлом</span></span><AppIcon name="download" :size="20" class="text-accent" /></button>
      <label class="row cursor-pointer"><span class="min-w-0"><span class="row-title">Восстановить из копии</span><span class="row-sub">Например, при переезде на новый телефон</span></span><AppIcon name="refresh" :size="20" class="text-accent" /><input type="file" accept=".json,application/json" class="hidden" @change="importBackup"></label>
      <template v-if="isNative">
        <button class="row" @click="makeBackupNow"><span class="min-w-0"><span class="row-title">Автокопии на телефоне</span><span class="row-sub">Делаются раз в неделю, хранятся 4 последние. Если система очистит данные приложения, они вернутся сами при запуске.</span></span><span class="row-val">Сделать</span></button>
        <div v-for="b in autoBackups" :key="b.name" class="row">
          <span class="min-w-0"><span class="row-title font-mono text-sm">{{ b.name.replace('myoldcar-', '').replace('.json', '') }}</span><span class="row-sub">{{ kb(b.size) }}</span></span>
          <span class="flex gap-3">
            <button class="text-sm font-medium text-accent" @click="shareAuto(b.name)">Отправить</button>
            <button class="text-sm font-medium text-accent" @click="restoreAuto(b.name)">Вернуть</button>
          </span>
        </div>
      </template>
      <button class="row" @click="wipeTrips"><span class="row-title !text-bad">Удалить все поездки</span><AppIcon name="trash" :size="20" class="text-bad" /></button>
    </div>
    <h2 class="h-section">Журнал ошибок</h2>
    <div class="card overflow-hidden">
      <button class="row" @click="showErrors = !showErrors">
        <span class="min-w-0"><span class="row-title">Ошибки приложения</span><span class="row-sub">Сбои интерфейса и фоновых задач. Хранятся только на телефоне.</span></span>
        <span class="row-val" :class="errorLog.length ? 'text-warn' : ''">{{ errorLog.length || 'нет' }}</span>
      </button>
      <template v-if="showErrors && errorLog.length">
        <ul class="max-h-80 divide-y divide-night-600 overflow-auto px-4 text-xs">
          <li v-for="(e, i) in errorLog.slice().reverse()" :key="i" class="py-2">
            <div class="flex justify-between gap-2 text-faint"><span>{{ dateTime(e.at) }} · {{ e.source }}<template v-if="e.route"> · {{ e.route }}</template></span><span v-if="e.count > 1">×{{ e.count }}</span></div>
            <div class="mt-0.5 break-words font-mono text-soft">{{ e.message }}</div>
          </li>
        </ul>
        <div class="flex gap-2 px-4 py-3">
          <button class="flex-1 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white" @click="copyErrors">Копировать</button>
          <button class="flex-1 rounded-lg border border-line px-3 py-2 text-sm font-medium" @click="shareErrors">Отправить</button>
          <button class="rounded-lg border border-line px-3 py-2 text-sm font-medium text-bad" @click="clearErrors(); flash('Журнал очищен')">Очистить</button>
        </div>
      </template>
    </div>

    <p v-if="msg" class="rounded-xl bg-accent-soft px-3 py-2 text-sm text-soft" role="status">{{ msg }}</p>

    <h2 class="h-section">О приложении</h2>
    <div class="card space-y-3 p-4">
      <p class="text-sm">Версия: <b class="tabular-nums">{{ up.version }}</b></p>
      <template v-if="up.update.value">
        <p class="text-sm text-ok">Доступна версия <b>{{ up.update.value.version }}</b></p>
        <p v-if="up.update.value.notes" class="whitespace-pre-line text-xs text-mute">{{ up.update.value.notes }}</p>
        <button class="btn w-full" @click="up.install()">Скачать и обновить (APK)</button>
        <p class="text-xs text-faint">Файл скачается как .apk; откройте его — Android предложит «Обновить» поверх текущей версии, данные сохранятся.</p>
      </template>
      <p v-else-if="up.upToDate.value" class="text-sm text-ok">Установлена последняя версия.</p>
      <p v-if="up.error.value" class="text-xs text-bad">Не удалось проверить: {{ up.error.value }}</p>
      <button class="btn-ghost w-full" :disabled="up.checking.value" @click="up.check()">{{ up.checking.value ? 'Проверка…' : 'Проверить обновления' }}</button>
      <p class="text-xs text-faint">Приложение только читает данные: оно не пишет в ЭБУ и не сбрасывает ошибки.</p>
    </div>

    <ChoiceSheet v-if="pick === 'limit'" title="Порог превышения скорости" :options="LIMITS" :model-value="String(ui.speedLimit)" @update:model-value="ui.speedLimit = Number($event)" @close="pick = null" />
    <ChoiceSheet v-if="pick === 'warn'" title="Напоминать об обслуживании" :options="WARNS" :model-value="String(ui.warnPct)" @update:model-value="ui.warnPct = Number($event)" @close="pick = null" />
  </section>
</template>
