import sharp from 'sharp';
import supabase from '../lib/db-client.js';
import { slugVariants } from './stores.js';

// Per-store web app install (PWA).
//
// Replaces the old signed-APK pipeline: the store owner installs the hosted
// site as a web app from Chrome. Every generated manifest is named StoYangu;
// its home-screen icon uses that owner's store logo at full clarity.

const MANIFEST = (store, slug) => ({
  id: '/owner',
  // The installed product is always StoYangu. A store's identity belongs in
  // its in-app header and launch logo, never in the operating-system app name.
  name: 'StoYangu',
  short_name: 'StoYangu',
  description: 'Manage your products, customers, posts and orders with StoYangu.',
  start_url: '/app?source=pwa',
  scope: '/',
  display: 'standalone',
  display_override: ['standalone', 'minimal-ui'],
  background_color: '#101f30',
  theme_color: '#101f30',
  orientation: 'portrait-primary',
  prefer_related_applications: false,
  categories: ['business', 'shopping', 'productivity'],
  icons: [
    { src: `/api/store-pwa/icon?slug=${encodeURIComponent(slug)}&size=192`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `/api/store-pwa/icon?slug=${encodeURIComponent(slug)}&size=512`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `/api/store-pwa/icon?slug=${encodeURIComponent(slug)}&size=512&purpose=maskable`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

// Best-effort in-memory cache (serverless instances are short-lived).
const storeCache = new Map();
async function findStore(slug, storeId) {
  const key = slug ? `slug:${String(slug).toLowerCase().trim()}` : `id:${storeId}`;
  const hit = storeCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.store;
  let result = null;
  if (storeId && Number.isSafeInteger(Number(storeId)) && Number(storeId) > 0) {
    const byId = await supabase.from('stores').select('id,slug,name,logo_url').eq('id', Number(storeId)).maybeSingle();
    if (!byId.error && byId.data) result = byId.data;
  }
  if (!result && slug) {
    for (const variant of slugVariants(slug)) {
      const bySlug = await supabase.from('stores').select('id,slug,name,logo_url').eq('slug', variant).maybeSingle();
      if (!bySlug.error && bySlug.data) { result = bySlug.data; break; }
      const { data: alias } = await supabase.from('store_aliases').select('store_id').eq('slug', variant).eq('active', true).maybeSingle();
      if (alias?.store_id) {
        const byAlias = await supabase.from('stores').select('id,slug,name,logo_url').eq('id', alias.store_id).maybeSingle();
        if (!byAlias.error && byAlias.data) { result = byAlias.data; break; }
      }
    }
  }
  if (result) storeCache.set(key, { store: result, at: Date.now() });
  return result;
}

function requestOrigin(req) {
  const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const host = String(req.headers.host || '').replace(/"$/, '');
  if (host) return `${forwarded === 'http' ? 'http' : 'https'}://${host}`;
  const url = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  return url.replace(/\/$/, '');
}

// Render the store's logo as a square icon at exactly `size` px.
// 'any' → full-bleed high-clarity crop (lanczos3). 'maskable' → logo centred
// in the 80% safe zone on a white field so every OS mask looks clean.
async function renderLogoIcon(bytes, size, maskable) {
  if (maskable) {
    const inner = Math.round(size * 0.8);
    const logo = await sharp(bytes).rotate().resize(inner, inner, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
    const pad = Math.round((size - inner) / 2);
    return sharp({ create: { width: size, height: size, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 255 } } })
      .composite([{ input: logo, left: pad, top: pad }])
      .png({ compressionLevel: 9 }).toBuffer();
  }
  return sharp(bytes).rotate().resize(size, size, { fit: 'cover', kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer();
}

// Branded fallback when the store has no logo (or it cannot be fetched):
// the store's initial on the platform navy field.
async function renderFallbackIcon(size, name) {
  const letter = (String(name || '').trim().charAt(0) || 'S').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'S';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="#101f30"/><text x="50%" y="55%" font-family="Arial, Helvetica, sans-serif" font-size="${Math.round(size * 0.56)}" font-weight="bold" fill="#ffffff" text-anchor="middle">${letter}</text></svg>`;
  return sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

async function storeLogoBytes(store, req) {
  const logo = String(store?.logo_url || '').trim();
  if (!logo) return null;
  const url = logo.startsWith('/') ? `${requestOrigin(req)}${logo}` : logo;
  if (!/^https?:\/\//i.test(url)) return null;
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) return null;
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) return null;
  return bytes;
}

export async function handlePwaStore(req, res) {
  // Authenticated: resolves the signed-in user's store (owner) or the
  // founder's chosen store, so /owner can install the store manifest
  // before the dashboard data has loaded.
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in first.' });
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  const { data: profile } = await supabase.from('profiles').select('role,store_id').eq('user_id', user.id).maybeSingle();
  if (!profile) return res.status(403).json({ error: 'No workspace is assigned.' });
  const id = profile.role === 'founder' ? Number(req.query.storeId || profile.store_id) : Number(profile.store_id);
  const store = await findStore(null, id);
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ id: store.id, slug: store.slug, name: store.name });
}

export async function handlePwaManifest(req, res) {
  const store = await findStore(req.query.slug, req.query.storeId);
  if (!store) return res.status(404).json({ error: 'Store not found.' });
  res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=120');
  return res.status(200).json(MANIFEST(store, store.slug));
}

export async function handlePwaIcon(req, res) {
  const size = Number(req.query.size) === 192 ? 192 : 512;
  const maskable = req.query.purpose === 'maskable';
  const store = await findStore(req.query.slug, req.query.storeId);
  let png = null;
  if (store) {
    try {
      const bytes = await storeLogoBytes(store, req);
      if (bytes) png = await renderLogoIcon(bytes, size, maskable);
    } catch { png = null; }
  }
  if (!png) png = await renderFallbackIcon(size, store?.name);
  res.setHeader('Content-Type', 'image/png');
  // 7 days: long enough to skip re-fetches on every app launch, short enough
  // that a changed logo appears at the next install prompt.
  res.setHeader('Cache-Control', 'public, max-age=604800');
  return res.status(200).end(png);
}
