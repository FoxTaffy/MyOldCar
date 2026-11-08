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

## На телефоне
ELM327 Wi-Fi — это сырой TCP (192.168.0.10:35000), браузерный WebSocket к нему не подключится. Нужен нативный Capacitor-плагин TCP с именем `TcpSocket` и методами `connect/send/disconnect` + событие `data` (контракт — в `ELMService.ts`, `CapacitorTcpTransport`). Плагин в проект не включён — подберите/напишите под него.
```bash
npx cap add android && npm run cap:sync
```
