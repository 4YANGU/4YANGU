import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, Copy, ImagePlus, Package, Send, Video, X } from 'lucide-react';
import Modal from './Modal';
import SequentialCamera from './SequentialCamera';
import { OptionPicker } from './ProductForm';
import { apiFetch, storeLink, uploadImage, uploadPostMedia } from '../lib/api';
import { buildProductCaption } from '../lib/caption';
import { readDraft, writeDraft } from '../lib/draftStorage';
import { isStoYanguAndroid, openWhatsAppWithVideo } from '../lib/nativeShare';
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
  const [captionOverride, setCaptionOverride] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
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
  const tags = `#${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'} #${(storeSlug || storeName).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'}`;
  const generatedCaption = useMemo(() => buildProductCaption({ name, price, colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [] }), [name, price, colors, sizes, hasColors, hasSizes]);
  const caption = captionOverride ?? generatedCaption;
  const previousCaption = useRef(generatedCaption);
  useEffect(() => {
    const oldLines = previousCaption.current.split('\n').filter(line => /^(Colours|Sizes):/i.test(line));
    const newLines = generatedCaption.split('\n').filter(line => /^(Colours|Sizes):/i.test(line));
    if (previousCaption.current !== generatedCaption) setCaptionOverride(current => {
      if (current === null) return null;
      let updated = current;
      for (const oldLine of oldLines) {
        const replacement = newLines.find(line => line.split(':')[0] === oldLine.split(':')[0]);
        if (updated.includes(oldLine)) updated = updated.replace(oldLine, replacement || '').trim();
      }
      for (const line of newLines) if (!updated.split('\n').some(existing => existing.startsWith(`${line.split(':')[0]}:`))) updated = [updated, line].filter(Boolean).join('\n');
      return updated;
    });
    previousCaption.current = generatedCaption;
  }, [generatedCaption]);
  const fullCaption = `${caption}\n\n${tags}\n${storeLink(storeSlug)}`;
  const copyCaption = async () => {
    try { await navigator.clipboard.writeText(fullCaption); setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
    catch { window.prompt('Copy your caption:', fullCaption); }
  };
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
      setName(draft.name); setPrice(draft.price); setColors(draft.colors); setSizes(draft.sizes); setHasColors(draft.hasColors); setHasSizes(draft.hasSizes); setCaptionOverride(draft.caption ? [draft.caption, draft.variantCaption].filter(Boolean).join('\n') : null); productId.current = draft.productId || null; setStep(draft.step);
      setMedia(draft.files.filter(file => file instanceof Blob).map(file => { const url = URL.createObjectURL(file); urls.current.add(url); return { file, url, kind: file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name) ? 'video' : 'image' }; }));
    }).catch(() => { if (alive) setDraftNotice('Automatic draft recovery is unavailable in this browser.'); }).finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, [draftKey]);
  useEffect(() => () => { urls.current.forEach(URL.revokeObjectURL); }, []);
  useEffect(() => {
    if (!ready || completed.current) return;
    const snapshot = () => ({ step, name, price, colors, sizes, hasColors, hasSizes, note: '', caption: captionOverride, productId: productId.current, files: media.map(m => m.file), savedAt: Date.now() });
    const save = () => { if (!completed.current) void writeDraft(draftKey, snapshot()).catch(() => setDraftNotice('Draft recovery is unavailable. Keep this window open until you post.')); };
    const onHidden = () => { if (document.visibilityState === 'hidden') save(); };
    const timer = window.setTimeout(save, 150);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHidden);
    return () => { window.clearTimeout(timer); window.removeEventListener('pagehide', save); document.removeEventListener('visibilitychange', onHidden); };
  }, [draftKey, ready, step, name, price, colors, sizes, hasColors, hasSizes, captionOverride, media]);
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
    if (!asDraft && !connections.length) { setError('Connect an account in My Customers → Accounts to publish.'); return; }
    if ((caption + '\n\n' + tags).length > 2200) { setError('Shorten the caption to keep the post under 2,200 characters.'); return; }
    // Must run from the tap gesture: browsers do not permit file sharing after async uploads.
    if (!asDraft && isStoYanguAndroid()) void navigator.clipboard?.writeText(fullCaption).catch(() => undefined);
    if (!asDraft && !isStoYanguAndroid() && video && navigator.canShare?.({ files: [video.file] })) {
      void navigator.share({ files: [video.file], title: `${storeName} status`, text: fullCaption }).catch(() => undefined);
    }
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
        const saved = await apiFetch<Product>('/api/products', { method: productId.current ? 'PUT' : 'POST', body: JSON.stringify({ ...(productId.current ? { id: productId.current } : {}), store_id: storeId, name: name.trim(), price: Number(price), colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], images, image_url: images[0], video_url: attached.find(item => item.kind === 'video')?.url || '' }) });
        productId.current = saved.id; onProductsChanged?.();
        await writeDraft(draftKey, { step, name, price, colors, sizes, hasColors, hasSizes, note: '', caption: captionOverride, productId: saved.id, files: media.map(m => m.file), savedAt: Date.now() }).catch(() => undefined);
      }
      setBusy(asDraft ? 'Saving draft…' : 'Sending to accounts…');
      const publishing = apiFetch<{ results?: Result['results'] }>('/api/media?action=social', { method: 'POST', body: JSON.stringify({ op: asDraft ? 'save_draft' : 'publish', store_id: storeId, caption: `${caption}\n\n${tags}`, media_urls: attached.map(a => a.url), media_kinds: attached.map(a => a.kind) }) });
      const uploadedVideo = attached.find(item => item.kind === 'video')?.url;
      if (!asDraft && uploadedVideo && isStoYanguAndroid()) void openWhatsAppWithVideo(uploadedVideo, fullCaption).catch(reason => setError(reason instanceof Error ? reason.message : 'Could not open WhatsApp. Your caption has been copied.'));
      const response = await publishing;
      completed.current = true;
      await writeDraft(draftKey, null).catch(() => undefined);
      setResult({ draft: asDraft, results: response.results || {} }); onPosted();
      if (!asDraft && Object.values(response.results || {}).some(result => result.ok) && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Post accepted', { body: 'Your connected accounts accepted the post. Check each result for story and feed delivery.', icon: '/favicon-192.png' });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to post. Your work is saved on this device; please retry.'); }
    finally { submitting.current = false; setBusy(''); }
  };
  const recap = media.length ? <div className="composer-recap"><div className="composer-tiktok-strip media-grid-v12" role="list" aria-label="Post media">{media.map((item, index) => <div key={item.url} role="listitem" className={`composer-tiktok-cell ${index === 0 ? 'lead' : ''}`}>{item.kind === 'video' ? <video src={item.url} muted playsInline preload="metadata" /> : <img src={item.url} alt={`Product photo ${media.filter((m, i) => m.kind === 'image' && i <= index).length}`} />}{index === 0 && <small>{item.kind === 'video' ? 'Video' : 'Cover photo'}</small>}{item.kind === 'video' && <span className="composer-video-tag"><Video /></span>}<button type="button" onClick={() => removeMedia(item)} disabled={!!busy} aria-label={item.kind === 'video' ? 'Remove video' : `Remove photo ${media.filter((m, i) => m.kind === 'image' && i <= index).length}`}><X /></button></div>)}</div></div> : null;
  const allSucceeded = result && Object.values(result.results).every(r => r.ok) && Object.keys(result.results).length > 0;
  return <Modal title="Post once, everywhere" onClose={() => { if (!busy) onClose(); }} wide><div className="composer-body composer-v12">
    <div className="composer-progress composer-progress-3" aria-label="Post progress"><span className={step === 'video' ? 'active' : 'done'}>1 · Video</span><span className={step === 'photo' ? 'active' : step === 'details' ? 'done' : ''}>2 · Photos</span><span className={step === 'details' ? 'active' : ''}>3 · Details</span></div>
    {!ready ? <p role="status">Restoring your draft…</p> : result ? <div className="composer-result"><div className="result-check"><Check /></div><h3>{result.draft ? 'Draft saved' : allSucceeded ? 'Your post is queued' : 'Check your post results'}</h3><p>{result.draft ? 'Saved securely to your store. Nothing was published to social media.' : 'Your product is saved in your store. Social delivery status is shown below.'}</p><div className="composer-result-list">{Object.entries(result.results).map(([platform, r]) => <div key={platform} className={`composer-result-row ${r.ok ? 'ok' : 'fail'}`}><strong>{platform}</strong><small>{r.ok ? 'Accepted for scheduling — check the platform' : r.error && r.error.trim().length > 2 ? r.error : 'The platform did not accept this post. Please retry.'}</small>{r.ok ? <Check /> : <X />}</div>)}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={copyCaption}><Copy size={16} />{copied ? "Copied!" : "Copy caption"}</button>{result.results["tiktok story"]?.ok === false && video && <button type="button" className="secondary-button" onClick={() => { if (navigator.canShare?.({ files: [video.file] })) void navigator.share({ files: [video.file], text: fullCaption }).catch(() => undefined); else window.alert("Save your video and share it to your TikTok Story manually."); }}>Share story manually</button>}<button className="button-primary" onClick={onClose}>Done <Check /></button></div></div> : <>
      {step === 'video' && <div className="composer-block composer-media-first"><strong><Video /> Add a video</strong><p className="composer-hint">Optional · pick from your gallery. Up to 75 MB.</p>{recap}<div className="composer-media-actions"><button className="button-primary compact" onClick={() => videoInput.current?.click()}><ImagePlus />{video ? 'Change video' : 'Choose video'}</button><button className="secondary-button compact-upload" onClick={() => setStep('photo')}>Skip <ArrowRight size={16} /></button></div></div>}
      {step === 'photo' && <div className="composer-block composer-media-first"><div className="composer-section-heading"><strong><ImagePlus /> Add photos</strong><span>{photos.length}/7</span></div><p className="composer-hint">1–7 photos. Your video stays first.</p>{recap}<div className="composer-media-actions"><button className="button-primary compact" onClick={() => setCameraOpen(true)} disabled={photos.length >= 7}><Camera /> Camera</button><button className="secondary-button compact-upload" onClick={() => photoInput.current?.click()} disabled={photos.length >= 7}><ImagePlus /> Gallery</button></div><div className="modal-actions composer-navigation"><button className="secondary-button" onClick={() => setStep('video')}><ArrowLeft /> Back</button><button className="button-primary" onClick={() => setStep('details')} disabled={!photos.length}>Continue <ArrowRight /></button></div></div>}
      {step === 'details' && <><div className="composer-block"><strong><Package /> Product details</strong>{recap}<div className="composer-details-box"><div className="form-grid"><label>Product name<input maxLength={120} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Home jersey" disabled={!!busy} /></label><label>Price (KES)<input type="number" inputMode="decimal" min="1" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 2800" disabled={!!busy} /></label></div></div><OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold']} selected={colors} onToggle={item => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} /><OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42']} selected={sizes} onToggle={item => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} /></div><div className="composer-caption"><div className="composer-section-heading"><label htmlFor="live-caption">Caption</label><button type="button" className="copy-caption-button" onClick={copyCaption}><Copy size={15} />{copied ? "Copied!" : "Copy caption"}</button></div><div className="caption-locked-box"><textarea id="live-caption" aria-label="Editable caption including colours and sizes" value={caption} onChange={e => setCaptionOverride(e.target.value)} rows={Math.min(9, caption.split('\n').length + 2)} /><div className="caption-locked-tags"><b>{tags.split(' ')[0]}</b><b>{tags.split(' ')[1]}</b><small>{storeLink(storeSlug)}</small></div></div><small>{caption.length + tags.length + 2} / 2200</small></div>{connectionLoading ? <small className="composer-hint">Checking connected accounts…</small> : connectionError ? <div className="form-error">{connectionError} <button onClick={loadConnections}>Retry</button></div> : connections.length ? null : <small className="composer-hint">Connect accounts in My Customers → Accounts to publish.</small>}<div className="modal-actions composer-navigation"><button className="secondary-button" onClick={() => setStep('photo')} disabled={!!busy}><ArrowLeft /> Back</button><div className="composer-submit-actions"><button className="button-primary" onClick={() => submit(false)} disabled={!!busy || locked || connectionLoading}><Send /> Post</button></div></div></>}
      {busy && <div className="form-success" role="status">{busy}</div>}{error && <div className="form-error" role="alert">{error}</div>}{draftNotice && <small className="composer-hint">{draftNotice}</small>}
    </>}
  </div>{cameraOpen && <SequentialCamera room={7 - photos.length} onClose={() => setCameraOpen(false)} onUse={files => { addPhotos(files); setCameraOpen(false); setStep('details'); }} />}<input ref={videoInput} hidden type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.3gp" onChange={e => { chooseVideo(e.target.files?.[0]); e.target.value = ''; }} /><input ref={photoInput} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={e => { addPhotos(Array.from(e.target.files || [])); e.target.value = ''; }} /></Modal>;
}
