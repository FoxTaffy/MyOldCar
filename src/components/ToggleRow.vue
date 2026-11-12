<script setup lang="ts">
defineProps<{ title: string; sub?: string; modelValue: boolean }>()
defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <div class="row">
    <span class="min-w-0"><span class="row-title">{{ title }}</span><span v-if="sub" class="row-sub">{{ sub }}</span></span>
    <button role="switch" class="switch" :aria-checked="modelValue" :aria-label="title" @click="$emit('update:modelValue', !modelValue)" />
  </div>
</template>
