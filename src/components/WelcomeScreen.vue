<script setup lang="ts">
import { computed, ref } from 'vue'
import AddCarSheet from '@/components/AddCarSheet.vue'
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
    <Transition name="wl" mode="out-in">
      <section v-if="phase === 'hello'" key="hello" class="mx-auto flex h-full max-w-md flex-col justify-between px-6 pb-10 pt-[max(3rem,env(safe-area-inset-top))]">
        <div>
          <h1 class="font-condensed text-4xl font-semibold tracking-wide">MyOldCar</h1>
          <p class="mt-2 max-w-[22rem] text-[15px] leading-snug text-soft">Читает ошибки двигателя, ведёт поездки и напоминает про масло. Работает без интернета.</p>
        </div>

        <dl class="rows border-y border-night-600 text-sm">
          <div><dt>Подключение</dt><dd>ELM327, Wi-Fi или Bluetooth</dd></div>
          <div><dt>Что делает</dt><dd>только читает</dd></div>
          <div><dt>Данные</dt><dd>хранятся в телефоне</dd></div>
        </dl>

        <div class="space-y-3">
          <p class="text-sm text-mute">Сначала добавьте машину: марку, модель, топливо и объём двигателя. Около полминуты.</p>
          <button class="btn w-full !py-3.5" @click="phase = 'wizard'">Добавить автомобиль</button>
        </div>
      </section>

      <section v-else-if="phase === 'done'" key="done" class="mx-auto flex h-full max-w-md flex-col justify-between px-6 pb-10 pt-[max(3rem,env(safe-area-inset-top))]">
        <div class="space-y-4">
          <BrandLogo :make="car().make" :size="72" />
          <div>
            <h2 class="text-3xl font-semibold">{{ title }}</h2>
            <p class="mt-2 text-sm text-mute">Профиль сохранён. Остальное можно дополнить позже в разделе «Мои автомобили».</p>
          </div>
        </div>
        <button class="btn w-full !py-3.5" @click="emit('done')">Продолжить</button>
      </section>
    </Transition>

    <AddCarSheet v-if="phase === 'wizard'" forced @close="phase = 'hello'" @done="created" />
  </div>
</template>

<style scoped>
.wl-enter-active, .wl-leave-active { transition: opacity 0.2s ease; }
.wl-enter-from, .wl-leave-to { opacity: 0; }
</style>
