import { ref } from 'vue'

export const toast = ref<string | null>(null)
let timer: ReturnType<typeof setTimeout> | null = null

/** Короткое всплывающее сообщение внизу экрана. */
export function showToast(text: string, ms = 2000): void {
  toast.value = text
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { toast.value = null }, ms)
}
