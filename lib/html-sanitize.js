// StoYangu storefront sanitizer.
// Runs when HTML is saved and again when it is shown.
// Removes scripts, event handlers, javascript: URLs, unsafe iframes/forms,
// risky CSS, and anything outside the allowlist. Layout, colours and
// photos stay so the shop still looks like the design.

import { injectPreservedTheme } from './html-theme.js';

const MAX_HTML_BYTES = 1_500_000;

const ALLOWED_HOST = /^(?:[a-z0-9-]+\.)*(?:wa\.me|t\.me|instagram\.com|facebook\.com|threads\.net|twitter\.com|x\.com|youtube\.com|youtu\.be|tiktok\.com|maps\.google\.com|google\.com|gstatic\.com|googleapis\.com|fonts\.googleapis\.com|fonts\.gstatic\.com|images\.unsplash\.com|plus\.unsplash\.com|images\.pexels\.com|cdn\.pixabay\.com|images\.pixabay\.com|cdn\.jsdelivr\.net|unpkg\.com|supabase\.co)$/i;

const ALLOWED_IFRAME_HOST = /^(?:www\.)?(?:maps\.google\.com|google\.com|youtube\.com|www\.youtube\.com|youtu\.be)$/i;

const ALLOWED_LINK_HREF = /^(#|\/(?!\/)|https:\/\/wa\.me|https:\/\/t\.me|https:\/\/(www\.)?(instagram|facebook|threads|twitter|x|youtube|tiktok|maps\.google)\.com|tel:|mailto:)/i;

const EVENT_ATTR = /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;

const PLACEHOLDER_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="100%" height="100%" fill="#e6dcc8"/><text x="50%" y="50%" font-size="16" text-anchor="middle" fill="#8a8475" font-family="system-ui">image</text></svg>',
);

function hostOf(raw) {
  try {
    const value = String(raw || '').trim();
    if (!value) return '';
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.hostname.toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedUrl(raw, extraHostTest) {
  const value = String(raw || '').trim();
  if (!value) return false;
  if (value.startsWith('/') && !value.startsWith('//')) return true;
  if (value.startsWith('data:image/')) return true;
  if (value.startsWith('blob:') || value.startsWith('#')) return true;
  if (/^https?:\/\//i.test(value) || value.startsWith('//')) {
    const host = hostOf(value);
    if (!host) return false;
    if (extraHostTest && extraHostTest.test(host)) return true;
    return ALLOWED_HOST.test(host);
  }
  return false;
}

function looksLikeTailwind(html) {
  if (/tailwind\.config|cdn\.tailwindcss\.com/i.test(html)) return true;
  const hits = html.match(/\bclass=["'][^"']*\b(?:flex|grid|min-h-screen|bg-|text-|md:|lg:|sm:|xl:)/gi) || [];
  return hits.length >= 4;
}

function sanitizeCss(css, report) {
  let out = String(css || '');
  const imports = out.match(/@import[^;]+;/gi) || [];
  if (imports.length) {
    out = out.replace(/@import[^;]+;/gi, '');
    report.push(`Removed ${imports.length} CSS @import rule${imports.length === 1 ? '' : 's'} (outside the allowlist).`);
  }
  const expressions = out.match(/expression\s*\(/gi) || [];
  if (expressions.length) {
    out = out.replace(/expression\s*\(/gi, 'void(');
    report.push(`Removed ${expressions.length} risky CSS expression().`);
  }
  const jsUrls = out.match(/url\(\s*['"]?\s*javascript:[^)]+\)/gi) || [];
  if (jsUrls.length) {
    out = out.replace(/url\(\s*['"]?\s*javascript:[^)]+\)/gi, 'none');
    report.push(`Removed ${jsUrls.length} javascript: URL${jsUrls.length === 1 ? '' : 's'} from CSS.`);
  }
  const behaviors = out.match(/(-moz-binding|behavior)\s*:/gi) || [];
  if (behaviors.length) {
    out = out.replace(/(-moz-binding|behavior)\s*:[^;}\n]+/gi, '');
    report.push(`Removed ${behaviors.length} risky CSS behavior rule${behaviors.length === 1 ? '' : 's'}.`);
  }
  out = out.replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/gi, (full, quote, ref) => {
    const trimmed = String(ref || '').trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('#') || trimmed.startsWith('/')) return full;
    if (isAllowedUrl(trimmed)) return full;
    report.push(`Blocked off-allowlist CSS background ${trimmed.slice(0, 80)}.`);
    return 'none';
  });
  return out;
}

export function sanitizeStorefrontHtml(rawHtml) {
  const notes = [];
  const summary = {
    scripts: 0,
    event_handlers: 0,
    javascript_urls: 0,
    iframes: 0,
    forms: 0,
    objects: 0,
    risky_css: 0,
    blocked_urls: 0,
    meta_refresh: 0,
    whatsapp_links: 0,
  };

  if (typeof rawHtml !== 'string' || !rawHtml.trim()) {
    return { ok: false, errors: ['Template is empty. Paste your HTML and try again.'], html: rawHtml || '', notes, summary };
  }
  if (Buffer.byteLength(rawHtml, 'utf8') > MAX_HTML_BYTES) {
    return { ok: false, errors: [`Template is larger than ${Math.round(MAX_HTML_BYTES / 1024)} KB.`], html: rawHtml, notes, summary };
  }

  const usedTailwind = looksLikeTailwind(rawHtml);
  const themedSource = rawHtml;
  let html = rawHtml;

  const scriptBlocks = html.match(/<script\b[\s\S]*?<\/script>/gi) || [];
  const loneScripts = html.match(/<script\b[^>]*\/?>/gi) || [];
  const scriptCount = Math.max(scriptBlocks.length, loneScripts.length);
  if (scriptCount) {
    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<script\b[^>]*\/?>/gi, '');
    summary.scripts = scriptCount;
    notes.push(`Removed ${scriptCount} <script> block${scriptCount === 1 ? '' : 's'} (including Tailwind/AOS/inline shop JS). Visual layout is kept.`);
  }

  const noscript = html.match(/<noscript\b[\s\S]*?<\/noscript>/gi) || [];
  if (noscript.length) {
    html = html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
    notes.push(`Removed ${noscript.length} <noscript> block${noscript.length === 1 ? '' : 's'}.`);
  }

  const events = html.match(EVENT_ATTR) || [];
  if (events.length) {
    html = html.replace(EVENT_ATTR, '');
    summary.event_handlers = events.length;
    notes.push(`Removed ${events.length} inline event handler${events.length === 1 ? '' : 's'} (onclick, onerror, onload, …).`);
  }

  const jsHrefs = html.match(/\b(?:href|src|action|xlink:href|formaction)\s*=\s*["']\s*javascript:[^"']*["']/gi) || [];
  if (jsHrefs.length) {
    html = html.replace(/\b((?:href|src|action|xlink:href|formaction)\s*=\s*["'])\s*javascript:[^"']*(["'])/gi, '$1#$2');
    summary.javascript_urls = jsHrefs.length;
    notes.push(`Replaced ${jsHrefs.length} javascript: URL${jsHrefs.length === 1 ? '' : 's'} with #.`);
  }

  const whatsappAnchors = html.match(/<a\b[^>]*\bhref\s*=\s*["']https?:\/\/(?:wa\.me|api\.whatsapp\.com)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi) || [];
  if (whatsappAnchors.length) {
    html = html.replace(/<a\b[^>]*\bhref\s*=\s*["']https?:\/\/(?:wa\.me|api\.whatsapp\.com)[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '');
    summary.whatsapp_links = whatsappAnchors.length;
    notes.push(`Removed ${whatsappAnchors.length} general WhatsApp link${whatsappAnchors.length === 1 ? '' : 's'}; WhatsApp is only opened after a confirmed product order.`);
  }

  const dataHtml = html.match(/\b(?:href|src|action)\s*=\s*["']\s*data:text\/html[^"']*["']/gi) || [];
  if (dataHtml.length) {
    html = html.replace(/\b((?:href|src|action)\s*=\s*["'])\s*data:text\/html[^"']*(["'])/gi, '$1#$2');
    summary.javascript_urls += dataHtml.length;
    notes.push(`Blocked ${dataHtml.length} data:text/html URL${dataHtml.length === 1 ? '' : 's'}.`);
  }

  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (full) => {
    const src = (/src\s*=\s*["']([^"']+)["']/i.exec(full) || [])[1] || '';
    if (src && isAllowedUrl(src, ALLOWED_IFRAME_HOST)) return full;
    summary.iframes += 1;
    return '<div class="sty-removed-iframe" aria-hidden="true"></div>';
  });
  html = html.replace(/<iframe\b[^>]*\/?>/gi, (full) => {
    if (/<\/iframe>/i.test(full)) return full;
    const src = (/src\s*=\s*["']([^"']+)["']/i.exec(full) || [])[1] || '';
    if (src && isAllowedUrl(src, ALLOWED_IFRAME_HOST)) return full;
    summary.iframes += 1;
    return '';
  });
  if (summary.iframes) notes.push(`Removed ${summary.iframes} unsafe <iframe>${summary.iframes === 1 ? '' : 's'} (only Maps / YouTube stay).`);

  html = html.replace(/<form\b([^>]*)>/gi, (full, attrs) => {
    let next = attrs
      .replace(/\baction\s*=\s*["'][^"']*["']/gi, 'action="#"')
      .replace(/\bmethod\s*=\s*["'][^"']*["']/gi, 'method="get"')
      .replace(/\btarget\s*=\s*["'][^"']*["']/gi, '');
    if (!/\baction\s*=/i.test(next)) next += ' action="#"';
    summary.forms += 1;
    return `<form${next}>`;
  });
  if (summary.forms) notes.push(`Neutralised ${summary.forms} <form>${summary.forms === 1 ? '' : 's'} (they can no longer post off-site).`);

  const objects = html.match(/<(object|embed|applet|frame|frameset)\b[\s\S]*?(?:\/>|<\/\1>)/gi) || [];
  if (objects.length) {
    html = html.replace(/<(object|embed|applet|frame|frameset)\b[\s\S]*?(?:\/>|<\/\1>)/gi, '');
    summary.objects = objects.length;
    notes.push(`Removed ${objects.length} <object>/<embed>/<frame> tag${objects.length === 1 ? '' : 's'}.`);
  }

  const bases = html.match(/<base\b[^>]*>/gi) || [];
  if (bases.length) {
    html = html.replace(/<base\b[^>]*>/gi, '');
    notes.push(`Removed ${bases.length} <base> tag${bases.length === 1 ? '' : 's'} so links cannot be hijacked.`);
  }

  const refreshes = html.match(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi) || [];
  if (refreshes.length) {
    html = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*>/gi, '');
    summary.meta_refresh = refreshes.length;
    notes.push(`Removed ${refreshes.length} meta refresh tag${refreshes.length === 1 ? '' : 's'}.`);
  }

  html = html.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi, (full, attrs, css) => {
    const before = css;
    const cleaned = sanitizeCss(css, notes);
    if (cleaned !== before) summary.risky_css += 1;
    return `<style${attrs}>${cleaned}</style>`;
  });
  html = html.replace(/\bstyle\s*=\s*"([^"]*)"/gi, (full, css) => {
    const cleaned = sanitizeCss(css, notes);
    if (cleaned !== css) summary.risky_css += 1;
    return `style="${cleaned.replace(/"/g, '&quot;')}"`;
  });

  html = html.replace(/<link\b[^>]*>/gi, (full) => {
    const href = (/href\s*=\s*["']([^"']+)["']/i.exec(full) || [])[1] || '';
    const rel = ((/rel\s*=\s*["']([^"']+)["']/i.exec(full) || [])[1] || '').toLowerCase();
    if (!href || href.startsWith('/') || href.startsWith('data:')) return full;
    if (/stylesheet|preconnect|icon|preload|apple-touch-icon/.test(rel) && isAllowedUrl(href)) return full;
    if (isAllowedUrl(href) && /stylesheet|preconnect|icon/.test(rel)) return full;
    summary.blocked_urls += 1;
    notes.push(`Dropped <link> to ${href.slice(0, 90)} (outside the allowlist).`);
    return '';
  });

  html = html.replace(/<img\b([^>]*?)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>/gi, (full, before, src, after) => {
    if (isAllowedUrl(src)) return full;
    summary.blocked_urls += 1;
    notes.push(`Replaced off-allowlist image ${src.slice(0, 80)} with a placeholder.`);
    return `<img${before}src="${PLACEHOLDER_IMG}"${after}>`;
  });

  html = html.replace(/<a\b([^>]*?)\bhref\s*=\s*["']([^"']+)["']([^>]*)>/gi, (full, before, href, after) => {
    const trimmed = href.trim();
    if (!trimmed || ALLOWED_LINK_HREF.test(trimmed) || isAllowedUrl(trimmed)) return full;
    if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('//')) {
      summary.blocked_urls += 1;
      notes.push(`Replaced off-allowlist link ${trimmed.slice(0, 80)} with #.`);
      return `<a${before}href="#"${after}>`;
    }
    return full;
  });

  if (usedTailwind && !/cdn\.jsdelivr\.net\/npm\/tailwindcss/i.test(html)) {
    const tailwindCss = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css">';
    html = /<head/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1>\n${tailwindCss}\n`)
      : `${tailwindCss}${html}`;
    notes.push('Kept the look of Tailwind classes by adding a safe stylesheet (no Tailwind JavaScript).');
  }

  if (usedTailwind || /tailwind\.config|bg-ink|text-bone|bg-flame/.test(themedSource)) {
    html = injectPreservedTheme(html, themedSource);
    notes.push('Kept the shop colours (ink, flame, bone and the rest) so they still show after scripts are removed.');
  }

  // There is never a cart. Remove bag / checkout drawers so only View product → WhatsApp remains.
  const cartBits = [
    /<aside\b[^>]*id=["']cartDrawer["'][\s\S]*?<\/aside>/gi,
    /<div\b[^>]*id=["']cartOverlay["'][^>]*>[\s\S]*?<\/div>/gi,
    /<button\b[^>]*id=["']cartBtn["'][\s\S]*?<\/button>/gi,
    /<div\b[^>]*id=["']toast["'][\s\S]*?<\/div>/gi,
    /<span\b[^>]*id=["']cartCount["'][\s\S]*?<\/span>/gi,
  ];
  let removedCart = 0;
  cartBits.forEach((pattern) => {
    const before = html;
    html = html.replace(pattern, '');
    if (html !== before) removedCart += 1;
  });
  if (removedCart) notes.push('Removed the shopping cart / bag. Customers order one product at a time on WhatsApp.');

  const hideChrome = `<style id="stoyangu-commerce-rules">
#cartBtn,#cartDrawer,#cartOverlay,#cartCount,#cartCountLabel,#cartItems,#cartEmpty,#cartFooter,#checkoutSuccess,#toast,.cart-drawer,.cart-overlay{display:none!important;visibility:hidden!important;pointer-events:none!important}
.product-popup:not(.open),#productModal:not(.open),.modal-backdrop:not(.open){display:none!important;opacity:0!important;pointer-events:none!important}
.product-popup.open{display:flex!important;opacity:1!important;pointer-events:auto!important}
</style>`;
  if (!/id="stoyangu-commerce-rules"/.test(html)) {
    html = /<head/i.test(html) ? html.replace(/<head([^>]*)>/i, `<head$1>\n${hideChrome}\n`) : hideChrome + html;
  }

  const unique = [];
  for (const note of notes) {
    if (!unique.includes(note)) unique.push(note);
  }

  return { ok: true, errors: [], html, notes: unique, summary };
}

export function sanitizationHeadline(summary) {
  const parts = [];
  if (summary.scripts) parts.push(`${summary.scripts} script${summary.scripts === 1 ? '' : 's'}`);
  if (summary.event_handlers) parts.push(`${summary.event_handlers} event handler${summary.event_handlers === 1 ? '' : 's'}`);
  if (summary.javascript_urls) parts.push(`${summary.javascript_urls} javascript: URL${summary.javascript_urls === 1 ? '' : 's'}`);
  if (summary.iframes) parts.push(`${summary.iframes} iframe${summary.iframes === 1 ? '' : 's'}`);
  if (summary.forms) parts.push(`${summary.forms} form${summary.forms === 1 ? '' : 's'}`);
  if (summary.objects) parts.push(`${summary.objects} embed/object`);
  if (summary.risky_css) parts.push(`${summary.risky_css} risky CSS block${summary.risky_css === 1 ? '' : 's'}`);
  if (summary.blocked_urls) parts.push(`${summary.blocked_urls} blocked URL${summary.blocked_urls === 1 ? '' : 's'}`);
  if (!parts.length) return 'Nothing unsafe was found. The HTML was saved as designed.';
  return `Sanitised: ${parts.join(', ')}.`;
}
