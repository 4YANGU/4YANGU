import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import supabase from './db-client.js';

const BUCKET = 'stoyangu-media';
const MAX_ASSETS = 60;
const MAX_BYTES = 12 * 1024 * 1024;

const isPrivateV4 = (address) => {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224
    || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
    || (p[0] === 169 && p[1] === 254)
    || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
    || (p[0] === 192 && (p[1] === 0 || p[1] === 168))
    || (p[0] === 198 && (p[1] === 18 || p[1] === 19))
    || (p[0] === 198 && p[1] === 51 && p[2] === 100)
    || (p[0] === 203 && p[1] === 0 && p[2] === 113);
};

const isPrivateV6 = (address) => {
  const value = address.toLowerCase().split('%')[0];
  if (value === '::' || value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb') || value.startsWith('ff')) return true;
  const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateV4(mapped[1]) : false;
};

async function assertPublicUrl(raw) {
  const url = new URL(raw.startsWith('//') ? `https:${raw}` : raw);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only public HTTP(S) assets are allowed.');
  const host = url.hostname.toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '0.0.0.0') throw new Error('Local network address blocked.');
  if (isIP(host)) {
    if ((isIP(host) === 4 && isPrivateV4(host)) || (isIP(host) === 6 && isPrivateV6(host))) throw new Error('Private network address blocked.');
  } else {
    const records = await lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some((row) => row.family === 4 ? isPrivateV4(row.address) : isPrivateV6(row.address))) throw new Error('Host resolves to a private or non-public network.');
  }
  return url;
}

async function guardedFetch(raw) {
  let url = await assertPublicUrl(raw);
  for (let redirect = 0; redirect < 5; redirect++) {
    const response = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'StoYanguAssetMirror/1.0', Accept: '*/*' } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new Error('Redirect without a destination.');
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Asset returned HTTP ${response.status}.`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BYTES) throw new Error('Asset is too large.');
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('Asset is empty or too large.');
    return { buffer, contentType: String(response.headers.get('content-type') || '').split(';')[0].toLowerCase(), finalUrl: url.toString() };
  }
  throw new Error('Too many redirects.');
}

const printable = (buffer) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let safe = 0;
  for (const byte of sample) if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126) || byte >= 128) safe++;
  return safe / Math.max(1, sample.length) > .9;
};

function identify(buffer, contentType, expected) {
  const hex = buffer.subarray(0, 16).toString('hex');
  const ascii = buffer.subarray(0, 32).toString('utf8').trim().toLowerCase();
  const image = hex.startsWith('ffd8ff') ? ['jpg','image/jpeg'] : hex.startsWith('89504e470d0a1a0a') ? ['png','image/png'] : ascii.startsWith('gif87a') || ascii.startsWith('gif89a') ? ['gif','image/gif'] : buffer.subarray(0,4).toString() === 'RIFF' && buffer.subarray(8,12).toString() === 'WEBP' ? ['webp','image/webp'] : /<svg[\s>]/i.test(buffer.subarray(0,1024).toString()) ? ['svg','image/svg+xml'] : null;
  const font = buffer.subarray(0,4).toString() === 'wOFF' ? ['woff','font/woff'] : buffer.subarray(0,4).toString() === 'wOF2' ? ['woff2','font/woff2'] : hex.startsWith('00010000') ? ['ttf','font/ttf'] : buffer.subarray(0,4).toString() === 'OTTO' ? ['otf','font/otf'] : null;
  if (expected === 'image') { if (!image) throw new Error('URL did not return a genuine image.'); return image; }
  if (expected === 'font') { if (!font) throw new Error('URL did not return a genuine font.'); return font; }
  if (image) return image;
  if (font) return font;
  if (expected === 'style' && printable(buffer) && (contentType.includes('css') || ascii.includes('@font-face') || ascii.includes('{'))) return ['css','text/css'];
  if (expected === 'script' && printable(buffer) && (contentType.includes('javascript') || contentType.includes('text/') || ascii.includes('function') || ascii.includes('const '))) return ['js','text/javascript'];
  if (expected === 'media' && (buffer.subarray(4,8).toString() === 'ftyp' || hex.startsWith('1a45dfa3'))) return [buffer.subarray(4,8).toString() === 'ftyp' ? 'mp4' : 'webm', contentType || 'video/mp4'];
  throw new Error('Asset content did not match a safe supported image, font, stylesheet, script or media file.');
}

function references(html) {
  const found = new Map();
  const add = (url, kind) => { const value = String(url || '').trim().replace(/&amp;/g, '&'); const resolvedKind = kind === 'image' && /\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(value) ? 'font' : kind; if (/^https?:\/\//i.test(value) || value.startsWith('//')) if (!found.has(value)) found.set(value, resolvedKind); };
  let match;
  const patterns = [
    [/<(?:img|source|video)\b[^>]*\b(?:src|poster)=["']([^"']+)["']/gi,'image'],
    [/<script\b[^>]*\bsrc=["']([^"']+)["']/gi,'script'],
    [/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi,'style'],
    [/url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi,'image'],
    [/@import\s+(?:url\()?\s*["']?(https?:\/\/[^"')\s;]+)["']?/gi,'style'],
  ];
  for (const [pattern, kind] of patterns) while ((match = pattern.exec(html))) add(match[1], kind);
  const srcsets = /\bsrcset=["']([^"']+)["']/gi;
  while ((match = srcsets.exec(html))) match[1].split(',').forEach((part) => add(part.trim().split(/\s+/)[0], 'image'));
  return [...found.entries()].slice(0, MAX_ASSETS).map(([url, kind]) => ({ url, kind }));
}

const publicUrlFor = (path) => supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

export async function selfHostStorefrontAssets(html, storeId) {
  let out = String(html || '');
  const notes = [];
  const mirrored = new Map();
  const supabaseHost = (() => { try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname; } catch { return ''; } })();

  async function mirror(raw, expected, depth = 0) {
    if (mirrored.has(raw)) return mirrored.get(raw);
    const parsed = await assertPublicUrl(raw);
    if (parsed.hostname === supabaseHost && parsed.pathname.includes(`/storage/v1/object/public/${BUCKET}/`)) return raw;
    const fetched = await guardedFetch(parsed.toString());
    const [extension, mime] = identify(fetched.buffer, fetched.contentType, expected);
    let body = fetched.buffer;
    if (extension === 'css' && depth < 2) {
      let css = body.toString('utf8');
      const children = [];
      let match;
      const childPattern = /url\(\s*["']?([^"')]+)["']?\s*\)/gi;
      while ((match = childPattern.exec(css))) {
        try { const absolute = new URL(match[1], fetched.finalUrl).toString(); if (/^https?:/i.test(absolute)) children.push(absolute); } catch {}
      }
      for (const child of [...new Set(children)].slice(0, 30)) {
        try { const childExpected = /\.(?:woff2?|ttf|otf)(?:\?|$)/i.test(child) ? 'font' : 'image'; const hosted = await mirror(child, childExpected, depth + 1); css = css.split(child).join(hosted); } catch (error) { notes.push(`Could not mirror stylesheet asset ${child}: ${error.message}`); }
      }
      body = Buffer.from(css, 'utf8');
    }
    const hash = createHash('sha256').update(parsed.toString()).digest('hex').slice(0, 28);
    const path = `storefront-assets/${storeId}/${hash}.${extension}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, body, { contentType: mime, cacheControl: '31536000', upsert: true });
    if (error) throw error;
    const hosted = publicUrlFor(path);
    mirrored.set(raw, hosted);
    mirrored.set(parsed.toString(), hosted);
    return hosted;
  }

  for (const reference of references(out)) {
    try {
      const hosted = await mirror(reference.url, reference.kind);
      out = out.split(reference.url).join(hosted);
      out = out.split(reference.url.replace(/&/g, '&amp;')).join(hosted);
      notes.push(`Self-hosted ${reference.kind}: ${new URL(reference.url.startsWith('//') ? `https:${reference.url}` : reference.url).hostname}`);
    } catch (error) {
      notes.push(`Blocked or could not self-host ${reference.url}: ${error.message}`);
    }
  }
  return { html: out, notes, mirrored: mirrored.size };
}

export function scanStorefrontWarnings(html) {
  const checks = [
    ['fetch(', /\bfetch\s*\(/gi], ['XMLHttpRequest', /\bXMLHttpRequest\b/gi], ['eval(', /\beval\s*\(/gi], ['Function constructor', /\bnew\s+Function\s*\(/gi], ['document.cookie', /document\s*\.\s*cookie/gi], ['localStorage', /\blocalStorage\b/gi], ['WebSocket', /\bWebSocket\b/gi],
  ];
  return checks.filter(([, pattern]) => pattern.test(String(html || ''))).map(([label]) => `Visibility warning only: found ${label}. It was kept unchanged and remains contained by the sandbox/CSP.`);
}

// ---------------------------------------------------------------------------
// Local image path repair
// AI-generated storefronts often reference local files that do not exist on
// StoYangu (e.g. <img src="/images/hero-jersey.jpg">), which render as
// broken images. This rewrites every unknown local image path to the
// closest-matching photo from the platform's bundled image library so the
// storefront always renders. Paths that already point to a bundled asset,
// an https URL, a data URI or a storage URL are left untouched.
// ---------------------------------------------------------------------------
const BUNDLED_ASSETS = new Set([
  '/stoyangu-logo.png', '/favicon.svg', '/favicon.ico', '/favicon-32.png', '/favicon-192.png', '/favicon-512.png', '/apple-touch-icon.png', '/sticker-emblem.png', '/vite.svg',
  '/images/apply-phone.jpg', '/images/black-fashion-seller.jpg', '/images/black-phone-seller.jpg', '/images/black-seller-lifestyle.jpg', '/images/black-seller-window.jpg', '/images/black-social-seller.jpg',
  '/images/category-products-flatlay.jpg', '/images/kenyan-seller.jpg', '/images/kito-hoodie.jpg', '/images/kito-logo.jpg', '/images/kito-set.jpg', '/images/kito-shoes.jpg', '/images/kito-toy.jpg',
  '/images/lily-bag.jpg', '/images/lily-blouse.jpg', '/images/lily-dress.jpg', '/images/lily-logo.jpg', '/images/lily-set.jpg', '/images/login-seller.jpg',
  '/images/mali-basket.jpg', '/images/mali-board.jpg', '/images/mali-logo.jpg', '/images/mali-mats.jpg', '/images/mali-vase.jpg',
  '/images/nairobi-market-seller.jpg', '/images/nairobi-seller-portrait.jpg', '/images/seller-recording-shop.jpg', '/images/seller-video.jpg', '/images/shop-owner.jpg',
  '/images/stevo-hoodie.jpg', '/images/stevo-jersey-product.jpg', '/images/stevo-jersey.jpg', '/images/stevo-logo.svg', '/images/stevo-perfume.jpg', '/images/stevo-polo-product.jpg', '/images/stevo-polo.jpg',
  '/images/store-build-preview.jpg', '/images/testimonial-recording.jpg',
]);

const LOCAL_IMAGE_RULES = [
  [/hero[^ ]*jersey|jersey[^ ]*hero/i, '/images/stevo-jersey-product.jpg'],
  [/jersey|uniform|team.?kit/i, '/images/stevo-jersey.jpg'],
  [/polo/i, '/images/stevo-polo.jpg'],
  [/hoodie|fleece|sweat/i, '/images/stevo-hoodie.jpg'],
  [/round.?neck|t-?shirt|tee\b|shirt|apparel|clothing|collection|garment/i, '/images/category-products-flatlay.jpg'],
  [/shoe|sneaker|kicks|trainer|boot/i, '/images/kito-shoes.jpg'],
  [/dress/i, '/images/lily-dress.jpg'],
  [/blouse|women.?s? top/i, '/images/lily-blouse.jpg'],
  [/bag|tote/i, '/images/lily-bag.jpg'],
  [/basket/i, '/images/mali-basket.jpg'],
  [/vase/i, '/images/mali-vase.jpg'],
  [/\bmat(s|ch)?\b/i, '/images/mali-mats.jpg'],
  [/perfume|fragrance/i, '/images/stevo-perfume.jpg'],
  [/toy|plush/i, '/images/kito-toy.jpg'],
  [/kids|child/i, '/images/kito-set.jpg'],
  [/hero|banner|cover|lifestyle|model|fashion/i, '/images/black-fashion-seller.jpg'],
  [/market|shop|store|seller|business/i, '/images/nairobi-market-seller.jpg'],
];

const pickLocalFallback = (path, alt) => {
  const signal = `${path} ${alt || ''}`;
  for (const [pattern, target] of LOCAL_IMAGE_RULES) if (pattern.test(signal)) return target;
  return '/images/category-products-flatlay.jpg';
};

const isExternalRef = (value) => /^(?:https?:|data:|blob:|#|\/\/)/i.test(value);

export function repairLocalImagePaths(html) {
  const repaired = [];
  let out = String(html || '');
  out = out.replace(/<(?:img|source|video)\b[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\b(?:src|poster)=["']([^"']+)["']/i);
    if (!srcMatch) return tag;
    const value = String(srcMatch[1] || '').trim();
    if (!value || isExternalRef(value)) return tag;
    const normalized = value.startsWith('/') ? value : `/${value}`;
    if (BUNDLED_ASSETS.has(normalized.split('?')[0])) return tag;
    const altMatch = tag.match(/\balt=["']([^"']*)["']/i);
    const fallback = pickLocalFallback(normalized, altMatch ? altMatch[1] : '');
    repaired.push({ from: value, to: fallback });
    return tag.replace(srcMatch[1], fallback);
  });
  out = out.replace(/\bsrcset=["']([^"']+)["']/gi, (whole, list) => {
    let touched = false;
    const changed = String(list).split(',').map((part) => {
      const bits = part.trim().split(/\s+/);
      if (!bits[0] || isExternalRef(bits[0])) return part.trim();
      const normalized = bits[0].startsWith('/') ? bits[0] : `/${bits[0]}`;
      if (BUNDLED_ASSETS.has(normalized.split('?')[0])) return part.trim();
      const fallback = pickLocalFallback(normalized, '');
      repaired.push({ from: bits[0], to: fallback });
      bits[0] = fallback;
      touched = true;
      return bits.join(' ');
    }).join(', ');
    return touched ? `srcset="${changed}"` : whole;
  });
  out = out.replace(/url\(\s*["']?(\/(?!\/)[^"')]+)["']?\s*\)/gi, (whole, value) => {
    if (isExternalRef(value) || BUNDLED_ASSETS.has(value.split('?')[0])) return whole;
    const fallback = pickLocalFallback(value, '');
    repaired.push({ from: value, to: fallback });
    return `url(${fallback})`;
  });
  return { html: out, repaired };
}
