import { useEffect, useState } from 'react';
import { Check, ImagePlus, Package, Send, X } from 'lucide-react';
import Modal from './Modal';
import { apiFetch, formatMoney, uploadImage } from '../lib/api';
import type { Product, SocialConnection } from '../types';

const PLATFORMS = [
  { id: 'tiktok', label: 'TikTok', dot: '#111111' },
  { id: 'facebook', label: 'Facebook', dot: '#1877F2' },
  { id: 'instagram', label: 'Instagram', dot: '#E1306C' },
  { id: 'youtube', label: 'YouTube', dot: '#FF0000' },
  { id: 'threads', label: 'Threads', dot: '#6b7280' },
];

type PublishResult = { mode: string; results: Record<string, { ok?: boolean; external_id?: string; error?: string }> };

type Props = { storeId: number; products: Product[]; onClose: () => void; onPosted: () => void };

export default function PostComposer({ storeId, products, onClose, onPosted }: Props) {
  const [caption, setCaption] = useState('');
  const [connections, setConnections] = useState<SocialConnection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [productId, setProductId] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<PublishResult | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [loadingConnections, setLoadingConnections] = useState(true);

  useEffect(() => {
    apiFetch<{ connections: SocialConnection[] }>(`/api/media?action=social&op=status&storeId=${storeId}`)
      .then((status) => {
        setConnections(status.connections || []);
        setSelected((status.connections || []).map((connection) => connection.platform));
      })
      .catch(() => undefined)
      .finally(() => setLoadingConnections(false));
  }, [storeId]);

  const product = products.find((item) => String(item.id) === productId) || null;
  const productCover = product ? (product.images?.[0] || product.image_url || '') : '';
  const mediaUrls = [...(productCover ? [productCover] : []), ...photos];

  const toggle = (platform: string) => setSelected((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);

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
    if (!asDraft && !selected.length) return setError('Choose at least one platform.');
    setBusy(true);
    try {
      const response = await apiFetch<PublishResult>('/api/media?action=social', {
        method: 'POST',
        body: JSON.stringify({ op: asDraft ? 'save_draft' : 'publish', store_id: storeId, caption: caption.trim(), platforms: selected, media_urls: mediaUrls }),
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
      <p className="form-intro">Write once — StoYangu sends it to every platform you choose through Repliz.</p>
      {result ? <div className="composer-result">
        <strong>{result.mode === 'live' ? 'Posted to your accounts.' : 'Posted (demo mode).'}</strong>
        <p>{result.mode === 'live' ? 'Repliz delivered this post to each platform below.' : 'Demo mode: nothing left StoYangu, but every step below is exactly what will happen live.'}</p>
        <div className="composer-result-list">
          {Object.entries(result.results).map(([platform, info]) => <div key={platform} className={`composer-result-row ${info.ok ? 'ok' : 'fail'}`}>
            <span className="social-dot" style={{ background: PLATFORMS.find((item) => item.id === platform)?.dot || '#5a966e' }} />
            <strong>{PLATFORMS.find((item) => item.id === platform)?.label || platform}</strong>
            <small>{info.ok ? (info.external_id || 'sent') : (info.error || 'failed')}</small>
            {info.ok ? <Check /> : <X />}
          </div>)}
        </div>
        <div className="modal-actions"><button className="button-primary" onClick={onClose}>Done <Check /></button></div>
      </div> : <>
        <label className="composer-caption">Caption<textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={4} maxLength={2200} placeholder="New arrival! Stevo Home Jersey — KES 2,800. Sizes S–XXL. Order on WhatsApp!" autoFocus /><small>{caption.length} / 2200</small></label>
        <div className="composer-block">
          <strong>Post to</strong>
          {loadingConnections ? <small className="composer-hint">Checking your connected accounts…</small> : <div className="composer-platforms">
            {PLATFORMS.map((platform) => {
              const connected = connections.some((connection) => connection.platform === platform.id);
              const active = selected.includes(platform.id);
              return <button key={platform.id} type="button" className={`composer-platform ${active ? 'selected' : ''} ${connected ? '' : 'off'}`} disabled={!connected} onClick={() => toggle(platform.id)} title={connected ? (connections.find((c) => c.platform === platform.id)?.account_handle || platform.label) : 'Connect this account in the Inbox tab first'}>
                <span className="social-dot" style={{ background: platform.dot }} />{platform.label}{active && <Check />}
              </button>;
            })}
          </div>}
          {!loadingConnections && !connections.length && <small className="composer-hint">No accounts connected yet — open the Inbox tab and connect TikTok, Facebook, Instagram, YouTube or Threads first.</small>}
        </div>
        <div className="composer-block">
          <strong><Package /> Attach a product (optional)</strong>
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
        {draftSaved && <div className="form-success">Draft saved. Find it in the Inbox tab under Posts.</div>}
        {error && <div className="form-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => publish(true)} disabled={busy || uploading}>Save draft</button>
          <button className="button-primary" onClick={() => publish(false)} disabled={busy || uploading}>{busy ? 'Posting…' : 'Post now'} <Send /></button>
        </div>
      </>}
    </div>
  </Modal>;
}
