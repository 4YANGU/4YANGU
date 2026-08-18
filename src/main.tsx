import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// Register the service worker with updateViaCache 'none' so phones ALWAYS
// revalidate /sw.js with the server. The default browser caching can keep an
// outdated service worker alive for days, which silently breaks installability.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .catch((error) => console.error('StoYangu service worker registration failed:', error));
  });
}

// Capture the native install prompt so the dashboard's Install button can use it.
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT = event;
  window.dispatchEvent(new Event('stoyangu-install-ready'));
});

// No matter where the install happens (dashboard button, browser menu, app
// sheet), remember it permanently so the Install card never shows again.
window.addEventListener('appinstalled', () => {
  localStorage.setItem('stoyangu-installed', '1');
  window.dispatchEvent(new Event('stoyangu-app-installed'));
});

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
