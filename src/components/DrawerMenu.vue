<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useGarage } from '@/composables/useGarage'
import { drawerOpen, showWizard } from '@/composables/useUi'
import { pushBack } from '@/services/BackHandler'
import { carTitle, currentOdometer } from '@/services/Cars'
import { int } from '@/utils/format'

let offBack: (() => void) | null = null
watch(drawerOpen, (open) => {
  offBack?.()
  offBack = open ? pushBack(() => { drawerOpen.value = false }) : null
})
const router = useRouter()
const { car } = useGarage()
const odo = computed(() => currentOdometer(car()))
const items = [
  { to: '/garage', icon: 'car', title: 'Мои автомобили' },
  { to: '/connection', icon: 'plug', title: 'Подключение сканера' },
  { to: '/edit-home', icon: 'list', title: 'Редактировать главный экран' },
  { to: '/settings', icon: 'gear', title: 'Настройки' },
  { to: '/permissions', icon: 'shieldcheck', title: 'Разрешения приложения' },
  { to: '/help', icon: 'book', title: 'Руководство и FAQ' },
]
function go(to: string): void { drawerOpen.value = false; void router.push(to) }
function wizard(): void { drawerOpen.value = false; showWizard.value = true }
async function share(): Promise<void> {
  drawerOpen.value = false
  const url = 'https://github.com/FoxTaffy/MyOldCar'
  try { if (navigator.share) await navigator.share({ title: 'MyOldCar', text: 'OBD-II сканер и журнал поездок', url }) } catch { /* отмена */ }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="drawerOpen" class="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" @click="drawerOpen = false" />
    </Transition>
    <Transition name="slide">
      <aside v-if="drawerOpen" class="fixed inset-y-0 left-0 z-50 flex w-[82%] max-w-xs flex-col bg-night-800 shadow-2xl" style="padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom)" aria-label="Меню">
        <button class="bg-gradient-to-br from-accent-soft to-night-800 px-5 pb-5 pt-6 text-left" @click="go('/garage')">
          <BrandLogo :make="car().make || car().name" :size="64" />
          <span class="mt-3 block truncate text-lg font-bold text-ink">{{ carTitle(car()) }}</span>
          <span class="block text-sm text-mute">{{ odo != null ? `${int(odo)} км · ` : '' }}{{ car().year ?? 'год не указан' }}</span>
        </button>
        <nav class="min-h-0 flex-1 overflow-y-auto py-2">
          <button v-for="i in items" :key="i.to" class="flex w-full items-center gap-4 px-5 py-3.5 text-left text-[15px] text-ink active:bg-night-700" @click="go(i.to)">
            <AppIcon :name="i.icon" class="text-accent" /><span>{{ i.title }}</span>
          </button>
          <button class="flex w-full items-center gap-4 px-5 py-3.5 text-left text-[15px] text-ink active:bg-night-700" @click="wizard"><AppIcon name="wrench" class="text-accent" /><span>Мастер первой настройки</span></button>
          <button class="flex w-full items-center gap-4 px-5 py-3.5 text-left text-[15px] text-ink active:bg-night-700" @click="share"><AppIcon name="share" class="text-accent" /><span>Поделиться приложением</span></button>
        </nav>
        <p class="px-5 py-3 text-xs text-faint">MyOldCar · только чтение, ничего не пишет в ЭБУ</p>
      </aside>
    </Transition>
  </Teleport>
</template>

<style>
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
.slide-enter-active, .slide-leave-active { transition: transform 0.25s cubic-bezier(0.3, 0.8, 0.3, 1); }
.slide-enter-from, .slide-leave-to { transform: translateX(-100%); }
</style>
