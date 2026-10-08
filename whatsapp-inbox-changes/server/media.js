// api/media.js
// =========================================================================
//  Combined auth/media/social endpoint
//  ?action=profile — get the current user's StoYangu profile (GET only)
//  ?action=upload  — upload a product photo or store logo (POST only)
//  ?action=post-upload-url — signed URL for a composer photo/video (POST;
//                    the browser uploads straight to storage, no size limits)
//  ?action=social  — Repliz social layer: connect accounts, post-once-to-all,
//                    unified DMs/comments inbox (GET ?op=status|inbox|posts,
//                    POST { op: connect|oauth_pick|disconnect|sync_accounts|
//                    sync_inbox|publish|save_draft|reply|read|resolve|
//                    resolve })
//  ?action=social-callback — landing page for official platform OAuth (GET;
//                    same-tab friendly: ?s=<state> survives platform hops)
//
//  This was originally two files (/api/profile and /api/upload). They were
//  merged into one serverless function to stay under Vercel's Hobby plan
//  12-function limit. Both endpoints keep their old URLs as aliases too,
//  so anything cached on the client keeps working. The social layer lives
//  here for the same reason — api/ must stay at exactly 12 files.
// =========================================================================

import supabase from '../lib/db-client.js';
import { storeOrders } from '../lib/order-fallback.js';
import { pushStoreEvent } from '../lib/push-events.js';
import { isWorkerConfigured, workerPair, workerUnlink } from '../lib/whatsapp-worker.js';
import { REPLIZ_LABELS, REPLIZ_PLATFORMS, REPLIZ_SINGLE_STEP, REPLIZ_TWO_STEP, extractOAuthCode, normalizePublishMedia, normalizeReplizChat, normalizeReplizChatMessage, normalizeReplizComment, normalizeReplizPlatform, replizAuthorizeUrl, replizCallbackUrl, replizConnectOAuth, replizConnectUrl, replizExchangeCode, replizFetchChatMessages, replizFetchInbox, replizGetAccount, replizKeys, replizListOAuthChoices, replizMarkChatRead, replizMode, replizPublish, replizSendReply, replizUpdateCommentStatus, replizWorkspaceAccounts } from '../lib/repliz.js';

const ALLOWED_IMAGE_TYPES = /^image\/(jpeg|jpg|png|webp|gif|heic|heif|avif|bmp)$/i;
const ALLOWED_POST_MEDIA_TYPES = /^image\/(jpeg|jpg|png|webp|gif)$/i;
const ALLOWED_POST_VIDEO_TYPES = /^video\/(mp4|quicktime|webm)$/i;
const MAX_BASE64 = 8_400_000;
const MAX_BYTES = 6_291_456;
const MAX_POST_BASE64 = 105_000_000;
const MAX_POST_BYTES = 78_643_200;
const POST_MEDIA_BUCKET = 'stoyangu-posts';

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

// WhatsApp actions use stricter store resolution than the older social routes:
// owners are always bound to profiles.store_id, while founders must explicitly
// choose an existing store. There is no default-store fallback.
async function resolveWhatsAppStore(req, profile) {
  if (profile.role === 'founder') {
    const requestedStoreId = Number(req.body?.storeId ?? req.query?.storeId);
    if (!Number.isSafeInteger(requestedStoreId) || requestedStoreId < 1) {
      return { status: 400, error: 'Founders must choose a store before connecting or disconnecting WhatsApp.' };
    }
    const { data: store, error } = await supabase.from('stores').select('id').eq('id', requestedStoreId).maybeSingle();
    if (error) throw error;
    if (!store) return { status: 404, error: 'The selected store does not exist. Choose an existing store.' };
    return { storeId: requestedStoreId };
  }

  if (profile.role === 'owner') {
    const storeId = Number(profile.store_id);
    if (!Number.isSafeInteger(storeId) || storeId < 1) {
      return { status: 400, error: 'This owner account has no store assigned in its profile. Contact support before managing WhatsApp.' };
    }
    return { storeId };
  }

  return { status: 403, error: 'Only store owners and founders can manage WhatsApp.' };
}

// =========================================================================
//  WhatsApp (StoYangu worker) handlers — Item 1: pair / unlink
//  Browser never calls the worker; server verifies auth + store ownership,
//  then proxies to the worker using the admin token. The browser reads
//  wa_sessions directly (allowed columns only) via Supabase RLS.
// =========================================================================

function normalizeKePhone(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('254') && digits.length >= 12) return digits;
  if (digits.startsWith('0') && digits.length >= 10) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
}

async function handleWhatsAppPair(req, res, storeId) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  const phoneRaw = String(req.body?.phoneNumber || req.body?.phone || '').trim();
  const phoneNumber = normalizeKePhone(phoneRaw);
  if (!/^254\d{9}$/.test(phoneNumber)) {
    return res.status(400).json({ error: 'Enter a 10-digit Kenyan phone number starting with 0 (for example 0712 345 678). The +254 country code is added automatically.' });
  }
  if (!isWorkerConfigured()) {
    return res.status(503).json({ error: 'WhatsApp is not available right now. Please try again later.' });
  }
  try {
    const { data } = await workerPair({ storeId, phoneNumber });
    // The worker is the only writer of WhatsApp state. The browser polls its
    // row every three seconds and shows a preparing state until it appears.
    return res.status(200).json({ ...(data || {}), ok: true, storeId, phoneNumber });
  } catch (err) {
    const status = err.status || 500;
    const workerCode = String(err?.payload?.code || err?.payload?.error || err?.payload?.message || '').toLowerCase();
    // Let the browser keep showing "Preparing code..." while it waits for the
    // worker's own row to appear on the next poll.
    if (status === 409 && workerCode === 'pairing_in_progress') {
      return res.status(200).json({ ok: true, status: 'in_progress', storeId });
    }
    let message = 'Could not start WhatsApp pairing. Please try again.';
    if (status === 401) message = 'The worker rejected the pairing request. Wait a minute and try again.';
    if (status === 400) message = 'Check the phone number and try again.';
    if (status === 409) {
      if (workerCode === 'already_linked') {
        message = 'This shop is already connected. Disconnect first to link a different phone.';
      } else {
        message = 'A linking request is already in progress. Wait a moment and try again.';
      }
    }
    return res.status(status).json({ error: message });
  }
}

async function handleWhatsAppUnlink(req, res, storeId) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  if (!isWorkerConfigured()) return res.status(503).json({ error: 'WhatsApp is not available right now. Please try again later.' });
  try {
    const { data } = await workerUnlink({ storeId });
    return res.status(200).json({ ...(data || {}), ok: true, storeId });
  } catch (err) {
    const status = err.status || 500;
    let message = 'Could not disconnect WhatsApp. Please try again.';
    if (status === 401) message = 'The worker rejected the disconnect request. Try again in a moment.';
    if (status === 404) message = 'No WhatsApp device is linked for this shop yet.';
    return res.status(status).json({ error: message });
  }
}

// =========================================================================
//  Social (Repliz) handlers
// =========================================================================

// Woyoyo-010: setup self-test. Reports, in plain language, everything the
// connect flow needs: Repliz keys present, Repliz reachable, and the
// social_oauth_states table existing. The Accounts pop-up shows this so
// the founder can fix setup without guessing.
async function handleSocialSetupCheck(req, res, profile, storeId) {
  void profile; void storeId;
  const { access, secret } = replizKeys();
  const keysPresent = Boolean(access && secret);
  let apiReachable = null;
  let apiDetail = '';
  if (keysPresent) {
    try {
      await replizWorkspaceAccounts({ platform: undefined });
      apiReachable = true;
    } catch (err) {
      apiReachable = false;
      apiDetail = err instanceof Error ? err.message : 'Repliz did not answer.';
    }
  }
  let tableReady = null;
  let tableDetail = '';
  try {
    const { error } = await supabase.from('social_oauth_states').select('id,status').limit(1);
    if (error) {
      if (/42P01|PGRST205|does not exist|schema cache|relation|column|status/i.test(error.message || '')) {
        tableReady = false;
        tableDetail = 'The connection-state table or its status column is missing. Run the WOYOYO-012 migration.';
      } else {
        tableReady = null;
        tableDetail = error.message || 'Could not check the table.';
      }
    } else {
      tableReady = true;
    }
  } catch (err) {
    tableReady = null;
    tableDetail = err instanceof Error ? err.message : 'Could not check the table.';
  }
  return res.status(200).json({ keysPresent, apiReachable, apiDetail, tableReady, tableDetail });
}

async function handleSocialStatus(req, res, profile, storeId) {
  const [{ data: connections, error: connError }, { data: unread, error: unreadError }] = await Promise.all([
    supabase.from('social_connections').select('*').eq('store_id', storeId).in('platform', REPLIZ_PLATFORMS).order('platform', { ascending: true }),
    supabase.from('social_messages').select('platform').eq('store_id', storeId).in('platform', [...REPLIZ_PLATFORMS, 'storefront']).eq('direction', 'in').eq('is_read', false),
  ]);
  if (connError) throw connError;
  if (unreadError) throw unreadError;
  const byPlatform = {};
  for (const row of unread || []) byPlatform[row.platform] = (byPlatform[row.platform] || 0) + 1;
  return res.status(200).json({ connections: connections || [], unread: { total: (unread || []).length, by_platform: byPlatform } });
}

async function handleSocialInbox(req, res, profile, storeId) {
  let { data: messages, error } = await supabase
    .from('social_messages')
    .select('*')
    .eq('store_id', storeId)
    .in('platform', [...REPLIZ_PLATFORMS, 'storefront'])
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  // Repair older checkouts whose order was saved but their inbox side-effect failed.
  const orders = await storeOrders(supabase, storeId, 200);
  const existingOrders = new Set((messages || []).map(row => row.thread_key));
  const missing = (orders || []).filter(order => order.order_key && !existingOrders.has(`order:${order.order_key}`)).map(order => ({
    store_id: storeId, platform: 'storefront', kind: 'dm', thread_key: `order:${order.order_key}`,
    sender_name: order.customer_phone, sender_handle: order.customer_phone,
    body: `Store Order: ${order.product_name} · KES ${Number(order.product_price || 0).toLocaleString('en-KE')}${order.color ? ` · ${order.color}` : ''}${order.size ? ` · ${order.size}` : ''}. ${order.fulfilment || 'Delivery'}. ${order.note || ''}`.trim(),
    direction: 'in', is_read: false, is_resolved: false, external_id: order.order_key,
    post_title: order.product_name, created_at: order.created_at,
  }));
  if (missing.length) {
    const inserted = await supabase.from('social_messages').insert(missing).select('id');
    if (inserted.error) console.error('Order inbox repair failed:', inserted.error);
    const latest = await supabase.from('social_messages').select('*').eq('store_id', storeId).in('platform', [...REPLIZ_PLATFORMS, 'storefront']).order('created_at', { ascending: false }).limit(500);
    if (!latest.error) messages = latest.data;
  }
  const distinct = new Set();
  const groups = new Map();
  for (const message of messages || []) {
    if (message.platform === 'storefront' && typeof message.body === 'string') message.body = message.body.replace(/^(New order|Website Order):/i, 'Store Order:');
    if (message.kind === 'comment' && (groups.get(message.thread_key) || []).some(row => row.platform === message.platform && (row.sender_handle || row.sender_name) === (message.sender_handle || message.sender_name) && String(row.body).trim().toLowerCase() === String(message.body).trim().toLowerCase() && Math.abs(new Date(row.created_at).getTime() - new Date(message.created_at).getTime()) < 60000)) continue;
    const minute = Math.floor(new Date(message.created_at).getTime() / 60000);
    const key = message.kind === 'comment'
      ? `${message.platform}:${message.thread_key}:${message.sender_handle || message.sender_name}:${String(message.body).trim().toLowerCase()}:${minute}`
      : message.platform === 'storefront' ? `${message.store_id}:${message.thread_key}:${message.direction}:${message.body}` : `id:${message.id}`;
    if (distinct.has(key)) continue;
    distinct.add(key);
    if (!groups.has(message.thread_key)) groups.set(message.thread_key, []);
    groups.get(message.thread_key).push(message);
  }
  const threads = [...groups.entries()].map(([threadKey, rows]) => {
    const chronological = [...rows].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const latest = rows[0];
    const firstInbound = chronological.find((row) => row.direction === 'in') || chronological[0];
    // Woyoyo-003: comment threads carry their source video/post so the
    // conversation header can show where the comment came from.
    const source = chronological.find((row) => row.post_title || row.post_ref) || {};
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
      source_ref: source.post_ref || '',
      source_title: source.post_title || '',
      source_url: source.post_url || '',
      messages: chronological,
    };
  }).sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime());
  return res.status(200).json({ threads });
}

async function handleSocialPosts(req, res, profile, storeId) {
  const { data, error } = await supabase.from('social_posts').select('*').eq('store_id', storeId).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return res.status(200).json({ posts: (data || []).map(post => ({
    ...post,
    platforms: (post.platforms || []).filter(platform => REPLIZ_PLATFORMS.includes(platform)),
    results: Object.fromEntries(Object.entries(post.results || {}).filter(([key]) => {
      if (key === 'media_kinds') return true;
      const normalizedKey = key.toLowerCase();
      return REPLIZ_PLATFORMS.some(platform => {
        const label = String(REPLIZ_LABELS[platform] || platform).toLowerCase();
        return normalizedKey === platform || normalizedKey.startsWith(`${platform} `) || normalizedKey === label || normalizedKey.startsWith(`${label} `);
      });
    })),
  })) });
}

async function upsertConnection(storeId, platform, account, status) {
  const handle = String(account?.handle || '').trim() || `@${platform}-account`;
  const values = {
    store_id: storeId,
    platform,
    account_handle: handle.startsWith('@') ? handle : `@${handle}`,
    account_id: String(account?.id || ''),
    connection_status: status,
    auth_payload: status === 'mock'
      ? { mode: 'mock' }
      : { display_name: account?.display_name || '', avatar_url: account?.avatar_url || '', synced_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase.from('social_connections').select('id').eq('store_id', storeId).eq('platform', platform).limit(1);
  const saved = existing?.length
    ? await supabase.from('social_connections').update(values).eq('id', existing[0].id).select().single()
    : await supabase.from('social_connections').insert(values).select().single();
  if (saved.error) throw saved.error;
  return saved.data;
}

async function handleSocialDisconnect(req, res, profile, storeId) {
  const connectionId = Number(req.body?.connection_id || 0);
  if (!connectionId) return res.status(400).json({ error: 'Connection is required.' });
  const { error } = await supabase.from('social_connections').delete().eq('id', connectionId).eq('store_id', storeId);
  if (error) throw error;
  return res.status(200).json({ ok: true });
}

async function handleSocialSyncAccounts(req, res, profile, storeId) {
  const { data: existing, error } = await supabase.from('social_connections').select('*').eq('store_id', storeId);
  if (error) throw error;
  if (replizMode() !== 'live') return res.status(200).json({ connections: (existing || []).filter(row => REPLIZ_PLATFORMS.includes(row.platform)), synced: 0 });
  let synced = 0;
  for (const row of existing || []) {
    if (!REPLIZ_PLATFORMS.includes(row.platform)) continue;
    if (!row.account_id || row.connection_status !== 'connected') continue;
    const account = await replizGetAccount(row.account_id);
    if (account.platform !== row.platform) continue;
    await upsertConnection(storeId, row.platform, account, 'connected'); synced++;
  }
  const { data: connections, error: readError } = await supabase.from('social_connections').select('*').eq('store_id', storeId).in('platform', REPLIZ_PLATFORMS).order('platform');
  if (readError) throw readError;
  return res.status(200).json({ connections, synced });
}

// Woyoyo-004: pick the Page that completes a
// two-step OAuth connection. The token and pending state come from the
// callback page; we bind into Repliz, then store the connection.
// Woyoyo-009: a phone-resumed picker may arrive without the token in the
// payload (it never travelled in the URL) — fall back to the copy the
// callback saved on the state row, after the same store check.
async function handleSocialPublish(req, res, profile, storeId, asDraft) {
  const caption = String(req.body?.caption || '').trim().slice(0, 2200);
  const mediaUrls = Array.isArray(req.body?.media_urls) ? req.body.media_urls.map((u) => String(u).slice(0, 1000)).filter(Boolean).slice(0, 10) : [];
  // Woyoyo-004: the composer sends one kind per attachment ('image'/'video')
  // so TikTok-style videos publish as videos on every platform.
  const mediaKinds = Array.isArray(req.body?.media_kinds)
    ? req.body.media_kinds.map((kind) => (kind === 'video' ? 'video' : 'image')).slice(0, 10)
    : mediaUrls.map((url) => (/\.(mp4|mov|m4v|webm|3gp)(\?|#|$)/i.test(url) ? 'video' : 'image'));
  const title = String(req.body?.title || '').trim().slice(0, 120);
  if (!caption) return res.status(400).json({ error: 'Write a caption first.' });
  const mode = replizMode();
  const { data: connections, error: connError } = await supabase.from('social_connections').select('*').eq('store_id', storeId).eq('connection_status', 'connected');
  if (connError) throw connError;
  // Woyoyo-003: publishing ALWAYS goes to every connected platform —
  // the composer never asks which ones (any legacy `platforms` payload ignored).
  const platforms = [...new Set((connections || []).map((c) => String(c.platform).toLowerCase()).filter((p) => REPLIZ_PLATFORMS.includes(p)))];
  if (!platforms.length && !asDraft) return res.status(400).json({ error: 'Connect at least one account first in Settings → Connected accounts.' });
  let results = {};
  if (!asDraft) {
    if (mode !== 'live') return res.status(503).json({ error: 'Publishing is not configured. Your product is saved; add the Repliz credentials to publish.' });
    {
      const jobs = platforms.flatMap(platform => {
        // Stories can ONLY be posted to Instagram and Facebook. TikTok and
        // Threads are feed-only in the public Repliz API.
        const placements = ['instagram', 'facebook'].includes(platform) ? ['feed', 'story'] : ['feed'];
        return placements.map(placement => ({ platform, placement, connection: (connections || []).find(c => c.platform === platform) }));
      });
      const delivered = await Promise.all(jobs.map(async ({ platform, placement, connection }) => {
        const platformLabel = platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : platform === 'threads' ? 'Threads' : 'TikTok';
        const placementLabel = placement === 'story' ? 'story' : 'post';
        const key = `${platformLabel} ${placementLabel}`;
        try {
          const posted = await replizPublish({ platform, accountId: connection?.account_id, caption, mediaUrls, mediaKinds, title, placement });
          return { key, result: { ok: true, mode: 'live', external_id: String(posted?.scheduleId || posted?.id || posted?.external_id || posted?.post_id || ''), posted_at: new Date().toISOString() } };
        } catch (publishError) {
          const detail = publishError instanceof Error ? publishError.message : '';
          return { key, result: { ok: false, mode: 'live', error: detail.trim().length > 2 ? detail : 'The connected platform could not accept this post. Please check the account and retry.' } };
        }
      }));
      results = Object.fromEntries(delivered.map(({ key, result }) => [key, result]));
    }
  }
  const { data, error } = await supabase.from('social_posts').insert({
    store_id: storeId,
    caption,
    media_urls: normalizePublishMedia(mediaUrls, mediaKinds).map((item) => item.url),
    platforms,
    status: asDraft ? 'draft' : Object.values(results).every(r => r.ok) ? 'queued' : Object.values(results).some(r => r.ok) ? 'partial' : 'failed',
    results: { ...(results || {}), media_kinds: mediaKinds },
    posted_at: asDraft ? null : new Date().toISOString(),
  }).select().single();
  if (error) throw error;
  if (!asDraft && Object.values(results).some(r => r.ok)) await pushStoreEvent(storeId, 'Post sent', 'Your connected account accepted the post. Check the platform for delivery status.', `post-${data.id}`);
  return res.status(201).json({ post: data, mode, results });
}

async function handleSocialReply(req, res, profile, storeId) {
  const threadKey = String(req.body?.thread_key || '').slice(0, 200);
  const body = String(req.body?.body || '').trim().slice(0, 2000);
  const attachmentUrl = String(req.body?.attachment_url || '').slice(0, 1500);
  const attachmentName = String(req.body?.attachment_name || '').slice(0, 200);
  if (!threadKey || (!body && !attachmentUrl)) return res.status(400).json({ error: 'Conversation and reply are required.' });
  const { data: existing, error: existingError } = await supabase
    .from('social_messages')
    .select('*')
    .eq('store_id', storeId)
    .eq('thread_key', threadKey)
    .order('created_at', { ascending: false })
    .limit(100);
  if (existingError) throw existingError;
  if (!existing?.length) return res.status(404).json({ error: 'Conversation not found.' });
  // Always deliver against an inbound provider message. The newest row is
  // often the owner's previous outgoing reply, whose external_id is null;
  // using it caused the false "comment is missing its platform reference"
  // failure on every second reply.
  const head = existing.find((message) => message.direction === 'in') || existing[0];
  const deliverySource = existing.find((message) => message.direction === 'in' && message.external_id) || head;
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
    body: body || (attachmentName ? `Attachment: ${attachmentName}` : 'Photo attachment'),
    ...(attachmentUrl ? { attachment_url: attachmentUrl, attachment_name: attachmentName || null } : {}),
    direction: 'out',
    is_read: true,
    is_resolved: false,
    external_id: mode === 'mock' ? `mock_out_${Date.now().toString(36)}` : null,
  }).select().single();
  if (error) throw error;
  let delivery = { ok: true, mode };
  if (mode === 'live' && head.platform !== 'storefront') {
    try {
      const { data: connection } = await supabase.from('social_connections').select('account_id').eq('store_id', storeId).eq('platform', head.platform).limit(1).maybeSingle();
      await replizSendReply({ platform: head.platform, accountId: connection?.account_id, threadKey, externalId: deliverySource.external_id, body: [body, attachmentUrl].filter(Boolean).join('\n'), kind: head.kind });
    } catch (replyError) {
      delivery = { ok: false, mode, error: replyError instanceof Error ? replyError.message : 'Live send failed.' };
    }
  }
  if (head.platform === 'storefront') delivery = { ok: false, mode: 'storefront', error: 'Storefront replies stay in your inbox. Open WhatsApp to send this message to the customer.' };
  else if (mode !== 'live') delivery = { ok: false, mode, error: 'Social delivery needs Repliz credentials. Reply saved in your inbox.' };
  // Reopen + mark the owner's view consistent: inbound messages stay as they were.
  await supabase.from('social_messages').update({ is_resolved: false }).eq('store_id', storeId).eq('thread_key', threadKey);
  return res.status(201).json({ message: saved, delivery });
}

async function handleSocialRead(req, res, profile, storeId) {
  const threadKey = String(req.body?.thread_key || '').slice(0, 200);
  if (!threadKey) return res.status(400).json({ error: 'Conversation is required.' });
  const { error } = await supabase.from('social_messages').update({ is_read: true }).eq('store_id', storeId).eq('thread_key', threadKey).eq('direction', 'in');
  if (error) throw error;
  // Live mode: also clear it on the platform side for DM threads.
  if (replizMode() === 'live' && threadKey.startsWith('chat:')) {
    try { await replizMarkChatRead(threadKey.slice(5)); } catch { /* local state already correct */ }
  }
  return res.status(200).json({ ok: true });
}

async function handleSocialResolve(req, res, profile, storeId) {
  const threadKey = String(req.body?.thread_key || '').slice(0, 200);
  const resolved = Boolean(req.body?.resolved);
  if (!threadKey) return res.status(400).json({ error: 'Conversation is required.' });
  const { error } = await supabase.from('social_messages').update({ is_resolved: resolved }).eq('store_id', storeId).eq('thread_key', threadKey);
  if (error) throw error;
  // Live mode: mirror comment status back into the Repliz inbox.
  if (replizMode() === 'live') {
    try {
      const { data: rows } = await supabase.from('social_messages').select('kind,external_id').eq('store_id', storeId).eq('thread_key', threadKey).eq('direction', 'in').limit(1);
      const head = rows?.[0];
      if (head?.kind === 'comment' && head.external_id && !String(head.external_id).startsWith('mock_')) {
        await replizUpdateCommentStatus(head.external_id, resolved);
      }
    } catch { /* local state already correct */ }
  }
  return res.status(200).json({ ok: true, resolved });
}

// Woyoyo-004: live inbox sync. Pulls the newest Repliz comments + chats for
// every connected account and merges them into social_messages (new rows
// only — the inbox never duplicates). The inbox page calls this quietly on
// a timer so new DMs and comments appear like a social app.
export async function syncStoreInbox(storeId) {
  if (replizMode() !== 'live') return { ok: true, mode: 'unconfigured', added: 0, errors: [] };
  const { data: connections, error: connectionError } = await supabase.from('social_connections').select('*').eq('store_id', storeId).eq('connection_status', 'connected');
  if (connectionError) throw connectionError;
  const { data: store, error: storeError } = await supabase.from('stores').select('name').eq('id', storeId).single();
  if (storeError) throw storeError;
  const storeName = store?.name || 'Store';
  const { data: known, error: knownError } = await supabase
    .from('social_messages')
    .select('external_id,thread_key,body,created_at,sender_handle,sender_name,kind,platform')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (knownError) throw knownError;
  const seenExternal = new Set((known || []).map((row) => row.external_id).filter(Boolean));
  const seenCombo = new Set((known || []).map((row) => `${row.thread_key}::${row.body}::${row.created_at}`));
  const knownComments = (known || []).filter(row => row.kind === 'comment');
  const candidates = [];
  const errors = [];
  for (const connection of connections || []) {
    const platform = String(connection.platform || '').toLowerCase();
    if (!REPLIZ_PLATFORMS.includes(platform)) continue;
    try {
      const { comments, chats } = await replizFetchInbox({ accountId: connection.account_id, platform });
      for (const doc of comments?.docs || comments?.data || []) {
        try {
          const row = normalizeReplizComment(doc, platform);
          if (!row.body) continue;
          candidates.push({ ...row, kind: 'comment', direction: 'in', is_read: row.status !== 'pending', is_resolved: row.status === 'resolved' });
        } catch { /* skip one malformed doc */ }
      }
      const chatDocs = chats?.docs || chats?.data || [];
      const historyOnly = chatDocs.length === 1;
      for (const doc of chatDocs) {
        try {
          const chat = normalizeReplizChat(doc, platform);
          if (historyOnly && chat.chat_id) {
            // Single thread: store its fuller history, newest max 20.
            const history = await replizFetchChatMessages(chat.chat_id, 20).catch(() => []);
            const messages = history.length ? history : [];
            for (const item of messages) {
              const row = normalizeReplizChatMessage(item, chat.chat_id, platform, chat.thread_key);
              if (!row.body) continue;
              candidates.push({
                ...row,
                kind: 'dm',
                sender_name: row.direction === 'out' ? storeName : (chat.sender_name || row.sender_name || 'Follower'),
                sender_handle: row.sender_handle,
                sender_avatar: row.sender_avatar || chat.sender_avatar,
                is_read: row.direction === 'out',
                is_resolved: false,
              });
            }
          }
          if (chat.body) {
            candidates.push({
              ...chat,
              kind: 'dm',
              sender_name: chat.direction === 'out' ? storeName : chat.sender_name,
              is_read: chat.direction === 'out' ? true : chat.unread === 0,
              is_resolved: false,
            });
          }
        } catch { /* skip one malformed doc */ }
      }
    } catch (accountError) {
      errors.push(`${platform}: ${accountError instanceof Error ? accountError.message : 'sync failed'}`.slice(0, 160));
    }
  }
  const fresh = [];
  for (const candidate of candidates) {
    const key = `${candidate.thread_key}::${candidate.body}::${candidate.created_at}`;
    if (candidate.kind === 'comment' && knownComments.some(row => row.platform === candidate.platform && row.thread_key === candidate.thread_key && (row.sender_handle || row.sender_name) === (candidate.sender_handle || candidate.sender_name) && String(row.body).trim().toLowerCase() === String(candidate.body).trim().toLowerCase() && Math.abs(new Date(row.created_at).getTime() - new Date(candidate.created_at).getTime()) < 60000)) continue;
    if (candidate.external_id && seenExternal.has(candidate.external_id)) continue;
    if (seenCombo.has(key)) continue;
    seenCombo.add(key);
    if (candidate.external_id) seenExternal.add(candidate.external_id);
    fresh.push({
      store_id: storeId,
      platform: candidate.platform || '',
      kind: candidate.kind,
      thread_key: candidate.thread_key,
      sender_name: String(candidate.sender_name || 'Follower').slice(0, 200),
      sender_handle: candidate.sender_handle ? String(candidate.sender_handle).slice(0, 200) : null,
      body: String(candidate.body).slice(0, 2000),
      direction: candidate.direction === 'out' ? 'out' : 'in',
      is_read: Boolean(candidate.is_read),
      is_resolved: Boolean(candidate.is_resolved),
      external_id: candidate.external_id ? String(candidate.external_id).slice(0, 200) : null,
      post_ref: String(candidate.post_ref || '').slice(0, 200),
      post_title: String(candidate.post_title || '').slice(0, 300),
      post_url: String(candidate.post_url || '').slice(0, 1000),
      sender_avatar: candidate.sender_avatar ? String(candidate.sender_avatar).slice(0, 1000) : null,
      created_at: candidate.created_at || new Date().toISOString(),
    });
    if (candidate.kind === 'comment') knownComments.push(candidate);
  }
  let pushSent = 0;
  let pushFailed = 0;
  const pushIssues = new Set();
  if (fresh.length) {
    const attempt = await supabase.from('social_messages').insert(fresh);
    if (attempt.error) {
      if (/post_ref|post_title|post_url|sender_avatar/.test(attempt.error.message || '')) {
        const legacy = fresh.map(({ post_ref, post_title, post_url, sender_avatar, ...rest }) => rest);
        const retry = await supabase.from('social_messages').insert(legacy);
        if (retry.error) throw retry.error;
      } else {
        throw attempt.error;
      }
    }
    const pushResults = await Promise.all(fresh
      .filter(row => row.direction === 'in')
      .map(row => pushStoreEvent(
        storeId,
        row.kind === 'comment' ? 'New comment' : 'New message',
        `${row.sender_name}: ${row.body.slice(0, 110)}`,
        `inbox-${row.external_id || `${row.thread_key}-${row.created_at}`}`,
        '/owner?inbox=1',
        { sender_name: row.sender_name, platform: row.platform, threadKey: row.thread_key, isOrder: row.platform === 'storefront' }
      )));
    pushSent = pushResults.reduce((total, result) => total + Number(result.sent || 0), 0);
    pushFailed = pushResults.reduce((total, result) => total + Number(result.failed || 0), 0);
    for (const result of pushResults) if (result.reason) pushIssues.add(result.reason);
  }
  return {
    ok: true,
    mode: 'live',
    added: fresh.length,
    errors,
    notifications: { sent: pushSent, failed: pushFailed, issues: [...pushIssues] },
  };
}

function webhookObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function webhookTimestamp(value) {
  const date = new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

// Process Repliz's documented chat/comment webhook shape directly. This saves
// an extra API poll on each event; the normal inbox sync remains as a recovery
// path if an event cannot be matched to one of this workspace's connections.
export async function processReplizWebhookEvent(payload) {
  const event = webhookObject(payload);
  const type = String(event.type || '').trim().toLowerCase();
  if (!['chat', 'comment'].includes(type)) return { handled: true, ignored: true, reason: 'not-an-inbox-event' };

  const platform = normalizeReplizPlatform(event.platform);
  if (!platform) return { handled: true, ignored: true, reason: 'unsupported-platform' };
  const data = webhookObject(event.data);
  let candidate;

  if (type === 'comment') {
    const comment = webhookObject(data.comment);
    const normalized = normalizeReplizComment({
      ...data,
      platform,
      sender: comment.owner || data.sender || data.user || {},
      comment: comment.text || (typeof data.comment === 'string' ? data.comment : ''),
      createdAt: data.createdAt || comment.createdAt,
    }, platform);
    if (!normalized.body || !normalized.thread_key) return { handled: false };
    const status = String(normalized.status || 'pending').toLowerCase();
    candidate = {
      ...normalized,
      kind: 'comment',
      direction: 'in',
      is_read: status !== 'pending',
      is_resolved: status === 'resolved',
    };
  } else {
    const chatData = webhookObject(data.chat);
    const messageData = webhookObject(data.message);
    const isFromMe = messageData.isFromMe === true || (messageData.isFromMe == null && chatData.lastMessage?.isFromMe === true);
    if (isFromMe) return { handled: true, ignored: true, reason: 'outgoing-message' };
    const chatId = String(messageData.chatId || chatData._id || chatData.id || chatData.chatId || '').trim();
    if (!chatId) return { handled: false };
    const chat = normalizeReplizChat({ ...chatData, _id: chatId, lastMessage: chatData.lastMessage || messageData }, platform);
    const normalized = normalizeReplizChatMessage({ ...messageData, isFromMe: false }, chatId, platform, chat.thread_key);
    if (!normalized.body || !normalized.thread_key) return { handled: false };
    candidate = {
      ...normalized,
      kind: 'dm',
      sender_name: chat.sender_name || messageData.senderName || 'Follower',
      sender_avatar: chat.sender_avatar || null,
      direction: 'in',
      is_read: false,
      is_resolved: false,
      post_ref: '',
      post_title: '',
      post_url: '',
    };
  }

  const accountIds = [...new Set([
    event.accountId, event.account_id, data.accountId, data.account_id,
    data.chat?.accountId, data.message?.accountId,
  ].map((value) => String(value || '').trim()).filter(Boolean))];
  if (!accountIds.length) return { handled: false };

  const { data: connections, error: connectionError } = await supabase
    .from('social_connections')
    .select('store_id')
    .eq('platform', platform)
    .eq('connection_status', 'connected')
    .in('account_id', accountIds);
  if (connectionError) throw connectionError;
  const storeIds = [...new Set((connections || []).map((row) => Number(row.store_id)).filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (!storeIds.length) return { handled: false };

  const body = String(candidate.body || '').slice(0, 2000);
  const externalId = String(candidate.external_id || '').slice(0, 200);
  const createdAt = webhookTimestamp(candidate.created_at);
  let added = 0;
  let duplicates = 0;
  let pushSent = 0;
  let pushFailed = 0;
  const pushIssues = new Set();

  for (const storeId of storeIds) {
    const row = {
      store_id: storeId,
      platform,
      kind: candidate.kind,
      thread_key: String(candidate.thread_key).slice(0, 250),
      sender_name: String(candidate.sender_name || 'Follower').slice(0, 200),
      sender_handle: candidate.sender_handle ? String(candidate.sender_handle).slice(0, 200) : null,
      body,
      direction: 'in',
      is_read: Boolean(candidate.is_read),
      is_resolved: Boolean(candidate.is_resolved),
      external_id: externalId || null,
      post_ref: String(candidate.post_ref || '').slice(0, 200),
      post_title: String(candidate.post_title || '').slice(0, 300),
      post_url: String(candidate.post_url || '').slice(0, 1000),
      sender_avatar: candidate.sender_avatar ? String(candidate.sender_avatar).slice(0, 1000) : null,
      created_at: createdAt,
    };
    let duplicateQuery = supabase.from('social_messages').select('id').eq('store_id', storeId).eq('platform', platform).limit(1);
    duplicateQuery = externalId
      ? duplicateQuery.eq('external_id', externalId)
      : duplicateQuery.eq('thread_key', row.thread_key).eq('body', body).eq('created_at', createdAt);
    const { data: existing, error: existingError } = await duplicateQuery;
    if (existingError) throw existingError;
    if (existing?.length) { duplicates++; continue; }

    const inserted = await supabase.from('social_messages').insert(row);
    if (inserted.error) {
      if (/post_ref|post_title|post_url|sender_avatar/.test(inserted.error.message || '')) {
        const { post_ref, post_title, post_url, sender_avatar, ...legacy } = row;
        const retry = await supabase.from('social_messages').insert(legacy);
        if (retry.error) throw retry.error;
      } else {
        throw inserted.error;
      }
    }
    const pushResult = await pushStoreEvent(
      storeId,
      candidate.kind === 'comment' ? 'New comment' : 'New message',
      `${row.sender_name}: ${body.slice(0, 110)}`,
      `inbox-${externalId || `${row.thread_key}-${createdAt}`}`,
      '/owner?inbox=1',
      { sender_name: row.sender_name, platform: candidate.platform, threadKey: row.thread_key, isOrder: candidate.platform === 'storefront' }
    );
    pushSent += Number(pushResult.sent || 0);
    pushFailed += Number(pushResult.failed || 0);
    if (pushResult.reason) pushIssues.add(pushResult.reason);
    added++;
  }

  return {
    handled: true,
    ok: true,
    storesChecked: storeIds.length,
    added,
    duplicates,
    notifications: { sent: pushSent, failed: pushFailed, issues: [...pushIssues] },
  };
}

async function handleSocialSyncInbox(req, res, profile, storeId) {
  void req;
  void profile;
  return res.status(200).json(await syncStoreInbox(storeId));
}

async function handleSocial(req, res) {
  const { profile, error } = await getAuthedProfile(req);
  if (error) return res.status(401).json({ error });
  const storeId = resolveSocialStore(req, profile);
  if (!storeId) return res.status(400).json({ error: 'Store is required.' });
  if (req.method === 'GET') {
    const op = String(req.query?.op || 'status').toLowerCase();
    if (op === 'status') return await handleSocialStatus(req, res, profile, storeId);
    if (op === 'inbox') return await handleSocialInbox(req, res, profile, storeId);
    if (op === 'posts') return await handleSocialPosts(req, res, profile, storeId);
    if (op === 'setup_check') return await handleSocialSetupCheck(req, res, profile, storeId);
    return res.status(400).json({ error: 'Unknown op. Use ?op=status | inbox | posts | setup_check' });
  }
  if (req.method === 'POST') {
    const op = String(req.body?.op || '').toLowerCase();
    if (op === 'disconnect') return await handleSocialDisconnect(req, res, profile, storeId);
    if (op === 'sync_accounts') return await handleSocialSyncAccounts(req, res, profile, storeId);
    if (op === 'sync_inbox') return await handleSocialSyncInbox(req, res, profile, storeId);
    if (op === 'publish') return await handleSocialPublish(req, res, profile, storeId, false);
    if (op === 'save_draft') return await handleSocialPublish(req, res, profile, storeId, true);
    if (op === 'reply') return await handleSocialReply(req, res, profile, storeId);
    if (op === 'read') return await handleSocialRead(req, res, profile, storeId);
    if (op === 'resolve') return await handleSocialResolve(req, res, profile, storeId);
    return res.status(400).json({ error: 'Unknown op. Use connect | oauth_pick | disconnect | sync_accounts | sync_inbox | publish | save_draft | reply | read | resolve | resolve' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

async function handleWhatsApp(req, res) {
  const { profile, error } = await getAuthedProfile(req);
  if (error) return res.status(401).json({ error });
  const op = String(req.query?.op || req.body?.op || '').toLowerCase();
  if (req.method !== 'POST' || !['pair', 'unlink'].includes(op)) {
    return res.status(405).json({ error: 'Method not allowed. Use POST op=pair | op=unlink' });
  }

  const resolved = await resolveWhatsAppStore(req, profile);
  if (resolved.error) return res.status(resolved.status).json({ error: resolved.error });
  const storeId = resolved.storeId;
  if (op === 'pair') return await handleWhatsAppPair(req, res, storeId);
  return await handleWhatsAppUnlink(req, res, storeId);
}

// Woyoyo-004: OAuth landing page. The platform sends the owner back here
// after they approve on the official authorization page. Single-step
// platforms (TikTok / Instagram / Threads) finish immediately; Facebook
// exchanges the code and returns the Page/channel picker to the pop-up.
// Woyoyo-004: signed upload URL// Woyoyo-004: signed upload URL for composer photos/videos. The browser PUTs
// the file bytes straight to Supabase storage, so TikTok-style videos never
// pass through the serverless function (which caps request bodies).
async function handlePostUploadUrl(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const { user, error } = await getAuthedProfile(req);
  if (error) return res.status(401).json({ error });
  const { fileName, contentType, kind } = req.body || {};
  const type = String(contentType || '').toLowerCase();
  const isVideo = kind === 'video' || ALLOWED_POST_VIDEO_TYPES.test(type);
  const isDocument = type === 'application/pdf' && kind === 'document';
  if (isVideo && !ALLOWED_POST_VIDEO_TYPES.test(type)) return res.status(400).json({ error: 'Please use an MP4, MOV or WebM video.' });
  if (!isVideo && !isDocument && !ALLOWED_POST_MEDIA_TYPES.test(type)) return res.status(400).json({ error: 'Please use a JPG, PNG, WebP, GIF or PDF file.' });
  const extension = isDocument ? 'pdf' : type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : type.includes('quicktime') ? 'mov' : type.includes('webm') ? 'webm' : isVideo ? 'mp4' : 'jpg';
  const path = `posts/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  let bucket = POST_MEDIA_BUCKET;
  let { data, error: signedError } = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
  if (signedError || !data?.signedUrl) {
    bucket = 'stoyangu-media';
    const fallback = await supabase.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
    if (fallback.data?.signedUrl) {
      data = fallback.data;
      signedError = null;
    }
  }
  if (signedError || !data?.signedUrl) {
    console.error('Post upload URL error:', signedError);
    return res.status(500).json({ error: 'Could not prepare that upload. Please try again.' });
  }
  const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(path);
  return res.status(200).json({ path, signedUrl: data.signedUrl, url: publicData.publicUrl, kind: isVideo ? 'video' : 'image' });
}

async function handleProfile(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const { user, error } = await getAuthedUser(req);
  if (error) return res.status(401).json({ error });
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
      if (req.method === 'GET') return await handleProfile(req, res);
      if (req.method === 'POST') return await handleUpload(req, res);
      return res.status(400).json({ error: 'Use ?action=profile or ?action=upload.' });
    }
    if (action === 'profile') return await handleProfile(req, res);
    if (action === 'upload') return await handleUpload(req, res);
    if (action === 'post-upload-url') return await handlePostUploadUrl(req, res);
    if (action === 'social') return await handleSocial(req, res);
    if (action === 'whatsapp') return await handleWhatsApp(req, res);
    if (action === 'whatsapp-inbox') return await (await import('./whatsapp-inbox.js')).handleWhatsAppInbox(req, res);
    return res.status(400).json({ error: 'Unknown action. Use ?action=profile | upload | post-upload-url | social | social-callback | whatsapp' });
  } catch (err) {
    console.error('Media API error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
