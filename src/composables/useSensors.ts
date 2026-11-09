import { computed, reactive, watch } from 'vue'
import { BUILTIN_SENSORS, exportSensors, parseSensorImport, type SensorDef } from '@/data/sensors'
import { compileFormula } from '@/services/Formula'

const KEY = 'myoldcar.sensors.v1'

interface Store {
  custom: SensorDef[]
  /** id встроенных датчиков, скрытых на вкладке «Датчики». */
  hidden: string[]
}

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const j = JSON.parse(raw) as Partial<Store>
      return { custom: Array.isArray(j.custom) ? j.custom : [], hidden: Array.isArray(j.hidden) ? j.hidden : [] }
    }
  } catch { /* ignore */ }
  return { custom: [], hidden: [] }
}

const store = reactive<Store>(load())
watch(store, (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* ignore */ } }, { deep: true })

/** Все датчики, которые нужно опрашивать и записывать (включая скрытые — статистика поездок не должна теряться). */
const allDefs = computed<SensorDef[]>(() => [...BUILTIN_SENSORS, ...store.custom])
const visibleDefs = computed<SensorDef[]>(() => allDefs.value.filter((d) => !store.hidden.includes(d.id)))

export function useSensors() {
  return {
    store, allDefs, visibleDefs,
    isHidden: (id: string) => store.hidden.includes(id),
    toggle(id: string): void {
      const i = store.hidden.indexOf(id)
      if (i >= 0) store.hidden.splice(i, 1)
      else store.hidden.push(id)
    },
    /** Импорт из JSON; одноимённые (по id) заменяются. Возвращает число принятых и список ошибок. */
    importText(text: string): { added: number; errors: string[] } {
      const { sensors, errors } = parseSensorImport(text, compileFormula)
      for (const s of sensors) {
        const i = store.custom.findIndex((c) => c.id === s.id)
        if (i >= 0) store.custom.splice(i, 1, s)
        else store.custom.push(s)
      }
      return { added: sensors.length, errors }
    },
    remove(id: string): void {
      const i = store.custom.findIndex((c) => c.id === id)
      if (i >= 0) store.custom.splice(i, 1)
    },
    exportText: (): string => exportSensors(allDefs.value),
  }
}
