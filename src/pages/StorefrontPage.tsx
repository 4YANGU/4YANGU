import { useCallback, useEffect, useRef, useState } from 'react';
import HtmlStorefront from '../components/HtmlStorefront';
import Seo from '../components/Seo';
import type { Product, Store } from '../types';

// A visit equals one tab session: closing the tab and coming back later
// counts as a new visit, while refreshing inside the same tab stays one visit.
function visitSessionId() {
  let id = sessionStorage.getItem('stoyangu-visit-session');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('stoyangu-visit-session', id); }
  return id;
}

export default function StorefrontPage({ forcedSlug }: { forcedSlug?: string }) {
  const slug = forcedSlug || '';
  const freshPreview = new URLSearchParams(window.location.search).has('fresh');
  const cached = freshPreview ? null : (() => { try { const value = sessionStorage.getItem(`stoyangu-store-${slug}`); return value ? JSON.parse(value) : null; } catch { return null; } })();
  const [data, setData] = useState<{ store: Store; products: Product[] } | null>(cached); const [error, setError] = useState('');
  const viewed = useRef(new Set<number>());
  useEffect(() => {
    let alive = true;
    const preload = (window as any).__STOYANGU_STORE_PROMISE as Promise<any> | undefined;
    const fetchFresh = () => fetch(`/api/stores?storefront=1&resolve=2&slug=${encodeURIComponent(slug)}`, { cache: 'no-store' }).then(async (response) => { const payload = await response.json(); if (!response.ok) throw new Error(payload.error); return payload; });
    const request = preload ? preload.catch(fetchFresh) : fetchFresh();
    request.then((payload) => { if (alive) { setData(payload); try { sessionStorage.setItem(`stoyangu-store-${slug}`, JSON.stringify(payload)); } catch {} } }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Store unavailable.'); });
    return () => { alive = false; };
  }, [slug]);
  useEffect(() => {
    if (!data?.store) return;
    const key = `stoyangu-visit-${data.store.id}-${new Date().toISOString().slice(0, 10)}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, event_type: 'visit', session_id: visitSessionId() }) }).catch(() => undefined);
  }, [data?.store, slug]);
  const onView = useCallback((productId: number) => { if (viewed.current.has(productId)) return; viewed.current.add(productId); fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, event_type: 'product_view', product_id: productId, session_id: visitSessionId() }) }).catch(() => undefined); }, [slug]);
  const onOrder = useCallback((product: Product, color?: string, size?: string, fulfilment?: string, orderNote?: string, customerPhone?: string) => {
    if (!data?.store) return;
    const orderKey = crypto.randomUUID();
    fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({ slug, product_id: product.id, customer_phone: customerPhone, color, size, fulfilment, note: orderNote, order_key: orderKey }) }).catch(() => undefined);
    const design = data.store.design_json as Record<string, any>;
    const template = design?.commerce_rules?.whatsapp_message_template || design?.sections?.find?.((section: any) => section?.product_page)?.product_page?.whatsapp_message_template;
    const fallback = `Hi ${data.store.name}! I want to order ${product.name} (${formatPrice(product.price)})${size ? ` in size ${size}` : ''}${color ? `, colour ${color}` : ''}.\nMy phone: ${customerPhone || ''}\nFulfilment: ${fulfilment || 'Delivery'}${orderNote ? `\nCustomer note: ${orderNote}` : ''}\nPlease confirm availability.`;
    const templated = typeof template === 'string' ? template
      .replaceAll('{product_name}', product.name)
      .replaceAll('{product_price}', formatPrice(product.price))
      .replaceAll('{selected_size}', size || 'not selected')
      .replaceAll('{selected_colour}', color || 'not selected')
      .replaceAll('{fulfilment_method}', fulfilment || 'Delivery')
      .replaceAll('{order_note}', orderNote || 'None') : fallback;
    const message = typeof template === 'string' && !template.includes('{fulfilment_method}') ? `${templated}\nMy phone: ${customerPhone || ''}\nFulfilment: ${fulfilment || 'Delivery'}${orderNote ? `\nCustomer note: ${orderNote}` : ''}` : `${templated}\nMy phone: ${customerPhone || ''}`;
    const phone = data.store.whatsapp.replace(/\D/g, '');
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.location.assign(url);
  }, [data?.store, slug]);
  if (!data && !error) return null;
  if (error || !data) return <main className="storefront-error"><img src="/stoyangu-logo.png" alt="StoYangu" /><h1>Let us open this store again.</h1><p>{error || 'Please check the store link and try again.'}</p><div><button onClick={() => window.location.reload()}>Try again</button><a href="https://wa.me/254793533683">Ask StoYangu for help</a></div></main>;
  const design = data.store.design_json as Record<string, any>;
  const sectionSource = Array.isArray(design.sections) ? design.sections : design.sections && typeof design.sections === 'object' ? Object.values(design.sections) : [];
  const hero = sectionSource.find((section: any) => /home|hero|welcome/i.test(String(section?.id || section?.type || section?.name || ''))) as any;
  const description = String(hero?.tagline || hero?.body || hero?.intro || `${data.store.name} online store. Browse live products and order directly through WhatsApp.`).replace(/[—–]/g, ',').slice(0, 300);
  const rootDomain = String(import.meta.env.VITE_ROOT_DOMAIN || 'stoyangu.com');
  const canonical = window.location.hostname.endsWith(rootDomain) ? `https://${data.store.slug}.${rootDomain}/` : `${window.location.origin}/s/${data.store.slug}`;
  const schema = [
    { '@context': 'https://schema.org', '@type': 'OnlineStore', name: String(design.store_name || data.store.name), url: canonical, description, logo: data.store.logo_url || `${window.location.origin}/stoyangu-logo.png`, telephone: data.store.whatsapp, currenciesAccepted: 'KES', areaServed: { '@type': 'City', name: 'Nairobi' } },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: `${data.store.name} products`, numberOfItems: data.products.length, itemListElement: data.products.map((product, index) => ({ '@type': 'ListItem', position: index + 1, item: { '@type': 'Product', name: product.name, image: product.images?.length ? product.images : [product.image_url], category: product.category, offers: { '@type': 'Offer', price: Number(product.price), priceCurrency: 'KES', availability: 'https://schema.org/InStock', url: canonical } } })) },
  ];
  return <><Seo title={`${String(design.store_name || data.store.name)} | Shop online`} description={description} canonical={canonical} image={data.products[0]?.images?.[0] || data.products[0]?.image_url || data.store.logo_url} icon={data.store.logo_url || undefined} schema={schema} /><HtmlStorefront store={data.store} products={data.products} onOrder={onOrder} onView={onView} /></>;
}

function formatPrice(value: number | string) {
  return `KES ${Number(value || 0).toLocaleString('en-KE')}`;
}
