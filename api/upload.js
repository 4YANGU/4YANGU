import supabase from './db-client.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const token = req.headers.authorization?.replace('Bearer ', ''); if (!token) return res.status(401).json({ error: 'Unauthorized' });
    const { data: { user } } = await supabase.auth.getUser(token); if (!user) return res.status(401).json({ error: 'Invalid session' });
    const { data: profile } = await supabase.from('profiles').select('role,store_id').eq('user_id', user.id).single(); if (!profile) return res.status(403).json({ error: 'Workspace not assigned.' });
    const { fileName, fileBase64, contentType, scope } = req.body || {};
    if (!['logos', 'products'].includes(scope)) return res.status(400).json({ error: 'Invalid upload type.' });
    if (!/^image\/(jpeg|jpg|png|webp|gif|heic|heif)$/i.test(String(contentType || ''))) return res.status(400).json({ error: 'Please upload a JPG, PNG, WebP or phone photo.' });
    if (typeof fileBase64 !== 'string' || fileBase64.length > 8400000) return res.status(400).json({ error: 'Image must be smaller than 6 MB.' });
    const buffer = Buffer.from(fileBase64, 'base64'); if (!buffer.length || buffer.length > 6291456) return res.status(400).json({ error: 'Invalid or oversized image.' });
    const signatures = {
      jpeg: buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
      png: buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
      webp: buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP',
      gif: ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString()),
      heic: buffer.subarray(4, 8).toString() === 'ftyp',
    };
    const requestedType = String(contentType).toLowerCase();
    const valid = requestedType.includes('jpeg') || requestedType.includes('jpg') ? signatures.jpeg : requestedType.includes('png') ? signatures.png : requestedType.includes('webp') ? signatures.webp : requestedType.includes('gif') ? signatures.gif : signatures.heic;
    if (!valid) return res.status(400).json({ error: 'That file does not contain a valid image.' });
    const extension = requestedType.includes('png') ? 'png' : requestedType.includes('webp') ? 'webp' : requestedType.includes('gif') ? 'gif' : requestedType.includes('hei') ? 'heic' : 'jpg';
    const path = `${scope}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
    const { error } = await supabase.storage.from('stoyangu-media').upload(path, buffer, { contentType, upsert: false }); if (error) throw error;
    const { data } = supabase.storage.from('stoyangu-media').getPublicUrl(path);
    return res.status(201).json({ url: data.publicUrl });
  } catch (err) {
    console.error('Upload API error:', err);
    return res.status(500).json({ error: 'Could not upload that image.' });
  }
}
