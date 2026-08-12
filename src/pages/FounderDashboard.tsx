import { BellRing, Box, CalendarClock, Check, ChevronRight, Clipboard, Code2, Download, ExternalLink, Eye, EyeOff, FileCode2, FilePlus2, LayoutDashboard, LogOut, MessageCircle, Package, Plus, Power, RefreshCw, Search, Send, Settings2, Sparkles, Store as StoreIcon, Trash2, X } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { apiFetch, storeDomain, storeLink, uploadImage } from '../lib/api';
import type { Application, DashboardData, Store } from '../types';

const daysLeft = (store: Store) => {
  if (!store.is_active || !store.billing_started_at) return { label: 'OFF', tone: 'off' };
  if (store.billing_paid_until && new Date(store.billing_paid_until) > new Date()) return { label: `Paid to ${new Date(store.billing_paid_until).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`, tone: 'paid' };
  const elapsed = Math.floor((Date.now() - new Date(store.billing_started_at).getTime()) / 86400000);
  if (elapsed < 30) return { label: `${30 - elapsed} days left`, tone: 'active' };
  return { label: `${Math.max(0, 35 - elapsed)} grace days left`, tone: 'grace' };
};

export default function FounderDashboard() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [search, setSearch] = useState(''); const [newStore, setNewStore] = useState(false); const [editStore, setEditStore] = useState<Store | null>(null); const [storefrontStore, setStorefrontStore] = useState<Store | null>(null); const [notifications, setNotifications] = useState(false); const [deletingStore, setDeletingStore] = useState<Store | null>(null);
  const load = useCallback(async () => { setError(''); try { setData(await apiFetch<DashboardData>('/api/dashboard')); } catch (err) { setError(err instanceof Error ? err.message : 'Could not load dashboard.'); } finally { setLoading(false); } }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let timer = 0;
    const generate = () => apiFetch('/api/notifications?action=generate').catch((reason) => console.warn('Daily review generation will retry when opened:', reason));
    const now = new Date();
    const sevenPmKenya = new Date(now); sevenPmKenya.setUTCHours(16, 0, 0, 0);
    if (now >= sevenPmKenya) {
      generate();
      sevenPmKenya.setUTCDate(sevenPmKenya.getUTCDate() + 1);
    }
    timer = window.setTimeout(() => { generate(); }, Math.max(1000, sevenPmKenya.getTime() - Date.now()));
    return () => window.clearTimeout(timer);
  }, []);
  const stores = useMemo(() => (data?.stores || []).filter((store) => `${store.name} ${store.whatsapp} ${store.slug}`.toLowerCase().includes(search.toLowerCase())), [data, search]);
  const toggle = async (store: Store) => { try { await apiFetch('/api/stores', { method: 'PUT', body: JSON.stringify({ action: 'billing', id: store.id, is_active: !store.is_active }) }); await load(); } catch (err) { setError(err instanceof Error ? err.message : 'Could not update store.'); } };
  const applicationStatus = async (application: Application, status: Application['status']) => { await apiFetch('/api/applications', { method: 'PUT', body: JSON.stringify({ id: application.id, status }) }); await load(); };
  const handleSignOut = async () => { await signOut(); navigate('/login', { replace: true }); };
  return <div className="dashboard-shell"><aside className="dashboard-sidebar"><BrandLogo /><div className="founder-chip"><span>F</span><div><strong>Founder</strong><small>Shared workspace</small></div></div><nav><a className="active" href="#overview"><LayoutDashboard /> Overview</a><a href="#applications"><FilePlus2 /> Applications</a><a href="#stores"><StoreIcon /> All stores</a><button onClick={() => setNotifications(true)}><BellRing /> Notifications</button><a href="/stoyangu-source.zip" download><Download /> Download app</a></nav><button className="sidebar-signout" onClick={handleSignOut}><Settings2 /> Sign out</button></aside><main className="dashboard-main"><div className="mobile-topbar"><BrandLogo /><div className="mobile-topbar-actions"><button onClick={() => setNotifications(true)}><BellRing /> Alerts</button><button onClick={handleSignOut}><LogOut /> Sign out</button></div></div><header className="dashboard-top"><div><span className="eyebrow">Founder dashboard</span><h1>StoYangu overview</h1><p>Everything moving across the platform today.</p></div><div className="top-actions"><a className="secondary-button source-download" href="/stoyangu-source.zip" download><Download /> Download source</a><button className="secondary-button" onClick={() => setNotifications(true)}><BellRing /> Notifications</button><button className="button-primary compact" onClick={() => setNewStore(true)}><Plus /> New store</button></div></header>
    {error && <div className="dashboard-error">{error}<button onClick={load}><RefreshCw /> Try again</button></div>}
    {loading ? <DashboardSkeleton /> : data && <>
      <section id="overview" className="analytics-grid four"><Metric icon={<StoreIcon />} label="Active stores" value={data.analytics?.activeStores || 0} note="Live now" /><Metric icon={<Eye />} label="Lifetime store visitors" value={data.analytics?.visitors || 0} note={`+${data.analytics?.visitorsToday || 0} Today`} /><Metric icon={<MessageCircle />} label="Lifetime WhatsApp orders" value={data.analytics?.orders || 0} note={`+${data.analytics?.ordersToday || 0} Today`} /><Metric icon={<Package />} label="Products live" value={data.analytics?.products || 0} note="Across all stores" /></section>
      <section id="applications" className="dash-section"><div className="dash-section-head"><div><span className="eyebrow">Fresh leads</span><h2>StoYangu applications</h2></div><span className="count-badge">{data.applications?.length || 0} total</span></div><div className="application-list">{data.applications?.map((application) => <article key={application.id}><span className={`status-dot ${application.status}`} /><div className="application-person">{(() => { const [personName, tiktokHandle] = application.name.split(' · TikTok: @'); return <><strong>{personName}</strong><a href={`tel:${application.phone}`}>{application.phone}</a>{tiktokHandle && <a className="application-tiktok" href={`https://tiktok.com/@${encodeURIComponent(tiktokHandle)}`} target="_blank" rel="noreferrer">@{tiktokHandle} on TikTok</a>}</>; })()}</div><span className="application-date">{new Date(application.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}</span><select value={application.status} onChange={(event) => applicationStatus(application, event.target.value as Application['status'])} aria-label={`Status for ${application.name}`}><option value="new">New</option><option value="contacted">Contacted</option><option value="approved">Approved</option><option value="closed">Closed</option></select></article>)}</div></section>
      <section id="stores" className="dash-section"><div className="dash-section-head stores-head"><div><span className="eyebrow">The network</span><h2>All stores</h2></div><label className="search-box"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stores or WhatsApp" /></label></div><div className="store-admin-grid">{stores.map((store) => { const billing = daysLeft(store); const installation = (data as any).installations?.[store.id]; return <article className="store-admin-card" key={store.id}><div className="store-card-top"><div className="store-avatar">{store.logo_url ? <img src={store.logo_url} alt="" /> : <span>{store.name[0]}</span>}</div><div><h3>{store.name}</h3><a href={storeLink(store.slug)} target="_blank" rel="noreferrer">{storeDomain(store.slug)} <ExternalLink /></a><span className={`install-status ${installation?.notifications_enabled ? 'ready' : ''}`}>{installation?.notifications_enabled ? 'App + alerts ready' : installation?.installed ? 'App installed · alerts off' : 'App not installed'}</span></div><div className="billing-control"><button className={`power-toggle ${store.is_active ? 'on' : ''}`} onClick={() => toggle(store)} aria-label={`Turn ${store.name} ${store.is_active ? 'off' : 'on'}`}><Power /><span>{store.is_active ? 'ON' : 'OFF'}</span></button><small className={billing.tone}>{billing.label}</small></div></div><div className="store-stats"><div><strong>{store.visitor_total.toLocaleString()}</strong><span>Visits <small>+{store.visitor_today} today</small></span></div><div><strong>{store.orders_total.toLocaleString()}</strong><span>WhatsApp <small>+{store.orders_today} today</small></span></div><div><strong>{(data as any).productCounts?.[store.id] || 0}</strong><span>Products live</span></div></div><div className="store-card-actions"><Link className="manage-button" to={`/manage/${store.id}`}>Manage store <ChevronRight /></Link><button className="json-button-admin details-button" onClick={() => setEditStore(store)} aria-label={`Edit ${store.name} details`}><Settings2 /></button><button className="json-button-admin" onClick={() => setStorefrontStore(store)} aria-label={`Edit storefront HTML for ${store.name}`} title="Edit storefront HTML"><FileCode2 /></button><button className="json-button-admin delete-store-button" onClick={() => setDeletingStore(store)} aria-label={`Delete ${store.name} completely`}><Trash2 /></button></div></article>; })}</div></section>
    </>}
  </main>{newStore && <NewStoreModal onClose={() => setNewStore(false)} onSaved={async () => { setNewStore(false); await load(); }} />}{editStore && <EditStoreModal store={editStore} onClose={() => setEditStore(null)} onSaved={async () => { setEditStore(null); await load(); }} />}{storefrontStore && <StorefrontEditor store={storefrontStore} onClose={() => setStorefrontStore(null)} onSaved={async () => { setStorefrontStore(null); await load(); }} />}{notifications && <NotificationReview stores={data?.stores || []} onClose={() => setNotifications(false)} />}{deletingStore && <DeleteStoreModal store={deletingStore} onClose={() => setDeletingStore(null)} onSaved={async () => { setDeletingStore(null); await load(); }} />}</div>;
}

function Metric({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: number; note: string }) { return <article className="metric-card"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value.toLocaleString()}</strong><small>{note}</small></article>; }
function DashboardSkeleton() { return <div className="dashboard-skeleton"><div /><div /><div /><div /><span /><span /></div>; }

// ---------------------------------------------------------------------------
//  New store: create the row, default storefront HTML is filled in by the server
// ---------------------------------------------------------------------------
function NewStoreModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', owner_password: '', whatsapp: '+254', categories: '' });
  const [logo, setLogo] = useState<File | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!form.name.trim()) return setError('Store name is required.');
    if (!/^\+?[0-9\s-]{10,18}$/.test(form.whatsapp)) return setError('Add a valid owner WhatsApp number, including the country code.');
    if (form.owner_password.length < 8) return setError('Temporary password must be at least 8 characters.');
    setBusy(true);
    try {
      let logo_url = ''; if (logo) logo_url = (await uploadImage(logo, 'logos')).url;
      const created = await apiFetch<{ id: number }>('/api/stores', { method: 'POST', body: JSON.stringify({ ...form, logo_url, categories: form.categories.split(',').map((item) => item.trim()).filter(Boolean) }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create store.');
    } finally { setBusy(false); }
  };
  return <Modal title="Create a new store" onClose={onClose} wide><form className="admin-form" onSubmit={submit}><div className="form-grid">
    <label>Store name<input value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Lily" /><small>Subdomain preview: {storeDomain(form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'store')}</small></label>
    <label>Owner WhatsApp number<input type="tel" value={form.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} placeholder="+254 7..." /><small>This is the owner's login name and order number.</small></label>
    <label>Temporary password<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={form.owner_password} onChange={(event) => update('owner_password', event.target.value)} placeholder="At least 8 characters" /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
    <label className="span-two">Product categories<input value={form.categories} onChange={(event) => update('categories', event.target.value)} placeholder="Fashion, Shoes, Accessories" /><small>Separate each category with a comma.</small></label>
    <label className="upload-label span-two"><span>Store logo</span><input type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => setLogo(event.target.files?.[0] || null)} /><div><Box /> {logo ? logo.name : 'Choose from device or gallery'}</div></label>
  </div>
  <p className="form-intro" style={{ marginTop: 12 }}>The new store gets a safe starter storefront (warm earth tones, system fonts, WhatsApp ordering) automatically. Click the <FileCode2 /> button on its card to paste your own HTML or use the AI prompt.</p>
  {error && <div className="form-error">{error}</div>}
  <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? 'Building store…' : 'Create store and owner login'} <Plus /></button></div></form></Modal>;
}

// ---------------------------------------------------------------------------
//  Edit store details
// ---------------------------------------------------------------------------
function EditStoreModal({ store, onClose, onSaved }: { store: Store; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: store.name, whatsapp: store.whatsapp, categories: (store.categories || []).join(', '), owner_password: '' });
  const [logo, setLogo] = useState<File | null>(null); const [showPassword, setShowPassword] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const update = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (form.name.trim().length < 2) return setError('Add a valid store name.');
    if (!/^\+?[0-9\s-]{10,18}$/.test(form.whatsapp)) return setError('Add a valid WhatsApp number.');
    if (form.owner_password && form.owner_password.length < 8) return setError('A new password must be at least 8 characters.');
    setBusy(true);
    try {
      let logo_url = store.logo_url; if (logo) logo_url = (await uploadImage(logo, 'logos')).url;
      await apiFetch('/api/stores', { method: 'PUT', body: JSON.stringify({ action: 'details', id: store.id, name: form.name, whatsapp: form.whatsapp, owner_password: form.owner_password, logo_url, categories: form.categories.split(',').map((item) => item.trim()).filter(Boolean) }) });
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not update the store.'); } finally { setBusy(false); }
  };
  return <Modal title={`Edit store details: ${store.name}`} onClose={onClose} wide><form className="admin-form" onSubmit={submit}><div className="form-grid">
    <label>Store name<input value={form.name} onChange={(event) => update('name', event.target.value)} /><small>Changing the name also updates the store subdomain. The old link remains supported.</small></label>
    <label>Owner WhatsApp number<input type="tel" value={form.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} /><small>This is used for owner login and customer orders.</small></label>
    <label className="span-two">Product categories<input value={form.categories} onChange={(event) => update('categories', event.target.value)} placeholder="Jerseys, Hoodies, Perfumes" /></label>
    <label className="upload-label span-two"><span>Store logo</span><input type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => setLogo(event.target.files?.[0] || null)} /><div><Box /> {logo ? logo.name : store.logo_url ? 'Keep current logo or choose a replacement' : 'Choose a logo'}</div></label>
    <label className="span-two">Reset owner password, optional<div className="password-field"><input type={showPassword ? 'text' : 'password'} value={form.owner_password} onChange={(event) => update('owner_password', event.target.value)} placeholder="Leave blank to keep the current password" /><button type="button" onClick={() => setShowPassword((show) => !show)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff /> : <Eye />}</button></div></label>
  </div>
  {error && <div className="form-error">{error}</div>}
  <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="button-primary" disabled={busy}>{busy ? 'Saving changes…' : 'Save store details'} <Check /></button></div></form></Modal>;
}

// ---------------------------------------------------------------------------
//  Storefront HTML editor — paste one self-contained HTML file, see the
//  rendered preview live, copy the AI prompt to ask for a better design.
// ---------------------------------------------------------------------------
function StorefrontEditor({ store, onClose, onSaved }: { store: Store; onClose: () => void; onSaved: () => void }) {
  const [html, setHtml] = useState<string>(String((store as any).storefront_template || ''));
  const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [promptText, setPromptText] = useState<string>(''); const [promptCopied, setPromptCopied] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string>(''); const [previewing, setPreviewing] = useState(false);
  useEffect(() => {
    let alive = true;
    apiFetch<{ prompt: string }>(`/api/storefront?action=prompt&store_id=${store.id}`).then((res) => { if (alive) setPromptText(res.prompt); }).catch(() => undefined);
    return () => { alive = false; };
  }, [store.id]);
  const loadDefault = async () => {
    try { const res = await apiFetch<{ template: string }>('/api/storefront?action=default'); setHtml(res.template); setError(''); setSuccess('Loaded the safe starter template — edit it freely.'); window.setTimeout(() => setSuccess(''), 2500); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not load the starter template.'); }
  };
  const preview = async () => {
    if (!html.trim()) return setError('Paste the storefront HTML first.');
    setPreviewing(true); setError('');
    try { const res = await apiFetch<{ html: string; warnings?: string[] }>('/api/storefront?action=preview', { method: 'POST', body: JSON.stringify({ store_id: store.id, template: html }) }); setPreviewHtml(res.html); if (res.warnings?.length) setSuccess(`Rendered with note: ${res.warnings.join('; ')}`); else setSuccess('Rendered with your real products.'); window.setTimeout(() => setSuccess(''), 3000); }
    catch (err) { setError(err instanceof Error ? err.message : 'Preview failed.'); }
    finally { setPreviewing(false); }
  };
  const save = async () => {
    if (!html.trim()) return setError('Paste the storefront HTML first.');
    setSaving(true); setError('');
    try { await apiFetch('/api/storefront?action=save', { method: 'POST', body: JSON.stringify({ store_id: store.id, template: html }) }); onSaved(); }
    catch (err) {
      // Surface every detail line the API returned so the founder can fix the paste.
      const message = err instanceof Error ? err.message : 'Save failed.';
      const data = (err as any)?.details as string[] | undefined;
      setError(data?.length ? `${message}\n• ${data.join('\n• ')}` : message);
    } finally { setSaving(false); }
  };
  const copyPrompt = async () => { try { await navigator.clipboard.writeText(promptText); setPromptCopied(true); window.setTimeout(() => setPromptCopied(false), 2200); } catch { window.prompt('Copy this prompt manually:', promptText); } };
  return <Modal title={`Storefront HTML: ${store.name}`} onClose={onClose} wide><div className="storefront-editor-body">
    <p className="form-intro"><b>Paste one self-contained HTML file</b> — your nav, hero, product grid, popup, all inline. The StoYangu app duplicates the <code>.product-card</code> block for each real product and stamps the store name + WhatsApp number into a small <code>&lt;meta&gt;</code> your inline JS reads. Live preview on the right uses the first 6 real products.</p>
    <div className="storefront-editor-toolbar">
      <button type="button" className="secondary-button" onClick={loadDefault}>Load starter template</button>
      <button type="button" className="secondary-button" onClick={copyPrompt} disabled={!promptText}><Sparkles /> {promptCopied ? 'AI prompt copied!' : 'Get AI prompt'}</button>
      <a className="secondary-button" href={`/s/${store.slug}?fresh=1`} target="_blank" rel="noreferrer"><ExternalLink /> Open live store</a>
    </div>
    <div className="storefront-editor-grid">
      <div className="storefront-editor-pane">
        <h3><FileCode2 /> HTML template</h3>
        <textarea className="code-input storefront-editor-textarea" value={html} onChange={(event) => { setHtml(event.target.value); setError(''); }} spellCheck={false} placeholder="<!doctype html>&#10;<html>...&#10;</html>" />
      </div>
      <div className="storefront-editor-pane">
        <h3>Live preview <small>(first 6 real products)</small></h3>
        {previewHtml ? <iframe title="Storefront preview" className="storefront-editor-iframe" sandbox="allow-scripts" srcDoc={previewHtml} /> : <div className="storefront-editor-placeholder">Click <b>Preview</b> to render your template with the live product list.</div>}
      </div>
    </div>
    {success && <div className="form-success">{success}</div>}
    {error && <div className="form-error" style={{ whiteSpace: 'pre-wrap' }}>{error}</div>}
    <div className="modal-actions">
      <button type="button" className="secondary-button" onClick={onClose}>Close</button>
      <button type="button" className="secondary-button" onClick={preview} disabled={previewing || !html.trim()}>{previewing ? 'Rendering…' : 'Preview'} <Eye /></button>
      <button className="button-primary" onClick={save} disabled={saving || !html.trim()}>{saving ? 'Saving…' : 'Save storefront'} <Check /></button>
    </div>
  </div></Modal>;
}

// ---------------------------------------------------------------------------
//  Delete store
// ---------------------------------------------------------------------------
function DeleteStoreModal({ store, onClose, onSaved }: { store: Store; onClose: () => void; onSaved: () => void }) {
  const [confirmName, setConfirmName] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const matches = confirmName.trim().toLowerCase() === store.name.trim().toLowerCase();
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    if (!matches) return setError(`Type ${store.name} exactly as shown to confirm the delete.`);
    setBusy(true);
    try {
      await apiFetch('/api/stores', { method: 'DELETE', body: JSON.stringify({ id: store.id }) });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete the store.');
      setBusy(false);
    }
  };
  return <Modal title={`Delete store: ${store.name}`} onClose={onClose}><form className="form-stack" onSubmit={submit}><div className="delete-warning"><Trash2 /><div><strong>This deletes everything about the store, forever.</strong><p>All products, photos, stats, the owner's login and the store itself will be removed. The subdomain <b>{storeDomain(store.slug)}</b> immediately becomes free, so you can create a brand-new store on that exact address. This cannot be undone.</p></div></div><label>Type <b>{store.name}</b> to confirm<input value={confirmName} onChange={(event) => setConfirmName(event.target.value)} placeholder={store.name} autoFocus /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Keep store</button><button className="button-primary danger-primary" disabled={busy || !matches}>{busy ? 'Deleting store…' : 'Delete store forever'} <Trash2 /></button></div></form></Modal>;
}

// ---------------------------------------------------------------------------
//  Notification review (unchanged)
// ---------------------------------------------------------------------------
function NotificationReview({ stores, onClose }: { stores: Store[]; onClose: () => void }) {
  const [combined, setCombined] = useState(''); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [customTitle, setCustomTitle] = useState(''); const [customBody, setCustomBody] = useState(''); const [customBusy, setCustomBusy] = useState(false);
  const [sendAll, setSendAll] = useState(true); const [selectedStores, setSelectedStores] = useState<number[]>([]);
  const generate = async () => { setBusy(true); setMessage(''); try { const res = await apiFetch<{ text: string }>('/api/notifications?action=generate', { method: 'POST' }); setCombined(res.text); } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not generate.'); } finally { setBusy(false); } };
  useEffect(() => { if (!combined) generate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const copy = async () => { try { await navigator.clipboard.writeText(combined); setMessage('Copied to clipboard.'); } catch { setMessage('Could not copy — select the text and copy manually.'); } };
  const confirm = async () => { setBusy(true); setMessage(''); try { await apiFetch('/api/notifications?action=confirm', { method: 'POST', body: JSON.stringify({ text: combined }) }); setMessage('Confirmed for 7:30 PM Kenya time.'); } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not confirm.'); } finally { setBusy(false); } };
  const sendCustom = async () => { if (!customTitle.trim() || !customBody.trim()) { setMessage('Add a title and message first.'); return; } setCustomBusy(true); setMessage(''); try { const recipient_store_ids = sendAll ? stores.map((store) => store.id) : selectedStores; await apiFetch('/api/notifications?action=custom', { method: 'POST', body: JSON.stringify({ title: customTitle, body: customBody, recipient_store_ids }) }); setMessage(`Custom notification sent to ${recipient_store_ids.length} store(s).`); setCustomTitle(''); setCustomBody(''); } catch (err) { setMessage(err instanceof Error ? err.message : 'Could not send.'); } finally { setCustomBusy(false); } };
  return <Modal title="Notification centre" onClose={onClose} wide><div className="review-toolbar"><p><b>Daily review:</b> edit at 7 PM, then confirm. Confirmed messages wait and send at exactly <b>7:30 PM Kenya time</b>.</p><button className="secondary-button" onClick={copy} disabled={!combined}><Clipboard /> Copy all</button></div>{busy && !combined ? <div className="review-loading"><RefreshCw className="spin" /> Building each store summary…</div> : <textarea className="notification-editor" value={combined} onChange={(event) => setCombined(event.target.value)} spellCheck={false} />}{message && <div className={message.includes('Confirmed') || message.includes('sent') || message.includes('copied') ? 'form-success' : 'form-error'}>{message}</div>}<div className="modal-actions"><button className="secondary-button" onClick={generate} disabled={busy}><RefreshCw /> Regenerate</button><button className="button-primary" onClick={confirm} disabled={busy || !combined}><CalendarClock /> Confirm for 7:30 PM</button></div><section className="custom-push-box"><span className="eyebrow">Send a separate message</span><h3>Custom app notification</h3><p>Send a short update to every installed owner or only the accounts you choose.</p><div className="form-grid"><label>Notification title<input value={customTitle} maxLength={80} onChange={(event) => setCustomTitle(event.target.value)} placeholder="e.g. New product tip" /></label><label className="span-two">Message<textarea rows={4} maxLength={800} value={customBody} onChange={(event) => setCustomBody(event.target.value)} placeholder="Write the message owners should receive…" /></label></div><div className="recipient-choice"><button className={sendAll ? 'active' : ''} onClick={() => setSendAll(true)}>All installed owners</button><button className={!sendAll ? 'active' : ''} onClick={() => setSendAll(false)}>Choose accounts</button></div>{!sendAll && <div className="store-recipient-grid">{stores.map((store) => <label key={store.id}><input type="checkbox" checked={selectedStores.includes(store.id)} onChange={() => setSelectedStores((current) => current.includes(store.id) ? current.filter((id) => id !== store.id) : [...current, store.id])} /><span><strong>{store.name}</strong><small>{store.owner_name}</small></span></label>)}</div>}<button className="button-primary custom-send" onClick={sendCustom} disabled={customBusy}>{customBusy ? 'Sending…' : <><Send /> Send custom notification</>}</button></section></Modal>;
}
