import { mount } from 'svelte'
import { registerSW } from 'virtual:pwa-register'
import './app.css'
import App from './App.svelte'

// Installs the service worker that precaches the build for offline use.
registerSW({ immediate: true })

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
