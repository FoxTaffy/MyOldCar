<script setup lang="ts">
/** Вкладки-таблетки: Безопасность | Эко, день | месяц и т.п. */
defineProps<{ options: { id: string; label: string }[]; modelValue: string; underline?: boolean }>()
defineEmits<{ 'update:modelValue': [string] }>()
</script>

<template>
  <div v-if="underline" class="flex border-b border-night-600" role="tablist">
    <button v-for="o in options" :key="o.id" role="tab" :aria-selected="modelValue === o.id" class="relative flex-1 whitespace-nowrap px-3 py-3 text-sm font-semibold transition-colors" :class="modelValue === o.id ? 'text-ink' : 'text-faint'" @click="$emit('update:modelValue', o.id)">
      {{ o.label }}<span v-if="modelValue === o.id" class="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-accent" />
    </button>
  </div>
  <div v-else class="inline-flex rounded-full bg-night-700 p-0.5" role="tablist">
    <button v-for="o in options" :key="o.id" role="tab" :aria-selected="modelValue === o.id" class="rounded-full px-4 py-1.5 text-sm font-medium transition-colors" :class="modelValue === o.id ? 'bg-night-800 text-ink shadow-sm' : 'text-mute'" @click="$emit('update:modelValue', o.id)">{{ o.label }}</button>
  </div>
</template>
