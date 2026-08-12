import { apiFetch } from '../lib/api';

const MIMES: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
  txt: 'text/plain', md: 'text/markdown', webmanifest: 'application/manifest+json',
};

const mimeOf = (path: string) => MIMES[path.split('.').pop()?.toLowerCase() || ''] || 'application/octet-stream';

export type SkinUploadResult = { fileCount: number; skipped: number };

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

export async function uploadSkinZip(storeId: number, file: File, onStatus?: (message: string) => void): Promise<SkinUploadResult> {
  onStatus?.('Reading the zip…');
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);
  const entries = Object.entries(zip.files).filter((entry) => !entry[1].dir);
  if (!entries.some((entry) => /(^|\/)index\.html$/i.test(entry[0]))) {
    throw new Error('The zip needs an index.html at its top level.');
  }
  const payloads: Array<{ path: string; blob: Blob; type: string }> = [];
  for (const [rawPath, entry] of entries.slice(0, 160)) {
    const path = rawPath.replace(/^\.\//, '').replace(/^\/+/, '');
    if (!path || path.includes('..') || path.endsWith('/')) continue;
    payloads.push({ path, blob: await entry.async('blob'), type: mimeOf(path) });
  }
  if (!payloads.length) throw new Error('No files found inside the zip.');

  onStatus?.(`Preparing ${payloads.length} files…`);
  const result = await apiFetch<{ signed: Array<{ path: string; signedUrl?: string; skip?: boolean; manifest?: string }>; skipped?: number }>(
    '/api/seo?type=skin',
    { method: 'POST', body: JSON.stringify({ store_id: storeId, files: payloads.map((payload) => ({ path: payload.path, contentType: payload.type })) }) },
  );

  const manifest = result.signed.find((item) => item.path.endsWith('manifest.json'));
  let done = 0;
  for (const item of result.signed) {
    if (item.skip || !item.signedUrl || item.path.endsWith('manifest.json')) continue;
    const payload = payloads.find((candidate) => candidate.path === item.path);
    if (!payload) continue;
    onStatus?.(`Uploading ${++done} / ${payloads.length}…`);
    const res = await fetch(item.signedUrl, { method: 'PUT', headers: { 'Content-Type': payload.type, 'x-upsert': 'true' }, body: payload.blob });
    if (!res.ok) throw new Error(`Upload failed for ${item.path}`);
  }
  if (manifest?.signedUrl && manifest.manifest) {
    await fetch(manifest.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-upsert': 'true' }, body: manifest.manifest });
  }
  onStatus?.(`Skin is live.${result.skipped ? ` (${result.skipped} backend-only file${result.skipped === 1 ? '' : 's'} auto-skipped — normal and safe.)` : ''}`);
  return { fileCount: payloads.length, skipped: result.skipped || 0 };
}
