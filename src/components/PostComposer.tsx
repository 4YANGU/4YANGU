import { useEffect, useState } from 'react';
import { Camera, Check, ImagePlus, Package, Send, Video, X } from 'lucide-react';
import Modal from './Modal';
import ProductForm from './ProductForm';
import VideoRecorder from './VideoRecorder';
import { apiFetch, formatMoney, uploadPostMedia } from '../lib/api';
import type { Product, SocialConnection } from '../types';

type PublishResult = { results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };

type Attachment = { url: string; kind: 'image' | 'video' };

// Woyoyo-004: the composer IS the product flow — the full product form is
// embedded directly (no "New" pop-up step). First block is the TikTok-style
// 9:16 media step (record or upload video / photos); posting always goes to
// every connected account automatically.
type Props = { storeId: number; products: Product[]; locked?: boolean; onClose: () => void; onPosted: () => void; onProductsChanged?: () => void };

export default function PostComposer({ storeId, products: initialProducts, locked = false, onClose, onPosted, onProductsChanged }: Props) {
  const [caption, setCaption] = useState('');
  const [connectionCount, setConnectionCount] = useState(0);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savingProduct, setSavingProduct] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);
  // Embedded product flow (no pop-up): mode + draft fields.
  const [productMode, setProductMode] = useState<'none' | 'existing' | 'new'>('none');
  const [productId, setProductId] = useState('');

  useEffect(() => {
    apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`)
      .then((status) => setConnectionCount((status.connections || []).length))
      .catch(() => undefined)
      .finally(() => setLoadingConnections(false));
  }, [storeId]);

  const product = products.find((item) => String(item.id) === productId) || null;
  const productCover = product && productMode === 'existing' ? (product.images?.[0] || product.image_url || '') : '';
  const mediaUrls = [...(productCover ? [productCover] : []), ...attachments.map((item) => item.url)];
  const mediaKinds = [...(productCover ? ['image'] : []), ...attachments.map((item) => item.kind)];

  const attachFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files || []).filter((file) => file.type.startsWith('image/') || file.type.startsWith('video/') || /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name)).slice(0, Math.max(0, 10 - attachments.length));
    if (!list.length) return;
    setUploading(true);
    setError('');
    try {
      for (const file of list) {
        const uploaded = await uploadPostMedia(file);
        setAttachments((current) => [...current, uploaded]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload those files.');
    } finally {
      setUploading(false);
    }
  };

  const refreshProducts = async () => {
    try {
      const fresh = await apiFetch<Product[]>(`/api/products?storeId=${storeId}`);
      setProducts(fresh || []);
      return fresh || [];
    } catch {
      return products;
    }
  };

  const publish = async (asDraft: boolean) => {
    setError('');
    setDraftSaved(false);
    if (!caption.trim()) return setError('Write something first — even one line.');
    if (!asDraft && !connectionCount) return setError('Connect at least one account first — open the Inbox tab and tap Accounts.');
    setBusy(true);
    try {
      const response = await apiFetch<PublishResult & { mode?: string }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: asDraft ? 'save_draft' : 'publish', store_id: storeId, caption: caption.trim(), media_urls: mediaUrls, media_kinds: mediaKinds }),
      });
      if (asDraft) {
        setDraftSaved(true);
      } else {
        setResult({ results: response.results || {} });
        onPosted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post.');
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="Post once, everywhere" onClose={onClose} wide>
    <div className="composer-body">
      <p className="form-intro">Write once — StoYangu sends it to every connected platform automatically.</p>
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
        <div className="composer-block composer-media-first">
          <strong><Video /> Video or photos — TikTok size first</strong>
          <small className="composer-hint">Record a vertical video (9:16, like TikTok) or post photos. The first attachment leads the post on every platform.</small>
          <div className="composer-media-actions">
            <button type="button" className="button-primary compact" onClick={() => setRecording(true)} disabled={uploading || busy || attachments.length >= 10}><Camera /> Record video</button>
            <label className="secondary-button compact-upload"><input hidden type="file" accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" multiple onChange={(event) => { attachFiles(event.target.files); event.target.value = ''; }} /><ImagePlus /> Upload photos / video</label>
          </div>
          {(attachments.length > 0 || uploading) && <div className="composer-tiktok-strip" role="list" aria-label="Post media">
            {attachments.map((item, index) => <div key={`${item.url}-${index}`} role="listitem" className={`composer-tiktok-cell ${index === 0 ? 'lead' : ''}`}>
              {item.kind === 'video' ? <video src={item.url} muted playsInline preload="metadata" /> : <img src={item.url} alt={`Attached ${index + 1}`} />}
              {index === 0 && <small>First · leads everywhere</small>}
              {item.kind === 'video' && <span className="composer-video-tag"><Video /></span>}
              <button type="button" onClick={() => setAttachments((current) => current.filter((_, position) => position !== index))} aria-label={`Remove attachment ${index + 1}`}><X /></button>
            </div>)}
            {uploading && <div className="composer-tiktok-cell uploading"><span>Uploading…</span></div>}
          </div>}
        </div>
        <label className="composer-caption">Caption<textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={4} maxLength={2200} placeholder="New arrival! Stevo Home Jersey — KES 2,800. Sizes S–XXL. Order on WhatsApp!" autoFocus /><small>{caption.length} / 2200</small></label>
        <div className="composer-block">
          <strong><Package /> Product for this post (optional)</strong>
          <div className="composer-product-mode" role="tablist" aria-label="Product choice">
            <button type="button" role="tab" className={productMode === 'none' ? 'active' : ''} onClick={() => { setProductMode('none'); setProductId(''); }}>No product</button>
            <button type="button" role="tab" className={productMode === 'existing' ? 'active' : ''} onClick={() => setProductMode('existing')}>Use existing</button>
            <button type="button" role="tab" className={productMode === 'new' ? 'active' : ''} onClick={() => setProductMode('new')} disabled={locked}>Add new here</button>
          </div>
          {productMode === 'existing' && <>
            <select value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="Choose a product">
              <option value="">Choose from your shelf…</option>
              {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.price)}</option>)}
            </select>
            {product && productCover && <div className="composer-product-preview"><img src={productCover} alt={product.name} /><div><strong>{product.name}</strong><small>{formatMoney(product.price)} · cover photo will be attached</small></div><button type="button" onClick={() => setProductId('')} aria-label="Remove product"><X /></button></div>}
          </>}
          {productMode === 'new' && (locked
            ? <small className="composer-hint">Adding products is locked until the next KES 300 payment — your products stay live for customers.</small>
            : <ProductForm
              storeId={storeId}
              busy={savingProduct}
              error={error}
              submitLabel="Save product & attach"
              onBusyChange={setSavingProduct}
              onError={setError}
              onSaved={async (savedId) => {
                const fresh = await refreshProducts();
                const newest = savedId ? fresh.find((item) => item.id === savedId) : [...fresh].sort((a, b) => b.id - a.id)[0];
                if (newest) {
                  setProducts(fresh);
                  setProductMode('existing');
                  setProductId(String(newest.id));
                }
                onProductsChanged?.();
              }}
            />)}
        </div>
        {loadingConnections
          ? <small className="composer-hint">Checking your connected accounts…</small>
          : !connectionCount && <small className="composer-hint">No accounts connected yet — open the Inbox tab, tap Accounts and connect TikTok, Facebook, Instagram, YouTube or Threads first.</small>}
        {draftSaved && <div className="form-success">Draft saved.</div>}
        {error && productMode !== 'new' && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => publish(true)} disabled={busy || uploading || savingProduct}>Save draft</button>
          <button className="button-primary" onClick={() => publish(false)} disabled={busy || uploading || savingProduct}>{busy ? 'Posting…' : 'Post now'} <Send /></button>
        </div>
      </>}
    </div>
    {recording && <VideoRecorder onClose={() => setRecording(false)} onDone={(file) => { setRecording(false); attachFiles([file]); }} />}
  </Modal>;
}
