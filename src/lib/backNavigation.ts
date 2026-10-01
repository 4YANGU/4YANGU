// Back-button handling for the installed web app (PWA) and mobile browsers.
export type BackHandler = () => boolean;

type OwnerBackGuard = { token: symbol; canExit: () => boolean };
const handlerStack: BackHandler[] = [];
const OWNER_GUARD_FLAG = 'stoyanguAppBackGuard';
let ownerBackGuard: OwnerBackGuard | null = null;
let registered = false;
let exitPopInProgress = false;
let exitPopResetTimer = 0;

function currentHistoryState(): Record<string, unknown> {
  const state = window.history.state;
  return state && typeof state === 'object' ? state as Record<string, unknown> : {};
}

export function pushHistoryFlag(flag: string, value: unknown = true): void {
  if (typeof window === 'undefined') return;
  window.history.pushState({ ...currentHistoryState(), [flag]: value }, '', window.location.href);
}

export function clearHistoryFlag(flag: string): void {
  if (typeof window === 'undefined') return;
  const state = currentHistoryState();
  if (!(flag in state)) return;
  const nextState = { ...state };
  delete nextState[flag];
  window.history.replaceState(nextState, '', window.location.href);
}

function pushOwnerBackGuard(): void {
  if (!ownerBackGuard || window.history.state?.[OWNER_GUARD_FLAG]) return;
  window.history.pushState({ ...currentHistoryState(), [OWNER_GUARD_FLAG]: true }, '', window.location.href);
}

export function activateOwnerBackGuard(canExit: () => boolean): () => void {
  const guard: OwnerBackGuard = { token: Symbol('owner-back-guard'), canExit };
  ownerBackGuard = guard;
  pushOwnerBackGuard();
  return () => {
    if (ownerBackGuard?.token === guard.token) ownerBackGuard = null;
    clearHistoryFlag(OWNER_GUARD_FLAG);
  };
}

export function pushBackHandler(handler: BackHandler): () => void {
  handlerStack.push(handler);
  return () => {
    const index = handlerStack.lastIndexOf(handler);
    if (index !== -1) handlerStack.splice(index, 1);
  };
}

export function handleAppBack(): boolean {
  for (let i = handlerStack.length - 1; i >= 0; i--) {
    const handler = handlerStack[i];
    try {
      if (handler()) return true;
    } catch (error) {
      console.warn('Back handler error:', error);
    }
  }
  return false;
}

export function initBackNavigation() {
  if (registered || typeof window === 'undefined') return;
  registered = true;
  window.addEventListener('popstate', () => {
    if (exitPopInProgress) {
      exitPopInProgress = false;
      window.clearTimeout(exitPopResetTimer);
      return;
    }

    const handled = handleAppBack();
    if (!ownerBackGuard) return;
    if (handled) {
      // A gesture from the bottom of the owner's navigation stack should
      // close the active surface/tab, then leave a fresh in-app stop behind.
      pushOwnerBackGuard();
      return;
    }

    let canExit = false;
    try { canExit = ownerBackGuard.canExit(); } catch { canExit = false; }
    if (!canExit) {
      pushOwnerBackGuard();
      return;
    }

    // The first pop removed the app's same-URL guard. Pop once more so native
    // browser/PWA back exits only from My Products, never from an inner page.
    exitPopInProgress = true;
    window.clearTimeout(exitPopResetTimer);
    exitPopResetTimer = window.setTimeout(() => { exitPopInProgress = false; }, 900);
    window.setTimeout(() => window.history.back(), 0);
  });
}
