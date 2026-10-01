import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, Copy, ImagePlus, MessageCircle, Package, Send, Video, X } from 'lucide-react';
import MediaCaptureSheet from './MediaCaptureSheet';
import { OptionPicker } from './ProductForm';
import { apiFetch, storeLink, uploadImage, uploadPostMedia } from '../lib/api';
import { buildProductCaption } from '../lib/caption';
import { readDraft, writeDraft } from '../lib/draftStorage';
import { pushBackHandler } from '../lib/backNavigation';
import type { Product, SocialConnection } from '../types';

type Media = { file: File; url: string; kind: 'image' | 'video' };
type Result = { draft: boolean; results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };
type Props = { storeId: number; storeName: string; storeSlug: string; locked?: boolean; onClose: () => void; onPosted: () => void; onProductsChanged?: () => void };

function fileKind(file: File): Media['kind'] | null {
  if (file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|gif|avif|heic|heif|bmp)$/i.test(file.name)) return 'image';
  if (file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name)) return 'video';
  return null;
}

export default function PostComposer({ storeId, storeName, storeSlug, locked = false, onClose, onPosted, onProductsChanged }: Props) {
  const [step, setStep] = useState<'media' | 'details'>('media');
  const [media, setMedia] = useState<Media[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [hasColors, setHasColors] = useState(false);
  const [colors, setColors] = useState<string[]>([]);
  const [customColor, setCustomColor] = useState('');
  const [hasSizes, setHasSizes] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);
  const [customSize, setCustomSize] = useState('');
  const [captionOverride, setCaptionOverride] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ready, setReady] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [connectionError, setConnectionError] = useState('');
  const urls = useRef(new Set<string>());
  const uploads = useRef(new Map<File, { url: string; kind: 'image' | 'video' }>());
  const productId = useRef<number | null>(null);
  const submitting = useRef(false);
  const completed = useRef(false);
  const draftKey = `store-${storeId}`;
  const photos = media.filter((item) => item.kind === 'image');
  const video = media.find((item) => item.kind === 'video');
  const tags = `#${storeName.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'} #${(storeSlug || storeName).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'}`;
  const generatedCaption = useMemo(() => buildProductCaption({ name, price, colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [] }), [name, price, colors, sizes, hasColors, hasSizes]);
  const caption = captionOverride ?? generatedCaption;
  const previousCaption = useRef(generatedCaption);

  const closeManually = useCallback(() => {
    if (busy) return;
    if (window.history.state?.stoyanguComposer) {
      window.history.replaceState({}, '', window.location.href);
    }
    onClose();
  }, [busy, onClose]);

  useEffect(() => {
    const oldLines = previousCaption.current.split('\n').filter((line) => /^(Colours|Sizes):/i.test(line));
    const newLines = generatedCaption.split('\n').filter((line) => /^(Colours|Sizes):/i.test(line));
    if (previousCaption.current !== generatedCaption) setCaptionOverride((current) => {
      if (current === null) return null;
      let updated = current;
      for (const oldLine of oldLines) {
        const replacement = newLines.find((line) => line.split(':')[0] === oldLine.split(':')[0]);
        if (updated.includes(oldLine)) updated = updated.replace(oldLine, replacement || '').trim();
      }
      for (const line of newLines) if (!updated.split('\n').some((existing) => existing.startsWith(`${line.split(':')[0]}:`))) updated = [updated, line].filter(Boolean).join('\n');
      return updated;
    });
    previousCaption.current = generatedCaption;
  }, [generatedCaption]);

  const fullCaption = `${caption}\n\n${tags}\n${storeLink(storeSlug)}`;
  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(fullCaption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      window.prompt('Copy your caption:', fullCaption);
    }
  };

  const loadConnections = useCallback(async () => {
    setConnectionLoading(true);
    setConnectionError('');
    try {
      const data = await apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`);
      setConnections(data.connections.filter((connection) => connection.connection_status === 'connected'));
    } catch (reason) {
      setConnectionError(reason instanceof Error ? reason.message : 'Unable to check accounts.');
    } finally {
      setConnectionLoading(false);
    }
  }, [storeId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void loadConnections(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadConnections]);

  useEffect(() => {
    let alive = true;
    readDraft(draftKey).then((draft) => {
      if (!alive || !draft || Date.now() - draft.savedAt > 7 * 86400000) return;
      setName(draft.name);
      setPrice(draft.price);
      setColors(draft.colors);
      setSizes(draft.sizes);
      setHasColors(draft.hasColors);
      setHasSizes(draft.hasSizes);
      setCaptionOverride(draft.caption ? [draft.caption, draft.variantCaption].filter(Boolean).join('\n') : null);
      productId.current = draft.productId || null;
      setStep((draft.step as string) === 'details' ? 'details' : 'media');
      setMedia(draft.files.filter((file) => file instanceof Blob).map((file) => {
        const url = URL.createObjectURL(file);
        urls.current.add(url);
        return { file, url, kind: fileKind(file) || 'image' };
      }));
    }).catch(() => {
      if (alive) setDraftNotice('Automatic draft recovery is unavailable in this browser.');
    }).finally(() => {
      if (alive) setReady(true);
    });
    return () => { alive = false; };
  }, [draftKey]);

  // A history entry lets the device/browser back gesture move between the
  // full-page details and media steps without navigating away from the store.
  useEffect(() => {
    const previousState = window.history.state;
    window.history.pushState({ ...(previousState && typeof previousState === 'object' ? previousState : {}), stoyanguComposer: true }, '', window.location.href);
    return () => {
      if (window.history.state?.stoyanguComposer) window.history.replaceState(previousState || {}, '', window.location.href);
    };
  }, []);

  useEffect(() => {
    return pushBackHandler(() => {
      if (cameraOpen) {
        setCameraOpen(false);
        window.history.pushState({ stoyanguComposer: true }, '', window.location.href);
        return true;
      }
      if (busy) {
        window.history.pushState({ stoyanguComposer: true }, '', window.location.href);
        return true;
      }
      if (step === 'details') {
        setStep('media');
        window.history.pushState({ stoyanguComposer: true }, '', window.location.href);
        return true;
      }
      onClose();
      return true;
    });
  }, [cameraOpen, busy, step, onClose]);

  useEffect(() => () => { urls.current.forEach((url) => URL.revokeObjectURL(url)); }, []);
  useEffect(() => {
    if (!ready || completed.current) return;
    const snapshot = () => ({ step, name, price, colors, sizes, hasColors, hasSizes, note: '', caption: captionOverride, productId: productId.current, files: media.map((item) => item.file), savedAt: Date.now() });
    const save = () => {
      if (!completed.current) void writeDraft(draftKey, snapshot()).catch(() => setDraftNotice('Draft recovery is unavailable. Keep this window open until you post.'));
    };
    const onHidden = () => { if (document.visibilityState === 'hidden') save(); };
    const timer = window.setTimeout(save, 150);
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, [draftKey, ready, step, name, price, colors, sizes, hasColors, hasSizes, captionOverride, media]);

  const addMediaFiles = (files: File[]) => {
    setError('');
    const incomingPhotos = files.filter((file) => fileKind(file) === 'image');
    const incomingVideos = files.filter((file) => fileKind(file) === 'video');
    const unknown = files.some((file) => !fileKind(file));
    const tooLargePhoto = incomingPhotos.some((file) => file.size > 15 * 1024 * 1024);
    const tooLargeVideo = incomingVideos.some((file) => file.size > 75 * 1024 * 1024);
    const photoRoom = Math.max(0, 7 - photos.length);
    const acceptedPhotos = incomingPhotos.filter((file) => file.size <= 15 * 1024 * 1024).slice(0, photoRoom);
    const nextVideo = !video ? incomingVideos.find((file) => file.size <= 75 * 1024 * 1024) : null;
    const extraMedia = incomingPhotos.length > photoRoom || incomingVideos.length > (video ? 0 : 1);
    const next: Media[] = [
      ...acceptedPhotos.map((file) => ({ file, url: URL.createObjectURL(file), kind: 'image' as const })),
      ...(nextVideo ? [{ file: nextVideo, url: URL.createObjectURL(nextVideo), kind: 'video' as const }] : []),
    ];
    next.forEach((item) => urls.current.add(item.url));
    if (next.length) setMedia((current) => [...current, ...next]);
    if (tooLargePhoto || tooLargeVideo) setError('Photos must be under 15 MB and videos under 75 MB.');
    else if (extraMedia) setError('Add up to 7 photos and one video. Extra media was not added.');
    else if (unknown) setError('Choose photo or video files only.');
  };

  const removeMedia = (item: Media) => {
    URL.revokeObjectURL(item.url);
    urls.current.delete(item.url);
    setMedia((current) => current.filter((entry) => entry !== item));
    setError('');
  };

  const toggle = (item: string, selected: string[], setter: (items: string[]) => void) => setter(selected.includes(item) ? selected.filter((value) => value !== item) : [...selected, item]);
  const addCustom = (type: 'color' | 'size') => {
    const value = (type === 'color' ? customColor : customSize).trim().slice(0, 40);
    if (!value) return;
    if (type === 'color') {
      setColors([...new Set([...colors, value])]);
      setCustomColor('');
    } else {
      setSizes([...new Set([...sizes, value])]);
      setCustomSize('');
    }
  };

  const submit = async (asDraft = false) => {
    if (submitting.current) return;
    setError('');
    if (locked) { setError('Renew your store plan to add products. Existing products remain live.'); return; }
    if (!photos.length) { setError('Add at least one product photo before continuing.'); return; }
    if (name.trim().length < 2) { setError('Enter a product name of at least 2 characters.'); return; }
    if (!Number.isFinite(Number(price)) || Number(price) < 1) { setError('Enter a price of at least KES 1.'); return; }
    if (!asDraft && !connections.length) { setError('Connect an account in Settings → Connected Accounts to publish.'); return; }
    if ((caption + '\n\n' + tags).length > 2200) { setError('Shorten the caption to keep the post under 2,200 characters.'); return; }
    // The operating system share sheet must be opened in the tap gesture.
    const shareFiles = media.map((item) => item.file);
    if (!asDraft && navigator.canShare?.({ files: shareFiles })) {
      void navigator.share({ files: shareFiles, title: `${storeName} status`, text: fullCaption }).catch(() => undefined);
    }
    submitting.current = true;
    setBusy('Uploading media…');
    try {
      const attached = await Promise.all(media.map(async (item) => {
        const saved = uploads.current.get(item.file);
        if (saved) return saved;
        const uploaded = item.kind === 'video'
          ? await uploadPostMedia(item.file)
          : { ...(await uploadImage(item.file, 'products')), kind: 'image' as const };
        uploads.current.set(item.file, uploaded);
        return uploaded;
      }));
      if (!asDraft) {
        setBusy('Saving product…');
        const images = attached.filter((item) => item.kind === 'image').map((item) => item.url);
        const saved = await apiFetch<Product>('/api/products', {
          method: productId.current ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...(productId.current ? { id: productId.current } : {}),
            store_id: storeId,
            name: name.trim(),
            price: Number(price),
            colors: hasColors ? colors : [],
            sizes: hasSizes ? sizes : [],
            images,
            image_url: images[0],
            video_url: attached.find((item) => item.kind === 'video')?.url || '',
          }),
        });
        productId.current = saved.id;
        onProductsChanged?.();
        await writeDraft(draftKey, { step, name, price, colors, sizes, hasColors, hasSizes, note: '', caption: captionOverride, productId: saved.id, files: media.map((item) => item.file), savedAt: Date.now() }).catch(() => undefined);
      }
      setBusy(asDraft ? 'Saving draft…' : 'Sending to accounts…');
      const response = await apiFetch<{ results?: Result['results'] }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: asDraft ? 'save_draft' : 'publish', store_id: storeId, caption: `${caption}\n\n${tags}`, media_urls: attached.map((item) => item.url), media_kinds: attached.map((item) => item.kind) }),
      });
      completed.current = true;
      await writeDraft(draftKey, null).catch(() => undefined);
      setResult({ draft: asDraft, results: response.results || {} });
      onPosted();
      if (!asDraft && Object.values(response.results || {}).some((postResult) => postResult.ok) && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Post accepted', { body: 'Your connected accounts accepted the post. Check each result for delivery.', icon: '/favicon-192.png' });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to post. Your work is saved on this device; please retry.');
    } finally {
      submitting.current = false;
      setBusy('');
    }
  };

  const recap = media.length ? <div className="composer-recap">
    <div className="composer-tiktok-strip media-grid-v12" role="list" aria-label="Post media">
      {media.map((item) => <div key={item.url} role="listitem" className={`composer-tiktok-cell ${item.kind === 'image' && photos[0] === item ? 'lead' : ''}`}>
        {item.kind === 'video' ? <video src={item.url} muted playsInline preload="metadata" /> : <img src={item.url} alt={`Product photo ${photos.indexOf(item) + 1}`} />}
        {item.kind === 'image' && photos[0] === item && <small>Cover photo</small>}
        {item.kind === 'video' && <span className="composer-video-tag"><Video /></span>}
        <button type="button" onClick={() => removeMedia(item)} disabled={!!busy} aria-label={item.kind === 'video' ? 'Remove video' : `Remove photo ${photos.indexOf(item) + 1}`}><X /></button>
      </div>)}
    </div>
  </div> : null;
  const allSucceeded = result && Object.values(result.results).every((postResult) => postResult.ok) && Object.keys(result.results).length > 0;

  const finishOnWhatsAppStatus = async () => {
    try {
      await navigator.clipboard.writeText(fullCaption);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard may be unavailable */ }
    const files = media.map((item) => item.file);
    if (files.length && navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files, title: `${storeName} status`, text: fullCaption });
        return;
      } catch { /* fall through to caption link */ }
    }
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(fullCaption)}`, '_blank');
  };

  const canContinue = photos.length > 0 && !busy;
  const remainingPhotos = Math.max(0, 7 - photos.length);
  const remainingVideos = video ? 0 : 1;

  return <div className="post-composer-page" role="dialog" aria-modal="true" aria-labelledby="post-composer-title">
    <header className="post-composer-header">
      <button type="button" className="post-composer-back" onClick={() => step === 'details' ? setStep('media') : closeManually()} aria-label={step === 'details' ? 'Back to media' : 'Close post composer'} disabled={!!busy}>
        {step === 'details' ? <ArrowLeft /> : <X />}
      </button>
      <div className="post-composer-heading"><small>{storeName}</small><h1 id="post-composer-title">{result ? (result.draft ? 'Draft saved' : 'Post') : step === 'media' ? 'Add media' : 'Product details'}</h1></div>
      {!result && <span className="post-composer-step-label">{step === 'media' ? '1 of 2' : '2 of 2'}</span>}
    </header>

    <main className="composer-body composer-v12 post-composer-content">
      <div className="composer-progress composer-progress-3 composer-progress-2" aria-label="Post progress">
        <span className={step === 'media' ? 'active' : 'done'}>1 · Media</span>
        <span className={step === 'details' ? 'active' : ''}>2 · Product details</span>
      </div>
      {!ready ? <p role="status" className="composer-restore">Restoring your draft…</p> : result ? <div className="composer-result post-composer-result">
        <div className="result-check"><Check /></div>
        <h3>{result.draft ? 'Draft saved' : allSucceeded ? 'Your post is queued' : 'Check your post results'}</h3>
        <p>{result.draft ? 'Saved securely to your store. Nothing was published to social media.' : 'Your product is saved in your store. Social delivery status is shown below.'}</p>
        <div className="composer-result-list">
          {Object.entries(result.results).filter(([platform]) => !platform.toLowerCase().includes('tiktok story')).map(([platform, postResult]) => <div key={platform} className={`composer-result-row ${postResult.ok ? 'ok' : 'fail'}`}>
            <strong>{platform}</strong><small>{postResult.ok ? 'Accepted for scheduling — check the platform' : postResult.error && postResult.error.trim().length > 2 ? postResult.error : 'The platform did not accept this post. Please retry.'}</small>{postResult.ok ? <Check /> : <X />}
          </div>)}
        </div>
        <div className="whatsapp-status-lead-card">
          <div className="whatsapp-lead-header"><div className="whatsapp-icon-circle"><MessageCircle size={22} /></div><div><h4>Finish on WhatsApp Status</h4><p>{copied ? 'Caption copied to clipboard! ' : ''}Share your video and photos to WhatsApp Status to complete posting everywhere.</p></div></div>
          <div className="composer-result-actions"><button type="button" className="button-whatsapp-status" onClick={finishOnWhatsAppStatus}><MessageCircle size={18} /> Open WhatsApp Status</button><button type="button" className="secondary-button" onClick={copyCaption}><Copy size={16} /> {copied ? 'Copied' : 'Copy caption'}</button></div>
        </div>
        <div className="composer-result-footer"><button type="button" className="button-primary" onClick={closeManually}>Done <Check /></button></div>
      </div> : <>
        {step === 'media' && <section className="composer-block composer-media-first post-media-step">
          <div className="post-media-intro"><div className="post-media-icon"><ImagePlus /></div><div><strong>Add photos and a video</strong><p>Choose or capture up to 7 photos. Add one optional video.</p></div></div>
          {recap || <div className="post-media-empty"><Camera /><strong>Your post starts here</strong><span>Open the camera to take a photo or video, or browse your phone's gallery.</span></div>}
          {video && !photos.length && <div className="composer-photo-needed" role="status"><ImagePlus /><span>Add at least one product photo to continue. A video alone is not enough.</span></div>}
          {photos.length > 0 && <p className="post-media-count"><Check /> {photos.length} photo{photos.length === 1 ? '' : 's'}{video ? ' and 1 video' : ''} ready</p>}
          <button type="button" className="button-primary post-open-camera" onClick={() => setCameraOpen(true)} disabled={!!busy || (!remainingPhotos && !remainingVideos)}>
            <Camera /> {media.length ? 'Add more media' : 'Open camera'}
          </button>
          {!remainingPhotos && !remainingVideos && <small className="composer-hint">You have reached the media limit for this post.</small>}
          <div className="post-step-footer">
            <span>{photos.length}/7 photos{video ? ' · video added' : ' · video optional'}</span>
            <button type="button" className="button-primary" onClick={() => { setError(''); setStep('details'); }} disabled={!canContinue}>Continue <ArrowRight /></button>
          </div>
        </section>}

        {step === 'details' && <>
          <section className="composer-block post-details-block">
            <div className="post-details-title"><Package /><div><strong>Product details</strong><small>Your post will also appear in your store.</small></div></div>
            {recap}
            <div className="composer-details-box"><div className="form-grid">
              <label>Product name<input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Home jersey" disabled={!!busy} /></label>
              <label>Price (KES)<input type="number" inputMode="decimal" min="1" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 2800" disabled={!!busy} /></label>
            </div></div>
            <OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold']} selected={colors} onToggle={(item) => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} />
            <OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42']} selected={sizes} onToggle={(item) => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} />
          </section>
          <section className="composer-caption">
            <div className="composer-section-heading"><label htmlFor="live-caption">Caption</label></div>
            <div className="caption-locked-box"><textarea id="live-caption" aria-label="Editable caption including colours and sizes" value={caption} onChange={(event) => setCaptionOverride(event.target.value)} rows={Math.min(9, caption.split('\n').length + 2)} />
              <div className="caption-locked-tags"><b>{tags.split(' ')[0]}</b><b>{tags.split(' ')[1]}</b><small>{storeLink(storeSlug)}</small></div>
            </div>
            <small>{caption.length + tags.length + 2} / 2200</small>
          </section>
          {connectionLoading ? <small className="composer-hint">Checking connected accounts…</small> : connectionError ? <div className="form-error">{connectionError} <button type="button" onClick={loadConnections}>Retry</button></div> : connections.length ? null : <small className="composer-hint">Connect accounts in Settings → Connected Accounts to publish.</small>}
          {locked && <div className="form-error">Your store plan needs renewal before you can add products.</div>}
          <div className="post-step-footer post-details-footer">
            <button type="button" className="secondary-button" onClick={() => setStep('media')} disabled={!!busy}><ArrowLeft /> Back</button>
            <div className="composer-submit-actions"><button type="button" className="button-primary" onClick={() => void submit(false)} disabled={!!busy || locked || connectionLoading}><Send /> Post</button></div>
          </div>
        </>}
        {busy && <div className="form-success" role="status">{busy}</div>}
        {error && <div className="form-error" role="alert">{error}</div>}
        {draftNotice && <small className="composer-hint">{draftNotice}</small>}
      </>}
    </main>

    {cameraOpen && <MediaCaptureSheet
      title="Camera and gallery"
      maxPhotos={remainingPhotos}
      maxVideos={remainingVideos}
      maxItems={remainingPhotos + remainingVideos}
      onClose={() => setCameraOpen(false)}
      onUse={(files) => { addMediaFiles(files); setCameraOpen(false); }}
    />}
  </div>;
}
