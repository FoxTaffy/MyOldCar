<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { checkPermissions, isNative, openAppSettings, requestPermission, STATE_TEXT, type PermInfo } from '@/services/Permissions'

const list = ref<PermInfo[]>([])
const busy = ref<string | null>(null)
const TONE = { granted: 'text-ok', denied: 'text-bad', prompt: 'text-warn', unknown: 'text-mute' } as const
async function refresh(): Promise<void> { list.value = await checkPermissions() }
async function ask(p: PermInfo): Promise<void> {
  busy.value = p.id
  try {
    if (p.manual || p.state === 'denied' && p.id !== 'bluetooth') await openAppSettings()
    else await requestPermission(p.id)
  } finally { busy.value = null; await refresh() }
}
// После возврата из системных настроек обновляем статусы.
const onVis = (): void => { if (!document.hidden) void refresh() }
onMounted(() => { void refresh(); document.addEventListener('visibilitychange', onVis) })
onUnmounted(() => document.removeEventListener('visibilitychange', onVis))
const okCount = (): number => list.value.filter((p) => p.state === 'granted').length
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Разрешения приложения" />
    <p v-if="!isNative" class="rounded-xl bg-accent-soft px-3 py-2 text-sm text-soft">Вы в браузере: часть статусов недоступна. На телефоне здесь будут точные состояния.</p>
    <p v-else class="px-1 text-sm text-mute">Выдано {{ okCount() }} из {{ list.filter((p) => !p.manual).length }}. Без «Геопозиции всегда» и уведомлений запись поездок при выключенном экране может прерываться.</p>

    <div v-for="p in list" :key="p.id" class="card p-4">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-[15px] font-bold">{{ p.title }}</h2>
          <p class="mt-0.5 text-xs text-faint">Рекомендуется: {{ p.recommended }}</p>
        </div>
        <button class="flex shrink-0 items-center gap-1 text-sm font-semibold active:opacity-60" :class="p.manual ? 'text-accent' : TONE[p.state]" :disabled="busy === p.id" @click="ask(p)">
          {{ p.manual ? 'Открыть' : p.state === 'granted' ? STATE_TEXT.granted : p.state === 'denied' ? 'Разрешить' : p.state === 'prompt' ? 'Запросить' : 'Проверить' }}<AppIcon name="chevron" :size="16" />
        </button>
      </div>
      <div class="mt-3 space-y-1.5 rounded-xl bg-night-900 p-3 text-xs leading-relaxed text-mute">
        <p v-for="(d, i) in p.desc" :key="i">• {{ d }}</p>
      </div>
    </div>
    <button class="btn-ghost w-full" @click="openAppSettings()">Открыть настройки приложения в Android</button>
    <p class="px-2 text-center text-xs text-faint">Названия пунктов зависят от версии Android и оболочки. Разрешения используются только для работы функций приложения.</p>
  </section>
</template>
