import type { LatLon, MapAdapter } from './MapAdapter'

export interface MapOptions {
  center: LatLon
  zoom: number
  /** Ключ Яндекс.Карт; пустой — OpenStreetMap. */
  yandexKey: string
  dark: boolean
}

/** Яндекс.Карты, если задан ключ и API загрузился; иначе Leaflet + OpenStreetMap (работает всегда). */
export async function createMap(el: HTMLElement, o: MapOptions): Promise<MapAdapter> {
  const key = o.yandexKey.trim()
  if (key) {
    try {
      const { loadYmaps, createYandexMap } = await import('./YandexMap')
      return await createYandexMap(await loadYmaps(key), el, o)
    } catch {
      // Нет сети, ключ не принят или API изменился — карта не должна остаться пустой.
      el.replaceChildren()
    }
  }
  const { createLeafletMap } = await import('./LeafletMap')
  return createLeafletMap(el, o.center, o.zoom)
}
