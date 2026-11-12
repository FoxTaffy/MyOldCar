<script setup lang="ts">
import AppIcon from './AppIcon.vue'

/** Цифровая клавиатура для ввода суммы: строка в v-model, одна запятая, до двух знаков после неё. */
const props = defineProps<{ modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string] }>()
const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫']
function press(k: string): void {
  let s = props.modelValue
  if (k === '⌫') s = s.slice(0, -1)
  else if (k === ',') { if (!s.includes(',')) s = (s || '0') + ',' }
  else if (!(s.includes(',') && s.split(',')[1].length >= 2) && s.replace(',', '').length < 9) s = s === '0' ? k : s + k
  emit('update:modelValue', s)
}
</script>

<template>
  <div class="grid grid-cols-3 gap-y-1 border-t border-night-600 bg-night-800 py-2">
    <button v-for="k in keys" :key="k" class="flex h-14 items-center justify-center text-2xl font-medium active:bg-night-700" :aria-label="k === '⌫' ? 'Стереть' : k" @click="press(k)">
      <AppIcon v-if="k === '⌫'" name="back" /><template v-else>{{ k }}</template>
    </button>
  </div>
</template>
