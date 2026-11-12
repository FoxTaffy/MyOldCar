import { reactive, watch } from 'vue'

const KEY = 'myoldcar.ui.v1'

export type ThemeMode = 'light' | 'dark' | 'auto'

/** Плитки главного меню: id → маршрут, подпись, значок. */
export interface MenuDef { id: string; to: string; title: string; icon: string }
export const MENU: MenuDef[] = [
  { id: 'monitor', to: '/monitor', title: 'Мониторинг', icon: 'monitor' },
  { id: 'diag', to: '/diagnostics', title: 'Диагностика автомобиля', icon: 'carsearch' },
  { id: 'dash', to: '/dashboard', title: 'Приборная доска', icon: 'gauge' },
  { id: 'trips', to: '/stats', title: 'История вождения', icon: 'route' },
  { id: 'style', to: '/style', title: 'Стиль вождения', icon: 'wheel' },
  { id: 'journal', to: '/service', title: 'Журнал обслуживания', icon: 'pump' },
  { id: 'fuel', to: '/fuel', title: 'Топливная эффективность', icon: 'leaf' },
  { id: 'engine', to: '/engine', title: 'Диагностика двигателя', icon: 'engine' },
  { id: 'perf', to: '/performance', title: 'Замер 0–100', icon: 'stopwatch' },
  { id: 'hud', to: '/hud', title: 'HUD', icon: 'hud' },
  { id: 'parking', to: '/parking', title: 'Стоянка', icon: 'parking' },
  { id: 'faq', to: '/help', title: 'Руководство и FAQ', icon: 'book' },
  { id: 'settings', to: '/settings', title: 'Настройки', icon: 'gear' },
]

/** Значения для трёх плиток в шапке главной. */
export const STAT_IDS = ['avgKm', 'avgTime', 'lastDiag', 'totalKm', 'totalTime', 'avgFuel', 'totalFuel', 'avgSpeed', 'maxSpeed', 'safety', 'eco', 'odometer', 'trips', 'cost'] as const
export type StatId = (typeof STAT_IDS)[number]

interface Ui {
  theme: ThemeMode
  /** Масштаб шрифта: −2…+3 шага по 8%. */
  fontStep: number
  animations: boolean
  currency: string
  /** Порог превышения скорости для «Стиля вождения», км/ч. */
  speedLimit: number
  graphFill: boolean
  /** Подсвечивать плитки мониторинга цветом зоны (норма / внимание / вне нормы). */
  zoneColors: boolean
  homeStats: StatId[]
  menuOrder: string[]
  menuHidden: string[]
  /** Плитки экрана «Мониторинг»: id датчиков по порядку. */
  monitor: string[]
  /** Предупредить, если пробег до замены меньше этой доли интервала. */
  warnPct: number
  /** Пользователь закрыл подсказку на экране журнала. */
  hintJournal: boolean
}

function load(): Ui {
  const d: Ui = {
    theme: 'light', fontStep: 0, animations: true, currency: '₽', speedLimit: 110, graphFill: true, zoneColors: true,
    homeStats: ['avgKm', 'avgTime', 'lastDiag'], menuOrder: MENU.map((m) => m.id), menuHidden: [],
    monitor: ['speed', 'rpm', 'coolant', 'load', 'throttle', 'voltage'], warnPct: 80, hintJournal: false,
  }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) Object.assign(d, JSON.parse(raw))
  } catch { /* ignore */ }
  // Новые плитки меню, появившиеся в обновлении, добавляем в конец.
  d.menuOrder = [...d.menuOrder.filter((id) => MENU.some((m) => m.id === id)), ...MENU.map((m) => m.id).filter((id) => !d.menuOrder.includes(id))]
  if (!Array.isArray(d.homeStats) || d.homeStats.length === 0) d.homeStats = ['avgKm', 'avgTime', 'lastDiag']
  return d
}

const ui = reactive<Ui>(load())
watch(ui, (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
export function applyTheme(): void {
  if (typeof document === 'undefined') return
  const dark = ui.theme === 'dark' || (ui.theme === 'auto' && !!mq?.matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.setProperty('--font-scale', String(1 + ui.fontStep * 0.08))
  root.classList.toggle('no-anim', !ui.animations)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#090b0f' : '#eef3fa')
}
watch(() => [ui.theme, ui.fontStep, ui.animations], applyTheme, { immediate: true })
mq?.addEventListener?.('change', applyTheme)

export function useUi() {
  return {
    ui,
    /** Видимые плитки меню в выбранном порядке. */
    menu: () => ui.menuOrder.map((id) => MENU.find((m) => m.id === id)).filter((m): m is MenuDef => !!m && !ui.menuHidden.includes(m.id)),
    isDark: () => document.documentElement.dataset.theme === 'dark',
  }
}

/** Перестановка элемента массива на месте (для кнопок ▲▼ в редакторах списков). */
export function moveItem<T>(a: T[], i: number, d: -1 | 1): void {
  const j = i + d
  if (j < 0 || j >= a.length) return
  const [x] = a.splice(i, 1)
  a.splice(j, 0, x)
}

import { ref } from 'vue'
/** Открыт ли мастер первоначальной настройки (общий для App и экрана настроек). */
export const showWizard = ref(false)
/** Открыто ли боковое меню. */
export const drawerOpen = ref(false)
