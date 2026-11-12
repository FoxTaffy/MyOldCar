import { createRouter, createWebHashHistory } from 'vue-router'

// Hash-история — единственный надёжный вариант внутри Capacitor WebView.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
    { path: '/sensors', name: 'sensors', component: () => import('@/views/SensorsView.vue') },
    { path: '/diagnostics', name: 'diagnostics', component: () => import('@/views/DiagnosticsView.vue') },
    { path: '/stats', name: 'stats', component: () => import('@/views/StatsView.vue') },
    { path: '/service', name: 'service', component: () => import('@/views/ServiceView.vue') },
    { path: '/trip/:id', name: 'trip', component: () => import('@/views/TripView.vue') },
    { path: '/garage', name: 'garage', component: () => import('@/views/GarageView.vue') },
    { path: '/performance', name: 'performance', component: () => import('@/views/PerformanceView.vue') },
  ],
})
