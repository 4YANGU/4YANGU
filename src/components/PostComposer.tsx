import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ImagePlus, Package, Send, Video, X } from 'lucide-react';
import Modal from './Modal';
import { OptionPicker } from './ProductForm';
import { apiFetch, formatMoney, uploadImage, uploadPostMedia } from '../lib/api';
import type { Product, SocialConnection } from '../types';

type PublishResult = { results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };
type Attachment = { url: string; kind: 'image' | 'video' };

/* 
  WOYOYO-011 — POSTING FLOW REDESIGN PER CLIENT REQUEST:

  1. No video recording at all. When user taps + it immediately opens the
     device gallery to pick a video (MP4/MOV/WebM). No camera button for video.

  2. Remove entire "words on the video" section — videos post as-is.

  3. After video is picked (or skipped), user lands on photo step where they
     can pick either:
     - CAMERA: our new sequential camera (take 1, take another, stay there,
       delete any before deciding)
     - GALLERY: pick many existing photos at once (up to 7)

  4. Burst mode rebuilt as sequential single-shot camera with in-session
     delete and Use (N) photos button that advances to final details page.

  5. Final page = product details + caption + post to all accounts.
*/

type VideoChoice = { url: string; file: File } | null;
type Props = { storeId: number; storeName: string; storeSlug: string; locked?: boolean; onClose: () => void; onPosted: () => void; onProductsChanged?: () => void };
type Step = 'video' | 'photo' | 'details';

export default function PostComposer({ storeId, storeName, storeSlug, locked = false, onClose, onPosted, onProductsChanged }: Props) {
  const [step, setStep] = useState<Step>('video');
  const [video, setVideo] = useState<Attachment | null>(null);
  const [videoChoice, setVideoChoice] = useState<VideoChoice>(null);
  const [burstOpen, setBurstOpen] = useState(false);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [hasColors, setHasColors] = useState(false); const [colors, setColors] = useState<string[]>([]); const [customColor, setCustomColor] = useState('');
  const [hasSizes, setHasSizes] = useState(false); const [sizes, setSizes] = useState<string[]>([]); const [customSize, setCustomSize] = useState('');
  const [caption, setCaption] = useState('');
  const [captionTouched, setCaptionTouched] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const galleryRef = useRef<HTMLInputElement>(null);
  const videoGalleryRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  const captionBoxRef = useRef<HTMLDivElement>(null);
  const draftKey = useMemo(() => `stoyangu-draft-${storeId}`, [storeId]);
  const autoOpenedVideo = useRef(false);

  const slugTag = `#${String(storeSlug || storeName).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'}`;
  const permanentTags = `#stoyangu ${slugTag}`;

  useEffect(() => {
    apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`)
      .then((status) => setConnectionCount((status.connections || []).length))
      .catch(() => undefined)
      .finally(() => setLoadingConnections(false));
  }, [storeId]);

  // Revoke previews on unmount
  useEffect(() => () => { photoUrls.forEach((url) => URL.revokeObjectURL(url)); if (videoChoice) URL.revokeObjectURL(videoChoice.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // WOYOYO-011: auto-open gallery for video when composer opens. The + click
  // is a user gesture so the file picker is still allowed if opened quickly.
  useEffect(() => {
    if (step !== 'video') return;
    if (autoOpenedVideo.current) return;
    if (videoChoice || video) return;
    autoOpenedVideo.current = true;
    const t = window.setTimeout(() => {
      try { videoGalleryRef.current?.click(); } catch { /* ignore */ }
    }, 380);
    return () => window.clearTimeout(t);
  }, [step, videoChoice, video]);

  const toggle = (item: string, list: string[], setter: (value: string[]) => void) => setter(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  const addCustom = (type: 'color' | 'size') => {
    const value = (type === 'color' ? customColor : customSize).trim();
    if (!value) return;
    if (type === 'color') { setColors(Array.from(new Set([...colors, value]))); setCustomColor(''); }
    else { setSizes(Array.from(new Set([...sizes, value]))); setCustomSize(''); }
  };

  const buildCaption = (productName: string, productPrice: string, productColors: string[], productSizes: string[]) => {
    const bits = [productName.trim() || 'New arrival'];
    if (Number(productPrice) > 0) bits.push(`— ${formatMoney(Number(productPrice))}`);
    const variants = [...(productColors.length ? [`Colours: ${productColors.join(', ')}`] : []), ...(productSizes.length ? [`Sizes: ${productSizes.join(', ')}`] : [])];
    if (variants.length) bits.push(`(${variants.join(' · ')})`);
    bits.push('Order on WhatsApp!');
    return bits.join(' ');
  };
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!captionTouched) setCaption(buildCaption(name, price, colors, sizes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, price, colors, sizes]);

  useEffect(() => {
    const box = captionBoxRef.current;
    if (!box || step !== 'details') return;
    const editable = box.querySelector('[data-caption-text]') as HTMLElement | null;
    if (editable && editable.textContent !== caption) {
      editable.textContent = caption;
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }, [caption, step]);

  const handleCaptionInput = () => {
    const editable = captionBoxRef.current?.querySelector('[data-caption-text]') as HTMLElement | null;
    if (!editable) return;
    let text = editable.textContent || '';
    if (text.length > 2100) {
      text = text.slice(0, 2100);
      editable.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    setCaptionTouched(true);
    setCaption(text);
  };

  const focusCaption = () => {
    const editable = captionBoxRef.current?.querySelector('[data-caption-text]') as HTMLElement | null;
    if (editable && document.activeElement !== editable) {
      editable.focus();
      const range = document.createRange();
      range.selectNodeContents(editable);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  // Durable draft (text + files) so phones that kill tab while camera opens lose nothing.
  const openDraftDb = () => new Promise<IDBDatabase | null>((resolve) => {
    try {
      const request = indexedDB.open('stoyangu-drafts', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
  const draftDbPut = async (key: string, value: unknown) => {
    const db = await openDraftDb();
    if (!db) return;
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch { }
    db.close();
  };
  const draftDbGet = async (key: string): Promise<unknown> => {
    const db = await openDraftDb();
    if (!db) return undefined;
    try {
      const value = await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction('files', 'readonly');
        const get = tx.objectStore('files').get(key);
        get.onsuccess = () => resolve(get.result);
        get.onerror = () => reject(get.error);
      });
      db.close();
      return value;
    } catch { db.close(); return undefined; }
  };
  const draftDbDel = async (key: string) => {
    const db = await openDraftDb();
    if (!db) return;
    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction('files', 'readwrite');
        tx.objectStore('files').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch { }
    db.close();
  };

  // Restore draft on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const raw = sessionStorage.getItem(draftKey);
        if (raw) {
          const saved = JSON.parse(raw);
          if (alive && saved && typeof saved === 'object') {
            if (typeof saved.name === 'string') setName(saved.name);
            if (typeof saved.price === 'string') setPrice(saved.price);
            if (Array.isArray(saved.colors)) { setColors(saved.colors); setHasColors(saved.colors.length > 0); }
            if (Array.isArray(saved.sizes)) { setSizes(saved.sizes); setHasSizes(saved.sizes.length > 0); }
            if (typeof saved.caption === 'string' && saved.caption) { setCaption(saved.caption); setCaptionTouched(true); }
            if (saved.step === 'photo' || saved.step === 'details') setStep(saved.step);
          }
        }
      } catch { }
      try {
        const files = await draftDbGet(`${draftKey}:files`) as { video?: File; photos?: File[] } | undefined;
        if (!alive || !files) return;
        if (files.video instanceof Blob && (files.video as File).size > 0) {
          const file = files.video as File;
          setVideoChoice({ url: URL.createObjectURL(file), file });
        }
        if (Array.isArray(files.photos) && files.photos.length) {
          const kept = (files.photos as File[]).filter((file) => file instanceof Blob);
          if (kept.length) {
            setPhotoFiles(kept);
            setPhotoUrls(kept.map((file) => URL.createObjectURL(file)));
          }
        }
      } catch { }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ step, name, price, colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], caption }));
    } catch { }
  }, [draftKey, step, name, price, hasColors, colors, hasSizes, sizes, caption]);
  useEffect(() => {
    void draftDbPut(`${draftKey}:files`, { video: videoChoice?.file, photos: photoFiles });
  }, [draftKey, videoChoice, photoFiles]);

  const clearDraft = async () => {
    try { sessionStorage.removeItem(draftKey); } catch { }
    await draftDbDel(`${draftKey}:files`);
  };

  const chooseVideo = (files: FileList | null) => {
    const file = Array.from(files || [])[0];
    if (!file) return;
    const looksVideo = file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name);
    if (!looksVideo) { setError('That file is not a video. Please pick a video, or skip to photos.'); return; }
    if (file.size > 75 * 1024 * 1024) { setError('Please keep videos under 75 MB.'); return; }
    setError('');
    setVideoChoice((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return { url: URL.createObjectURL(file), file };
    });
    // WOYOYO-011: after picking video, auto-advance to photo step where seller picks photos
    window.setTimeout(() => setStep('photo'), 300);
  };

  const choosePhotos = (files: FileList | File[] | null) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!selected.length) return;
    setError('');
    setPhotoFiles((current) => {
      const room = Math.max(0, 7 - current.length);
      if (selected.length > room) setError('A product can have a maximum of 7 photos.');
      const kept = selected.slice(0, room);
      setPhotoUrls((urls) => [...urls, ...kept.map((file) => URL.createObjectURL(file))]);
      return [...current, ...kept];
    });
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((current) => current.filter((_, position) => position !== index));
    setPhotoUrls((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed);
      return current.filter((_, position) => position !== index);
    });
  };

  const removeVideoChoice = () => {
    setVideoChoice((previous) => {
      if (previous) URL.revokeObjectURL(previous.url);
      return null;
    });
    setVideo(null);
    autoOpenedVideo.current = false; // allow re-auto but user explicitly removed, so next effect won't auto again until reset, but we reset flag to allow manual
  };

  const publish = async () => {
    setError('');
    if (locked) return setError('Adding products is locked until the next KES 300 payment — your products stay live for customers.');
    if (!photoFiles.length && !photoUrls.length) return setError('Take at least one product photo first — it becomes the product in your store.');
    if (name.trim().length < 2) return setError('Add the product name.');
    if (!Number(price) || Number(price) < 1) return setError('Add a valid product price.');
    if (!connectionCount) return setError('Connect at least one account first — open the Inbox tab and tap Accounts.');
    setBusy(true);
    try {
      let attachedVideo = video;
      if (!attachedVideo && videoChoice) {
        setUploadingVideo(true);
        try {
          // WOYOYO-011: no words burning, upload as-is
          attachedVideo = await uploadPostMedia(videoChoice.file);
          setVideo(attachedVideo);
        } finally {
          setUploadingVideo(false);
        }
      }
      const images = await Promise.all(photoFiles.map(async (file) => (await uploadImage(file, 'products')).url));
      await apiFetch<Product>('/api/products', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, name: name.trim(), price: Number(price), colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], image_url: images[0], images }),
      });
      onProductsChanged?.();
      const finalCaption = `${caption.trim() || buildCaption(name, price, colors, sizes)}\n\n${permanentTags}`;
      const mediaUrls = [...(attachedVideo ? [attachedVideo.url] : []), ...images];
      const mediaKinds = [...(attachedVideo ? ['video'] : []), ...images.map(() => 'image')];
      const response = await apiFetch<PublishResult & { mode?: string }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'publish', store_id: storeId, caption: finalCaption.slice(0, 2400), media_urls: mediaUrls, media_kinds: mediaKinds }),
      });
      setResult({ results: response.results || {} });
      onPosted();
      await clearDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post.');
    } finally {
      setBusy(false);
    }
  };

  const previewVideo: Attachment | null = video || (videoChoice ? { url: videoChoice.url, kind: 'video' } : null);
  const clearPreviewVideo = () => { setVideo(null); removeVideoChoice(); };

  const heading = step === 'video' ? 'Step 1 of 3 · Product video from gallery' : step === 'photo' ? 'Step 2 of 3 · Product photos' : 'Step 3 of 3 · Details & post';

  return <Modal title="Post once, everywhere" onClose={onClose} wide>
    <div className="composer-body">
      <div className="composer-progress composer-progress-3" aria-label="Post progress"><span className={step === 'video' ? 'active' : 'done'}>1 · Video</span><span className={step === 'photo' ? 'active' : step === 'details' ? 'done' : ''}>2 · Photos</span><span className={step === 'details' ? 'active' : ''}>3 · Details</span></div>
      <p className="form-intro">{heading} — {step === 'video' ? 'Pick a video from your gallery. It will lead your post everywhere.' : step === 'photo' ? 'Now take product photos or pick from gallery, then continue.' : 'Every post creates the product in your store and goes to all connected accounts automatically.'}</p>
      {result ? <div className="composer-result">
        <strong>Posted to your connected accounts.</strong>
        <p>StoYangu delivered this post to your accounts. Per-account results:</p>
        <div className="composer-result-list">
          {Object.entries(result.results).map(([platform, info]) => <div key={platform} className={`composer-result-row ${info.ok ? 'ok' : 'fail'}`}>
            <strong>{platform}</strong>
            <small>{info.ok ? (info.external_id || 'sent') : (info.error || 'failed')}</small>
            {info.ok ? <Check /> : <X />}
          </div>)}
          {!Object.keys(result.results).length && <p>Nothing was sent — no accounts were connected.</p>}
        </div>
        <div className="modal-actions"><button className="button-primary" onClick={onClose}>Done <Check /></button></div>
      </div> : <>
        {step === 'video' && <div className="composer-block composer-media-first">
          <strong><Video /> Product video — pick from gallery only</strong>
          <small className="composer-hint">Your gallery was opened automatically. Choose a vertical 9:16 video for best results (like TikTok). No recording here — just gallery pick.</small>
          <div className="composer-recap">
            <MediaRecapCard video={previewVideo} uploadingVideo={uploadingVideo} photoUrls={photoUrls} onRemoveVideo={clearPreviewVideo} onRemovePhoto={removePhoto} />
          </div>
          <div className="composer-media-actions">
            <button type="button" className="button-primary compact" onClick={() => videoGalleryRef.current?.click()} disabled={uploadingVideo || busy}><ImagePlus /> {previewVideo ? 'Change video' : 'Pick video from gallery'}</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => setStep('photo')}>Skip to photos</button>
          </div>
          <small className="composer-hint" style={{ marginTop: 10, display: 'block' }}>After picking, you'll automatically go to the photo step.</small>
        </div>}
        {step === 'photo' && <div className="composer-block composer-media-first">
          <strong><ImagePlus /> Product photos (at least 1) — camera or gallery</strong>
          <small className="composer-hint">Use the camera to take one photo after another while staying in the camera. You can delete any you don't want before using them. Or pick many at once from gallery (up to 7).</small>
          <div className="composer-recap">
            <MediaRecapCard video={previewVideo} uploadingVideo={uploadingVideo} photoUrls={photoUrls} onRemoveVideo={clearPreviewVideo} onRemovePhoto={removePhoto} />
          </div>
          <div className="composer-media-actions">
            <button type="button" className="button-primary compact" onClick={() => setBurstOpen(true)} disabled={busy || photoFiles.length >= 7}><Camera /> {photoFiles.length ? `Camera — take more (${photoFiles.length}/7)` : 'Camera — take photos'}</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => galleryRef.current?.click()} disabled={busy}><ImagePlus /> Gallery (many at once)</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => setStep('details')} disabled={!photoUrls.length}>Continue to details</button>
          </div>
          <div className="composer-back-row"><button type="button" className="secondary-button compact-upload" onClick={() => setStep('video')} disabled={busy}><ArrowLeft /> Back to video</button></div>
        </div>}
        {(step === 'details') && <div className="composer-block">
          <strong><Package /> Product details</strong>
          <div className="composer-recap">
            <MediaRecapCard video={previewVideo} uploadingVideo={uploadingVideo} photoUrls={photoUrls} onRemoveVideo={clearPreviewVideo} onRemovePhoto={removePhoto} />
          </div>
          {locked
            ? <small className="composer-hint">Adding products is locked until the next KES 300 payment — your products stay live for customers.</small>
            : <>
              <div className="composer-details-box">
                <div className="form-grid">
                  <label>Product name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Stevo Home Jersey" /></label>
                  <label>Price (KES)<input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 2800" /></label>
                </div>
              </div>
              <OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold']} selected={colors} onToggle={(item) => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} />
              <OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42']} selected={sizes} onToggle={(item) => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} />
            </>}
        </div>}
        {(step === 'details') && <>
          <div className="composer-caption composer-caption-locked">
            <span className="composer-caption-label">Caption (auto-filled from the product — edit if you want)</span>
            <div ref={captionBoxRef} className="caption-locked-box" role="textbox" aria-multiline="true" aria-label="Caption" tabIndex={0} onFocus={focusCaption} onClick={focusCaption}>
              <span data-caption-text contentEditable suppressContentEditableWarning spellCheck onInput={handleCaptionInput} />
              <span className="caption-locked-tags" contentEditable={false} unselectable="on"><b contentEditable={false}>#stoyangu</b><b contentEditable={false}>{slugTag}</b></span>
            </div>
            <small>{caption.length} / 2100</small>
          </div>
        </>}
        {loadingConnections
          ? <small className="composer-hint">Checking your connected accounts…</small>
          : !connectionCount && <small className="composer-hint">No accounts connected yet — open the Inbox tab, tap Accounts and connect TikTok, Facebook, Instagram, YouTube or Threads first.</small>}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          {step === 'details'
            ? <><button type="button" className="secondary-button" onClick={() => setStep('photo')} disabled={busy || uploadingVideo}><ArrowLeft /> Back</button><button className="button-primary" onClick={publish} disabled={busy || uploadingVideo}>{busy ? 'Posting…' : 'Post'} <Send /></button></>
            : <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>}
        </div>
      </>}
      {burstOpen && <SequentialCamera room={Math.max(0, 7 - photoFiles.length)} onClose={() => setBurstOpen(false)} onUse={(files) => { setBurstOpen(false); choosePhotos(files); }} />}
    </div>
    {/* WOYOYO-011: only gallery for video, no recording. Gallery for photos many + camera via sequential burst. */}
    <input ref={videoGalleryRef} hidden type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.3gp" onChange={(event) => { chooseVideo(event.target.files); event.target.value = ''; }} />
    <input ref={galleryRef} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => { choosePhotos(event.target.files); event.target.value = ''; }} />
  </Modal>;
}

function MediaRecapCard({ video, uploadingVideo, photoUrls, onRemoveVideo, onRemovePhoto }: {
  video: Attachment | null;
  uploadingVideo: boolean;
  photoUrls: string[];
  onRemoveVideo: () => void;
  onRemovePhoto: (index: number) => void;
}) {
  if (!video && !uploadingVideo && !photoUrls.length) {
    return <small className="composer-hint">No media yet — pick your video and photos, they will appear here.</small>;
  }
  return <div className="composer-tiktok-strip" role="list" aria-label="Post media">
    {video && <div role="listitem" className="composer-tiktok-cell lead"><video src={video.url} muted playsInline preload="metadata" /><small>Video · leads everywhere</small><span className="composer-video-tag"><Video /></span><button type="button" onClick={onRemoveVideo} aria-label="Remove video"><X /></button></div>}
    {uploadingVideo && !video && <div className="composer-tiktok-cell uploading"><span>Uploading…</span></div>}
    {photoUrls.map((url, index) => <div key={`${url}-${index}`} role="listitem" className={`composer-tiktok-cell ${index === 0 && !video ? 'lead' : ''}`}>
      <img src={url} alt={`Product photo ${index + 1}`} />
      {index === 0 && <small>{video ? 'Cover photo' : 'First · leads everywhere'}</small>}
      <button type="button" onClick={() => onRemovePhoto(index)} aria-label={`Remove photo ${index + 1}`}><X /></button>
    </div>)}
  </div>;
}

/* WOYOYO-011: rebuilt burst camera per request:
   - not many burst photos at once
   - let person take a photo, take another, then another while staying there
   - while still there they can delete any photos before deciding which ones to keep
   - once they click Use (number) photos, it goes to final page
   This is a live viewfinder + single-shot loop with in-session delete.
*/
function SequentialCamera({ room, onClose, onUse }: { room: number; onClose: () => void; onUse: (files: File[]) => void }) {
  const finderRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [shots, setShots] = useState<File[]>([]);
  const [shotUrls, setShotUrls] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        if (alive) { setError('This browser cannot open the camera here. Please use the gallery button instead.'); setStarting(false); }
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1920 } }
        });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (finderRef.current) {
          finderRef.current.srcObject = stream;
          finderRef.current.muted = true;
          await finderRef.current.play().catch(() => undefined);
        }
        if (alive) setStarting(false);
      } catch {
        if (alive) { setError('Camera access was blocked. Allow the camera for this site, or use the gallery button.'); setStarting(false); }
      }
    })();
    return () => {
      alive = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => () => { shotUrls.forEach((u) => URL.revokeObjectURL(u)); }, [shotUrls]);

  const shootOne = () => {
    const finder = finderRef.current;
    if (!finder || !finder.videoWidth) { setError('Camera warming up — wait a second and tap again.'); return; }
    if (shots.length >= room) { setError(`Maximum ${room} photos for this product.`); return; }
    const canvas = document.createElement('canvas');
    canvas.width = finder.videoWidth;
    canvas.height = finder.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setError('Could not capture. Try again.'); return; }
    ctx.drawImage(finder, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) { setError('Capture failed — try again.'); return; }
      const file = new File([blob], `photo-${Date.now()}-${shots.length + 1}.jpg`, { type: 'image/jpeg' });
      setShots((cur) => [...cur, file]);
      setShotUrls((cur) => [...cur, URL.createObjectURL(file)]);
      setError('');
    }, 'image/jpeg', 0.92);
  };

  const removeShot = (idx: number) => {
    setShots((cur) => cur.filter((_, i) => i !== idx));
    setShotUrls((cur) => {
      const removed = cur[idx];
      if (removed) URL.revokeObjectURL(removed);
      return cur.filter((_, i) => i !== idx);
    });
  };

  const useShots = () => {
    if (!shots.length) { setError('Take at least one photo first.'); return; }
    onUse(shots);
  };

  return <div className="recorder-backdrop" role="dialog" aria-modal="true" aria-label="Take product photos">
    <div className="recorder-shell photo-capture-shell sequential-camera">
      <div className="recorder-top">
        <button type="button" onClick={onClose} aria-label="Close camera"><X /></button>
        <strong>Camera · {shots.length} / {room ? shots.length + room : shots.length} taken</strong>
        <span>{room > 0 ? `${room} spots left` : 'full'}</span>
      </div>
      <p className="recorder-instructions">Stay here — tap Take photo, then take another. Delete any you don't want before using them. Tap Use when happy.</p>
      <div className="photo-burst-live"><video ref={finderRef} playsInline muted autoPlay /><span className="photo-burst-count">{shots.length} taken</span></div>
      {error && <div className="form-error recorder-error">{error}</div>}
      <div className="recorder-controls" style={{ display: 'grid', gap: 12 }}>
        <button type="button" className="button-primary" onClick={shootOne} disabled={starting || room <= 0} style={{ width: '100%' }}><Camera /> {starting ? 'Opening camera…' : shots.length ? `Take another photo (${shots.length}/${shots.length + room})` : 'Take a photo'}</button>
        {shotUrls.length > 0 && <div className="sequential-preview-grid" role="list" aria-label="Photos taken">
          {shotUrls.map((url, i) => <div key={`${url}-${i}`} className="sequential-preview-cell" role="listitem">
            <img src={url} alt={`Shot ${i + 1}`} />
            <button type="button" aria-label={`Delete photo ${i + 1}`} onClick={() => removeShot(i)}><X size={14} /></button>
            <small>{i + 1}</small>
          </div>)}
        </div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="secondary-button" onClick={onClose} style={{ flex: 1 }}>Cancel</button>
          <button type="button" className="button-primary" onClick={useShots} disabled={!shots.length} style={{ flex: 1 }}><Check /> Use {shots.length} photo{shots.length === 1 ? '' : 's'}</button>
        </div>
      </div>
    </div>
  </div>;
}
