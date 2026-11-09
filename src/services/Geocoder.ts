/** Обратное геокодирование (координаты → адрес) через OpenStreetMap Nominatim. Только по нажатию пользователя, с кэшем. */
const cache = new Map<string, Promise<string>>()

export async function placeName(lat: number, lon: number): Promise<string> {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = lookup(lat, lon)
  cache.set(key, p)
  // Неудачу не кэшируем — при появлении интернета можно повторить.
  p.catch(() => cache.delete(key))
  return p
}

async function lookup(lat: number, lon: number): Promise<string> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&accept-language=ru&lat=${lat}&lon=${lon}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Геокодер: ${res.status}`)
  const j = (await res.json()) as { display_name?: string; address?: Record<string, string> }
  const a = j.address ?? {}
  const street = [a.road, a.house_number].filter(Boolean).join(', ')
  const city = a.city ?? a.town ?? a.village ?? a.suburb ?? ''
  return [street, city].filter(Boolean).join(' · ') || j.display_name || 'Адрес не найден'
}
