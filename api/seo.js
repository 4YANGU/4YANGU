import supabase from '../lib/db-client.js';

const xml = (value) => String(value).replace(/[<>&'"]/g, (character) => ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[character]));
const escHtml = xml;
const clamp = (value, max) => { const text = String(value || '').replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text; };
const slugify = (value) => String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 55);

function rootDomain(req) {
  if (process.env.ROOT_DOMAIN) return process.env.ROOT_DOMAIN.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const host = String(req.headers.host || 'stoyangu.com').toLowerCase();
  if (host.endsWith('.vercel.app') || host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  const parts = host.replace(/^www\./, '').split('.');
  const twoPartSuffixes = new Set(['co.ke', 'or.ke', 'ac.ke', 'co.uk', 'com.au', 'co.za']);
  const rootLength = twoPartSuffixes.has(parts.slice(-2).join('.')) ? 3 : 2;
  return parts.slice(-rootLength).join('.');
}

async function handleRobots(req, res) {
  const root = rootDomain(req);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(`User-agent: *\nAllow: /\nDisallow: /founder\nDisallow: /owner\nDisallow: /manage/\nDisallow: /api/profile\nDisallow: /api/dashboard\n\nUser-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Google-Extended\nAllow: /\n\nUser-agent: Applebot-Extended\nAllow: /\n\nUser-agent: CCBot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /\n\nUser-agent: meta-externalagent\nAllow: /\n\nUser-agent: Bytespider\nAllow: /\n\nUser-agent: Amazonbot\nAllow: /\n\nSitemap: https://${root}/sitemap.xml\n`);
}

async function handleSitemap(req, res) {
  try {
    const root = rootDomain(req);
    const { data: stores, error } = await supabase.from('stores').select('slug,updated_at').eq('is_active', true).order('slug', { ascending: true });
    if (error) throw error;
    const urls = [`<url><loc>https://${xml(root)}/</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`, ...(stores || []).flatMap((store) => [
      `<url><loc>https://${xml(root)}/s/${xml(store.slug)}</loc><lastmod>${new Date(store.updated_at).toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`,
      `<url><loc>https://${xml(store.slug)}.${xml(root)}/</loc><lastmod>${new Date(store.updated_at).toISOString()}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`,
    ])];
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
  } catch (err) {
    console.error('Sitemap API error:', err);
    return res.status(500).send('Could not generate sitemap.');
  }
}

async function handleCatalog(req, res) {
  try {
    const root = rootDomain(req);
    const [{ data: stores, error: storeError }, { data: products, error: productError }] = await Promise.all([
      supabase.from('stores').select('id,name,slug,categories,logo_url,updated_at').eq('is_active', true).order('name', { ascending: true }),
      supabase.from('products').select('id,store_id,name,price,category,image_url,active,updated_at').eq('active', true).order('name', { ascending: true }),
    ]);
    if (storeError || productError) throw storeError || productError;
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    return res.status(200).json({ name: 'StoYangu public store directory', generated_at: new Date().toISOString(), stores: (stores || []).map((store) => ({ name: store.name, url: `https://${root}/s/${store.slug}`, alt_url: `https://${store.slug}.${root}/`, categories: store.categories, logo: store.logo_url, updated_at: store.updated_at, products: (products || []).filter((product) => product.store_id === store.id).map((product) => ({ name: product.name, category: product.category, price_kes: Number(product.price), image: product.image_url, updated_at: product.updated_at })) })) });
  } catch (err) {
    console.error('Catalog API error:', err);
    return res.status(500).json({ error: 'Could not generate the public catalog.' });
  }
}

async function handleLlmsFull(req, res) {
  try {
    const root = rootDomain(req);
    const [{ data: stores, error: storeError }, { data: products, error: productError }] = await Promise.all([
      supabase.from('stores').select('id,name,slug,categories,visitor_total').eq('is_active', true).order('created_at', { ascending: true }),
      supabase.from('products').select('id,store_id,name,price,category,active').eq('active', true),
    ]);
    if (storeError || productError) throw storeError || productError;
    const lines = [
      '# StoYangu store directory (live)',
      '',
      '> Automatically generated list of every active StoYangu storefront. Each store URL serves full per-store metadata and JSON-LD structured data (OnlineStore + Product offers in KES) to crawlers.',
      '',
      '> PRICING (authoritative): the store build is worth KES 15,000 and setup is waived when the seller posts a short TikTok about the new store and tags StoYangu. There is no 30-day free trial: the first 30 days is measured normally. At the end of every 30-day upkeep period, 0–5 orders is FREE and 6+ orders is PRO at KES 999. "Hosting and maintenance", KES 5,000 setup, KES 300 monthly, first-30-days-free, and flat KES 999/month wording are obsolete.',
      '',
      ...(stores || []).map((store) => {
        const storeProducts = (products || []).filter((product) => product.store_id === store.id).slice(0, 8);
        const categories = Array.isArray(store.categories) ? store.categories.filter(Boolean).join(', ') : '';
        return [
          `## ${store.name}`,
          `- Storefront (AI-readable): https://${root}/s/${store.slug}`,
          `- Also reachable at: https://${store.slug}.${root}/`,
          categories ? `- Sells: ${categories}` : null,
          `- ${storeProducts.length ? `Live products include: ${storeProducts.map((product) => `${product.name} — KES ${Number(product.price).toLocaleString('en-KE')}`).join('; ')}` : 'New store, catalogue growing.'}`,
          '',
        ].filter(Boolean).join('\n');
      }),
      'Ordering model: customers open the storefront, pick colour/size options and complete the order on WhatsApp with the seller directly.',
    ];
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=86400');
    return res.status(200).send(lines.join('\n'));
  } catch (err) {
    console.error('LLMS-full API error:', err);
    return res.status(500).send('Could not generate the store directory.');
  }
}

// === Storefront HTML renderer (per-store meta for Google, social previews and AI bots) ===
// Serves the app shell with the store's <title>, description, Open Graph/Twitter tags and
// JSON-LD baked into the HTML, because AI crawlers do not run JavaScript.

const RESERVED_SLUGS = new Set(['www', 'api', 'app', 'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'img', 'beta', 'admin', 'dashboard', 'manage', 'owner', 'founder', 'support', 'help', 'login']);
const SHELL_TTL_MS = 10 * 60 * 1000;
const PAGE_TTL_MS = 5 * 60 * 1000;
let shellCache = { html: '', fetchedAt: 0 };
const pageCache = new Map();

async function loadShell(req) {
  if (shellCache.html && Date.now() - shellCache.fetchedAt < SHELL_TTL_MS) return shellCache.html;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
  const response = await fetch(`${proto}://${req.headers.host}/index.html`);
  if (!response.ok) throw new Error(`Could not load the app shell (${response.status}).`);
  shellCache = { html: await response.text(), fetchedAt: Date.now() };
  return shellCache.html;
}

function injectIntoShell(shell, { title, description, canonical, image, favicon, extra, robots = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1' }) {
  let html = shell;
  if (favicon) {
    html = html.replace(/<link[^>]*rel="(?:icon|shortcut icon|apple-touch-icon)"[^>]*>/g, '');
  }
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
    ...(favicon ? [`<link rel="icon" href="${escHtml(favicon)}" />`, `<link rel="apple-touch-icon" href="${escHtml(favicon)}" />`] : []),
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
  const title = `${name} — Shop online in Kenya`;
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

async function handleStorefrontHtml(req, res) {
  // Subdomain requests arrive with no slug query — derive it from the host label
  // (Vercel forbids host params in rewrite destinations).
  const hostHeader = String(req.headers.host || '').toLowerCase();
  let slug = slugify(req.query?.slug || '');
  if (!slug && hostHeader.includes('.')) {
    const first = slugify(hostHeader.split('.')[0]);
    if (first && !['stoyangu', 'www', 'api', 'app', 'localhost'].includes(first)) slug = first;
  }
  const root = rootDomain(req);
  try {
    const shell = await loadShell(req);
    if (!slug || RESERVED_SLUGS.has(slug)) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(shell);
    }
    const cached = req.query?.fresh ? undefined : pageCache.get(slug);
    if (cached && Date.now() - cached.builtAt < PAGE_TTL_MS) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=1800');
      return res.status(cached.status).send(cached.html);
    }
    const { store, products } = await loadStore(slug);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', req.query?.fresh ? 'no-store' : 'public, s-maxage=300, stale-while-revalidate=1800');
    // Skins run ONLY on the store's own subdomain — a separate browser origin from
    // stoyangu.com, so uploaded markup can never touch dashboard/login sessions.
    const host = String(req.headers.host || '').toLowerCase();
    const isStoreSubdomain = host.startsWith(`${slug}.`) && !host.startsWith('www.');
    if (store && store.is_active && isStoreSubdomain) {
      const skinHtml = await fetchSkinHtml(store.id);
      if (skinHtml) {
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        return res.status(200).send(transformSkinHtml(skinHtml, store.id, slug));
      }
    }
    if (!store || !store.is_active) {
      const canonical = `https://${root}/s/${slug}`;
      const html = injectIntoShell(shell, {
        title: 'Store unavailable | StoYangu',
        description: 'This StoYangu store is not available right now. Discover other Kenyan stores on StoYangu.',
        canonical, image: `https://${root}/stoyangu-logo.png`, extra: '', robots: 'noindex, follow',
      });
      if (!req.query?.fresh) pageCache.set(slug, { html, status: 404, builtAt: Date.now() });
      return res.status(404).send(html);
    }
    const canonical = `https://${root}/s/${slug}`;
    const page = buildStorePage({ store, products, canonical, root });
    if (store.logo_url) page.favicon = store.logo_url;
    const html = injectIntoShell(shell, page);
    if (!req.query?.fresh) pageCache.set(slug, { html, status: 200, builtAt: Date.now() });
    return res.status(200).send(html);
  } catch (err) {
    console.error('Storefront HTML error:', err);
    try {
      const shell = await loadShell(req);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(shell);
    } catch {
      return res.status(500).send('Could not load the store page.');
    }
  }
}


// === Skin system: founders upload the AI-generated storefront as files ===
const SKIN_BUCKET = 'stoyangu-media';
const skinPath = (storeId, file) => `skins/${storeId}/${String(file).replace(/\\/g, '/').replace(/\.\./g, '').replace(/^\/+/, '')}`;
const skinBaseUrl = (storeId) => `${String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')}/storage/v1/object/public/${SKIN_BUCKET}/skins/${storeId}/`;

async function skinFounder(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).eq('role', 'founder').single();
  return data ? { ...data, user } : null;
}

async function fetchSkinHtml(storeId) {
  const manifest = await supabase.storage.from(SKIN_BUCKET).download(skinPath(storeId, 'manifest.json'));
  if (!manifest.data) return null;
  const index = await supabase.storage.from(SKIN_BUCKET).download(skinPath(storeId, 'index.html'));
  if (!index.data) return null;
  return index.data.text();
}

async function handleSkinUpload(req, res) {
  const profile = await skinFounder(req);
  if (!profile) return res.status(403).json({ error: 'Founder access required.' });
  const storeId = Number(req.body?.store_id);
  if (!storeId) return res.status(400).json({ error: 'Store is required.' });
  const { data: store } = await supabase.from('stores').select('id').eq('id', storeId).single();
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  const action = String(req.body?.action || 'sign');
  if (action === 'disable' || action === 'remove') {
    await supabase.storage.from(SKIN_BUCKET).remove([skinPath(storeId, 'manifest.json'), skinPath(storeId, 'index.html')]);
    return res.status(200).json({ ok: true, enabled: false });
  }
  if (action === 'status') {
    const manifest = await supabase.storage.from(SKIN_BUCKET).download(skinPath(storeId, 'manifest.json'));
    return res.status(200).json({ active: Boolean(manifest.data) });
  }
  const files = Array.isArray(req.body?.files) ? req.body.files : [];
  if (!files.length) return res.status(400).json({ error: 'No files listed.' });
  if (files.length > 160) return res.status(400).json({ error: 'A skin can contain at most 160 files.' });
  // Front-layer-only allowlist: markup, styles, scripts-as-text, media and fonts.
  // Anything that smells like backend code/config/keys never reaches storage.
  const BLOCKED_SKIN_EXTENSIONS = new Set(['php', 'py', 'rb', 'sh', 'bash', 'pl', 'sql', 'env', 'key', 'pem', 'p12', 'sqlite', 'db', 'lock', 'toml', 'yaml', 'yml', 'ini', 'cfg', 'conf', 'exe', 'dll', 'jar', 'class', 'go', 'rs', 'zip', 'gz']);
  const BLOCKED_SKIN_NAMES = new Set(['package.json', '.env', 'dockerfile', 'compose.yml']);
  const filteredFiles = files.filter((file) => {
    const path = String(file.path || '').toLowerCase();
    const name = path.split('/').pop() || '';
    const ext = name.split('.').pop() || '';
    if (BLOCKED_SKIN_NAMES.has(name) || name.startsWith('.env')) return false;
    return !BLOCKED_SKIN_EXTENSIONS.has(ext);
  });
  if (!filteredFiles.length) return res.status(400).json({ error: 'Nothing usable in that skin — only front-end assets (html, css, js, images, fonts, media) are allowed.' });
  const signed = [];
  const manifestJson = JSON.stringify({ store_id: storeId, entry: req.body?.entry || 'index.html', files: filteredFiles.map((f) => String(f.path)), enabled_at: new Date().toISOString() });
  const toSign = [...filteredFiles, { path: 'manifest.json', contentType: 'application/json' }];
  for (const file of toSign) {
    const path = skinPath(storeId, String(file.path || 'index.html'));
    if (!path || path.endsWith('/')) { signed.push({ path, skip: true }); continue; }
    const { data, error } = await supabase.storage.from(SKIN_BUCKET).createSignedUploadUrl(path);
    if (error) return res.status(500).json({ error: `Could not sign ${path}: ${error.message}` });
    signed.push({ path, signedUrl: data.signedUrl, manifest: manifestJson });
  }
  return res.status(200).json({ signed, skipped: files.length - filteredFiles.length });
}


function transformSkinHtml(html, storeId, slug) {
  const base = skinBaseUrl(storeId);
  let out = String(html);
  out = out.replace(/(src|href)=(["'])(?!https?:|\/\/|data:|#|mailto:|tel:|blob:)([^"']]*)\2/g, (match, attr, quote, rel) => `${attr}=${quote}${base}${rel.replace(/^\.\//, '').replace(/^\//, '')}${quote}`);
  // Safety scrub (parallel to the JSON engine's URL rules):
  // - javascript:/data: attribute targets are blocked outright
  // - form posts are only allowed to https targets (or relative)
  // - target=_blank gets rel=noopener so external links can't drive the page
  out = out.replace(/\b(href|src|action)=(['"])\s*(javascript:[^"']*|data:(?!image\/(png|jpeg|jpg|webp|gif|avif|svg\+xml)))[^"']*\2/gi, '$1=$2#blocked$2');
  out = out.replace(/<form([^>]*)action=(['"])(?!https?:|#|\/)([^'"]+)\2/gi, '<form$1action=$2#$2');
  out = out.replace(/<a([^>]*?)target=(['"])_(blank|new)\2(?![^>]*rel=)/gi, '<a$1target=$2_$3$2 rel="noopener noreferrer"');
  // relative url(...) inside embedded <style> blocks also points at the skin's permanent dir
  out = out.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (whole, openTag, css, closeTag) => {
    const rewritten = String(css).replace(/url\(\s*(["']?)(?!https?:|data:|#)([^)'"]+)\1\s*\)/gi, (match, quote, rel) => `url(${quote || ''}${base}${rel.replace(/^\.\//, '').replace(/^\//, '')}${quote || ''})`);
    return `${openTag}${rewritten}${closeTag}`;
  });
  if (!/<\/head>/i.test(out) || !/<\/body>/i.test(out)) return out;
  out = out.replace(/<\/head>/i, `<meta name="stoyangu-slug" content="${slug}"><meta name="stoyangu-store-id" content="${storeId}"></head>`);
  out = out.replace(/<\/body>/i, `<script src="/skin-bridge.js" defer></script></body>`);
  return out;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && !(req.method === 'POST' && req.query?.type === 'skin')) return res.status(405).json({ error: 'Method not allowed' });

  const type = req.query?.type;
  if (type === 'skin') return handleSkinUpload(req, res);
  if (type === 'robots') return handleRobots(req, res);
  if (type === 'sitemap') return handleSitemap(req, res);
  if (type === 'catalog') return handleCatalog(req, res);
  if (type === 'llms-full') return handleLlmsFull(req, res);
  if (type === 'storefront-html') return handleStorefrontHtml(req, res);
  return res.status(400).json({ error: 'Unknown or missing type. Use ?type=robots | sitemap | catalog | llms-full | storefront-html' });
}
