import { ArrowLeft, BellRing, Check, Download, Edit3, ExternalLink, Eye, EyeOff, KeyRound, LogOut, Package, Plus, RefreshCw, Settings, Store as StoreIcon, Trash2, Users, Volume2, WifiOff, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import PlatformLogo from '../components/PlatformLogo';
import PostComposer from '../components/PostComposer';
import ProductModal from '../components/ProductModal';
import SocialAccountsSettings from '../components/SocialAccountsSettings';
import SocialInbox from '../components/SocialInbox';
import { useAuth } from '../contexts/useAuth';
import { apiFetch, formatMoney, storeDomain, storeLink } from '../lib/api';
import { activateOwnerBackGuard, pushBackHandler } from '../lib/backNavigation';
import { triggerNotificationAlert, unlockAudio, type NotificationAlert } from '../lib/notifications';
import { applyStoreManifest, readSplashCache, saveSplashCache, splashCacheKey } from '../lib/pwa';
import supabase from '../lib/supabase';
import type { DashboardData, Order, Product, SocialMessage, Store } from '../types';
import '../pricing-update.css';
import '../order-update.css';
import '../manage-redesign.css';
import '../woyoyo-013.css';
import '../pwa-splash.css';
import '../owner-experience.css';

type StoreUpkeep = { orders_this_month?: number; orders_this_period?: number; upkeep_plan?: 'TRIAL' | 'PAID'; upkeep_due?: 0 | 200; upkeep_paid?: boolean; management_locked?: boolean; upkeep_period_day?: number; upkeep_period_starts_at?: string; upkeep_period_ends_at?: string };
type AppInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
declare global { interface Window { __STOYANGU_NATIVE_INSTALL_PROMPT?: AppInstallPromptEvent | null } }

const isStandaloneApp = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  (navigator as unknown as { standalone?: boolean }).standalone === true;

// Records the app installation on the platform even before notifications are allowed,
// so the founder dashboard shows "App installed" as soon as someone installs.
const markAppInstalled = () =>
  apiFetch('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ installed: true, user_agent: navigator.userAgent }),
  }).catch((reason) => console.warn('Could not record the installation yet:', reason));

type NotificationEnableResult = { status: 'granted' | 'denied' | 'unsupported'; testSent?: boolean; message?: string };

function ensureSettingsHistoryEntry() {
  const currentState = window.history.state;
  if (currentState?.stoyanguSettings) return;
  const preservedState = currentState && typeof currentState === 'object' ? currentState : {};
  window.history.pushState({ ...preservedState, stoyanguSettings: true }, '', window.location.href);
}

function clearSettingsHistoryEntry() {
  const currentState = window.history.state;
  if (!currentState || typeof currentState !== 'object' || !currentState.stoyanguSettings) return;
  const nextState = { ...currentState };
  delete nextState.stoyanguSettings;
  window.history.replaceState(nextState, '', window.location.href);
}

async function enableStoreNotifications(): Promise<NotificationEnableResult> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return { status: 'unsupported', message: 'This browser does not support push notifications.' };
  const config = await apiFetch<{ publicKey: string; pushConfigured?: boolean }>('/api/subscriptions');
  if (!config.publicKey || config.pushConfigured === false) return { status: 'unsupported', message: 'Push notifications are not configured for this deployment yet.' };
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return { status: 'denied', message: 'Allow notifications in your browser settings to receive alerts.' };

  const normalized = config.publicKey.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  let applicationServerKey: Uint8Array<ArrayBuffer>;
  try {
    const decoded = atob(padded);
    applicationServerKey = Uint8Array.from(decoded, (character) => character.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
  } catch {
    throw new Error('Notification setup is misconfigured. Please contact StoYangu support.');
  }

  let registration = await navigator.serviceWorker.getRegistration('/');
  if (!registration) registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  const existingKey = subscription?.options.applicationServerKey ? new Uint8Array(subscription.options.applicationServerKey) : null;
  const keyMatches = existingKey
    ? existingKey.length === applicationServerKey.length && existingKey.every((byte, index) => byte === applicationServerKey[index])
    : true;
  if (subscription && !keyMatches) {
    const staleEndpoint = subscription.endpoint;
    await subscription.unsubscribe();
    subscription = null;
    await apiFetch('/api/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: staleEndpoint }) }).catch(() => undefined);
  }
  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    } catch (reason) {
      // Clear a stale browser endpoint and retry once.
      const stale = await registration.pushManager.getSubscription();
      if (!stale) throw reason;
      await stale.unsubscribe();
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    }
  }
  const saved = await apiFetch<{ testSent?: boolean; testError?: string }>('/api/subscriptions', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON(), installed: isStandaloneApp(), user_agent: navigator.userAgent, test: true }),
  });
  return { status: 'granted', testSent: Boolean(saved.testSent), message: saved.testError || '' };
}

function NotificationToastBanner({
  alert,
  onOpen,
  onDismiss,
}: {
  alert: NotificationAlert | null;
  onOpen: (alert: NotificationAlert) => void;
  onDismiss: () => void;
}) {
  if (!alert) return null;

  return (
    <aside className="notification-toast-container" aria-live="polite" aria-atomic="true">
      <div
        className="notification-toast-banner"
        onClick={() => onOpen(alert)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onOpen(alert); }}
      >
        <span className="notification-toast-avatar-wrap">
          {alert.avatar ? (
            <img src={alert.avatar} alt="" />
          ) : (
            <span>{(alert.sender || '?')[0]?.toUpperCase()}</span>
          )}
          {alert.platform && (
            <span className="notification-toast-badge">
              <PlatformLogo platform={alert.platform} size={11} />
            </span>
          )}
        </span>
        <div className="notification-toast-body">
          <div className="notification-toast-top">
            <strong>{alert.sender}</strong>
            <small>{alert.isOrder ? 'Store Order' : 'New message'}</small>
          </div>
          <p className="notification-toast-preview">{alert.body}</p>
        </div>
        <button
          type="button"
          className="notification-toast-close"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label="Dismiss notification"
        >
          <X size={14} />
        </button>
      </div>
    </aside>
  );
}

export default function StoreDashboard() {
  const { storeId } = useParams();
  const { profile, signOut } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(() => {
    try { return sessionStorage.getItem(`stoyangu-settings-${storeId || 'owner'}`) === '1' || new URLSearchParams(window.location.search).has('oauth_state'); }
    catch { return false; }
  });
  // Web app install: true once Chrome/standalone confirms this phone has the app.
  const [installedLocally, setInstalledLocally] = useState(() => isStandaloneApp());
  // Branded launch splash for the INSTALLED app: the store's own logo (the
  // one shown next to the store name) with a loading animation, so the app
  // opens feeling like the store's own product.
  const [splashInfo] = useState(() => readSplashCache(splashCacheKey(storeId)));
  const [splashFading, setSplashFading] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const splashStartRef = useRef(0);

  // WOYOYO-013: My Products and My Customers are the two destinations of the
  // fixed bottom nav; the + button opens the camera-first post flow.
  const [activeTab, setActiveTab] = useState<'products' | 'customers'>(() => {
    try { const params = new URLSearchParams(window.location.search); return params.get('inbox') === '1' || params.has('oauth_state') ? 'customers' : sessionStorage.getItem(`stoyangu-tab-${storeId || 'owner'}`) === 'customers' ? 'customers' : 'products'; }
    catch { return 'products'; }
  });
  const [composerOpen, setComposerOpen] = useState(() => sessionStorage.getItem(`stoyangu-composer-${storeId || 'owner'}`) === '1');
  const [socialUnread, setSocialUnread] = useState(0);
  const [inboxKey, setInboxKey] = useState(0);
  const [offlineCacheUsed, setOfflineCacheUsed] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  const [isChatOpen, setIsChatOpen] = useState(false);

  // Floating In-App Notification Toast State
  const [activeToast, setActiveToast] = useState<NotificationAlert | null>(null);
  const toastTimerRef = useRef<number | undefined>(undefined);

  // Touch Swipe Gesture State (Instagram-grade 1:1 real-time tracking)
  const pagerContainerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragTranslateX, setDragTranslateX] = useState<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number; intent: 'horizontal' | 'vertical' | null } | null>(null);

  const canExitOwnerRef = useRef(false);
  useEffect(() => {
    canExitOwnerRef.current = activeTab === 'products' && !editing && !passwordOpen && !installOpen && !settingsOpen && !composerOpen;
  }, [activeTab, editing, installOpen, passwordOpen, settingsOpen, composerOpen]);
  useEffect(() => { splashStartRef.current = Date.now(); }, []);
  useEffect(() => activateOwnerBackGuard(() => canExitOwnerRef.current), []);
  useEffect(() => {
    if (settingsOpen) ensureSettingsHistoryEntry();
  }, [settingsOpen]);

  const showCustomers = useCallback(() => {
    setActiveTab('customers');
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    setActiveToast(null);
  }, []);

  const showToast = useCallback((alert: NotificationAlert) => {
    if (toastTimerRef.current !== undefined) window.clearTimeout(toastTimerRef.current);
    setActiveToast(alert);
    toastTimerRef.current = window.setTimeout(() => {
      setActiveToast(null);
      toastTimerRef.current = undefined;
    }, 5500);
  }, []);

  const handleToastOpen = useCallback((alert: NotificationAlert) => {
    dismissToast();
    showCustomers();
    if (alert.threadKey) {
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('stoyangu:open-thread', { detail: { threadKey: alert.threadKey } }));
      }, 120);
    }
  }, [dismissToast, showCustomers]);

  // Listen to global notification alert event
  useEffect(() => {
    const onNotificationAlert = (event: Event) => {
      const custom = event as CustomEvent<NotificationAlert>;
      if (custom.detail) {
        showToast(custom.detail);
      }
    };
    window.addEventListener('stoyangu:notification-alert', onNotificationAlert);
    return () => window.removeEventListener('stoyangu:notification-alert', onNotificationAlert);
  }, [showToast]);

  // Push back handler for store owner navigation.
  useEffect(() => {
    return pushBackHandler(() => {
      if (editing) {
        setEditing(null);
        return true;
      }
      if (passwordOpen) {
        setPasswordOpen(false);
        return true;
      }
      if (installOpen) {
        setInstallOpen(false);
        return true;
      }
      if (settingsOpen) {
        sessionStorage.removeItem(`stoyangu-settings-${storeId || 'owner'}`);
        clearSettingsHistoryEntry();
        setSettingsOpen(false);
        return true;
      }
      if (activeTab === 'customers') {
        setActiveTab('products');
        return true;
      }
      return false;
    });
  }, [editing, passwordOpen, installOpen, settingsOpen, activeTab, storeId]);

  const load = useCallback(async () => {
    setError('');
    try {
      setData(await apiFetch<DashboardData>(`/api/dashboard${storeId ? `?storeId=${storeId}` : ''}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the store.');
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Point at the generated StoYangu manifest carrying THIS store's icon.
  // The OS app name remains StoYangu; only the icon and launch animation use
  // the real store logo. Refresh the cache for the next launch's first frame.
  useEffect(() => {
    const storeData = data?.store;
    if (!storeData) return;
    applyStoreManifest(`slug=${encodeURIComponent(storeData.slug)}`, storeData.updated_at || undefined);
    saveSplashCache(splashCacheKey(storeId), { id: storeData.id, name: storeData.name, slug: storeData.slug, logo_url: storeData.logo_url });
  }, [data?.store, storeId]);

  useEffect(() => { document.title = 'StoYangu'; }, []);
  useEffect(() => { sessionStorage.setItem(`stoyangu-tab-${storeId || 'owner'}`, activeTab); }, [activeTab, storeId]);

  const openSettings = () => {
    ensureSettingsHistoryEntry();
    sessionStorage.setItem(`stoyangu-settings-${storeId || 'owner'}`, '1');
    setSettingsOpen(true);
  };
  const closeSettings = () => {
    sessionStorage.removeItem(`stoyangu-settings-${storeId || 'owner'}`);
    clearSettingsHistoryEntry();
    setSettingsOpen(false);
  };
  const openComposer = () => { sessionStorage.setItem(`stoyangu-composer-${storeId || 'owner'}`, '1'); setComposerOpen(true); };
  const closeComposer = () => { sessionStorage.removeItem(`stoyangu-composer-${storeId || 'owner'}`); setComposerOpen(false); };

  // Woyoyo-009: scrub the same-tab OAuth landing params once the dashboard
  // has them, so a refresh never replays the resume.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (!params.get('inbox') && !params.get('storeId')) return;
      params.delete('inbox'); params.delete('storeId');
      const rest = params.toString();
      window.history.replaceState(window.history.state || {}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    } catch { /* params stay — harmless */ }
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [activeTab]);

  const refreshSocialUnread = useCallback(async (storeIdValue: number) => {
    try {
      const status = await apiFetch<{ unread?: { total?: number } }>(`/api/media?action=social&op=status&storeId=${storeIdValue}`);
      setSocialUnread(Number(status.unread?.total || 0));
    } catch { /* badge stays hidden until the inbox loads */ }
  }, []);

  useEffect(() => {
    const onOffline = () => setOfflineCacheUsed(true);
    const onOnline = () => {
      setOfflineCacheUsed(false);
      void load();
      if (data?.store?.id) void refreshSocialUnread(data.store.id);
    };
    const onCacheFallback = () => setOfflineCacheUsed(true);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    window.addEventListener('stoyangu:offline-cache-used', onCacheFallback);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('stoyangu:offline-cache-used', onCacheFallback);
    };
  }, [data?.store?.id, load, refreshSocialUnread]);

  useEffect(() => {
    const id = data?.store?.id;
    if (!id) return;
    const timer = window.setTimeout(() => { void refreshSocialUnread(id); }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.store?.id, refreshSocialUnread]);

  // Periodic background inbox sync for social accounts
  useEffect(() => {
    const id = data?.store?.id;
    if (!id || activeTab !== 'products') return;
    const sync = async () => {
      if (document.hidden) return;
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'sync_inbox', store_id: id }) }).catch(() => undefined);
      await refreshSocialUnread(id);
    };
    void sync();
    const timer = window.setInterval(sync, 30000);
    return () => window.clearInterval(timer);
  }, [data?.store?.id, activeTab, refreshSocialUnread]);

  // Realtime message & order listeners for audible pings and in-app toasts
  useEffect(() => {
    const id = data?.store?.id;
    if (!id) return;

    const channel = supabase
      .channel(`store-dashboard-notifications-${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'social_messages',
        filter: `store_id=eq.${id}`,
      }, (event) => {
        const msg = event.new as SocialMessage;
        if (msg.direction === 'in') {
          triggerNotificationAlert({
            id: `msg-${msg.id}`,
            sender: msg.sender_name || 'Customer',
            body: msg.body,
            platform: msg.platform,
            avatar: msg.sender_avatar,
            threadKey: msg.thread_key,
            storeId: id,
          });
          setSocialUnread((current) => current + 1);
          setInboxKey((k) => k + 1);
        }
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
        filter: `store_id=eq.${id}`,
      }, (event) => {
        const order = event.new as Order;
        triggerNotificationAlert({
          id: `order-${order.id || order.order_key}`,
          title: `New store order: ${order.product_name}`,
          sender: order.customer_phone || 'Customer Order',
          body: `${order.product_name} · KES ${Number(order.product_price || 0).toLocaleString('en-KE')}${order.color ? ` · ${order.color}` : ''}${order.size ? ` · ${order.size}` : ''}`,
          platform: 'storefront',
          threadKey: `order:${order.order_key || order.id}`,
          storeId: id,
          isOrder: true,
          orderKey: order.order_key,
        });
        setSocialUnread((current) => current + 1);
        setInboxKey((k) => k + 1);
        void load();
      })
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [data?.store?.id, load]);

  // Service Worker message listener
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      const msg = event.data as {
        type?: string;
        storeId?: number;
        title?: string;
        body?: string;
        sender_name?: string;
        platform?: string;
        avatar?: string;
        threadKey?: string;
        isOrder?: boolean;
      } | null;
      if (msg?.type !== 'stoyangu-inbox-update') return;
      if (msg.storeId && data?.store?.id && msg.storeId !== data.store.id) return;

      if (msg.body) {
        triggerNotificationAlert({
          sender: msg.sender_name || msg.title || 'Customer',
          body: msg.body,
          platform: msg.platform,
          avatar: msg.avatar,
          threadKey: msg.threadKey,
          storeId: data?.store?.id,
          isOrder: msg.isOrder,
        });
      }
      setInboxKey((k) => k + 1);
      if (data?.store?.id) void refreshSocialUnread(data.store.id);
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onSwMessage);
  }, [data?.store?.id, refreshSocialUnread]);

  // Record installation only when this browser confirms an actual PWA install.
  // Notification permission is requested separately from the owner's button.
  useEffect(() => {
    const installed = () => {
      localStorage.setItem('stoyangu-installed', '1');
      setInstalledLocally(true);
      if (profile?.role === 'owner') markAppInstalled();
    };
    if (profile?.role === 'owner' && isStandaloneApp()) {
      localStorage.setItem('stoyangu-installed', '1');
      markAppInstalled();
    }
    window.addEventListener('appinstalled', installed);
    return () => window.removeEventListener('appinstalled', installed);
  }, [profile?.role]);

  // The installed (standalone) app keeps the branded splash up until the
  // dashboard data lands, with a short minimum display so the store logo is
  // seen, not just a flash.
  const standalone = isStandaloneApp();
  useEffect(() => {
    if (!standalone || splashDone || loading) return;
    const minDelay = Math.max(0, 800 - (Date.now() - splashStartRef.current));
    const t1 = window.setTimeout(() => setSplashFading(true), minDelay);
    const t2 = window.setTimeout(() => setSplashDone(true), minDelay + 500);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [standalone, splashDone, loading]);

  const remove = async (product: Product) => { if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return; try { await apiFetch('/api/products', { method: 'DELETE', body: JSON.stringify({ id: product.id }) }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete product.'); } };

  // Prompt the browser's real StoYangu installation dialog with this store's
  // logo icon. Where no native prompt is exposed, open the short guide.
  const installApp = async () => {
    if (isStandaloneApp()) {
      setInstalledLocally(true);
      localStorage.setItem('stoyangu-installed', '1');
      if (profile?.role === 'owner') markAppInstalled();
      return;
    }
    const prompt = window.__STOYANGU_NATIVE_INSTALL_PROMPT;
    if (prompt) {
      try {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice?.outcome === 'accepted') { localStorage.setItem('stoyangu-installed', '1'); setInstalledLocally(true); void markAppInstalled(); }
        else setInstallOpen(true);
        window.__STOYANGU_NATIVE_INSTALL_PROMPT = null;
        return;
      } catch {
        window.__STOYANGU_NATIVE_INSTALL_PROMPT = null;
      }
    }
    setInstallOpen(true);
  };

  // --- Instagram-Grade Smooth Swipe Gesture Handling ---
  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 1 || isChatOpen || settingsOpen || editing || passwordOpen || installOpen || composerOpen) {
      touchStartRef.current = null;
      return;
    }
    const touch = event.touches[0];
    const target = event.target;
    const interactiveTarget = target instanceof Element && target.closest(
      'input, textarea, select, a, button:not(.social-thread), [contenteditable="true"], [role="dialog"], .social-thread-detail, .social-reply, .comment-source-card, .product-actions'
    );
    if (interactiveTarget) {
      touchStartRef.current = null;
      return;
    }
    unlockAudio();
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
      intent: null,
    };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    if (!start || event.touches.length !== 1) return;

    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;

    if (start.intent === null) {
      if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > 7) {
        start.intent = 'vertical';
        return;
      }
      if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 7) {
        start.intent = 'horizontal';
      }
    }

    if (start.intent !== 'horizontal') return;

    const pagerWidth = pagerContainerRef.current?.clientWidth || window.innerWidth;
    const baseTranslate = activeTab === 'products' ? 0 : -pagerWidth;

    let effectiveDeltaX = deltaX;
    if (activeTab === 'products' && deltaX > 0) {
      effectiveDeltaX = deltaX * 0.28;
    } else if (activeTab === 'customers' && deltaX < 0) {
      effectiveDeltaX = deltaX * 0.28;
    }

    const currentTranslate = baseTranslate + effectiveDeltaX;
    setIsDragging(true);
    setDragTranslateX(currentTranslate);
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    touchStartRef.current = null;

    if (!start || start.intent !== 'horizontal') {
      setIsDragging(false);
      setDragTranslateX(null);
      return;
    }

    const touch = event.changedTouches[0];
    const deltaX = touch ? touch.clientX - start.x : 0;
    const timeElapsed = Math.max(1, Date.now() - start.time);
    const velocity = deltaX / timeElapsed;
    const pagerWidth = pagerContainerRef.current?.clientWidth || window.innerWidth;
    const threshold = pagerWidth * 0.22;

    setIsDragging(false);
    setDragTranslateX(null);

    if (activeTab === 'products') {
      if (deltaX < -threshold || velocity < -0.28) {
        showCustomers();
      }
    } else if (activeTab === 'customers') {
      if (deltaX > threshold || velocity > 0.28) {
        setActiveTab('products');
      }
    }
  };

  const handleTouchCancel = () => {
    touchStartRef.current = null;
    setIsDragging(false);
    setDragTranslateX(null);
  };

  const splashStoreLogo = data?.store?.logo_url || splashInfo?.logo_url || '';
  const splashEl = standalone && !splashDone && splashStoreLogo ? (
    <div className={`store-splash${splashFading ? ' fading' : ''}`} role="status" aria-label="Opening your store workspace">
      <div className="store-splash-logo-wrap">
        <img className="store-splash-logo" src={splashStoreLogo} alt="" />
      </div>
    </div>
  ) : null;
  const storeLoadingLogo = splashStoreLogo ? <img className="store-splash-logo" src={splashStoreLogo} alt="" /> : null;
  if (loading) return <>{splashEl}<div className="owner-loading" role="status">{storeLoadingLogo}<RefreshCw className="spin" /><p>Getting your store ready…</p></div></>;
  if (!data?.store) return <>{splashEl}<div className="owner-loading" role="status">{storeLoadingLogo}<div className="dashboard-error">{error || 'This store could not be loaded.'}<button onClick={load}><RefreshCw /> Try again</button></div></div></>;
  const store = data.store;

  const handleStorefrontClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    const prompt = window.__STOYANGU_NATIVE_INSTALL_PROMPT;
    if (profile?.role !== 'owner' || !prompt || installedLocally || isStandaloneApp()) return;
    event.preventDefault();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        localStorage.setItem('stoyangu-installed', '1');
        setInstalledLocally(true);
        markAppInstalled();
      }
      window.__STOYANGU_NATIVE_INSTALL_PROMPT = null;
    } catch (reason) { console.warn('Chrome controls when the native installation dialog is available:', reason); }
    window.location.assign(storeLink(store.slug));
  };

  const latestUpdate = data.notifications?.[0];
  const upkeep = store as typeof store & StoreUpkeep;
  const locked = profile?.role === 'owner' && Boolean(upkeep.management_locked);
  const upkeepOrders = Number(upkeep.orders_this_period ?? upkeep.orders_this_month ?? 0);
  const cycleEnd = upkeep.upkeep_period_ends_at ? new Date(upkeep.upkeep_period_ends_at) : null;
  const cycleDay = Math.min(14, Math.max(1, Number(upkeep.upkeep_period_day || 1)));
  const periodCustomers = Number(data.customersThisPeriod ?? data.customers ?? 0);
  const customersToday = Number(data.customersToday ?? 0);
  const periodVisitors = Number(store.visitors_this_period ?? store.visitor_total ?? 0);
  const lifetimeProductViews = (data.products || []).reduce((sum, product) => sum + Number(product.views_total || 0), 0);

  // Compute track transform
  const trackStyle = isDragging && dragTranslateX !== null ? {
    transform: `translate3d(${dragTranslateX}px, 0, 0)`,
    transition: 'none',
  } : {
    transform: activeTab === 'products' ? 'translate3d(0%, 0, 0)' : 'translate3d(-50%, 0, 0)',
    transition: 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
  };

  return <>
    {splashEl}
    <NotificationToastBanner
      alert={activeToast}
      onOpen={handleToastOpen}
      onDismiss={dismissToast}
    />
    <div className="owner-page">
      <header className="owner-header owner-header-split owner-sticky-header">
        <div className="owner-header-identity">
          <div className="owner-logo-column">
            {store.logo_url
              ? <img className="owner-store-logo" src={store.logo_url} alt={`${store.name} logo`} />
              : <span className="owner-store-logo-fallback"><BrandLogo compact /></span>}
          </div>
          <div className="owner-header-copy">
            <div className="owner-name-row">
              <h1>{store.name}</h1>
              {profile?.role === 'founder' && <button type="button" className="founder-back-button" onClick={() => window.location.assign('/founder')}><ArrowLeft /> Founder</button>}
            </div>
            <a className="owner-store-link" href={storeLink(store.slug)} target="_blank" rel="noreferrer" onClick={handleStorefrontClick}>
              {storeDomain(store.slug)}<span className="owner-open-storefront-btn"><ExternalLink /></span>
            </a>
            <div className="owner-analytics-row" aria-label={`Analytics for the current 14-day period, day ${cycleDay} of 14`}>
              <div className="tiktok-stats-row">
                <div className="tiktok-stat"><div className="tiktok-stat-value"><strong>{periodCustomers.toLocaleString()}</strong><small className="stat-change">(+{customersToday})</small></div><span>customers</span></div>
                <div className="tiktok-stat"><div className="tiktok-stat-value"><strong>{periodVisitors.toLocaleString()}</strong><small className="stat-change">(+{store.visitor_today || 0})</small></div><span>visitors</span></div>
                <div className="tiktok-stat"><div className="tiktok-stat-value"><strong>{upkeepOrders.toLocaleString()}</strong><small className="stat-change">(+{store.orders_today || 0})</small></div><span>orders</span></div>
              </div>
              <span className="period-counter" aria-label={`Day ${cycleDay} of 14 days`}><small>DAY</small><strong>{cycleDay}<i>/14</i></strong></span>
            </div>
          </div>
          <button type="button" className="owner-settings-button" onClick={openSettings} aria-label="Open settings" title="Settings"><Settings /></button>
        </div>
      </header>

      <main className="owner-main">
        {offlineCacheUsed && <div className="owner-offline-banner" role="status"><WifiOff /> Showing your saved store data. New messages and orders sync when your connection returns.</div>}
        {error && <div className="dashboard-error owner-main-notice">{error}</div>}

        <div
          className="owner-swipe-pager"
          ref={pagerContainerRef}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchCancel}
        >
          <div className="owner-swipe-track" style={trackStyle}>
            {/* Page 0: My Products */}
            <div className="owner-swipe-page owner-swipe-page-products" aria-hidden={activeTab !== 'products' && !isDragging}>
              {cycleDay >= 12 && !locked && <section className="recent-alert daily-update-card owner-main-notice"><BellRing /><div className="daily-update-content"><span className="eyebrow">Renewal time</span><h3>{upkeep.upkeep_plan === 'TRIAL' ? 'Your free 14 days are ending' : 'Your 14 days are ending'}</h3><p>To keep {store.name} live for the next 14 days, pay KES 200{cycleEnd ? ` before ${cycleEnd.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. Message StoYangu on WhatsApp 0793 533 683 to pay and continue — it takes one minute.</p></div></section>}
              {locked && <section className="recent-alert daily-update-card owner-main-notice"><BellRing /><div className="daily-update-content"><span className="eyebrow">Payment needed</span><h3>Your free 14 days have ended</h3><p>Good news: {store.name} is still visible to customers and orders can still reach you. Adding, editing and deleting products is locked until you pay KES 200 for the next 14 days. Message StoYangu on WhatsApp 0793 533 683 to pay — your tools unlock immediately.</p></div></section>}
              {latestUpdate && latestUpdate.batch_key?.startsWith('custom-') && <section className="recent-alert daily-update-card owner-main-notice"><BellRing /><div className="daily-update-content"><span className="eyebrow">Message from StoYangu</span><h3>{latestUpdate.title}</h3><p className="custom-message-body">{latestUpdate.body}</p></div></section>}
              <section className="products-panel">
                <div className="dash-section-head">
                  <h2>My Products</h2>
                  <span className="order-status-count">{(data.products || []).length}</span>
                </div>
                <div className="owner-product-list">
                  {data.products?.map((product) => (
                    <article key={product.id} className="owner-product-card">
                      <div className="product-media-group">
                        <img className="product-cover" loading="lazy" src={product.image_url || product.images?.[0] || '/stoyangu-logo.png'} alt={product.name} />
                      </div>
                      <div className="owner-product-name">
                        <h3>{product.name}</h3>
                        <strong>{formatMoney(product.price)}</strong>
                      </div>
                      <div className="word-stats" aria-label={`${product.name} current cycle analytics`}>
                        <p>views: <b>{Number(product.views_this_period ?? product.views_total ?? 0).toLocaleString()}</b> <small>this cycle</small></p>
                        <p>orders: <b>{Number(product.orders_this_period ?? product.orders_total ?? 0).toLocaleString()}</b> <small>this cycle</small></p>
                      </div>
                      <div className="product-actions">
                        <button type="button" onClick={() => setEditing(product)} disabled={locked} aria-label={`Edit ${product.name}`}><Edit3 size={16} /> Edit</button>
                        <button type="button" className="danger" onClick={() => remove(product)} disabled={locked} aria-label={`Delete ${product.name}`}><Trash2 size={16} /> Delete</button>
                      </div>
                    </article>
                  ))}
                </div>
                {!data.products?.length && <div className="empty-products"><StoreIcon /><h3>Your shelf is empty</h3><p>Tap the + button below to create a post — you can add your first product while posting. A photo, name and price is enough.</p></div>}
              </section>
            </div>

            {/* Page 1: My Customers (Social & Order Inbox) */}
            <div className="owner-swipe-page owner-swipe-page-customers" aria-hidden={activeTab !== 'customers' && !isDragging}>
              <SocialInbox
                key={store.id}
                storeId={store.id}
                storeName={store.name}
                active={true}
                refreshSignal={inboxKey}
                onActivity={() => refreshSocialUnread(store.id)}
                onChatOpenChange={setIsChatOpen}
              />
            </div>
          </div>
        </div>
      </main>

      <nav className="manage-bottom-nav manage-bottom-nav-tiktok" aria-label="Manage store navigation">
        <div className="manage-bottom-nav-inner">
          <button className={`manage-nav-item ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')} aria-label="My Products"><Package /><span>My Products</span></button>
          <button className="manage-nav-post" onClick={openComposer} aria-label="Create a post"><Plus /></button>
          <button className={`manage-nav-item ${activeTab === 'customers' ? 'active' : ''}`} onClick={showCustomers} aria-label="My Customers"><Users /><span>My Customers</span>{socialUnread > 0 && <b className="manage-nav-badge">{socialUnread > 99 ? '99+' : socialUnread}</b>}</button>
        </div>
      </nav>

      {settingsOpen && <OwnerSettingsPage
        store={store}
        lifetimeProductViews={lifetimeProductViews}
        installedLocally={installedLocally}
        onClose={closeSettings}
        onChangePassword={() => setPasswordOpen(true)}
        onInstall={installApp}
        onSignOut={signOut}
        onPaymentComplete={load}
      />}
      {installOpen && <Modal title="Install StoYangu" onClose={() => setInstallOpen(false)}><div className="install-guide"><p>Install <strong>StoYangu</strong> on your phone so it opens directly from your home screen. The app name always stays StoYangu, while the opening animation uses your store logo.</p><p><strong>Android Chrome:</strong> tap the browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><p><strong>iPhone Safari:</strong> tap Share, then <strong>Add to Home Screen</strong>.</p><p>New versions load automatically after updates — no reinstall needed.</p></div></Modal>}
      {passwordOpen && <PasswordChangeModal onClose={() => setPasswordOpen(false)} />}
      {editing && <ProductModal product={editing === 'new' ? null : editing} storeId={store.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {composerOpen && <PostComposer storeId={store.id} storeName={store.name} storeSlug={store.slug} locked={locked} onClose={closeComposer} onPosted={() => { setInboxKey((key) => key + 1); refreshSocialUnread(store.id); }} onProductsChanged={load} />}
    </div>
  </>;
}

function OwnerSettingsPage({ store, lifetimeProductViews, installedLocally, onClose, onChangePassword, onInstall, onSignOut, onPaymentComplete }: {
  store: Store;
  lifetimeProductViews: number;
  installedLocally: boolean;
  onClose: () => void;
  onChangePassword: () => void;
  onInstall: () => void;
  onSignOut: () => Promise<void>;
  onPaymentComplete: () => Promise<void>;
}) {
  const [installMessage, setInstallMessage] = useState('');
  const install = () => {
    if (isStandaloneApp()) {
      setInstallMessage('StoYangu is already installed on this phone.');
      return;
    }
    setInstallMessage('');
    onInstall();
  };

  return <div className="owner-settings-page" role="dialog" aria-modal="true" aria-label={`${store.name} settings`}>
    <header className="settings-page-header">
      <button type="button" onClick={onClose} aria-label="Close settings"><ArrowLeft /></button>
      <div><span>{store.name}</span><h1>Settings</h1></div>
    </header>

    <main className="settings-page-main">
      <section className="settings-section settings-overview" aria-labelledby="settings-stats-title">
        <div className="settings-section-heading"><h2 id="settings-stats-title">Store performance</h2></div>
        <div className="settings-stats-grid">
          <div><strong>{Number(store.visitor_total || 0).toLocaleString()}</strong><span>Total visits</span></div>
          <div><strong>{Number(lifetimeProductViews || 0).toLocaleString()}</strong><span>Product views</span></div>
          <div><strong>{Number(store.actual_orders_total ?? store.orders_total ?? 0).toLocaleString()}</strong><span>Orders</span></div>
        </div>
      </section>

      <SocialAccountsSettings storeId={store.id} />

      <section className="settings-section" aria-labelledby="app-settings-title">
        <div className="settings-section-heading settings-heading-simple"><h2 id="app-settings-title">My App</h2></div>
        <button type="button" className="settings-action-row settings-action-simple" onClick={install}>
          <span className="settings-action-icon"><Download /></span><span><strong>Install app</strong></span><ExternalLink />
        </button>
        {installMessage && <small className="settings-inline-status" role="status">{installMessage}</small>}
        <NotificationPermissionButton installedLocally={installedLocally} />
      </section>

      <PaymentSection store={store} onPaid={onPaymentComplete} />

      <section className="settings-section" aria-labelledby="account-settings-title">
        <div className="settings-section-heading settings-heading-simple"><h2 id="account-settings-title">Account</h2></div>
        <button type="button" className="settings-action-row settings-action-simple" onClick={onChangePassword}>
          <span className="settings-action-icon"><KeyRound /></span><span><strong>Change my password</strong></span><ExternalLink />
        </button>
        <button type="button" className="settings-action-row settings-action-simple danger" onClick={() => void onSignOut()}>
          <span className="settings-action-icon"><LogOut /></span><span><strong>Sign out</strong></span>
        </button>
      </section>
    </main>
  </div>;
}

function NotificationPermissionButton({ installedLocally }: { installedLocally: boolean }) {
  const [status, setStatus] = useState<'checking' | 'ready' | 'enabled' | 'denied' | 'unsupported' | 'install-first' | 'error'>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const iphone = /iPad|iPhone|iPod/i.test(navigator.userAgent);
      const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
      if (!supported) {
        if (!cancelled) setStatus(iphone && !isStandaloneApp() ? 'install-first' : 'unsupported');
        return;
      }
      if (iphone && !isStandaloneApp()) {
        if (!cancelled) setStatus('install-first');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('denied');
        return;
      }
      try {
        const config = await apiFetch<{ registered?: boolean; pushConfigured?: boolean }>('/api/subscriptions');
        if (cancelled) return;
        if (!config.pushConfigured) setStatus('unsupported');
        else if (config.registered && Notification.permission === 'granted') setStatus('enabled');
        else setStatus('ready');
      } catch {
        if (!cancelled) setStatus('ready');
      }
    };
    void check();
    return () => { cancelled = true; };
  }, [installedLocally]);

  const allow = async () => {
    setBusy(true);
    setMessage('');
    try {
      const result = await enableStoreNotifications();
      if (result.status === 'granted') {
        setStatus('enabled');
        triggerNotificationAlert({
          title: 'Notifications & Pings Enabled',
          sender: 'StoYangu',
          body: 'You will receive audible pings whenever you receive a message or order!',
          force: true,
        });
        setMessage(result.testSent ? 'Test alert sent to this phone.' : 'Notifications and sound pings are enabled on this device.');
      } else if (result.status === 'denied') {
        setStatus('denied');
        setMessage(result.message || 'Allow notifications in your browser settings.');
      } else {
        setStatus('unsupported');
        setMessage(result.message || 'Push notifications are not available here yet.');
      }
    } catch (reason) {
      setStatus('error');
      setMessage(reason instanceof Error ? reason.message : 'Could not enable notifications. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const testPing = () => {
    triggerNotificationAlert({
      title: 'Notification Ping Test',
      sender: 'StoYangu Alerts',
      body: 'Ding! Notification pings and sounds are working perfectly.',
      force: true,
    });
    setMessage('Notification ping played.');
  };

  const unavailable = status === 'checking' || status === 'denied' || status === 'unsupported' || status === 'install-first';
  const label = status === 'enabled' ? 'Notifications allowed' : status === 'denied' ? 'Notifications blocked' : status === 'install-first' ? 'Install app for notifications' : status === 'unsupported' ? 'Notifications unavailable' : 'Allow notifications';
  return <div className="settings-notification-action">
    <button type="button" className={`settings-action-row settings-action-simple ${status === 'enabled' ? 'notification-enabled' : ''}`} onClick={allow} disabled={busy || unavailable || status === 'enabled'}>
      <span className={`settings-action-icon ${status === 'enabled' ? 'success' : ''}`}>{status === 'enabled' ? <Check /> : <BellRing />}</span><span><strong>{busy ? 'Enabling…' : label}</strong></span>
    </button>
    <button type="button" className="test-ping-button" onClick={testPing} title="Test notification chime sound and banner">
      <Volume2 /><span>Test notification ping</span>
    </button>
    {message && <small className="settings-inline-status" role="status">{message}</small>}
    {status === 'denied' && !message && <small className="settings-inline-status">Allow notifications in your browser's site settings.</small>}
    {status === 'install-first' && !message && <small className="settings-inline-status">On iPhone, install StoYangu from Safari's Share menu first.</small>}
    {status === 'unsupported' && !message && <small className="settings-inline-status">Push setup is not configured for this deployment yet.</small>}
  </div>;
}

function normalizeKenyanPhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) digits = `254${digits}`;
  return /^254[17]\d{8}$/.test(digits) ? `+${digits}` : '';
}

function PaymentSection({ store, onPaid }: { store: Store; onPaid: () => Promise<void> }) {
  const [phone, setPhone] = useState(store.phone || store.whatsapp || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState<{ configured: boolean; sandbox: boolean; paymentWindowOpen: boolean; nextPeriodPaid: boolean } | null>(null);
  const cycleEnd = store.upkeep_period_ends_at ? new Date(store.upkeep_period_ends_at) : null;
  const periodState = store.management_locked ? 'Payment due' : store.upkeep_plan === 'TRIAL' ? 'Free trial' : 'Active';
  const alreadyPrepaid = Boolean(cycleEnd && store.billing_paid_until && new Date(store.billing_paid_until).getTime() > cycleEnd.getTime());
  const nextPeriodAlreadyPaid = Boolean(paymentInfo?.nextPeriodPaid || alreadyPrepaid);
  const paymentWindowOpen = Boolean(paymentInfo?.paymentWindowOpen || store.management_locked || Number(store.upkeep_period_day || 0) >= 12);
  const canPayNow = Boolean(paymentInfo?.configured && (paymentInfo.sandbox || (paymentWindowOpen && !nextPeriodAlreadyPaid)));

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ configured: boolean; sandbox: boolean; paymentWindowOpen: boolean; nextPeriodPaid: boolean }>('/api/stores?daraja=payment-info')
      .then((info) => { if (!cancelled) setPaymentInfo(info); })
      .catch(() => { if (!cancelled) setPaymentInfo({ configured: false, sandbox: false, paymentWindowOpen: false, nextPeriodPaid: false }); });
    return () => { cancelled = true; };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const normalized = normalizeKenyanPhone(phone);
    if (!normalized) {
      setError('Enter a valid Kenyan M-Pesa number, such as 0712 345 678.');
      return;
    }
    if (!canPayNow) {
      setError(alreadyPrepaid ? 'Your next 14-day period is already paid.' : 'The payment prompt opens during the final three days of your period, or once payment is due.');
      return;
    }

    setPhone(normalized);
    setBusy(true);
    try {
      const request = await apiFetch<{ paymentId: number }>('/api/stores?daraja=stk', {
        method: 'POST',
        body: JSON.stringify({ phone: normalized }),
      });
      setMessage(paymentInfo?.sandbox
        ? `Sandbox prompt requested for ${normalized}. Use only Daraja's documented test flow; never enter a real M-Pesa PIN for a sandbox test. Waiting for the test result…`
        : `M-Pesa prompt sent to ${normalized}. Confirm the KES 200 amount and enter your PIN only if you want to pay. Waiting for confirmation…`);

      for (let attempt = 0; attempt < 45; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 4000));
        const status = await apiFetch<{ status: string; receipt_number?: string | null }>(`/api/stores?daraja=payment-status&paymentId=${encodeURIComponent(request.paymentId)}`);
        if (status.status === 'sandbox_paid') {
          setMessage(`Sandbox test succeeded${status.receipt_number ? ` · test receipt ${status.receipt_number}` : ''}. Your store billing was not changed.`);
          return;
        }
        if (status.status === 'paid') {
          setMessage(`Payment confirmed${status.receipt_number ? ` · receipt ${status.receipt_number}` : ''}. Your store billing has been updated.`);
          await onPaid().catch(() => undefined);
          return;
        }
        if (status.status === 'failed' || status.status === 'expired') {
          setError('The payment was not completed. If you cancelled the M-Pesa prompt, you can try again when this payment request has cleared.');
          return;
        }
        if (status.status === 'review') {
          setError('Safaricom sent a payment response that needs a quick check. Please contact StoYangu support before trying again.');
          return;
        }
      }
      setMessage(paymentInfo?.sandbox
        ? 'No final sandbox result yet. Use only Daraja’s documented test flow; never enter a real M-Pesa PIN for a sandbox test. Check back shortly.'
        : 'No final confirmation yet. If you entered your PIN, leave this page open for a little longer or check back shortly; a confirmed payment will unlock your store automatically.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not start the M-Pesa payment. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="settings-section payment-settings" aria-labelledby="payment-settings-title">
    <div className="settings-section-heading settings-heading-simple payment-heading">
      <h2 id="payment-settings-title">Payment</h2><span className="payment-plan-pill">KES 200 · 14 days</span>
    </div>
    <div className="payment-period-summary">
      <strong>KES 200</strong><span>Every 14 days</span><b className={store.management_locked ? 'due' : ''}>{periodState}</b>
      {cycleEnd && <small>{store.management_locked ? 'Access ended' : store.upkeep_plan === 'TRIAL' ? 'Free until' : 'Renews'} {cycleEnd.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</small>}
    </div>
    <form className="payment-phone-form" onSubmit={submit}>
      <label htmlFor="mpesa-phone">M-Pesa phone number</label>
      <input id="mpesa-phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="0712 345 678" />
      <button type="submit" className="button-primary" disabled={busy || !canPayNow}><BellRing /> {busy ? 'Waiting for M-Pesa…' : 'Pay KES 200 by M-Pesa'}</button>
    </form>
    {!paymentInfo && <small className="payment-preview-note">Checking the M-Pesa setup…</small>}
    {paymentInfo && !paymentInfo.configured && <small className="payment-preview-note">M-Pesa is not ready yet. StoYangu must finish setting up its business Till before payments can be requested.</small>}
    {paymentInfo?.configured && !paymentInfo.sandbox && !canPayNow && <small className="payment-preview-note">{nextPeriodAlreadyPaid ? 'Your next 14-day period is already paid. No payment is needed now.' : 'The M-Pesa prompt becomes available during the final three days of your period, or once payment is due.'}</small>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    {paymentInfo?.configured && <small className="payment-preview-note">{paymentInfo.sandbox ? 'Sandbox is for testing: use only Daraja’s documented test phone and test flow. Never enter a real M-Pesa PIN for a sandbox test. Successful sandbox callbacks do not change store billing.' : 'An M-Pesa prompt will be sent to the number above. Confirm the KES 200 amount and enter your PIN only if you want to pay. A successful payment is recorded automatically.'}</small>}
  </section>;
}

function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(''); if (password.length < 8) return setMessage('Your new password must be at least 8 characters.'); if (password !== confirm) return setMessage('The two passwords do not match.'); setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false); if (error) return setMessage(error.message); setMessage('Password changed successfully.'); window.setTimeout(onClose, 900); };
  return <Modal title="Change account password" onClose={onClose}><form className="form-stack" onSubmit={submit}><p className="form-intro">Choose a strong password you will remember.</p><label>New password<div className="password-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff /> : <Eye />}</button></div></label><label>Confirm new password<input type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{message && <div className={message.includes('successfully') ? 'form-success' : 'form-error'}>{message}</div>}<button className="button-primary full" disabled={busy}>{busy ? 'Changing password…' : 'Change password'} <KeyRound /></button></form></Modal>;
}
