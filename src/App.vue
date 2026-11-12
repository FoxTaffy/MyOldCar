<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/AppIcon.vue'
import DrawerMenu from '@/components/DrawerMenu.vue'
import OnboardingWizard from '@/components/OnboardingWizard.vue'
import WelcomeScreen from '@/components/WelcomeScreen.vue'
import { useGarage } from '@/composables/useGarage'
import { setBackLock } from '@/services/BackHandler'
import { toast } from '@/composables/useToast'
import { useUpdate } from '@/composables/useUpdate'
import { drawerOpen, showWizard, useUi } from '@/composables/useUi'
import { useVehicle } from '@/composables/useVehicle'

const v = useVehicle()
const route = useRoute()
const up = useUpdate()
useUi()
const garage = useGarage()
/** Новичок: пустого профиля машины нет — сначала обязательно добавляем автомобиль. */
const welcome = ref(garage.needsFirstCar())
// Пока идёт приветствие, мастер подключения не показываем и «Назад» ничего не закрывает.
showWizard.value = !v.prefs.onboarded && !welcome.value
setBackLock(() => welcome.value || (showWizard.value && !v.prefs.onboarded))
function welcomeDone(): void {
  welcome.value = false
  showWizard.value = !v.prefs.onboarded
}
const tabs = [
  { to: '/', label: 'Главная', icon: 'home' },
  { to: '/monitor', label: 'Монитор', icon: 'monitor' },
  { to: '/diagnostics', label: 'Ошибки', icon: 'warn' },
  { to: '/stats', label: 'Поездки', icon: 'route' },
  { to: '/service', label: 'Журнал', icon: 'wallet' },
]
const bar = computed(() => (route.meta.bar as string | undefined) ?? 'none')
/** Карта поездки — часть раздела «Поездки»: вкладка должна оставаться подсвеченной. */
const activeTab = computed(() => (route.path.startsWith('/trip') ? '/stats' : route.path))
onMounted(() => { v.autoStart(); void up.check() })
const viaText = { ble: 'Bluetooth', wifi: 'Wi-Fi', mock: 'Демо' } as const
const pill = computed(() => {
  if (v.status.value === 'connecting') return { text: 'Подключение…', dot: 'bg-accent animate-pulse' }
  if (v.status.value !== 'connected') return v.awaitingManual.value ? { text: 'Подключить', dot: 'bg-warn' } : { text: 'Нет связи', dot: 'bg-faint' }
  if (v.ecuSilent.value) return { text: 'ЭБУ молчит', dot: 'bg-warn' }
  return { text: viaText[v.via.value ?? 'mock'], dot: 'bg-ok' }
})
const hint = computed(() => (v.status.value === 'connecting' ? v.note.value : v.awaitingManual.value ? 'Адаптер не найден рядом. Поиск остановлен — нажмите «Подключить», когда будете у машины.' : v.ecuSilent.value ? 'Адаптер на связи, но ЭБУ не отвечает — включите зажигание.' : null))
</script>

<template>
  <div class="mx-auto flex h-full max-w-3xl flex-col">
    <header v-if="bar !== 'none'" class="shrink-0 px-3 pb-1 pt-2">
      <div class="flex h-11 items-center gap-1">
        <button class="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-ink active:bg-night-700" aria-label="Меню" @click="drawerOpen = true"><AppIcon name="menu" /></button>
        <h1 v-if="bar === 'home'" class="flex-1 text-xl font-black tracking-[0.18em]"><span class="text-ink">MY</span><span class="bg-gradient-to-r from-accent-glow to-accent bg-clip-text text-transparent">OLDCAR</span></h1>
        <h1 v-else class="min-w-0 flex-1 truncate text-lg font-bold">{{ route.meta.title }}</h1>
        <RouterLink v-if="v.milOn.value" to="/diagnostics" class="mil h-9 w-9 text-lg" aria-label="Горит Check Engine — открыть ошибки">!</RouterLink>
        <RouterLink to="/connection" class="flex h-9 items-center gap-2 rounded-full border border-night-600 bg-night-800 px-3 text-xs font-semibold text-soft shadow-card active:bg-night-700" title="Подключение сканера">
          <span class="h-2.5 w-2.5 rounded-full" :class="pill.dot" />{{ pill.text }}
        </RouterLink>
      </div>
    </header>

    <p v-if="hint && bar !== 'none'" class="mx-3 mb-1 rounded-xl bg-accent-soft px-3 py-2 text-xs text-soft">{{ hint }}</p>
    <button v-if="v.error.value" class="mx-3 mb-1 flex items-start gap-2 rounded-xl border border-bad/40 bg-bad/10 px-3 py-2 text-left text-xs text-bad" title="Скрыть" @click="v.clearError()">
      <span class="min-w-0 flex-1 break-words">{{ v.error.value }}</span><AppIcon name="close" :size="16" />
    </button>
    <div v-if="up.update.value && bar !== 'none'" class="mx-3 mb-1 flex items-center gap-2 rounded-xl bg-accent-soft px-3 py-2 text-xs">
      <span class="mr-auto text-soft">Доступна версия <b class="text-accent">{{ up.update.value.version }}</b></span>
      <button class="btn btn-sm" @click="up.install()">Обновить</button>
    </div>

    <main class="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-3" :class="bar === 'none' ? 'pt-3' : 'pt-1'">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in"><component :is="Component" /></Transition>
      </RouterView>
    </main>

    <DrawerMenu />
    <Transition name="page"><div v-if="toast" class="pointer-events-none fixed inset-x-0 bottom-24 z-[3000] flex justify-center px-6"><span class="rounded-full bg-black/80 px-4 py-2 text-sm text-white shadow-card">{{ toast }}</span></div></Transition>
    <WelcomeScreen v-if="welcome" @done="welcomeDone" />
    <OnboardingWizard v-if="showWizard" @done="showWizard = false" />

    <nav v-if="bar !== 'none'" class="mx-3 mb-2 grid shrink-0 grid-cols-5 rounded-3xl border border-night-600/70 bg-night-800/90 shadow-card backdrop-blur pb-[env(safe-area-inset-bottom)]" aria-label="Разделы">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to" class="flex flex-col items-center gap-0.5 pb-2 pt-2.5 text-[11px] font-semibold transition-colors" :class="activeTab === t.to ? 'text-accent [&>svg]:drop-shadow-[0_0_8px_rgb(var(--accent)/0.7)]' : 'text-faint'">
        <AppIcon :name="t.icon" :size="24" />{{ t.label }}
      </RouterLink>
    </nav>
  </div>
</template>

<style>
.page-enter-active, .page-leave-active { transition: opacity 0.12s ease; }
.page-enter-from, .page-leave-to { opacity: 0; }
</style>
