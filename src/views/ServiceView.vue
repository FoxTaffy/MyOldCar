<script setup lang="ts">
import { reactive } from 'vue'
import OilGauge from '@/components/OilGauge.vue'
import { useUpdate } from '@/composables/useUpdate'
import { useGarage } from '@/composables/useGarage'
import { num, todayISO } from '@/utils/format'

const { garage, car, oil, setOil } = useGarage()
const up = useUpdate()

const form = reactive({
  date: car().oil.dateISO ?? todayISO(),
  since: 0,
  interval: car().oil.intervalKm,
})

function save(): void {
  setOil(form.date, form.since, form.interval)
}
/** Масло только что заменили: счётчик с нуля, дата — сегодня. */
function justChanged(): void {
  form.date = todayISO()
  form.since = 0
  save()
}
</script>

<template>
  <section class="space-y-2">
    <div class="card p-4"><OilGauge :status="oil()" :interval-km="car().oil.intervalKm" :changed-at="car().oil.dateISO" /></div>

    <div class="card space-y-3 p-4">
      <h2 class="label">Замена масла</h2>
      <label class="block text-xs text-[#7b8696]">Дата последней замены
        <input v-model="form.date" type="date" class="field mt-1" />
      </label>
      <label class="block text-xs text-[#7b8696]">Сколько км проехано с замены на сегодня
        <input v-model.number="form.since" type="number" min="0" inputmode="numeric" class="field mt-1" />
      </label>
      <label class="block text-xs text-[#7b8696]">Интервал замены, км
        <input v-model.number="form.interval" type="number" min="1000" step="500" inputmode="numeric" class="field mt-1" />
      </label>
      <p class="text-xs text-[#5f6978]">Одометр по OBD недоступен: дальше приложение само считает километры по скорости, пока подключено. Если ездили без него — поправьте значение вручную.</p>
      <div class="flex gap-2">
        <button class="btn flex-1" @click="save">Сохранить</button>
        <button class="btn-ghost" @click="justChanged">Заменил сегодня</button>
      </div>
    </div>

    <div class="card space-y-3 p-4">
      <h2 class="label">Топливо</h2>
      <label class="block text-xs text-[#7b8696]">Цена бензина, ₽/л (для расчёта стоимости поездок)
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

    <div class="card p-4 text-sm text-[#7b8696]">
      Намерено приложением на этой машине: <span class="font-mono text-[#d5dae2]">{{ num(car().trackedTotalKm, 1) }} км</span>
    </div>
  </section>
</template>
