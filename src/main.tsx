import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => undefined));
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT = event;
  window.dispatchEvent(new Event('stoyangu-install-ready'));
});
// Vfixed: remember a real installation everywhere (any page, any flow) so the
// dashboard never shows "Install app" again once the app is on the phone.
const persistInstallation = () => { try { localStorage.setItem('stoyangu-installed', '1'); } catch { /* private mode */ } };
window.addEventListener('appinstalled', persistInstallation);
if (window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true) persistInstallation();

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
