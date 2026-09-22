import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { handleGoogleRedirect } from './lib/googleAuth';

void handleGoogleRedirect();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  (window as unknown as { __STOYANGU_NATIVE_INSTALL_PROMPT: Event }).__STOYANGU_NATIVE_INSTALL_PROMPT = event;
  window.dispatchEvent(new Event('stoyangu-install-ready'));
});
window.addEventListener('appinstalled', () => localStorage.setItem('stoyangu-installed', '1'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
