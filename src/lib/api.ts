import supabase from './supabase';

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`);
  const response = await fetch(path, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong. Please try again.');
  return payload as T;
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
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that image.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(prepared);
  });
  return apiFetch<{ url: string }>('/api/media?action=upload', {
    method: 'POST',
    body: JSON.stringify({ fileName: prepared.name, fileBase64: base64, contentType: prepared.type, scope }),
  });
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
