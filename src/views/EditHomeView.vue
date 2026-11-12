<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/AppIcon.vue'
import PageHeader from '@/components/PageHeader.vue'
import { MENU, moveItem, STAT_IDS, useUi, type StatId } from '@/composables/useUi'
import { STAT_TITLES } from '@/services/HomeStats'

const { ui } = useUi()
const off = computed(() => STAT_IDS.filter((id) => !ui.homeStats.includes(id)))
const full = computed(() => ui.homeStats.length >= 3)
const add = (id: StatId): void => { if (!full.value) ui.homeStats.push(id) }
const del = (i: number): void => { if (ui.homeStats.length > 1) ui.homeStats.splice(i, 1) }
const title = (id: string): string => MENU.find((m) => m.id === id)?.title ?? id
const hidden = (id: string): boolean => ui.menuHidden.includes(id)
function toggle(id: string): void {
  const i = ui.menuHidden.indexOf(id)
  if (i >= 0) ui.menuHidden.splice(i, 1)
  else ui.menuHidden.push(id)
}
function reset(): void {
  ui.homeStats = ['avgKm', 'avgTime', 'lastDiag']
  ui.menuOrder = MENU.map((m) => m.id)
  ui.menuHidden = []
}
</script>

<template>
  <section class="space-y-3">
    <PageHeader title="Главный экран" />

    <div class="card overflow-hidden bg-night-900 p-3">
      <div class="grid grid-cols-3 gap-2">
        <div v-for="n in 3" :key="n" class="flex h-16 items-center justify-center rounded-xl border-2 border-dashed text-xl font-bold" :class="ui.homeStats[n - 1] ? 'border-accent/60 bg-accent-soft text-accent' : 'border-night-600 text-faint'">{{ n }}</div>
      </div>
    </div>

    <h2 class="h-section !pt-1">Показатели в шапке <span class="text-sm font-normal text-faint">до 3</span></h2>
    <div class="card divide-y divide-night-600">
      <div v-for="(id, i) in ui.homeStats" :key="id" class="flex items-center gap-2 px-3 py-2.5">
        <button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bad text-white disabled:opacity-30" :disabled="ui.homeStats.length <= 1" :aria-label="`Убрать ${STAT_TITLES[id]}`" @click="del(i)"><AppIcon name="minus" :size="18" /></button>
        <span class="min-w-0 flex-1 text-[15px]">{{ STAT_TITLES[id] }}</span>
        <button class="flex h-9 w-9 items-center justify-center rounded-full text-mute active:bg-night-700 disabled:opacity-25" :disabled="i === 0" aria-label="Выше" @click="moveItem(ui.homeStats, i, -1)"><AppIcon name="up" :size="20" /></button>
        <button class="flex h-9 w-9 items-center justify-center rounded-full text-mute active:bg-night-700 disabled:opacity-25" :disabled="i === ui.homeStats.length - 1" aria-label="Ниже" @click="moveItem(ui.homeStats, i, 1)"><AppIcon name="down" :size="20" /></button>
      </div>
    </div>
    <h2 class="h-section !pt-1">Отключено</h2>
    <div class="card divide-y divide-night-600">
      <div v-for="id in off" :key="id" class="flex items-center gap-2 px-3 py-2.5">
        <button class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-on disabled:opacity-30" :disabled="full" :aria-label="`Добавить ${STAT_TITLES[id]}`" @click="add(id)"><AppIcon name="plus" :size="18" /></button>
        <span class="min-w-0 flex-1 text-[15px]" :class="full ? 'text-faint' : ''">{{ STAT_TITLES[id] }}</span>
      </div>
    </div>
    <p v-if="full" class="px-1 text-xs text-faint">Все три места заняты — уберите один показатель, чтобы добавить другой.</p>

    <h2 class="h-section">Плитки разделов</h2>
    <div class="card divide-y divide-night-600">
      <div v-for="(id, i) in ui.menuOrder" :key="id" class="flex items-center gap-2 px-3 py-2.5">
        <AppIcon :name="MENU.find((m) => m.id === id)?.icon ?? 'info'" class="shrink-0" :class="hidden(id) ? 'text-faint' : 'text-accent'" />
        <span class="min-w-0 flex-1 text-[15px]" :class="hidden(id) ? 'text-faint line-through' : ''">{{ title(id) }}</span>
        <button class="flex h-9 w-9 items-center justify-center rounded-full text-mute active:bg-night-700 disabled:opacity-25" :disabled="i === 0" aria-label="Выше" @click="moveItem(ui.menuOrder, i, -1)"><AppIcon name="up" :size="20" /></button>
        <button class="flex h-9 w-9 items-center justify-center rounded-full text-mute active:bg-night-700 disabled:opacity-25" :disabled="i === ui.menuOrder.length - 1" aria-label="Ниже" @click="moveItem(ui.menuOrder, i, 1)"><AppIcon name="down" :size="20" /></button>
        <button class="switch" role="switch" :aria-checked="!hidden(id)" :aria-label="`Показывать «${title(id)}»`" :disabled="id === 'settings'" @click="toggle(id)" />
      </div>
    </div>
    <p class="px-1 text-xs text-faint">«Настройки» скрыть нельзя — они доступны и из бокового меню.</p>
    <button class="btn-ghost w-full" @click="reset">Вернуть как было</button>
  </section>
</template>
