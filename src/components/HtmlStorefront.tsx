import { useEffect, useMemo, useRef } from 'react';
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
  return String(design.storefront_html || '').trim();
}

export default function HtmlStorefront({ store, products, onOrder, onView }: Props) {
  const stored = useMemo(() => readStoredHtml(store), [store]);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data?.type) return;
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

  return (
    <div className="html-storefront-frame-wrap">
      <iframe
        ref={frame}
        className="html-storefront-frame"
        title={`${store.name} storefront`}
        src={src}
        sandbox="allow-scripts allow-popups"
        referrerPolicy="no-referrer-when-downgrade"
      />
    </div>
  );
}
