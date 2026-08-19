// api/media.js
// =========================================================================
//  Combined auth/media endpoint
//  ?action=profile — get the current user's StoYangu profile (GET only)
//  ?action=upload  — upload a product photo or store logo (POST only)
//
//  This was originally two files (/api/profile and /api/upload). They were
//  merged into one serverless function to stay under Vercel's Hobby plan
//  12-function limit. Both endpoints keep their old URLs as aliases too,
//  so anything cached on the client keeps working.
// =========================================================================

import supabase from '../lib/db-client.js';

const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|heic|heif|avif|bmp)$/i;
const MAX_BASE64 = 8_400_000;
const MAX_BYTES = 6_291_456;

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getAuthedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { error: 'No session token.' };
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: 'Invalid or expired session.' };
  return { user };
}

async function handleProfile(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { user, error } = await getAuthedUser(req);
  if (error) return res.status(401).json({ error });
  const host = String(req.headers.host || '').split(':')[0].toLowerCase();
  const productionHost = host === 'stoyangu.com' || host === 'www.stoyangu.com' || host.endsWith('.stoyangu.com');
  if (productionHost && String(user.email || '').toLowerCase() === 'founder-demo@stoyangu.com') return res.status(403).json({ error: 'Demo access is disabled on production.' });
  const { data, error: profileError } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', user.id)
    .single();
  if (profileError || !data) return res.status(403).json({ error: 'No StoYangu workspace is assigned to this account.' });
  return res.status(200).json(data);
}

function detectImageType(buffer) {
  // Reads the file's real magic bytes and returns the true image type,
  // regardless of what the client claimed. iPhones routinely convert photos
  // during upload (HEIC→JPEG) and some browsers mislabel re-encoded images;
  // the bytes are the only trustworthy source.
  if (buffer.length < 12) return '';
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString())) return 'image/gif';
  if (buffer.subarray(4, 8).toString() === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString();
    if (['avif', 'avis'].includes(brand)) return 'image/avif';
    return 'image/heic';
  }
  if (buffer[0] === 0x42 && buffer[1] === 0x4d) return 'image/bmp';
  return '';
}

function imageExtension(requestedType) {
  const type = String(requestedType || '').toLowerCase();
  if (type.includes('png')) return 'png';
  if (type.includes('webp')) return 'webp';
  if (type.includes('gif')) return 'gif';
  if (type.includes('avif')) return 'avif';
  if (type.includes('bmp')) return 'bmp';
  if (type.includes('hei')) return 'heic';
  return 'jpg';
}

async function handleUpload(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { user, error } = await getAuthedUser(req);
  if (error) return res.status(401).json({ error });

  const { fileName, fileBase64, contentType, scope } = req.body || {};
  if (!['logos', 'products'].includes(scope)) return res.status(400).json({ error: 'Invalid upload type.' });
  if (!ALLOWED_IMAGE_TYPES.test(String(contentType || ''))) return res.status(400).json({ error: 'Please upload a JPG, PNG, WebP, GIF, HEIC, AVIF or BMP photo.' });
  if (typeof fileBase64 !== 'string' || fileBase64.length > MAX_BASE64) return res.status(400).json({ error: 'Image must be smaller than 6 MB.' });

  const buffer = Buffer.from(fileBase64, 'base64');
  if (!buffer.length || buffer.length > MAX_BYTES) return res.status(400).json({ error: 'Invalid or oversized image.' });
  // iPhone fix: trust the actual bytes over the declared content type. iOS
  // converts photos during upload and Safari mislabels re-encoded images, so
  // validating the bytes against the client's claim rejected genuine photos.
  const detectedType = detectImageType(buffer);
  if (!detectedType) return res.status(400).json({ error: ALLOWED_IMAGE_TYPES.test(String(contentType || '')) ? 'That file does not contain a valid image.' : 'Please upload a JPG, PNG, WebP, GIF, HEIC, AVIF or BMP photo.' });
  const effectiveType = detectedType;
  const extension = imageExtension(effectiveType);
  const path = `${scope}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const { error: uploadError } = await supabase.storage.from('stoyangu-media').upload(path, buffer, { contentType: effectiveType, upsert: false });
  if (uploadError) {
    console.error('Upload error:', uploadError);
    return res.status(500).json({ error: 'Could not upload that image.' });
  }
  const { data } = supabase.storage.from('stoyangu-media').getPublicUrl(path);
  return res.status(201).json({ url: data.publicUrl });
}

export default async function handler(req, res) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const action = String(req.query?.action || '').toLowerCase();
    // Also accept the old URL-style: GET /api/media → profile, POST /api/media → upload
    if (!action) {
      if (req.method === 'GET') return handleProfile(req, res);
      if (req.method === 'POST') return handleUpload(req, res);
      return res.status(400).json({ error: 'Use ?action=profile or ?action=upload.' });
    }
    if (action === 'profile') return handleProfile(req, res);
    if (action === 'upload') return handleUpload(req, res);
    return res.status(400).json({ error: 'Unknown action. Use ?action=profile | upload' });
  } catch (err) {
    console.error('Media API error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
