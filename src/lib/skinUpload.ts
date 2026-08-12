import { apiFetch } from './api';

const TEXT_EXTS = new Set(['html', 'htm', 'css', 'js', 'json', 'txt', 'md', 'webmanifest', 'map', 'svg']);
const BINARY_NEUTRAL = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm', 'mp3', 'wav'];
const BINARY_MIMES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif', ico: 'image/x-icon',
  woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav',
};
const mimeOf = (ext: string) => BINARY_MIMES[ext] || 'application/octet-stream';

// A zip entry may have no extension at all (Windows hides them and the AI
// often exports storefront.html as just "storefront"). We fill it back in
// from the contract names so the upload never silently drops them.
const CONTRACT_EXT: Record<string, string> = {
  'storefront': '.html', 'product-template': '.html', 'product': '.html',
  'index': '.html', 'home': '.html', 'page': '.html',
  'script': '.js', 'main': '.js', 'app': '.js',
  'styles': '.css', 'style': '.css',
};
function inferredExt(filename: string): string | null {
  const base = filename.split('/').pop() || '';
  if (base.includes('.')) return null; // already has one
  return CONTRACT_EXT[base.toLowerCase()] || null;
}
function contentExt(text: string): string | null {
  const head = text.slice(0, 256).trimStart().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html')) return '.html';
  if (/^[\s\S]*<\/?[a-z][^>]*>/i.test(head) && !/function|const |var |let /.test(head)) return '.html';
  if (/^\s*[.#@a-zA-Z\s,:{}\-_>+~\[\]\(\)\"'\/\*]+{\s*[\s\S]*}/.test(head)) return '.css';
  if (/^(import |export |const |let |var |function |class |\/\/)/.test(head)) return '.js';
  if (head.startsWith('{') || head.startsWith('[')) return '.json';
  return null;
}

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
    let ext = path.split('.').pop()?.toLowerCase() || '';
    if (!BINARY_NEUTRAL.includes(ext) && !TEXT_EXTS.has(ext)) {
      // Try to infer from the contract name so files like "storefront"
      // and "script" (no extension) still make it through the gate.
      const inferred = inferredExt(path);
      if (!inferred) continue;
      const fixedPath = path + inferred;
      collected.push({ path: fixedPath, entry });
    } else {
      collected.push({ path, entry });
    }
  }
  const files = stripSingleWrapper(collected);
  // Forgive common naming: a zip with just index.html and product.html is a valid skin.
  // Auto-rename the first .html to storefront.html and the second to product-template.html.
  // After gate, every file has an extension; the same regexes work for both
  // the "storefront.html" case and the renamer-injected "storefront" cases.
  const htmlItems = files.filter((item) => /\.html?$/i.test(item.path));
  const hasStorefront = htmlItems.some((item) => /(^|\/)storefront(\.html?)?$/i.test(item.path));
  const hasTemplate = htmlItems.some((item) => /(^|\/)product-template(\.html?)?$/i.test(item.path));
  let repaired = files;
  if (!hasStorefront || !hasTemplate) {
    const renamed: typeof files = [];
    let tookStorefront = hasStorefront;
    let tookTemplate = hasTemplate;
    for (const item of htmlItems) {
      if (!tookStorefront) { renamed.push({ ...item, path: item.path.replace(/[^/]+$/, 'storefront.html') }); tookStorefront = true; continue; }
      if (!tookTemplate)  { renamed.push({ ...item, path: item.path.replace(/[^/]+$/, 'product-template.html') }); tookTemplate = true; continue; }
      // Force the right extension on .css / .js even when they had none
      if (/\.css?$/i.test(item.path) || inferredExt(item.path) === '.css') renamed.push({ ...item, path: item.path.replace(/[^/]+$/, 'styles.css') });
      else if (/\.js?$/i.test(item.path) || inferredExt(item.path) === '.js') renamed.push({ ...item, path: item.path.replace(/[^/]+$/, 'script.js') });
      renamed.push(item);
    }
    if (!tookTemplate) {
      // No second .html — look for any other file that smells like a single
      // product (common Chrome exports name these "beston-kicks.html" too,
      // or "product", "item", "single", "detail", "view" without a CSS/JS/asset extension).
      // Must be a different source file from the one we just took as storefront
      // (otherwise the user uploaded only one .html and we should error clearly).
      const htmlItemsTaken = htmlItems.length;
      const templateGuess = files.find((item, index) =>
        /\.(html?|svg|md|txt)$/i.test(item.path) &&
        !/^(styles?\.|style\.|script\.|main\.|index\.|app\.|storefront\.)/i.test(item.path.split('/').pop() || '') &&
        index >= htmlItemsTaken // strictly a different file from the one we already renamed
      );
      if (templateGuess) renamed.push({ ...templateGuess, path: templateGuess.path.replace(/[^/]+$/, 'product-template.html') });
    }
    const nonHtml = files.filter((item) => !/\.html?$/i.test(item.path));
    repaired = [...renamed, ...nonHtml];
  }
  if (!repaired.some((item) => /(^|\/)storefront\.html?$/i.test(item.path)) || !repaired.some((item) => /(^|\/)product-template\.html?$/i.test(item.path))) {
    throw new Error('The skin needs at least two .html files (the storefront and one product template). Add another .html and try again.');
  }

  onStatus?.('Checking the skin…');
  const texts: Array<{ path: string; content: string }> = [];
  const binariesMeta: Array<{ path: string; contentType: string }> = [];
  const binaryBlobs = new Map<string, Blob>();

  for (const fileEntry of repaired) {
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
