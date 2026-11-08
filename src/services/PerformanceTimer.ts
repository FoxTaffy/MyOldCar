export interface PerfSample {
  /** мс с начала замера (или с момента первого сэмпла до старта — отрицательное не используется). */
  t: number
  speedKmh: number
  rpm: number
}

export type PerfState = 'idle' | 'running' | 'finished'

export interface PerfResult {
  durationMs: number
  samples: PerfSample[]
  warnings: string[]
}

export interface PerfOptions {
  targetKmh: number
  startKmh: number
  /** Окно анализа пробуксовки, мс. */
  slipWindowMs: number
  /** Рост оборотов в окне, считающийся «значительным», об/мин. */
  slipRpmRise: number
  /** Допустимое изменение скорости в окне, км/ч. */
  slipSpeedDelta: number
}

export const DEFAULT_PERF_OPTIONS: PerfOptions = {
  targetKmh: 100,
  startKmh: 1,
  slipWindowMs: 1000,
  slipRpmRise: 600,
  slipSpeedDelta: 1,
}

/**
 * Конечный автомат замера 0-100. Не зависит от времени/железа:
 * вызывайте feed() с каждым новым замером PID 010D (+ 010C). Легко тестируется.
 */
export class PerformanceTimer {
  state: PerfState = 'idle'
  samples: PerfSample[] = []
  result: PerfResult | null = null
  private t0 = 0

  constructor(private readonly opts: PerfOptions = DEFAULT_PERF_OPTIONS) {}

  reset(): void {
    this.state = 'idle'
    this.samples = []
    this.result = null
  }

  get elapsedMs(): number {
    const last = this.samples[this.samples.length - 1]
    return this.state === 'idle' || !last ? 0 : last.t
  }

  feed(nowMs: number, speedKmh: number, rpm: number): PerfState {
    if (this.state === 'finished') return this.state
    if (this.state === 'idle') {
      if (speedKmh < this.opts.startKmh) return this.state
      this.state = 'running'
      this.t0 = nowMs
    }
    this.samples.push({ t: nowMs - this.t0, speedKmh, rpm })
    if (speedKmh >= this.opts.targetKmh) {
      this.state = 'finished'
      this.result = {
        durationMs: this.interpolateFinish(),
        samples: this.samples,
        warnings: analyzeClutchSlip(this.samples, this.opts),
      }
    }
    return this.state
  }

  /** Линейная интерполяция момента пересечения порога скорости. */
  private interpolateFinish(): number {
    const n = this.samples.length
    const b = this.samples[n - 1]
    const a = this.samples[n - 2]
    if (!a || b.speedKmh === a.speedKmh) return b.t
    const k = (this.opts.targetKmh - a.speedKmh) / (b.speedKmh - a.speedKmh)
    return a.t + Math.min(1, Math.max(0, k)) * (b.t - a.t)
  }
}

/** Обороты росли, а скорость стояла — признак пробуксовки сцепления. */
export function analyzeClutchSlip(samples: PerfSample[], o: PerfOptions = DEFAULT_PERF_OPTIONS): string[] {
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      if (samples[j].t - samples[i].t > o.slipWindowMs) break
      const dRpm = samples[j].rpm - samples[i].rpm
      const dSpeed = samples[j].speedKmh - samples[i].speedKmh
      // Нужны обороты выше ~2500: на старте (отпускание сцепления) рост без скорости — норма.
      if (dRpm >= o.slipRpmRise && dSpeed <= o.slipSpeedDelta && samples[i].speedKmh > 5) {
        return ['Возможна пробуксовка сцепления']
      }
    }
  }
  return []
}
