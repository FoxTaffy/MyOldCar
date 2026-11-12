import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { setupBackButton } from './services/BackHandler'
import './style.css'

setupBackButton(router)
createApp(App).use(router).mount('#app')
