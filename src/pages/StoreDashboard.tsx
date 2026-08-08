import { BellRing, Camera, Check, Edit3, ExternalLink, Eye, EyeOff, Image, KeyRound, LogOut, MessageCircle, PackagePlus, Plus, RefreshCw, Store as StoreIcon, Trash2, Users, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, formatMoney, storeDomain, storeLink, uploadImage } from '../lib/api';
import supabase from '../lib/supabase';
import type { DashboardData, Product } from '../types';

const colorPresets = ['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold'];
const sizePresets = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42'];

export default function StoreDashboard() {
  const { storeId } = useParams(); const { profile, signOut } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [editing, setEditing] = useState<Product | 'new' | null>(null); const [passwordOpen, setPasswordOpen] = useState(false);
  const load = useCallback(async () => { setError(''); try { setData(await apiFetch<DashboardData>(`/api/dashboard${storeId ? `?storeId=${storeId}` : ''}`)); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load the store.'); } finally { setLoading(false); } }, [storeId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const installed = async () => {
      localStorage.setItem('stoyangu-installed', '1');
      try {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const permission = await Notification.requestPermission(); if (permission !== 'granted') return;
        const config = await apiFetch<{ publicKey: string }>('/api/subscriptions'); if (!config.publicKey) return;
        const registration = await navigator.serviceWorker.ready;
        const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), (character) => character.charCodeAt(0));
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        await apiFetch('/api/subscriptions', { method: 'POST', body: JSON.stringify({ subscription, installed: true, user_agent: navigator.userAgent }) });
      } catch (reason) { console.warn('Native app notification setup will be available from browser settings:', reason); }
    };
    window.addEventListener('appinstalled', installed);
    return () => window.removeEventListener('appinstalled', installed);
  }, []);
  const remove = async (product: Product) => { if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return; try { await apiFetch('/api/products', { method: 'DELETE', body: JSON.stringify({ id: product.id }) }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not delete product.'); } };
  if (loading) return <div className="owner-loading"><BrandLogo className="loading-logo" /><p>Getting your store ready…</p></div>;
  if (!data?.store) return <div className="owner-loading"><BrandLogo /><div className="dashboard-error">{error || 'This store could not be loaded.'}<button onClick={load}><RefreshCw /> Try again</button></div></div>;
  const store = data.store;
  const handleStorefrontClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    const prompt = (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT;
    if (profile?.role !== 'owner' || !prompt || localStorage.getItem('stoyangu-installed') === '1' || window.matchMedia('(display-mode: standalone)').matches) return;
    event.preventDefault();
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice?.outcome === 'accepted') localStorage.setItem('stoyangu-installed', '1');
      (window as any).__STOYANGU_NATIVE_INSTALL_PROMPT = null;
    } catch (reason) { console.warn('Chrome controls when the native installation dialog is available:', reason); }
    window.location.assign(storeLink(store.slug));
  };
  const latestUpdate = data.notifications?.[0];
  const updateDate = latestUpdate ? new Date(latestUpdate.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const updateTitle = latestUpdate?.title?.match(/\d/) ? latestUpdate.title : `StoYangu daily update, ${updateDate}`;
  return <div className="owner-page"><header className="owner-header"><div className="owner-header-actions"><span>{profile?.role === 'founder' ? 'Founder manage view' : 'My StoYangu'}</span><div>{profile?.role === 'owner' && <button onClick={() => setPasswordOpen(true)}><KeyRound /> Change password</button>}<button onClick={signOut}><LogOut /> Sign out</button></div></div><BrandLogo compact /><h1>{store.name}</h1><a href={storeLink(store.slug)} target="_blank" rel="noreferrer" onClick={handleStorefrontClick}>{storeDomain(store.slug)} <ExternalLink /></a></header><main className="owner-main">
    {error && <div className="dashboard-error">{error}</div>}
    <section className="analytics-grid two"><article className="metric-card owner-metric"><div className="metric-icon"><Users /></div><span>People who visited your store</span><strong>{store.visitor_total.toLocaleString()}</strong><small>+{store.visitor_today} Today</small></article><article className="metric-card owner-metric green"><div className="metric-icon"><MessageCircle /></div><span>People who clicked Order via WhatsApp</span><strong>{store.orders_total.toLocaleString()}</strong><small>+{store.orders_today} Today</small></article></section>
    {latestUpdate && <section className="recent-alert daily-update-card"><BellRing /><div className="daily-update-content"><span className="eyebrow">Latest update</span><h3>{updateTitle}</h3><p className="daily-traffic-summary"><b>{store.visitor_today}</b> people visited your store today and <b>{store.orders_today}</b> clicked Order via WhatsApp.</p><div className="daily-product-highlights">{latestUpdate.winner_product && <article className="champion"><img src={latestUpdate.winner_product.images?.[0] || latestUpdate.winner_product.image_url} alt={latestUpdate.winner_product.name} /><div><small>Today's champion product</small><strong>{latestUpdate.winner_product.name}</strong><span>{latestUpdate.winner_product.orders_today} orders from {latestUpdate.winner_product.views_today} views today. This product is leading your store.</span></div></article>}{latestUpdate.needs_product && <article><img src={latestUpdate.needs_product.images?.[0] || latestUpdate.needs_product.image_url} alt={latestUpdate.needs_product.name} /><div><small>Needs a look</small><strong>{latestUpdate.needs_product.name}</strong><span>{latestUpdate.needs_product.views_today} views with {latestUpdate.needs_product.orders_today} orders today. Try improving its main photo or checking the price.</span></div></article></div><p className="daily-update-reminder">Keep mentioning <b>{storeDomain(store.slug)}</b> in your videos so customers always know where to shop.</p></div></section>}
    <section className="products-panel"><div className="dash-section-head"><div><span className="eyebrow">Your live shelf</span><h2>Products</h2><p>{data.products?.length || 0} products customers can shop.</p></div><button className="button-primary" onClick={() => setEditing('new')}><Plus /> Add product</button></div><div className="owner-product-list">{data.products?.map((product) => <article key={product.id}><img src={product.image_url || '/stoyangu-logo.png'} alt={product.name} /><div className="owner-product-name"><span>{product.category}</span><h3>{product.name}</h3><strong>{formatMoney(product.price)}</strong></div><div className="word-stats"><p>views: <b>{product.views_total}</b> <small>(+{product.views_today} Today)</small></p><p>orders: <b>{product.orders_total}</b> <small>(+{product.orders_today} Today)</small></p></div><div className="product-actions"><button onClick={() => setEditing(product)}><Edit3 /> Edit</button><button className="danger" onClick={() => remove(product)}><Trash2 /> Delete</button></div></article>)}</div>{!data.products?.length && <div className="empty-products"><StoreIcon /><h3>Your shelf is empty</h3><p>Add the first product. A photo, name and price is enough.</p><button className="button-primary" onClick={() => setEditing('new')}><PackagePlus /> Add first product</button></div>}</section>
  </main>{passwordOpen && <PasswordChangeModal onClose={() => setPasswordOpen(false)} />}{editing && <ProductModal product={editing === 'new' ? null : editing} storeId={store.id} categories={store.categories || []} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); await load(); }} />}</div>;
}

function PasswordChangeModal({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const submit = async (event: FormEvent) => { event.preventDefault(); setMessage(''); if (password.length < 8) return setMessage('Your new password must be at least 8 characters.'); if (password !== confirm) return setMessage('The two passwords do not match.'); setBusy(true); const { error } = await supabase.auth.updateUser({ password }); setBusy(false); if (error) return setMessage(error.message); setMessage('Password changed successfully.'); window.setTimeout(onClose, 900); };
  return <Modal title="Change account password" onClose={onClose}><form className="form-stack" onSubmit={submit}><p className="form-intro">Choose a strong password you will remember.</p><label>New password<div className="password-field"><input type={show ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /><button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? 'Hide password' : 'Show password'}>{show ? <EyeOff /> : <Eye />}</button></div></label><label>Confirm new password<input type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{message && <div className={message.includes('successfully') ? 'form-success' : 'form-error'}>{message}</div>}<button className="button-primary full" disabled={busy}>{busy ? 'Changing password…' : 'Change password'} <KeyRound /></button></form></Modal>;
}

function ProductModal({ product, storeId, categories, onClose, onSaved }: { product: Product | null; storeId: number; categories: string[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name || ''); const [price, setPrice] = useState(product ? String(product.price) : ''); const [category, setCategory] = useState(product?.category || categories[0] || 'General'); const [customCategory, setCustomCategory] = useState('');
  const [hasColors, setHasColors] = useState(Boolean(product?.colors?.length)); const [colors, setColors] = useState<string[]>(product?.colors || []); const [customColor, setCustomColor] = useState('');
  const [hasSizes, setHasSizes] = useState(Boolean(product?.sizes?.length)); const [sizes, setSizes] = useState<string[]>(product?.sizes || []); const [customSize, setCustomSize] = useState('');
  const initialPhotos = (product?.images?.length ? product.images : [product?.image_url].filter(Boolean)) as string[];
  const [photos, setPhotos] = useState<Array<{ id: string; url: string; file?: File }>>(initialPhotos.map((url, index) => ({ id: \`saved-\${index}\`, url })));
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const galleryRef = useRef<HTMLInputElement>(null); const cameraRef = useRef<HTMLInputElement>(null);
  const choose = (files?: FileList | null) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!selected.length) return;
    setPhotos((current) => {
      const room = Math.max(0, 7 - current.length);
      if (selected.length > room) setError('A product can have a maximum of 7 photos.');
      return [...current, ...selected.slice(0, room).map((file) => ({ id: \`\${file.name}-\${file.lastModified}-\${Math.random()}\`, url: URL.createObjectURL(file), file }))];
    });
  };
  const removePhoto = (id: string) => setPhotos((current) => current.filter((photo) => photo.id !== id));
  const addCategory = () => { const value = customCategory.trim(); if (!value) return; setCategory(value); setCustomCategory(''); };
  const toggle = (item: string, list: string[], setter: (value: string[]) => void) => setter(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  const addCustom = (type: 'color' | 'size') => { const value = (type === 'color' ? customColor : customSize).trim(); if (!value) return; if (type === 'color') { setColors(Array.from(new Set([...colors, value]))); setCustomColor(''); } else { setSizes(Array.from(new Set([...sizes, value]))); setCustomSize(''); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); if (name.trim().length < 2) return setError('Add a product name.'); if (!Number(price) || Number(price) < 1) return setError('Add a valid product price.'); if (!photos.length) return setError('Add at least one product photo from gallery or camera.'); if (photos.length > 7) return setError('A product can have a maximum of 7 photos.'); setBusy(true); try { const images = await Promise.all(photos.map(async (photo) => photo.file ? (await uploadImage(photo.file, 'products')).url : photo.url)); const body = { id: product?.id, store_id: storeId, name: name.trim(), price: Number(price), category, colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], image_url: images[0], images }; await apiFetch('/api/products', { method: product ? 'PUT' : 'POST', body: JSON.stringify(body) }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not save product.'); } finally { setBusy(false); } };
  return <Modal title={product ? 'Edit product' : 'Add a product'} onClose={onClose} wide><form className="product-form" onSubmit={submit}><div className="photo-manager"><div className="photo-manager-head"><div><strong>Product photos</strong><p>Add up to 7. JPG, PNG, WebP, GIF, HEIC and AVIF are supported.</p></div><span>{photos.length} / 7</span></div><div className="photo-grid">{photos.map((photo, index) => <div className={\`photo-tile \${index === 0 ? 'cover' : ''}\`} key={photo.id}><img src={photo.url} alt={\`Product photo \${index + 1}\`} />{index === 0 && <small>Cover</small>}<button type="button" onClick={() => removePhoto(photo.id)} aria-label={\`Remove photo \${index + 1}\`}><X /></button></div>)}{photos.length < 7 && <button type="button" className="photo-add-tile" onClick={() => galleryRef.current?.click()}><Image /><span>Add photos</span></button></div><div className="photo-source-actions"><button type="button" className="secondary-button" onClick={() => galleryRef.current?.click()}><Image /> Choose from gallery</button><button type="button" className="secondary-button" onClick={() => cameraRef.current?.click()}><Camera /> Take a photo</button></div><input ref={galleryRef} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => { choose(event.target.files); event.target.value = ''; }} /><input ref={cameraRef} hidden type="file" accept="image/*,.avif,.heic,.heif" capture="environment" onChange={(event) => { choose(event.target.files); event.target.value = ''; }} /></div><div className="form-grid"><label>Product name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Price (KES)<input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} /></label><CategoryPicker label="Category" items={Array.from(new Set([...categories, 'General'])).filter(Boolean)} value={category} onChange={setCategory} custom={customCategory} setCustom={setCustomCategory} onAdd={addCategory} /></div><OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={colorPresets} selected={colors} onToggle={(item) => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} /><OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={sizePresets} selected={sizes} onToggle={(item) => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} />{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? \`Uploading \${photos.length} photo\${photos.length === 1 ? '' : 's'}…\` : 'Save product'} <Check /></button></div></form></Modal>;
}

function CategoryPicker({ label, items, value, onChange, custom, setCustom, onAdd }: { label: string; items: string[]; value: string; onChange: (val: string) => void; custom: string; setCustom: (val: string) => void; onAdd: () => void }) {
  return (
    <fieldset className="option-picker">
      <label className="toggle-label">
        <span style={{ visibility: 'hidden' }}><Check /></span>
        <strong>{label}</strong>
      </label>
      <div className="option-expand">
        <div className="option-chips">
          {items.map((item) => (
            <button type="button" className={value === item ? 'selected' : ''} key={item} onClick={() => onChange(item)}>
              {value === item && <Check />} {item}
            </button>
          ))}
          {value && !items.includes(value) && (
            <button type="button" className="selected" key={value} onClick={() => onChange(value)}>
              <Check /> {value}
            </button>
          )}
        </div>
        <div className="custom-option">
          <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Add custom category" />
          <button type="button" onClick={onAdd}><Plus /> Add</button>
        </div>
      </div>
    </fieldset>
  );
}

function OptionPicker({ label, enabled, setEnabled, items, selected, onToggle, custom, setCustom, onAdd }: { label: string; enabled: boolean; setEnabled: (value: boolean) => void; items: string[]; selected: string[]; onToggle: (item: string) => void; custom: string; setCustom: (value: string) => void; onAdd: () => void }) {
  return (
    <fieldset className="option-picker">
      <label className="toggle-label">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        <span><Check /></span>
        <strong>{label}</strong>
      </label>
      {enabled && (
        <div className="option-expand">
          <div className="option-chips">
            {items.map((item) => (
              <button type="button" className={selected.includes(item) ? 'selected' : ''} key={item} onClick={() => onToggle(item)}>
                {selected.includes(item) && <Check />} {item}
              </button>
            ))}
            {selected.filter((item) => !items.includes(item)).map((item) => (
              <button type="button" className="selected" key={item} onClick={() => onToggle(item)}>
                <Check /> {item}
              </button>
            ))}
          </div>
          <div className="custom-option">
            <input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder={\`Add custom \${label.toLowerCase().includes('color') ? 'colour' : 'size'}\`} />
            <button type="button" onClick={onAdd}><Plus /> Add</button>
          </div>
        </div>
      )}
    </fieldset>
  );
}
