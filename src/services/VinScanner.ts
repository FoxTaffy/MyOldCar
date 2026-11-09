import { Capacitor } from '@capacitor/core'
import { BarcodeFormat, BarcodeScanner } from '@capacitor-mlkit/barcode-scanning'
import type { Car } from './Cars'
import { extractVin } from './Vin'

/**
 * Сканирование VIN с камеры: штрихкод на лобовом стекле/в ПТС (Code 39/128, Data Matrix, PDF417) или QR.
 * Работает только в приложении на телефоне (ML Kit). Возвращает VIN или бросает понятную ошибку.
 */
export async function scanVinWithCamera(): Promise<string> {
  if (!Capacitor.isNativePlatform()) throw new Error('Сканер камеры работает только в приложении на телефоне')
  const { supported } = await BarcodeScanner.isSupported()
  if (!supported) throw new Error('Это устройство не поддерживает сканирование штрихкодов')
  if (Capacitor.getPlatform() === 'android') {
    const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable()
    // Модуль сканера ставится из Google Play Services один раз (нужен интернет).
    if (!available) await BarcodeScanner.installGoogleBarcodeScannerModule()
  }
  const { barcodes } = await BarcodeScanner.scan({
    formats: [BarcodeFormat.Code39, BarcodeFormat.Code128, BarcodeFormat.DataMatrix, BarcodeFormat.Pdf417, BarcodeFormat.QrCode],
  })
  for (const b of barcodes) {
    const vin = extractVin(b.rawValue ?? b.displayValue ?? '')
    if (vin) return vin
  }
  throw new Error(barcodes.length ? 'В штрихкоде нет VIN' : 'Код не найден — наведите камеру на VIN на стекле или в ПТС')
}

/** Онлайн-расшифровка VIN через базу NHTSA vPIC (лучше всего знает американские авто; для российских данных мало). */
export async function decodeVinOnline(vin: string): Promise<Partial<Car>> {
  const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`)
  if (!res.ok) throw new Error(`Сервис недоступен (${res.status})`)
  const j = (await res.json()) as { Results?: Record<string, string>[] }
  const r = j.Results?.[0]
  if (!r) throw new Error('Пустой ответ')
  const num = (s?: string): number | null => (s && Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : null)
  const title = (s?: string): string => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '')
  const out: Partial<Car> = {}
  if (r.Make) out.make = title(r.Make)
  if (r.Model) out.model = r.Model
  if (num(r.ModelYear)) out.year = num(r.ModelYear)
  if (num(r.DisplacementL)) out.displacementL = Math.round((num(r.DisplacementL) as number) * 10) / 10
  if (num(r.EngineHP)) out.powerHp = Math.round(num(r.EngineHP) as number)
  if (r.BodyClass) out.body = r.BodyClass
  if (r.DriveType) out.drive = r.DriveType
  if (r.EngineModel) out.engineCode = r.EngineModel
  if (!Object.keys(out).length) throw new Error('База не знает этот VIN')
  return out
}
