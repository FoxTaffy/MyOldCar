/** Короткий справочник марок и моделей для мастера добавления автомобиля. Нужной нет — есть «Ручной ввод». */
export const CATALOG: Record<string, string[]> = {
  LADA: ['2104', '2105', '2106', '2107', '2108', '2109', '21099', '2110', '2112', '2114', '2115', '2121 Нива', 'Niva Legend', 'Niva Travel', 'Granta', 'Kalina', 'Priora', 'Vesta', 'XRAY', 'Largus'],
  'ВАЗ': ['2101', '2102', '2103', '2104', '2105', '2106', '2107', '2108', '2109', '21099', '2110', '2111', '2112', '2113', '2114', '2115', '2121 Нива'],
  'ГАЗ': ['Волга 24', 'Волга 3110', 'Волга 31105', 'Газель', 'Соболь'],
  'УАЗ': ['Патриот', 'Хантер', 'Буханка'],
  'Москвич': ['412', '2140', '2141'],
  'Daewoo': ['Nexia', 'Matiz', 'Lanos'],
  Chevrolet: ['Niva', 'Lacetti', 'Aveo', 'Cruze', 'Lanos'],
  Ford: ['Focus', 'Fiesta', 'Mondeo', 'Fusion', 'Transit'],
  Honda: ['Civic', 'Accord', 'CR-V', 'Fit'],
  Hyundai: ['Solaris', 'Accent', 'Elantra', 'Getz', 'Santa Fe', 'Tucson'],
  Kia: ['Rio', 'Ceed', 'Sportage', 'Cerato', 'Spectra'],
  Mazda: ['3', '6', 'CX-5', '323'],
  Mitsubishi: ['Lancer', 'Outlander', 'Pajero', 'Colt'],
  Nissan: ['Almera', 'Qashqai', 'Note', 'Tiida', 'X-Trail'],
  Opel: ['Astra', 'Vectra', 'Corsa', 'Zafira'],
  Renault: ['Logan', 'Sandero', 'Duster', 'Megane', 'Clio'],
  Skoda: ['Octavia', 'Fabia', 'Rapid', 'Superb'],
  Toyota: ['Corolla', 'Camry', 'RAV4', 'Land Cruiser', 'Yaris'],
  Volkswagen: ['Golf', 'Polo', 'Passat', 'Jetta', 'Tiguan'],
  Audi: ['A4', 'A6', '80', '100'],
  BMW: ['3 Series', '5 Series', 'X5', 'E34', 'E39'],
  'Mercedes-Benz': ['C-Class', 'E-Class', 'W124', 'Sprinter'],
  Peugeot: ['206', '307', '408', '3008'],
  Citroen: ['C4', 'Berlingo', 'C3'],
  Suzuki: ['Swift', 'Grand Vitara', 'Jimny'],
  Subaru: ['Impreza', 'Forester', 'Legacy'],
  Lexus: ['IS', 'RX', 'LX'],
  Chery: ['Tiggo', 'Amulet', 'M11'],
  Geely: ['Emgrand', 'Atlas', 'MK'],
}

export const BRANDS = Object.keys(CATALOG)

export const FUEL_TYPES: { id: string; label: string; car: 'АИ-92' | 'АИ-95' | 'АИ-98' | 'ДТ' | 'Газ' }[] = [
  { id: 'АИ-92', label: 'Бензин АИ-92', car: 'АИ-92' },
  { id: 'АИ-95', label: 'Бензин АИ-95', car: 'АИ-95' },
  { id: 'АИ-98', label: 'Премиум бензин АИ-98', car: 'АИ-98' },
  { id: 'ДТ', label: 'Дизель', car: 'ДТ' },
  { id: 'Газ', label: 'Газ (LPG / метан)', car: 'Газ' },
]

/* Расширение справочника: ещё популярные марки (добавлены после первой версии списка). */
Object.assign(CATALOG, {
  Volvo: ['S40', 'S60', 'S80', 'V40', 'XC60', 'XC90', '850', '440'],
  Fiat: ['Albea', 'Doblo', 'Punto', 'Panda', '500'],
  Jeep: ['Grand Cherokee', 'Wrangler', 'Compass'],
  Haval: ['H6', 'Jolion', 'F7', 'H9'],
  SsangYong: ['Kyron', 'Actyon', 'Rexton'],
  'Land Rover': ['Defender', 'Discovery', 'Freelander', 'Range Rover'],
  Infiniti: ['FX', 'G', 'QX'],
  SEAT: ['Ibiza', 'Leon', 'Cordoba'],
  Lifan: ['Solano', 'X60', 'Breez'],
  Dodge: ['Caliber', 'Charger', 'Ram'],
  Porsche: ['Cayenne', 'Macan', '911'],
  Tesla: ['Model 3', 'Model S', 'Model Y'],
  MINI: ['Cooper', 'Countryman'],
  Jaguar: ['XF', 'XJ', 'S-Type'],
  'Alfa Romeo': ['147', '156', 'Giulietta'],
  Saab: ['9-3', '9-5'],
  Daihatsu: ['Terios', 'Sirion'],
  Acura: ['MDX', 'TL', 'RDX'],
})
// Пересобираем список марок: российские и самые популярные — первыми.
export const BRANDS_ORDERED: string[] = [...new Set([...['LADA', 'ВАЗ', 'ГАЗ', 'УАЗ', 'Москвич', 'Kia', 'Hyundai', 'Toyota', 'Renault', 'Skoda', 'Volkswagen', 'Nissan', 'Chevrolet', 'Ford'], ...Object.keys(CATALOG)])]
BRANDS.splice(0, BRANDS.length, ...BRANDS_ORDERED)

/** Файлы логотипов в public/logos (лежат в приложении — работают без интернета). */
const LOGO_SLUGS: Record<string, string> = {
  lada: 'lada', 'ваз': 'vaz', 'газ': 'gaz', 'уаз': 'uaz', daewoo: 'daewoo', chevrolet: 'chevrolet', ford: 'ford', honda: 'honda', hyundai: 'hyundai',
  kia: 'kia', mazda: 'mazda', mitsubishi: 'mitsubishi', nissan: 'nissan', opel: 'opel', renault: 'renault', skoda: 'skoda', toyota: 'toyota',
  volkswagen: 'volkswagen', audi: 'audi', bmw: 'bmw', 'mercedes-benz': 'mercedes-benz', mercedes: 'mercedes-benz', peugeot: 'peugeot', citroen: 'citroen',
  suzuki: 'suzuki', subaru: 'subaru', lexus: 'lexus', chery: 'chery', geely: 'geely', volvo: 'volvo', fiat: 'fiat', jeep: 'jeep', haval: 'haval',
  ssangyong: 'ssangyong', 'land rover': 'land-rover', infiniti: 'infiniti', seat: 'seat', lifan: 'lifan', dodge: 'dodge', porsche: 'porsche',
  tesla: 'tesla', mini: 'mini', jaguar: 'jaguar', 'alfa romeo': 'alfa-romeo', saab: 'saab', daihatsu: 'daihatsu', acura: 'acura',
}

/** Путь к логотипу марки или null, если такого файла нет. */
export function brandLogo(make: string): string | null {
  const slug = LOGO_SLUGS[make.trim().toLowerCase()]
  return slug ? `${import.meta.env.BASE_URL}logos/${slug}.png` : null
}
