import { computed, ref } from 'vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { diagnose } from '@/services/DiagnosticEngine'
import type { FreezeFrame } from '@/services/ELMService'
import type { DiagnosisResult, SensorSnapshot } from '@/types'

/* Результат последнего чтения ошибок живёт на уровне модуля: он не пропадает при переходе на другую вкладку. */

export interface ScanReport {
  at: number
  results: DiagnosisResult[]
  /** Показания датчиков в момент чтения (по ним считаются вероятности причин). */
  live: SensorSnapshot | null
  /** Стоп-кадр из памяти ЭБУ, если он есть. */
  freeze: FreezeFrame | null
  /** Число кодов, о котором сообщает сам ЭБУ (PID 01 01), и состояние лампы на момент чтения. */
  ecuCount: number | null
  milOn: boolean | null
  protocol: string | null
}

const report = ref<ScanReport | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)

export function useDiagnostics() {
  const { settings, snapshot, getElm, protocolName } = useVehicle()
  const { setLastDiag } = useGarage()

  async function scan(): Promise<void> {
    if (busy.value) return
    busy.value = true
    error.value = null
    try {
      const elm = getElm()
      const stored = await elm.readDtcs()
      // Режим 07 поддерживают не все ЭБУ — ошибка тут не должна ронять чтение.
      const pending = (await elm.readPendingDtcs().catch(() => [])).filter((c) => !stored.includes(c))
      // Свежий снимок со всеми PID, а не последний из цикла опроса.
      const live = await elm.readSnapshot(true).catch(() => snapshot.value)
      if (!stored.length && !pending.length && live && live.rpm == null && live.speedKmh == null && live.coolantTempC == null) {
        // ЭБУ молчит на все запросы: «кодов нет» было бы неправдой.
        throw new Error('ЭБУ не отвечает — похоже, выключено зажигание. Включите его и считайте ошибки снова.')
      }
      const freeze = stored.length || pending.length ? await elm.readFreezeFrame().catch(() => null) : null
      report.value = {
        at: Date.now(),
        results: [
          ...stored.map((c) => ({ ...diagnose(c, live, settings), status: 'confirmed' as const })),
          ...pending.map((c) => ({ ...diagnose(c, live, settings), status: 'pending' as const })),
        ],
        live, freeze,
        ecuCount: live?.dtcCount ?? null,
        milOn: live?.milOn ?? null,
        protocol: protocolName.value,
      }
      setLastDiag(stored.length + pending.length)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      busy.value = false
    }
  }

  /** Вероятности зависят от галочек контекста — пересчитываем без нового обращения к ЭБУ. */
  const results = computed<DiagnosisResult[]>(() => {
    const r = report.value
    return r ? r.results.map((x) => ({ ...diagnose(x.code, r.live, settings), status: x.status })) : []
  })

  return { report, results, busy, error, scan, clear: () => { report.value = null; error.value = null } }
}
