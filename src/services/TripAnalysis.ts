import type { TripEvent } from './TripRecorder'

/** Точка трека: координаты GPS + показания датчиков на этот момент. */
export interface TrackPoint {
  t: number
  lat: number | null
  lon: number | null
  /** Скорость, км/ч (OBD, иначе GPS). */
  spd: number | null
  rpm: number | null
  /** Температура ОЖ, °C. */
  ect: number | null
  /** Расход воздуха ДМРВ, г/с. */
  maf: number | null
  load: number | null
  thr: number | null
  volt: number | null
  /** Лампа Check Engine горит. */
  mil: boolean
  /** Мгновенный расход, л/100 км (если считается). */
  l100?: number | null
}

export interface Stop {
  start: number
  end: number
  lat: number | null
  lon: number | null
  /** Двигатель работал на стоянке (обороты > 0). */
  engineOn: boolean
}

export interface TrackAnalysis {
  stops: Stop[]
  /** Точки, где лампа Check Engine перешла из «погашена» в «горит» (в т.ч. горела с начала). */
  milPoints: TrackPoint[]
  maxSpeedPoint: TrackPoint | null
  /** Точки с координатами — для рисования маршрута. */
  route: TrackPoint[]
}

export const MIN_STOP_MS = 2 * 60_000

export function analyzeTrack(points: TrackPoint[], minStopMs = MIN_STOP_MS): TrackAnalysis {
  const stops: Stop[] = []
  let run: TrackPoint[] = []
  const flush = () => {
    if (run.length >= 2) {
      const start = run[0].t
      const end = run[run.length - 1].t
      if (end - start >= minStopMs) {
        const withPos = run.filter((p) => p.lat != null && p.lon != null)
        const lat = withPos.length ? withPos.reduce((a, p) => a + (p.lat as number), 0) / withPos.length : null
        const lon = withPos.length ? withPos.reduce((a, p) => a + (p.lon as number), 0) / withPos.length : null
        stops.push({ start, end, lat, lon, engineOn: run.some((p) => (p.rpm ?? 0) > 0) })
      }
    }
    run = []
  }
  for (const p of points) {
    if ((p.spd ?? 0) < 1) run.push(p)
    else flush()
  }
  flush()

  const milPoints: TrackPoint[] = []
  let prevMil = false
  let maxSpeedPoint: TrackPoint | null = null
  for (const p of points) {
    if (p.mil && !prevMil) milPoints.push(p)
    prevMil = p.mil
    if (p.spd != null && (maxSpeedPoint == null || p.spd > (maxSpeedPoint.spd ?? 0))) maxSpeedPoint = p
  }
  return { stops, milPoints, maxSpeedPoint, route: points.filter((p) => p.lat != null && p.lon != null) }
}

/** Ближайшая к точке (lat, lon) точка трека — для клика по линии маршрута. */
export function nearestPoint(points: TrackPoint[], lat: number, lon: number): TrackPoint | null {
  let best: TrackPoint | null = null
  let bd = Infinity
  for (const p of points) {
    if (p.lat == null || p.lon == null) continue
    const d = (p.lat - lat) ** 2 + ((p.lon - lon) * Math.cos((lat * Math.PI) / 180)) ** 2
    if (d < bd) { bd = d; best = p }
  }
  return best
}

export function haversineKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(x))
}

/** Цвет сегмента по скорости: зелёный → жёлтый → красный (0…120 км/ч). */
export function speedColor(kmh: number | null): string {
  if (kmh == null) return '#7b8696'
  const t = Math.max(0, Math.min(1, kmh / 120))
  const hue = 130 - t * 130
  return `hsl(${hue.toFixed(0)}, 85%, 50%)`
}

export type { TripEvent }

/** Точка в distanceM метрах от start по азимуту bearingDeg. */
export function destinationPoint(start: { lat: number; lon: number }, bearingDeg: number, distanceM: number): { lat: number; lon: number } {
  const R = 6371000
  const d = distanceM / R
  const b = (bearingDeg * Math.PI) / 180
  const lat1 = (start.lat * Math.PI) / 180
  const lon1 = (start.lon * Math.PI) / 180
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b))
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2))
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI }
}
