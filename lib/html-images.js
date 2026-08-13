// StoYangu — copy Unsplash (and similar) photos into our own storage
// when a founder pastes AI-generated HTML. The shop then uses permanent
// StoYangu links instead of photos that can disappear.

import supabase from './db-client.js';

export const SKIN_BUCKET = 'stoyangu-media';

const IMAGE_HOSTS = /(\.|^)(unsplash\.com|images\.unsplash\.com|plus\.unsplash\.com|images\.pexels\.com|pixabay\.com|cdn\.pixabay\.com)$/i;
const MAX_IMAGES = 24;
const MAX_BYTES = 8 * 1024 * 1024;

export function isHotlinkImageHost(hostname) {
  return IMAGE_HOSTS.test(String(hostname || '').toLowerCase());
}

export function extractRemoteImageUrls(html) {
  const text = String(html || '');
  const found = new Set();

  const pushIfRemote = (raw) => {
    const url = String(raw || '').trim().split(/\s+/)[0];
    if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('/') || url.startsWith('#')) return;
    try {
      const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
      if (!/^https?:$/i.test(parsed.protocol)) return;
      if (isHotlinkImageHost(parsed.hostname)) found.add(parsed.toString());
    } catch {
      /* ignore unreadable urls */
    }
  };

  const attrPatterns = [
    /<(?:img|source|video|image)\b[^>]*?\b(?:src|href|poster)\s*=\s*["']([^"']+)["']/gi,
    /\bsrcset\s*=\s*["']([^"']+)["']/gi,
    /url\(\s*["']?(https?:\/\/[^"')]+)["']?\s*\)/gi,
    /["'](https?:\/\/images\.unsplash\.com[^"']+)["']/gi,
    /["'](https?:\/\/plus\.unsplash\.com[^"']+)["']/gi,
    /["'](https?:\/\/images\.pexels\.com[^"']+)["']/gi,
  ];

  for (const pattern of attrPatterns) {
    let match;
    while ((match = pattern.exec(text))) {
      const chunk = match[1] || '';
      if (pattern.source.includes('srcset')) {
        chunk.split(',').forEach((part) => pushIfRemote(part.trim().split(/\s+/)[0]));
      } else {
        pushIfRemote(chunk);
      }
    }
  }

  return [...found].slice(0, MAX_IMAGES);
}

function extensionFor(contentType, url) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('avif')) return 'avif';
  if (type.includes('svg')) return 'svg';
  const fromUrl = String(url || '').split('?')[0].split('.').pop()?.toLowerCase();
  if (fromUrl && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'].includes(fromUrl)) return fromUrl === 'jpeg' ? 'jpg' : fromUrl;
  return 'jpg';
}

function sniffContentType(buffer, fallback) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return 'image/gif';
  return fallback || 'image/jpeg';
}

async function downloadImage(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'StoYanguStorefront/1.0 (+https://stoyangu.com)',
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length || buffer.length > MAX_BYTES) throw new Error('empty or oversized');
  const contentType = sniffContentType(buffer, response.headers.get('content-type'));
  return { buffer, contentType };
}

async function uploadBuffer(storeId, buffer, contentType, url, index) {
  const ext = extensionFor(contentType, url);
  const path = `storefronts/${storeId}/${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabase.storage.from(SKIN_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
    cacheControl: '31536000',
  });
  if (error) throw error;
  const { data } = supabase.storage.from(SKIN_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export async function interceptHotlinkImages(html, storeId) {
  const notes = [];
  const urls = extractRemoteImageUrls(html);
  if (!urls.length) return { html: String(html || ''), notes, replaced: 0 };

  let out = String(html || '');
  let replaced = 0;

  const jobs = urls.map((url, index) =>
    downloadImage(url)
      .then(({ buffer, contentType }) => uploadBuffer(storeId, buffer, contentType, url, index))
      .then((publicUrl) => ({ url, publicUrl, ok: true }))
      .catch((err) => ({ url, ok: false, error: err?.message || String(err) })),
  );

  const results = await Promise.all(jobs);
  for (const result of results) {
    if (!result.ok || !result.publicUrl) {
      notes.push(`Could not copy photo ${result.url} — left the original link.`);
      continue;
    }
    if (out.includes(result.url)) {
      out = out.split(result.url).join(result.publicUrl);
      replaced += 1;
      notes.push(`Saved a photo from Unsplash/Pexels into StoYangu storage.`);
    }
  }

  return { html: out, notes, replaced };
}
