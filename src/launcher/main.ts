import '@fontsource/vt323/latin-400.css';
import '../styles/terminal.css';

import { mount } from 'svelte';
import App from './App.svelte';
import { applyTextures } from './texture';

applyTextures();
mount(App, { target: document.getElementById('app')! });

// Offline support. Not during development, where it would serve stale modules.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((err) => console.warn('service worker:', err));
  });
}
