import { useEffect, useMemo, useRef, useState } from 'react';
import StorefrontRenderer from './StorefrontRenderer';
import type { Product, Store } from '../types';
import '../html-storefront.css';

type Props = {
  store: Store;
  products: Product[];
  onOrder: (product: Product, color?: string, size?: string, fulfilment?: string, note?: string) => void;
  onView: (id: number) => void;
};

function readStoredHtml(store: Store) {
  const design = store.design_json || {};
  return String((design as Record<string, unknown>).storefront_html || '').trim();
}

export default function HtmlStorefront({ store, products, onOrder, onView }: Props) {
  const stored = useMemo(() => readStoredHtml(store), [store]);
  const frame = useRef<HTMLIFrameElement>(null);
  // FIX (stoyangu-500): the old page left customers staring at a dead frame
  // when a storefront load failed halfway (e.g. a renderer crash on a heavy
  // page) — the only recovery was a manual full-page reload. The live grid
  // inside the frame always announces itself on boot (visit track / phone
  // handshake), so if nothing arrives within 12s we show a one-tap "reload
  // store" pill that remounts just the frame. Invisible on healthy loads.
  const [frameKey, setFrameKey] = useState(0);
  const [showReload, setShowReload] = useState(false);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = false;
    setShowReload(false);
    if (!stored) return;
    const timer = window.setTimeout(() => {
      if (!alive.current) setShowReload(true);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [stored, store.slug, frameKey]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data?.type) return;
      alive.current = true;
      setShowReload(false);
      if (event.data.type === 'stoyangu-phone-get') frame.current?.contentWindow?.postMessage({ type: 'stoyangu-phone-value', value: localStorage.getItem('stoyangu-customer-phone') || '' }, '*');
      if (event.data.type === 'stoyangu-phone-set') localStorage.setItem('stoyangu-customer-phone', String(event.data.value || ''));
      if (event.data.type === 'stoyangu-track') fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: store.slug, event_type: event.data.event_type, product_id: Number(event.data.product_id || 0), session_id: String(event.data.session_id || '') }) }).catch(() => undefined);
      if (event.data.type === 'stoyangu-open-whatsapp') {
        // Wame fix: the sandboxed storefront iframe cannot reliably open
        // WhatsApp itself (phones block the popup after the async order
        // confirmation), so it hands the link to this parent page. Top-level
        // navigation always works. Before navigating, verify the number: if
        // it looks unusable (e.g. the founder changed the store's WhatsApp
        // number), rebuild the link from the freshest store record.
        const requested = String(event.data.url || '');
        if (!/^https:\/\/wa\.me\//.test(requested)) return;
        const go = (finalUrl: string) => { window.location.assign(finalUrl); };
        const digits = requested.split('?')[0].replace(/\D/g, '');
        if (digits.length >= 9) { go(requested); return; }
        fetch(`/api/stores?storefront=1&fresh=1&slug=${encodeURIComponent(store.slug)}`, { cache: 'no-store' })
          .then((response) => response.json())
          .then((payload) => {
            const phone = String(payload?.store?.whatsapp || '').replace(/\D/g, '');
            if (phone.length >= 9) {
              const textPart = requested.includes('?text=') ? `?text=${requested.split('?text=')[1]}` : '';
              go(`https://wa.me/${phone}${textPart}`);
            } else {
              window.alert('Your order has been sent to the store, but the store\'s WhatsApp number looks incomplete. The owner will see your order and contact you.');
            }
          })
          .catch(() => go(requested));
      }
      if (event.data.type === 'stoyangu-order-submit') {
        const requestId = String(event.data.requestId || '');
        const order = event.data.order || {};
        fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...order, slug: store.slug }) })
          .then(async (response) => { const payload = await response.json().catch(() => ({})); frame.current?.contentWindow?.postMessage({ type: 'stoyangu-order-result', requestId, ok: response.ok, error: payload.error }, '*'); })
          .catch(() => frame.current?.contentWindow?.postMessage({ type: 'stoyangu-order-result', requestId, ok: false, error: 'Could not confirm this order.' }, '*'));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [store.slug]);

  if (!stored) {
    return <StorefrontRenderer store={store} products={products} onOrder={onOrder} onView={onView} />;
  }

  const src = `/api/storefront?action=render&slug=${encodeURIComponent(store.slug)}&format=raw&fresh=1&runtime=popup-v3`;

  const reloadFrame = () => {
    alive.current = false;
    setShowReload(false);
    setFrameKey((key) => key + 1);
  };

  return (
    <div className="html-storefront-frame-wrap">
      <iframe
        key={frameKey}
        ref={frame}
        className="html-storefront-frame"
        title={`${store.name} storefront`}
        src={src}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        referrerPolicy="no-referrer-when-downgrade"
        onError={reloadFrame}
      />
      {showReload && (
        <div style={{ position: 'fixed', left: 0, right: 0, bottom: 22, zIndex: 60, display: 'flex', justifyContent: 'center', padding: '0 16px', pointerEvents: 'none' }}>
          <button
            type="button"
            onClick={reloadFrame}
            style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 10, border: 0, borderRadius: 999, padding: '13px 22px', background: '#17261f', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', boxShadow: '0 14px 40px rgba(0,0,0,.35)' }}
          >
            Store is taking too long — tap to reload
          </button>
        </div>
      )}
    </div>
  );
}
