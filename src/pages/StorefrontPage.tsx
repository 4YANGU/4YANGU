import { useCallback, useEffect, useRef, useState } from 'react';
import Seo from '../components/Seo';
import type { Product, Store } from '../types';

function visitSessionId() {
  let id = sessionStorage.getItem('stoyangu-visit-session');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('stoyangu-visit-session', id); }
  return id;
}

type StorePayload = { store: Store; products: Product[]; renderedHtml: string };

export default function StorefrontPage({ forcedSlug }: { forcedSlug?: string }) {
  const slug = forcedSlug || '';
  const [data, setData] = useState<StorePayload | null>(null);
  const [error, setError] = useState('');
  const viewed = useRef(new Set<number>());

  useEffect(() => {
    let alive = true;
    fetch(`/api/storefront?action=render&slug=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      .then(async (response) => {
        const text = await response.text();
        let json: any = null;
        try { json = JSON.parse(text); } catch { /* server may have returned plain HTML for ?format=raw */ }
        if (!response.ok) throw new Error(json?.error || 'Store unavailable.');
        if (alive) setData(json as StorePayload);
      })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Store unavailable.'); });
    return () => { alive = false; };
  }, [slug]);

  useEffect(() => {
    if (!data?.store) return;
    const key = `stoyangu-visit-${data.store.id}-${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, event_type: 'visit', session_id: visitSessionId() }) }).catch(() => undefined);
  }, [data?.store, slug]);

  // Track a product view the first time a card with the seller's product id
  // enters the iframe (we listen for postMessage from the sandbox).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== 'object') return;
      const message = event.data as { type?: string; productId?: number };
      if (message.type !== 'stoyangu:product-view' || !message.productId) return;
      const id = Number(message.productId);
      if (viewed.current.has(id)) return;
      viewed.current.add(id);
      fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, event_type: 'product_view', product_id: id, session_id: visitSessionId() }) }).catch(() => undefined);
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [slug]);

  // Track WhatsApp order link clicks so the founder dashboard counter is right.
  const onOrder = useCallback((productId: number) => {
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, event_type: 'order', product_id: productId, session_id: visitSessionId() }) }).catch(() => undefined);
  }, [slug]);

  if (!data && !error) return null;
  if (error || !data) {
    return <main className="storefront-error"><img src="/stoyangu-logo.png" alt="StoYangu" /><h1>Let us open this store again.</h1><p>{error || 'Please check the store link and try again.'}</p><div><button onClick={() => window.location.reload()}>Try again</button><a href="https://wa.me/254793533683">Ask StoYangu for help</a></div></main>;
  }

  const { store, products, renderedHtml } = data;
  const rootDomain = String(import.meta.env.VITE_ROOT_DOMAIN || 'stoyangu.com');
  const canonical = window.location.hostname.endsWith(rootDomain) ? `https://${store.slug}.${rootDomain}/` : `${window.location.origin}/s/${store.slug}`;
  const heroImage = products[0]?.image_url;
  const description = `${store.name} — ${products.length} product${products.length === 1 ? '' : 's'} available. Order directly on WhatsApp.`;
  const schema = [
    { '@context': 'https://schema.org', '@type': 'OnlineStore', name: store.name, url: canonical, description, logo: store.logo_url || `${window.location.origin}/stoyangu-logo.png`, telephone: store.whatsapp, currenciesAccepted: 'KES', areaServed: { '@type': 'City', name: 'Nairobi' } },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: `${store.name} products`, numberOfItems: products.length, itemListElement: products.map((product, index) => ({ '@type': 'ListItem', position: index + 1, item: { '@type': 'Product', name: product.name, image: product.images?.length ? product.images : [product.image_url], category: product.category, offers: { '@type': 'Offer', price: Number(product.price), priceCurrency: 'KES', availability: 'https://schema.org/InStock', url: canonical } } })) },
  ];

  // The iframe is sandboxed: scripts allowed (so the founder's inline JS can
  // wire the WhatsApp order links), but NO allow-same-origin (so the page
  // can't touch our cookies, dashboard or other stores' data), and NO
  // allow-top-navigation / allow-popups-to-escape-sandbox.
  return (
    <Seo title={`${store.name} | Shop online`} description={description} canonical={canonical} image={heroImage} icon={store.logo_url || undefined} schema={schema}>
      <iframe
        title={`${store.name} storefront`}
        srcDoc={renderedHtml}
        sandbox="allow-scripts allow-forms"
        className="stoyangu-storefront-frame"
        onLoad={(event) => {
          // The iframe's own script.js calls window.parent.postMessage when a
          // product card is clicked (via a small wrapper we inject). We use
          // that to fire the order tracking ping before the wa.me link opens.
          try {
            const frameWindow = (event.target as HTMLIFrameElement).contentWindow;
            if (!frameWindow) return;
            frameWindow.addEventListener('click', (clickEvent) => {
              const target = clickEvent.target as HTMLElement | null;
              const anchor = target?.closest?.('a');
              if (anchor && /^https:\/\/wa\.me\//i.test(anchor.href)) {
                const card = target?.closest?.('.product-card') as HTMLElement | null;
                const productId = Number(card?.getAttribute('data-id')) || 0;
                if (productId) onOrder(productId);
              }
            });
          } catch { /* cross-origin guard, harmless */ }
        }}
      />
    </Seo>
  );
}
