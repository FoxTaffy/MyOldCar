import { computed, ref } from 'vue'
import { useGarage } from '@/composables/useGarage'
import { useVehicle } from '@/composables/useVehicle'
import { currentOdometer } from '@/services/Cars'
import { diagnose } from '@/services/DiagnosticEngine'
import { addScan, goneSince, loadScans, saveScans, scansFor, trends, type CodeTrend, type DtcScan } from '@/services/DtcHistory'
import { parseSinceClear, readiness, recentlyCleared, type EcuStatus, type Readiness, type SinceClear } from '@/services/EcuStatus'
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
  /** Тесты готовности (PID 01 01) и сведения с момента сброса (PID 30, 31, 4E). */
  status: EcuStatus | null
  readiness: Readiness | null
  sinceClear: SinceClear | null
  /** Запись в истории чтений. */
  scanId: string
}

const report = ref<ScanReport | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
/** История чтений всех машин. */
const scans = ref<DtcScan[]>(loadScans())
const clearing = ref(false)
const clearedAt = ref<number | null>(null)
const uid = (): string => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export function useDiagnostics() {
  const { settings, snapshot, getElm, protocolName, via } = useVehicle()
  const { setLastDiag, car } = useGarage()
  const demo = (): boolean => via.value === 'mock'
  function record(s: Omit<DtcScan, 'id' | 'carId' | 'odometerKm' | 'demo'>): string {
    const c = car()
    const id = uid()
    scans.value = addScan(scans.value, { id, carId: c.id, odometerKm: currentOdometer(c), demo: demo(), ...s })
    saveScans(scans.value)
    return id
  }

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
      // Тесты готовности и «с момента сброса» — необязательные PID, старые ЭБУ их не отдают.
      const status = await elm.readStatus().catch(() => null)
      const sc = await elm.readSinceClear().catch(() => null)
      const sinceClear = sc ? parseSinceClear(sc.warm, sc.dist, sc.time) : null
      const milOn = status?.mil ?? live?.milOn ?? null
      const scanId = record({ at: Date.now(), stored, pending, milOn })
      clearedAt.value = null
      report.value = {
        at: Date.now(),
        results: [
          ...stored.map((c) => ({ ...diagnose(c, live, settings), status: 'confirmed' as const })),
          ...pending.map((c) => ({ ...diagnose(c, live, settings), status: 'pending' as const })),
        ],
        live, freeze,
        ecuCount: live?.dtcCount ?? null,
        milOn,
        protocol: protocolName.value,
        status,
        readiness: readiness(status, car().year),
        sinceClear,
        scanId,
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

  /**
   * Сброс ошибок (режим 04). Перед сбросом то, что стирается, записывается в историю — чтобы коды и дата не потерялись.
   * После сброса сразу читаем коды снова: так видно, что ЭБУ действительно всё стёр.
   */
  async function clearCodes(): Promise<void> {
    if (clearing.value || busy.value) return
    clearing.value = true
    error.value = null
    try {
      const elm = getElm()
      const before = report.value
      const wiped = before ? scans.value.find((s) => s.id === before.scanId) : null
      await elm.clearDtcs()
      record({ at: Date.now(), stored: wiped?.stored ?? [], pending: wiped?.pending ?? [], milOn: false, cleared: true })
      clearedAt.value = Date.now()
      await scan()
      clearedAt.value = Date.now()
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      clearing.value = false
    }
  }

  /** История активной машины (демо отдельно), от новых к старым. */
  const history = computed<DtcScan[]>(() => scansFor(scans.value, car().id, demo()).reverse())
  const current = computed<DtcScan | null>(() => scans.value.find((s) => s.id === report.value?.scanId) ?? null)
  const codeTrends = computed<Record<string, CodeTrend>>(() => (current.value ? trends(history.value, current.value) : {}))
  const gone = computed<string[]>(() => (current.value ? goneSince(history.value, current.value) : []))
  const cleared = computed(() => recentlyCleared(report.value?.sinceClear ?? null, report.value?.readiness ?? null))
  function deleteHistory(): void {
    const ids = new Set(history.value.map((s) => s.id))
    scans.value = scans.value.filter((s) => !ids.has(s.id))
    saveScans(scans.value)
  }

  return {
    report, results, busy, error, scan, clearing, clearedAt, clearCodes, history, codeTrends, gone, cleared, deleteHistory,
    clear: () => { report.value = null; error.value = null },
  }
}
