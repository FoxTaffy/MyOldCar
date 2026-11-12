<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDiagnostics } from '@/composables/useDiagnostics'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { describeDtc, dtcAdvice, DTC_COUNT, findDtcs, isDtcCode } from '@/data/dtcDictionary'
import { carTitle } from '@/services/Cars'
import { isKnownCode } from '@/services/DiagnosticEngine'
import { dateTime, num } from '@/utils/format'

const { settings, isConnected, milOn } = useVehicle()
const { car } = useGarage()
const { report, results, busy, error, scan } = useDiagnostics()
const copied = ref(false)
const copyErr = ref(false)

const toggles: { key: keyof typeof settings; label: string }[] = [
  { key: 'recentFuelServicing', label: 'Недавно обслуживались топливные магистрали / бак' },
  { key: 'recentAirIntakeServicing', label: 'Недавно трогали впуск (ДМРВ, гофра, фильтр)' },
  { key: 'recentIgnitionServicing', label: 'Недавно меняли свечи / провода / модуль' },
  { key: 'coldStartOnly', label: 'Ошибка проявляется только на холодном' },
]
const contextCount = computed(() => toggles.filter((t) => settings[t.key]).length)

const cards = computed(() => results.value.map((r) => ({ ...r, info: describeDtc(r.code) })))
const confirmed = computed(() => results.value.filter((r) => r.status !== 'pending').length)
const pending = computed(() => results.value.length - confirmed.value)

/** Сводка: сколько кодов и по каким системам. */
const bySystem = computed(() => {
  const m = new Map<string, number>()
  for (const c of cards.value) m.set(c.info.system, (m.get(c.info.system) ?? 0) + 1)
  return [...m.entries()]
})
const verdict = computed(() => {
  const r = report.value
  if (!r) return null
  if (!results.value.length) return { tone: 'text-ok', text: 'Ошибок нет' }
  if (confirmed.value) return { tone: 'text-bad', text: r.milOn ? 'Есть подтверждённые ошибки, лампа горит' : 'Есть подтверждённые ошибки' }
  return { tone: 'text-warn', text: 'Только временные ошибки — ЭБУ их ещё не подтвердил' }
})

const pct = (v: number | null): string => (v == null ? '—' : `${num(v, 0)} %`)
const trim = (v: number | null): string => (v == null ? '—' : `${v > 0 ? '+' : ''}${num(v, 1)} %`)
const freezeRows = computed<[string, string][]>(() => {
  const f = report.value?.freeze
  if (!f) return []
  const rows: [string, string][] = [
    ['Код, вызвавший запись', f.dtc],
    ['Обороты', f.rpm != null ? `${num(f.rpm, 0)} об/мин` : '—'],
    ['Скорость', f.speedKmh != null ? `${num(f.speedKmh, 0)} км/ч` : '—'],
    ['Темп. ОЖ', f.coolantTempC != null ? `${num(f.coolantTempC, 0)} °C` : '—'],
    ['Нагрузка', pct(f.loadPct)],
    ['Дроссель', pct(f.throttlePct)],
    ['ДМРВ', f.mafGs != null ? `${num(f.mafGs * 3.6, 1)} кг/ч` : '—'],
    ['Коррекция STFT / LTFT', `${trim(f.stft)} / ${trim(f.ltft)}`],
  ]
  return rows.filter(([, v]) => !/^—( \/ —)?$/.test(v))
})

async function copy(): Promise<void> {
  const r = report.value
  if (!r) return
  const head = [
    `${carTitle(car())} — диагностика ${dateTime(r.at)}`,
    results.value.length ? `Кодов: ${results.value.length} (подтверждённых ${confirmed.value}, временных ${pending.value})` : 'Ошибок нет',
    r.milOn != null ? `Check Engine: ${r.milOn ? 'горит' : 'не горит'}` : '',
    freezeRows.value.length ? 'Стоп-кадр: ' + freezeRows.value.map(([k, v]) => `${k} ${v}`).join('; ') : '',
  ].filter(Boolean).join('\n')
  const body = cards.value
    .map((c) => `${c.code} (${c.status === 'pending' ? 'временная' : 'подтверждённая'}) — ${c.info.title}\n` + c.causes.map((x) => (c.modeled ? `  ${x.probability}% ${x.title}` : `  ${x.recommendation}`)).join('\n'))
    .join('\n\n')
  try {
    await navigator.clipboard.writeText([head, body].filter(Boolean).join('\n\n'))
    copied.value = true
    copyErr.value = false
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    copyErr.value = true
  }
}

const query = ref('')
const found = computed(() => findDtcs(query.value, 40))
const opened = ref<string | null>(null)
const lookup = computed(() => (isDtcCode(query.value) ? describeDtc(query.value) : null))

const barColor = (p: number) => (p >= 50 ? 'bg-bad' : p >= 25 ? 'bg-warn' : 'bg-accent')
</script>

<template>
  <section class="space-y-2">
    <div class="flex gap-2">
      <button class="btn flex-1" :disabled="!isConnected || busy" @click="scan">{{ busy ? 'Чтение…' : report ? 'Считать заново' : 'Считать ошибки' }}</button>
      <button class="btn-ghost" :disabled="!report" @click="copy">{{ copied ? 'Скопировано' : 'Копия' }}</button>
    </div>
    <p v-if="!isConnected" class="text-center text-sm muted">Чтобы считать ошибки, подключитесь к адаптеру. Справочник кодов внизу работает и без подключения.</p>
    <p v-if="error" class="border border-bad p-3 text-sm text-bad">{{ error }}</p>
    <p v-if="copyErr" class="text-sm text-bad">Не удалось скопировать в буфер обмена</p>

    <div v-if="milOn && !report?.milOn" class="flex items-center gap-3 border border-bad p-3 text-bad">
      <span class="mil h-7 w-7 text-lg">!</span>
      <span class="text-sm">Лампа Check Engine сейчас горит — считайте ошибки</span>
    </div>

    <!-- Сводка последнего чтения -->
    <div v-if="report && verdict" class="card p-4">
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="label">Сводка</h2>
        <span class="font-mono text-[11px] muted">{{ dateTime(report.at) }}</span>
      </div>
      <p class="mt-1 text-base font-semibold" :class="verdict.tone">{{ verdict.text }}</p>
      <div class="tiles mt-3 grid-cols-3 text-center">
        <div><div class="label">Подтв.</div><div class="tile-value" :class="confirmed ? 'text-bad' : ''">{{ confirmed }}</div></div>
        <div><div class="label">Временных</div><div class="tile-value" :class="pending ? 'text-warn' : ''">{{ pending }}</div></div>
        <div>
          <div class="label">Лампа</div>
          <div class="tile-value" :class="report.milOn ? 'text-bad' : ''">{{ report.milOn == null ? '—' : report.milOn ? 'ГОРИТ' : 'НЕТ' }}</div>
        </div>
      </div>
      <dl class="rows mt-2">
        <div v-for="[name, n] in bySystem" :key="name"><dt>{{ name }}</dt><dd>{{ n }}</dd></div>
        <div v-if="report.ecuCount != null && report.ecuCount !== confirmed">
          <dt>По данным ЭБУ сохранено кодов</dt><dd>{{ report.ecuCount }}</dd>
        </div>
        <div v-if="report.protocol"><dt>Протокол</dt><dd class="!font-sans">{{ report.protocol }}</dd></div>
      </dl>
      <p v-if="!results.length" class="mt-2 text-sm muted">Память ЭБУ чиста: ни сохранённых, ни временных кодов.</p>
      <p class="mt-2 text-xs text-faint">Приложение только читает коды и ничего не стирает в ЭБУ.</p>
    </div>

    <div v-if="freezeRows.length" class="card p-4">
      <h2 class="label">Стоп-кадр</h2>
      <p class="mt-1 text-xs muted">Что показывали датчики в момент, когда ЭБУ записал ошибку.</p>
      <dl class="rows mt-1"><div v-for="[k, v] in freezeRows" :key="k"><dt>{{ k }}</dt><dd>{{ v }}</dd></div></dl>
    </div>

    <details v-if="report" class="card p-4" :open="contextCount > 0">
      <summary class="label cursor-pointer">Контекст для оценки причин<span v-if="contextCount" class="text-accent-glow"> · {{ contextCount }}</span></summary>
      <div class="mt-3 space-y-2">
        <label v-for="t in toggles" :key="t.key" class="flex items-start gap-3 text-sm">
          <input v-model="settings[t.key]" type="checkbox" class="mt-0.5" />
          <span>{{ t.label }}</span>
        </label>
        <p class="text-xs text-faint">Отметьте подходящее — вероятности причин пересчитаются сразу.</p>
      </div>
    </details>

    <article v-for="r in cards" :key="r.code" class="card space-y-3 p-4">
      <header>
        <div class="flex items-baseline justify-between gap-2">
          <span class="font-mono text-2xl font-semibold" :class="r.status === 'pending' ? 'text-warn' : 'text-bad'">{{ r.code }}</span>
          <span class="label" :class="r.status === 'pending' ? 'text-warn' : 'text-bad'">{{ r.status === 'pending' ? 'Временная' : 'Подтверждённая' }}</span>
        </div>
        <div class="mt-1 text-sm text-ink">{{ r.info.title }}</div>
        <div class="mt-1 text-xs text-faint">{{ r.info.system }}<template v-if="r.info.subsystem"> · {{ r.info.subsystem }}</template> · {{ r.info.kind === 'generic' ? 'универсальный код' : 'заводской код' }}</div>
      </header>
      <ul v-if="r.modeled" class="space-y-3">
        <li v-for="c in r.causes" :key="c.id">
          <div class="flex items-baseline justify-between gap-2">
            <span class="font-semibold">{{ c.title }}</span>
            <span class="font-mono text-base tabular-nums">{{ c.probability }}%</span>
          </div>
          <div class="my-1 h-1.5 bg-night-700">
            <div class="h-full" :class="barColor(c.probability)" :style="{ width: c.probability + '%' }" />
          </div>
          <p class="text-sm muted">{{ c.recommendation }}</p>
        </li>
      </ul>
      <div v-else class="border-l-2 border-accent pl-3">
        <div class="label">{{ r.causes[0].title }}</div>
        <p class="mt-1 text-sm text-soft">{{ r.causes[0].recommendation }}</p>
      </div>
      <details v-if="r.notes.length" class="text-xs text-faint">
        <summary class="cursor-pointer">Почему такие вероятности</summary>
        <ul class="mt-1 list-disc space-y-1 pl-5"><li v-for="n in r.notes" :key="n">{{ n }}</li></ul>
      </details>
    </article>

    <div class="card space-y-2 p-4">
      <div class="flex items-baseline justify-between gap-2">
        <h2 class="label">Справочник кодов</h2>
        <span class="font-mono text-[11px] muted">{{ DTC_COUNT }} кодов</span>
      </div>
      <input v-model="query" type="search" class="field" placeholder="P0171, лямбда, форсунка 3…" autocapitalize="characters" autocomplete="off" spellcheck="false" />
      <ul v-if="found.items.length" class="divide-y divide-night-600 text-sm">
        <li v-for="d in found.items" :key="d.code">
          <button class="flex w-full gap-3 py-2 text-left" @click="opened = opened === d.code ? null : d.code">
            <span class="w-14 shrink-0 font-mono font-semibold text-accent-glow">{{ d.code }}</span>
            <span class="min-w-0 flex-1">{{ d.title }}</span>
          </button>
          <div v-if="opened === d.code" class="mb-2 ml-[4.25rem] space-y-1 border-l-2 border-night-600 pl-3 text-xs">
            <p class="text-faint">{{ d.system }}<template v-if="d.subsystem"> · {{ d.subsystem }}</template> · {{ d.kind === 'generic' ? 'универсальный' : 'заводской' }}<template v-if="isKnownCode(d.code)"> · есть оценка причин</template></p>
            <p class="text-soft">{{ dtcAdvice(d.code) }}</p>
          </div>
        </li>
      </ul>
      <p v-if="found.total > found.items.length" class="text-xs muted">Показаны первые {{ found.items.length }} из {{ found.total }} — уточните запрос.</p>
      <template v-else-if="query.trim() && !found.items.length">
        <p class="text-sm muted">{{ lookup ? 'Точной расшифровки нет. По структуре кода:' : 'Ничего не найдено. Введите код целиком (например, P0171) или слово из описания.' }}</p>
        <template v-if="lookup">
          <p class="text-sm">{{ lookup.title }}</p>
          <p class="text-xs text-soft">{{ dtcAdvice(lookup.code) }}</p>
        </template>
      </template>
      <p v-if="!query.trim()" class="text-xs text-faint">Универсальные коды SAE (P0, P2, U0, часть B/C) и заводские P1 для ВАЗ/LADA. Заводские коды зависят от блока — сверяйтесь с документацией на свой ЭБУ.</p>
    </div>
  </section>
</template>
