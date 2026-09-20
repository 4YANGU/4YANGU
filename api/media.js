// api/media.js
// =========================================================================
//  Combined auth/media/social endpoint
//  ?action=profile — get the current user's StoYangu profile (GET only)
//  ?action=upload  — upload a product photo, store logo or social post image (POST only)
//  ?action=social  — Repliz social hub (TikTok/Facebook/Instagram/YouTube/Threads):
//                    connect accounts, post once to all, unified DM+comment
//                    inbox. Uses &op=status|inbox|history|connect|disconnect|
//                    post|reply|read. Lives here so Vercel keeps exactly 12
//                    Serverless Functions on the Hobby plan.
//
//  This was originally two files (/api/profile and /api/upload). They were
//  merged into one serverless function to stay under Vercel's Hobby plan
//  12-function limit. Both endpoints keep their old URLs as aliases too,
//  so anything cached on the client keeps working.
// =========================================================================

import supabase from '../lib/db-client.js';
import { isMockRepliz, replizAccounts, replizInbox, replizPublish, replizReply } from '../lib/repliz.js';

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
  if (!['logos', 'products', 'social'].includes(scope)) return res.status(400).json({ error: 'Invalid upload type.' });
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

const SOCIAL_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube', 'threads'];

async function storeOwnedBy(profile, storeId) {
  if (!storeId) return false;
  if (profile.role === 'founder') {
    const { data } = await supabase.from('stores').select('id').eq('id', storeId).single();
    return Boolean(data);
  }
  return Number(profile.store_id) === Number(storeId);
}

async function handleSocial(req, res) {
  // Repliz social hub. With real REPLIZ_* keys configured, accounts/inbox/
  // posting go through api.repliz.com and Supabase keeps a synced copy. With
  // dummy or missing keys (preview deployments), the same endpoints serve
  // realistic demo data from Supabase so every screen stays testable.
  const op = String(req.query?.op || '').toLowerCase();
  const { user, error } = await getAuthedUser(req);
  if (error) return res.status(401).json({ error });
  const { data: profile } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  if (!profile) return res.status(403).json({ error: 'No StoYangu workspace is assigned to this account.' });
  const storeFromQuery = Number(req.query?.storeId || req.body?.store_id || 0);
  const storeId = profile.role === 'founder' ? storeFromQuery : Number(profile.store_id || 0);
  if (!storeId) return res.status(400).json({ error: 'Store is required.' });
  if (!(await storeOwnedBy(profile, storeId))) return res.status(403).json({ error: 'You cannot open this store.' });
  const mockMode = isMockRepliz();

  const localAccounts = async () => {
    const { data, error: accountsError } = await supabase.from('social_accounts').select('*').eq('store_id', storeId).order('platform');
    if (accountsError) throw accountsError;
    return data || [];
  };

  if (req.method === 'GET' && op === 'status') {
    // Connected accounts + recent posts. Live Repliz accounts win when keys are real.
    let accounts = await localAccounts();
    let live = null;
    if (!mockMode) {
      try {
        live = await replizAccounts();
      } catch (liveError) {
        console.error('Repliz accounts failed, using local copy:', liveError.message);
      }
    }
    if (live?.length) {
      accounts = live.map((account, index) => ({
        id: -(index + 1),
        store_id: storeId,
        platform: SOCIAL_PLATFORMS.includes(account.platform) ? account.platform : account.platform,
        handle: account.handle || account.display_name || 'Connected',
        display_name: account.display_name || '',
        avatar_url: account.avatar_url || '',
        repliz_account_id: account.repliz_account_id || '',
        status: 'connected',
      }));
    }
    const { data: posts } = await supabase.from('social_posts').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(20);
    return res.status(200).json({ mockMode, accounts, posts: posts || [] });
  }

  if (req.method === 'GET' && op === 'inbox') {
    const accounts = await localAccounts();
    const { data: messages, error: messagesError } = await supabase
      .from('social_messages')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(300);
    if (messagesError) throw messagesError;
    if (!mockMode) {
      // Real keys: best-effort live pull so brand-new Repliz replies appear
      // even before the next sync. Local rows are still the source of truth.
      try {
        await replizInbox();
      } catch (liveError) {
        console.error('Repliz inbox pull failed, using local copy:', liveError.message);
      }
    }
    return res.status(200).json({ mockMode, accounts, messages: messages || [] });
  }

  if (req.method === 'GET' && op === 'history') {
    const { data: posts, error: postsError } = await supabase
      .from('social_posts')
      .select('*')
      .eq('store_id', storeId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (postsError) throw postsError;
    return res.status(200).json({ mockMode, posts: posts || [] });
  }

  if (req.method === 'POST' && op === 'connect') {
    const platform = String(req.body?.platform || '').toLowerCase();
    const handle = String(req.body?.handle || '').trim().slice(0, 120);
    if (!SOCIAL_PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Choose TikTok, Facebook, Instagram, YouTube or Threads.' });
    if (handle.length < 2) return res.status(400).json({ error: 'Add the account handle, e.g. @yourshop.' });
    // Real-key deployments: confirm the account exists in the Repliz workspace.
    if (!mockMode) {
      try {
        const live = await replizAccounts();
        const match = (live || []).find((row) => row.platform === platform && row.handle.toLowerCase() === handle.replace(/^@/, '').toLowerCase());
        if (!match) return res.status(400).json({ error: `That ${platform} account is not connected inside Repliz yet. Connect it in the Repliz dashboard first.` });
      } catch (liveError) {
        console.error('Repliz connect check failed:', liveError.message);
        return res.status(502).json({ error: 'Repliz did not respond. Please try again in a moment.' });
      }
    }
    await supabase.from('social_accounts').delete().eq('store_id', storeId).eq('platform', platform);
    const { data, error: insertError } = await supabase
      .from('social_accounts')
      .insert({ store_id: storeId, platform, handle: handle.startsWith('@') ? handle : `@${handle}`, status: 'connected' })
      .select()
      .single();
    if (insertError) throw insertError;
    return res.status(201).json({ mockMode, account: data });
  }

  if (req.method === 'POST' && op === 'disconnect') {
    const id = Number(req.body?.id || 0);
    if (!id) return res.status(400).json({ error: 'Account is required.' });
    const { error: deleteError } = await supabase.from('social_accounts').delete().eq('id', id).eq('store_id', storeId);
    if (deleteError) throw deleteError;
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'POST' && op === 'post') {
    const caption = String(req.body?.caption || '').trim();
    const platforms = Array.isArray(req.body?.platforms) ? [...new Set(req.body.platforms.map((key) => String(key).toLowerCase()))].filter((key) => SOCIAL_PLATFORMS.includes(key)) : [];
    const mediaUrls = Array.isArray(req.body?.mediaUrls) ? req.body.mediaUrls.map((url) => String(url).slice(0, 1000)).filter((url) => url.startsWith('/') || url.startsWith('https://')).slice(0, 4) : [];
    if (caption.length < 2) return res.status(400).json({ error: 'Write something to post first.' });
    if (!platforms.length) return res.status(400).json({ error: 'Choose at least one platform.' });
    const accounts = await localAccounts();
    const missing = platforms.filter((key) => !accounts.some((row) => row.platform === key));
    if (missing.length) return res.status(400).json({ error: `Connect ${missing.join(', ')} first from the Inbox tab.` });
    if (caption.length > 2200) return res.status(400).json({ error: 'Keep the caption under 2200 characters.' });
    let replizPostId = '';
    let status = 'published';
    if (!mockMode) {
      try {
        const published = await replizPublish({ caption, platforms, mediaUrls });
        replizPostId = published?.id || '';
      } catch (liveError) {
        console.error('Repliz publish failed:', liveError.message);
        status = 'failed';
      }
    }
    const { data, error: insertError } = await supabase
      .from('social_posts')
      .insert({ store_id: storeId, caption, media_urls: mediaUrls, platforms, repliz_post_id: replizPostId, status })
      .select()
      .single();
    if (insertError) throw insertError;
    return res.status(201).json({ mockMode, post: data });
  }

  if (req.method === 'POST' && op === 'reply') {
    const conversationId = String(req.body?.conversation_id || '').slice(0, 200);
    const platform = String(req.body?.platform || '').toLowerCase();
    const kind = String(req.body?.kind || 'dm').toLowerCase() === 'comment' ? 'comment' : 'dm';
    const body = String(req.body?.body || '').trim();
    if (!conversationId || !body) return res.status(400).json({ error: 'Choose a conversation and write a reply.' });
    if (body.length > 2000) return res.status(400).json({ error: 'Keep the reply under 2000 characters.' });
    let replizId = '';
    if (!mockMode) {
      try {
        const sent = await replizReply({ platform, conversationId, body });
        replizId = sent?.id || '';
      } catch (liveError) {
        console.error('Repliz reply failed:', liveError.message);
        return res.status(502).json({ error: 'Repliz did not deliver that reply. Please try again.' });
      }
    }
    const { data, error: insertError } = await supabase
      .from('social_messages')
      .insert({ store_id: storeId, platform, conversation_id: conversationId, sender: 'You', sender_handle: '', body, direction: 'out', kind, repliz_id: replizId, read: true })
      .select()
      .single();
    if (insertError) throw insertError;
    await supabase.from('social_messages').update({ read: true }).eq('store_id', storeId).eq('conversation_id', conversationId).eq('direction', 'in');
    return res.status(201).json({ mockMode, message: data });
  }

  if (req.method === 'POST' && op === 'read') {
    const conversationId = String(req.body?.conversation_id || '').slice(0, 200);
    if (!conversationId) return res.status(400).json({ error: 'Conversation is required.' });
    const { error: updateError } = await supabase.from('social_messages').update({ read: true }).eq('store_id', storeId).eq('conversation_id', conversationId);
    if (updateError) throw updateError;
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown social action. Use op=status | inbox | history | connect | disconnect | post | reply | read' });
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
    if (action === 'social') return handleSocial(req, res);
    return res.status(400).json({ error: 'Unknown action. Use ?action=profile | upload | social' });
  } catch (err) {
    console.error('Media API error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
