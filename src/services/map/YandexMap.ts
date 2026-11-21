import type { LatLon, MapAdapter } from './MapAdapter'

/**
 * Яндекс.Карты JS API v3. Пакета с типами нет, поэтому объект API описан как «любой»:
 * используются только YMap, слои, YMapFeature и YMapMarker. Координаты в API — [долгота, широта].
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Ymaps3 = any

const SRC = 'https://api-maps.yandex.ru/v3/'
let loading: Promise<Ymaps3> | null = null

/** Подключает скрипт API один раз. Ошибка (нет сети, ключ отклонён) → карта уйдёт на запасной вариант. */
export function loadYmaps(apiKey: string, timeoutMs = 12000): Promise<Ymaps3> {
  if (loading) return loading
  loading = new Promise<Ymaps3>((resolve, reject) => {
    const s = document.createElement('script')
    s.src = `${SRC}?apikey=${encodeURIComponent(apiKey)}&lang=ru_RU`
    s.async = true
    const timer = setTimeout(() => reject(new Error('Яндекс.Карты: таймаут загрузки')), timeoutMs)
    s.onload = () => {
      clearTimeout(timer)
      const y = (window as unknown as { ymaps3?: Ymaps3 }).ymaps3
      if (!y) return reject(new Error('Яндекс.Карты: API недоступен'))
      y.ready.then(() => resolve(y), reject)
    }
    s.onerror = () => { clearTimeout(timer); reject(new Error('Яндекс.Карты: скрипт не загрузился (проверьте ключ и сеть)')) }
    document.head.appendChild(s)
  })
  // Неудачу не запоминаем: после смены ключа или появления сети можно пробовать снова.
  loading.catch(() => { loading = null; document.querySelectorAll(`script[src^="${SRC}"]`).forEach((n) => n.remove()) })
  return loading
}

const ll = (c: LatLon): [number, number] => [c[1], c[0]]
const Z_MARKER = 2500

export async function createYandexMap(y: Ymaps3, el: HTMLElement, o: { center: LatLon; zoom: number; dark: boolean }): Promise<MapAdapter> {
  const { YMap, YMapDefaultSchemeLayer, YMapDefaultFeaturesLayer, YMapFeature, YMapMarker, YMapControls } = y
  const map = new YMap(el, { location: { center: ll(o.center), zoom: o.zoom }, margin: [0, 0, 0, 0] })
  map.addChild(new YMapDefaultSchemeLayer({ theme: o.dark ? 'dark' : 'light' }))
  map.addChild(new YMapDefaultFeaturesLayer({}))
  try {
    // Кнопки приближения: отдельный пакет, без него карта всё равно работает (жесты).
    const { YMapZoomControl } = await y.import('@yandex/ymaps3-controls@0.0.1')
    map.addChild(new YMapControls({ position: 'right' }).addChild(new YMapZoomControl({})))
  } catch { /* ignore */ }

  const overlays: unknown[] = []
  let popupEl: unknown = null
  const add = (child: unknown): void => { map.addChild(child); overlays.push(child) }

  return {
    provider: 'yandex',
    setView: (c, z) => { map.setLocation({ center: ll(c), zoom: z ?? map.zoom, duration: 250 }) },
    getZoom: () => map.zoom as number,
    panTo: (c) => { map.setLocation({ center: ll(c), duration: 300 }) },
    fitBounds: (pts, padding, maxZoom) => {
      if (!pts.length) return
      let s = 90, n = -90, w = 180, e = -180
      for (const [la, lo] of pts) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo) }
      // Одна точка или крохотный маршрут: границы вырождены — показываем центр с предельным приближением.
      if (n - s < 0.0004 && e - w < 0.0004) {
        map.setLocation({ center: [(w + e) / 2, (s + n) / 2], zoom: maxZoom, duration: 300 })
        return
      }
      map.update({ margin: [padding, padding, padding, padding] })
      map.setLocation({ bounds: [[w, s], [e, n]], duration: 300 })
    },
    clearOverlays: () => { while (overlays.length) map.removeChild(overlays.pop()) },
    polyline: (pts, op, onClick) => {
      add(new YMapFeature({
        geometry: { type: 'LineString', coordinates: pts.map(ll) },
        style: { stroke: [{ color: op.color, width: op.weight, opacity: op.opacity }] },
        onClick: onClick
          ? (_obj: unknown, ev: { coordinates?: [number, number] }) => onClick(ev?.coordinates ? [ev.coordinates[1], ev.coordinates[0]] : pts[pts.length - 1])
          : undefined,
      }))
    },
    marker: (c, html, size, onClick) => {
      const d = document.createElement('div')
      d.innerHTML = html
      d.style.cssText = `width:${size}px;height:${size}px;transform:translate(-50%,-50%);cursor:${onClick ? 'pointer' : 'default'}`
      add(new YMapMarker({ coordinates: ll(c), zIndex: Z_MARKER, onClick }, d))
    },
    dot: (c, op, tooltip) => {
      const d = document.createElement('div')
      const r = op.radius
      d.style.cssText = `width:${r * 2}px;height:${r * 2}px;border-radius:50%;background:${op.fill};border:3px solid ${op.ring};box-sizing:content-box;transform:translate(-50%,-50%)`
      if (tooltip) d.title = tooltip
      const m = new YMapMarker({ coordinates: ll(c), zIndex: Z_MARKER + 1 }, d)
      map.addChild(m)
      return { remove: () => { try { map.removeChild(m) } catch { /* уже убран */ } } }
    },
    popup: (c, html) => {
      if (popupEl) { try { map.removeChild(popupEl) } catch { /* ignore */ } popupEl = null }
      const box = document.createElement('div')
      box.style.cssText = 'position:relative;transform:translate(-50%,calc(-100% - 14px));background:#fff;border-radius:10px;padding:10px 26px 10px 12px;box-shadow:0 2px 12px rgba(0,0,0,.35);max-width:260px'
      box.innerHTML = html
      const close = document.createElement('button')
      close.textContent = '×'
      close.setAttribute('aria-label', 'Закрыть')
      close.style.cssText = 'position:absolute;top:2px;right:6px;border:0;background:none;color:#4a5260;font:20px/24px system-ui;cursor:pointer'
      const m = new YMapMarker({ coordinates: ll(c), zIndex: Z_MARKER + 2 }, box)
      close.onclick = () => { try { map.removeChild(m) } catch { /* ignore */ } if (popupEl === m) popupEl = null }
      box.appendChild(close)
      map.addChild(m)
      popupEl = m
      return box
    },
    onUserMove: (cb) => {
      // Собственные события контейнера: так отличаем жест пользователя от программного перемещения карты.
      let down = false
      el.addEventListener('pointerdown', () => { down = true })
      el.addEventListener('pointermove', () => { if (down) { down = false; cb() } })
      for (const t of ['pointerup', 'pointercancel', 'pointerleave']) el.addEventListener(t, () => { down = false })
      el.addEventListener('wheel', () => cb(), { passive: true })
    },
    destroy: () => { map.destroy() },
  }
}
