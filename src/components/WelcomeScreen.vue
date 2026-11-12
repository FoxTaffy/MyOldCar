<script setup lang="ts">
import { computed, ref } from 'vue'
import AddCarSheet from '@/components/AddCarSheet.vue'
import AppIcon from '@/components/AppIcon.vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { useGarage } from '@/composables/useGarage'
import { carTitle, type Car } from '@/services/Cars'

/**
 * Первый запуск: у нового пользователя нет машины, поэтому сразу (и обязательно) предлагаем добавить её.
 * Три шага: приветствие → мастер марки/модели/топлива/объёма → «Готово» с логотипом марки.
 */
const emit = defineEmits<{ done: [] }>()
const { fillFirstCar, car } = useGarage()
type Phase = 'hello' | 'wizard' | 'done'
const phase = ref<Phase>('hello')
const title = computed(() => carTitle(car()))

function created(init: Partial<Car>): void {
  fillFirstCar(init)
  phase.value = 'done'
}
</script>

<template>
  <div class="fixed inset-0 z-[2500] overflow-hidden bg-night-950" role="dialog" aria-modal="true" aria-label="Добро пожаловать">
    <!-- Фон: мягкие светящиеся пятна -->
    <div class="blob blob-a" /><div class="blob blob-b" />

    <Transition name="wl" mode="out-in">
      <section v-if="phase === 'hello'" key="hello" class="relative flex h-full flex-col items-center justify-between px-6 pb-10 pt-[max(3rem,env(safe-area-inset-top))] text-center">
        <div class="w-full">
          <h1 class="rise text-4xl font-black tracking-[0.2em]" style="animation-delay: 0.1s"><span class="text-ink">MY</span><span class="bg-gradient-to-r from-accent-glow to-accent bg-clip-text text-transparent">OLDCAR</span></h1>
          <p class="rise mt-2 text-sm text-mute" style="animation-delay: 0.35s">Диагностика, поездки и забота о вашей машине</p>
        </div>

        <!-- Дорога и машина -->
        <div class="relative w-full max-w-sm">
          <div class="road"><span /><span /><span /><span /><span /></div>
          <div class="car-wrap"><AppIcon name="car" :size="96" class="car-icon text-accent" /></div>
        </div>

        <div class="w-full max-w-sm space-y-4">
          <div class="rise space-y-1" style="animation-delay: 0.6s">
            <h2 class="text-2xl font-bold">Давайте познакомимся</h2>
            <p class="text-sm text-mute">Добавьте свой автомобиль — марку, модель, топливо и объём двигателя. Это займёт полминуты.</p>
          </div>
          <button class="btn pulse w-full !py-3.5 text-base rise" style="animation-delay: 0.85s" @click="phase = 'wizard'">Добавить автомобиль</button>
        </div>
      </section>

      <section v-else-if="phase === 'done'" key="done" class="relative flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
        <div class="relative flex h-40 w-40 items-center justify-center">
          <span class="ring ring-1" /><span class="ring ring-2" />
          <div class="pop"><BrandLogo :make="car().make" :size="112" /></div>
          <span class="tick"><AppIcon name="check" :size="22" /></span>
        </div>
        <div class="rise" style="animation-delay: 0.4s">
          <h2 class="text-3xl font-black">Готово!</h2>
          <p class="mt-1 text-lg text-soft">{{ title }}</p>
          <p class="mt-1 text-sm text-mute">Профиль создан. Остальное можно дополнить позже в разделе «Мои автомобили».</p>
        </div>
        <button class="btn w-full max-w-sm !py-3.5 rise" style="animation-delay: 0.7s" @click="emit('done')">Продолжить</button>
      </section>
    </Transition>

    <AddCarSheet v-if="phase === 'wizard'" forced @close="phase = 'hello'" @done="created" />
  </div>
</template>

<style scoped>
.blob { position: absolute; width: 22rem; height: 22rem; border-radius: 9999px; filter: blur(70px); opacity: 0.45; }
.blob-a { top: -6rem; left: -6rem; background: rgb(var(--accent)); animation: float 9s ease-in-out infinite; }
.blob-b { bottom: -8rem; right: -7rem; background: #4ecda0; opacity: 0.25; animation: float 11s ease-in-out infinite reverse; }
@keyframes float { 50% { transform: translate(2.5rem, 1.5rem) scale(1.12); } }

.rise { opacity: 0; transform: translateY(14px); animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) forwards; }
@keyframes rise { to { opacity: 1; transform: none; } }

.wl-enter-active, .wl-leave-active { transition: opacity 0.3s ease, transform 0.3s ease; }
.wl-enter-from { opacity: 0; transform: scale(0.96); }
.wl-leave-to { opacity: 0; transform: translateY(-12px); }

/* Дорога: бегущая разметка и покачивающаяся машина */
.road { position: relative; height: 4px; margin-top: 5.5rem; background: rgb(var(--line)); border-radius: 4px; overflow: hidden; }
.road span { position: absolute; top: 0; height: 100%; width: 2.2rem; background: rgb(var(--accent)); border-radius: 4px; animation: dash 1.6s linear infinite; }
.road span:nth-child(1) { left: 0; } .road span:nth-child(2) { left: 22%; } .road span:nth-child(3) { left: 44%; } .road span:nth-child(4) { left: 66%; } .road span:nth-child(5) { left: 88%; }
@keyframes dash { from { transform: translateX(0); } to { transform: translateX(-22vw); } }
.car-wrap { position: absolute; left: 50%; bottom: 4px; transform: translateX(-50%); animation: drive-in 1.1s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.car-icon { filter: drop-shadow(0 0 18px rgb(var(--accent) / 0.55)); animation: bump 0.9s ease-in-out 1.1s infinite; }
@keyframes drive-in { from { transform: translateX(-190%); opacity: 0; } to { transform: translateX(-50%); opacity: 1; } }
@keyframes bump { 50% { transform: translateY(-3px); } }

.pulse { animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) 0.85s forwards, glow 2.2s ease-in-out 1.6s infinite; }
@keyframes glow { 50% { box-shadow: 0 0 0 8px rgb(var(--accent) / 0.18); } }

/* Экран «Готово» */
.pop { animation: pop 0.7s cubic-bezier(0.3, 1.6, 0.4, 1) both; }
@keyframes pop { from { transform: scale(0.2) rotate(-25deg); opacity: 0; } to { transform: none; opacity: 1; } }
.ring { position: absolute; inset: 0; border-radius: 9999px; border: 2px solid rgb(var(--accent)); opacity: 0; animation: ring 2s ease-out infinite; }
.ring-2 { animation-delay: 1s; }
@keyframes ring { from { transform: scale(0.7); opacity: 0.7; } to { transform: scale(1.35); opacity: 0; } }
.tick { position: absolute; right: 0.4rem; bottom: 0.6rem; display: flex; height: 2.4rem; width: 2.4rem; align-items: center; justify-content: center; border-radius: 9999px; background: #2fbf84; color: #fff; animation: pop 0.6s cubic-bezier(0.3, 1.6, 0.4, 1) 0.5s both; }
</style>
