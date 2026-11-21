/** Общий интерфейс карты: экраны рисуют через него и не знают, Leaflet это (OpenStreetMap) или Яндекс.Карты. Координаты везде [широта, долгота]. */
export type LatLon = [number, number]

export interface LineOpts { color: string; weight: number; opacity: number }

export interface MapAdapter {
  readonly provider: 'leaflet' | 'yandex'
  setView(c: LatLon, zoom?: number): void
  getZoom(): number
  panTo(c: LatLon): void
  /** Показать все точки; maxZoom — чтобы короткий маршрут не «улетал» в крупный план. */
  fitBounds(pts: LatLon[], padding: number, maxZoom: number): void
  /** Стирает линии и значки, нарисованные polyline()/marker(); точка dot() и окно popup() остаются. */
  clearOverlays(): void
  polyline(pts: LatLon[], o: LineOpts, onClick?: (at: LatLon) => void): void
  /** Значок из HTML; центр значка стоит в точке c. */
  marker(c: LatLon, html: string, size: number, onClick?: () => void): void
  /** Круглая отметка (курсор на маршруте, «последняя поездка»). */
  dot(c: LatLon, o: { radius: number; fill: string; ring: string }, tooltip?: string): { remove(): void }
  /** Всплывающее окно с HTML; возвращает его корневой элемент, чтобы дописать адрес. */
  popup(c: LatLon, html: string): HTMLElement | null
  /** Пользователь сам двигает карту (палец/мышь): нужно, чтобы перестать следовать за машиной. */
  onUserMove(cb: () => void): void
  destroy(): void
}
