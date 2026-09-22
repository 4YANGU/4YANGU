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
//                    seed_demo })
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
import { REPLIZ_LABELS, REPLIZ_PLATFORMS, REPLIZ_SINGLE_STEP, REPLIZ_TWO_STEP, extractOAuthCode, normalizePublishMedia, normalizeReplizChat, normalizeReplizChatMessage, normalizeReplizComment, replizAuthorizeUrl, replizCallbackUrl, replizConnectOAuth, replizConnectUrl, replizExchangeCode, replizFetchChatMessages, replizFetchInbox, replizGetAccount, replizKeys, replizListOAuthChoices, replizMarkChatRead, replizMode, replizPublish, replizSendReply, replizUpdateCommentStatus, replizWorkspaceAccounts } from '../lib/repliz.js';

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
    supabase.from('social_connections').select('*').eq('store_id', storeId).order('platform', { ascending: true }),
    supabase.from('social_messages').select('platform').eq('store_id', storeId).eq('direction', 'in').eq('is_read', false),
  ]);
  if (connError) throw connError;
  if (unreadError) throw unreadError;
  const byPlatform = {};
  for (const row of unread || []) byPlatform[row.platform] = (byPlatform[row.platform] || 0) + 1;
  return res.status(200).json({ connections: connections || [], unread: { total: (unread || []).length, by_platform: byPlatform } });
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
  return res.status(200).json({ posts: data || [] });
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
  if (replizMode() !== 'live') return res.status(200).json({ connections: existing || [], synced: 0 });
  let synced = 0;
  for (const row of existing || []) {
    if (!row.account_id || row.connection_status !== 'connected') continue;
    const account = await replizGetAccount(row.account_id);
    if (account.platform !== row.platform) continue;
    await upsertConnection(storeId, row.platform, account, 'connected'); synced++;
  }
  const { data: connections, error: readError } = await supabase.from('social_connections').select('*').eq('store_id', storeId).order('platform');
  if (readError) throw readError;
  return res.status(200).json({ connections, synced });
}

// Woyoyo-004: pick the Page// Woyoyo-004: pick the Page (Facebook) or channel (YouTube) that completes a
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
  const platforms = (connections || []).map((c) => String(c.platform).toLowerCase()).filter((p) => REPLIZ_PLATFORMS.includes(p));
  if (!platforms.length && !asDraft) return res.status(400).json({ error: 'Connect at least one account first — open the Inbox tab and tap Accounts.' });
  let results = {};
  if (!asDraft) {
    if (mode !== 'live') return res.status(503).json({ error: 'Publishing is not configured. Your product is saved; add the Repliz credentials to publish.' });
    {
      for (const platform of platforms) {
        const connection = (connections || []).find((c) => c.platform === platform);
        try {
          const posted = await replizPublish({ platform, accountId: connection?.account_id, caption, mediaUrls, mediaKinds, title });
          results[platform] = { ok: true, mode: 'live', external_id: String(posted?.scheduleId || posted?.id || posted?.external_id || posted?.post_id || ''), posted_at: new Date().toISOString() };
        } catch (publishError) {
          results[platform] = { ok: false, mode: 'live', error: publishError instanceof Error ? publishError.message : 'Publish failed.' };
        }
      }
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
  return res.status(201).json({ post: data, mode, results });
}

async function handleSocialReply(req, res, profile, storeId) {
  if (replizMode() !== 'live') return res.status(503).json({ error: 'Repliz is not configured. Your reply was not sent.' });
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
      await replizSendReply({ platform: head.platform, accountId: connection?.account_id, threadKey, externalId: head.external_id, body, kind: head.kind });
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
async function handleSocialSyncInbox(req, res, profile, storeId) {
  if (replizMode() !== 'live') return res.status(200).json({ ok: true, mode: 'unconfigured', added: 0 });
  const { data: connections } = await supabase.from('social_connections').select('*').eq('store_id', storeId);
  const { data: store } = await supabase.from('stores').select('name').eq('id', storeId).single();
  const storeName = store?.name || 'Store';
  const { data: known } = await supabase
    .from('social_messages')
    .select('external_id,thread_key,body,created_at')
    .eq('store_id', storeId)
    .order('created_at', { ascending: false })
    .limit(500);
  const seenExternal = new Set((known || []).map((row) => row.external_id).filter(Boolean));
  const seenCombo = new Set((known || []).map((row) => `${row.thread_key}::${row.body}::${row.created_at}`));
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
  }
  if (fresh.length) {
    const attempt = await supabase.from('social_messages').insert(fresh);
    if (attempt.error) {
      if (/post_ref|post_title|post_url|sender_avatar/.test(attempt.error.message || '')) {
        const legacy = fresh.map(({ post_ref, post_title, post_url, sender_avatar, ...rest }) => rest); // eslint-disable-line @typescript-eslint/no-unused-vars
        const retry = await supabase.from('social_messages').insert(legacy);
        if (retry.error) throw retry.error;
      } else {
        throw attempt.error;
      }
    }
  }
  return res.status(200).json({ ok: true, mode: 'live', added: fresh.length, errors });
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
    return res.status(400).json({ error: 'Unknown op. Use connect | oauth_pick | disconnect | sync_accounts | sync_inbox | publish | save_draft | reply | read | resolve | seed_demo' });
  }
  return res.status(405).json({ error: 'Method not allowed' });
}

// Woyoyo-004: OAuth landing page. The platform sends the owner back here
// after they approve on the official authorization page. Single-step
// platforms (TikTok / Instagram / Threads) finish immediately; two-step
// platforms (Facebook / YouTube) exchange the code and return the Page /
// channel picker to the pop-up, which posts the result back to the inbox.
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
  if (isVideo && !ALLOWED_POST_VIDEO_TYPES.test(type)) return res.status(400).json({ error: 'Please use an MP4, MOV or WebM video.' });
  if (!isVideo && !ALLOWED_POST_MEDIA_TYPES.test(type)) return res.status(400).json({ error: 'Please use a JPG, PNG, WebP or GIF photo.' });
  const extension = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('gif') ? 'gif' : type.includes('quicktime') ? 'mov' : type.includes('webm') ? 'webm' : isVideo ? 'mp4' : 'jpg';
  const path = `posts/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
  const { data, error: signedError } = await supabase.storage.from(POST_MEDIA_BUCKET).createSignedUploadUrl(path);
  if (signedError || !data?.signedUrl) {
    console.error('Post upload URL error:', signedError);
    return res.status(500).json({ error: 'Could not prepare that upload. Please try again.' });
  }
  const { data: publicData } = supabase.storage.from(POST_MEDIA_BUCKET).getPublicUrl(path);
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
    return res.status(400).json({ error: 'Unknown action. Use ?action=profile | upload | post-upload-url | social | social-callback' });
  } catch (err) {
    console.error('Media API error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal error' });
  }
}
