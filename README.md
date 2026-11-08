# MyOldCar — локальный OBD-II сканер для ВАЗ 2104 (М73)

Vue 3 + Vite + TypeScript + Tailwind + Capacitor. ELM327 v1.5 Wi-Fi, без интернета и внешних API.

```bash
npm install
npm run dev     # браузер, режим Mock (симуляция ЭБУ, ошибка P0171)
npm test        # движок диагностики, парсеры, расход, замер 0-100
```

## Структура
- `src/services/ELMService.ts` — AT-инициализация, PID 0C/0D/05/10, режимы 03/04, транспорты (Capacitor TCP, WebSocket, Mock).
- `src/services/DiagnosticEngine.ts` + `src/data/dtcMatrix.json` — экспертная система: у каждой причины базовый вес и декларативные правила (+очки по датчикам/настройкам). Новые правила для «четвёрки» добавляются только в JSON.
- `src/services/PerformanceTimer.ts` — автомат 0–100 + детектор пробуксовки сцепления.
- `src/services/FuelCalculator.ts` — л/ч и л/100 км по ДМРВ (AFR 14.7, ρ=745 г/л).

## На телефоне (APK)
Транспорт для реального адаптера — нативный плагин [`capacitor-tcp-socket`](https://www.npmjs.com/package/capacitor-tcp-socket) (Capacitor 8).
APK собирает GitHub Actions (`.github/workflows/android-apk.yml`): вкладка **Actions → Android APK → последний запуск → Artifacts → MyOldCar-debug-apk**.

Локально (нужны Node 22, JDK 21, Android SDK):
```bash
npm ci && npm run build
npx cap add android && npx cap sync android
cd android && ./gradlew assembleDebug   # android/app/build/outputs/apk/debug/app-debug.apk
```
Телефон подключайте к Wi-Fi адаптера (192.168.0.10:35000). Если Android предлагает отключиться из-за отсутствия интернета — оставайтесь в сети.
