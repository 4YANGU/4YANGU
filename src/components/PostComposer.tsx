import { useEffect, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, Package, Send, Video, X } from 'lucide-react';
import Modal from './Modal';
import VideoRecorder from './VideoRecorder';
import { OptionPicker } from './ProductForm';
import { apiFetch, formatMoney, uploadImage, uploadPostMedia } from '../lib/api';
import type { Product, SocialConnection } from '../types';

type PublishResult = { results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };

type Attachment = { url: string; kind: 'image' | 'video' };

// Woyoyo-005: camera-first post flow. + opens the product-video camera
// (skippable for photos-only posts), then the product-photo camera, then one
// screen: product name + price (+ optional colours/sizes) with an auto-built
// caption the seller can edit. Every post creates a product — there is no
// post-without-product and no use-existing step. Two permanent hashtags
// (#stoyangu + #storename) are appended at send time and cannot be removed.
type Props = { storeId: number; storeName: string; storeSlug: string; locked?: boolean; onClose: () => void; onPosted: () => void; onProductsChanged?: () => void };

type Step = 'video' | 'photo' | 'details';

export default function PostComposer({ storeId, storeName, storeSlug, locked = false, onClose, onPosted, onProductsChanged }: Props) {
  const [step, setStep] = useState<Step>('video');
  const [video, setVideo] = useState<Attachment | null>(null);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoUrls, setPhotoUrls] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [hasColors, setHasColors] = useState(false); const [colors, setColors] = useState<string[]>([]); const [customColor, setCustomColor] = useState('');
  const [hasSizes, setHasSizes] = useState(false); const [sizes, setSizes] = useState<string[]>([]); const [customSize, setCustomSize] = useState('');
  const [caption, setCaption] = useState('');
  const [captionTouched, setCaptionTouched] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);
  const [cameraOpen, setCameraOpen] = useState(true);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const galleryRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

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

  const choosePhotos = (files: FileList | null) => {
    const selected = Array.from(files || []).filter((file) => file.type.startsWith('image/'));
    if (!selected.length) return;
    setPhotoFiles((current) => {
      const room = Math.max(0, 7 - current.length);
      if (selected.length > room) setError('A product can have a maximum of 7 photos.');
      const kept = selected.slice(0, room);
      setPhotoUrls((urls) => [...urls, ...kept.map((file) => URL.createObjectURL(file))]);
      return [...current, ...kept];
    });
    setStep('details');
    setCameraOpen(false);
  };

  const removePhoto = (index: number) => {
    setPhotoFiles((current) => current.filter((_, position) => position !== index));
    setPhotoUrls((current) => {
      const removed = current[index];
      if (removed) URL.revokeObjectURL(removed);
      return current.filter((_, position) => position !== index);
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
      // 1. Upload product photos + create the product in the store.
      const images = await Promise.all(photoFiles.map(async (file, index) => {
        if (photoUrls[index] && !file.size) return photoUrls[index];
        return (await uploadImage(file, 'products')).url;
      }));
      const created = await apiFetch<Product>('/api/products', {
        method: 'POST',
        body: JSON.stringify({ store_id: storeId, name: name.trim(), price: Number(price), colors: hasColors ? colors : [], sizes: hasSizes ? sizes : [], image_url: images[0], images }),
      });
      onProductsChanged?.();
      // 2. Post to every connected account. Permanent hashtags are appended
      // here at send time, so they always ship even if the seller edits.
      const finalCaption = `${caption.trim() || buildCaption(name, price, colors, sizes)}\n\n${permanentTags}`;
      const mediaUrls = [...(video ? [video.url] : []), ...images];
      const mediaKinds = [...(video ? ['video'] : []), ...images.map(() => 'image')];
      const response = await apiFetch<PublishResult & { mode?: string }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: 'publish', store_id: storeId, caption: finalCaption.slice(0, 2200), media_urls: mediaUrls, media_kinds: mediaKinds }),
      });
      setResult({ results: response.results || {} });
      onPosted();
      void created;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post.');
    } finally {
      setBusy(false);
    }
  };

  const finishVideo = async (file: File) => {
    setCameraOpen(false);
    setStep('photo');
    setUploadingVideo(true);
    setError('');
    try {
      const uploaded = await uploadPostMedia(file);
      setVideo(uploaded);
      // Fresh recording done → immediately open the product-photo camera.
      setCameraOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that video.');
      setStep('details');
    } finally {
      setUploadingVideo(false);
    }
  };

  const heading = step === 'video' ? 'Step 1 of 3 · Product video' : step === 'photo' ? 'Step 2 of 3 · Product photos' : 'Step 3 of 3 · Details & caption';

  return <Modal title="Post once, everywhere" onClose={onClose} wide>
    <div className="composer-body">
      <p className="form-intro">{heading} — every post creates the product in your store and goes to all connected accounts automatically.</p>
      {result ? <div className="composer-result">
        <strong>Posted to your connected accounts.</strong>
        <p>StoYangu delivered this post through Repliz. Per-account results:</p>
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
        {step === 'video' && !cameraOpen && <div className="composer-block composer-media-first">
          <strong><Video /> Product video</strong>
          {video
            ? <div className="composer-tiktok-strip"><div className="composer-tiktok-cell lead"><video src={video.url} muted playsInline preload="metadata" /><small>Video · leads everywhere</small><span className="composer-video-tag"><Video /></span><button type="button" onClick={() => setVideo(null)} aria-label="Remove video"><X /></button></div></div>
            : uploadingVideo
              ? <div className="composer-tiktok-strip"><div className="composer-tiktok-cell uploading"><span>Uploading…</span></div></div>
              : <small className="composer-hint">No video — photos only. You can still record one.</small>}
          <div className="composer-media-actions">
            <button type="button" className="button-primary compact" onClick={() => setCameraOpen(true)} disabled={uploadingVideo || busy}><Camera /> {video ? 'Re-record' : 'Record video'}</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => { setStep('photo'); setCameraOpen(true); }}>Continue to photos</button>
          </div>
        </div>}
        {step === 'photo' && !cameraOpen && <div className="composer-block composer-media-first">
          <strong><ImagePlus /> Product photos (at least 1)</strong>
          <small className="composer-hint">These photos become the product in your store and lead the post after the video.</small>
          {photoUrls.length > 0 && <div className="composer-tiktok-strip" role="list" aria-label="Product photos">
            {photoUrls.map((url, index) => <div key={`${url}-${index}`} role="listitem" className={`composer-tiktok-cell ${index === 0 && !video ? 'lead' : ''}`}>
              <img src={url} alt={`Product photo ${index + 1}`} />
              {index === 0 && <small>{video ? 'Cover photo' : 'First · leads everywhere'}</small>}
              <button type="button" onClick={() => removePhoto(index)} aria-label={`Remove photo ${index + 1}`}><X /></button>
            </div>)}
          </div>}
          <div className="composer-media-actions">
            <button type="button" className="button-primary compact" onClick={() => setCameraOpen(true)} disabled={busy}><Camera /> Take photo</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => galleryRef.current?.click()} disabled={busy}><ImagePlus /> Gallery</button>
            <button type="button" className="secondary-button compact-upload" onClick={() => setStep('details')} disabled={!photoUrls.length}>Continue to details</button>
          </div>
        </div>}
        {(step === 'details') && <div className="composer-block">
          <strong><Package /> Product details</strong>
          {photoUrls.length > 0 && <div className="composer-tiktok-strip" role="list" aria-label="Product photos">
            {photoUrls.map((url, index) => <div key={`${url}-${index}`} role="listitem" className={`composer-tiktok-cell ${index === 0 && !video ? 'lead' : ''}`}>
              <img src={url} alt={`Product photo ${index + 1}`} />
              {index === 0 && <small>{video ? 'Cover photo' : 'First · leads everywhere'}</small>}
              <button type="button" onClick={() => removePhoto(index)} aria-label={`Remove photo ${index + 1}`}><X /></button>
            </div>)}
          </div>}
          {locked
            ? <small className="composer-hint">Adding products is locked until the next KES 300 payment — your products stay live for customers.</small>
            : <>
              <div className="form-grid">
                <label>Product name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Stevo Home Jersey" /></label>
                <label>Price (KES)<input type="number" min="1" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="e.g. 2800" /></label>
              </div>
              <OptionPicker label="Colors available" enabled={hasColors} setEnabled={setHasColors} items={['Black', 'White', 'Navy', 'Green', 'Red', 'Blue', 'Pink', 'Brown', 'Beige', 'Gold']} selected={colors} onToggle={(item) => toggle(item, colors, setColors)} custom={customColor} setCustom={setCustomColor} onAdd={() => addCustom('color')} />
              <OptionPicker label="Sizes available" enabled={hasSizes} setEnabled={setHasSizes} items={['XS', 'S', 'M', 'L', 'XL', 'XXL', '28', '30', '32', '34', '36', '38', '40', '42']} selected={sizes} onToggle={(item) => toggle(item, sizes, setSizes)} custom={customSize} setCustom={setCustomSize} onAdd={() => addCustom('size')} />
            </>}
        </div>}
        {(step === 'details') && <>
          <label className="composer-caption">Caption (auto-filled from the product — edit if you want)<textarea value={caption} onChange={(event) => { setCaption(event.target.value); setCaptionTouched(true); }} rows={4} maxLength={2100} placeholder="New arrival! Product name — price. Order on WhatsApp!" /><small>{caption.length} / 2100</small></label>
          <div className="composer-tags"><small>Permanent tags (always added, cannot be removed):</small><span><b>#stoyangu</b><b>{slugTag}</b></span></div>
        </>}
        {loadingConnections
          ? <small className="composer-hint">Checking your connected accounts…</small>
          : !connectionCount && <small className="composer-hint">No accounts connected yet — open the Inbox tab, tap Accounts and connect TikTok, Facebook, Instagram, YouTube or Threads first.</small>}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          {step === 'details'
            ? <button className="button-primary" onClick={publish} disabled={busy || uploadingVideo}>{busy ? 'Posting…' : 'Post'} <Send /></button>
            : <button type="button" className="secondary-button" onClick={onClose}>Cancel</button>}
        </div>
      </>}
    </div>
    {cameraOpen && step === 'video' && <VideoRecorder
      title="Step 1 · Record your product video"
      instructions="Point at the product and talk — vertical 9:16, just like TikTok. After the video you will take the product photos."
      skipLabel="Skip video — photos only"
      onSkip={() => { setCameraOpen(false); setStep('photo'); setCameraOpen(true); }}
      onClose={onClose}
      onDone={finishVideo}
    />}
    {cameraOpen && step === 'photo' && <PhotoCapture
      title="Step 2 · Take the product photo"
      instructions="This photo creates the product in your store. Take up to 7 — the first one is the cover."
      onClose={onClose}
      onGallery={() => galleryRef.current?.click()}
      onCapture={() => photoRef.current?.click()}
    />}
    <input ref={galleryRef} hidden multiple type="file" accept="image/*,.avif,.heic,.heif" onChange={(event) => { choosePhotos(event.target.files); event.target.value = ''; }} />
    <input ref={photoRef} hidden type="file" accept="image/*,.avif,.heic,.heif" capture="environment" onChange={(event) => { choosePhotos(event.target.files); event.target.value = ''; }} />
  </Modal>;
}

function PhotoCapture({ title, instructions, onClose, onGallery, onCapture }: { title: string; instructions: string; onClose: () => void; onGallery: () => void; onCapture: () => void }) {
  return <div className="recorder-backdrop" role="dialog" aria-modal="true" aria-label={title}>
    <div className="recorder-shell photo-capture-shell">
      <div className="recorder-top">
        <button type="button" onClick={onClose} aria-label="Close"><X /></button>
        <strong>{title}</strong>
        <span>9:16 style</span>
      </div>
      <p className="recorder-instructions">{instructions}</p>
      <div className="photo-capture-frame"><Camera /><span>Your camera opens next — frame the product vertically like a TikTok.</span></div>
      <div className="recorder-controls">
        <button type="button" className="button-primary" onClick={onCapture}><Camera /> Open camera</button>
        <button type="button" className="secondary-button" onClick={onGallery}><ImagePlus /> Gallery</button>
      </div>
    </div>
  </div>;
}
