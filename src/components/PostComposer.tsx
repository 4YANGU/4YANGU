import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Camera, Check, ImagePlus, Package, Send, Type, Video, X } from 'lucide-react';
import Modal from './Modal';
// Woyoyo-009: native phone-camera capture — no in-app recorder.
import { OptionPicker } from './ProductForm';
import { apiFetch, formatMoney, uploadImage, uploadPostMedia } from '../lib/api';
import type { Product, SocialConnection } from '../types';

type PublishResult = { results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };

type Attachment = { url: string; kind: 'image' | 'video' };

// Woyoyo-005: camera-first post flow. + opens the product-video camera
// (skippable for photos-only posts), then the product-photo camera, then one
// screen: product name + price (+ optional colours/sizes) with an auto-built
// caption the seller can edit. Every post creates a product — there is no
// post-without-product and no use-existing step.
// Woyoyo-006: first-post permission primer (camera + mic asked once, up
// front), step progress header, media recap card, and the two permanent
// hashtags (#stoyangu + #storename) rendered locked INSIDE the caption box
// itself — visible, but impossible to delete or edit.
// Woyoyo-009: native phone-camera capture. The in-app WebRTC recorder is
// retired — sellers now shoot video AND photos with their own camera app
// (full quality) via file inputs, then everything continues in-app.
// Woyoyo-010: back navigation between steps, TikTok-style words-on-video
// (burned into the clip at upload), and an in-app photo-burst mode that
// captures many photos in one camera session (no app-switch loop).
type VideoChoice = { url: string; file: File } | null;
type Props = { storeId: number; storeName: string; storeSlug: string; locked?: boolean; onClose: () => void; onPosted: () => void; onProductsChanged?: () => void };

type Step = 'video' | 'photo' | 'details';

export default function PostComposer({ storeId, storeName, storeSlug, locked = false, onClose, onPosted, onProductsChanged }: Props) {
  const [step, setStep] = useState<Step>('video');
  const [video, setVideo] = useState<Attachment | null>(null);
  const [videoChoice, setVideoChoice] = useState<VideoChoice>(null);
  const [videoText, setVideoText] = useState('');
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
  // Woyoyo-009: durable draft. File inputs hand back File objects that
  // must survive step changes AND full tab reloads (phones kill tabs when
  // the camera app opens) — so every pick is mirrored to IndexedDB and the
  // text draft to sessionStorage, then restored on mount.
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const galleryRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const videoCameraRef = useRef<HTMLInputElement>(null);
  const videoGalleryRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  const captionBoxRef = useRef<HTMLDivElement>(null);
  const draftKey = useMemo(() => `stoyangu-draft-${storeId}`, [storeId]);
  const draftSaved = useRef(false);

  const slugTag = `#${String(storeSlug || storeName).toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore'}`;
  const permanentTags = `#stoyangu ${slugTag}`;

  useEffect(() => {
    apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`)
      .then((status) => setConnectionCount((status.connections || []).length))
      .catch(() => undefined)
      .finally(() => setLoadingConnections(false));
  }, [storeId]);

  // Keep object URLs for instant previews; revoke on unmount.
  useEffect(() => () => { photoUrls.forEach((url) => URL.revokeObjectURL(url)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (item: string, list: string[], setter: (value: string[]) => void) => setter(list.includes(item) ? list.filter((value) => value !== item) : [...list, item]);
  const addCustom = (type: 'color' | 'size') => {
    const value = (type === 'color' ? customColor : customSize).trim();
    if (!value) return;
    if (type === 'color') { setColors(Array.from(new Set([...colors, value]))); setCustomColor(''); }
    else { setSizes(Array.from(new Set([...sizes, value]))); setCustomSize(''); }
  };

  // Auto-build the caption from the product details; the seller can edit it.
  // Woyoyo-009: one simple price (the range experiment is retired).
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

  // Woyoyo-006: locked caption box. Editable text lives in state; the sync
  // below only writes to the DOM when state changed elsewhere (auto-build).
  // Typing flows DOM -> state, so the caret is never disturbed.
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

  // Woyoyo-009: durable draft store. sessionStorage keeps the text draft;
  // IndexedDB keeps the actual picked Files (video + photos) so a phone that
  // kills the tab when the camera app opens loses NOTHING — everything is
  // restored on mount and the seller continues where they left off.
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
    } catch { /* storage full/blocked — in-memory draft still works */ }
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
    } catch { /* harmless */ }
    db.close();
  };

  // Restore any interrupted draft once, on mount.
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
            if (typeof saved.videoText === 'string') setVideoText(saved.videoText.slice(0, 120));
            if (saved.step === 'photo' || saved.step === 'details') setStep(saved.step);
          }
        }
      } catch { /* no text draft */ }
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
      } catch { /* no file draft */ }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  // Mirror every change to the durable draft (debounced by React batching).
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify({ step, name, price, colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], caption, videoText }));
    } catch { /* private mode */ }
  }, [draftKey, step, name, price, hasColors, colors, hasSizes, sizes, caption, videoText]);
  useEffect(() => {
    draftSaved.current = true;
    void draftDbPut(`${draftKey}:files`, { video: videoChoice?.file, photos: photoFiles });
  }, [draftKey, videoChoice, photoFiles]);

  const clearDraft = async () => {
    try { sessionStorage.removeItem(draftKey); } catch { /* private mode */ }
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
  };

  // Woyoyo-010: burn TikTok-style words into the video clip itself, so the
  // text ships inside the file to every platform. Canvas + captureStream
  // re-record the clip with the overlay; falls back to the original file if
  // the browser cannot do it (original still posts fine).
  const burnTextIntoVideo = (file: File, text: string): Promise<File> => {
    const clean = text.trim().slice(0, 120);
    if (!clean) return Promise.resolve(file);
    return new Promise((resolve) => {
      const done = (fallback: File) => resolve(fallback);
      try {
        const url = URL.createObjectURL(file);
        const source = document.createElement('video');
        source.muted = true;
        (source as HTMLVideoElement & { playsInline?: boolean }).playsInline = true;
        source.preload = 'auto';
        source.src = url;
        const fail = () => { URL.revokeObjectURL(url); done(file); };
        source.onerror = fail;
        source.onloadedmetadata = () => {
          try {
            const width = source.videoWidth || 720;
            const height = source.videoHeight || 1280;
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return fail();
            const stream = canvas.captureStream(30);
            const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : (MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : '');
            const recorder = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 }) : new MediaRecorder(stream);
            const chunks: Blob[] = [];
            recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
            recorder.onstop = () => {
              URL.revokeObjectURL(url);
              cancelAnimationFrame(raf);
              if (!chunks.length) return done(file);
              const type = mime.split(';')[0] || 'video/webm';
              done(new File(chunks, file.name.replace(/\.[^.]+$/, '') + '-captioned.webm', { type }));
            };
            const draw = () => {
              ctx.drawImage(source, 0, 0, width, height);
              const fontSize = Math.max(28, Math.round(width / 14));
              ctx.font = `900 ${fontSize}px Manrope, Arial, sans-serif`;
              ctx.textAlign = 'center';
              const words = clean.split(/\s+/);
              const lines: string[] = [];
              let line = '';
              for (const word of words) {
                const trial = line ? `${line} ${word}` : word;
                if (ctx.measureText(trial).width > width * 0.86 && line) { lines.push(line); line = word; }
                else line = trial;
              }
              if (line) lines.push(line);
              const capped = lines.slice(0, 4);
              const top = Math.round(height * 0.08);
              ctx.lineWidth = Math.max(4, Math.round(fontSize / 8));
              ctx.strokeStyle = 'rgba(0,0,0,.85)';
              ctx.fillStyle = '#ffffff';
              capped.forEach((textLine, index) => {
                const y = top + index * Math.round(fontSize * 1.25);
                ctx.strokeText(textLine, width / 2, y);
                ctx.fillText(textLine, width / 2, y);
              });
              raf = requestAnimationFrame(draw);
            };
            let raf = 0;
            source.onended = () => { try { recorder.stop(); } catch { fail(); } };
            source.onerror = fail;
            void source.play().then(() => {
              try { recorder.start(250); } catch { fail(); return; }
              draw();
              window.setTimeout(() => { try { if (recorder.state === 'recording') recorder.stop(); } catch { /* onstop handles */ } }, Math.min(185000, (source.duration || 60) * 1000 + 1500));
            }).catch(fail);
          } catch { fail(); }
        };
      } catch { done(file); }
    });
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
      // 1. Upload the native video first (once — never re-uploaded, so it
      // can never "disappear"), then the product photos, then create the
      // product in the store. Woyoyo-010: any words the seller added are
      // burned into the clip before upload.
      let attachedVideo = video;
      if (!attachedVideo && videoChoice) {
        setUploadingVideo(true);
        try {
          const finalFile = videoText.trim() ? await burnTextIntoVideo(videoChoice.file, videoText) : videoChoice.file;
          attachedVideo = await uploadPostMedia(finalFile);
          setVideo(attachedVideo);
        } finally {
          setUploadingVideo(false);
        }
      }
      const images = await Promise.all(photoFiles.map(async (file) => (await uploadImage(file, 'products')).url));
      const created = await apiFetch<Product>('/api/products', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, name: name.trim(), price: Number(price), colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], image_url: images[0], images }),
      });
      onProductsChanged?.();
      // 2. Post to every connected account. Permanent hashtags are appended
      // here at send time, so they always ship even if the seller edits.
      const finalCaption = `${caption.trim() || buildCaption(name, price, colors, sizes)}\n\n${permanentTags}`;
      const mediaUrls = [...(attachedVideo ? [attachedVideo.url] : []), ...images];
      const mediaKinds = [...(attachedVideo ? ['video'] : []), ...images.map(() => 'image')];
      const response = await apiFetch<PublishResult & { mode?: string }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'publish', store_id: storeId, caption: finalCaption.slice(0, 2400), media_urls: mediaUrls, media_kinds: mediaKinds }),
      });
      setResult({ results: response.results || {} });
      onPosted();
      void created;
      await clearDraft();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post.');
    } finally {
      setBusy(false);
    }
  };

  // Woyoyo-009: closing without posting keeps the durable draft, so a
  // seller who backs out (or whose phone kills the tab) resumes intact.
  // Preview video = uploaded clip, else the local native pick (instant).
  const previewVideo: Attachment | null = video || (videoChoice ? { url: videoChoice.url, kind: 'video' } : null);
  const clearPreviewVideo = () => { setVideo(null); removeVideoChoice(); };

  const heading = step === 'video' ? 'Step 1 of 3 · Product video' : step === 'photo' ? 'Step 2 of 3 · Product photos' : 'Step 3 of 3 · Details & caption';

  return <Modal title="Post once, everywhere" onClose={onClose} wide>
    <div className="composer-body">
      <div className="composer-progress composer-progress-3" aria-label="Post progress"><span className={step === 'video' ? 'active' : 'done'}>1 · Video</span><span className={step === 'photo' ? 'active' : step === 'details' ? 'done' : ''}>2 · Photos</span><span className={step === 'details' ? 'active' : ''}>3 · Post</span></div>
      <p className="form-intro">{heading} — every post creates the product in your store and goes to all connected accounts automatically.</p>
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
          <strong><Video /> Product video — shoot with your own camera</strong>
          <small className="composer-hint">Record vertically (9:16, like TikTok) in your phone's camera app for the best quality, then pick the clip here. Or skip straight to photos.</small>
          <div className="composer-recap">
            <MediaRecapCard video={previewVideo} uploadingVideo={uploadingVideo} photoUrls={photoUrls} onRemoveVideo={clearPreviewVideo} onRemovePhoto={removePhoto} />
          </div>
          {previewVideo && <div className="composer-video-text">
            <strong><Type /> Words on the video (like TikTok captions)</strong>
            <input value={videoText} maxLength={120} onChange={(event) => setVideoText(event.target.value)} placeholder="e.g. New arrival — 2800 only!" aria-label="Words to show on the video" />
            <div className="composer-text-preview"><div className="composer-tiktok-cell lead"><video src={previewVideo.url} muted playsInline preload="metadata" />{videoText.trim() ? <span className="composer-text-overlay">{videoText.trim().slice(0, 120)}</span> : null}</div></div>
          </div>}
          <div className="composer-media-actions">
            <button type="button" className="button-primary compact" onClick={() => videoCameraRef.current?.click()} disabled={uploadingVideo || busy}><Camera /> {previewVideo ? 'Re-shoot video' : 'Shoot video'}</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => videoGalleryRef.current?.click()} disabled={uploadingVideo || busy}><ImagePlus /> Pick from gallery</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => setStep('photo')}>Skip to photos</button>
          </div>
        </div>}
        {step === 'photo' && <div className="composer-block composer-media-first">
          <strong><ImagePlus /> Product photos (at least 1)</strong>
          <small className="composer-hint">Shoot with your camera or pick many at once from the gallery (up to 7). These photos become the product in your store and lead the post after the video.</small>
          <div className="composer-recap">
            <MediaRecapCard video={previewVideo} uploadingVideo={uploadingVideo} photoUrls={photoUrls} onRemoveVideo={clearPreviewVideo} onRemovePhoto={removePhoto} />
          </div>
          <div className="composer-media-actions">
            <button type="button" className="button-primary compact" onClick={() => photoRef.current?.click()} disabled={busy}><Camera /> {photoFiles.length ? `Take another (${photoFiles.length}/7)` : 'Take photo'}</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => galleryRef.current?.click()} disabled={busy}><ImagePlus /> Gallery (many at once)</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => setBurstOpen(true)} disabled={busy || photoFiles.length >= 7}><Camera /> Burst mode</button>
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
      {burstOpen && <PhotoBurst room={Math.max(0, 7 - photoFiles.length)} onClose={() => setBurstOpen(false)} onShots={(files) => { setBurstOpen(false); choosePhotos(files); }} />}
    </div>
    {/* Woyoyo-009: native capture inputs. capture="environment" opens the
    phone's own camera app (full quality); gallery inputs take many at once.
    The composer NEVER auto-advances on change — picks accumulate in the
    recap and the seller moves on with the buttons above. */}
    <input ref={videoCameraRef} hidden type="file" accept="video/*" capture="environment" onChange={(event) => { chooseVideo(event.target.files); event.target.value = ''; }} />
    <input ref={videoGalleryRef} hidden type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.3gp" onChange={(event) => { chooseVideo(event.target.files); event.target.value = ''; }} />
    <input ref={galleryRef} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => { choosePhotos(event.target.files); event.target.value = ''; }} />
    <input ref={photoRef} hidden type="file" accept="image/*,.avif,.heic,.heif" capture="environment" onChange={(event) => { choosePhotos(event.target.files); event.target.value = ''; }} />
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
    return <small className="composer-hint">No media yet — shoot or pick your video and photos, they will appear here.</small>;
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

function PhotoCapture(_props: { title: string; instructions: string; taken: number; onClose: () => void; onGallery: () => void; onCapture: () => void; onDone: () => void }) {
  // Woyoyo-009: retired — native capture happens inline (see inputs above).
  return null;
}

// Woyoyo-010: burst mode. One live camera session inside the app — the
// seller taps Shoot, takes N photos back-to-back (still frames grabbed
// from the live finder), and all of them land in the recap at once. No
// app-switch loop, no lost progress.
function PhotoBurst({ room, onClose, onShots }: { room: number; onClose: () => void; onShots: (files: File[]) => void }) {
  const finderRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);
  const [shots, setShots] = useState<File[]>([]);
  const [shotUrls, setShotUrls] = useState<string[]>([]);
  const [want, setWant] = useState(() => Math.min(3, Math.max(1, room)));
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { if (alive) { setError('This browser cannot open the camera here. Please use the Take photo button instead.'); setStarting(false); } return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 }, height: { ideal: 1600 } } });
        if (!alive) { stream.getTracks().forEach((track) => track.stop()); return; }
        streamRef.current = stream;
        if (finderRef.current) {
          finderRef.current.srcObject = stream;
          finderRef.current.muted = true;
          await finderRef.current.play().catch(() => undefined);
        }
        if (alive) setStarting(false);
      } catch {
        if (alive) { setError('Camera access was blocked. Allow the camera for this site, or use the Take photo button instead.'); setStarting(false); }
      }
    })();
    return () => { alive = false; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null; };
  }, []);
  useEffect(() => () => { shotUrls.forEach((url) => URL.revokeObjectURL(url)); }, [shotUrls]);
  const shoot = () => {
    const finder = finderRef.current;
    if (!finder || !finder.videoWidth) { setError('Camera is still warming up — give it a second and tap Shoot again.'); return; }
    const count = Math.max(1, Math.min(want, room - shots.length));
    const canvas = document.createElement('canvas');
    canvas.width = finder.videoWidth; canvas.height = finder.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) { setError('Could not capture right now. Please try again.'); return; }
    // Stagger the frames so each shot is a genuinely different moment.
    let taken = 0;
    const grab = () => {
      ctx.drawImage(finder, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) {
          const file = new File([blob], `burst-${Date.now()}-${taken}.jpg`, { type: 'image/jpeg' });
          setShots((current) => [...current, file]);
          setShotUrls((current) => [...current, URL.createObjectURL(file)]);
        }
        taken += 1;
        if (taken < count) window.setTimeout(grab, 450);
      }, 'image/jpeg', .9);
    };
    grab();
  };
  const useShots = () => { onShots(shots); };
  return <div className="recorder-backdrop" role="dialog" aria-modal="true" aria-label="Burst mode">
    <div className="recorder-shell photo-capture-shell">
      <div className="recorder-top">
        <button type="button" onClick={onClose} aria-label="Close burst mode"><X /></button>
        <strong>Burst mode · {shots.length}/{room} this session</strong>
        <span>1 session</span>
      </div>
      <p className="recorder-instructions">Stay in the camera and take many photos at once — no going back and forth.</p>
      <div className="photo-burst-live"><video ref={finderRef} playsInline muted /><span className="photo-burst-count">{shots.length} taken</span></div>
      {error && <div className="form-error recorder-error">{error}</div>}
      <div className="recorder-controls" style={{ display: 'grid', gap: 8 }}>
        <div className="photo-burst-row">
          <button type="button" className="button-primary" onClick={shoot} disabled={starting || shots.length >= room} style={{ flex: 1 }}><Camera /> Shoot</button>
          <input type="number" min={1} max={room} value={want} onChange={(event) => setWant(Math.max(1, Math.min(room, Number(event.target.value) || 1)))} aria-label="How many photos" />
        </div>
        {shotUrls.length > 0 && <div className="composer-tiktok-strip">{shotUrls.map((url, index) => <div key={`${url}-${index}`} className="composer-tiktok-cell"><img src={url} alt={`Burst shot ${index + 1}`} /></div>)}</div>}
        <button type="button" className="secondary-button" onClick={useShots} disabled={!shots.length}><Check /> Use {shots.length} photo{shots.length === 1 ? '' : 's'}</button>
      </div>
    </div>
  </div>;
}
