import { ArrowLeft, BellRing, Check, Download, Edit3, ExternalLink, Eye, EyeOff, KeyRound, LogOut, MessageCircle, Package, Phone, Plus, RefreshCw, Store as StoreIcon, Trash2, Users, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import PostComposer from '../components/PostComposer';
import ProductDetailsModal from '../components/ProductDetailsModal';
import ProductModal from '../components/ProductModal';
import SocialInbox from '../components/SocialInbox';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, formatMoney, storeDomain, storeLink } from '../lib/api';
import { pushBackHandler } from '../lib/backNavigation';
import supabase from '../lib/supabase';
import type { DashboardData, Order, Product } from '../types';
import '../pricing-update.css';
import '../order-update.css';
import '../manage-redesign.css';
import '../woyoyo-013.css';

type StoreUpkeep = { orders_this_month?: number; orders_this_period?: number; upkeep_plan?: 'TRIAL' | 'PAID'; upkeep_due?: 0 | 300; upkeep_paid?: boolean; management_locked?: boolean; upkeep_period_starts_at?: string; upkeep_period_ends_at?: string };
type StoreApk = { status: 'not_started' | 'building' | 'ready' | 'failed'; apk_url?: string | null; error?: string | null; version_code?: number };

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

async function enableStoreNotifications(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  const config = await apiFetch<{ publicKey: string }>('/api/subscriptions');
  if (!config.publicKey) return 'unsupported';
  const registration = await navigator.serviceWorker.ready;
  const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await apiFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify({ subscription, installed: true, user_agent: navigator.userAgent }) });
  return 'granted';
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
  const [apk, setApk] = useState<StoreApk>({ status: 'not_started' });
  const [apkBusy, setApkBusy] = useState(false);
  // WOYOYO-013: My Products and My Customers are the two destinations of the
  // fixed bottom nav; the + button opens the camera-first post flow.
  const [activeTab, setActiveTab] = useState<'products' | 'customers'>(() => {
    try { const params = new URLSearchParams(window.location.search); return params.get('inbox') === '1' || params.has('oauth_state') ? 'customers' : sessionStorage.getItem(`stoyangu-tab-${storeId || 'owner'}`) === 'customers' ? 'customers' : 'products'; }
    catch { return 'products'; }
  });
  const [composerOpen, setComposerOpen] = useState(() => sessionStorage.getItem(`stoyangu-composer-${storeId || 'owner'}`) === '1');
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [socialUnread, setSocialUnread] = useState(0);
  const [inboxKey, setInboxKey] = useState(0);
  const previousOrderCount = useRef<number | null>(null);

  // Push back handler for store owner navigation (Task 2)
  useEffect(() => {
    return pushBackHandler(() => {
      if (viewingProduct) {
        setViewingProduct(null);
        return true;
      }
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
      if (activeTab === 'customers') {
        setActiveTab('products');
        return true;
      }
      return false;
    });
  }, [viewingProduct, editing, passwordOpen, installOpen, activeTab]);

  // App-installed flag kept for any PWA-aware logic elsewhere.
  const appInstalled = isStandaloneApp() || localStorage.getItem('stoyangu-installed') === '1';
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
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = data?.store?.id;
    if (!id) return;
    let alive = true;
    const refresh = () => apiFetch<StoreApk>(`/api/store-apk?storeId=${id}`).then(result => { if (alive) setApk(result); }).catch(() => undefined);
    void refresh();
    const timer = window.setInterval(refresh, 12000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [data?.store?.id]);
  const buildStoreApk = async () => {
    const id = data?.store?.id;
    if (!id || apkBusy) return;
    setApkBusy(true); setError('');
    try { setApk(await apiFetch<StoreApk>('/api/store-apk', { method: 'POST', body: JSON.stringify({ store_id: id }) })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to start the Android build.'); }
    finally { setApkBusy(false); }
  };
  useEffect(() => { sessionStorage.setItem(`stoyangu-tab-${storeId || 'owner'}`, activeTab); }, [activeTab, storeId]);
  const openComposer = () => { sessionStorage.setItem(`stoyangu-composer-${storeId || 'owner'}`, '1'); setComposerOpen(true); };
  const closeComposer = () => { sessionStorage.removeItem(`stoyangu-composer-${storeId || 'owner'}`); setComposerOpen(false); };
  // Proactively request notification permissions on mount (Task 5)
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().then(async (perm) => {
        if (perm === 'granted') {
          await enableStoreNotifications();
        }
      }).catch(() => undefined);
    } else if (Notification.permission === 'granted') {
      enableStoreNotifications().catch(() => undefined);
    }
  }, []);

  // Update dynamic app icon / favicon with store logo (Task 6)
  useEffect(() => {
    const logo = data?.store?.logo_url;
    if (!logo || typeof document === 'undefined') return;
    try {
      const linkIcon = (document.querySelector("link[rel*='icon']") || document.createElement('link')) as HTMLLinkElement;
      linkIcon.type = 'image/png';
      linkIcon.rel = 'shortcut icon';
      linkIcon.href = logo;
      document.getElementsByTagName('head')[0]?.appendChild(linkIcon);

      const linkApple = (document.querySelector("link[rel='apple-touch-icon']") || document.createElement('link')) as HTMLLinkElement;
      linkApple.rel = 'apple-touch-icon';
      linkApple.href = logo;
      document.getElementsByTagName('head')[0]?.appendChild(linkApple);
    } catch { /* ignore */ }
  }, [data?.store?.logo_url]);

  // Track orders to notify user in real time when new orders arrive (Task 5)
  useEffect(() => {
    const count = data?.orders?.length;
    if (count === undefined) return;
    if (previousOrderCount.current !== null && count > previousOrderCount.current) {
      const newOrder = data?.orders?.[0];
      if (newOrder && typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`New Store Order: ${newOrder.product_name}`, {
          body: `KES ${newOrder.product_price} · Customer: ${newOrder.customer_phone}`,
          icon: data?.store?.logo_url || '/favicon-192.png',
          tag: `order-${newOrder.id}`,
        });
        if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
      }
    }
    previousOrderCount.current = count;
  }, [data?.orders, data?.store?.logo_url]);
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
    if (id) refreshSocialUnread(id);
  }, [data?.store?.id, refreshSocialUnread]);
  useEffect(() => {
    const id = data?.store?.id;
    if (!id || activeTab !== 'products') return;
    const sync = async () => {
      if (document.hidden) return;
      await apiFetch('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: 'sync_inbox', store_id: id }) }).catch(() => undefined);
      await refreshSocialUnread(id);
    };
    const timer = window.setInterval(sync, 30000);
    return () => window.clearInterval(timer);
  }, [data?.store?.id, activeTab, refreshSocialUnread]);
  useEffect(() => {
    if (profile?.role !== 'owner') return;
    if (isStandaloneApp()) {
      localStorage.setItem('stoyangu-installed', '1');
      markAppInstalled();
    }
    // Vfixed: also trust the platform's installation record. Even on a brand-new
    // browser session with an empty localStorage, a store whose app is already
    // installed will not be asked to install again after a refresh.
    apiFetch<{ installation?: { installed?: boolean } | null }>('/api/subscriptions')
      .then((config) => {
        if (config.installation?.installed) {
          localStorage.setItem('stoyangu-installed', '1');
        }
      })
      .catch(() => undefined);
    const installed = () => {
      localStorage.setItem('stoyangu-installed', '1');
      markAppInstalled();
      enableStoreNotifications().catch((reason) => console.warn('Notification setup will continue from the dashboard reminder:', reason));
    };
    window.addEventListener('appinstalled', installed);
    return () => window.removeEventListener('appinstalled', installed);
  }, [profile?.role]);
  const remove = async (product: Product) => { if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return; try { await apiFetch('/api/products', { method: 'DELETE', body: JSON.stringify({ id: product.id }) }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete product.'); } };
  const updateOrderStatus = async (order: Order, status: Order['status']) => { const previous = order.status; setData((current) => current ? { ...current, orders: (current.orders || []).map((item) => item.id === order.id ? { ...item, status } : item) } : current); try { await apiFetch('/api/orders', { method: 'PUT', body: JSON.stringify({ id: order.id, status }) }); await load(); } catch (reason) { setData((current) => current ? { ...current, orders: (current.orders || []).map((item) => item.id === order.id ? { ...item, status: previous } : item) } : current); setError(reason instanceof Error ? reason.message : 'Could not update that order.'); } };
  const removeOrder = async (order: Order) => {
    if (!window.confirm(`Delete this order for ${order.product_name} (${order.customer_phone})? This cannot be undone.`)) return;
    const previous = data?.orders || [];
    setData((current) => current ? { ...current, orders: (current.orders || []).filter((item) => item.id !== order.id) } : current);
    try {
      await apiFetch('/api/orders', { method: 'DELETE', body: JSON.stringify({ id: order.id }) });
      await load();
    } catch (reason) {
      setData((current) => current ? { ...current, orders: previous } : current);
      setError(reason instanceof Error ? reason.message : 'Could not delete that order.');
    }
  };
  const installApp = async () => {
    const prompt = (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT;
    if (!prompt) { setInstallOpen(true); return; }
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') { localStorage.setItem('stoyangu-installed', '1'); void markAppInstalled(); }
      else setInstallOpen(true);
    } catch { setInstallOpen(true); }
  };
  if (loading) return <div className="owner-loading" role="status"><BrandLogo /><p>Getting your store ready…</p></div>;
  if (!data?.store) return <div className="owner-loading" role="status"><BrandLogo /><div className="dashboard-error">{error || 'This store could not be loaded.'}<button onClick={load}><RefreshCw /> Try again</button></div></div>;
  const store = data.store;
  const handleStorefrontClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    const prompt = (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT;
    if (profile?.role !== 'owner' || !prompt || localStorage.getItem('stoyangu-installed') === '1' || isStandaloneApp()) return;
    event.preventDefault();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') {
        localStorage.setItem('stoyangu-installed', '1');
        markAppInstalled();
      }
      (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT = null;
    } catch (reason) { console.warn('Chrome controls when the native installation dialog is available:', reason); }
    window.location.assign(storeLink(store.slug));
  };
  const latestUpdate = data.notifications?.[0];
  const upkeep = store as typeof store & StoreUpkeep;
  // KES 300 model: past the free first 30 days, management stays locked until
  // the current period is paid. The storefront itself keeps serving customers.
  const locked = profile?.role === 'owner' && Boolean(upkeep.management_locked);
  const upkeepOrders = Number(upkeep.orders_this_period ?? upkeep.orders_this_month ?? 0);
  const cycleStart = upkeep.upkeep_period_starts_at ? new Date(upkeep.upkeep_period_starts_at) : null;
  const cycleEnd = upkeep.upkeep_period_ends_at ? new Date(upkeep.upkeep_period_ends_at) : null;
  const cycleDay = useMemo(() => cycleStart ? Math.min(30, Math.max(1, Math.floor((Date.now() - cycleStart.getTime()) / 86400000) + 1)) : 1, [cycleStart]);

  return <div className="owner-page"><header className="owner-header owner-header-split"><div className="owner-header-actions"><span>{profile?.role === 'founder' ? 'Founder manage view' : 'StoYangu'}</span><div>{profile?.role === 'founder' && <button onClick={() => window.location.assign('/founder')} style={{ background: '#16a34a', color: '#fff', border: 0, borderRadius: 999, padding: '.5rem .9rem', fontWeight: 800, cursor: 'pointer' }}><ArrowLeft /> Back to founder dashboard</button>}{profile?.role === 'founder' && <button className="build-apk-button" onClick={buildStoreApk} disabled={apkBusy || apk.status === 'building' || !store.logo_url} title={!store.logo_url ? 'Add a store logo first' : 'Build this store’s Android app'}>{apkBusy || apk.status === 'building' ? <RefreshCw className="spin" /> : <Download />} Build app</button>}{apk.status === 'ready' && apk.apk_url ? <a className="header-icon-btn apk-download" href={apk.apk_url} download={`stoyangu-${store.slug}.apk`} aria-label={`Download ${store.name} APK`} title="Download this store’s Android app"><Download /></a> : <button className="header-icon-btn" type="button" onClick={installApp} disabled={/Android/i.test(navigator.userAgent)} aria-label="Android APK is being prepared" title={apk.status === 'failed' ? apk.error || 'Android build failed' : 'Waiting for this store’s Android APK'}><RefreshCw className="spin" /></button>}{profile?.role === 'owner' && <button onClick={() => setPasswordOpen(true)}><KeyRound /> Change password</button>}<button onClick={signOut}><LogOut /> Sign out</button></div></div><div className="owner-header-identity">{store.logo_url ? <img className="owner-store-logo" src={store.logo_url} alt={`${store.name} logo`} /> : <span className="owner-store-logo-fallback"><BrandLogo compact /></span>}<div className="owner-header-copy"><div className="owner-name-row"><h1>{store.name}</h1></div><a className="owner-store-link" href={storeLink(store.slug)} target="_blank" rel="noreferrer" onClick={handleStorefrontClick}>{storeDomain(store.slug)}<span className="owner-open-storefront-btn"><ExternalLink /></span></a><div className="tiktok-stats-row"><div className="tiktok-stat"><strong>{(data?.customers || 0).toLocaleString()}</strong><span>customers</span><small className="stat-today">+{data.customersToday || 0} today</small></div><div className="tiktok-stat"><strong>{store.visitor_total.toLocaleString()}</strong><span>visitors</span><small className="stat-today">+{store.visitor_today || 0} today</small></div><div className="tiktok-stat"><strong>{upkeepOrders.toLocaleString()}</strong><span>orders</span><small className="stat-today">+{store.orders_today || 0} today</small></div></div></div></div></header><main className="owner-main">
    {/* WOYOYO-013: My Products and My Customers pages */}
    {error && <div className="dashboard-error">{error}</div>}{apk.status === 'failed' && apk.error && <div className="dashboard-error">Android build: {apk.error}</div>}
    {activeTab === 'customers'
    ? <SocialInbox key={inboxKey} storeId={store.id} storeName={store.name} onActivity={() => refreshSocialUnread(store.id)} />
    : <>
    {profile?.role === 'owner' && <NotificationSetupCard />}
    {cycleDay >= 27 && !locked && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Renewal time</span><h3>{upkeep.upkeep_plan === 'TRIAL' ? 'Your free 30 days are ending' : 'Your 30 days are ending'}</h3><p>To keep {store.name} live for the next 30 days, pay KES 300{cycleEnd ? ` before ${cycleEnd.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. Message StoYangu on WhatsApp 0793 533 683 to pay and continue — it takes one minute.</p></div></section>}
    {locked && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Payment needed</span><h3>Your free 30 days have ended</h3><p>Good news: {store.name} is still visible to customers and orders can still reach you. Adding, editing and deleting products is locked until you pay KES 300 for the next 30 days. Message StoYangu on WhatsApp 0793 533 683 to pay — your tools unlock immediately.</p></div></section>}
    {latestUpdate && latestUpdate.batch_key?.startsWith('custom-') && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Message from StoYangu</span><h3>{latestUpdate.title}</h3><p className="custom-message-body">{latestUpdate.body}</p></div></section>}
    <section className="products-panel">
      <div className="dash-section-head">
        <h2>My Products</h2>
        <span className="order-status-count">{(data.products || []).length}</span>
      </div>
      <div className="owner-product-list">
        {data.products?.map((product) => (
          <article key={product.id} className="owner-product-card">
            <div
              className="product-media-group product-card-clickable"
              onClick={() => setViewingProduct(product)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewingProduct(product); } }}
              aria-label={`View ${product.name} details`}
            >
              <img
                className="product-cover"
                loading="lazy"
                src={product.image_url || product.images?.[0] || '/stoyangu-logo.png'}
                alt={product.name}
              />
            </div>
            <div
              className="owner-product-name product-card-clickable"
              onClick={() => setViewingProduct(product)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setViewingProduct(product); } }}
              aria-label={`View ${product.name} details`}
            >
              <h3>{product.name}</h3>
              <strong>{formatMoney(product.price)}</strong>
            </div>
            <div className="word-stats">
              <p>views: <b>{product.views_total}</b> <small>(+{product.views_today} Today)</small></p>
              <p>orders: <b>{product.orders_total}</b> <small>(+{product.orders_today} Today)</small></p>
            </div>
            <div className="product-actions">
              <button type="button" onClick={() => setViewingProduct(product)} aria-label={`View ${product.name} details`}><Eye size={16} /> Details</button>
              <button type="button" onClick={() => setEditing(product)} disabled={locked} aria-label={`Edit ${product.name}`}><Edit3 size={16} /> Edit</button>
              <button type="button" className="danger" onClick={() => remove(product)} disabled={locked} aria-label={`Delete ${product.name}`}><Trash2 size={16} /> Delete</button>
            </div>
          </article>
        ))}
      </div>
      {!data.products?.length && (
        <div className="empty-products">
          <StoreIcon />
          <h3>Your shelf is empty</h3>
          <p>Tap the + button below to create a post — you can add your first product while posting. A photo, name and price is enough.</p>
        </div>
      )}
    </section>
    </>}
  </main><nav className="manage-bottom-nav manage-bottom-nav-tiktok" aria-label="Manage store navigation"><div className="manage-bottom-nav-inner"><button className={`manage-nav-item ${activeTab === 'products' ? 'active' : ''}`} onClick={() => setActiveTab('products')} aria-label="My Products"><Package /><span>My Products</span></button><button className="manage-nav-post" onClick={openComposer} aria-label="Create a post"><Plus /></button><button className={`manage-nav-item ${activeTab === 'customers' ? 'active' : ''}`} onClick={() => setActiveTab('customers')} aria-label="My Customers"><Users /><span>My Customers</span>{socialUnread > 0 && <b className="manage-nav-badge">{socialUnread > 99 ? '99+' : socialUnread}</b>}</button></div></nav>{installOpen && <Modal title="Install StoYangu" onClose={() => setInstallOpen(false)}><div className="install-guide"><p>Install this app on your phone to open it from your home screen and receive updates when notifications are enabled.</p><p><strong>Android Chrome:</strong> tap the browser menu (⋮) and choose <strong>Install app</strong> or <strong>Add to Home screen</strong>.</p><p><strong>iPhone Safari:</strong> tap Share, then <strong>Add to Home Screen</strong>.</p><p>New app versions load when this site is redeployed and you reopen it. A native APK and automatic WhatsApp Status selection are not available through this website.</p></div></Modal>}{passwordOpen && <PasswordChangeModal onClose={() => setPasswordOpen(false)} />}{editing && <ProductModal product={editing === 'new' ? null : editing} storeId={store.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}{viewingProduct && <ProductDetailsModal product={viewingProduct} locked={locked} onClose={() => setViewingProduct(null)} onEdit={() => { const p = viewingProduct; setViewingProduct(null); setEditing(p); }} onDelete={async () => { const p = viewingProduct; setViewingProduct(null); await remove(p); }} />}{composerOpen && <PostComposer storeId={store.id} storeName={store.name} storeSlug={store.slug} locked={locked} onClose={closeComposer} onPosted={() => { setInboxKey((key) => key + 1); refreshSocialUnread(store.id); }} onProductsChanged={load} />}</div>;
}

function NotificationSetupCard() {
  const [status, setStatus] = useState<'checking' | 'hidden' | 'ready' | 'install-first' | 'denied' | 'done' | 'error'>('checking');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const decide = (config: { registered?: boolean } | null) => {
      if (cancelled) return;
      const iPhone = /iPad|iPhone|iPod/i.test(navigator.userAgent);
      const standalone = isStandaloneApp();
      const supported = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
      if (!supported) return setStatus(iPhone && !standalone ? 'install-first' : 'hidden');
      if (Notification.permission === 'denied') return setStatus('denied');
      if (config?.registered && Notification.permission === 'granted') return setStatus('hidden');
      return setStatus(iPhone && !standalone ? 'install-first' : 'ready');
    };
    apiFetch<{ registered?: boolean }>('/api/subscriptions').then(decide).catch(() => decide(null));
    return () => { cancelled = true; };
  }, []);
  const setup = async () => {
    setBusy(true);
    try {
      localStorage.setItem('stoyangu-installed', '1');
      await markAppInstalled();
      if ('Notification' in window && Notification.permission === 'default') {
        const perm = await Notification.requestPermission();
        if (perm === 'denied') {
          setStatus('denied');
          return;
        }
      }
      const result = await enableStoreNotifications();
      setStatus(result === 'granted' ? 'done' : result === 'denied' ? 'denied' : 'error');
    } catch (reason) {
      console.warn('Notification setup failed:', reason);
      setStatus('error');
    } finally {
      setBusy(false);
    }
  };
  if (status === 'checking' || status === 'hidden') return null;
  const copy: Record<string, { title: string; body: string }> = {
    ready: { title: 'Turn on your store alerts', body: 'Allow notifications so new orders, customer DMs, comments, and post confirmations reach your phone instantly.' },
    'install-first': { title: 'Install the app first', body: 'On your iPhone: tap the Share button in Safari, then choose "Add to Home Screen". Open StoYangu from your home screen, sign in again, and the option to turn on notifications will appear right here.' },
    denied: { title: 'Notifications are blocked on this phone', body: 'Chrome (Android): tap the lock/settings icon next to the address bar → Permissions → Notifications → Allow. iPhone: Settings → Notifications → StoYangu → Allow Notifications. Then refresh this page.' },
    done: { title: 'Store alerts are turned on', body: 'New orders, customer DMs, comments, and daily updates will now arrive instantly on this phone. Kazi iendelee!' },
    error: { title: 'Something interrupted the setup', body: 'Please try again in a moment. If it keeps failing, contact StoYangu support on WhatsApp.' },
  };
  const current = copy[status] || copy.ready;
  return <section className={`notification-setup ${status}`}><div className="notification-setup-icon"><BellRing /></div><div className="notification-setup-copy"><strong>{current.title}</strong><p>{current.body}</p></div>{status === 'ready' && <button className="button-primary" onClick={setup} disabled={busy}>{busy ? 'Turning on…' : 'Turn on notifications'}</button>}{status === 'error' && <button className="button-primary" onClick={setup} disabled={busy}>{busy ? 'Trying…' : 'Try again'}</button>}{status === 'done' && <span className="notification-setup-ok"><Check /> Alerts on</span>}{(status === 'install-first' || status === 'denied') && <button className="dismiss-notify" onClick={() => setStatus('hidden')} aria-label="Hide this reminder"><X /></button>}</section>;
}

function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(''); if (password.length < 8) return setMessage('Your new password must be at least 8 characters.'); if (password !== confirm) return setMessage('The two passwords do not match.'); setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false); if (error) return setMessage(error.message); setMessage('Password changed successfully.'); window.setTimeout(onClose, 900); };
  return <Modal title="Change account password" onClose={onClose}><form className="form-stack" onSubmit={submit}><p className="form-intro">Choose a strong password you will remember.</p><label>New password<div className="password-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff /> : <Eye />}</button></div></label><label>Confirm new password<input type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{message && <div className={message.includes('successfully') ? 'form-success' : 'form-error'}>{message}</div>}<button className="button-primary full" disabled={busy}>{busy ? 'Changing password…' : 'Change password'} <KeyRound /></button></form></Modal>;
}

