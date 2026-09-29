// Back-button handling for the installed web app (PWA) and mobile browsers.
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

let registered = false;
export function initBackNavigation() {
  if (registered || typeof window === 'undefined') return;
  registered = true;
  // Browser/standalone-app back gesture: let open modals and tabs handle it
  // first; otherwise normal history navigation proceeds.
  window.addEventListener('popstate', () => {
    handleAppBack();
  });
}
