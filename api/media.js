// api/media.js
// =========================================================================
//  Combined auth/media/social endpoint
//  ?action=profile — get the current user's StoYangu profile (GET only)
//  ?action=upload  — upload a product photo or store logo (POST only)
//  ?action=social  — Repliz social layer: connect accounts, post-once-to-all,
//                    unified DMs/comments inbox (GET ?op=status|inbox|posts,
//                    POST { op: connect|disconnect|publish|save_draft|reply|
//                    read|resolve|seed_demo })
//
//  This was originally two files (/api/profile and /api/upload). They were
//  merged into one serverless function to stay under Vercel's Hobby plan
//  12-function limit. Both endpoints keep their old URLs as aliases too,
//  so anything cached on the client keeps working. The social layer lives
//  here for the same reason — api/ must stay at exactly 12 files.
// =========================================================================

import supabase from '../lib/db-client.js';
import { REPLIZ_PLATFORMS, mockPublishResults, mockSeedThreads, replizMode, replizPublish, replizSendReply } from '../lib/repliz.js';

const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|heic|heif|avif|bmp)$/i;
const MAX_BASE64 = 8_400_000;
const MAX_BYTES = 6_291_456;

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function getAuthedUser(req) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return { error: 'No session token.' };
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return { error: 'Invalid or expired session.' };
  return { user };
}

async function getAuthedProfile(req) {
  const { user, error } = await getAuthedUser(req);
  if (error) return { error };
  const { data: profile, error: profileError } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
  if (profileError || !profile) return { error: 'No StoYangu workspace is assigned to this account.' };
  return { user, profile };
}

// Owner may only touch their own store; founder may touch the requested store.
function resolveSocialStore(req, profile) {
  const requested = Number(req.query?.storeId || req.body?.store_id || 0);
  if (profile.role === 'founder') return requested || Number(profile.store_id || 0) || 0;
  return Number(profile.store_id || 0);
}

// =========================================================================
//  Social (Repliz) handlers
// =========================================================================

async function handleSocialStatus(req, res, profile, storeId) {
  const [{ data: connections, error: connError }, { data: unread, error: unreadError }] = await Promise.all([
    supabase.from('social_connections').select('*').eq('store_id', storeId).order('platform', { ascending: true }),
    supabase.from('social_messages').select('platform').eq('store_id', storeId).eq('direction', 'in').eq('is_read', false),
  ]);
  if (connError) throw connError;
  if (unreadError) throw unreadError;
  const byPlatform = {};
  for (const row of unread || []) byPlatform[row.platform] = (byPlatform[row.platform] || 0) + 1;
  return res.status(200).json({ mode: replizMode(), connections: connections || [], unread: { total: (unread || []).length, by_platform: byPlatform } });
}

async function handleSocialInbox(req, res, profile, storeId) {
  const { data: messages, error } = await supabase
    .from('social_messages')
    .select('*')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  const groups = new Map();
  for (const message of messages || []) {
    if (!groups.has(message.thread_key)) groups.set(message.thread_key, []);
    groups.get(message.thread_key).push(message);
  }
  const threads = [...groups.entries()].map(([threadKey, rows]) => {
    const chronological = [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const latest = rows[0];
    const firstInbound = chronological.find((row) => row.direction === 'in') || chronological[0];
    return {
      thread_key: threadKey,
      platform: latest.platform,
      kind: latest.kind,
      sender_name: firstInbound.sender_name,
      sender_handle: firstInbound.sender_handle,
      last_body: latest.body,
      last_at: latest.created_at,
      unread: rows.filter((row) => row.direction === 'in' && !row.is_read).length,
      resolved: rows.every((row) => row.is_resolved),
      messages: chronological,
    };
  }).sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());
  return res.status(200).json({ mode: replizMode(), threads });
}

async function handleSocialPosts(req, res, profile, storeId) {
  const { data, error } = await supabase.from('social_posts').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return res.status(200).json({ posts: data || [] });
}

async function handleSocialConnect(req, res, profile, storeId) {
  const platform = String(req.body?.platform || '').toLowerCase();
  const handle = String(req.body?.handle || '').trim().slice(0, 80);
  if (!REPLIZ_PLATFORMS.includes(platform)) return res.status(400).json({ error: 'Unknown platform.' });
  if (handle.length < 2) return res.status(400).json({ error: 'Add the account handle first.' });
  const mode = replizMode();
  const { data: existing } = await supabase.from('social_connections').select('id').eq('store_id', storeId).eq('platform', platform).limit(1);
  const values = {
    store_id: storeId,
    platform,
    account_handle: handle.startsWith('@') ? handle : `@${handle}`,
    account_id: mode === 'mock' ? `mock_${platform}_${storeId}` : null,
    connection_status: mode === 'mock' ? 'mock' : 'connected',
    auth_payload: mode === 'mock' ? { mode: 'mock' } : {},
    updated_at: new Date().toISOString(),
  };
  const saved = existing?.length
    ? await supabase.from('social_connections').update(values).eq('id', existing[0].id).select().single()
    : await supabase.from('social_connections').insert(values).select().single();
  if (saved.error) throw saved.error;
  return res.status(200).json({ connection: saved.data, mode });
}

async function handleSocialDisconnect(req, res, profile, storeId) {
  const connectionId = Number(req.body?.connection_id || 0);
  if (!connectionId) return res.status(400).json({ error: 'Connection is required.' });
  const { error } = await supabase.from('social_connections').delete().eq('id', connectionId).eq('store_id', storeId);
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

async function handleSocialPublish(req, res, profile, storeId, asDraft) {
  const caption = String(req.body?.caption || '').trim().slice(0, 2200);
  const platforms = Array.from(new Set((req.body?.platforms || []).map((p) => String(p).toLowerCase()))).filter((p) => REPLIZ_PLATFORMS.includes(p));
  const mediaUrls = Array.isArray(req.body?.media_urls) ? req.body.media_urls.map((u) => String(u).slice(0, 1000)).filter(Boolean).slice(0, 4) : [];
  if (!caption) return res.status(400).json({ error: 'Write a caption first.' });
  if (!platforms.length && !asDraft) return res.status(400).json({ error: 'Choose at least one platform.' });
  const mode = replizMode();
  const { data: connections, error: connError } = await supabase.from('social_connections').select('*').eq('store_id', storeId).in('platform', platforms.length ? platforms : ['__none__']);
  if (connError) throw connError;
  if (!asDraft) {
    const missing = platforms.filter((p) => !(connections || []).some((c) => c.platform === p));
    if (missing.length) return res.status(400).json({ error: `Connect ${missing.join(', ')} in the Inbox tab first.` });
  }
  let results = {};
  if (!asDraft) {
    if (mode === 'mock') {
      results = mockPublishResults(platforms);
    } else {
      for (const platform of platforms) {
        const connection = (connections || []).find((c) => c.platform === platform);
        try {
          const posted = await replizPublish({ platform, accountId: connection?.account_id, caption, mediaUrls });
          results[platform] = { ok: true, mode: 'live', external_id: String(posted?.id || posted?.external_id || posted?.post_id || ''), posted_at: new Date().toISOString() };
        } catch (publishError) {
          results[platform] = { ok: false, mode: 'live', error: publishError instanceof Error ? publishError.message : 'Publish failed.' };
        }
      }
    }
  }
  const { data, error } = await supabase.from('social_posts').insert({
    store_id: storeId,
    caption,
    media_urls: mediaUrls,
    platforms,
    status: asDraft ? 'draft' : 'posted',
    results,
    posted_at: asDraft ? null : new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  return res.status(201).json({ post: data, mode, results });
}

async function handleSocialReply(req, res, profile, storeId) {
  const threadKey = String(req.body?.thread_key || '').slice(0, 200);
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  if (!threadKey || !body) return res.status(400).json({ error: 'Conversation and reply text are required.' });
  const { data: existing, error: existingError } = await supabase
    .from('social_messages')
    .select('*')
    .eq('store_id', storeId)
    .eq('thread_key', threadKey)
    .order('created_at', { ascending: false })
    .limit(1);
  if (existingError) throw existingError;
  if (!existing?.length) return res.status(404).json({ error: 'Conversation not found.' });
  const head = existing[0];
  const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).single();
  const mode = replizMode();
  // Save locally first so the reply is never lost if the live send fails.
  const { data: saved, error } = await supabase.from('social_messages').insert({
    store_id: storeId,
    platform: head.platform,
    kind: head.kind,
    thread_key: threadKey,
    sender_name: store?.name || 'Store',
    sender_handle: null,
    body,
    direction: 'out',
    is_read: true,
    is_resolved: false,
    external_id: mode === 'mock' ? `mock_out_${Date.now().toString(36)}` : null,
  }).select().single();
  if (error) throw error;
  let delivery = { ok: true, mode };
  if (mode === 'live') {
    try {
      const { data: connection } = await supabase.from('social_connections').select('account_id').eq('store_id', storeId).eq('platform', head.platform).limit(1).maybeSingle();
      await replizSendReply({ platform: head.platform, accountId: connection?.account_id, threadKey, body });
    } catch (replyError) {
      delivery = { ok: false, mode, error: replyError instanceof Error ? replyError.message : 'Live send failed.' };
    }
  }
  // Reopen + mark the owner's view consistent: inbound messages stay as they were.
  await supabase.from('social_messages').update({ is_resolved: false }).eq('store_id', storeId).eq('thread_key', threadKey);
  return res.status(201).json({ message: saved, delivery });
}

async function handleSocialRead(req, res, profile, storeId) {
  const threadKey = String(req.body?.thread_key || '').slice(0, 200);
  if (!threadKey) return res.status(400).json({ error: 'Conversation is required.' });
  const { error } = await supabase.from('social_messages').update({ is_read: true }).eq('store_id', storeId).eq('thread_key', threadKey).eq('direction', 'in');
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

async function handleSocialResolve(req, res, profile, storeId) {
  const threadKey = String(req.body?.thread_key || '').slice(0, 200);
  const resolved = Boolean(req.body?.resolved);
  if (!threadKey) return res.status(400).json({ error: 'Conversation is required.' });
  const { error } = await supabase.from('social_messages').update({ is_resolved: resolved }).eq('store_id', storeId).eq('thread_key', threadKey);
  if (error) throw error;
  return res.status(200).json({ ok: true, resolved });
}

async function handleSocialSeedDemo(req, res, profile, storeId) {
  const { data: already } = await supabase.from('social_messages').select('id').eq('store_id', storeId).limit(1);
  if (already?.length) return res.status(200).json({ ok: true, seeded: 0, note: 'Inbox already has messages.' });
  const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).single();
  const rows = mockSeedThreads(storeId, store?.name || 'Store');
  const { error } = await supabase.from('social_messages').insert(rows);
  if (error) throw error;
  return res.status(201).json({ ok: true, seeded: rows.length });
}

async function handleSocial(req, res) {
  const { profile, error } = await getAuthedProfile(req);
  if (error) return res.status(401).json({ error });
  const storeId = resolveSocialStore(req, profile);
  if (!storeId) return res.status(400).json({ error: 'Store is required.' });
  if (req.method === 'GET') {
    const op = String(req.query?.op || 'status').toLowerCase();
    if (op === 'status') return handleSocialStatus(req, res, profile, storeId);
    if (op === 'inbox') return handleSocialInbox(req, res, profile, storeId);
    if (op === 'posts') return handleSocialPosts(req, res, profile, storeId);
    return res.status(400).json({ error: 'Unknown op. Use ?op=status | inbox | posts' });
  }
  if (req.method === 'POST') {
    const op = String(req.body?.op || '').toLowerCase();
    if (op === 'connect') return handleSocialConnect(req, res, profile, storeId);
    if (op === 'disconnect') return handleSocialDisconnect(req, res, profile, storeId);
    if (op === 'publish') return handleSocialPublish(req, res, profile, storeId, false);
    if (op === 'save_draft') return handleSocialPublish(req, res, profile, storeId, true);
    if (op === 'reply') return handleSocialReply(req, res, profile, storeId);
    if (op === 'read') return handleSocialRead(req, res, profile, storeId);
    if (op === 'resolve') return handleSocialResolve(req, res, profile, storeId);
    if (op === 'seed_demo') return handleSocialSeedDemo(req, res, profile, storeId);
    return res.status(400).json({ error: 'Unknown op. Use connect | disconnect | publish | save_draft | reply | read | resolve | seed_demo' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
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
    if (action === 'social') return handleSocial(req, res);
    return res.status(400).json({ error: 'Unknown action. Use ?action=profile | upload | social' });
  } catch (err) {
    console.error('Media API error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
