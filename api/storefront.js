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
//  FIX (stoyangu-500): every template — old or new — is now NORMALIZED before
//  it is saved and again (idempotently) on every render. The AI's own markup,
//  CSS and scripts are NEVER touched — only the broken structure around them
//  is repaired: naked <body>-only fragments are promoted to complete
//  documents (missing doctype / viewport / charset are added, never
//  re-authored), stale AI "live" scaffolding and visible sample-card columns
//  are removed, old data-store-live-grid mounts are converted to real live
//  sockets, one authoritative hidden card template is guaranteed, and the
//  render-time CSP allowlists the asset/CDN hosts real AI output uses
//  (Tailwind CDNs, https images/fonts/styles, Maps/YouTube embeds) so a page
//  can never again ship half-styled because a stylesheet, font or photo was
//  blocked. Live products are additionally server-painted into the socket,
//  so first paint is never an empty grid.
// =========================================================================

import supabase from '../lib/db-client.js';
import { selfHostStorefrontAssets, scanStorefrontWarnings, repairLocalImagePaths } from '../lib/html-assets.js';
import { ensureDesignRuntime } from '../lib/html-runtime.js';

// ---------------------------------------------------------------------------
// Intake — accepts the pasted template as supplied (scripts, styles and all)
// and returns it plus a notes array. Nothing visual is ever altered here;
// structural repair happens in applyStructuralRepair() below.
// ---------------------------------------------------------------------------
function preserveRawHtml(rawHtml) {
  const html = String(rawHtml || '').trim();
  if (!html) return { ok: false, errors: ['Template is empty. Paste your HTML and try again.'], html: '', notes: [], summary: {} };
  if (Buffer.byteLength(html, 'utf8') > 1_500_000) return { ok: false, errors: ['Template is larger than 1,465 KB.'], html, notes: [], summary: {} };
  return { ok: true, errors: [], html, notes: ['Your design was kept exactly as supplied — markup, styling and behaviour untouched.'], summary: {} };
}
const rawHtmlHeadline = () => 'Saved — design kept exactly as supplied; broken structure auto-repaired.';

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
  const templateCard = /<template\b[^>]*\bid\s*=\s*["']stoyangu-card-template["'][\s\S]*?\bproduct-card\b/i.test(html);
  const popup = findPopupBlock(html);
  if (!card && !templateCard) warnings.push('No product-card design found — a clean default card was added so live products still render beautifully.');
  if (!popup) warnings.push('No product popup block — the universal order popup opens after View Product instead.');
  return { ok: true, errors: [], warnings, card: card || (templateCard ? '<template-card>' : null), popup };
}

// ---------------------------------------------------------------------------
// FIX (stoyangu-500): structural normalization.
//
// Root causes of the "new websites look distorted" issue:
//  1. New templates arrived as <body>-only fragments (no doctype/head/body).
//     Nothing promoted them to documents, so the browser rendered raw markup
//     with no styling context — sometimes in quirks mode.
//  2. Render-time CSP blocked the exact hosts real AI output uses: Tailwind
//     Play CDN scripts, jsdelivr stylesheets, Google/outside fonts, and any
//     decorative photo that failed to mirror — each blocked asset removed a
//     layer of the design until only naked markup was left.
//  3. AI "live" scaffolding — data-store-live-grid sections, visible sample
//     .product-card columns, fallback corrals, demo toolbars — was never
//     stripped, so stale sample content rendered beside empty live areas.
//  4. Templates with no [data-product-grid]/#productGrid socket and no hidden
//     card template gave the live grid nothing to clone — products never
//     painted, leaving a visibly broken empty section.
//  5. Full documents missing only a doctype or viewport rendered zoomed-out
//     or in quirks mode on phones.
//
// normalizeHtmlDocument() guarantees a complete document; stripLiveScaffolding()
// removes AI scaffolding; promoteHiddenTemplate() guarantees the live grid
// always has a clean card template; ensureProductSocket() guarantees the
// mount; and the render CSP allowlists real-world AI asset hosts. The AI's
// own CSS is NEVER modified — a small runtime stylesheet only guarantees
// sockets/cards can never be invisible.
// ---------------------------------------------------------------------------

const STY_RUNTIME_CSS = [
  '/* StoYangu runtime: guarantees live sockets/cards can never be invisible. Never overrides AI styling. */',
  '#productGrid,[data-product-grid],[data-sty-live]{display:grid;gap:clamp(12px,2.5vw,24px);grid-template-columns:repeat(auto-fill,minmax(min(100%,230px),1fr));align-items:stretch}',
  '#productGrid:empty::after{content:"New products are coming soon.";display:block;grid-column:1/-1;padding:28px;text-align:center;color:inherit;opacity:.65}',
  '#productGrid .product-card,[data-product-grid] .product-card,#productGrid .sty-card,[data-sty-live] .sty-card{visibility:visible!important;opacity:1!important;transform:none!important;min-width:0}',
  '#productGrid img,[data-product-grid] img{max-width:100%;height:auto}',
  '#productGrid .product-card img,[data-product-grid] .product-card img{aspect-ratio:1/1;object-fit:cover;width:100%;display:block}',
  '#filters:empty,[data-category-filters]:empty{display:none!important}',
  '[data-sty-legacy-hidden]{display:none!important}',
  '.sty-legacy-popup{display:none!important}',
].join('\n');

const STY_PRODUCT_PH = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="100%" height="100%" fill="#ece5d8"/><text x="50%" y="50%" font-size="28" text-anchor="middle" fill="#8a8475" font-family="system-ui">product photo</text></svg>',
);

const STY_DEFAULT_CARD = '<article class="product-card sty-card" data-id="" data-name="" data-category="" data-price="" data-image="">'
  + '<img src="' + STY_PRODUCT_PH + '" alt="" data-ph="1">'
  + '<div class="sty-body"><span class="product-category sty-cat"></span>'
  + '<h3 class="product-name"></h3><p class="product-price"></p>'
  + '<button type="button" class="sty-view" data-view-product="">View product</button></div></article>';

// Remove every balanced block whose OPENING tag matches openRe (group 1 must
// be the tag name). Nested same-name tags are counted, so a card containing
// inner divs is removed whole instead of truncated mid-markup. keepTest, when
// given, preserves blocks whose content matches (used to protect the designed
// live socket from scaffolding patterns). Returns { html, removed }.
function removeBalancedMatches(html, openRe, keepTest) {
  const source = String(html || '');
  const blocks = [];
  const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  openRe.lastIndex = 0;
  let m;
  while ((m = openRe.exec(source))) {
    const tag = String(m[1] || '').toLowerCase();
    if (!tag) continue;
    const start = m.index;
    if (blocks.some((b) => start > b.start && start < b.end)) continue;
    if (/\/\s*>$/.test(m[0]) || VOID_TAGS.has(tag)) {
      blocks.push({ start, end: start + m[0].length });
      continue;
    }
    let depth = 1;
    const inner = new RegExp(`<\\/?${tag}(?![a-z0-9])[^>]*>`, 'gi');
    inner.lastIndex = start + m[0].length;
    let im;
    let end = -1;
    let guard = 0;
    while ((im = inner.exec(source))) {
      if (++guard > 5000) break;
      const token = im[0];
      if (token[1] === '/') depth--;
      else if (!/\/\s*>$/.test(token)) depth++;
      if (depth === 0) { end = im.index + token.length; break; }
    }
    if (end === -1) end = Math.min(source.length, start + 20000);
    blocks.push({ start, end });
  }
  blocks.sort((a, b) => b.start - a.start);
  let out = source;
  const removed = [];
  for (const b of blocks) {
    const slice = out.slice(b.start, b.end);
    if (keepTest && keepTest(slice)) continue;
    removed.unshift(slice);
    out = out.slice(0, b.start) + out.slice(b.end);
  }
  return { html: out, removed };
}

// Strip data-* layout hooks (which strand unstyled hooks) from a card
// fragment, but keep functional ones the live grid relies on.
function cleanAttrs(fragment) {
  return String(fragment || '').replace(/<([a-z][a-z0-9]*)\b([^>]*)>/gi, (whole, tag, attrs) => {
    let next = String(attrs || '');
    next = next.replace(/\sdata-(?!view-product\b|thumb\b|ph\b|sty-static\b)[a-z0-9_-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '');
    next = next.replace(/\s(?:width|height)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    return `<${tag}${next}>`;
  });
}

// Guarantee a data-* attribute exists exactly once on the fragment's root tag.
function ensureAttr(fragment, name, value) {
  const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  const cleaned = String(fragment || '').replace(new RegExp(`(<[a-z][a-z0-9]*\\b[^>]*?)${pattern.source}([^>]*>)`, 'i'), '$1$2');
  return cleaned.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/i, `<$1$2 ${name}="${escapeAttr(value)}">`);
}

// Normalize ONE AI card fragment into a live-grid-safe hidden card template:
// exactly one root with class product-card + data-id/name/category/price/image,
// exactly one <img> with a data: placeholder src, name/category/price slots and
// exactly one <button data-view-product>.
function normalizeCardTemplate(fragment) {
  let card = cleanAttrs(fragment);
  card = card.replace(/(<img\b[^>]*?)(\/?)>/i, (whole, head) => {
    let tag = head.replace(/\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    tag = tag.replace(/\ssrcset\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
    return `${tag} src="${STY_PRODUCT_PH}" data-ph="1">`;
  });
  if (!/<img\b/i.test(card)) {
    card = card.replace(/(<([a-z][a-z0-9]*)\b[^>]*>)/i, `$1<img src="${STY_PRODUCT_PH}" alt="" data-ph="1">`);
  }
  // Flatten nested {{…}} sample tokens the AI sometimes leaves behind.
  card = card.replace(/\{\{[^}]{1,80}\}\}/g, '');
  card = ensureAttr(card, 'data-id', '');
  card = ensureAttr(card, 'data-name', '');
  card = ensureAttr(card, 'data-category', '');
  card = ensureAttr(card, 'data-price', '');
  card = ensureAttr(card, 'data-image', '');
  if (!/class\s*=\s*["'][^"']*\bproduct-card\b/i.test(card)) {
    card = card.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/i, '<$1 class="product-card sty-card"$2>');
  }
  if (!/class\s*=\s*["'][^"']*\bproduct-name\b/i.test(card)) {
    card = card.replace(/(<button\b[^>]*data-view-product[^>]*>)/i, '<h3 class="product-name"></h3>$1');
  }
  if (!/class\s*=\s*["'][^"']*\bproduct-price\b/i.test(card)) {
    card = card.replace(/(<button\b[^>]*data-view-product[^>]*>)/i, '<p class="product-price"></p>$1');
  }
  const buttons = card.match(/<button\b[^>]*data-view-product[^>]*>[\s\S]*?<\/button\s*>/gi) || [];
  if (!buttons.length) {
    card = card.replace(/(<\/[a-z][a-z0-9]*>\s*)$/i, '<button type="button" class="sty-view" data-view-product="">View product</button>$1');
  } else if (buttons.length > 1) {
    let kept = false;
    card = card.replace(/<button\b[^>]*data-view-product[^>]*>[\s\S]*?<\/button\s*>/gi, (match) => {
      if (!kept) { kept = true; return '<button type="button" class="sty-view" data-view-product="">View product</button>'; }
      return '';
    });
  } else {
    card = card.replace(/<button\b[^>]*data-view-product[^>]*>[\s\S]*?<\/button\s*>/gi, '<button type="button" class="sty-view" data-view-product="">View product</button>');
  }
  return card;
}

function isSelfContainedVisualDesign(html) {
  const text = String(html || '');
  return /<style\b[^>]*>[\s\S]{40,}<\/style\s*>/i.test(text)
    || /<link\b[^>]*rel=["']stylesheet["']/i.test(text);
}

const IFRAME_ALLOW_HOST = /^(?:www\.|)(?:maps\.google\.com|google\.com|youtube\.com|youtu\.be)$/i;

// Keep Maps/YouTube embeds (explicitly allowed by the render CSP); drop every
// other iframe so a blocked embed can never render as a broken box.
function filterIframes(html) {
  return String(html || '').replace(/<iframe\b[^>]*>(?:[\s\S]*?<\/iframe\s*>)?|<iframe\b[^>]*\/?>/gi, (tag) => {
    const src = (/src\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '';
    try {
      const host = new URL(src.startsWith('//') ? `https:${src}` : src).hostname.toLowerCase();
      if (IFRAME_ALLOW_HOST.test(host)) return tag;
    } catch { /* unparseable src — drop it */ }
    return '';
  });
}

// Cap remote decorative images at a phone-safe size. Unsplash (imgix) and
// Pexels both honor width params; founders paste full-resolution links
// (often 5000px+) and phones OOM decoding dozens of them — the classic
// intermittent "sad face" renderer crash. Applied before mirroring so the
// stored file is small, and idempotently at render for older saves.
function constrainRemoteImages(html) {
  let out = String(html || '');
  out = out.replace(/https:\/\/(?:images\.unsplash\.com|plus\.unsplash\.com)\/[^\s"'<>)]+/gi, (url) => {
    try {
      const u = new URL(url);
      if (!u.searchParams.get('w')) u.searchParams.set('w', '1280');
      if (!u.searchParams.get('q')) u.searchParams.set('q', '70');
      if (!u.searchParams.get('auto')) u.searchParams.set('auto', 'format');
      if (!u.searchParams.get('fit')) u.searchParams.set('fit', 'max');
      return u.toString();
    } catch { return url; }
  });
  out = out.replace(/https:\/\/images\.pexels\.com\/[^\s"'<>)]+/gi, (url) => {
    try {
      const u = new URL(url);
      if (!u.searchParams.get('w')) u.searchParams.set('w', '1280');
      if (!u.searchParams.get('auto')) u.searchParams.set('auto', 'compress');
      if (!u.searchParams.get('cs')) u.searchParams.set('cs', 'tinysrgb');
      return u.toString();
    } catch { return url; }
  });
  return out;
}

// Guarantee a complete HTML document. AI scripts, styles and markup pass
// through untouched; only page-breaking shell problems are repaired:
// missing doctype (quirks mode), missing viewport/charset (zoomed-out
// phones), hijackable <base>, meta refresh, blocked iframes, and
// brace-mangled layout shells. Body-only fragments are promoted to full
// documents with their own <style>/<link>/<title> hoisted into the new head.
function normalizeHtmlDocument(html, store) {
  let out = String(html || '').trim();
  if (!out) return out;
  out = out.replace(/<base\b[^>]*>/gi, '');
  out = out.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
  out = filterIframes(out);
  // Unwrap brace-mangled shells (literal junk no framework emits) that would
  // otherwise trap the page in a dead layout.
  out = out.replace(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*(?:^|\s)(?:sm|md|lg|xl|2xl):\(\)[^"']*["'][^>]*>/gi, '');
  out = out.replace(/<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:max-w|w)-\(\s*[^)]+\)[^"']*["'][^>]*>/gi, '');
  const hasDoctype = /^\s*<!doctype\s+html/i.test(out);
  const hasHtml = /<html[\s>]/i.test(out);
  const hasHead = /<head[\s>]/i.test(out);
  const hasBody = /<body[\s>]/i.test(out);
  const ensureHeadMeta = (doc) => {
    let next = doc;
    if (!/<meta\b[^>]*charset/i.test(next)) {
      next = /<head([^>]*)>/i.test(next)
        ? next.replace(/<head([^>]*)>/i, '<head$1><meta charset="utf-8">')
        : next;
    }
    if (!/name\s*=\s*["']viewport["']/i.test(next)) {
      next = /<head([^>]*)>/i.test(next)
        ? next.replace(/<head([^>]*)>/i, '<head$1><meta name="viewport" content="width=device-width,initial-scale=1">')
        : next;
    }
    return next;
  };
  if (hasDoctype || (hasHtml && hasHead && hasBody)) {
    out = ensureHeadMeta(out);
    return hasDoctype ? out : `<!doctype html>\n${out}`;
  }
  // FRAGMENT → full document. Hoist the fragment's own head assets first so
  // no <style> is ever lost in the promotion.
  const headBits = [];
  out = out.replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, (m) => { headBits.push(m); return ''; });
  out = out.replace(/<link\b[^>]*>/gi, (m) => { headBits.push(m); return ''; });
  out = out.replace(/<title\b[^>]*>[\s\S]*?<\/title\s*>/gi, (m) => { headBits.push(m); return ''; });
  const hasTitle = headBits.some((bit) => /^\s*<title[\s>]/i.test(bit));
  const title = store?.name ? `${String(store.name)} — Shop online` : 'StoYangu store';
  const inner = out
    .replace(/^\s*<!doctype[^>]*>\s*/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?head[^>]*>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '');
  return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n${hasTitle ? '' : `<title>${escapeAttr(title)}</title>\n`}${headBits.join('\n')}\n</head>\n<body>\n${inner}\n</body>\n</html>`;
}

// Strip every kind of AI "live" scaffolding. Old data-store-live-grid mounts
// are CONVERTED to real live sockets (design preserved); class-based
// live/fallback corrals are removed unless they contain the designed socket;
// visible sample cards are extracted (first = authoritative template) and any
// extras are preserved as static promo banners. Returns the cleaned html plus
// the visible template cards found and any promo-strip statics.
function stripLiveScaffolding(html) {
  let out = String(html || '');
  // 1. Old-convention live mounts become real live sockets (tag + classes kept).
  out = out.replace(/<([a-z][a-z0-9]*)\b([^>]*\bdata-store-live-grid\b[^>]*)>/gi, (whole, tag, attrs) => {
    const extras = /\bid\s*=/i.test(attrs) ? ' data-product-grid data-sty-live="1"' : ' id="productGrid" data-product-grid data-sty-live="1"';
    return `<${tag}${attrs}${extras}>`;
  });
  // 2. Live-grid toolbars and fallback/demo corrals — unless they ARE the
  //    designed section (i.e. they contain the real socket or filter mount).
  const hasDesignedSocket = (block) => /(id\s*=\s*["']productGrid["']|data-product-grid|id\s*=\s*["']filters["']|data-category-filters)/i.test(block);
  for (const pattern of [
    /<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\blive-(?:toolbar|grid|products)\b[^"']*["'][^>]*>/gi,
    /<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:fallback-products|demo-products|sample-products|product-fallback)\b[^"']*["'][^>]*>/gi,
  ]) {
    out = removeBalancedMatches(out, pattern, hasDesignedSocket).html;
  }
  // 3. Visible sample .product-card columns OUTSIDE any <template> (the
  //    browser shows those; the hidden <template> card is extracted later).
  const templateHolds = [];
  out = out.replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, (match) => {
    templateHolds.push(match);
    return `<!--sty-template-hold-${templateHolds.length - 1}-->`;
  });
  const cards = removeBalancedMatches(out, /<([a-z][a-z0-9]*)\b[^>]*\bclass\s*=\s*["'][^"']*\bproduct-card\b[^"']*["'][^>]*>/gi);
  out = cards.html;
  const templateCards = cards.removed;
  templateHolds.forEach((hold, index) => {
    out = out.split(`<!--sty-template-hold-${index}-->`).join(hold);
  });
  // 4. Promo-strip statics (2nd/3rd+ sample columns): normalize into dead
  //    decorative cards so layout rhythm survives without clickable fakes.
  const promoStatics = [];
  while (templateCards.length > 1) {
    const extra = templateCards.pop();
    let statik = normalizeCardTemplate(extra)
      .replace(/\bproduct-card\b/g, 'sty-card')
      .replace(/\sdata-view-product(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, ' data-sty-static="1"');
    statik = statik.replace(/(<img\b[^>]*?)(\/?)>/i, (whole, head) => (/src\s*=/i.test(head) ? whole : `${head} src="${STY_PRODUCT_PH}" data-ph="1">`));
    promoStatics.push(statik);
  }
  // 5. Stale map anchors the live page replaces at runtime.
  out = out.replace(/<a\b[^>]*\bhref\s*=\s*["']#[^"']*["'][^>]*>\s*(?:<img\b[^>]*>)?\s*map\s*<\/a\s*>/gi, '');
  return { html: out, templateCards, promoStatics };
}

// Extract the hidden <template id="stoyangu-card-template"> card (if any),
// normalize it, and re-emit exactly one authoritative hidden template.
function promoteHiddenTemplate(html, templateCards) {
  let out = String(html || '');
  let hiddenTemplateHtml = '';
  out = out.replace(/<template\b[^>]*\bid\s*=\s*["']stoyangu-card-template["'][^>]*>([\s\S]*?)<\/template\s*>/gi, (whole, inner) => {
    if (!hiddenTemplateHtml) hiddenTemplateHtml = String(inner || '');
    return '';
  });
  const source = hiddenTemplateHtml.trim() || (templateCards.length ? templateCards[0] : '');
  const authoritative = source.trim() ? normalizeCardTemplate(source) : STY_DEFAULT_CARD;
  return { html: out, authoritative };
}

// Make sure the document always has a store-logo socket, nav anchors and a
// live product socket.
function ensureHeaderSocket(html, store) {
  let out = String(html || '');
  if (/data-store-logo/i.test(out)) return out;
  const logoImg = `<img data-store-logo alt="${escapeAttr(store?.name ? `${store.name} logo` : 'Store logo')}" src="">`;
  if (/<header\b[^>]*>/i.test(out)) {
    out = out.replace(/(<header\b[^>]*>)/i, `$1${logoImg}`);
  } else if (/<body\b[^>]*>/i.test(out)) {
    out = out.replace(/(<body\b[^>]*>)/i, `$1<header class="sty-header">${logoImg}</header>`);
  } else {
    out = `<header class="sty-header">${logoImg}</header>${out}`;
  }
  return out;
}

function ensureSectionAnchors(html) {
  let out = String(html || '');
  for (const id of ['home', 'products', 'contact']) {
    if (new RegExp(`id\\s*=\\s*["']${id}["']`, 'i').test(out)) continue;
    if (id === 'home') {
      out = out.replace(/(<body\b[^>]*>)/i, `$1<section id="home" data-sty-anchor="1"></section>`);
    } else if (id === 'products') {
      out = out.replace(/<\/main\s*>/i, '<section id="products" data-sty-anchor="1"></section></main>');
      if (!/id\s*=\s*["']products["']/i.test(out)) {
        out = out.replace(/<\/body\s*>/i, '<section id="products" data-sty-anchor="1"></section></body>');
      }
    } else if (id === 'contact') {
      out = out.replace(/<\/body\s*>/i, '<section id="contact" data-sty-anchor="1"></section></body>');
    }
  }
  return out;
}

function ensureProductSocket(html) {
  let out = String(html || '');
  if (/id\s*=\s*["']productGrid["']/i.test(out) || /data-product-grid/i.test(out)) return out;
  const socket = '<div id="productGrid" data-product-grid data-sty-live="1" data-sty-server-rendered="1"></div>';
  const sectionRe = /<([a-z][a-z0-9]*)\b[^>]*\bid\s*=\s*["']products["'][^>]*>([\s\S]*?)<\/\1\s*>/i;
  if (sectionRe.test(out)) {
    out = out.replace(sectionRe, (whole, tag, inner) => `<${tag} id="products">${inner}\n${socket}\n</${tag}>`);
    return out;
  }
  if (/<\/main\s*>/i.test(out)) {
    out = out.replace(/<\/main\s*>/i, `${socket}</main>`);
    return out;
  }
  out = out.replace(/<\/body\s*>/i, `${socket}</body>`);
  return out;
}

// Full structural repair used at save time (and idempotently at render).
// Returns the repaired html plus human-readable notes for the save report.
function applyStructuralRepair(html, store) {
  const notes = [];
  const wasFragment = !(/^\s*<!doctype\s+html/i.test(String(html || '')) || (/<html[\s>]/i.test(String(html || '')) && /<head[\s>]/i.test(String(html || '')) && /<body[\s>]/i.test(String(html || ''))));
  let out = normalizeHtmlDocument(html, store);
  if (wasFragment) {
    notes.push('Promoted a fragment to a complete page (doctype, head, viewport) — your styles and markup were carried over untouched.');
  } else if (!isSelfContainedVisualDesign(out)) {
    notes.push('No usable <style> block was found — the layout was wrapped in a complete document so the page can never render naked.');
  } else {
    notes.push('Document shell normalized — the supplied CSS and markup were kept exactly as designed.');
  }
  const stripped = stripLiveScaffolding(out);
  out = stripped.html;
  if (stripped.templateCards.length) {
    notes.push(`Removed ${stripped.templateCards.length} visible sample product column${stripped.templateCards.length === 1 ? '' : 's'} — live products now fill the grid instead.`);
  }
  if (stripped.promoStatics.length) {
    const strip = `<div class="sty-promo-static" data-sty-static-strip="1">\n${stripped.promoStatics.join('\n')}\n</div>`;
    if (/id\s*=\s*["']contact["']/i.test(out)) {
      out = out.replace(/(<([a-z][a-z0-9]*)\b[^>]*\bid\s*=\s*["']contact["'][^>]*>)/i, `${strip}\n$1`);
    } else {
      out = out.replace(/<\/body\s*>/i, `${strip}\n</body>`);
    }
    notes.push(`Kept ${stripped.promoStatics.length} decorative promo card${stripped.promoStatics.length === 1 ? '' : 's'} as static banners beside Contact.`);
  }
  const promoted = promoteHiddenTemplate(out, stripped.templateCards);
  out = promoted.html;
  out = ensureHeaderSocket(out, store);
  out = ensureSectionAnchors(out);
  out = ensureProductSocket(out);
  out = /<\/body\s*>/i.test(out)
    ? out.replace(/<\/body\s*>/i, `<template id="stoyangu-card-template">${promoted.authoritative}</template>\n</body>`)
    : `${out}\n<template id="stoyangu-card-template">${promoted.authoritative}</template>`;
  notes.push('Guaranteed one hidden product-card template the live grid clones for every product.');
  return { html: out, notes };
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

// Build one server-rendered card for the static first paint, cloned from the
// authoritative hidden template, so first paint already wears the AI's exact
// card design. The live grid replaces these with interactive clones on boot.
function buildServerCard(product, cardTemplate) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : [product.image_url].filter(Boolean);
  const primary = images[0] || STY_PRODUCT_PH;
  let card = String(cardTemplate || STY_DEFAULT_CARD);
  card = card.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/i, (whole, tag, attrs) => {
    let next = String(attrs || '');
    for (const [name, value] of [
      ['data-id', String(product.id ?? '')],
      ['data-name', String(product.name ?? '')],
      ['data-category', String(product.category ?? '')],
      ['data-price', formatPrice(product.price)],
      ['data-price-value', String(Number(product.price || 0))],
      ['data-image', primary],
    ]) {
      const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
      next = next.replace(pattern, '');
      next = `${next} ${name}="${escapeAttr(value)}"`;
    }
    return `<${tag}${next}>`;
  });
  card = card.replace(/(<img\b[^>]*?\bsrc\s*=\s*["'])[^"']*(["'])/i, `$1${escapeAttr(primary)}$2`);
  card = card.replace(/(<img\b[^>]*?\balt\s*=\s*["'])[^"']*(["'])/i, `$1${escapeAttr(product.name || 'Product')}$2`);
  card = card.replace(/(class\s*=\s*["'][^"']*\bproduct-name\b[^"']*["'][^>]*>)[\s\S]*?(<\/[a-z][a-z0-9]*>)/i, `$1${escapeAttr(product.name || '')}$2`);
  card = card.replace(/(class\s*=\s*["'][^"']*\bproduct-price\b[^"']*["'][^>]*>)[\s\S]*?(<\/[a-z][a-z0-9]*>)/i, `$1${escapeAttr(formatPrice(product.price))}$2`);
  card = card.replace(/(class\s*=\s*["'][^"']*\bproduct-category\b[^"']*["'][^>]*>)[\s\S]*?(<\/[a-z][a-z0-9]*>)/i, `$1${escapeAttr(product.category || '')}$2`);
  return card;
}

// Replace the live socket's inner content (balanced close search, so nested
// same-name tags can't truncate the replacement). Returns null if no socket.
function replaceSocketInner(html, serverCards) {
  const source = String(html || '');
  const openRe = /<([a-z][a-z0-9]*)\b([^>]*\b(?:id\s*=\s*["']productGrid["']|data-product-grid)[^>]*)>/i;
  const m = source.match(openRe);
  if (!m || m.index === undefined) return null;
  const tag = m[1].toLowerCase();
  const openEnd = m.index + m[0].length;
  if (['img', 'br', 'hr', 'input', 'link', 'meta'].includes(tag) || /\/\s*>$/.test(m[0])) {
    return `${source.slice(0, openEnd)}${serverCards}${source.slice(openEnd)}`;
  }
  let depth = 1;
  const inner = new RegExp(`<\\/?${tag}(?![a-z0-9])[^>]*>`, 'gi');
  inner.lastIndex = openEnd;
  let im;
  let guard = 0;
  while ((im = inner.exec(source))) {
    if (++guard > 5000) break;
    if (im[0][1] === '/') depth--;
    else if (!/\/\s*>$/.test(im[0])) depth++;
    if (depth === 0) {
      return `${source.slice(0, openEnd)}${serverCards}${source.slice(im.index)}`;
    }
  }
  return null;
}

function injectLiveProducts(html, store, products) {
  const list = Array.isArray(products) ? products : [];
  // Idempotent: render-time input may be an old, never-repaired save, so the
  // same normalization + scaffolding strip runs here on every render.
  const repaired = applyStructuralRepair(html, store);
  let out = repaired.html;
  const hiddenMatch = out.match(/<template\b[^>]*\bid\s*=\s*["']stoyangu-card-template["'][^>]*>([\s\S]*?)<\/template\s*>/i);
  const cardTemplate = hiddenMatch ? hiddenMatch[1] : STY_DEFAULT_CARD;
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
  out = applyStoreLogo(out, store);
  out = out.replace(/<div\b[^>]*id=["']featuredGrid["'][^>]*>[\s\S]*?<\/div>/i, '<div id="featuredGrid" hidden></div>');
  // Server first paint: static cards in the AI's exact card design, so first
  // paint is never an empty grid. The live grid replaces them with
  // interactive clones on boot; crawlers keep this paint.
  const serverCards = list.map((product) => buildServerCard(product, cardTemplate)).join('\n')
    || '<p class="sty-empty">New products are coming soon.</p>';
  const replaced = replaceSocketInner(out, serverCards);
  if (replaced !== null) {
    out = replaced;
  } else if (/id=["']products["']/.test(out)) {
    out = out.replace(/(<[^>]*id=["']products["'][^>]*>)/i, `$1${serverCards}`);
  } else if (/id=["']shop["']/.test(out)) {
    out = out.replace(/(<[^>]*id=["']shop["'][^>]*>)/i, `$1${serverCards}`);
  } else {
    out = /<\/main>/i.test(out) ? out.replace(/<\/main>/i, `<div id="productGrid" data-product-grid data-sty-live="1">${serverCards}</div></main>`) : `${out}<div id="productGrid" data-product-grid data-sty-live="1">${serverCards}</div>`;
  }
  if (!/id=["']stoyangu-catalog["']/.test(out)) {
    const payload = `<template id="stoyangu-catalog" data-store-slug="${escapeAttr(store.slug)}" data-logo="${escapeAttr(store.logo_url || '')}">${catalog}</template>`;
    out = /<\/body>/i.test(out) ? out.replace(/<\/body>/i, `${payload}</body>`) : out + payload;
  }
  return out;
}

// Decode images asynchronously and lazy-load everything below the first
// paint, so a photo-heavy storefront can never spike a phone's memory into
// a renderer crash ("sad face"). Pure loading hints — zero visual change.
function enhanceImages(html) {
  let index = 0;
  return String(html || '').replace(/<img\b[^>]*>/gi, (tag) => {
    let next = tag;
    if (!/\bdecoding\s*=/i.test(next)) next = next.replace(/<img\b/i, '<img decoding="async"');
    const position = index++;
    if (position >= 3 && !/\bloading\s*=/i.test(next) && !/\bfetchpriority\s*=\s*["']high["']/i.test(next)) {
      next = next.replace(/<img\b/i, '<img loading="lazy"');
    }
    return next;
  });
}

function renderTemplate(templateHtml, store, products, host) {
  const localRepair = repairLocalImagePaths(constrainRemoteImages(String(templateHtml || '')));
  let newHtml = enhanceImages(injectLiveProducts(ensureDesignRuntime(localRepair.html), store, products));
  const phoneDigits = String(store.whatsapp || '').replace(/\D/g, '');
  let assetOrigin = '';
  try { assetOrigin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').origin; } catch {}
  // FIX (stoyangu-500): the old CSP blocked the exact hosts real AI output
  // uses (Tailwind CDNs, https stylesheets/fonts/photos, Maps/YouTube
  // embeds), which stripped layers off new designs until only naked markup
  // was left. The storefront still runs in a sandboxed iframe with network
  // fetch disabled, so allowing asset hosts restores designs without
  // weakening the security posture that matters.
  // FIX (stoyangu-500): the storefront iframe is sandboxed WITHOUT
  // allow-same-origin, so its origin is opaque and CSP 'self' matches
  // nothing — the live-grid bridge script was silently blocked on every
  // load. Listing the page's own origin explicitly lets the bridge run
  // while the sandbox keeps AI scripts fully contained.
  const pageHost = String(host || '').split(',')[0].trim().split(':')[0].toLowerCase();
  const pageOrigins = pageHost ? `https://${pageHost} http://${pageHost}` : '';
  const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net ${assetOrigin} ${pageOrigins}; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'none'; frame-src https://maps.google.com https://www.google.com https://www.youtube.com https://youtu.be; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';">`;
  const storeMeta = `${csp}<meta name="stoyangu-store" data-slug="${escapeAttr(store.slug)}" data-name="${escapeAttr(store.name)}" data-whatsapp="${phoneDigits}" data-currency="KES"><meta name="stoyangu-slug" content="${escapeAttr(store.slug)}"><meta name="stoyangu-server-products" content="${(products || []).length ? 'static-first-paint' : 'empty'}">`;
  let stamped = /<head/i.test(newHtml) ? newHtml.replace(/<head([^>]*)>/i, `<head$1>${storeMeta}`) : `<!doctype html><html><head>${storeMeta}</head><body>${newHtml}</body></html>`;
  if (!/stoyangu-runtime-css/.test(stamped)) {
    stamped = /<\/head\s*>/i.test(stamped)
      ? stamped.replace(/<\/head\s*>/i, `<style id="stoyangu-runtime-css">${STY_RUNTIME_CSS}</style></head>`)
      : `<style id="stoyangu-runtime-css">${STY_RUNTIME_CSS}</style>${stamped}`;
  }
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
  let design = store && typeof store.design_json === 'object' && store.design_json ? store.design_json : {};
  if (typeof store?.design_json === 'string') {
    try { design = JSON.parse(store.design_json); } catch { design = {}; }
  }
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
    popupColor.innerHTML = '<option value="">Choose…</option>' + colors.map(function (c) { return '<option>' + c + '</option>'; }).join('');
    popupSize.innerHTML = '<option value="">Choose…</option>' + sizes.map(function (s) { return '<option>' + s + '</option>'; }).join('');
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
      const { data: storeRow, error: storeErr } = await supabase.from('stores').select('id,name,slug,whatsapp,logo_url,design_json').eq('id', storeId).single();
      if (storeErr || !storeRow) return res.status(404).json({ error: 'Store not found.' });
      const html = String(req.body?.template ?? '');
      const security = preserveRawHtml(html);
      if (!security.ok) return res.status(400).json({ error: 'Could not auto-fix this template.', details: security.errors });
      const visibilityWarnings = scanStorefrontWarnings(security.html);
      if (visibilityWarnings.length) console.warn(`Store ${storeId} HTML visibility warnings:`, visibilityWarnings);
      const localRepair = repairLocalImagePaths(constrainRemoteImages(security.html));
      if (localRepair.repaired.length) console.warn(`Store ${storeId} local image paths repaired:`, localRepair.repaired);
      // FIX (stoyangu-500): normalize the document shell + strip AI scaffolding
      // BEFORE self-hosting, so only the final asset set is mirrored.
      const repaired = applyStructuralRepair(ensureDesignRuntime(localRepair.html), storeRow);
      const intercepted = await selfHostStorefrontAssets(repaired.html, storeId);
      const prepared = intercepted.html;
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
      const notes = [...(security.notes || []), ...(repaired.notes || []), ...visibilityWarnings, ...(intercepted.notes || []), ...(structure.warnings || [])];
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
      const { data: previewMedia, error: previewMediaError } = products?.length ? await supabase.from('product_images').select('*').in('product_id', products.map((product) => product.id)).order('sort_order', { ascending: true }) : { data: [], error: null };
      if (previewMediaError) throw previewMediaError;
      const liveProducts = (products || []).map((product) => {
        const images = (previewMedia || []).filter((image) => image.product_id === product.id).map((image) => image.url).filter(Boolean).slice(0, 7);
        return { ...product, images: images.length ? images : (product.image_url ? [product.image_url] : []) };
      });
      // FIX (stoyangu-500): preview applies the same normalization + repair as
      // save, so what you preview is exactly what gets saved.
      const repairedOverride = repaired.html.trim()
        ? applyStructuralRepair(ensureDesignRuntime(repaired.html), store).html
        : '';
      const template = repairedOverride || readStorefrontHtml(store) || DEFAULT_TEMPLATE.replace(/{{STORE_NAME}}/g, store.name);
      const rendered = renderTemplate(template, store, liveProducts, String(req.headers.host || ''));
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
      const rendered = renderTemplate(storedHtml, store, liveProducts, String(req.headers.host || ''));
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
