import supabase from './supabase';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  let response: Response;
  try { response = await fetch(path, { ...init, headers, credentials: 'same-origin' }); }
  catch { throw new Error('Connection interrupted. Your work is saved; check your internet and retry.'); }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload.error === 'string' && payload.error.trim().length > 2 ? payload.error.trim() : 'The request could not be completed. Your work is saved; please retry.';
    throw new Error(message);
  }
  return payload as T;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result as string;
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function putWithRetry(signedUrl: string, file: File, contentType = file.type) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // 1. Try Supabase's multipart FormData format as expected by uploadToSignedUrl
      const form = new FormData();
      form.append('cacheControl', '3600');
      form.append('', file);
      let result = await fetch(signedUrl, { method: 'PUT', body: form });
      if (result.ok) return;

      // 2. If rejected or not supported, try raw binary PUT with content-type
      result = await fetch(signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType || 'application/octet-stream' },
        body: file,
      });
      if (result.ok) return;
    } catch { /* A temporary network drop can be retried safely with the same signed upload URL. */ }
    if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  throw new Error('Upload interrupted. Check your connection and retry; your work is saved.');
}

export function formatMoney(value: number | string) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES', maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function detectedRootDomain() {
  const configured = String(import.meta.env.VITE_ROOT_DOMAIN || '').trim();
  if (configured) return configured.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const host = window.location.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.vercel.app') || host.endsWith('.arcada.app') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return '';
  const parts = host.replace(/^www\./, '').split('.');
  const twoPartSuffixes = new Set(['co.ke', 'or.ke', 'ac.ke', 'co.uk', 'com.au', 'co.za']);
  const suffix = parts.slice(-2).join('.');
  return twoPartSuffixes.has(suffix) && parts.length >= 3 ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

export function storeLink(slug: string) {
  const host = window.location.hostname;
  const rootDomain = detectedRootDomain();
  if (rootDomain && (host === rootDomain || host === `www.${rootDomain}` || host.endsWith(`.${rootDomain}`))) return `https://${slug}.${rootDomain}`;
  return `${window.location.origin}/s/${slug}`;
}

export function storeDomain(slug: string) {
  return detectedRootDomain() ? `${slug}.${detectedRootDomain()}` : `${window.location.host}/s/${slug}`;
}

export async function uploadImage(file: File, scope: 'logos' | 'products') {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const inferredTypes: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heif', avif: 'image/avif', bmp: 'image/bmp' };
  // iPhone fix: iOS sometimes hands photos over with an empty or non-image
  // MIME type — infer the real type from the file extension in that case.
  const needsInference = !file.type || !file.type.startsWith('image/');
  const typedFile = needsInference && inferredTypes[extension] ? new File([file], file.name, { type: inferredTypes[extension], lastModified: file.lastModified }) : file;
  const prepared = scope === 'products' ? await compressProductImage(typedFile) : typedFile;
  if (prepared.size > 6 * 1024 * 1024) throw new Error('Please choose an image smaller than 6 MB.');
  if (!prepared.type.startsWith('image/')) throw new Error('Please choose a supported photo file.');
  // Upload directly to storage; fallback to server upload if direct signed upload fails.
  try {
    const signed = await apiFetch<{ signedUrl: string; url: string }>('/api/media?action=image-upload-url', {
      method: 'POST', body: JSON.stringify({ contentType: prepared.type, scope, size: prepared.size }),
    });
    await putWithRetry(signed.signedUrl, prepared);
    return { url: signed.url };
  } catch (err) {
    console.warn('Direct storage upload failed, falling back to server upload:', err);
    try {
      const base64 = await fileToBase64(prepared);
      const res = await apiFetch<{ url: string }>('/api/media?action=upload', {
        method: 'POST',
        body: JSON.stringify({
          fileName: prepared.name,
          fileBase64: base64,
          contentType: prepared.type,
          scope,
        }),
      });
      return { url: res.url };
    } catch {
      throw new Error('Upload interrupted. Check your connection and retry; your work is saved.');
    }
  }
}

let webpEncodingSupport: boolean | null = null;
function supportsWebpEncoding(): Promise<boolean> {
  if (webpEncodingSupport !== null) return Promise.resolve(webpEncodingSupport);
  return new Promise<boolean>((resolve) => {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
      canvas.toBlob((blob) => { webpEncodingSupport = Boolean(blob && blob.type === 'image/webp'); resolve(webpEncodingSupport); }, 'image/webp', 1);
    } catch { webpEncodingSupport = false; resolve(false); }
  });
}

async function compressProductImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || file.type.includes('heic') || file.type.includes('heif')) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const maxSide = 1600;
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height); bitmap.close();
    // iPhone fix: Safari cannot encode WebP. Asking for it silently produces a
    // PNG, which we used to mislabel as image/webp — the server then rejected
    // the upload as "not a valid image". Detect real support first (Safari
    // falls back to JPEG), and always trust the blob's actual type afterwards.
    const targetType = (await supportsWebpEncoding()) ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetType, .82));
    if (!blob || blob.size >= file.size && scale === 1) return file;
    const actualType = blob.type && blob.type.startsWith('image/') ? blob.type : targetType;
    const extension = actualType.includes('webp') ? 'webp' : actualType.includes('png') ? 'png' : 'jpg';
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: actualType, lastModified: Date.now() });
  } catch {
    return file;
  }
}

// Woyoyo-004: composer media (photos + TikTok-style videos). The server mints
// a signed upload URL and the browser PUTs the file straight to Supabase
// storage, so large videos never pass through the serverless function.
export async function uploadPostMedia(file: File): Promise<{ url: string; kind: 'image' | 'video' }> {
  const declared = file.type || '';
  const isVideo = declared.startsWith('video/') || (!declared.startsWith('image/') && /\.(mp4|mov|m4v|webm|3gp)$/i.test(file.name));
  if (isVideo && file.size > 75 * 1024 * 1024) throw new Error('Please keep videos under 75 MB.');
  if (!isVideo && file.size > 15 * 1024 * 1024) throw new Error('Please choose a photo smaller than 15 MB.');
  const prepared = isVideo ? file : await compressProductImage(file);
  const contentType = prepared.type || (isVideo ? 'video/mp4' : 'image/jpeg');
  try {
    const prep = await apiFetch<{ signedUrl: string; url: string; kind: 'image' | 'video' }>(
      '/api/media?action=post-upload-url',
      { method: 'POST', body: JSON.stringify({ fileName: prepared.name, contentType, kind: isVideo ? 'video' : 'image' }) },
    );
    await putWithRetry(prep.signedUrl, prepared, contentType);
    return { url: prep.url, kind: prep.kind };
  } catch (err) {
    if (!isVideo) {
      try {
        const base64 = await fileToBase64(prepared);
        const res = await apiFetch<{ url: string }>('/api/media?action=upload', {
          method: 'POST',
          body: JSON.stringify({
            fileName: prepared.name,
            fileBase64: base64,
            contentType: prepared.type,
            scope: 'products',
          }),
        });
        return { url: res.url, kind: 'image' };
      } catch {
        // Fall through to error
      }
    }
    throw err instanceof Error ? err : new Error('Upload interrupted. Check your connection and retry; your work is saved.');
  }
}
