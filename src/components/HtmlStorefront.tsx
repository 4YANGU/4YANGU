import { useEffect, useMemo, useRef, useState } from 'react';
import StorefrontRenderer from './StorefrontRenderer';
import type { Product, Store } from '../types';
import '../html-storefront.css';

type Props = {
  store: Store;
  products: Product[];
  onOrder: (product: Product, color?: string, size?: string, fulfilment?: string, note?: string, customerPhone?: string) => Promise<boolean>;
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
  const [reloadForFrame, setReloadForFrame] = useState<{ key: number; slug: string; html: string } | null>(null);
  const alive = useRef(false);

  useEffect(() => {
    alive.current = false;
    if (!stored) return;
    const timer = window.setTimeout(() => {
      if (!alive.current) setReloadForFrame({ key: frameKey, slug: store.slug, html: stored });
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [stored, store.slug, frameKey]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data?.type) return;
      alive.current = true;
      setReloadForFrame(null);
      if (event.data.type === 'stoyangu-phone-get') frame.current?.contentWindow?.postMessage({ type: 'stoyangu-phone-value', value: localStorage.getItem('stoyangu-customer-phone') || '' }, '*');
      if (event.data.type === 'stoyangu-phone-set') localStorage.setItem('stoyangu-customer-phone', String(event.data.value || ''));
      if (event.data.type === 'stoyangu-track') fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: store.slug, event_type: event.data.event_type, product_id: Number(event.data.product_id || 0), session_id: String(event.data.session_id || '') }) }).catch(() => undefined);
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
    setReloadForFrame(null);
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
      {reloadForFrame?.key === frameKey && reloadForFrame.slug === store.slug && reloadForFrame.html === stored && (
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
