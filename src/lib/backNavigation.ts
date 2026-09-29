// Unified hardware/gesture back button manager for mobile (Capacitor & PWA)
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export type BackHandler = () => boolean;

const handlerStack: BackHandler[] = [];

export function pushBackHandler(handler: BackHandler): () => void {
  handlerStack.push(handler);
  return () => {
    const index = handlerStack.lastIndexOf(handler);
    if (index !== -1) {
      handlerStack.splice(index, 1);
    }
  };
}

export function handleAppBack(): boolean {
  for (let i = handlerStack.length - 1; i >= 0; i--) {
    const handler = handlerStack[i];
    try {
      if (handler()) {
        return true;
      }
    } catch (e) {
      console.warn('Back handler error:', e);
    }
  }
  return false;
}

// Expose on window for Android WebView evaluateJavascript bridge
if (typeof window !== 'undefined') {
  (window as unknown as { __stoyanguHandleBack: () => boolean }).__stoyanguHandleBack = handleAppBack;
}

// Register Capacitor App backButton listener if running natively
let capacitorListenerRegistered = false;
export function initBackNavigation() {
  if (capacitorListenerRegistered || typeof window === 'undefined') return;
  capacitorListenerRegistered = true;

  if (Capacitor.isNativePlatform()) {
    try {
      App.addListener('backButton', ({ canGoBack }) => {
        const handled = handleAppBack();
        if (!handled) {
          if (canGoBack) {
            window.history.back();
          } else {
            App.exitApp();
          }
        }
      });
    } catch (e) {
      console.warn('Could not register Capacitor backButton listener:', e);
    }
  }

  // Handle popstate for PWA and mobile browsers
  window.addEventListener('popstate', () => {
    handleAppBack();
  });
}
