import { useCallback, useEffect, useRef, useState } from 'react';
import HtmlStorefront from '../components/HtmlStorefront';
import Seo from '../components/Seo';
import type { Product, Store } from '../types';

// A visit equals one tab session: closing the tab and coming back later
// counts as a new visit, while refreshing inside the same tab stays one visit.
type StorefrontPayload = { store: Store; products: Product[] };

declare global {
  interface Window {
    __STOYANGU_STORE_PROMISE?: Promise<StorefrontPayload>;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isStorefrontPayload(value: unknown): value is StorefrontPayload {
  if (!isRecord(value) || !isRecord(value.store) || !Array.isArray(value.products)) return false;
  const store = value.store;
  const storeIsValid = typeof store.id === 'number'
    && typeof store.name === 'string'
    && typeof store.slug === 'string'
    && typeof store.owner_name === 'string'
    && typeof store.owner_email === 'string'
    && typeof store.whatsapp === 'string'
    && typeof store.phone === 'string'
    && typeof store.logo_url === 'string'
    && isRecord(store.design_json)
    && typeof store.is_active === 'boolean'
    && (typeof store.billing_started_at === 'string' || store.billing_started_at === null)
    && (typeof store.billing_paid_until === 'string' || store.billing_paid_until === null)
    && typeof store.visitor_total === 'number'
    && typeof store.visitor_today === 'number'
    && typeof store.orders_total === 'number'
    && typeof store.orders_today === 'number'
    && typeof store.metrics_date === 'string'
    && typeof store.created_at === 'string';
  const productsAreValid = value.products.every((product) => isRecord(product)
    && typeof product.id === 'number'
    && typeof product.store_id === 'number'
    && typeof product.name === 'string'
    && typeof product.price === 'number'
    && isStringArray(product.colors)
    && isStringArray(product.sizes)
    && typeof product.image_url === 'string'
    && isStringArray(product.images)
    && typeof product.views_total === 'number'
    && typeof product.views_today === 'number'
    && typeof product.orders_total === 'number'
    && typeof product.orders_today === 'number'
    && typeof product.metrics_date === 'string'
    && typeof product.active === 'boolean'
    && typeof product.created_at === 'string');
  return storeIsValid && productsAreValid;
}

function visitSessionId() {
  let id = sessionStorage.getItem('stoyangu-visit-session');
  if (!id) { id = crypto.randomUUID(); sessionStorage.setItem('stoyangu-visit-session', id); }
  return id;
}

export default function StorefrontPage({ forcedSlug }: { forcedSlug?: string }) {
  const slug = forcedSlug || '';
  const freshPreview = new URLSearchParams(window.location.search).has('fresh');
  const cached: StorefrontPayload | null = freshPreview ? null : (() => {
    try {
      const value = sessionStorage.getItem(`stoyangu-store-${slug}`);
      if (!value) return null;
      const parsed: unknown = JSON.parse(value);
      return isStorefrontPayload(parsed) ? parsed : null;
    } catch { return null; }
  })();
  const [data, setData] = useState<StorefrontPayload | null>(cached); const [error, setError] = useState('');
  const viewed = useRef(new Set<number>());
  useEffect(() => {
    let alive = true;
    const preload = window.__STOYANGU_STORE_PROMISE;
    const fetchFresh = async (): Promise<StorefrontPayload> => {
      const response = await fetch(`/api/stores?storefront=1&resolve=2&slug=${encodeURIComponent(slug)}`, { cache: 'no-store' });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : 'Store unavailable.';
        throw new Error(message);
      }
      if (!isStorefrontPayload(payload)) throw new Error('Store unavailable. The store data is incomplete.');
      return payload;
    };
    const request = preload ? preload.catch(fetchFresh) : fetchFresh();
    request.then((payload) => { if (alive) { setData(payload); try { sessionStorage.setItem(`stoyangu-store-${slug}`, JSON.stringify(payload)); } catch { /* Storage is optional; the live response still renders. */ } } }).catch((err) => { if (alive) setError(err instanceof Error ? err.message : 'Store unavailable.'); });
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
  const onOrder = useCallback(async (product: Product, color?: string, size?: string, fulfilment?: string, orderNote?: string, customerPhone?: string) => {
    if (!data?.store) return false;
    const phone = customerPhone || window.prompt('Enter your WhatsApp number so the store can contact you:') || '';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) { window.alert('Enter a valid WhatsApp number to place your order.'); return false; }
    try {
      const response = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug, product_id: product.id, customer_phone: phone, color, size, fulfilment, note: orderNote, order_key: crypto.randomUUID() }) });
      if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error || 'We could not confirm this order. Please try again.'); }
      return true;
    } catch (reason) { window.alert(reason instanceof Error ? reason.message : 'Could not send your order. Please try again.'); return false; }
  }, [data?.store, slug]);
  if (!data && !error) return null;
  if (error || !data) return <main className="storefront-error"><img src="/stoyangu-logo.png" alt="StoYangu" /><h1>Let us open this store again.</h1><p>{error || 'Please check the store link and try again.'}</p><div><button onClick={() => window.location.reload()}>Try again</button><a href="https://wa.me/254793533683">Ask StoYangu for help</a></div></main>;
  const design = data.store.design_json;
  const rawSections = design.sections;
  const sectionSource = Array.isArray(rawSections) ? rawSections : isRecord(rawSections) ? Object.values(rawSections) : [];
  const hero = sectionSource.find((section): section is Record<string, unknown> => isRecord(section) && /home|hero|welcome/i.test(String(section.id || section.type || section.name || '')));
  const description = String(hero?.tagline || hero?.body || hero?.intro || `${data.store.name} online store. Browse live products and place a website order using your phone number.`).replace(/[—–]/g, ',').slice(0, 300);
  const rootDomain = String(import.meta.env.VITE_ROOT_DOMAIN || 'stoyangu.com');
  const canonical = window.location.hostname.endsWith(rootDomain) ? `https://${data.store.slug}.${rootDomain}/` : `${window.location.origin}/s/${data.store.slug}`;
  const schema = [
    { '@context': 'https://schema.org', '@type': 'OnlineStore', name: String(design.store_name || data.store.name), url: canonical, description, logo: data.store.logo_url || `${window.location.origin}/stoyangu-logo.png`, telephone: data.store.whatsapp, currenciesAccepted: 'KES', areaServed: { '@type': 'City', name: 'Nairobi' } },
    { '@context': 'https://schema.org', '@type': 'ItemList', name: `${data.store.name} products`, numberOfItems: data.products.length, itemListElement: data.products.map((product, index) => ({ '@type': 'ListItem', position: index + 1, item: { '@type': 'Product', name: product.name, image: product.images?.length ? product.images : [product.image_url], offers: { '@type': 'Offer', price: Number(product.price), priceCurrency: 'KES', availability: 'https://schema.org/InStock', url: canonical } } })) },
  ];
  return <><Seo title={`${String(design.store_name || data.store.name)} | Shop online`} description={description} canonical={canonical} image={data.products[0]?.images?.[0] || data.products[0]?.image_url || data.store.logo_url} icon={data.store.logo_url || undefined} schema={schema} /><HtmlStorefront store={data.store} products={data.products} onOrder={onOrder} onView={onView} /></>;
}

