<script setup lang="ts">
import { computed, ref } from 'vue'
import SensorCard from '@/components/SensorCard.vue'
import { useSensors } from '@/composables/useSensors'
import { useVehicle } from '@/composables/useVehicle'
import { IMPORT_EXAMPLE, levelOf } from '@/data/sensors'

const { values, history, isConnected, pollMode } = useVehicle()
const sensors = useSensors()
pollMode.value = 'normal'

const showAll = ref(false)
const showImport = ref(false)
const text = ref('')
const msg = ref<{ ok: boolean; lines: string[] } | null>(null)

/** Датчики без ответа ЭБУ скрываем, пока не нажата «Показать все». */
const cards = computed(() =>
  sensors.visibleDefs.value.filter((d) => showAll.value || !isConnected.value || values.value[d.id] != null),
)
const summary = computed(() => {
  let ok = 0, warn = 0, bad = 0
  for (const d of sensors.visibleDefs.value) {
    const v = values.value[d.id]
    if (v == null || !d.ok) continue
    const l = levelOf(d, v)
    if (l === 'ok') ok++
    else if (l === 'warn') warn++
    else bad++
  }
  return { ok, warn, bad }
})

function doImport(): void {
  const r = sensors.importText(text.value)
  msg.value = { ok: r.added > 0 && !r.errors.length, lines: [r.added ? `Импортировано датчиков: ${r.added}` : 'Ничего не импортировано', ...r.errors] }
  if (r.added) text.value = ''
}
function onFile(e: Event): void {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  const rd = new FileReader()
  rd.onload = () => { text.value = String(rd.result ?? ''); doImport() }
  rd.readAsText(f)
  ;(e.target as HTMLInputElement).value = ''
}
function doExport(): void {
  const blob = new Blob([sensors.exportText()], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'myoldcar-sensors.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
</script>

<template>
  <section class="space-y-2">
    <p v-if="!isConnected" class="border border-night-600 p-3 text-sm text-[#7b8696]">Нет связи с адаптером. Цвет датчиков появится после подключения (в демо-режиме значения симулируются).</p>

    <div class="grid grid-cols-3 gap-px border border-night-600 bg-night-600 text-center">
      <div class="bg-night-800 p-2"><div class="font-mono text-xl text-ok">{{ summary.ok }}</div><div class="label">норма</div></div>
      <div class="bg-night-800 p-2"><div class="font-mono text-xl text-warn">{{ summary.warn }}</div><div class="label">внимание</div></div>
      <div class="bg-night-800 p-2"><div class="font-mono text-xl text-bad">{{ summary.bad }}</div><div class="label">вне нормы</div></div>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <SensorCard v-for="d in cards" :key="d.id" :def="d" :value="values[d.id]" :history="history[d.id]" />
    </div>

    <div class="flex gap-2">
      <button class="btn-ghost flex-1 !py-2 !text-xs" @click="showAll = !showAll">{{ showAll ? 'Только с данными' : 'Показать все' }}</button>
      <button class="btn-ghost flex-1 !py-2 !text-xs" @click="showImport = !showImport">Импорт / экспорт</button>
    </div>

    <div v-if="showImport" class="card space-y-3 p-3">
      <div class="label">Импорт датчиков (JSON)</div>
      <p class="text-xs text-[#7b8696]">Только чтение: допускаются PID режима 01, формула по байтам A–D (+ − × ÷ и скобки). Зоны: <code>ok</code> — зелёная, <code>warn</code> — оранжевая, остальное — красная.</p>
      <pre class="overflow-x-auto border border-night-600 bg-night-900 p-2 font-mono text-[11px] text-[#aab3c0]">{{ IMPORT_EXAMPLE }}</pre>
      <textarea v-model="text" rows="5" class="field !text-xs" placeholder='Вставьте JSON сюда…' />
      <div class="flex flex-wrap gap-2">
        <button class="btn !py-2 !text-xs" :disabled="!text.trim()" @click="doImport">Импортировать</button>
        <label class="btn-ghost cursor-pointer !py-2 !text-xs">Из файла<input type="file" accept=".json,application/json" class="hidden" @change="onFile"></label>
        <button class="btn-ghost !py-2 !text-xs" @click="doExport">Экспорт</button>
      </div>
      <ul v-if="msg" class="space-y-0.5 font-mono text-xs" :class="msg.ok ? 'text-ok' : 'text-warn'"><li v-for="l in msg.lines" :key="l">{{ l }}</li></ul>

      <div class="label">Список датчиков</div>
      <ul class="divide-y divide-night-600 text-sm">
        <li v-for="d in sensors.allDefs.value" :key="d.id" class="flex items-center justify-between gap-2 py-1.5">
          <label class="flex min-w-0 items-center gap-2"><input type="checkbox" :checked="!sensors.isHidden(d.id)" @change="sensors.toggle(d.id)"><span class="truncate">{{ d.name }}</span><span v-if="d.pid" class="font-mono text-[10px] text-[#7b8696]">01{{ d.pid }}</span></label>
          <button v-if="d.custom" class="text-xs text-bad" @click="sensors.remove(d.id)">удалить</button>
        </li>
      </ul>
    </div>
  </section>
</template>
