import { createRouter, createWebHashHistory } from 'vue-router'

// Hash-история — единственный надёжный вариант внутри Capacitor WebView.
// meta.bar: 'home' | 'tab' — общая шапка и нижняя навигация; 'none' — у экрана свой заголовок (PageHeader).
export const router = createRouter({
  history: createWebHashHistory(),
  scrollBehavior: () => ({ top: 0 }),
  routes: [
    { path: '/', name: 'home', component: () => import('@/views/HomeView.vue'), meta: { bar: 'home', title: 'MyOldCar' } },
    { path: '/monitor', name: 'monitor', component: () => import('@/views/MonitorView.vue'), meta: { bar: 'tab', title: 'Мониторинг' } },
    { path: '/diagnostics', name: 'diagnostics', component: () => import('@/views/DiagnosticsView.vue'), meta: { bar: 'tab', title: 'Диагностика' } },
    { path: '/stats', name: 'stats', component: () => import('@/views/StatsView.vue'), meta: { bar: 'tab', title: 'История вождения' } },
    { path: '/service', name: 'service', component: () => import('@/views/ServiceView.vue'), meta: { bar: 'tab', title: 'Журнал обслуживания' } },
    { path: '/dashboard', name: 'dashboard', component: () => import('@/views/DashboardView.vue'), meta: { bar: 'none', title: 'Приборная доска' } },
    { path: '/sensors', redirect: '/monitor' },
    { path: '/trip/:id', name: 'trip', component: () => import('@/views/TripView.vue'), meta: { bar: 'none', title: 'Поездка' } },
    { path: '/routes', name: 'routes', component: () => import('@/views/RoutesMapView.vue'), meta: { bar: 'none', title: 'Карта поездок' } },
    { path: '/wash', name: 'wash', component: () => import('@/views/WashView.vue'), meta: { bar: 'none', title: 'Умная мойка' } },
    { path: '/garage', name: 'garage', component: () => import('@/views/GarageView.vue'), meta: { bar: 'none', title: 'Автомобили' } },
    { path: '/performance', name: 'performance', component: () => import('@/views/PerformanceView.vue'), meta: { bar: 'none', title: 'Замер 0–100' } },
    { path: '/style', name: 'style', component: () => import('@/views/StyleView.vue'), meta: { bar: 'none', title: 'Стиль вождения' } },
    { path: '/fuel', name: 'fuel', component: () => import('@/views/FuelView.vue'), meta: { bar: 'none', title: 'Топливная эффективность' } },
    { path: '/engine', name: 'engine', component: () => import('@/views/EngineView.vue'), meta: { bar: 'none', title: 'Диагностика двигателя' } },
    { path: '/connection', name: 'connection', component: () => import('@/views/ConnectionView.vue'), meta: { bar: 'none', title: 'Подключение сканера' } },
    { path: '/permissions', name: 'permissions', component: () => import('@/views/PermissionsView.vue'), meta: { bar: 'none', title: 'Разрешения приложения' } },
    { path: '/settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { bar: 'none', title: 'Настройки' } },
    { path: '/edit-home', name: 'edit-home', component: () => import('@/views/EditHomeView.vue'), meta: { bar: 'none', title: 'Главный экран' } },
    { path: '/hud', name: 'hud', component: () => import('@/views/HudView.vue'), meta: { bar: 'none', title: 'HUD' } },
    { path: '/parking', name: 'parking', component: () => import('@/views/ParkingView.vue'), meta: { bar: 'none', title: 'Стоянка' } },
    { path: '/help', name: 'help', component: () => import('@/views/HelpView.vue'), meta: { bar: 'none', title: 'Руководство и FAQ' } },
  ],
})
