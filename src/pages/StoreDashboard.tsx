import { BellRing, Camera, Check, Edit3, ExternalLink, Eye, EyeOff, Image, KeyRound, LogOut, MessageCircle, PackagePlus, Plus, RefreshCw, Smartphone, Store as StoreIcon, Trash2, Users, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import StickerDownload from '../components/StickerDownload';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, formatMoney, storeDomain, storeLink, uploadImage } from '../lib/api';
import supabase from '../lib/supabase';
import type { DashboardData, Product } from '../types';
import '../pricing-update.css';

const colorPresets = ['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold'];
const sizePresets = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42'];
type StoreUpkeep = { orders_this_month?: number; orders_this_period?: number; upkeep_plan?: 'FREE' | 'PRO'; upkeep_due?: 0 | 999; upkeep_period_starts_at?: string; upkeep_period_ends_at?: string };

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
    if (profile?.role !== 'owner') return;
    if (isStandaloneApp()) {
      localStorage.setItem('stoyangu-installed', '1');
      markAppInstalled();
    }
    const installed = () => {
      localStorage.setItem('stoyangu-installed', '1');
      markAppInstalled();
      enableStoreNotifications().catch((reason) => console.warn('Notification setup will continue from the dashboard reminder:', reason));
    };
    window.addEventListener('appinstalled', installed);
    return () => window.removeEventListener('appinstalled', installed);
  }, [profile?.role]);
  const remove = async (product: Product) => { if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return; try { await apiFetch('/api/products', { method: 'DELETE', body: JSON.stringify({ id: product.id }) }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete product.'); } };
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
  const updateDate = latestUpdate ? new Date(latestUpdate.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const updateTitle = latestUpdate?.title?.match(/\d/) ? latestUpdate.title : `StoYangu daily update, ${updateDate}`;
  const upkeep = store as typeof store & StoreUpkeep;
  const upkeepOrders = Number(upkeep.orders_this_period ?? upkeep.orders_this_month ?? 0);
  const upkeepPeriodEnd = upkeep.upkeep_period_ends_at ? new Date(upkeep.upkeep_period_ends_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : 'the end of this 30-day period';
  return <div className="owner-page"><header className="owner-header"><div className="owner-header-actions"><span>{profile?.role === 'founder' ? 'Founder manage view' : 'My StoYangu'}</span><div>{profile?.role === 'owner' && !isStandaloneApp() && <button onClick={() => setInstallOpen(true)}><Smartphone /> Install app</button>}{profile?.role === 'owner' && <button onClick={() => setPasswordOpen(true)}><KeyRound /> Change password</button>}<button onClick={signOut}><LogOut /> Sign out</button></div></div><BrandLogo compact /><h1>{store.name}</h1><a href={storeLink(store.slug)} target="_blank" rel="noreferrer" onClick={handleStorefrontClick}>{storeDomain(store.slug)} <ExternalLink /></a></header><main className="owner-main">
    {error && <div className="dashboard-error">{error}</div>}
    {profile?.role === 'owner' && <InstallAppCard forceOpen={installOpen} onDismiss={() => setInstallOpen(false)} />}
    {profile?.role === 'owner' && <NotificationSetupCard />}
    <section className={`upkeep-status ${upkeep.upkeep_plan === 'PRO' ? 'pro' : 'free'}`}><div className="upkeep-status-head"><div><span className="eyebrow">Current 30-day upkeep period</span><h2>{upkeep.upkeep_plan === 'PRO' ? 'PRO · KES 999' : 'FREE · KES 0'}</h2></div><span className="upkeep-order-count"><b>{upkeepOrders}</b> order{upkeepOrders === 1 ? '' : 's'}</span></div><p>{upkeep.upkeep_plan === 'PRO' ? `Your store has more than five orders in this 30-day period, so KES 999 upkeep applies when the period ends on ${upkeepPeriodEnd}.` : `You have ${upkeepOrders} of 5 FREE-tier orders in this 30-day period. Five or fewer by ${upkeepPeriodEnd} means no upkeep payment.`}</p><div className="upkeep-meter"><i style={{ width: `${Math.min(100, (upkeepOrders / 6) * 100)}%` }} /></div><small><Check /> Your KES 15,000 setup remains fully covered by the Video Yangu, Store Yangu TikTok exchange. This first 30 days is measured normally; it is not a free trial.</small></section>
    <section className="analytics-grid two"><article className="metric-card owner-metric"><div className="metric-icon"><Users /></div><span>Store visitors</span><strong>{store.visitor_total.toLocaleString()}</strong><small>+{store.visitor_today} Today</small></article><article className="metric-card owner-metric green"><div className="metric-icon"><MessageCircle /></div><span>WhatsApp order clicks</span><strong>{store.orders_total.toLocaleString()}</strong><small>+{store.orders_today} Today</small></article></section>
    <StickerDownload slug={store.slug} />
    {latestUpdate && latestUpdate.batch_key?.startsWith('custom-') && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Message from StoYangu</span><h3>{latestUpdate.title}</h3><p className="custom-message-body">{latestUpdate.body}</p></div></section>}
    {latestUpdate && !latestUpdate.batch_key?.startsWith('custom-') && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Latest update</span><h3>{updateTitle}</h3><p className="daily-traffic-summary"><b>{store.visitor_today}</b> people visited your store today and <b>{store.orders_today}</b> clicked Order via WhatsApp.</p><div className="daily-product-highlights">{latestUpdate.winner_product && <article className="champion"><img src={latestUpdate.winner_product.images?.[0] || latestUpdate.winner_product.image_url} alt={latestUpdate.winner_product.name} /><div><small>Today's champion product</small><strong>{latestUpdate.winner_product.name}</strong><span>{latestUpdate.winner_product.orders_today} orders from {latestUpdate.winner_product.views_today} views today. This product is leading your store.</span></div></article>}{latestUpdate.needs_product && <article><img src={latestUpdate.needs_product.images?.[0] || latestUpdate.needs_product.image_url} alt={latestUpdate.needs_product.name} /><div><small>Needs a look</small><strong>{latestUpdate.needs_product.name}</strong><span>{latestUpdate.needs_product.views_today} views with {latestUpdate.needs_product.orders_today} orders today. Try improving its main photo or checking the price.</span></div></article>}</div><p className="daily-update-reminder">Keep mentioning <b>{storeDomain(store.slug)}</b> in your videos so customers always know where to shop.</p></div></section>}
    <section className="products-panel"><div className="dash-section-head"><div><span className="eyebrow">Your live shelf</span><h2>Products</h2><p>{data.products?.length || 0} products customers can shop.</p></div><button className="button-primary" onClick={() => setEditing('new')}><Plus /> Add product</button></div><div className="owner-product-list">{data.products?.map((product) => <article key={product.id}><img src={product.image_url || '/stoyangu-logo.png'} alt={product.name} /><div className="owner-product-name"><span>{product.category}</span><h3>{product.name}</h3><strong>{formatMoney(product.price)}</strong></div><div className="word-stats"><p>views: <b>{product.views_total}</b> <small>(+{product.views_today} Today)</small></p><p>orders: <b>{product.orders_total}</b> <small>(+{product.orders_today} Today)</small></p></div><div className="product-actions"><button onClick={() => setEditing(product)}><Edit3 /> Edit</button><button className="danger" onClick={() => remove(product)}><Trash2 /> Delete</button></div></article>)}</div>{!data.products?.length && <div className="empty-products"><StoreIcon /><h3>Your shelf is empty</h3><p>Add the first product. A photo, name and price is enough.</p><button className="button-primary" onClick={() => setEditing('new')}><PackagePlus /> Add first product</button></div>}</section>
  </main>{passwordOpen && <PasswordChangeModal onClose={() => setPasswordOpen(false)} />}{editing && <ProductModal product={editing === 'new' ? null : editing} storeId={store.id} categories={store.categories || []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}</div>;
}

function InstallAppCard({ forceOpen, onDismiss }: { forceOpen: boolean; onDismiss: () => void }) {
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
  if (hidden || isStandaloneApp()) return null;
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

function ProductModal({ product, storeId, categories, onClose, onSaved }: { product: Product | null; storeId: number; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name || '');
  const [price, setPrice] = useState(product ? String(product.price) : '');
  const categoryPresets = Array.from(new Set([...(categories.length ? categories : ['General']), ...(product?.category ? [product.category] : [])])).filter(Boolean);
  const [presetCategory, setPresetCategory] = useState(product?.category && categoryPresets.includes(product.category) ? product.category : categoryPresets[0] || 'General');
  const [customCategory, setCustomCategory] = useState('');
  const finalCategory = presetCategory === '__custom' ? customCategory.trim() : presetCategory;
  const [hasColors, setHasColors] = useState(Boolean(product?.colors?.length)); const [colors, setColors] = useState<string[]>(product?.colors || []); const [customColor, setCustomColor] = useState('');
  const [hasSizes, setHasSizes] = useState(Boolean(product?.sizes?.length)); const [sizes, setSizes] = useState<string[]>(product?.sizes || []); const [customSize, setCustomSize] = useState('');
  const initialPhotos = (product?.images?.length ? product.images : [product?.image_url].filter(Boolean)) as string[];
  const [photos, setPhotos] = useState<Array<{ id: string; url: string; file?: File }>>(initialPhotos.map((url, index) => ({ id: `saved-${index}`, url })));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const galleryRef = useRef<HTMLInputElement>(null); const cameraRef = useRef<HTMLInputElement>(null);
  const choose = (files?: FileList | null) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!selected.length) return;
    setPhotos((current) => {
      const room = Math.max(0, 7 - current.length);
      if (selected.length > room) setError('A product can have a maximum of 7 photos.');
      return [...current, ...selected.slice(0, room).map((file) => ({ id: `${file.name}-${file.lastModified}-${Math.random()}`, url: URL.createObjectURL(file), file }))];
    });
  };
  const removePhoto = (id: string) => setPhotos((current) => current.filter((photo) => photo.id !== id));
  const toggle = (item: string, list: string[], setter: (value: string[]) => void) => setter(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  const addCustom = (type: 'color' | 'size') => { const value = (type === 'color' ? customColor : customSize).trim(); if (!value) return; if (type === 'color') { setColors(Array.from(new Set([...colors, value]))); setCustomColor(''); } else { setSizes(Array.from(new Set([...sizes, value]))); setCustomSize(''); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); if (name.trim().length < 2) return setError('Add a product name.'); if (!Number(price) || Number(price) < 1) return setError('Add a valid product price.'); if (!finalCategory) return setError('Choose a category from the list or type a new custom one.'); if (!photos.length) return setError('Add at least one product photo from gallery or camera.'); if (photos.length > 7) return setError('A product can have a maximum of 7 photos.'); setBusy(true); try { const images = await Promise.all(photos.map(async (photo) => photo.file ? (await uploadImage(photo.file, 'products')).url : photo.url)); const body = { id: product?.id, store_id: storeId, name: name.trim(), price: Number(price), category: finalCategory, colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], image_url: images[0], images }; await apiFetch('/api/products', { method: product ? 'PUT' : 'POST', body: JSON.stringify(body) }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save product.'); } finally { setBusy(false); } };
  return <Modal title={product ? 'Edit product' : 'Add a product'} onClose={onClose} wide><form className="product-form" onSubmit={submit}><div className="photo-manager"><div className="photo-manager-head"><div><strong>Product photos</strong><p>Add up to 7. JPG, PNG, WebP, GIF, HEIC and AVIF are supported.</p></div><span>{photos.length} / 7</span></div><div className="photo-grid">{photos.map((photo, index) => <div className={`photo-tile ${index === 0 ? 'cover' : ''}`} key={photo.id}><img src={photo.url} alt={`Product photo ${index + 1}`} />{index === 0 && <small>Cover</small>}<button type="button" onClick={() => removePhoto(photo.id)} aria-label={`Remove photo ${index + 1}`}><X /></button></div>)}{photos.length < 7 && <button type="button" className="photo-add-tile" onClick={() => galleryRef.current?.click()}><Image /><span>Add photos</span></button>}</div><div className="photo-source-actions"><button type="button" className="secondary-button" onClick={() => galleryRef.current?.click()}><Image /> Choose from gallery</button><button type="button" className="secondary-button" onClick={() => cameraRef.current?.click()}><Camera /> Take a photo</button></div><input ref={galleryRef} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => { choose(event.target.files); event.target.value = ''; }} /><input ref={cameraRef} hidden type="file" accept="image/*,.avif,.heic,.heif" capture="environment" onChange={(event) => { choose(event.target.files); event.target.value = ''; }} /></div><div className="form-grid"><label>Product name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Price (KES)<input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} /></label><label className="span-two">Category<select className="category-select" value={presetCategory} onChange={(event) => setPresetCategory(event.target.value)} aria-label="Choose a product category">{categoryPresets.map((item) => <option key={item} value={item}>{item}</option>)}<option value="__custom">＋ Custom category…</option></select>{presetCategory === '__custom' && <input className="custom-category-input" value={customCategory} onChange={(event) => setCustomCategory(event.target.value)} placeholder="Type the new category, e.g. Sunglasses" autoFocus />}<small>Pick a category from the drop-down, or choose “Custom category…” to create a brand-new one. It is saved together with this product.</small></label></div><OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={colorPresets} selected={colors} onToggle={(item) => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} /><OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={sizePresets} selected={sizes} onToggle={(item) => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} />{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? `Uploading ${photos.length} photo${photos.length === 1 ? '' : 's'}…` : 'Save product'} <Check /></button></div></form></Modal>;
}

function OptionPicker({ label, enabled, setEnabled, items, selected, onToggle, custom, setCustom, onAdd }: { label: string; enabled: boolean; setEnabled: (value: boolean) => void; items: string[]; selected: string[]; onToggle: (item: string) => void; custom: string; setCustom: (value: string) => void; onAdd: () => void }) { return <fieldset className="option-picker"><label className="toggle-label"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><Check /></span><strong>{label}</strong></label>{enabled && <div className="option-expand"><div className="option-chips">{items.map((item) => <button type="button" className={selected.includes(item) ? 'selected' : ''} key={item} onClick={() => onToggle(item)}>{selected.includes(item) && <Check />} {item}</button>)}{selected.filter((item) => !items.includes(item)).map((item) => <button type="button" className="selected" key={item} onClick={() => onToggle(item)}><Check /> {item}</button>)}</div><div className="custom-option"><input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={`Add custom ${label.toLowerCase().includes('color') ? 'colour' : 'size'}`} /><button type="button" onClick={onAdd}><Plus /> Add</button></div></div>}</fieldset>; }
