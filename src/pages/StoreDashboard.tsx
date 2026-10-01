import { ArrowLeft, BellRing, Check, Download, Edit3, ExternalLink, Eye, EyeOff, KeyRound, LogOut, Package, Plus, RefreshCw, Settings, Store as StoreIcon, Trash2, Users } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import PostComposer from '../components/PostComposer';
import ProductModal from '../components/ProductModal';
import SocialAccountsSettings from '../components/SocialAccountsSettings';
import SocialInbox from '../components/SocialInbox';
import { useAuth } from '../contexts/useAuth';
import { apiFetch, formatMoney, storeDomain, storeLink } from '../lib/api';
import { pushBackHandler } from '../lib/backNavigation';
import { applyStoreManifest, readSplashCache, saveSplashCache, splashCacheKey } from '../lib/pwa';
import supabase from '../lib/supabase';
import type { DashboardData, Product, Store } from '../types';
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
  useEffect(() => { splashStartRef.current = Date.now(); }, []);

  // Push back handler for store owner navigation (Task 2)
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
    applyStoreManifest(`slug=${encodeURIComponent(storeData.slug)}`);
    saveSplashCache(splashCacheKey(storeId), { id: storeData.id, name: storeData.name, slug: storeData.slug, logo_url: storeData.logo_url });
  }, [data?.store, storeId]);
  useEffect(() => { document.title = 'StoYangu'; }, []);
  useEffect(() => { sessionStorage.setItem(`stoyangu-tab-${storeId || 'owner'}`, activeTab); }, [activeTab, storeId]);
  const openSettings = () => { sessionStorage.setItem(`stoyangu-settings-${storeId || 'owner'}`, '1'); setSettingsOpen(true); };
  const closeSettings = () => { sessionStorage.removeItem(`stoyangu-settings-${storeId || 'owner'}`); setSettingsOpen(false); };
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
      window.history.replaceState({}, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
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
    const id = data?.store?.id;
    if (!id) return;
    const timer = window.setTimeout(() => { void refreshSocialUnread(id); }, 0);
    return () => window.clearTimeout(timer);
  }, [data?.store?.id, refreshSocialUnread]);
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
  const splashStoreLogo = data?.store?.logo_url || splashInfo?.logo_url || '';
  const splashEl = standalone && !splashDone && splashStoreLogo ? (
    <div className={`store-splash${splashFading ? ' fading' : ''}`} role="status" aria-label="Opening your store workspace">
      <div className="store-splash-logo-wrap">
        <img className="store-splash-logo" src={splashStoreLogo} alt="" />
        <span className="store-splash-ring" aria-hidden="true" />
      </div>
    </div>
  ) : null;
  if (loading) return <>{splashEl}<div className="owner-loading" role="status"><RefreshCw className="spin" /><p>Getting your store ready…</p></div></>;
  if (!data?.store) return <>{splashEl}<div className="owner-loading" role="status"><BrandLogo /><div className="dashboard-error">{error || 'This store could not be loaded.'}<button onClick={load}><RefreshCw /> Try again</button></div></div></>;
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
  // KES 200 model: past the free first 14 days, management stays locked until
  // the current period is paid. The storefront itself keeps serving customers.
  const locked = profile?.role === 'owner' && Boolean(upkeep.management_locked);
  const upkeepOrders = Number(upkeep.orders_this_period ?? upkeep.orders_this_month ?? 0);
  const cycleEnd = upkeep.upkeep_period_ends_at ? new Date(upkeep.upkeep_period_ends_at) : null;
  const cycleDay = Math.min(14, Math.max(1, Number(upkeep.upkeep_period_day || 1)));
  const periodCustomers = Number(data.customersThisPeriod ?? data.customers ?? 0);
  const periodVisitors = Number(store.visitors_this_period ?? store.visitor_total ?? 0);
  const lifetimeProductViews = (data.products || []).reduce((sum, product) => sum + Number(product.views_total || 0), 0);

  return <>
    {splashEl}
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
            <div className="owner-analytics-label">14-day analytics</div>
            <div className="owner-analytics-row" aria-label={`Analytics for the current 14-day period, day ${cycleDay} of 14`}>
              <div className="tiktok-stats-row">
                <div className="tiktok-stat"><strong>{periodCustomers.toLocaleString()}</strong><span>customers</span><small className="stat-today">+{data.customersToday || 0} today</small></div>
                <div className="tiktok-stat"><strong>{periodVisitors.toLocaleString()}</strong><span>visitors</span><small className="stat-today">+{store.visitor_today || 0} today</small></div>
                <div className="tiktok-stat"><strong>{upkeepOrders.toLocaleString()}</strong><span>orders</span><small className="stat-today">+{store.orders_today || 0} today</small></div>
              </div>
              <span className="period-counter" aria-label={`Day ${cycleDay} of 14 days`}><small>DAY</small><strong>{cycleDay}<i>/14</i></strong></span>
            </div>
          </div>
          <button type="button" className="owner-settings-button" onClick={openSettings} aria-label="Open settings" title="Settings"><Settings /></button>
        </div>
      </header>

      <main className="owner-main">
        {error && <div className="dashboard-error owner-main-notice">{error}</div>}
        {activeTab === 'customers'
          ? <SocialInbox key={inboxKey} storeId={store.id} storeName={store.name} onActivity={() => refreshSocialUnread(store.id)} />
          : <>
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
                    <div className="word-stats" aria-label={`${product.name} current period analytics`}>
                      <p>views: <b>{Number(product.views_this_period ?? product.views_total ?? 0).toLocaleString()}</b> <small>this period</small></p>
                      <p>orders: <b>{Number(product.orders_this_period ?? product.orders_total ?? 0).toLocaleString()}</b> <small>this period</small></p>
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
          </>}
      </main>

      <nav className="manage-bottom-nav manage-bottom-nav-tiktok" aria-label="Manage store navigation">
        <div className="manage-bottom-nav-inner">
          <button className={`manage-nav-item ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')} aria-label="My Products"><Package /><span>My Products</span></button>
          <button className="manage-nav-post" onClick={openComposer} aria-label="Create a post"><Plus /></button>
          <button className={`manage-nav-item ${activeTab === 'customers' ? 'active' : ''}`} onClick={() => setActiveTab('customers')} aria-label="My Customers"><Users /><span>My Customers</span>{socialUnread > 0 && <b className="manage-nav-badge">{socialUnread > 99 ? '99+' : socialUnread}</b>}</button>
        </div>
      </nav>

      {settingsOpen && <OwnerSettingsPage
        store={store}
        data={data}
        lifetimeProductViews={lifetimeProductViews}
        installedLocally={installedLocally}
        onClose={closeSettings}
        onChangePassword={() => setPasswordOpen(true)}
        onInstall={installApp}
        onSignOut={signOut}
      />}
      {installOpen && <Modal title="Install StoYangu" onClose={() => setInstallOpen(false)}><div className="install-guide"><p>Install <strong>StoYangu</strong> on your phone so it opens directly from your home screen. The app name always stays StoYangu, while the opening animation uses your store logo.</p><p><strong>Android Chrome:</strong> tap the browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><p><strong>iPhone Safari:</strong> tap Share, then <strong>Add to Home Screen</strong>.</p><p>New versions load automatically after updates — no reinstall needed.</p></div></Modal>}
      {passwordOpen && <PasswordChangeModal onClose={() => setPasswordOpen(false)} />}
      {editing && <ProductModal product={editing === 'new' ? null : editing} storeId={store.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}
      {composerOpen && <PostComposer storeId={store.id} storeName={store.name} storeSlug={store.slug} locked={locked} onClose={closeComposer} onPosted={() => { setInboxKey((key) => key + 1); refreshSocialUnread(store.id); }} onProductsChanged={load} />}
    </div>
  </>;

}

function OwnerSettingsPage({ store, data, lifetimeProductViews, installedLocally, onClose, onChangePassword, onInstall, onSignOut }: {
  store: Store;
  data: DashboardData;
  lifetimeProductViews: number;
  installedLocally: boolean;
  onClose: () => void;
  onChangePassword: () => void;
  onInstall: () => void;
  onSignOut: () => Promise<void>;
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

  return <div className="owner-settings-page" role="dialog" aria-modal="true" aria-labelledby="owner-settings-title">
    <header className="settings-page-header">
      <button type="button" onClick={onClose} aria-label="Back to store"><ArrowLeft /></button>
      <div><span>StoYangu</span><h1 id="owner-settings-title">Settings</h1></div>
    </header>
    <main className="settings-page-main">
      <section className="settings-section lifetime-analytics" aria-labelledby="lifetime-title">
        <div className="settings-section-heading settings-heading-simple"><h2 id="lifetime-title">Lifetime Store Performance</h2></div>
        <div className="lifetime-grid">
          <div><strong>{Number(data.customers || 0).toLocaleString()}</strong><span>Customers</span></div>
          <div><strong>{Number(store.visitor_total || 0).toLocaleString()}</strong><span>Store visits</span></div>
          <div><strong>{Number(store.actual_orders_total ?? store.orders_total ?? 0).toLocaleString()}</strong><span>Orders</span></div>
          <div><strong>{lifetimeProductViews.toLocaleString()}</strong><span>Product views</span></div>
        </div>
      </section>

      <SocialAccountsSettings storeId={store.id} />

      <section className="settings-section app-settings-section" aria-labelledby="app-settings-title">
        <div className="settings-section-heading settings-heading-simple"><h2 id="app-settings-title">My App</h2></div>
        <button type="button" className="settings-action-row settings-action-simple" onClick={install}>
          <span className="settings-action-icon"><Download /></span><span><strong>Install app</strong></span><ExternalLink />
        </button>
        {installMessage && <small className="settings-inline-status" role="status">{installMessage}</small>}
        <NotificationPermissionButton installedLocally={installedLocally} />
      </section>

      <PaymentSection store={store} />

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
        setMessage(result.testSent ? 'Test alert sent to this phone.' : result.message || 'Permission saved, but the test alert could not be delivered yet.');
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

  const unavailable = status === 'checking' || status === 'denied' || status === 'unsupported' || status === 'install-first';
  const label = status === 'enabled' ? 'Notifications allowed' : status === 'denied' ? 'Notifications blocked' : status === 'install-first' ? 'Install app for notifications' : status === 'unsupported' ? 'Notifications unavailable' : 'Allow notifications';
  return <div className="settings-notification-action">
    <button type="button" className={`settings-action-row settings-action-simple ${status === 'enabled' ? 'notification-enabled' : ''}`} onClick={allow} disabled={busy || unavailable || status === 'enabled'}>
      <span className={`settings-action-icon ${status === 'enabled' ? 'success' : ''}`}>{status === 'enabled' ? <Check /> : <BellRing />}</span><span><strong>{busy ? 'Enabling…' : label}</strong></span>
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

function PaymentSection({ store }: { store: Store }) {
  const [phone, setPhone] = useState(store.phone || store.whatsapp || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const cycleEnd = store.upkeep_period_ends_at ? new Date(store.upkeep_period_ends_at) : null;
  const periodState = store.management_locked ? 'Payment due' : store.upkeep_plan === 'TRIAL' ? 'Free trial' : 'Active';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setMessage('');
    setError('');
    const normalized = normalizeKenyanPhone(phone);
    if (!normalized) {
      setError('Enter a valid Kenyan M-Pesa number, such as 0712 345 678.');
      return;
    }
    setPhone(normalized);
    setMessage(`M-Pesa prompt preview prepared for ${normalized}. Daraja is not connected yet, so no payment has been requested or charged.`);
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
      <button type="submit" className="button-primary"><BellRing /> Preview KES 200 M-Pesa prompt</button>
    </form>
    {error && <div className="form-error" role="alert">{error}</div>}
    {message && <div className="form-success" role="status">{message}</div>}
    <small className="payment-preview-note">Preview only: Safaricom Daraja is not connected, so this will not charge your phone. To pay now, contact StoYangu on WhatsApp 0793 533 683.</small>
  </section>;
}

function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(''); if (password.length < 8) return setMessage('Your new password must be at least 8 characters.'); if (password !== confirm) return setMessage('The two passwords do not match.'); setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false); if (error) return setMessage(error.message); setMessage('Password changed successfully.'); window.setTimeout(onClose, 900); };
  return <Modal title="Change account password" onClose={onClose}><form className="form-stack" onSubmit={submit}><p className="form-intro">Choose a strong password you will remember.</p><label>New password<div className="password-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff /> : <Eye />}</button></div></label><label>Confirm new password<input type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{message && <div className={message.includes('successfully') ? 'form-success' : 'form-error'}>{message}</div>}<button className="button-primary full" disabled={busy}>{busy ? 'Changing password…' : 'Change password'} <KeyRound /></button></form></Modal>;
}

