// api/storefront.js
// =========================================================================
//  StoYangu storefront system
//
//  Founder-facing: POST ?action=save      → auto-fix + persist a pasted HTML template
//                  POST ?action=preview   → render the pasted HTML live
//  Public-facing:  GET  ?action=render&slug=… → render with live products as JSON
//                  GET  ?action=render&slug=…&format=raw → same, but text/html
//                  GET  ?action=default  → starter template (only used for the
//                                          "Load starter template" button in the
//                                          dashboard so the founder has a starting
//                                          point if they don't have AI-generated HTML)
//                  GET  ?action=prompt   → the AI prompt text for one store
//                  GET  ?action=prompt-generic → the AI prompt text (no store)
//
//  Storage: the storefront HTML lives at stores.design_json->>storefront_html.
//  The design_json column already exists on every store and is JSONB, so we
//  don't need a Postgres migration. The save call merges the new HTML into
//  the existing design_json object — all the other design fields are kept.
//
//  Security: the pasted HTML is auto-fixed (off-domain images, dangerous
//  scripts, javascript: links, etc. are all neutralised in place). The
//  endpoint only rejects what it genuinely cannot make safe (off-domain
//  iframe src, base href, object data).
// =========================================================================

import supabase from '../lib/db-client.js';

const ALLOWED_OUTBOUND = /^https:\/\/(wa\.me|t\.me|instagram\.com|www\.instagram\.com|facebook\.com|www\.facebook\.com|threads\.net|www\.threads\.net|twitter\.com|x\.com|www\.x\.com|youtube\.com|www\.youtube\.com|youtu\.be|tiktok\.com|www\.tiktok\.com|maps\.google\.com|goo\.gl\/maps|supabase\.co|wzcttkjydjvflkwjijcq\.supabase\.co)/i;
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
const MAX_HTML_BYTES = 1_500_000;

// ---------------------------------------------------------------------------
// Security + repair — strips / neutralises anything dangerous in place
// and returns the safe HTML plus a notes array describing what changed.
// ---------------------------------------------------------------------------
function scanAndRepair(rawHtml) {
  const notes = [];
  if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
    return { ok: false, errors: ['Template is empty. Paste your HTML in the textarea and try again.'], html: rawHtml, notes };
  }
  if (Buffer.byteLength(rawHtml, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, errors: [`Template is larger than ${Math.round(MAX_HTML_BYTES / 1024)} KB. Shorten it and try again.`], html: rawHtml, notes };
  }

  let html = rawHtml;

  // 1) <script src="https?://…"> — strip the src attribute entirely.
  const beforeScriptSrc = html;
  html = html.replace(/<script\b([^>]*?)\bsrc\s*=\s*["'][^"']*["']([^>]*?)>/gi, (full, before, after) => {
    notes.push('Removed off-domain <script src>.');
    return `<script${before}${after}>`;
  });
  void beforeScriptSrc;

  // 2) Empty <script> blocks (had a src, now empty) — drop the whole block.
  html = html.replace(/<script\b[^>]*>\s*<\/script>/gi, (full) => {
    notes.push('Removed an empty <script> block (had an off-domain src).');
    return '';
  });

  // 3) Inline scripts — neutralise the truly dangerous APIs in place.
  html = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_full, attrs, body) => {
    let patched = body;
    const subs = [
      { from: /\bfetch\s*\(/g,                to: 'void fetch(', label: 'fetch()' },
      { from: /\bnew\s+XMLHttpRequest\b/g,    to: 'null /* XHR removed */', label: 'XMLHttpRequest' },
      { from: /\bXMLHttpRequest\b/g,          to: 'null /* XHR removed */', label: 'XMLHttpRequest' },
      { from: /\beval\s*\(/g,                 to: 'void eval(', label: 'eval()' },
      { from: /\bnew\s+Function\s*\(/g,       to: 'void new Function(', label: 'new Function()' },
      { from: /document\s*\.\s*cookie\b/gi,   to: 'document.cookie /* cleared */ = ""', label: 'document.cookie' },
      { from: /\blocalStorage\b/g,            to: 'null /* localStorage removed */', label: 'localStorage' },
      { from: /\bsessionStorage\b/g,          to: 'null /* sessionStorage removed */', label: 'sessionStorage' },
      { from: /\bsendBeacon\s*\(/g,           to: 'void sendBeacon(', label: 'sendBeacon' },
      { from: /\bnew\s+WebSocket\s*\(/g,      to: 'null /* WebSocket removed */', label: 'WebSocket' },
      { from: /\bnew\s+EventSource\s*\(/g,    to: 'null /* EventSource removed */', label: 'EventSource' },
      { from: /\bimportScripts\s*\(/g,        to: 'void importScripts(', label: 'importScripts' },
      { from: /\.postMessage\s*\(/g,          to: '.postMessage /* cross-frame */(', label: 'postMessage' },
    ];
    for (const { from, to, label } of subs) {
      if (from.test(patched)) {
        patched = patched.replace(from, to);
        if (!notes.some((note) => note.includes(label))) notes.push(`Neutralised ${label} in inline script.`);
      }
    }
    return `<script${attrs}>${patched}</script>`;
  });

  // 4) <img src="https?://…"> for non-allowed hosts → swap to a neutral
  //    placeholder image (a tiny inline SVG so layout doesn't break).
  const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="100%" height="100%" fill="#e6dcc8"/><text x="50%" y="50%" font-size="18" text-anchor="middle" fill="#8a8475" font-family="system-ui">image</text></svg>');
  html = html.replace(/<img\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*?)>/gi, (full, before, src, after) => {
    const trimmed = src.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/')) return full;
    if (/^https?:\/\//i.test(trimmed) && ALLOWED_OUTBOUND.test(trimmed)) return full;
    if (trimmed.startsWith('//')) {
      notes.push(`Replaced protocol-relative <img src> with a placeholder.`);
      return `<img${before}src="${PLACEHOLDER_IMG}"${after}>`;
    }
    if (/^https?:\/\//i.test(trimmed)) {
      notes.push(`Replaced off-domain <img src="${trimmed}"> with a placeholder.`);
      return `<img${before}src="${PLACEHOLDER_IMG}"${after}>`;
    }
    return full;
  });

  // 5) <link href="https?://…"> for non-allowed hosts → drop the link.
  html = html.replace(/<link\b[^>]*?>/gi, (full) => {
    const hrefMatch = /<link\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/i.exec(full);
    if (!hrefMatch) return full;
    const href = hrefMatch[1].trim();
    if (!href || href.startsWith('data:') || href.startsWith('blob:') || href.startsWith('/')) return full;
    if (/^https?:\/\//i.test(href) && ALLOWED_OUTBOUND.test(href)) return full;
    if (/^https?:\/\//i.test(href)) {
      notes.push(`Dropped <link href="${href}"> (off-domain).`);
      return '';
    }
    return full;
  });

  // 6) @import and @font-face in inline styles → drop the lines.
  html = html.replace(/@import[^;]*;/gi, (full) => { notes.push('Removed @import.'); return ''; });
  html = html.replace(/@font-face\s*\{[^}]*\}/gi, () => { notes.push('Removed @font-face.'); return ''; });

  // 7) url() in inline styles for off-domain → drop the declaration.
  html = html.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/g, (full, ref) => {
    const trimmed = ref.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#') || trimmed.startsWith('blob:') || trimmed.startsWith('/')) return full;
    if (/^https?:\/\//i.test(trimmed) && ALLOWED_OUTBOUND.test(trimmed)) return full;
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
      notes.push(`Removed off-domain url("${trimmed}") from inline styles.`);
      return '/* url() removed for safety */';
    }
    return full;
  });

  // 8) <a href="javascript:…"> → strip the dangerous scheme.
  html = html.replace(/<a\b([^>]*?)\bhref\s*=\s*["']javascript:[^"']*["']([^>]*?)>/gi, (full, before, after) => {
    notes.push('Removed a javascript: link.');
    return `<a${before}href="#"${after}>`;
  });

  // 9) <a href="https?://…"> for non-allowed hosts → replace with #.
  html = html.replace(/<a\b([^>]*?)\bhref\s*=\s*["'](https?:\/\/[^"']+)["']([^>]*?)>/gi, (full, before, href, after) => {
    if (ALLOWED_OUTBOUND.test(href)) return full;
    if (ALLOWED_LINK_SCHEMES.test(href)) return full;
    notes.push(`Replaced off-domain link (${href}) with #.`);
    return `<a${before}href="#"${after}>`;
  });

  // 10) Things we genuinely can't make safe — reject with a clear message.
  const errors = [];
  const iframeMatch = html.match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  if (iframeMatch && /^https?:\/\//i.test(iframeMatch[1]) && !ALLOWED_OUTBOUND.test(iframeMatch[1])) {
    errors.push(`Off-domain <iframe src="${iframeMatch[1]}"> can't be embedded safely. Replace it with a placeholder <div> or remove the iframe.`);
  }
  const objectMatch = html.match(/<object\b[^>]*\bdata\s*=\s*["']([^"']+)["']/i);
  if (objectMatch && /^https?:\/\//i.test(objectMatch[1]) && !ALLOWED_OUTBOUND.test(objectMatch[1])) {
    errors.push(`Off-domain <object data="${objectMatch[1]}"> can't be embedded safely.`);
  }
  const baseMatch = html.match(/<base\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i);
  if (baseMatch && /^https?:\/\//i.test(baseMatch[1]) && !ALLOWED_OUTBOUND.test(baseMatch[1])) {
    errors.push(`<base href="${baseMatch[1]}"> is off-domain — it would hijack every relative link. Remove the <base> tag.`);
  }

  if (errors.length) return { ok: false, errors, html, notes };
  return { ok: true, errors: [], html, notes };
}

// ---------------------------------------------------------------------------
// Structural validation
// ---------------------------------------------------------------------------
function findProductCardBlock(html) {
  const m = html.match(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-card\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/i);
  if (!m) return null;
  return m[0];
}
function findPopupBlock(html) {
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
// Renderer
// ---------------------------------------------------------------------------
function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  card = card.replace(/(\bclass\s*=\s*["'][^"']*\bproduct-name\b[^"']*["'][^>]*>)([\s\S]*?)(<\/[a-z][a-z0-9]*>)/i, (_, open, _mid, close) => `${open}${escapeAttr(product.name)}${close}`);
  card = card.replace(/(\bclass\s*=\s*["'][^"']*\bproduct-price\b[^"']*["'][^>]*>)([\s\S]*?)(<\/[a-z][a-z0-9]*>)/i, (_, open, _mid, close) => `${open}${escapeAttr(formatPrice(product.price))}${close}`);
  return card;
}
function renderTemplate(templateHtml, store, products) {
  const cardMatch = templateHtml.match(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-card\b[^"']*["'][^>]*>[\s\S]*?<\/\1>/i);
  if (!cardMatch) return { html: templateHtml, warnings: ['No .product-card block to duplicate.'] };
  const cardBlock = cardMatch[0];
  const cards = products.map((product) => buildCard(cardBlock, product)).join('\n');
  const wrapperOpen = `<div data-products data-store-slug="${escapeAttr(store.slug)}">`;
  const wrapperClose = `</div>`;
  const newHtml = templateHtml.replace(cardBlock, `${wrapperOpen}\n${cards}\n${wrapperClose}`);
  const phoneDigits = String(store.whatsapp || '').replace(/\D/g, '');
  const storeMeta = `<meta name="stoyangu-store" data-slug="${escapeAttr(store.slug)}" data-name="${escapeAttr(store.name)}" data-whatsapp="${phoneDigits}" data-currency="KES">`;
  const stamped = newHtml.replace(/<head>/i, `<head>${storeMeta}`);
  return { html: stamped, warnings: [] };
}

// ---------------------------------------------------------------------------
// Storage helpers — read/write the storefront HTML inside design_json
// ---------------------------------------------------------------------------
function readStorefrontHtml(store) {
  const design = store && typeof store.design_json === 'object' && store.design_json ? store.design_json : {};
  return String(design.storefront_html || '').trim();
}
function withStorefrontHtml(store, html) {
  const design = store && typeof store.design_json === 'object' && store.design_json ? { ...store.design_json } : {};
  design.storefront_html = html;
  return design;
}

// ---------------------------------------------------------------------------
// Founder auth
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
// Default starter template — only used by the "Load starter template" button
// in the dashboard so the founder has a starting point. NEVER served as the
// live page; an empty storefront_template now shows a calm "no template yet"
// message instead.
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
  <article class="product-card" data-id="" data-name="" data-price="" data-image="" data-colors="" data-sizes="" tabindex="0">
    <img alt="" data-image />
    <div class="body">
      <p class="product-name">Product</p>
      <p class="product-price">KES 0</p>
      <p class="meta">Tap to order</p>
    </div>
  </article>
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
  var meta = document.querySelector('meta[name="stoyangu-store"]');
  var slug = meta && meta.getAttribute('data-slug');
  var storeName = meta && meta.getAttribute('data-name');
  var phoneDigits = (meta && meta.getAttribute('data-whatsapp') || '').replace(/\\D/g, '');
  document.querySelectorAll('[data-store-tagline]').forEach(function (el) { el.textContent = 'Welcome to ' + storeName; });
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
    popupColor.innerHTML = '<option value=\"\">Choose…</option>' + colors.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    popupSize.innerHTML = '<option value=\"\">Choose…</option>' + sizes.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    var message = 'Hi ' + storeName + '! I want to order ' + name + ' (' + price + ').';
    var href = 'https://wa.me/' + phoneDigits + '?text=' + encodeURIComponent(message);
    popupOrder.setAttribute('href', href);
  }
  function closePopup() { popup.classList.remove('open'); }
  document.addEventListener('click', function (event) {
    var card = event.target.closest && event.target.closest('.product-card');
    if (card) { openCard(card); return; }
    if (event.target === popup) closePopup();
  });
  document.addEventListener('keyup', function (event) { if (event.key === 'Escape') closePopup(); });
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

const NO_TEMPLATE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Store coming soon | StoYangu</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8f5ef;color:#101f30;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
  .card{max-width:480px;background:#fff;border-radius:18px;padding:36px 32px;box-shadow:0 30px 80px rgba(11,24,38,.12);text-align:center}
  h1{margin:0 0 8px;font-size:24px;color:#101f30}
  p{margin:0 0 20px;color:#66746b;font-size:15px;line-height:1.5}
  a.btn{display:inline-block;background:#25D366;color:#fff;text-decoration:none;padding:14px 24px;border-radius:12px;font-weight:700;font-size:15px}
</style>
</head>
<body>
  <div class="card">
    <h1>This store is getting ready</h1>
    <p>The owner hasn't finished setting up the storefront yet. Please check back soon, or message us on WhatsApp and we'll let them know.</p>
    <a class="btn" href="https://wa.me/254793533683?text=Hi%20StoYangu%2C%20I%27m%20trying%20to%20visit%20a%20store%20that%20isn%27t%20ready%20yet.">Message StoYangu</a>
  </div>
</body>
</html>`;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();

  try {
    const action = String(req.query?.action || (req.method === 'POST' ? 'save' : 'render'));

    // ----------------------------------------------------------------- save
    if (action === 'save' && req.method === 'POST') {
      const profile = await authFounder(req);
      if (!profile) return res.status(403).json({ error: 'Founder access required.' });
      const storeId = Number(req.body?.store_id);
      if (!storeId) return res.status(400).json({ error: 'Store is required.' });
      const { data: storeRow, error: storeErr } = await supabase.from('stores').select('id,name,slug,whatsapp,design_json').eq('id', storeId).single();
      if (storeErr || !storeRow) return res.status(404).json({ error: 'Store not found.' });
      const html = String(req.body?.template ?? '');
      const security = scanAndRepair(html);
      if (!security.ok) return res.status(400).json({ error: 'Could not auto-fix this template.', details: security.errors });
      const structure = structureCheck(security.html);
      if (!structure.ok) return res.status(400).json({ error: 'Structure check failed.', details: structure.errors });
      const nextDesign = withStorefrontHtml(storeRow, security.html);
      const { data, error } = await supabase
        .from('stores')
        .update({ design_json: nextDesign, updated_at: new Date().toISOString() })
        .eq('id', storeId)
        .select('id,name,slug,design_json')
        .single();
      if (error) {
        console.error('Save failed:', error);
        return res.status(500).json({ error: `Could not save the template: ${error.message}` });
      }
      return res.status(200).json({ ok: true, store: { id: data.id, name: data.name, slug: data.slug, storefront_html: String(data.design_json?.storefront_html || '').length }, notes: security.notes });
    }

    // ------------------------------------------------------------ preview
    if (action === 'preview' && req.method === 'POST') {
      const profile = await authFounder(req);
      if (!profile) return res.status(403).json({ error: 'Founder access required.' });
      const storeId = Number(req.body?.store_id);
      if (!storeId) return res.status(400).json({ error: 'Store is required.' });
      const override = String(req.body?.template ?? '');
      const repaired = override.trim() ? scanAndRepair(override) : { ok: true, html: override, notes: [], errors: [] };
      if (!repaired.ok) return res.status(400).json({ error: 'Could not auto-fix this template.', details: repaired.errors });
      const { data: store, error: storeError } = await supabase.from('stores').select('*').eq('id', storeId).single();
      if (storeError || !store) return res.status(404).json({ error: 'Store not found.' });
      const { data: products } = await supabase.from('products').select('*').eq('store_id', storeId).eq('active', true).order('created_at', { ascending: false });
      const liveProducts = (products || []).slice(0, 6).map((product) => ({ ...product, images: product.image_url ? [product.image_url] : [] }));
      const template = repaired.html.trim() || readStorefrontHtml(store) || DEFAULT_TEMPLATE.replace(/{{STORE_NAME}}/g, store.name);
      const rendered = renderTemplate(template, store, liveProducts);
      return res.status(200).json({ html: rendered.html, warnings: rendered.warnings, notes: repaired.notes });
    }

    // ----------------------------------------------------------- default template
    if (action === 'default' && req.method === 'GET') {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
      return res.status(200).json({ template: DEFAULT_TEMPLATE });
    }

    // ----------------------------------------------------------- prompt
    if (action === 'prompt' && req.method === 'GET') {
      const storeId = Number(req.query?.store_id);
      let name = 'My Store', products = 'the products you sell', whatsapp = '+254700000000';
      if (storeId) {
        const { data: store } = await supabase.from('stores').select('name,whatsapp').eq('id', storeId).single();
        if (store) { name = store.name; whatsapp = store.whatsapp; }
      }
      return res.status(200).json({ prompt: buildPrompt(name, products, whatsapp) });
    }
    if (action === 'prompt-generic' && req.method === 'GET') {
      return res.status(200).json({ prompt: buildPrompt('My Store', 'the products you sell', '+254700000000') });
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
      const storedHtml = readStorefrontHtml(store);
      const template = storedHtml || DEFAULT_TEMPLATE.replace(/{{STORE_NAME}}/g, store.name);
      const rendered = renderTemplate(template, store, liveProducts);
      if (String(req.query?.format) === 'raw') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
        return res.status(200).send(rendered.html);
      }
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
      return res.status(200).json({ store, products: liveProducts, renderedHtml: rendered.html });
    }

    return res.status(400).json({ error: 'Unknown action. Use ?action=save | preview | render | prompt | default | prompt-generic' });
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
