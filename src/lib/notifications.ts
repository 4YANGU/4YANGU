// StoYangu In-App & Background Notification Sound & Alert Manager

let audioCtx: AudioContext | null = null;
let audioUnlocked = false;
let fallbackAudio: HTMLAudioElement | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      try {
        audioCtx = new AudioContextClass();
      } catch {
        audioCtx = null;
      }
    }
  }
  return audioCtx;
}

export function unlockAudio() {
  if (audioUnlocked) return;
  const ctx = getAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().then(() => {
      audioUnlocked = true;
    }).catch(() => undefined);
  } else if (ctx) {
    audioUnlocked = true;
  }
}

if (typeof window !== 'undefined') {
  const onUserGesture = () => {
    unlockAudio();
    window.removeEventListener('pointerdown', onUserGesture);
    window.removeEventListener('touchstart', onUserGesture);
    window.removeEventListener('keydown', onUserGesture);
    window.removeEventListener('click', onUserGesture);
  };
  window.addEventListener('pointerdown', onUserGesture, { passive: true });
  window.addEventListener('touchstart', onUserGesture, { passive: true });
  window.addEventListener('keydown', onUserGesture, { passive: true });
  window.addEventListener('click', onUserGesture, { passive: true });
}

/**
 * Synthesizes and plays a crisp, melodic 2-tone notification ping chime (587Hz -> 880Hz)
 * with rich harmonics and smooth bell decay. Includes HTMLAudioElement fallback and haptic vibration.
 */
export function playNotificationPing(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        try { navigator.vibrate([180, 70, 180]); } catch { /* ignore vibration error */ }
      }

      const ctx = getAudioContext();
      if (ctx) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => undefined);
        }

        const now = ctx.currentTime + 0.005;
        const masterGain = ctx.createGain();
        masterGain.gain.setValueAtTime(0.85, now);
        masterGain.connect(ctx.destination);

        // Note 1: D5 (587.33 Hz) - initial gentle bell tone
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(587.33, now);
        gain1.gain.setValueAtTime(0.0001, now);
        gain1.gain.linearRampToValueAtTime(0.55, now + 0.006);
        gain1.gain.exponentialRampToValueAtTime(0.01, now + 0.11);
        osc1.connect(gain1);
        gain1.connect(masterGain);
        osc1.start(now);
        osc1.stop(now + 0.12);

        // Note 2: A5 (880 Hz) - bright, resonant main chime
        const note2Time = now + 0.075;
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(880.0, note2Time);
        gain2.gain.setValueAtTime(0.0001, note2Time);
        gain2.gain.linearRampToValueAtTime(0.75, note2Time + 0.006);
        gain2.gain.exponentialRampToValueAtTime(0.0005, note2Time + 0.38);
        osc2.connect(gain2);
        gain2.connect(masterGain);
        osc2.start(note2Time);
        osc2.stop(note2Time + 0.4);

        // Overtone sparkle: A6 (1760 Hz) for glassy clarity
        const osc3 = ctx.createOscillator();
        const gain3 = ctx.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(1760.0, note2Time);
        gain3.gain.setValueAtTime(0.0001, note2Time);
        gain3.gain.linearRampToValueAtTime(0.18, note2Time + 0.005);
        gain3.gain.exponentialRampToValueAtTime(0.0005, note2Time + 0.22);
        osc3.connect(gain3);
        gain3.connect(masterGain);
        osc3.start(note2Time);
        osc3.stop(note2Time + 0.25);

        window.setTimeout(() => resolve(), 420);
        return;
      }
    } catch (err) {
      console.warn('Web Audio ping failed, trying HTMLAudio fallback:', err);
    }

    // Secondary fallback: static audio element
    try {
      if (typeof window !== 'undefined') {
        if (!fallbackAudio) {
          fallbackAudio = new Audio('/notification-ping.wav');
          fallbackAudio.preload = 'auto';
        }
        fallbackAudio.currentTime = 0;
        fallbackAudio.volume = 0.85;
        const playPromise = fallbackAudio.play();
        if (playPromise) {
          playPromise.then(() => resolve()).catch(() => resolve());
          return;
        }
      }
    } catch {
      // Audio autoplay blocked or unsupported
    }
    resolve();
  });
}

export type NotificationAlert = {
  id?: string;
  title?: string;
  sender: string;
  body: string;
  platform?: string;
  avatar?: string | null;
  threadKey?: string;
  storeId?: number;
  isOrder?: boolean;
  orderKey?: string;
  timestamp?: number;
  force?: boolean;
};

const recentAlerts = new Map<string, number>();

function isDuplicateAlert(key: string): boolean {
  const now = Date.now();
  for (const [k, time] of recentAlerts.entries()) {
    if (now - time > 15000) recentAlerts.delete(k);
  }
  if (recentAlerts.has(key)) return true;
  recentAlerts.set(key, now);
  return false;
}

/**
 * Dispatches an in-app banner toast, plays the audible notification ping chime,
 * triggers haptic vibration, and fires a native background Notification if the tab is hidden.
 */
export function triggerNotificationAlert(alert: NotificationAlert): void {
  if (typeof window === 'undefined') return;

  const dedupKey = alert.id || (alert.orderKey ? `order:${alert.orderKey}` : `${alert.threadKey || alert.sender}:${alert.body.slice(0, 40)}`);
  if (!alert.force && isDuplicateAlert(dedupKey)) {
    return;
  }

  const title: string = alert.title || (alert.isOrder ? `New Order: ${alert.sender}` : `New message from ${alert.sender}`);
  const fullAlert: NotificationAlert & { id: string; title: string; timestamp: number } = {
    ...alert,
    id: alert.id || `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: alert.timestamp || Date.now(),
    title,
  };

  // 1. Play the crisp audio chime and vibrate
  void playNotificationPing();

  // 2. Dispatch custom event for the in-app floating toast banner
  try {
    window.dispatchEvent(new CustomEvent('stoyangu:notification-alert', { detail: fullAlert }));
  } catch { /* ignore */ }

  // 3. If tab is backgrounded / document is hidden and Notification permission is granted, fire OS alert
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const tag = alert.threadKey ? `inbox-${alert.threadKey}` : `alert-${Date.now()}`;
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(fullAlert.title, {
            body: fullAlert.body,
            icon: alert.avatar || '/favicon-192.png',
            badge: '/favicon-32.png',
            tag,
            renotify: true,
            silent: false,
            data: { url: '/owner?inbox=1', threadKey: alert.threadKey },
          } as NotificationOptions).catch(() => undefined);
        }).catch(() => undefined);
      } else {
        const notif = new Notification(fullAlert.title, {
          body: fullAlert.body,
          icon: alert.avatar || '/favicon-192.png',
          badge: '/favicon-32.png',
          tag,
          renotify: true,
          silent: false,
        } as NotificationOptions);
        notif.onclick = () => {
          window.focus();
          notif.close();
        };
      }
    } catch (err) {
      console.warn('Could not show background notification:', err);
    }
  }
}
