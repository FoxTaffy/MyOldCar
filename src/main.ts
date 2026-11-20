import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { setupBackButton } from './services/BackHandler'
import '@fontsource/ibm-plex-sans/cyrillic-400.css'
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/cyrillic-500.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/cyrillic-600.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans-condensed/latin-500.css'
import '@fontsource/ibm-plex-sans-condensed/latin-600.css'
import '@fontsource/ibm-plex-mono/cyrillic-500.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './style.css'

setupBackButton(router)
createApp(App).use(router).mount('#app')
