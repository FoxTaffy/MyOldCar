import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { LatLon, MapAdapter } from './MapAdapter'

/** Карта на Leaflet + OpenStreetMap: работает без ключа. */
export function createLeafletMap(el: HTMLElement, center: LatLon, zoom: number): MapAdapter {
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, zoom)
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map)
  const layer = L.layerGroup().addTo(map)
  const canvas = L.canvas({ padding: 0.3, tolerance: 8 })

  return {
    provider: 'leaflet',
    setView: (c, z) => { map.setView(c, z ?? map.getZoom()) },
    getZoom: () => map.getZoom(),
    panTo: (c) => { map.panTo(c) },
    fitBounds: (pts, padding, maxZoom) => {
      if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [padding, padding], maxZoom })
    },
    clearOverlays: () => { layer.clearLayers() },
    polyline: (pts, o, onClick) => {
      const line = L.polyline(pts, { color: o.color, weight: o.weight, opacity: o.opacity, renderer: canvas })
      if (onClick) line.on('click', (e: L.LeafletMouseEvent) => onClick([e.latlng.lat, e.latlng.lng]))
      line.addTo(layer)
    },
    marker: (c, html, size, onClick) => {
      const m = L.marker(c, { icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }), zIndexOffset: 500 })
      if (onClick) m.on('click', onClick)
      m.addTo(layer)
    },
    dot: (c, o, tooltip) => {
      const m = L.circleMarker(c, { radius: o.radius, color: o.ring, weight: 3, fillColor: o.fill, fillOpacity: 1 }).addTo(map)
      if (tooltip) m.bindTooltip(tooltip)
      return { remove: () => { m.remove() } }
    },
    popup: (c, html) => L.popup({ maxWidth: 260 }).setLatLng(c).setContent(html).openOn(map).getElement() ?? null,
    onUserMove: (cb) => { map.on('dragstart', cb) },
    destroy: () => { map.remove() },
  }
}
