import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, ImagePlus, Package, Save, Send, Video, X } from 'lucide-react';
import Modal from './Modal';
import SequentialCamera from './SequentialCamera';
import { OptionPicker } from './ProductForm';
import { apiFetch, uploadImage, uploadPostMedia } from '../lib/api';
import { buildProductCaption } from '../lib/caption';
import { readDraft, writeDraft } from '../lib/draftStorage';
import type { Product, SocialConnection } from '../types';
type Media = { file: File; url: string; kind: 'image' | 'video' };
type Result = { draft: boolean; results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };
type Props = { storeId: number; storeName: string; storeSlug: string; locked?: boolean; onClose: () => void; onPosted: () => void; onProductsChanged?: () => void };
export default function PostComposer({ storeId, storeName, storeSlug, locked = false, onClose, onPosted, onProductsChanged }: Props) {
  const [step, setStep] = useState<'video' | 'photo' | 'details'>('video');
  const [media, setMedia] = useState<Media[]>([]);
  const [name, setName] = useState(''); const [price, setPrice] = useState('');
  const [hasColors, setHasColors] = useState(false); const [colors, setColors] = useState<string[]>([]); const [customColor, setCustomColor] = useState('');
  const [hasSizes, setHasSizes] = useState(false); const [sizes, setSizes] = useState<string[]>([]); const [customSize, setCustomSize] = useState('');
  const [note, setNote] = useState('');
  const [ready, setReady] = useState(false); const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [draftNotice, setDraftNotice] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(true); const [connectionError, setConnectionError] = useState('');
  const videoInput = useRef<HTMLInputElement>(null); const photoInput = useRef<HTMLInputElement>(null);
  const urls = useRef(new Set<string>()); const uploads = useRef(new Map<File, { url: string; kind: 'image' | 'video' }>());
  const productId = useRef<number | null>(null); const submitting = useRef(false); const completed = useRef(false);
  const draftKey = `store-${storeId}`;
  const photos = media.filter(item => item.kind === 'image'); const video = media.find(item => item.kind === 'video');
  const tags = `#stoyangu #${(storeSlug || storeName).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'}`;
  const caption = useMemo(() => buildProductCaption({ name, price, colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], note }), [name, price, colors, sizes, hasColors, hasSizes, note]);
  const loadConnections = useCallback(async () => {
    setConnectionLoading(true); setConnectionError('');
    try { const data = await apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`); setConnections(data.connections.filter(c => c.connection_status === 'connected')); }
    catch (e) { setConnectionError(e instanceof Error ? e.message : 'Unable to check accounts.'); }
    finally { setConnectionLoading(false); }
  }, [storeId]);
  useEffect(() => { void loadConnections(); }, [loadConnections]);
  useEffect(() => {
    let alive = true;
    readDraft(draftKey).then(draft => {
      if (!alive || !draft || Date.now() - draft.savedAt > 7 * 86400000) return;
      setName(draft.name); setPrice(draft.price); setColors(draft.colors); setSizes(draft.sizes); setHasColors(draft.hasColors); setHasSizes(draft.hasSizes); setNote(draft.note); setStep(draft.step);
      setMedia(draft.files.filter(file => file instanceof Blob).map(file => { const url = URL.createObjectURL(file); urls.current.add(url); return { file, url, kind: file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name) ? 'video' : 'image' }; }));
    }).catch(() => { if (alive) setDraftNotice('Automatic draft recovery is unavailable in this browser.'); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [draftKey]);
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); }, []);
  useEffect(() => {
    if (!ready || completed.current) return;
    const timer = window.setTimeout(() => { void writeDraft(draftKey, { step, name, price, colors, sizes, hasColors, hasSizes, note, files: media.map(m => m.file), savedAt: Date.now() }).catch(() => setDraftNotice('Draft recovery is unavailable. Keep this window open until you save.')); }, 300);
    return () => window.clearTimeout(timer);
  }, [draftKey, ready, step, name, price, colors, sizes, hasColors, hasSizes, note, media]);
  const addPhotos = (files: File[]) => {
    setError('');
    const accepted = files.filter(file => file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|avif|heic|heif)$/i.test(file.name));
    if (accepted.length !== files.length) setError('Choose image files only.');
    if (accepted.some(file => file.size > 15 * 1024 * 1024)) { setError('Each photo must be under 15 MB.'); return; }
    const room = Math.max(0, 7 - photos.length);
    if (accepted.length > room) setError('Up to 7 photos per product. Extra photos were not added.');
    const next: Media[] = accepted.slice(0, room).map(file => { const url = URL.createObjectURL(file); urls.current.add(url); return { file, url, kind: 'image' }; });
    setMedia(current => [...current, ...next]);
  };
  const chooseVideo = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name)) { setError('Choose an MP4, MOV or WebM video.'); return; }
    if (file.size > 75 * 1024 * 1024) { setError('Keep your video under 75 MB.'); return; }
    setError('');
    if (video) { URL.revokeObjectURL(video.url); urls.current.delete(video.url); }
    const url = URL.createObjectURL(file); urls.current.add(url);
    setMedia(current => [{ file, url, kind: 'video' }, ...current.filter(item => item.kind !== 'video')]); setStep('photo');
  };
  const removeMedia = (item: Media) => { URL.revokeObjectURL(item.url); urls.current.delete(item.url); setMedia(current => current.filter(m => m !== item)); };
  const toggle = (item: string, selected: string[], setter: (items: string[]) => void) => setter(selected.includes(item) ? selected.filter(value => value !== item) : [...selected, item]);
  const addCustom = (type: 'color' | 'size') => { const v = (type === 'color' ? customColor : customSize).trim().slice(0, 40); if (!v) return; if (type === 'color') { setColors([...new Set([...colors, v])]); setCustomColor(''); } else { setSizes([...new Set([...sizes, v])]); setCustomSize(''); } };
  const submit = async (asDraft: boolean) => {
    if (submitting.current) return;
    setError('');
    if (locked) { setError('Renew your store plan to add products. Existing products remain live.'); return; }
    if (!photos.length) { setError('Add at least one product photo.'); return; }
    if (name.trim().length < 2) { setError('Enter a product name of at least 2 characters.'); return; }
    if (!Number.isFinite(Number(price)) || Number(price) < 1) { setError('Enter a price of at least KES 1.'); return; }
    if (!asDraft && !connections.length) { setError('Connect an account in Inbox → Accounts, or save this as a draft.'); return; }
    if ((caption + '\n\n' + tags).length > 2200) { setError('Shorten your note to keep the caption under 2,200 characters.'); return; }
    submitting.current = true; setBusy('Uploading media…');
    try {
      const attached = await Promise.all(media.map(async item => {
        const saved = uploads.current.get(item.file); if (saved) return saved;
        const uploaded = item.kind === 'video' ? await uploadPostMedia(item.file) : { ...(await uploadImage(item.file, 'products')), kind: 'image' as const };
        uploads.current.set(item.file, uploaded); return uploaded;
      }));
      if (!asDraft) {
        setBusy('Saving product…');
        const images = attached.filter(item => item.kind === 'image').map(item => item.url);
        const saved = await apiFetch<Product>('/api/products', { method: productId.current ? 'PUT' : 'POST', body: JSON.stringify({ ...(productId.current ? { id: productId.current } : {}), store_id: storeId, name: name.trim(), price: Number(price), colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], images, image_url: images[0] }) });
        productId.current = saved.id; onProductsChanged?.();
        await apiFetch(`/api/products?storeId=${storeId}`);
      }
      setBusy(asDraft ? 'Saving draft…' : 'Sending to accounts…');
      const response = await apiFetch<{ results?: Result['results'] }>('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: asDraft ? 'save_draft' : 'publish', store_id: storeId, caption: `${caption}\n\n${tags}`, media_urls: attached.map(a => a.url), media_kinds: attached.map(a => a.kind) }) });
      await apiFetch(`/api/media?action=social&op=posts&storeId=${storeId}`);
      completed.current = true;
      await writeDraft(draftKey, null).catch(() => undefined);
      setResult({ draft: asDraft, results: response.results || {} }); onPosted();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save. Your draft is still here.'); }
    finally { submitting.current = false; setBusy(''); }
  };
  const recap = media.length ? <div className="composer-recap"><div className="composer-tiktok-strip media-grid-v12" role="list" aria-label="Post media">{media.map((item, index) => <div key={item.url} role="listitem" className={`composer-tiktok-cell ${index === 0 ? 'lead' : ''}`}>{item.kind === 'video' ? <video src={item.url} muted playsInline preload="metadata" /> : <img src={item.url} alt={`Product photo ${media.filter((m, i) => m.kind === 'image' && i <= index).length}`} />}{index === 0 && <small>{item.kind === 'video' ? 'Video' : 'Cover photo'}</small>}{item.kind === 'video' && <span className="composer-video-tag"><Video /></span>}<button type="button" onClick={() => removeMedia(item)} disabled={!!busy} aria-label={item.kind === 'video' ? 'Remove video' : `Remove photo ${media.filter((m, i) => m.kind === 'image' && i <= index).length}`}><X /></button></div>)}</div></div> : null;
  const allSucceeded = result && Object.values(result.results).every(r => r.ok) && Object.keys(result.results).length > 0;
  return <Modal title="Post once, everywhere" onClose={() => { if (!busy) onClose(); }} wide><div className="composer-body composer-v12">
    <div className="composer-progress composer-progress-3" aria-label="Post progress"><span className={step === 'video' ? 'active' : 'done'}>1 · Video</span><span className={step === 'photo' ? 'active' : step === 'details' ? 'done' : ''}>2 · Photos</span><span className={step === 'details' ? 'active' : ''}>3 · Details</span></div>
    {!ready ? <p role="status">Restoring your draft…</p> : result ? <div className="composer-result"><div className="result-check"><Check /></div><h3>{result.draft ? 'Draft saved' : allSucceeded ? 'Your post is queued' : 'Check your post results'}</h3><p>{result.draft ? 'Saved securely to your store. Nothing was published to social media.' : 'Your product is saved in your store. Social delivery status is shown below.'}</p><div className="composer-result-list">{Object.entries(result.results).map(([platform, r]) => <div key={platform} className={`composer-result-row ${r.ok ? 'ok' : 'fail'}`}><strong>{platform}</strong><small>{r.ok ? 'Accepted for publishing' : r.error || 'Not sent'}</small>{r.ok ? <Check /> : <X />}</div>)}</div><div className="modal-actions"><button className="button-primary" onClick={onClose}>Done <Check /></button></div></div> : <>
      {step === 'video' && <div className="composer-block composer-media-first"><strong><Video /> Add a video</strong><p className="composer-hint">Optional · pick from your gallery. Up to 75 MB.</p>{recap}<div className="composer-media-actions"><button className="button-primary compact" onClick={() => videoInput.current?.click()}><ImagePlus />{video ? 'Change video' : 'Choose video'}</button><button className="secondary-button compact-upload" onClick={() => setStep('photo')}>Skip <ArrowRight size={16} /></button></div></div>}
      {step === 'photo' && <div className="composer-block composer-media-first"><div className="composer-section-heading"><strong><ImagePlus /> Add photos</strong><span>{photos.length}/7</span></div><p className="composer-hint">1–7 photos. Your video stays first.</p>{recap}<div className="composer-media-actions"><button className="button-primary compact" onClick={() => setCameraOpen(true)} disabled={photos.length >= 7}><Camera /> Camera</button><button className="secondary-button compact-upload" onClick={() => photoInput.current?.click()} disabled={photos.length >= 7}><ImagePlus /> Gallery</button></div><div className="modal-actions composer-navigation"><button className="secondary-button" onClick={() => setStep('video')}><ArrowLeft /> Back</button><button className="button-primary" onClick={() => setStep('details')} disabled={!photos.length}>Continue <ArrowRight /></button></div></div>}
      {step === 'details' && <><div className="composer-block"><strong><Package /> Product details</strong>{recap}<div className="composer-details-box"><div className="form-grid"><label>Product name<input maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Home jersey" disabled={!!busy} /></label><label>Price (KES)<input type="number" inputMode="decimal" min="1" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 2800" disabled={!!busy} /></label></div></div><OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold']} selected={colors} onToggle={item => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} /><OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42']} selected={sizes} onToggle={item => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} /></div><div className="composer-caption"><label htmlFor="caption-note">Your own words <span className="optional-label">(optional)</span></label><textarea id="caption-note" value={note} onChange={e => setNote(e.target.value)} maxLength={1400} rows={2} placeholder="Add a personal note or delivery details…" disabled={!!busy} /><div className="composer-section-heading"><label htmlFor="live-caption">Caption</label><span className="caption-live"><span /> Updates live</span></div><div className="caption-locked-box"><textarea id="live-caption" aria-label="Auto-filled caption" value={caption} readOnly rows={Math.min(7, caption.split('\n').length + 1)} /><div className="caption-locked-tags"><b>#stoyangu</b><b>{tags.split(' ')[1]}</b></div></div><small>{caption.length + tags.length + 2} / 2200</small></div>{connectionLoading ? <small className="composer-hint">Checking connected accounts…</small> : connectionError ? <div className="form-error">{connectionError} <button onClick={loadConnections}>Retry</button></div> : <small className="composer-hint">{connections.length ? `Posts to ${connections.length} connected account${connections.length !== 1 ? 's' : ''}.` : 'Connect accounts in Inbox → Accounts to publish. You can save a draft now.'}</small>}<div className="modal-actions composer-navigation"><button className="secondary-button" onClick={() => setStep('photo')} disabled={!!busy}><ArrowLeft /> Back</button><div className="composer-submit-actions"><button className="secondary-button" onClick={() => submit(true)} disabled={!!busy || locked}><Save /> Save draft</button><button className="button-primary" onClick={() => submit(false)} disabled={!!busy || locked || connectionLoading}><Send /> Post</button></div></div></>}
      {busy && <div className="form-success" role="status">{busy}</div>}{error && <div className="form-error" role="alert">{error}</div>}{draftNotice && <small className="composer-hint">{draftNotice}</small>}
    </>}
  </div>{cameraOpen && <SequentialCamera room={7 - photos.length} onClose={() => setCameraOpen(false)} onUse={files => { addPhotos(files); setCameraOpen(false); setStep('details'); }} />}<input ref={videoInput} hidden type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.3gp" onChange={e => { chooseVideo(e.target.files?.[0]); e.target.value = ''; }} /><input ref={photoInput} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={e => { addPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} /></Modal>;
}
