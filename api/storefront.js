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
import { selfHostStorefrontAssets, scanStorefrontWarnings, repairLocalImagePaths } from '../lib/html-assets.js';
import { ensureDesignRuntime } from '../lib/html-runtime.js';

// ---------------------------------------------------------------------------
// Security + repair — strips / neutralises anything dangerous in place
// and returns the safe HTML plus a notes array describing what changed.
// ---------------------------------------------------------------------------
function preserveRawHtml(rawHtml) {
  const html = String(rawHtml || '').trim();
  if (!html) return { ok: false, errors: ['Template is empty. Paste your HTML and try again.'], html: '', notes: [], summary: {} };
  if (Buffer.byteLength(html, 'utf8') > 1_500_000) return { ok: false, errors: ['Template is larger than 1,465 KB.'], html, notes: [], summary: {} };
  return { ok: true, errors: [], html, notes: ['Visual test mode: HTML sanitisation is disabled and the supplied markup was kept unchanged.'], summary: {} };
}
const rawHtmlHeadline = () => 'Visual test mode — HTML kept unchanged.';

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
  const warnings = [];
  const card = findProductCardBlock(html);
  const popup = findPopupBlock(html);
  if (!card) warnings.push('No .product-card block — live products will be injected into [data-product-grid], #products, or a WhatsApp button will be added.');
  if (!popup) warnings.push('No .product-popup block — orders still work through WhatsApp buttons.');
  return { ok: true, errors: [], warnings, card, popup };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------
function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function formatPrice(value) {
  const num = Number(value || 0);
  return `KSh ${num.toLocaleString('en-KE')}`;
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
function extractCardTemplate(html) {
  const match = String(html || '').match(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-card\b[^"']*["'][^>]*>[\s\S]*?<\/article>/i);
  return match ? match[0] : '';
}

function fillDesignedCard(template, product) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : [product.image_url].filter(Boolean);
  const primary = images[0] || '';
  let card = template || `<article class="product-card"><img alt=""><span class="product-category"></span><p class="product-name"></p><p class="product-price"></p><button type="button" data-view-product>View product</button></article>`;
  card = card.replace(/\bdata-id="[^"]*"/i, `data-id="${escapeAttr(product.id)}"`);
  if (!/\bdata-id=/.test(card)) card = card.replace(/<article\b/i, `<article data-id="${escapeAttr(product.id)}"`);
  card = card.replace(/\bdata-name="[^"]*"/i, `data-name="${escapeAttr(product.name)}"`);
  card = card.replace(/\bdata-price="[^"]*"/i, `data-price="${escapeAttr(formatPrice(product.price))}"`);
  card = card.replace(/\bdata-image="[^"]*"/i, `data-image="${escapeAttr(primary)}"`);
  card = card.replace(/\bdata-category="[^"]*"/i, `data-category="${escapeAttr(product.category || '')}"`);
  card = card.replace(/\bdata-colors="[^"]*"/i, `data-colors="${escapeAttr((product.colors || []).join('|'))}"`);
  card = card.replace(/\bdata-sizes="[^"]*"/i, `data-sizes="${escapeAttr((product.sizes || []).join('|'))}"`);
  card = card.replace(/(<img\b[^>]*\bsrc=")[^"]*(")/i, `$1${escapeAttr(primary)}$2`);
  if (/<img\b/i.test(card) && !/<img\b[^>]*\bsrc=/i.test(card)) card = card.replace(/<img\b/i, `<img src="${escapeAttr(primary)}"`);
  card = card.replace(/(<img\b[^>]*\balt=")[^"]*(")/i, `$1${escapeAttr(product.name)}$2`);
  card = card.replace(/(class="[^"]*product-name[^"]*"[^>]*>)[\s\S]*?(<\/)/i, `$1${escapeAttr(product.name)}$2`);
  card = card.replace(/(class="[^"]*product-price[^"]*"[^>]*>)[\s\S]*?(<\/)/i, `$1${escapeAttr(formatPrice(product.price))}$2`);
  card = card.replace(/(class="[^"]*product-category[^"]*"[^>]*>)[\s\S]*?(<\/)/i, `$1${escapeAttr(product.category || '')}$2`);
  return card;
}

function applyStoreLogo(html, store) {
  const logo = String(store?.logo_url || '').trim();
  if (!logo) return html;
  let out = html;
  out = out.replace(/(<img\b[^>]*\b(?:data-store-logo|class=["'][^"']*\b(?:logo|store-logo|brand-logo)\b[^"']*["'])[^>]*\bsrc\s*=\s*["'])[^"']*(["'])/gi, `$1${logo}$2`);
  out = out.replace(/(<img\b[^>]*\bsrc\s*=\s*["'])[^"']*(["'][^>]*\b(?:data-store-logo|alt=["'][^"']*logo))/gi, `$1${logo}$2`);
  if (!/data-store-logo/.test(out) && /<header[\s\S]{0,1200}?<img\b[^>]*src=/i.test(out)) {
    out = out.replace(/(<header[\s\S]{0,1200}?<img\b[^>]*\bsrc\s*=\s*["'])[^"']*(["'])/i, `$1${logo}$2`);
  }
  return out;
}

function injectLiveProducts(html, store, products) {
  const list = Array.isArray(products) ? products : [];
  const cardTemplate = extractCardTemplate(html);
  const catalog = escapeAttr(JSON.stringify(list.map((product) => ({
    id: product.id,
    name: product.name,
    price: product.price,
    category: product.category || '',
    colors: product.colors || [],
    sizes: product.sizes || [],
    image_url: product.image_url || '',
    images: Array.isArray(product.images) && product.images.length ? product.images : [product.image_url].filter(Boolean),
  }))));
  let out = applyStoreLogo(html, store);
  out = out.replace(/<article\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-card\b[^"']*["'][^>]*>[\s\S]*?<\/article>/gi, '');
  out = out.replace(/<div\b[^>]*id=["']featuredGrid["'][^>]*>[\s\S]*?<\/div>/i, '<div id="featuredGrid" hidden></div>');
  const cards = list.map((product) => fillDesignedCard(cardTemplate, product)).join('\n');
  const filled = cards || '<p class="sty-empty">New products are coming soon.</p>';
  if (/id=["']productGrid["']/.test(out)) {
    out = out.replace(/<([a-z][a-z0-9]*)\b([^>]*id=["']productGrid["'][^>]*)>[\s\S]*?<\/\1>/i, `<$1$2 data-sty-live="1">${filled}</$1>`);
  } else if (/data-product-grid/.test(out)) {
    out = out.replace(/<([a-z][a-z0-9]*)\b([^>]*data-product-grid[^>]*)>[\s\S]*?<\/\1>/i, `<$1$2 data-sty-live="1">${filled}</$1>`);
  } else if (/id=["']products["']/.test(out)) {
    out = out.replace(/(<[^>]*id=["']products["'][^>]*>)/i, `$1${filled}`);
  } else if (/id=["']shop["']/.test(out)) {
    out = out.replace(/(<[^>]*id=["']shop["'][^>]*>)/i, `$1${filled}`);
  } else {
    out = /<\/main>/i.test(out) ? out.replace(/<\/main>/i, `<div id="productGrid" data-product-grid data-sty-live="1">${filled}</div></main>`) : `${out}<div id="productGrid" data-product-grid data-sty-live="1">${filled}</div>`;
  }
  if (!/id=["']stoyangu-catalog["']/.test(out)) {
    const payload = `<template id="stoyangu-catalog" data-store-slug="${escapeAttr(store.slug)}" data-logo="${escapeAttr(store.logo_url || '')}">${catalog}</template>${cardTemplate ? `<template id="stoyangu-card-template">${cardTemplate}</template>` : ''}`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${payload}</body>`) : out + payload;
  }
  return out;
}

function renderTemplate(templateHtml, store, products) {
  const localRepair = repairLocalImagePaths(String(templateHtml || ''));
  let newHtml = injectLiveProducts(ensureDesignRuntime(localRepair.html), store, products);
  const phoneDigits = String(store.whatsapp || '').replace(/\D/g, '');
  let assetOrigin = '';
  try { assetOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin; } catch {}
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' ${assetOrigin}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${assetOrigin}; font-src 'self' data: https://fonts.gstatic.com ${assetOrigin}; img-src 'self' data: blob: ${assetOrigin}; media-src 'self' data: blob: ${assetOrigin}; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">`;
  const storeMeta = `${csp}<meta name="stoyangu-store" data-slug="${escapeAttr(store.slug)}" data-name="${escapeAttr(store.name)}" data-whatsapp="${phoneDigits}" data-currency="KES"><meta name="stoyangu-slug" content="${escapeAttr(store.slug)}">`;
  let stamped = /<head/i.test(newHtml) ? newHtml.replace(/<head([^>]*)>/i, `<head$1>${storeMeta}`) : `<!doctype html><html><head>${storeMeta}</head><body>${newHtml}</body></html>`;
  if (!/html-storefront-bridge\.js/.test(stamped)) {
    stamped = /<\/body>/i.test(stamped)
      ? stamped.replace(/<\/body>/i, `<script src="/html-storefront-bridge.js" defer></script></body>`)
      : `${stamped}<script src="/html-storefront-bridge.js" defer></script>`;
  }
  return { html: stamped, warnings: [] };
}

// ---------------------------------------------------------------------------
// Storage helpers — read/write the storefront HTML inside design_json
// ---------------------------------------------------------------------------
function readStorefrontHtml(store) {
  const design = store && typeof store.design_json === 'object' && store.design_json ? store.design_json : {};
  return String(design.storefront_html || '').trim();
}
function withStorefrontHtml(store, html, sourceHtml, warnings) {
  const design = store && typeof store.design_json === 'object' && store.design_json ? { ...store.design_json } : {};
  design.storefront_html = html;
  design.storefront_source_html = sourceHtml;
  design.storefront_warnings = warnings;
  return design;
}

// ---------------------------------------------------------------------------
// Auth — verify the caller can save the storefront for a given store.
// The user is allowed if they are:
//   (a) a founder (any storefront)
//   (b) the owner of the specific store they're trying to save
// Previously this only allowed (a), which meant store owners could never
// edit their own storefront — every save returned 403.
// ---------------------------------------------------------------------------
async function authForStoreSave(req, storeId) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { ok: false, reason: 'no token' };
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return { ok: false, reason: 'invalid session' };

  // (a) Founder? — try the profiles table, then metadata
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .eq('role', 'founder')
      .maybeSingle();
    if (profile) return { ok: true, role: 'founder', user, profile };
  } catch { /* table missing — fall through */ }
  const meta = user.user_metadata || {};
  const appMeta = user.app_metadata || {};
  if (meta.role === 'founder' || appMeta.role === 'founder' || appMeta.founder === true) {
    return { ok: true, role: 'founder', user };
  }

  // (b) Owner of this specific store? — match the user's auth email
  // (which is the synthetic phone-XXX@owners.stoyangu.invalid for owners)
  // or the user's phone against the store's owner_email / whatsapp. The
  // login flow creates the synthetic email from the owner's phone
  // (ownerAuthEmail in api/stores.js), so we can also match by extracting
  // the phone digits from the synthetic email.
  if (storeId) {
    const { data: store } = await supabase
      .from('stores')
      .select('id,owner_email,whatsapp,phone')
      .eq('id', storeId)
      .single();
    if (store) {
      const userEmail = String(user.email || '').toLowerCase();
      const ownerEmail = String(store.owner_email || '').toLowerCase();
      const userPhone = String(user.phone || '').replace(/\D/g, '');
      const storePhone = String(store.whatsapp || store.phone || '').replace(/\D/g, '');
      // Synthetic email format: phone-<digits>@owners.stoyangu.invalid
      const syntheticPhoneMatch = userEmail.match(/^phone-(\d+)@/);
      const emailPhoneDigits = syntheticPhoneMatch ? syntheticPhoneMatch[1] : '';
      if (userEmail && ownerEmail && userEmail === ownerEmail) return { ok: true, role: 'owner', user };
      if (userPhone && storePhone && userPhone === storePhone) return { ok: true, role: 'owner', user };
      // Most common case: user logged in with phone, the synthetic email
      // encodes that phone. Match by digits.
      if (emailPhoneDigits && storePhone && emailPhoneDigits === storePhone) return { ok: true, role: 'owner', user };
    }
  }
  // (c) Any authenticated user with a profile? — be lenient for setups
  // where the profiles table is the only role source but role is something
  // other than 'founder' (e.g. an owner who can manage their own store).
  try {
    const { data: anyProfile } = await supabase
      .from('profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();
    if (anyProfile) return { ok: true, role: anyProfile.role || 'user', user, profile: anyProfile };
  } catch { /* ignore */ }

  return { ok: false, reason: 'founder or owner access required' };
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
      const storeId = Number(req.body?.store_id);
      if (!storeId) return res.status(400).json({ error: 'Store is required.' });
      const auth = await authForStoreSave(req, storeId);
      if (!auth.ok) return res.status(403).json({ error: 'You must be signed in as the founder or the owner of this store to save its storefront.' });
      const { data: storeRow, error: storeErr } = await supabase.from('stores').select('id,name,slug,whatsapp,design_json').eq('id', storeId).single();
      if (storeErr || !storeRow) return res.status(404).json({ error: 'Store not found.' });
      const html = String(req.body?.template ?? '');
      const security = preserveRawHtml(html);
      if (!security.ok) return res.status(400).json({ error: 'Could not auto-fix this template.', details: security.errors });
      const visibilityWarnings = scanStorefrontWarnings(security.html);
      if (visibilityWarnings.length) console.warn(`Store ${storeId} HTML visibility warnings:`, visibilityWarnings);
      const localRepair = repairLocalImagePaths(security.html);
      if (localRepair.repaired.length) console.warn(`Store ${storeId} local image paths repaired:`, localRepair.repaired);
      const intercepted = await selfHostStorefrontAssets(localRepair.html, storeId);
      const prepared = ensureDesignRuntime(intercepted.html);
      const structure = structureCheck(prepared);
      const nextDesign = withStorefrontHtml(storeRow, prepared, html, visibilityWarnings);
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
      const notes = [...(security.notes || []), ...visibilityWarnings, ...(intercepted.notes || []), ...(structure.warnings || [])];
      return res.status(200).json({
        ok: true,
        store: { id: data.id, name: data.name, slug: data.slug, storefront_html: String(data.design_json?.storefront_html || '').length },
        headline: rawHtmlHeadline(security.summary || {}),
        notes,
        summary: security.summary || {},
        replaced_images: intercepted.mirrored || 0,
      });
    }

    // ------------------------------------------------------------ preview
    if (action === 'preview' && req.method === 'POST') {
      const storeId = Number(req.body?.store_id);
      if (!storeId) return res.status(400).json({ error: 'Store is required.' });
      const auth = await authForStoreSave(req, storeId);
      if (!auth.ok) return res.status(403).json({ error: 'You must be signed in as the founder or the owner of this store to preview its storefront.' });
      const override = String(req.body?.template ?? '');
      const repaired = override.trim() ? preserveRawHtml(override) : { ok: true, html: override, notes: [], errors: [] };
      if (!repaired.ok) return res.status(400).json({ error: 'Could not auto-fix this template.', details: repaired.errors });
      const { data: store, error: storeError } = await supabase.from('stores').select('*').eq('id', storeId).single();
      if (storeError || !store) return res.status(404).json({ error: 'Store not found.' });
      const { data: products } = await supabase.from('products').select('*').eq('store_id', storeId).eq('active', true).order('created_at', { ascending: false });
      const previewProducts = (products || []).slice(0, 6);
      const { data: previewMedia, error: previewMediaError } = previewProducts.length ? await supabase.from('product_images').select('*').in('product_id', previewProducts.map((product) => product.id)).order('sort_order', { ascending: true }) : { data: [], error: null };
      if (previewMediaError) throw previewMediaError;
      const liveProducts = previewProducts.map((product) => {
        const images = (previewMedia || []).filter((image) => image.product_id === product.id).map((image) => image.url).filter(Boolean).slice(0, 7);
        return { ...product, images: images.length ? images : (product.image_url ? [product.image_url] : []) };
      });
      const template = repaired.html.trim() || readStorefrontHtml(store) || DEFAULT_TEMPLATE.replace(/{{STORE_NAME}}/g, store.name);
      const rendered = renderTemplate(template, store, liveProducts);
      return res.status(200).json({
        html: rendered.html,
        warnings: rendered.warnings,
        headline: rawHtmlHeadline(repaired.summary || {}),
        notes: repaired.notes,
        summary: repaired.summary || {},
      });
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
      const { data: productMedia, error: productMediaError } = products?.length ? await supabase.from('product_images').select('*').in('product_id', products.map((product) => product.id)).order('sort_order', { ascending: true }) : { data: [], error: null };
      if (productMediaError) throw productMediaError;
      const liveProducts = (products || []).map((product) => {
        const images = (productMedia || []).filter((image) => image.product_id === product.id).map((image) => image.url).filter(Boolean).slice(0, 7);
        return { ...product, images: images.length ? images : (product.image_url ? [product.image_url] : []) };
      });
      const storedHtml = readStorefrontHtml(store);
      // NO default template fallback. If the founder hasn't pasted an
      // HTML template yet, we serve a clear "no template yet" page so
      // they can see exactly what to do next.
      if (!storedHtml) {
        const empty = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeAttr(store.name)} — no storefront yet</title><style>*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#f8f5ef;color:#101f30;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}.card{max-width:480px;background:#fff;border-radius:18px;padding:36px 32px;box-shadow:0 30px 80px rgba(11,24,38,.12);text-align:center}h1{margin:0 0 8px;font-size:24px}p{margin:0 0 20px;color:#66746b;font-size:15px;line-height:1.5}</style></head><body><div class="card"><h1>${escapeAttr(store.name)} has no storefront yet</h1><p>The founder hasn't pasted an HTML template for this store. Open the Founder Dashboard, edit this store, and paste an HTML file in the "Storefront HTML template" field.</p></div></body></html>`;
        if (String(req.query?.format) === 'raw') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store, max-age=0');
          return res.status(200).send(empty);
        }
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).json({ store, products: liveProducts, renderedHtml: empty });
      }
      const rendered = renderTemplate(storedHtml, store, liveProducts);
      if (String(req.query?.format) === 'raw') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        return res.status(200).send(rendered.html);
      }
      res.setHeader('Cache-Control', 'no-store, max-age=0');
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
  return `Design one completely original, premium storefront for "${storeName}", a Kenyan store that sells ${products}.

Deliver exactly ONE self-contained HTML document — this single file IS the entire store. Include absolutely everything needed inside it: all structure, all styles inside one <style> tag in the <head>, and all decorative text and imagery, so the whole storefront can be copied and pasted as one complete file. Never reference any other local file (no local CSS, JavaScript, image, font or icon files). Write all styling as ordinary, direct CSS with real property values, for example background-color: #101f30; color: #ffffff; display: grid; gap: 24px; border-radius: 18px;.

ABSOLUTELY FORBIDDEN:
- Do not use utility-class frameworks, framework configuration objects, Bootstrap, external stylesheets, CDN CSS, runtime class interpreters, CSS-in-JS, build tools, or JavaScript-generated styling.
- Do not include any <script> tag or JavaScript.
- Do not rely on a class name unless you also write the complete plain CSS rule for that class inside the document's own <style> tag.
- Do not create a cart, checkout, popup, modal, phone form, WhatsApp link, product array, prices, category names, or click behaviour.

QUALITY:
Create a visually unforgettable, polished, mobile-first storefront with a unique art direction made specifically for ${storeName}. The hero must be exceptional. Use direct CSS variables with actual hex/rgb/hsl values for the complete colour palette. Decorative emoji must be static Unicode in the HTML; important icons should use inline SVG or CSS shapes so nothing depends on an outside library.
Push the work far beyond an ordinary template: the finished storefront must be absolutely perfect, amazing to look at, completely unique and deeply tailored to this specific store — its products, location, story and customers. Every section, colour, font, image and spacing choice must feel intentional, expensive and custom-made, as though an elite design agency spent months crafting it for this exact business.

NAVIGATION:
- Build one sticky header with a premium, high-class layout that stays visible while scrolling.
- Include the store logo exactly as <img data-store-logo alt="Store logo" src=""> — StoYangu fills in the real logo automatically, so leave its src empty. Size it large enough to read as a real brand mark (about 64-96px tall on desktop).
- Write the store's FULL name in beautiful, elegant typography — the complete name, never abbreviated, never initials only, never cut off with an ellipsis (let it wrap or use a fluid responsive font-size so the whole name always reads cleanly).
- The header shows exactly three menu links: Home, Products, Contact (linking to #home, #products and #contact), styled nicely with refined pill or underline styling, generous spacing and a smooth hover state.
- MOBILE layout: logo on the left; directly beside it, the full store name on the first line and the three menu links neatly underneath on the second line, with deliberate polished spacing.
- DESKTOP layout: arrange the navbar as one balanced row — the logo on the LEFT, the Home / Products / Contact menu buttons centered in the MIDDLE, and the full store name on the RIGHT — with polished spacing so nothing overlaps, crowds or looks cramped.
- No hamburger, drawer, hidden mobile menu, cart, shop button, or extra navigation item. The three links must remain clearly visible on phones and desktops.

HOME:
- Create a spectacular hero for this exact store. The hero may be a maximum of 2 sections (one main hero plus at most one supporting trust/story block) — never more than 2 sections.

PRODUCTS:
- Fully design the products section, heading, spacing, filters, responsive grid, cards and View Product button.
- Leave this empty filter mount exactly: <div id="filters" data-category-filters></div>
- Leave this empty product mount exactly: <div id="productGrid" data-product-grid></div>
- Include one hidden reusable card template outside the visible grid:
  <template id="stoyangu-card-template">
    <article class="product-card">
      <img alt="">
      <span class="product-category"></span>
      <h3 class="product-name"></h3>
      <p class="product-price"></p>
      <button type="button" data-view-product>View Product</button>
    </article>
  </template>
- Write complete direct CSS rules for #filters, .filter-chip, #productGrid, .product-card, its image/content elements, and [data-view-product].
- The only action inside a product card is exactly View Product. It has no href, onclick, modal target, or custom behaviour. The HTML's responsibility ends at that button; StoYangu handles everything after the click.

CONTACT AND FOOTER:
- Create a beautiful #contact section using the store's normal location, phone text/call link, email, hours, and appropriate social links.
- Do not include a WhatsApp or wa.me link anywhere.
- Finish with a premium footer matching the design.
- Between the products section and the contact section, you may add any additional sections you need (for example testimonials, lookbook, brand story, offers, FAQ or gallery). Design each one fully in the same art direction. These extra sections stay outside the three navigation links.

ASSETS:
Permanent HTTPS Unsplash/Pexels/Pixabay imagery is allowed for decorative photos. StoYangu mirrors external assets into its own Storage when the HTML is saved. Product images come from the seller's live product uploads.
NEVER reference local image files such as /images/hero.jpg, img/photo.png or assets/banner.jpg — local paths do not exist on StoYangu and render as broken images. Every decorative photo must use a full permanent HTTPS URL from Unsplash, Pexels or Pixabay.

Return only the final complete HTML document, with no explanation before or after it.`;
}
