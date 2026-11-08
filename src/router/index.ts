import { createRouter, createWebHashHistory } from 'vue-router'

// Hash-история — единственный надёжный вариант внутри Capacitor WebView.
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: () => import('@/views/DashboardView.vue') },
    { path: '/diagnostics', name: 'diagnostics', component: () => import('@/views/DiagnosticsView.vue') },
    { path: '/performance', name: 'performance', component: () => import('@/views/PerformanceView.vue') },
  ],
})
