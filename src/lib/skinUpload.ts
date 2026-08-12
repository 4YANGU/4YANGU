import { apiFetch } from './api';

const TEXT_EXTS = new Set(['html', 'htm', 'css', 'js', 'json', 'txt', 'md', 'webmanifest', 'map', 'svg']);
const BINARY_NEUTRAL = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'mp3', 'wav'];
const BINARY_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
};
const mimeOf = (ext: string) => BINARY_MIMES[ext] || 'application/octet-stream';

export type SkinUploadResult = { files: number; warnings: string[] };

export async function skinStatus(storeId: number): Promise<boolean> {
  try {
    const res = await apiFetch<{ active?: boolean }>('/api/seo?type=skin', { method: 'POST', body: JSON.stringify({ action: 'status', store_id: storeId }) });
    return Boolean(res.active);
  } catch {
    return false;
  }
}

export async function disableSkin(storeId: number): Promise<void> {
  await apiFetch('/api/seo?type=skin', { method: 'POST', body: JSON.stringify({ action: 'disable', store_id: storeId }) });
}

const cleanPath = (raw: string) => raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');

// Zips often wrap everything in one top-level folder; flatten it if the
// contract files live inside it.
function stripSingleWrapper<T extends { path: string }>(items: T[]): T[] {
  const roots = new Set(items.map((item) => item.path.split('/')[0]));
  if (roots.size !== 1) return items;
  const root = [...roots][0];
  const required = [`${root}/storefront.html`, `${root}/product-template.html`];
  return required.every((need) => items.some((item) => item.path === need))
    ? items.map((item) => ({ ...item, path: item.path.slice(root.length + 1) }))
    : items;
}

export async function uploadSkinZip(storeId: number, file: File, onStatus?: (message: string) => void): Promise<SkinUploadResult> {
  if (!/\.zip$/i.test(file.name)) throw new Error('Upload the skin as a .zip containing storefront.html + product-template.html + styles.css (+ script.js + assets folder).');

  onStatus?.('Reading the zip…');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);

  const collected: Array<{ path: string; entry: (typeof zip.files)[string] }> = [];
  for (const [rawPath, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const path = cleanPath(rawPath);
    if (!path || path.includes('..') || path.endsWith('/')) continue;
    const ext = path.split('.').pop()?.toLowerCase() || '';
    if (!(BINARY_NEUTRAL.includes(ext) || TEXT_EXTS.has(ext))) continue; // silently skipped at the gate
    collected.push({ path, entry });
  }
  const files = stripSingleWrapper(collected);
  if (!files.length) throw new Error('No usable front-end files found in that zip.');
  if (!files.some((item) => /(^|\/)storefront\.html$/i.test(item.path)) || !files.some((item) => /(^|\/)product-template\.html$/i.test(item.path))) {
    throw new Error('The skin needs storefront.html AND product-template.html at the top of the folder.');
  }

  onStatus?.('Checking the skin…');
  const texts: Array<{ path: string; content: string }> = [];
  const binariesMeta: Array<{ path: string; contentType: string }> = [];
  const binaryBlobs = new Map<string, Blob>();

  for (const fileEntry of files) {
    const ext = fileEntry.path.split('.').pop()?.toLowerCase() || '';
    if (TEXT_EXTS.has(ext)) texts.push({ path: fileEntry.path, content: await fileEntry.entry.async('string') });
    else {
      binariesMeta.push({ path: fileEntry.path, contentType: mimeOf(ext) });
      binaryBlobs.set(fileEntry.path, await fileEntry.entry.async('blob'));
    }
  }

  const result = await apiFetch<{
    signed: Array<{ path: string; signedUrl?: string }>;
    warnings?: string[];
    error?: string;
    details?: string[];
  }>('/api/seo?type=skin', {
    method: 'POST',
    body: JSON.stringify({ action: 'upload', store_id: storeId, texts, binaries: binariesMeta }),
  });

  if (result.warnings?.length) console.warn('Skin warnings:', result.warnings);

  let done = 0;
  for (const item of result.signed || []) {
    if (!item.signedUrl) continue;
    const blob = binaryBlobs.get(item.path);
    if (!blob) continue;
    onStatus?.(`Uploading ${++done} / ${binaryBlobs.size}…`);
    const res = await fetch(item.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': binariesMeta.find((binary) => binary.path === item.path)?.contentType || 'application/octet-stream', 'x-upsert': 'true' },
      body: blob,
    });
    if (!res.ok) throw new Error(`Upload failed for ${item.path}`);
  }

  onStatus?.(binaryBlobs.size ? 'Skin is live.' : 'Skin is live.');
  return { files: texts.length + binariesMeta.length, warnings: result.warnings || [] };
}
