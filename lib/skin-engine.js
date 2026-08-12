// ============================================
// StoYangu Skin Engine — validation + stamping
// ============================================
// Contract (also what the AI kit prompts produce):
//
//   storefront.html slots: {{STORE_NAME}} {{STORE_DOMAIN}} {{WHATSAPP_URL}}
//     {{STORE_LOGO}} {{CATEGORIES_CHIPS}} {{PRODUCTS}} and optionally
//     <template data-sty-card>…product tokens…</template> for a skin-owned card.
//   product-template.html slots: {{PRODUCT_ID}} {{PRODUCT_NAME}} {{PRICE}}
//     {{PRICE_KES}} {{PRODUCT_IMAGE}} {{GALLERY}} {{CATEGORY}} {{COLORS}}
//     {{SIZES}} {{ORDER_URL}} {{PRODUCT_URL}} {{BACK_URL}} {{SIMILAR}}
//     {{STORE_NAME}} {{STORE_DOMAIN}} {{WHATSAPP_URL}}
//
// All stamping happens server-side. Skin script.js is DOM-only and never
// fetches. Every uploaded skin passes the same validators, no exceptions.
// ============================================

export const SKIN_BUCKET = 'stoyangu-media';

export const skinPath = (storeId, file) =>
  `skins/${storeId}/${String(file).replace(/\\/g, '/').replace(/\.\./g, '').replace(/^\/+/, '')}`;

export const skinBaseUrl = (supabaseUrl, storeId) =>
  `${String(supabaseUrl || '').replace(/\/$/, '')}/storage/v1/object/public/${SKIN_BUCKET}/skins/${storeId}/`;

// ---------- text helpers ----------
const esc = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (value) => `KES ${(Number(value) || 0).toLocaleString('en-KE')}`;
const textOf = (value) => String(value ?? '').trim();
const listify = (value) => (Array.isArray(value) ? value.map(textOf).filter(Boolean) : []);
const slugSafe = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// ---------- validation ----------
const ALLOWED_FILE_TYPES = new Set([
  'html', 'htm', 'css', 'js', 'json', 'txt', 'md', 'webmanifest', 'map',
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'ico',
  'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'mp3', 'wav',
]);
const BLOCKED_NAMES = new Set(['package.json', 'dockerfile', 'compose.yml', '.env', '.env.local', '.env.production']);
const BANNED_SCRIPT_TOKENS = [
  'fetch(', 'XMLHttpRequest', 'eval(', 'Function(', 'document.cookie', 'localStorage', 'sessionStorage',
  'indexedDB', 'WebSocket', 'sendBeacon', 'import(', 'new Worker', 'Worker(', 'serviceWorker',
  '/api/', 'supabase', 'auth', 'atob(', 'btoa(', 'window.open(', 'location.href', 'location.assign', 'location.replace',
];
const ALLOWED_EXTERNAL_HOSTS = (supabaseHost) => new Set([
  supabaseHost, 'images.unsplash.com', 'images.pexels.com', 'fonts.googleapis.com',
  'fonts.gstatic.com', 'cdn-icons-png.flaticon.com',
].filter(Boolean));

export function validateSkin(texts, supabaseHost) {
  const errors = [];
  const warnings = [];
  const byPath = {};
  texts.forEach((t) => { byPath[t.path.toLowerCase()] = t.content; });

  const find = (name) => {
    const hit = Object.keys(byPath).find((p) => p === name || p.endsWith(`/${name}`));
    return hit ? { path: hit, content: byPath[hit] } : null;
  };

  const storefront = find('storefront.html');
  const productTemplate = find('product-template.html');
  if (!storefront) errors.push('Missing storefront.html (the storefront page template). It must sit at the top of the skin folder.');
  if (!productTemplate) errors.push('Missing product-template.html (the single-product page template). It must sit at the top of the skin folder.');

  if (storefront) {
    if (!storefront.content.includes('{{PRODUCTS}}')) errors.push('storefront.html must contain {{PRODUCTS}} — the live catalog fills that slot.');
    if (!storefront.content.includes('{{STORE_NAME}}')) errors.push('storefront.html must contain {{STORE_NAME}} — the app stamps the store name there.');
    if (storefront.content.includes('<script')) warnings.push('storefront.html contains <script> tags — they are stripped at serve time. Put interactivity only in script.js.');
  }
  if (productTemplate) {
    for (const token of ['{{PRODUCT_NAME}}', '{{PRICE}}', '{{PRODUCT_IMAGE}}', '{{ORDER_URL}}']) {
      if (!productTemplate.content.includes(token)) errors.push(`product-template.html is missing ${token}.`);
    }
    if (productTemplate.content.includes('<script')) warnings.push('product-template.html contains <script> tags — stripped at serve time; keep JS in script.js.');
  }

  const scriptEntry = find('script.js');
  if (scriptEntry) {
    for (const token of BANNED_SCRIPT_TOKENS) {
      if (scriptEntry.content.includes(token)) errors.push(`script.js uses “${token}” — skins may only do local DOM work: nav links, show/hide filters, UI state. Data comes from us, never from code.`);
    }
  } else {
    warnings.push('No script.js — fine: bridges handle tracking and ordering.');
  }

  // External resource allowlist for script/style/img/media loading (links stay free).
  const allowed = ALLOWED_EXTERNAL_HOSTS(supabaseHost);
  for (const t of texts) {
    if (!/\.(html?|css)$/i.test(t.path)) continue;
    const references = [];
    for (const re of [/(?:src|action|poster|data-src)=(['"])(https?:\/\/[^'"]+)\1/gi, /<link[^>]+href=(['"])(https?:\/\/[^'"]+)\1/gi, /url\(\s*(['"]?)(https?:\/\/[^)'"]+)\1\s*\)/gi]) {
      let m; while ((m = re.exec(t.content))) references.push(m[2]);
    }
    for (const url of references) {
      try {
        const host = new URL(url).hostname;
        if (!allowed.has(host)) errors.push(`${t.path} loads ${host} — outside the permanent allowlist. Approved hosts: ${[...allowed].join(', ')}.`);
      } catch { errors.push(`${t.path} contains an unreadable external URL.`); }
    }
  }
  return { ok: errors.length === 0, errors, warnings, storefrontPath: storefront?.path || null, templatePath: productTemplate?.path || null, scriptPath: scriptEntry?.path || null };
}

// Auto-repair pass: whatever the AI forgot, the app fills in — uploads should
// almost never reject. Only structurally-unusable files error.
export function autoRepairSkin(texts) {
  const fixed = [];
  const repaired = texts.map((item) => ({ ...item }));
  const byName = (name) => repaired.find((item) => item.path.toLowerCase() === name || item.path.toLowerCase().endsWith('/' + name));

  let storefront = byName('storefront.html');
  if (storefront) {
    if (!storefront.content.includes('{{PRODUCTS}}')) {
      const slot = '<main class="sty-products-zone" aria-label="Products">{{PRODUCTS}}</main>';
      storefront.content = /<\/body>/i.test(storefront.content)
        ? storefront.content.replace(/<\/body>/i, `${slot}</body>`)
        : storefront.content + slot;
      fixed.push('{{PRODUCTS}} slot was missing — injected a catalog area before the page bottom.');
    }
    if (!storefront.content.includes('{{STORE_NAME}}')) {
      storefront.content = storefront.content.replace(/<h1/i, '<h1 data-sty-storename>{{STORE_NAME}}</h1>');
      fixed.push('{{STORE_NAME}} slot was missing — placed it on the page title/hero.');
    }
  } else if (!byName('product-template.html')) {
    throw new Error('nothing-repairable');
  }

  let template = byName('product-template.html');
  if (!template) {
    const cardTemplate = storefront ? productCardTemplate(storefront.content) : null;
    const card = cardTemplate || DEFAULT_CARD;
    repaired.push({
      path: 'product-template.html',
      content: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{PRODUCT_NAME}} — {{STORE_NAME}}</title></head><body><main class="sty-product-page"><a class="sty-back" href="{{BACK_URL}}">← All products</a><article class="sty-product"><div class="sty-gallery">{{GALLERY}}</div><div class="sty-info"><span class="sty-cat">{{CATEGORY}}</span><h1>{{PRODUCT_NAME}}</h1><strong class="sty-price">{{PRICE}}</strong><div class="sty-choices">{{COLORS}}{{SIZES}}</div><a class="sty-order" href="{{ORDER_URL}}" data-sty-order data-product="{{PRODUCT_ID}}" target="_blank" rel="noopener noreferrer">Order via WhatsApp</a></div></article><section class="sty-similar-zone">{{SIMILAR}}</section></main></body></html>`,
    });
    fixed.push('product-template.html was missing — a neutral product page was generated for you.');
  }
  void card;
  return { texts: repaired, fixed };
}

// ---------- sanitizers applied at serve time (defense in depth) ----------
export function stripScripts(html) {
  let out = String(html);
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/<script[^>]*\/?>/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '');
  out = out.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '');
  return out;
}

export function reinOnExternal(html, supabaseHost) {
  const allowed = ALLOWED_EXTERNAL_HOSTS(supabaseHost);
  let out = String(html);
  out = out.replace(/\b(src|action|poster|data-src)=(['"])(https?:\/\/[^'"]+)\2/gi, (match, attr, quote, url) => {
    try { return allowed.has(new URL(url).hostname) ? `${attr}=${quote}${url}${quote}` : `${attr}=${quote}#blocked${quote}`; }
    catch { return `${attr}=${quote}#blocked${quote}`; }
  });
  out = out.replace(/\bhref=(['"])(javascript:[^'"]*|data:(?!image\/)[^'"]*)\1/gi, 'href=$1#blocked$1');
  out = out.replace(/url\(\s*(['"]?)(https?:\/\/[^)'"]+)\1\s*\)/gi, (match, quote, url) => {
    try { return allowed.has(new URL(url).hostname) ? `url(${quote || ''}${url}${quote || ''})` : 'url(#blocked)'; }
    catch { return 'url(#blocked)'; }
  });
  out = out.replace(/<a([^>]*?)target=(['"])_(blank|new)\2(?![^>]*rel=)/gi, '<a$1target=$2_$3$2 rel="noopener noreferrer"');
  out = out.replace(/<form([^>]*)action=(['"])(?!https?:|#|\/)([^'"]+)\2/gi, '<form$1action=$2#$2');
  return out;
}

// ---------- stamping ----------
function fillTokens(template, pairs) {
  let out = String(template);
  for (const [key, value] of Object.entries(pairs)) out = out.split(`{{${key}}}`).join(String(value ?? ''));
  return out;
}

const DEFAULT_CARD = `<article class="sty-card" data-sty-card data-cat="{{CATEGORY_SAFE}}" data-product="{{PRODUCT_ID}}"><a href="{{PRODUCT_URL}}" class="sty-img"><img src="{{PRODUCT_IMAGE}}" alt="{{PRODUCT_NAME}}" loading="lazy"></a><div class="sty-body"><span class="sty-cat">{{CATEGORY}}</span><strong class="sty-name">{{PRODUCT_NAME}}</strong><span class="sty-price">{{PRICE}}</span><a class="sty-order" href="{{ORDER_URL}}" target="_blank" rel="noopener noreferrer" data-sty-order data-product="{{PRODUCT_ID}}">Order via WhatsApp</a></div></article>`;

export function productCardTemplate(storefrontHtml) {
  const match = storefrontHtml.match(/<template[^>]*data-sty-card[^>]*>([\s\S]*?)<\/template>/i);
  return match ? match[1].trim() : null;
}

export function buildCategoryChips(categories) {
  return (categories || []).filter(Boolean).map((name) =>
    `<a href="#products" class="sty-cat" data-sty-cat="${esc(String(name))}">${esc(String(name))}</a>`,
  ).join('\n');
}

export function waTemplate(store, product) {
  const phone = String(store.whatsapp || '').replace(/\D/g, '');
  const text = product
    ? `Hi ${store.name}! I want to order: ${product.name} (${money(product.price)}). Please confirm availability.`
    : `Hi ${store.name}! I am interested in something from your store. Please help me order.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

function productTokens(product, store, basePath, allProducts) {
  const images = (product.images?.length ? product.images : [product.image_url].filter(Boolean)).filter(Boolean);
  const gallery = images.map((url, index) => `<img src="${url}" alt="${esc(product.name)} photo ${index + 1}" data-gallery-index="${index}" loading="lazy">`).join('\n');
  const colors = listify(product.colors).map((value) => `<button type="button" class="sty-choice" data-choice="colour" data-value="${esc(value)}">${esc(value)}</button>`).join('');
  const sizes = listify(product.sizes).map((value) => `<button type="button" class="sty-choice" data-choice="size" data-value="${esc(value)}">${esc(value)}</button>`).join('');
  const similar = (allProducts || []).filter((p) => p.id !== product.id).slice(0, 3).map((p) =>
    `<a class="sty-similar" href="${basePath}p/${p.id}" data-sty-similar><img src="${(p.images && p.images[0]) || p.image_url}" alt="${esc(p.name)}" loading="lazy"><span>${esc(p.name)}</span><b>${money(p.price)}</b></a>`,
  ).join('\n');
  return {
    PRODUCT_ID: String(product.id),
    PRODUCT_NAME: esc(product.name),
    PRICE: money(product.price),
    PRICE_KES: String(Number(product.price) || 0),
    PRODUCT_IMAGE: images[0] || '',
    GALLERY: gallery,
    CATEGORY: esc(product.category || ''),
    CATEGORY_SAFE: slugsafeAttr(product.category || ''),
    COLORS: colors,
    SIZES: sizes,
    ORDER_URL: waTemplate(store, product),
    PRODUCT_URL: `${basePath}p/${product.id}`,
    BACK_URL: basePath || '/',
    SIMILAR: similar,
    STORE_NAME: esc(store.name),
    STORE_DOMAIN: esc(store.slug ? `${store.slug}.stoyangu.com` : ''),
    WHATSAPP_URL: waTemplate(store, null),
    STORE_LOGO: store.logo_url || '',
  };
}
const slugsafeAttr = (value) => esc(slugSafe(value));

export function buildProductsMarkup(template, products, store, basePath) {
  return (products || []).map((product) => fillTokens(template, productTokens(product, store, basePath, products))).join('\n');
}

export function stampStorefront(html, store, products, basePath) {
  const filledProducts = buildProductsMarkup(productCardTemplate(html) || DEFAULT_CARD, products, store, basePath);
  const clean = html.replace(/<template[^>]*data-sty-card[\s\S]*?<\/template>/gi, '');
  return fillTokens(clean, {
    STORE_NAME: esc(store.name),
    STORE_DOMAIN: esc(store.slug ? `${store.slug}.stoyangu.com` : ''),
    WHATSAPP_URL: waTemplate(store, null),
    STORE_LOGO: store.logo_url || '',
    CATEGORIES_CHIPS: buildCategoryChips(Array.isArray(store.categories) ? store.categories : []),
    PRODUCTS: filledProducts,
    PRODUCT_COUNT: String(products?.length || 0),
  });
}

export function stampProductPage(html, store, product, products, basePath) {
  return fillTokens(html, {
    ...productTokens(product, store, basePath, products),
    PRODUCTS: buildProductsMarkup(productCardTemplate(html) || DEFAULT_CARD, products, store, basePath),
    CATEGORIES_CHIPS: buildCategoryChips(Array.isArray(store.categories) ? store.categories : []),
    PRODUCT_COUNT: String(products?.length || 0),
  });
}
