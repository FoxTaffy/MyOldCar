<script setup lang="ts">
import { ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import ChoiceSheet from '@/components/ChoiceSheet.vue'
import PageHeader from '@/components/PageHeader.vue'
import ToggleRow from '@/components/ToggleRow.vue'
import { useGarage } from '@/composables/useGarage'
import { useUpdate } from '@/composables/useUpdate'
import { showWizard, useUi, type ThemeMode } from '@/composables/useUi'
import { useVehicle } from '@/composables/useVehicle'
import type { AppSettings } from '@/types'
import { todayISO } from '@/utils/format'

const { ui } = useUi()
const { garage, clearTrips } = useGarage()
const { settings } = useVehicle()
const up = useUpdate()
const THEMES: { id: ThemeMode; label: string; icon: string }[] = [{ id: 'light', label: 'Светлая', icon: 'sun' }, { id: 'dark', label: 'Тёмная', icon: 'moon' }, { id: 'auto', label: 'Как в системе', icon: 'gear' }]
const pick = ref<'limit' | 'warn' | null>(null)
const LIMITS = [90, 100, 110, 120, 130, 140].map((n) => ({ id: String(n), label: `${n} км/ч` }))
const WARNS = [70, 80, 90].map((n) => ({ id: String(n), label: `${n} % интервала` }))
const toggles: { key: keyof AppSettings; label: string; hint: string }[] = [
  { key: 'recentFuelServicing', label: 'Недавно обслуживались топливные магистрали / бак', hint: 'Повышает вероятность проблем с давлением топлива' },
  { key: 'recentAirIntakeServicing', label: 'Недавно трогали впуск (ДМРВ, гофра, фильтр)', hint: 'Повышает вероятность подсоса воздуха' },
  { key: 'recentIgnitionServicing', label: 'Недавно меняли свечи / провода / модуль', hint: 'Учитывается при пропусках зажигания' },
  { key: 'coldStartOnly', label: 'Неисправность проявляется только на холодном', hint: 'Влияет на оценку модуля зажигания' },
]
const msg = ref<string | null>(null)
const flash = (t: string): void => { msg.value = t; setTimeout(() => { if (msg.value === t) msg.value = null }, 3500) }

/** Резервная копия: всё, что приложение хранит на телефоне (машины, поездки, журнал, настройки). */
function exportBackup(): void {
  const data: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k?.startsWith('myoldcar.')) data[k] = localStorage.getItem(k) ?? ''
  }
  const blob = new Blob([JSON.stringify({ app: 'myoldcar', version: up.version, at: new Date().toISOString(), data })], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `myoldcar-backup-${todayISO()}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 3000)
  flash('Копия сохранена в «Загрузки»')
}
function importBackup(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0]
  ;(e.target as HTMLInputElement).value = ''
  if (!f) return
  const rd = new FileReader()
  rd.onload = () => {
    try {
      const j = JSON.parse(String(rd.result)) as { app?: string; data?: Record<string, unknown> }
      if (j.app !== 'myoldcar' || !j.data || typeof j.data !== 'object') throw new Error('Это не копия MyOldCar')
      const entries = Object.entries(j.data).filter(([k, v]) => k.startsWith('myoldcar.') && typeof v === 'string')
      if (!entries.length) throw new Error('В копии нет данных')
      if (!confirm(`Заменить данные на телефоне данными из копии (${entries.length} записей)? Текущие будут перезаписаны.`)) return
      for (const [k, v] of entries) localStorage.setItem(k, v as string)
      flash('Данные восстановлены, перезапускаю…')
      setTimeout(() => location.reload(), 900)
    } catch (err) { flash(err instanceof Error ? err.message : 'Не удалось прочитать файл') }
  }
  rd.readAsText(f)
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
      <button class="row" @click="wipeTrips"><span class="row-title !text-bad">Удалить все поездки</span><AppIcon name="trash" :size="20" class="text-bad" /></button>
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
