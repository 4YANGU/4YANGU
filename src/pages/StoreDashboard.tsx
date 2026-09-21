import { ArrowLeft, BellRing, Check, Edit3, ExternalLink, Eye, EyeOff, Inbox as InboxIcon, KeyRound, LogOut, MessageCircle, Phone, Plus, RefreshCw, ShoppingBag, Smartphone, Store as StoreIcon, Trash2, Users, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import PostComposer from '../components/PostComposer';
import ProductModal from '../components/ProductModal';
import SocialInbox from '../components/SocialInbox';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, formatMoney, storeDomain, storeLink } from '../lib/api';
import supabase from '../lib/supabase';
import type { DashboardData, Order, Product } from '../types';
import '../pricing-update.css';
import '../order-update.css';
import '../manage-redesign.css';

type StoreUpkeep = { orders_this_month?: number; orders_this_period?: number; upkeep_plan?: 'TRIAL' | 'PAID'; upkeep_due?: 0 | 300; upkeep_paid?: boolean; management_locked?: boolean; upkeep_period_starts_at?: string; upkeep_period_ends_at?: string };

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
  // Woyoyo-005: Orders and Inbox are the two destinations of the
  // fixed bottom nav; the + button opens the camera-first post flow.
  // Woyoyo-009: after same-tab OAuth the callback redirects back with
  // ?inbox=1 — land straight in the inbox so the result is visible at once.
  const [activeTab, setActiveTab] = useState<'orders' | 'inbox'>(() => {
    try { return new URLSearchParams(window.location.search).get('inbox') === '1' ? 'inbox' : 'orders'; }
    catch { return 'orders'; }
  });
  const [composerOpen, setComposerOpen] = useState(false);
  const [socialUnread, setSocialUnread] = useState(0);
  const [inboxKey, setInboxKey] = useState(0);
  // Woyoyo-005: Orders/Products switch on the Orders page (same box style
  // as the inbox DMs/Comments switch).
  const [shopTab, setShopTab] = useState<'orders' | 'products'>('orders');
  // Vfixed: one persistent "is the app installed" flag for the whole page. It combines
  // (a) actually running as an installed app, (b) the local record written the moment
  // an install completes, and (c) the server-side installation record — so refreshing
  // the manage page never brings the "Install app" button back after a real install.
  const [appInstalled, setAppInstalled] = useState(() => isStandaloneApp() || localStorage.getItem('stoyangu-installed') === '1');
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
    if (profile?.role !== 'owner') return;
    if (isStandaloneApp()) {
      localStorage.setItem('stoyangu-installed', '1');
      markAppInstalled();
      setAppInstalled(true);
    }
    // Vfixed: also trust the platform's installation record. Even on a brand-new
    // browser session with an empty localStorage, a store whose app is already
    // installed will not be asked to install again after a refresh.
    apiFetch<{ installation?: { installed?: boolean } | null }>('/api/subscriptions')
      .then((config) => {
        if (config.installation?.installed) {
          localStorage.setItem('stoyangu-installed', '1');
          setAppInstalled(true);
        }
      })
      .catch(() => undefined);
    const installed = () => {
      localStorage.setItem('stoyangu-installed', '1');
      markAppInstalled();
      setAppInstalled(true);
      enableStoreNotifications().catch((reason) => console.warn('Notification setup will continue from the dashboard reminder:', reason));
    };
    window.addEventListener('appinstalled', installed);
    return () => window.removeEventListener('appinstalled', installed);
  }, [profile?.role]);
  const remove = async (product: Product) => { if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return; try { await apiFetch('/api/products', { method: 'DELETE', body: JSON.stringify({ id: product.id }) }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete product.'); } };
  const updateOrderStatus = async (order: Order, status: Order['status']) => { const previous = order.status; setData((current) => current ? { ...current, orders: (current.orders || []).map((item) => item.id === order.id ? { ...item, status } : item) } : current); try { await apiFetch('/api/orders', { method: 'PUT', body: JSON.stringify({ id: order.id, status }) }); } catch (reason) { setData((current) => current ? { ...current, orders: (current.orders || []).map((item) => item.id === order.id ? { ...item, status: previous } : item) } : current); setError(reason instanceof Error ? reason.message : 'Could not update that order.'); } };
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
  const cycleDay = cycleStart ? Math.min(30, Math.max(1, Math.floor((Date.now() - cycleStart.getTime()) / 86400000) + 1)) : 1;
  const cycleLabel = cycleStart && cycleEnd ? `${upkeep.upkeep_plan === 'PAID' ? 'KES 300 · ' : ''}Day ${cycleDay}/30 · ends ${cycleEnd.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}` : (upkeep.upkeep_plan === 'PAID' ? 'KES 300 · this cycle' : 'Free trial');
  return <div className="owner-page"><header className="owner-header owner-header-split"><div className="owner-header-actions"><span>{profile?.role === 'founder' ? 'Founder manage view' : 'StoYangu'}</span><div>{profile?.role === 'founder' && <button onClick={() => window.location.assign('/founder')} style={{ background: '#16a34a', color: '#fff', border: 0, borderRadius: 999, padding: '.5rem .9rem', fontWeight: 800, cursor: 'pointer' }}><ArrowLeft /> Back to founder dashboard</button>}{profile?.role === 'owner' && !appInstalled && <button onClick={() => setInstallOpen(true)}><Smartphone /> Install app</button>}{profile?.role === 'owner' && <button onClick={() => setPasswordOpen(true)}><KeyRound /> Change password</button>}<button onClick={signOut}><LogOut /> Sign out</button></div></div><div className="owner-header-identity">{store.logo_url ? <img className="owner-store-logo" src={store.logo_url} alt={`${store.name} logo`} /> : <span className="owner-store-logo-fallback"><BrandLogo compact /></span>}<div className="owner-header-copy"><div className="owner-name-row"><h1>{store.name}</h1><a className="owner-open-store" href={storeLink(store.slug)} target="_blank" rel="noreferrer" onClick={handleStorefrontClick} aria-label="Open store" title={storeDomain(store.slug)}><ExternalLink /></a></div><div className="owner-header-stats"><span className="owner-mini-stat"><Users /> {store.visitor_total.toLocaleString()} visitors <small>+{store.visitor_today} today</small></span><span className="owner-mini-stat"><MessageCircle /> {upkeepOrders} orders <small>+{store.orders_today} today</small></span></div><span className="owner-cycle-dates">{cycleLabel}</span></div></div></header><main className="owner-main">
    {/* Woyoyo-005: Orders page — Orders/Products switch; stats live in the header. */}
    {error && <div className="dashboard-error">{error}</div>}
    {activeTab === 'inbox'
    ? <SocialInbox key={inboxKey} storeId={store.id} storeName={store.name} onActivity={() => refreshSocialUnread(store.id)} />
    : <>
    {profile?.role === 'owner' && <InstallAppCard forceOpen={installOpen} installed={appInstalled} onInstalled={() => setAppInstalled(true)} onDismiss={() => setInstallOpen(false)} />}
    {profile?.role === 'owner' && <NotificationSetupCard />}
    {cycleDay >= 27 && !locked && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Renewal time</span><h3>{upkeep.upkeep_plan === 'TRIAL' ? 'Your free 30 days are ending' : 'Your 30 days are ending'}</h3><p>To keep {store.name} live for the next 30 days, pay KES 300{cycleEnd ? ` before ${cycleEnd.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}. Message StoYangu on WhatsApp 0793 533 683 to pay and continue — it takes one minute.</p></div></section>}
    {locked && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Payment needed</span><h3>Your free 30 days have ended</h3><p>Good news: {store.name} is still visible to customers and orders can still reach you. Adding, editing and deleting products is locked until you pay KES 300 for the next 30 days. Message StoYangu on WhatsApp 0793 533 683 to pay — your tools unlock immediately.</p></div></section>}
    {latestUpdate && latestUpdate.batch_key?.startsWith('custom-') && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Message from StoYangu</span><h3>{latestUpdate.title}</h3><p className="custom-message-body">{latestUpdate.body}</p></div></section>}
    <div className="social-view-tabs shop-view-tabs" role="tablist" aria-label="Orders or products"><button className={shopTab === 'orders' ? 'active' : ''} onClick={() => setShopTab('orders')}><ShoppingBag /> Orders{(data.orders || []).filter((order) => order.status === 'new').length > 0 && <b className="tab-unread">{(data.orders || []).filter((order) => order.status === 'new').length}</b>}</button><button className={shopTab === 'products' ? 'active' : ''} onClick={() => setShopTab('products')}><StoreIcon /> Products</button></div>
    {shopTab === 'orders' ? <section className="incoming-orders"><div className="incoming-orders-head"><h2>My Orders</h2><span className="order-status-count">{(data.orders || []).length}</span></div>{data.orders?.length ? <div className="incoming-order-list">{[...data.orders].sort((a, b) => (a.status === 'new' ? 0 : 1) - (b.status === 'new' ? 0 : 1)).map((order) => { const orderedProduct = (data.products || []).find((product) => product.id === order.product_id); const orderPhoto = orderedProduct?.images?.[0] || orderedProduct?.image_url || ''; return <article className="incoming-order" key={order.id}>{orderPhoto ? <img className="incoming-order-photo" src={orderPhoto} alt={order.product_name} /> : <div className="incoming-order-photo incoming-order-photo-empty" aria-hidden="true" />}<div className="incoming-order-main"><strong>{order.product_name}</strong><span>{formatMoney(order.product_price)}{order.color ? ` · ${order.color}` : ''}{order.size ? ` · ${order.size}` : ''}{order.fulfilment ? ` · ${order.fulfilment}` : ''}</span>{order.note && <span>“{order.note}”</span>}<a className="order-customer-phone" href={`tel:${order.customer_phone}`}>{order.customer_phone}</a><small className="order-customer-date">{new Date(order.created_at).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}</small></div><div className="incoming-order-customer"><label className="order-switch" title={order.status === 'new' ? 'Mark as handled' : 'Mark as new'}><input type="checkbox" checked={order.status !== 'new'} onChange={() => updateOrderStatus(order, order.status === 'new' ? 'completed' : 'new')} aria-label={order.status === 'new' ? 'Mark order as handled' : 'Mark order as new'} /><span aria-hidden="true" /></label>{profile?.role === 'founder' && <button className="order-delete" onClick={() => removeOrder(order)} aria-label="Delete this order" title="Delete order"><Trash2 /></button>}<span className="order-contact-actions"><a className="order-wa" href={`https://wa.me/${order.customer_phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Hi! This is ${store.name} about your order of ${order.product_name}.`)}`} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a><a className="order-call" href={`tel:${order.customer_phone}`}><Phone /> Call</a></span></div></article>; })}</div> : <div className="orders-empty">Confirmed customer orders will appear here.</div>}</section>
    : <section className="products-panel"><div className="dash-section-head"><h2>My Products</h2><span className="order-status-count">{(data.products || []).length}</span></div><div className="owner-product-list">{data.products?.map((product) => <article key={product.id}><img src={product.image_url || '/stoyangu-logo.png'} alt={product.name} /><div className="owner-product-name"><h3>{product.name}</h3><strong>{formatMoney(product.price)}</strong></div><div className="word-stats"><p>views: <b>{product.views_total}</b> <small>(+{product.views_today} Today)</small></p><p>orders: <b>{product.orders_total}</b> <small>(+{product.orders_today} Today)</small></p></div><div className="product-actions"><button onClick={() => setEditing(product)} disabled={locked}><Edit3 /> Edit</button><button className="danger" onClick={() => remove(product)} disabled={locked}><Trash2 /> Delete</button></div></article>)}</div>{!data.products?.length && <div className="empty-products"><StoreIcon /><h3>Your shelf is empty</h3><p>Tap the + button below to create a post — you can add your first product while posting. A photo, name and price is enough.</p></div>}</section>}
    </>}
  </main><nav className="manage-bottom-nav" aria-label="Manage store navigation"><div className="manage-bottom-nav-inner"><button className={`manage-nav-item ${activeTab === 'orders' ? 'active' : ''}`} onClick={() => setActiveTab('orders')} aria-label="Orders"><ShoppingBag /><span>Orders</span></button><button className="manage-nav-post" onClick={() => setComposerOpen(true)} aria-label="Create a post"><Plus /></button><button className={`manage-nav-item ${activeTab === 'inbox' ? 'active' : ''}`} onClick={() => setActiveTab('inbox')} aria-label="Inbox"><InboxIcon /><span>Inbox</span>{socialUnread > 0 && <b className="manage-nav-badge">{socialUnread > 99 ? '99+' : socialUnread}</b>}</button></div></nav>{passwordOpen && <PasswordChangeModal onClose={() => setPasswordOpen(false)} />}{editing && <ProductModal product={editing === 'new' ? null : editing} storeId={store.id} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}{composerOpen && <PostComposer storeId={store.id} storeName={store.name} storeSlug={store.slug} locked={locked} onClose={() => setComposerOpen(false)} onPosted={() => { setInboxKey((key) => key + 1); refreshSocialUnread(store.id); }} onProductsChanged={load} />}</div>;
}

function InstallAppCard({ forceOpen, installed, onInstalled, onDismiss }: { forceOpen: boolean; installed: boolean; onInstalled: () => void; onDismiss: () => void }) {
  const [promptEvent, setPromptEvent] = useState<{ prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> } | null>(() => (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT || null);
  const [done, setDone] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);
  const iOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) || ((navigator as any).platform === 'MacIntel' && (navigator as any).maxTouchPoints > 1);
  const onPhone = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  useEffect(() => {
    const ready = () => setPromptEvent((window as any).__STOYANGU_NATIVE_INSTALL_PROMPT || null);
    window.addEventListener('stoyangu-install-ready', ready);
    return () => window.removeEventListener('stoyangu-install-ready', ready);
  }, []);
  const close = () => { sessionStorage.setItem('stoyangu-install-dismissed', '1'); setHidden(true); onDismiss(); };
  if (hidden || installed || isStandaloneApp()) return null;
  const actionable = Boolean(promptEvent) || iOS || onPhone;
  if (!forceOpen && (!actionable || sessionStorage.getItem('stoyangu-install-dismissed') === '1')) return null;
  const install = async () => {
    if (!promptEvent) { setManual(true); return; }
    setBusy(true);
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice?.outcome === 'accepted') {
        localStorage.setItem('stoyangu-installed', '1');
        markAppInstalled();
        onInstalled();
        setDone(true);
      } else {
        setManual(true);
      }
    } catch (reason) {
      console.warn('The browser did not allow the install prompt this time:', reason);
      setManual(true);
    } finally {
      (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT = null;
      setPromptEvent(null);
      setBusy(false);
    }
  };
  const showManual = manual || iOS || (!promptEvent && !done);
  let title = 'Install the StoYangu app';
  let body: React.ReactNode = iOS
    ? <ol className="install-steps"><li>Tap the <b>Share</b> button at the bottom of Safari (the box with an arrow pointing up).</li><li>Scroll down and tap <b>“Add to Home Screen”</b>, then tap <b>Add</b>.</li><li>Open StoYangu from your new home screen icon and sign in. Done!</li></ol>
    : <ol className="install-steps"><li>Tap the <b>⋮ menu</b> at the top right of Chrome.</li><li>Tap <b>“Install app”</b> (or <b>“Add to Home screen”</b>).</li><li>Open StoYangu from your home screen icon like a real app. If you opened this from TikTok or Instagram, first tap <b>⋮</b> and choose <b>“Open in browser”</b>.</li></ol>;
  if (!showManual && promptEvent) body = 'Get StoYangu on this phone as a real app — one tap installs it, and it opens full-screen from your home screen.';
  if (done) { title = 'App installed — asante!'; body = 'Open StoYangu from your home screen any time, like a real app. Turn on notifications below so your daily updates reach you.'; }
  return <section className={`notification-setup install-app ${done ? 'done' : ''}`}><div className="notification-setup-icon"><Smartphone /></div><div className="notification-setup-copy"><strong>{title}</strong>{typeof body === 'string' ? <p>{body}</p> : body}</div>{!done && Boolean(promptEvent) && !iOS && !manual && <button className="button-primary" onClick={install} disabled={busy}>{busy ? 'Installing…' : 'Install app'}</button>}{done && <span className="notification-setup-ok"><Check /> Installed</span>}<button className="dismiss-notify" onClick={close} aria-label="Hide install message"><X /></button></section>;
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
    ready: { title: 'Turn on your daily store updates', body: 'Allow notifications so your 7:30 PM daily update and any store news reach this phone. It takes one tap.' },
    'install-first': { title: 'Install the app first', body: 'On your iPhone: tap the Share button in Safari, then choose "Add to Home Screen". Open StoYangu from your home screen, sign in again, and the option to turn on notifications will appear right here.' },
    denied: { title: 'Notifications are blocked on this phone', body: 'Chrome (Android): tap the lock icon next to the address bar → Permissions → Notifications → Allow. iPhone: Settings → Notifications → StoYangu → Allow Notifications. Then refresh this page.' },
    done: { title: 'You are all set', body: 'Daily updates at 7:30 PM will now arrive on this phone as app notifications. Kazi iendelee!' },
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

