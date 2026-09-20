import { useEffect, useState } from 'react';
import { Check, ImagePlus, Package, Plus, Send, X } from 'lucide-react';
import Modal from './Modal';
import ProductModal from './ProductModal';
import { PlatformBadge } from './PlatformLogo';
import { apiFetch, formatMoney, uploadImage } from '../lib/api';
import type { Product, SocialConnection } from '../types';

const PLATFORM_ORDER = ['tiktok', 'facebook', 'instagram', 'youtube', 'threads'];

type PublishResult = { results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };

type Props = { storeId: number; products: Product[]; onClose: () => void; onPosted: () => void; onProductsChanged?: () => void };

export default function PostComposer({ storeId, products: initialProducts, onClose, onPosted, onProductsChanged }: Props) {
  const [caption, setCaption] = useState('');
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [productId, setProductId] = useState('');
  const [addingProduct, setAddingProduct] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);

  useEffect(() => {
    apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`)
      .then((status) => setConnections(status.connections || []))
      .catch(() => undefined)
      .finally(() => setLoadingConnections(false));
  }, [storeId]);

  const product = products.find((item) => String(item.id) === productId) || null;
  const productCover = product ? (product.images?.[0] || product.image_url || '') : '';
  const mediaUrls = [...(productCover ? [productCover] : []), ...photos];
  const orderedConnections = [...connections].sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

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
    if (!asDraft && !connections.length) return setError('Connect at least one account first — open the Inbox tab and tap Accounts.');
    setBusy(true);
    try {
      const response = await apiFetch<PublishResult & { mode?: string }>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: asDraft ? 'save_draft' : 'publish', store_id: storeId, caption: caption.trim(), media_urls: mediaUrls }),
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

  return <Modal title="Post once, everywhere" onClose={onClose}>
    <div className="composer-body">
      <p className="form-intro">Write once — StoYangu sends it to every connected platform automatically.</p>
      {result ? <div className="composer-result">
        <strong>Posted to your connected accounts.</strong>
        <p>StoYangu delivered this post through Repliz. Per-account results:</p>
        <div className="composer-result-list">
          {Object.entries(result.results).map(([platform, info]) => <div key={platform} className={`composer-result-row ${info.ok ? 'ok' : 'fail'}`}>
            <PlatformBadge platform={platform} small />
            <small>{info.ok ? (info.external_id || 'sent') : (info.error || 'failed')}</small>
            {info.ok ? <Check /> : <X />}
          </div>)}
          {!Object.keys(result.results).length && <p>Nothing was sent — no accounts were connected.</p>}
        </div>
        <div className="modal-actions"><button className="button-primary" onClick={onClose}>Done <Check /></button></div>
      </div> : <>
        <label className="composer-caption">Caption<textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={4} maxLength={2200} placeholder="New arrival! Stevo Home Jersey — KES 2,800. Sizes S–XXL. Order on WhatsApp!" autoFocus /><small>{caption.length} / 2200</small></label>
        <div className="composer-block">
          <strong>Posting to</strong>
          {loadingConnections ? <small className="composer-hint">Checking your connected accounts…</small> : orderedConnections.length ? <div className="composer-auto-post">
            <div className="composer-platform-row">{orderedConnections.map((connection) => <PlatformBadge key={connection.platform} platform={connection.platform} small />)}</div>
            <small>Automatic — every connected account receives this post.</small>
          </div> : <small className="composer-hint">No accounts connected yet — open the Inbox tab, tap Accounts and connect TikTok, Facebook, Instagram, YouTube or Threads first.</small>}
        </div>
        <div className="composer-block">
          <strong><Package /> Attach a product (optional)</strong>
          <div className="composer-product-row">
            <select value={productId} onChange={(event) => setProductId(event.target.value)}>
              <option value="">No product attached</option>
              {products.map((item) => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.price)}</option>)}
            </select>
            <button type="button" className="secondary-button" onClick={() => setAddingProduct(true)}><Plus /> New</button>
          </div>
          <small className="composer-hint">Products are added here, while posting — pick one from the shelf or create it on the spot.</small>
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
      </>}
    </div>
    {addingProduct && <ProductModal product={null} storeId={storeId} onClose={() => setAddingProduct(false)} onSaved={async () => { setAddingProduct(false); const fresh = await refreshProducts(); const newest = [...fresh].sort((a, b) => b.id - a.id)[0]; if (newest) setProductId(String(newest.id)); onProductsChanged?.(); }} />}
  </Modal>;
}
