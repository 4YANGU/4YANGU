// api/storefront.js
// =========================================================================
//  StoYangu storefront system
//
//  Founder-facing: POST ?action=save      → validate + persist a pasted HTML template
//                  POST ?action=preview   → render with placeholder data
//  Public-facing:  GET  ?slug=…           → render with live products, served as text/html
//                  GET  ?slug=…&format=json → render as JSON for the iframe srcDoc
//
//  Security model: the template is scanned for forbidden patterns
//  (fetch, XHR, eval, cookie/storage access, off-domain script srcs /
//  off-domain assets). The final page is served inside a sandboxed iframe
//  on the public site as a second line of defence.
// =========================================================================

import supabase from '../lib/db-client.js';

const ALLOWED_OUTBOUND = /^https:\/\/(wa\.me|t\.me|instagram\.com|www\.instagram\.com|facebook\.com|www\.facebook\.com|threads\.net|www\.threads\.net|twitter\.com|x\.com|www\.x\.com|youtube\.com|www\.youtube\.com|youtu\.be|tiktok\.com|www\.tiktok\.com|maps\.google\.com|goo\.gl\/maps)/i;
const ALLOWED_LINK_SCHEMES = /^(https:\/\/wa\.me|https:\/\/t\.me|https:\/\/(www\.)?(instagram|facebook|threads|twitter|x|youtube|tiktok)\.com|tel:|mailto:)/i;
const FORBIDDEN_SCRIPT_PATTERNS = [
  { label: 'fetch() call',           regex: /\bfetch\s*\(/i },
  { label: 'XMLHttpRequest',         regex: /\bXMLHttpRequest\b/ },
  { label: 'eval() call',            regex: /\beval\s*\(/ },
  { label: 'Function constructor',   regex: /\bnew\s+Function\s*\(/ },
  { label: 'document.cookie',        regex: /document\s*\.\s*cookie/i },
  { label: 'localStorage access',    regex: /\blocalStorage\b/ },
  { label: 'sessionStorage access',  regex: /\bsessionStorage\b/ },
  { label: 'navigator.sendBeacon',   regex: /sendBeacon\s*\(/i },
  { label: 'WebSocket',              regex: /\bnew\s+WebSocket\s*\(/i },
  { label: 'EventSource (SSE)',      regex: /\bnew\s+EventSource\s*\(/i },
  { label: 'importScripts',          regex: /\bimportScripts\s*\(/i },
  { label: 'postMessage (cross)',    regex: /\.postMessage\s*\(/i },
];
const MAX_HTML_BYTES = 500_000;

// ---------------------------------------------------------------------------
// Security scan
// ---------------------------------------------------------------------------
function scanHtml(rawHtml) {
  const errors = [];
  if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
    return { ok: false, errors: ['Template is empty.'] };
  }
  if (Buffer.byteLength(rawHtml, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, errors: [`Template is larger than ${Math.round(MAX_HTML_BYTES / 1024)} KB.`] };
  }

  // Pull out all <script> blocks (inline) and all <script src=...> attributes
  const scriptSrcPattern = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = scriptSrcPattern.exec(rawHtml)) !== null) {
    const src = m[1].trim();
    if (!src.startsWith('data:')) errors.push(`Off-domain <script src="${src}"> is not allowed. Inline scripts only.`);
  }
  const scriptBlocks = [...rawHtml.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const inlineScript = scriptBlocks.join('\n');
  for (const { label, regex } of FORBIDDEN_SCRIPT_PATTERNS) {
    if (regex.test(inlineScript)) errors.push(`Found forbidden ${label} inside a <script> block.`);
  }
  // Also block any <script src=> that the wider regex might have missed
  // by stripping comments first.
  const stripped = rawHtml.replace(/<!--[\s\S]*?-->/g, '');
  if (/<script\b[^>]*\bsrc\s*=\s*["']https?:/i.test(stripped)) {
    errors.push('Found a <script src="https?://…"> reference — inline scripts only.');
  }

  // External resource scan: <img src>, <link href>, url( in inline styles, @import, @font-face
  const imgPattern = /<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  while ((m = imgPattern.exec(rawHtml)) !== null) {
    const src = m[1].trim();
    if (src.startsWith('data:') || src.startsWith('blob:')) continue;
    if (src.startsWith('//')) { errors.push(`Off-domain <img src="${src}"> is not allowed.`); continue; }
    if (/^https?:\/\//i.test(src) && !ALLOWED_OUTBOUND.test(src)) errors.push(`Off-domain <img src="${src}"> is not allowed.`);
  }
  const linkPattern = /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  while ((m = linkPattern.exec(rawHtml)) !== null) {
    const href = m[1].trim();
    if (href.startsWith('data:') || href.startsWith('blob:')) continue;
    if (/^https?:\/\//i.test(href) && !ALLOWED_OUTBOUND.test(href)) errors.push(`Off-domain <link href="${href}"> is not allowed.`);
  }
  if (/@import\b/i.test(stripped)) errors.push('Found @import in styles — upload fonts to your own site or use a system font stack.');
  if (/@font-face\b/i.test(stripped)) errors.push('Found @font-face — use a system font stack or inline a base64 woff2.');
  // url() in inline styles
  const urlPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/g;
  while ((m = urlPattern.exec(stripped)) !== null) {
    const ref = m[1].trim();
    if (ref.startsWith('data:') || ref.startsWith('#') || ref.startsWith('blob:')) continue;
    if (ref.startsWith('//')) { errors.push(`Off-domain url("${ref}") is not allowed.`); continue; }
    if (/^https?:\/\//i.test(ref) && !ALLOWED_OUTBOUND.test(ref)) errors.push(`Off-domain url("${ref}") is not allowed.`);
  }
  // Outbound links inside <a href>: only wa.me / tel: / allowed socials
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  while ((m = anchorPattern.exec(rawHtml)) !== null) {
    const href = m[1].trim();
    if (href.startsWith('#') || href.startsWith('data:') || href.startsWith('blob:') || href.startsWith('javascript:')) {
      if (href.startsWith('javascript:')) errors.push('javascript: links are not allowed.');
      continue;
    }
    if (ALLOWED_LINK_SCHEMES.test(href)) continue;
    if (/^https?:\/\//i.test(href) && ALLOWED_OUTBOUND.test(href)) continue;
    if (/^https?:\/\//i.test(href) || /^tel:/i.test(href) || /^mailto:/i.test(href)) continue; // generic tel:/mailto:
    errors.push(`Link "${href}" points off-domain. Only wa.me, tel:, mailto:, and approved social links are allowed.`);
  }

  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------
function findProductCardBlock(html) {
  // Find the FIRST element with class containing "product-card" — this is the
  // template that gets duplicated for each real product.
  const m = html.match(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-card\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/i);
  if (!m) return null;
  return m[0];
}
function findPopupBlock(html) {
  // The popup/modal — fixed structure with data-attributes we fill in.
  const m = html.match(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-popup\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/i);
  return m ? m[0] : null;
}
function structureCheck(html) {
  const errors = [];
  const card = findProductCardBlock(html);
  if (!card) errors.push('No .product-card element found. The template must include a repeatable product card with class "product-card".');
  const popup = findPopupBlock(html);
  if (!popup) errors.push('No .product-popup element found. The template must include a hidden popup with class "product-popup".');
  if (card) {
    // Must have at least the data-name / data-price / data-image attributes
    // so the renderer knows where to fill values in.
    for (const attr of ['data-name', 'data-price', 'data-image']) {
      if (!new RegExp(`\\b${attr}\\s*=\\s*["']`).test(card)) errors.push(`The product-card is missing the required attribute ${attr}.`);
    }
  }
  if (popup) {
    for (const attr of ['data-popup-image', 'data-popup-name', 'data-popup-price', 'data-whatsapp']) {
      if (!new RegExp(`\\b${attr}\\s*=\\s*["']`).test(popup)) errors.push(`The product-popup is missing the required attribute ${attr}.`);
    }
  }
  return { ok: errors.length === 0, errors, card, popup };
}

// ---------------------------------------------------------------------------
// Renderer: takes a template + a list of products, returns filled HTML
// ---------------------------------------------------------------------------
function escapeAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatPrice(value) {
  const num = Number(value || 0);
  return `KES ${num.toLocaleString('en-KE')}`;
}
function buildCard(cardTemplate, product) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image_url ? [product.image_url] : []);
  const primaryImage = images[0] || '';
  const colors = Array.isArray(product.colors) ? product.colors.filter(Boolean) : [];
  const sizes = Array.isArray(product.sizes) ? product.sizes.filter(Boolean) : [];
  let card = cardTemplate;
  card = card.replace(/(\bdata-id\s*=\s*")[^"]*(")/i, `$1${escapeAttr(product.id)}$2`);
  card = card.replace(/(\bdata-name\s*=\s*")[^"]*(")/i, `$1${escapeAttr(product.name)}$2`);
  card = card.replace(/(\bdata-price\s*=\s*")[^"]*(")/i, `$1${escapeAttr(formatPrice(product.price))}$2`);
  card = card.replace(/(\bdata-image\s*=\s*")[^"]*(")/i, `$1${escapeAttr(primaryImage)}$2`);
  card = card.replace(/(\bdata-colors\s*=\s*")[^"]*(")/i, `$1${escapeAttr(colors.join('|'))}$2`);
  card = card.replace(/(\bdata-sizes\s*=\s*")[^"]*(")/i, `$1${escapeAttr(sizes.join('|'))}$2`);
  // Also fill any visible text inside the card so the template author can rely on either path.
  card = card.replace(/(\bclass\s*=\s*["'][^"']*\bproduct-name\b[^"']*["'][^>]*>)([\s\S]*?)(<\/[a-z][a-z0-9]*>)/i, (_, open, _mid, close) => `${open}${escapeAttr(product.name)}${close}`);
  card = card.replace(/(\bclass\s*=\s*["'][^"']*\bproduct-price\b[^"']*["'][^>]*>)([\s\S]*?)(<\/[a-z][a-z0-9]*>)/i, (_, open, _mid, close) => `${open}${escapeAttr(formatPrice(product.price))}${close}`);
  return card;
}

function renderTemplate(templateHtml, store, products) {
  const cardMatch = templateHtml.match(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-card\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/i);
  if (!cardMatch) return { html: templateHtml, warnings: ['No .product-card block to duplicate.'] };
  const cardBlock = cardMatch[0];

  // Build the per-product cards (hidden until the template's JS reveals them).
  const cards = products.map((product) => buildCard(cardBlock, product)).join('\n');

  // Replace the single card template with a wrapper <div data-products> that
  // contains all the duplicated cards. The template's CSS/JS can target
  // [data-products] .product-card to style each one the same way.
  const wrapperOpen = `<div data-products data-store-slug="${escapeAttr(store.slug)}">`;
  const wrapperClose = `</div>`;
  const newHtml = templateHtml.replace(cardBlock, `${wrapperOpen}\n${cards}\n${wrapperClose}`);

  // Stamp the store name + WhatsApp base into a small inline <meta> so the
  // template's own JS can read it via document.querySelector('meta[name="stoyangu-store"]').
  const storeMeta = `<meta name="stoyangu-store" data-slug="${escapeAttr(store.slug)}" data-name="${escapeAttr(store.name)}" data-whatsapp="${escapeAttr(String(store.whatsapp || '').replace(/\D/g, ''))}" data-currency="KES">`;
  const stamped = newHtml.replace(/<head>/i, `<head>${storeMeta}`);

  return { html: stamped, warnings: [] };
}

// ---------------------------------------------------------------------------
// Founder auth helper
// ---------------------------------------------------------------------------
async function authFounder(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).eq('role', 'founder').single();
  return profile ? { ...profile, user } : null;
}

// ---------------------------------------------------------------------------
// Default starter template — used when a store has nothing custom yet.
// ---------------------------------------------------------------------------
const DEFAULT_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>{{STORE_NAME}}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8f5ef;color:#101f30}
  .header{background:#101f30;color:#fff;padding:18px 22px;display:flex;align-items:center;justify-content:space-between}
  .header h1{margin:0;font-size:20px;letter-spacing:.04em}
  .header .pill{font-size:11px;background:rgba(255,255,255,.12);padding:4px 10px;border-radius:999px;letter-spacing:.08em;text-transform:uppercase}
  .hero{padding:48px 22px;text-align:center;background:linear-gradient(135deg,#0b1826 0%,#1c3a5e 100%);color:#f3ecdd}
  .hero h2{margin:0 0 8px;font-size:32px;letter-spacing:-.02em}
  .hero p{margin:0;opacity:.8}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:20px;padding:32px 22px;max-width:1200px;margin:0 auto}
  .product-card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 8px 24px rgba(11,24,38,.08);cursor:pointer;transition:transform .2s,box-shadow .2s;display:flex;flex-direction:column}
  .product-card:hover{transform:translateY(-3px);box-shadow:0 16px 36px rgba(11,24,38,.14)}
  .product-card img{width:100%;aspect-ratio:1/1;object-fit:cover;background:#e6dcc8}
  .product-card .body{padding:14px 16px 18px}
  .product-card .product-name{margin:0 0 6px;font-weight:700;font-size:16px}
  .product-card .product-price{margin:0;color:#5a966e;font-weight:600}
  .product-card .meta{margin-top:8px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#8a8475}
  .product-popup{position:fixed;inset:0;background:rgba(11,24,38,.7);display:none;align-items:center;justify-content:center;padding:20px;z-index:50}
  .product-popup.open{display:flex}
  .product-popup .dialog{background:#fff;border-radius:18px;max-width:480px;width:100%;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4)}
  .product-popup .popup-image{width:100%;aspect-ratio:1/1;object-fit:cover;background:#e6dcc8}
  .product-popup .content{padding:20px 22px 24px}
  .product-popup h3{margin:0 0 6px;font-size:22px}
  .product-popup .popup-price{margin:0 0 14px;color:#5a966e;font-weight:700}
  .product-popup label{display:block;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#66746b;margin:12px 0 6px}
  .product-popup select,.product-popup input{width:100%;padding:10px 12px;border:1px solid #d6cfc1;border-radius:10px;font:inherit}
  .product-popup .order{margin-top:18px;display:block;width:100%;padding:14px;background:#25D366;color:#fff;border:0;border-radius:12px;font-weight:700;font-size:15px;cursor:pointer;text-align:center;text-decoration:none}
  .empty{padding:48px 22px;text-align:center;color:#66746b}
</style>
</head>
<body>
<header class="header"><h1>{{STORE_NAME}}</h1><span class="pill">Powered by StoYangu</span></header>
<section class="hero"><h2 data-store-tagline>Welcome to {{STORE_NAME}}</h2><p>Tap any product to order on WhatsApp.</p></section>
<main>
  <!-- ONE product-card template. The app duplicates this for every live product. -->
  <article class="product-card" data-id="" data-name="" data-price="" data-image="" data-colors="" data-sizes="" tabindex="0">
    <img alt="" data-image />
    <div class="body">
      <p class="product-name">Product</p>
      <p class="product-price">KES 0</p>
      <p class="meta">Tap to order</p>
    </div>
  </article>
  <!-- /product-card template -->

  <!-- Hidden product popup — template's JS fills it from the clicked card. -->
  <div class="product-popup" data-popup-image data-popup-name data-popup-price data-whatsapp role="dialog" aria-modal="true">
    <div class="dialog">
      <img class="popup-image" alt="" data-popup-image />
      <div class="content">
        <h3 data-popup-name>Product</h3>
        <p class="popup-price" data-popup-price>KES 0</p>
        <label>Colour <select data-color><option value="">Choose…</option></select></label>
        <label>Size <select data-size><option value="">Choose…</option></select></label>
        <a class="order" data-whatsapp href="#" target="_blank" rel="noopener">Order on WhatsApp</a>
      </div>
    </div>
  </div>
</main>
<script>
(function () {
  // The store meta is stamped in by the server. Read it once.
  var meta = document.querySelector('meta[name="stoyangu-store"]');
  var slug = meta && meta.getAttribute('data-slug');
  var storeName = meta && meta.getAttribute('data-name');
  var phoneDigits = (meta && meta.getAttribute('data-whatsapp') || '').replace(/\\D/g, '');
  var currency = (meta && meta.getAttribute('data-currency')) || 'KES';

  // Patch the visible store name on the page (anywhere text says {{STORE_NAME}}).
  document.querySelectorAll('[data-store-tagline]').forEach(function (el) { el.textContent = 'Welcome to ' + storeName; });

  // Wire up each product card → open popup with the card's data.
  var popup = document.querySelector('.product-popup');
  var popupImage = popup.querySelector('[data-popup-image]');
  var popupName = popup.querySelector('[data-popup-name]');
  var popupPrice = popup.querySelector('[data-popup-price]');
  var popupColor = popup.querySelector('[data-color]');
  var popupSize = popup.querySelector('[data-size]');
  var popupOrder = popup.querySelector('[data-whatsapp]');
  var lastCard = null;

  function openCard(card) {
    lastCard = card;
    var name = card.getAttribute('data-name') || 'Product';
    var price = card.getAttribute('data-price') || '';
    var image = card.getAttribute('data-image') || '';
    var colors = (card.getAttribute('data-colors') || '').split('|').filter(Boolean);
    var sizes = (card.getAttribute('data-sizes') || '').split('|').filter(Boolean);

    popupImage.setAttribute('src', image);
    popupName.textContent = name;
    popupPrice.textContent = price;

    popupColor.innerHTML = '<option value="">Choose…</option>' + colors.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    popupSize.innerHTML = '<option value="">Choose…</option>' + sizes.map(function (s) { return '<option>' + s + '</option>'; }).join('');

    var message = 'Hi ' + storeName + '! I want to order ' + name + ' (' + price + ').';
    var href = 'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent(message);
    popupOrder.setAttribute('href', href);

    popup.classList.add('open');
  }
  function closePopup() { popup.classList.remove('open'); }

  document.addEventListener('click', function (event) {
    var card = event.target.closest && event.target.closest('.product-card');
    if (card) { openCard(card); return; }
    if (event.target === popup) closePopup();
  });
  document.addEventListener('keyup', function (event) { if (event.key === 'Escape') closePopup(); });

  // Update WhatsApp message when colour or size changes
  popupColor.addEventListener('change', rebuildMessage);
  popupSize.addEventListener('change', rebuildMessage);
  function rebuildMessage() {
    if (!lastCard) return;
    var name = lastCard.getAttribute('data-name') || 'Product';
    var price = lastCard.getAttribute('data-price') || '';
    var colour = popupColor.value;
    var size = popupSize.value;
    var message = 'Hi ' + storeName + '! I want to order ' + name + ' (' + price + ')'
      + (size ? ' in size ' + size : '')
      + (colour ? ', colour ' + colour : '') + '.';
    popupOrder.setAttribute('href', 'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent(message));
  }
})();
</script>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
// One-shot migration: add the storefront_template column on first hit.
// Supabase exposes the service-role client; an ALTER TABLE through the REST
// API isn't allowed, so we use a tiny Postgres function we create on demand.
let _migrated = false;
async function ensureColumn() {
  if (_migrated) return;
  try {
    await supabase.rpc('stoyangu_add_storefront_template_column').then(() => { _migrated = true; }).catch(async () => {
      // RPC doesn't exist yet — create it via a SQL REST call (pg-meta endpoint).
      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/pg/meta`;
      const sql = `ALTER TABLE stores ADD COLUMN IF NOT EXISTS storefront_template text;`;
      const result = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` },
        body: JSON.stringify({ query: sql }),
      });
      if (result.ok) _migrated = true;
    });
  } catch { /* harmless if it already exists */ }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    await ensureColumn();
    const action = String(req.query?.action || (req.method === 'POST' ? 'save' : 'render'));

    // ----------------------------------------------------------------- save
    if (action === 'save' && req.method === 'POST') {
      const profile = await authFounder(req);
      if (!profile) return res.status(403).json({ error: 'Founder access required.' });
      const storeId = Number(req.body?.store_id);
      if (!storeId) return res.status(400).json({ error: 'Store is required.' });
      const html = String(req.body?.template ?? '');
      const security = scanHtml(html);
      if (!security.ok) return res.status(400).json({ error: 'Security check failed.', details: security.errors });
      const structure = structureCheck(html);
      if (!structure.ok) return res.status(400).json({ error: 'Structure check failed.', details: structure.errors });
      const { data, error } = await supabase
        .from('stores')
        .update({ storefront_template: html, updated_at: new Date().toISOString() })
        .eq('id', storeId)
        .select('id,name,slug,storefront_template')
        .single();
      if (error) throw error;
      return res.status(200).json({ ok: true, store: data });
    }

    // ------------------------------------------------------------ preview
    if (action === 'preview' && req.method === 'POST') {
      const profile = await authFounder(req);
      if (!profile) return res.status(403).json({ error: 'Founder access required.' });
      const storeId = Number(req.body?.store_id);
      if (!storeId) return res.status(400).json({ error: 'Store is required.' });
      const override = String(req.body?.template ?? '');
      const { data: store, error: storeError } = await supabase.from('stores').select('*').eq('id', storeId).single();
      if (storeError || !store) return res.status(404).json({ error: 'Store not found.' });
      const { data: products } = await supabase.from('products').select('*').eq('store_id', storeId).eq('active', true).order('created_at', { ascending: false });
      const liveProducts = (products || []).slice(0, 6).map((product) => ({ ...product, images: product.image_url ? [product.image_url] : [] }));
      const template = override.trim() || store.storefront_template || DEFAULT_TEMPLATE.replace(/{{STORE_NAME}}/g, store.name);
      const rendered = renderTemplate(template, store, liveProducts);
      return res.status(200).json({ html: rendered.html, warnings: rendered.warnings });
    }

    // ----------------------------------------------------------- default template
    if (action === 'default' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ template: DEFAULT_TEMPLATE });
    }

    // ----------------------------------------------------------- prompt (for the founder)
    if (action === 'prompt' && req.method === 'GET') {
      const storeId = Number(req.query?.store_id);
      let name = 'My Store', products = 'the products you sell', whatsapp = '+254700000000';
      if (storeId) {
        const { data: store } = await supabase.from('stores').select('name,whatsapp').eq('id', storeId).single();
        if (store) { name = store.name; whatsapp = store.whatsapp; }
      }
      return res.status(200).json({ prompt: buildPrompt(name, products, whatsapp) });
    }

    // ----------------------------------------------------------- public render
    if (action === 'render' || (req.method === 'GET' && (req.query?.slug || req.query?.storefront === '1'))) {
      const slug = String(req.query?.slug || '');
      if (!slug) return res.status(400).json({ error: 'slug is required.' });
      const { data: store, error: storeError } = await supabase
        .from('stores')
        .select('*')
        .eq('is_active', true)
        .eq('slug', slug)
        .single();
      if (storeError || !store) return res.status(404).json({ error: 'Store not found.' });
      const { data: products } = await supabase.from('products').select('*').eq('store_id', store.id).eq('active', true).order('created_at', { ascending: false });
      const liveProducts = (products || []).map((product) => ({ ...product, images: product.image_url ? [product.image_url] : [] }));
      const template = String(store.storefront_template || '').trim() || DEFAULT_TEMPLATE.replace(/{{STORE_NAME}}/g, store.name);
      const rendered = renderTemplate(template, store, liveProducts);
      // Two formats: JSON (default, used by StorefrontPage.tsx for the React
      // wrapper, schema.org, analytics) and raw HTML (used by direct iframe
      // embeds and the marketing site preview).
      if (String(req.query?.format) === 'raw') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
        return res.status(200).send(rendered.html);
      }
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
      return res.status(200).json({ store, products: liveProducts, renderedHtml: rendered.html });
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=save | preview | render | prompt | default' });
  } catch (err) {
    console.error('storefront api error:', err);
    res.status(500).json({ error: err.message || 'Internal error' });
  }
}

// ---------------------------------------------------------------------------
// The single prompt shown in the Founder Dashboard
// ---------------------------------------------------------------------------
function buildPrompt(storeName, products, ownerWhatsApp) {
  return `You are designing a SINGLE-FILE storefront for a Kenyan social-shop called "${storeName}" that sells ${products}. The owner sells via WhatsApp (number: ${ownerWhatsApp}).

Produce ONE self-contained HTML document. All CSS goes inside one <style> in the <head>, all JS inside one <script> at the end of <body>. No external stylesheets, no external scripts, no web fonts, no @import, no @font-face. The only outbound network access your page may perform is the final WhatsApp order link.

MANDATORY STRUCTURE — the StoYangu app will inject real products into the page, so this contract is non-negotiable:

1. One repeatable product CARD block. Tag it with class="product-card" on the wrapping element. The element MUST include these empty data-attributes (the app fills them per real product):
     data-id, data-name, data-price, data-image, data-colors, data-sizes
   Inside the card, use <p class="product-name"> and <p class="product-price"> for the visible name/price (the app fills the text too, so the placeholders are just "Product" and "KES 0"). Use <img data-image /> or a <img src=""> — both work, the app patches whichever you used.

2. One hidden POPUP/MODAL block. Tag it class="product-popup". It must include these data-attributes on the wrapper:
     data-popup-image, data-popup-name, data-popup-price, data-whatsapp
   Inside the popup, an <img data-popup-image />, an <h3 data-popup-name>, a <p data-popup-price>, two <select> elements (one with data-color, one with data-size), and an <a data-whatsapp href="#">Order on WhatsApp</a> button.

3. Inside the <head>, the StoYangu app will inject a <meta name="stoyangu-store" data-slug="…" data-name="…" data-whatsapp="…" data-currency="KES"> tag. Your inline JS reads this meta to know the store's name, the owner's WhatsApp digits, and to build wa.me order links.

4. Your inline JS must:
   - On click of any .product-card, copy that card's data-name / data-price / data-image / data-colors / data-sizes into the popup (image src, name text, price text, dropdown options).
   - Set the popup's WhatsApp button href to "https://wa.me/" + the meta's data-whatsapp + "?text=" + a friendly message that includes the product name, the price, and any selected colour or size.
   - Close the popup on background click or Escape key.
   - That is ALL your JS may do. No fetch, no XMLHttpRequest, no localStorage, no document.cookie, no external scripts, no postMessage to other windows.

5. Style freely — make it look like a real Kenyan shop (warm earth tones or modern minimal). Mobile-first, fast, accessible. Use system font stack so no font files are needed.

IMAGES: use only https permanent image hosts (images.unsplash.com, images.pexels.com, cdn.pixabay.com) or your own uploaded assets. Avoid temp hosts (tmpfiles.org etc.) — they expire in hours. If you reference an image in a product-card, it will be REPLACED with the seller's real product photo at runtime, so a placeholder URL is fine for the template.

DELIVERY: paste the complete single HTML file back. Do not split into multiple files. Do not include build steps. Do not include a README. Just the one .html document.`;
}
