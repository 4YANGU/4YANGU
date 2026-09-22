import supabase from '../lib/db-client.js';
import originalHandler from '../server/media.js';
import { callbackOAuth, pendingOAuth, pickOAuth, resumeOAuth, startOAuth } from '../lib/social-oauth.js';
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const action = String(req.query?.action || '');
    if (action === 'social-callback') {
      if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
      return await callbackOAuth(req, res, supabase);
    }
    if (action === 'image-upload-url') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ error: 'Please sign in first.' });
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Please sign in again.' });
      const { data: profile } = await supabase.from('profiles').select('user_id').eq('user_id', user.id).single();
      if (!profile) return res.status(403).json({ error: 'No workspace is assigned.' });
      const types = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif', 'image/bmp': 'bmp' };
      const type = String(req.body?.contentType || '').toLowerCase();
      const scope = String(req.body?.scope || '');
      if (!types[type] || !['logos', 'products'].includes(scope) || Number(req.body?.size || 0) > 6291456) return res.status(400).json({ error: 'Choose a supported image under 6 MB.' });
      const path = `${scope}/${user.id}/${crypto.randomUUID()}.${types[type]}`;
      const signed = await supabase.storage.from('stoyangu-media').createSignedUploadUrl(path);
      if (signed.error) throw signed.error;
      const { data: publicUrl } = supabase.storage.from('stoyangu-media').getPublicUrl(path);
      return res.status(200).json({ signedUrl: signed.data.signedUrl, url: publicUrl.publicUrl });
    }
    const op = String(req.query?.op || req.body?.op || '');
    if (action === 'social' && ['connect', 'oauth_resume', 'oauth_pending', 'oauth_pick', 'update_draft', 'delete_draft'].includes(op)) {
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      if (!token) return res.status(401).json({ error: 'Please sign in again to continue.' });
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) return res.status(401).json({ error: 'Your session expired. Sign in again.' });
      const { data: profile, error } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
      if (error || !profile) return res.status(403).json({ error: 'No workspace is assigned to this account.' });
      const storeId = profile.role === 'founder' ? Number(req.query?.storeId || req.body?.store_id) : Number(profile.store_id);
      if (!storeId) return res.status(400).json({ error: 'Choose a store first.' });
      if (op === 'connect' && req.method === 'POST') return await startOAuth(req, res, supabase, profile, storeId);
      if (op === 'oauth_resume' && req.method === 'GET') return await resumeOAuth(req, res, supabase, profile, storeId);
      if (op === 'oauth_pending' && req.method === 'GET') return await pendingOAuth(req, res, supabase, profile, storeId);
      if (op === 'oauth_pick' && req.method === 'POST') return await pickOAuth(req, res, supabase, profile, storeId);
      if (['update_draft', 'delete_draft'].includes(op) && req.method === 'POST') {
        const id = Number(req.body?.id);
        if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).json({ error: 'Choose a saved draft.' });
        const { data: existing, error: readError } = await supabase.from('social_posts').select('id').eq('id', id).eq('store_id', storeId).eq('status', 'draft').maybeSingle();
        if (readError) throw readError;
        if (!existing) return res.status(404).json({ error: 'Draft not found in this store.' });
        if (op === 'delete_draft') {
          const { error: deleteError } = await supabase.from('social_posts').delete().eq('id', id).eq('store_id', storeId).eq('status', 'draft');
          if (deleteError) throw deleteError;
          return res.status(200).json({ ok: true });
        }
        const caption = String(req.body?.caption || '').trim();
        if (!caption || caption.length > 2200) return res.status(400).json({ error: 'Keep the caption between 1 and 2,200 characters.' });
        const { data: changed, error: changeError } = await supabase.from('social_posts').update({ caption }).eq('id', id).eq('store_id', storeId).eq('status', 'draft').select('*').single();
        if (changeError) throw changeError;
        return res.status(200).json(changed);
      }
      return res.status(405).json({ error: 'Method not allowed.' });
    }
    return await originalHandler(req, res);
  } catch (e) { console.error('Media request failed:', e.message); return res.status(500).json({ error: 'The request could not be completed. Your saved data is safe; please retry.' }); }
}
