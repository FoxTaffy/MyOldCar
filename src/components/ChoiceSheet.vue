<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import Sheet from './Sheet.vue'

/** Выбор одного варианта из списка (галочка у текущего). */
defineProps<{ title: string; options: { id: string; label: string; sub?: string }[]; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [string]; close: [] }>()
</script>

<template>
  <Sheet :title="title" @close="emit('close')">
    <div class="card overflow-hidden" role="listbox">
      <button v-for="o in options" :key="o.id" class="row" role="option" :aria-selected="o.id === modelValue" @click="emit('update:modelValue', o.id); emit('close')">
        <span class="min-w-0"><span class="row-title" :class="o.id === modelValue ? '!text-accent !font-semibold' : ''">{{ o.label }}</span><span v-if="o.sub" class="row-sub">{{ o.sub }}</span></span>
        <AppIcon v-if="o.id === modelValue" name="check" class="shrink-0 text-accent" />
      </button>
    </div>
  </Sheet>
</template>
