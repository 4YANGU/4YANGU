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

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
