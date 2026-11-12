<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import OilGauge from '@/components/OilGauge.vue'
import { useUpdate } from '@/composables/useUpdate'
import { useGarage } from '@/composables/useGarage'
import { currentOdometer } from '@/services/Cars'
import { int, num, todayISO } from '@/utils/format'

const { garage, car, oil, setOil, setOdometer } = useGarage()
const up = useUpdate()

// Форма открывается с текущими значениями: «Сохранить» не должно незаметно обнулять пробег с замены.
const form = reactive({
  date: car().oil.dateISO ?? todayISO(),
  since: Math.round(oil().sinceKm),
  interval: car().oil.intervalKm,
})
const saved = ref<string | null>(null)
const problem = computed(() => {
  if (!form.date) return 'Укажите дату замены'
  if (form.date > todayISO()) return 'Дата замены — в будущем'
  if (typeof form.since !== 'number' || form.since < 0) return 'Пробег с замены — число от 0'
  if (typeof form.interval !== 'number' || form.interval < 1000) return 'Интервал замены — от 1000 км'
  return null
})

function flash(text: string): void {
  saved.value = text
  setTimeout(() => { if (saved.value === text) saved.value = null }, 2500)
}

function save(): void {
  if (problem.value) return
  setOil(form.date, form.since, form.interval)
  flash('Сохранено')
}
/** Масло только что заменили: счётчик с нуля, дата — сегодня. */
function justChanged(): void {
  form.date = todayISO()
  form.since = 0
  setOil(form.date, 0, typeof form.interval === 'number' ? form.interval : car().oil.intervalKm)
  flash('Замена отмечена: счётчик обнулён')
}

const odometer = ref<number | ''>(car().odometerKm ?? '')
const odoNow = computed(() => currentOdometer(car()))
function saveOdometer(): void {
  setOdometer(car().id, odometer.value === '' ? null : odometer.value)
  flash('Одометр сохранён')
}
</script>

<template>
  <section class="space-y-2">
    <div class="card p-4"><OilGauge :status="oil()" :interval-km="car().oil.intervalKm" :changed-at="car().oil.dateISO" /></div>

    <div class="card space-y-3 p-4">
      <h2 class="label">Замена масла</h2>
      <label class="block text-xs muted">Дата последней замены
        <input v-model="form.date" type="date" :max="todayISO()" class="field mt-1" />
      </label>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-xs muted">Пройдено с замены, км
          <input v-model.number="form.since" type="number" min="0" inputmode="numeric" class="field mt-1" />
        </label>
        <label class="block text-xs muted">Интервал замены, км
          <input v-model.number="form.interval" type="number" min="1000" step="500" inputmode="numeric" class="field mt-1" />
        </label>
      </div>
      <p class="text-xs text-[#5f6978]">Пробег по OBD недоступен: приложение само прибавляет километры по скорости и GPS, пока записывает поездки. Если ездили без него — поправьте значение вручную.</p>
      <p v-if="problem" class="text-xs text-bad">{{ problem }}</p>
      <div class="flex gap-2">
        <button class="btn flex-1" :disabled="!!problem" @click="save">Сохранить</button>
        <button class="btn-ghost" @click="justChanged">Заменил сегодня</button>
      </div>
      <p v-if="saved" class="text-sm text-ok" role="status">{{ saved }}</p>
    </div>

    <div class="card space-y-3 p-4">
      <h2 class="label">Пробег</h2>
      <dl class="rows">
        <div><dt>Одометр сейчас (оценка)</dt><dd>{{ odoNow != null ? int(odoNow) + ' км' : 'не задан' }}</dd></div>
        <div><dt>Записано приложением</dt><dd>{{ num(car().trackedTotalKm, 1) }} км</dd></div>
      </dl>
      <label class="block text-xs muted">Показание одометра на приборке, км
        <div class="mt-1 flex gap-2">
          <input v-model.number="odometer" type="number" min="0" inputmode="numeric" class="field" placeholder="например, 123456" />
          <button class="btn-ghost btn-sm shrink-0" @click="saveOdometer">Запомнить</button>
        </div>
      </label>
      <p class="text-xs text-[#5f6978]">Введите показание один раз — дальше приложение прибавляет к нему записанные поездки.</p>
    </div>

    <div class="card space-y-3 p-4">
      <h2 class="label">Топливо</h2>
      <label class="block text-xs muted">Цена бензина, ₽/л (для расчёта стоимости поездок)
        <input v-model.number="garage.fuelPrice" type="number" min="0" step="0.5" inputmode="decimal" class="field mt-1" />
      </label>
    </div>

    <div class="card space-y-3 p-4">
      <h2 class="label">Версия и обновление</h2>
      <p class="text-sm">Установлена: <span class="font-mono">{{ up.version }}</span></p>
      <template v-if="up.update.value">
        <p class="text-sm text-ok">Доступна версия <span class="font-mono">{{ up.update.value.version }}</span></p>
        <p v-if="up.update.value.notes" class="whitespace-pre-line text-xs text-[#7b8696]">{{ up.update.value.notes }}</p>
        <button class="btn w-full" @click="up.install()">Скачать и обновить (APK)</button>
        <p class="text-xs text-[#7b8696]">Файл скачается как .apk; откройте его — Android предложит «Обновить» поверх текущей версии, данные сохранятся.</p>
      </template>
      <p v-else-if="up.upToDate.value" class="text-sm text-ok">Установлена последняя версия.</p>
      <p v-if="up.error.value" class="text-xs text-bad">Не удалось проверить: {{ up.error.value }}</p>
      <button class="btn-ghost w-full !py-2 !text-xs" :disabled="up.checking.value" @click="up.check()">{{ up.checking.value ? 'Проверка…' : 'Проверить обновления' }}</button>
    </div>
  </section>
</template>
