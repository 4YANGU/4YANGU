import { useEffect, useState } from 'react';
import { Check, ImagePlus, Package, Plus, Send, X } from 'lucide-react';
import Modal from './Modal';
import ProductModal from './ProductModal';
import { PlatformTag } from './SocialInbox';
import { apiFetch, formatMoney, uploadImage } from '../lib/api';
import type { Product, SocialConnection } from '../types';

const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'threads', label: 'Threads' },
];

const platformLabel = (id: string) => PLATFORMS.find((item) => item.id === id)?.label || id;

type PublishResult = { mode: string; results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };

type Props = { storeId: number; products: Product[]; onClose: () => void; onPosted: () => void; onProductsChanged: () => void; productsLocked?: boolean };

export default function PostComposer({ storeId, products, onClose, onPosted, onProductsChanged, productsLocked }: Props) {
  const [caption, setCaption] = useState('');
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [productId, setProductId] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);
  const [productModalOpen, setProductModalOpen] = useState(false);

  useEffect(() => {
    apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`)
      .then((status) => {
        setConnections(status.connections || []);
      })
      .catch(() => undefined)
      .finally(() => setLoadingConnections(false));
  }, [storeId]);

  const product = products.find((item) => String(item.id) === productId) || null;
  const productCover = product ? (product.images?.[0] || product.image_url || '') : '';
  const mediaUrls = [...(productCover ? [productCover] : []), ...photos];
  // Posting always goes to every connected platform — the owner never picks.
  const connectedPlatforms = PLATFORMS.filter((platform) => connections.some((connection) => connection.platform === platform.id));
  const connectedIds = connectedPlatforms.map((platform) => platform.id);

  const attachFiles = async (files: FileList | null) => {
    const list = Array.from(files || []).filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, 4 - photos.length));
    if (!list.length) return;
    setUploading(true);
    setError('');
    try {
      for (const file of list) {
        const uploaded = await uploadImage(file, 'products');
        setPhotos((current) => [...current, uploaded.url]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload those photos.');
    } finally {
      setUploading(false);
    }
  };

  const publish = async (asDraft: boolean) => {
    setError('');
    setDraftSaved(false);
    if (!caption.trim()) return setError('Write something first — even one line.');
    if (!asDraft && !connectedIds.length) return setError('Connect your accounts first — open the Inbox tab and tap Accounts.');
    setBusy(true);
    try {
      const response = await apiFetch<PublishResult>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: asDraft ? 'save_draft' : 'publish', store_id: storeId, caption: caption.trim(), platforms: connectedIds, media_urls: mediaUrls }),
      });
      if (asDraft) {
        setDraftSaved(true);
      } else {
        setResult({ mode: response.mode, results: response.results || {} });
        onPosted();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not post.');
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="Post once, everywhere" onClose={onClose}>
    <div className="composer-body">
      <p className="form-intro">Write once — StoYangu sends it to all 5 of your connected accounts at the same time.</p>
      {result ? <div className="composer-result">
        <strong>Posted to your accounts.</strong>
        <p>Delivered to each platform below.</p>
        <div className="composer-result-list">
          {Object.entries(result.results).map(([platform, info]) => <div key={platform} className={`composer-result-row ${info.ok ? 'ok' : 'fail'}`}>
            <PlatformTag platform={platform} />
            <strong>{platformLabel(platform)}</strong>
            <small>{info.ok ? (info.external_id || 'sent') : (info.error || 'failed')}</small>
            {info.ok ? <Check /> : <X />}
          </div>)}
        </div>
        <div className="modal-actions"><button className="button-primary" onClick={onClose}>Done <Check /></button></div>
      </div> : <>
        <label className="composer-caption">Caption<textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={4} maxLength={2200} placeholder="New arrival! Stevo Home Jersey — KES 2,800. Sizes S–XXL. Order on WhatsApp!" autoFocus /><small>{caption.length} / 2200</small></label>
        <div className="composer-block">
          <strong>Posting to</strong>
          {loadingConnections
            ? <small className="composer-hint">Checking your connected accounts…</small>
            : connectedPlatforms.length
              ? <>
                <div className="composer-targets">
                  {connectedPlatforms.map((platform) => <PlatformTag key={platform.id} platform={platform.id} />)}
                </div>
                <small className="composer-hint">Always posts to all {connectedPlatforms.length} connected account{connectedPlatforms.length === 1 ? '' : 's'} — no need to choose.{connectedPlatforms.length < 5 ? ' Connect the rest from the Inbox tab under Accounts.' : ''}</small>
              </>
              : <small className="composer-hint">No accounts connected yet — open the Inbox tab and tap Accounts to connect TikTok, Facebook, Instagram, YouTube and Threads first.</small>}
        </div>
        <div className="composer-block">
          <div className="composer-block-head"><strong><Package /> Product (optional)</strong><button type="button" className="secondary-button composer-add-product" onClick={() => setProductModalOpen(true)} disabled={productsLocked} title="Add a brand-new product to your store"><Plus /> Add new</button></div>
          <select value={productId} onChange={(event) => setProductId(event.target.value)}>
            <option value="">No product attached</option>
            {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.price)}</option>)}
          </select>
          {product && productCover && <div className="composer-product-preview"><img src={productCover} alt={product.name} /><div><strong>{product.name}</strong><small>{formatMoney(product.price)} · cover photo will be attached</small></div><button type="button" onClick={() => setProductId('')} aria-label="Remove product"><X /></button></div>}
        </div>
        <div className="composer-block">
          <strong><ImagePlus /> Photos (optional, up to 4)</strong>
          <div className="composer-photos">
            {photos.map((url) => <div key={url} className="composer-photo"><img src={url} alt="Attached" /><button type="button" onClick={() => setPhotos((current) => current.filter((item) => item !== url))} aria-label="Remove photo"><X /></button></div>)}
            {photos.length < 4 && <label className="composer-add-photo"><input hidden type="file" accept="image/*" multiple onChange={(event) => { attachFiles(event.target.files); event.target.value = ''; }} /><ImagePlus /><span>{uploading ? 'Uploading…' : 'Add'}</span></label>}
          </div>
        </div>
        {draftSaved && <div className="form-success">Draft saved.</div>}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => publish(true)} disabled={busy || uploading}>Save draft</button>
          <button className="button-primary" onClick={() => publish(false)} disabled={busy || uploading}>{busy ? 'Posting…' : 'Post now'} <Send /></button>
        </div>
        {productModalOpen && <ProductModal product={null} storeId={storeId} onClose={() => setProductModalOpen(false)} onSaved={(saved) => { setProductModalOpen(false); onProductsChanged(); if (saved) setProductId(String(saved.id)); }} />}
      </>}
    </div>
  </Modal>;
}
