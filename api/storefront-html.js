import supabase from '../lib/db-client.js';

// Serves the app shell with per-store <title>, meta description, Open Graph/Twitter
// tags and JSON-LD structured data baked into the HTML. This is what lets Google,
// social link previews and AI crawlers (which do not run JavaScript) see every store.

const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'beta', 'admin', 'dashboard', 'manage', 'owner', 'founder', 'support', 'help', 'login']);
const SHELL_TTL_MS = 10 * 60 * 1000;
const PAGE_TTL_MS = 5 * 60 * 1000;

let shellCache = { html: '', fetchedAt: 0 };
const pageCache = new Map();

const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 55);
const escHtml = (value) => String(value ?? '').replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
const clamp = (value, max) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text; };

function rootDomain(req) {
  if (process.env.ROOT_DOMAIN) return process.env.ROOT_DOMAIN.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const host = String(req.headers.host || 'stoyangu.com').toLowerCase();
  const parts = host.replace(/^www\./, '').split('.');
  const twoPartSuffixes = new Set(['co.ke', 'or.ke', 'ac.ke', 'co.uk', 'com.au', 'co.za']);
  if (host.endsWith('.vercel.app') || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const rootLength = twoPartSuffixes.has(parts.slice(-2).join('.')) ? 3 : 2;
  return parts.slice(-rootLength).join('.');
}

async function loadShell(req) {
  if (shellCache.html && Date.now() - shellCache.fetchedAt < SHELL_TTL_MS) return shellCache.html;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const response = await fetch(`${proto}://${req.headers.host}/index.html`);
  if (!response.ok) throw new Error(`Could not load the app shell (${response.status}).`);
  shellCache = { html: await response.text(), fetchedAt: Date.now() };
  return shellCache.html;
}

function injectIntoShell(shell, { title, description, canonical, image, extra, robots = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' }) {
  let html = shell;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`);
  html = html.replace(/<meta name="description"[^>]*>/, `<meta name="description" content="${escHtml(clamp(description, 200))}" />`);
  html = html.replace(/<meta property="og:title"[^>]*>/, `<meta property="og:title" content="${escHtml(title)}" />`);
  html = html.replace(/<meta property="og:description"[^>]*>/, `<meta property="og:description" content="${escHtml(clamp(description, 300))}" />`);
  html = html.replace(/<meta property="og:image"[^>]*>/, `<meta property="og:image" content="${escHtml(image)}" />`);
  const tags = [
    `<link rel="canonical" href="${escHtml(canonical)}" />`,
    `<meta name="robots" content="${robots}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:url" content="${escHtml(canonical)}" />`,
    `<meta property="og:site_name" content="StoYangu" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escHtml(title)}" />`,
    `<meta name="twitter:description" content="${escHtml(clamp(description, 200))}" />`,
    `<meta name="twitter:image" content="${escHtml(image)}" />`,
  ];
  return html.replace('</head>', `${tags.join('\n    ')}\n    ${extra || ''}\n  </head>`);
}

async function loadStore(slug) {
  const { data: store, error } = await supabase.from('stores').select('*').eq('slug', slug).single();
  if (error || !store) return { store: null, products: [] };
  const { data: products } = await supabase.from('products').select('id,name,price,category,image_url,views_total').eq('store_id', store.id).eq('active', true).order('created_at', { ascending: false }).limit(50);
  const { data: media } = products?.length ? await supabase.from('product_images').select('product_id,url').in('product_id', products.map((product) => product.id)).order('sort_order', { ascending: true }) : { data: [] };
  const liveProducts = (products || []).map((product) => ({ ...product, images: (media || []).filter((image) => image.product_id === product.id).map((image) => image.url) }));
  return { store, products: liveProducts };
}

function buildStorePage({ store, products, canonical, root }) {
  const name = String(store.name || 'Store').trim();
  const count = products.length;
  const highlights = products.slice(0, 3).map((product) => `${product.name} (KES ${Number(product.price).toLocaleString('en-KE')})`).join(', ');
  const title = `${name} — Shop online in Nairobi`;
  const description = clamp(`Shop ${name} online. ${count ? `${count} product${count === 1 ? '' : 's'} live${highlights ? `: ${highlights}` : ''}. ` : ''}Browse the full catalogue and order directly on WhatsApp. Powered by StoYangu.`, 220);
  const image = products[0]?.images?.[0] || products[0]?.image_url || store.logo_url || `https://${root}/stoyangu-logo.png`;
  const categories = Array.isArray(store.categories) ? store.categories.filter(Boolean).map(String) : [];
  const storeLd = {
    '@context': 'https://schema.org', '@type': 'OnlineStore', name, url: canonical,
    description, image, telephone: store.whatsapp, currenciesAccepted: 'KES', paymentAccepted: 'M-Pesa, WhatsApp order',
    areaServed: { '@type': 'Country', name: 'Kenya' },
    ...(categories.length ? { knowsAbout: categories } : {}),
    foundingDate: store.created_at,
  };
  const itemListLd = {
    '@context': 'https://schema.org', '@type': 'ItemList', name: `${name} products`, numberOfItems: count,
    itemListElement: products.slice(0, 30).map((product, index) => ({
      '@type': 'ListItem', position: index + 1,
      item: { '@type': 'Product', name: product.name, image: product.images?.length ? product.images : [product.image_url].filter(Boolean), category: product.category, offers: { '@type': 'Offer', price: Number(product.price), priceCurrency: 'KES', availability: 'https://schema.org/InStock', url: canonical, seller: { '@type': 'Organization', name } } },
    })),
  };
  const breadcrumbLd = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'StoYangu', item: `https://${root}/` },
    { '@type': 'ListItem', position: 2, name, item: canonical },
  ] };
  const jsonLd = [storeLd, itemListLd, breadcrumbLd].map((schema) => `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`).join('\n    ');
  return { title, description, canonical, image, extra: jsonLd };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).send('Method not allowed');
  const slug = slugify(req.query?.slug || '');
  const root = rootDomain(req);
  try {
    const shell = await loadShell(req);
    if (!slug || RESERVED_SLUGS.has(slug)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(shell);
    }
    const cached = pageCache.get(slug);
    if (cached && Date.now() - cached.builtAt < PAGE_TTL_MS) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
      return res.status(cached.status).send(cached.html);
    }
    const { store, products } = await loadStore(slug);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
    if (!store || !store.is_active) {
      const html = injectIntoShell(shell, {
        title: 'Store unavailable | StoYangu',
        description: 'This StoYangu store is not available right now. Discover other Nairobi stores on StoYangu.',
        canonical: `https://${slug}.${root}/`, image: `https://${root}/stoyangu-logo.png`, extra: '', robots: 'noindex, follow',
      });
      pageCache.set(slug, { html, status: 404, builtAt: Date.now() });
      return res.status(404).send(html);
    }
    const canonical = `https://${slug}.${root}/`;
    const page = buildStorePage({ store, products, canonical, root });
    const html = injectIntoShell(shell, page);
    pageCache.set(slug, { html, status: 200, builtAt: Date.now() });
    return res.status(200).send(html);
  } catch (err) {
    console.error('Storefront HTML error:', err);
    // Worst case: the plain shell still boots the app entirely on the client.
    try {
      const shell = await loadShell(req);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(shell);
    } catch {
      return res.status(500).send('Could not load the store page.');
    }
  }
}
