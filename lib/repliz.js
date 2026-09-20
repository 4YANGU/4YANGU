// =========================================================================
//  Repliz adapter — TikTok, Facebook, Instagram, YouTube, Threads
//
//  StoYangu talks to social platforms ONLY through this file, using the
//  public Repliz API (https://api.repliz.com). Repliz is the approved
//  developer app on Meta, TikTok, YouTube and Threads; StoYangu purchases
//  platform access from them.
//
//  AUTH: Repliz Access Key + Secret Key, set in Vercel as
//    REPLIZ_ACCESS_KEY + REPLIZ_SECRET_KEY
//  (aliases REPLIZ_API_KEY / REPLIZ_API_SECRET also work). Requests are
//  authenticated as HTTP Basic base64(access:secret), with the
//  X-Repliz-Access-Key / X-Repliz-Secret-Key headers as a fallback.
//
//  CONNECT (official OAuth, opened from the inbox Accounts pop-up):
//    1. GET /public/account/<platform>/authorize?redirect=<callback>
//       → returns { url } — the official platform authorization page.
//    2. The owner approves there; the platform sends them back to our
//       callback (/api/media?action=social-callback&state=...&code=...).
//    3a. TikTok / Instagram / Threads: POST
//        /public/account/<platform>/connect { code } → { accountId }.
//    3b. Facebook / YouTube: POST /public/account/<platform>/exchange
//        { code } → { token }; then the owner picks a Page / channel and
//        we POST /public/account/<platform>/connect { pageId|channelId,
//        token } → { accountId }. Reconnecting an existing account posts to
//        .../connect/<accountId> instead.
//
//  PUBLISH: scheduled-post API — POST /public/schedule with
//    { accountId, type, description, medias, meta, additionalInfo,
//      replies, scheduleAt }. "Post now" schedules ~60 seconds out, which is
//    the closest the public API offers to immediate publishing.
//
//  INBOX: GET /public/comment (comments) + GET /public/chat (DMs),
//    GET /public/chat/<chatId>/message (thread history),
//    POST /public/comment/<commentId> { text } (public reply),
//    POST /public/chat/<chatId>/message { type:'text', text } (DM reply),
//    POST /public/chat/<chatId>/read, PUT /public/comment/<commentId>/status.
//
//  MODES:
//    live — keys present. OAuth, publishing, replies and inbox sync all hit
//           the real Repliz API.
//    mock — no (or dummy) keys. Local demo data so the whole flow can be
//           tested end to end with zero setup.
//
//  If Repliz renames a path, only this file changes — callers stay untouched.
// =========================================================================

export const REPLIZ_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube', 'threads'];

// OAuth shape per platform: single-step connects with the code directly,
// two-step exchanges the code for a token and then needs a Page/channel pick.
export const REPLIZ_SINGLE_STEP = ['tiktok', 'instagram', 'threads'];
export const REPLIZ_TWO_STEP = ['facebook', 'youtube'];

export const REPLIZ_LABELS = {
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  threads: 'Threads',
};

export function replizKeys() {
  const access = process.env.REPLIZ_ACCESS_KEY || process.env.REPLIZ_API_KEY || '';
  const secret = process.env.REPLIZ_SECRET_KEY || process.env.REPLIZ_API_SECRET || '';
  return { access: String(access).trim(), secret: String(secret).trim() };
}

export function replizMode() {
  const { access, secret } = replizKeys();
  if (!access || !secret) return 'mock';
  if (/^(dummy|test|mock|changeme|xxx)/i.test(access)) return 'mock';
  return 'live';
}

function replizBase() {
  return String(process.env.REPLIZ_API_BASE_URL || process.env.REPLIZ_BASE_URL || 'https://api.repliz.com').replace(/\/$/, '');
}

async function replizRequest(path, { method = 'GET', query, body, timeoutMs = 25000 } = {}) {
  const { access, secret } = replizKeys();
  if (!access || !secret) throw new Error('Repliz access and secret keys are not configured.');
  const url = new URL(`${replizBase()}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item === undefined || item === null || item === '') continue;
          url.searchParams.append(key, String(item));
        }
      } else {
        url.searchParams.append(key, String(value));
      }
    }
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Basic ${Buffer.from(`${access}:${secret}`).toString('base64')}`,
        'X-Repliz-Access-Key': access,
        'X-Repliz-Secret-Key': secret,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let data = {};
    if (text) {
      try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 300) }; }
    }
    if (!response.ok) {
      const message = (data && (data.message || data.error)) || `Repliz request failed (${response.status}).`;
      throw new Error(typeof message === 'string' ? message.slice(0, 300) : JSON.stringify(message).slice(0, 300));
    }
    return data || {};
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Repliz took too long to respond. Please try again.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeReplizPlatform(value) {
  const v = String(value || '').toLowerCase();
  if (['tiktok', 'tt'].includes(v)) return 'tiktok';
  if (['facebook', 'fb'].includes(v)) return 'facebook';
  if (['instagram', 'ig'].includes(v)) return 'instagram';
  if (['youtube', 'yt'].includes(v)) return 'youtube';
  if (['threads'].includes(v)) return 'threads';
  return '';
}

export function normalizeWorkspaceAccount(raw) {
  const account = raw || {};
  const username = String(account.username || account.handle || '').replace(/^@/, '');
  return {
    id: String(account.id || account._id || account.account_id || account.accountId || ''),
    platform: normalizeReplizPlatform(account.type || account.platform || account.network || account.provider),
    handle: username ? `@${username}` : String(account.name || account.display_name || ''),
    display_name: String(account.name || account.display_name || username || ''),
    avatar_url: String(account.picture || account.avatar_url || account.profile_picture || ''),
  };
}

// Workspace accounts listing → normalized accounts:
// [{ id, platform, handle, display_name, avatar_url }].
export async function replizWorkspaceAccounts({ platform } = {}) {
  const data = await replizRequest('/public/account', {
    query: { page: 1, limit: 100, types: platform ? [platform] : undefined },
  });
  const list = Array.isArray(data) ? data : data.docs || data.accounts || data.data || [];
  return (list || []).map(normalizeWorkspaceAccount).filter((account) => account.id && account.platform);
}

export async function replizGetAccount(accountId) {
  const data = await replizRequest(`/public/account/${encodeURIComponent(accountId)}`);
  return normalizeWorkspaceAccount(data?.account || data?.data || data);
}

// Where the owner lands after approving on the platform's official page.
export function replizCallbackUrl(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  const scheme = host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
  return `${scheme}://${host}/api/media?action=social-callback`;
}

// Step 1 of connecting: the official platform authorization URL.
export async function replizAuthorizeUrl({ platform, redirect }) {
  const data = await replizRequest(`/public/account/${platform}/authorize`, { query: { redirect } });
  const url = data?.url || data?.authorize_url || data?.authorization_url || data?.data?.url;
  if (!url || typeof url !== 'string') throw new Error('Repliz did not return an authorization link. Please try again.');
  return url;
}

export function extractOAuthCode(url) {
  try {
    return new URL(String(url), 'https://callback.invalid').searchParams.get('code') || '';
  } catch {
    return '';
  }
}

// Step 2 (Facebook / YouTube only): trade the code for a user token.
export async function replizExchangeCode({ platform, code }) {
  const data = await replizRequest(`/public/account/${platform}/exchange`, { method: 'POST', body: { code } });
  const token = data?.token || data?.access_token || data?.data?.token;
  if (!token) throw new Error('Repliz did not return an access token. Please try again.');
  return String(token);
}

// Step 3 (Facebook / YouTube only): Pages / channels behind that token.
export async function replizListOAuthChoices({ platform, token }) {
  const leaf = platform === 'facebook' ? 'page' : platform === 'youtube' ? 'channel' : 'organization';
  const data = await replizRequest(`/public/account/${platform}/${leaf}`, { query: { token } });
  const docs = data?.docs || data?.data || data?.pages || data?.channels || data?.organizations || [];
  return (docs || []).map((entry) => ({
    id: String(entry.id || entry._id || entry.pageId || entry.channelId || ''),
    name: String(entry.name || entry.title || entry.username || 'Account'),
    username: String(entry.username || ''),
    picture: String(entry.picture || entry.thumbnail || entry.avatar || ''),
    token: String(entry.token || ''),
  })).filter((entry) => entry.id);
}

// Final step: bind the platform account into the Repliz workspace.
// Single-step platforms pass { code }; two-step platforms pass
// { token, selectionId }. Passing accountId reconnects that account.
export async function replizConnectOAuth({ platform, code, token, selectionId, accountId }) {
  const idPart = accountId ? `/${encodeURIComponent(accountId)}` : '';
  let payload;
  if (platform === 'facebook') payload = { pageId: selectionId, token };
  else if (platform === 'youtube') payload = { channelId: selectionId, token };
  else payload = { code };
  const data = await replizRequest(`/public/account/${platform}/connect${idPart}`, { method: 'POST', body: payload });
  const newId = String(data?.accountId || data?.account_id || data?.id || data?._id || (data?.account || {}).id || '');
  let account = null;
  if (newId) {
    try { account = await replizGetAccount(newId); } catch { account = null; }
  }
  return { accountId: newId, account };
}

// Fallback link for the rare case the owner must finish inside Repliz itself.
export function replizConnectUrl() {
  return 'https://repliz.com/';
}

// ---------------------------------------------------------------------------
// Publishing (scheduled-post API)
// ---------------------------------------------------------------------------

function looksLikeVideo(url) {
  return /\.(mp4|mov|m4v|webm|3gp)(\?|#|$)/i.test(String(url || '')) || String(url || '').includes('/video/');
}

// mediaUrls: string[] (legacy) — mediaKinds: parallel ('image'|'video') array.
// Returns [{ type: 'image'|'video', url }].
export function normalizePublishMedia(mediaUrls, mediaKinds) {
  const urls = Array.isArray(mediaUrls) ? mediaUrls : [];
  const kinds = Array.isArray(mediaKinds) ? mediaKinds : [];
  return urls
    .map((url, index) => String(url || '').slice(0, 1000))
    .filter(Boolean)
    .slice(0, 10)
    .map((url, index) => ({
      type: kinds[index] === 'video' || kinds[index] === 'image'
        ? kinds[index]
        : looksLikeVideo(url) ? 'video' : 'image',
      url,
    }));
}

function pickScheduleType(medias) {
  if (!medias.length) return 'text';
  if (medias.length === 1) return medias[0].type;
  if (medias.every((item) => item.type === 'image')) return 'album';
  return 'video';
}

export function buildSchedulePayload({ accountId, type, description, title, medias, scheduleAt }) {
  const ordered = type === 'video'
    ? [...medias].sort((a, b) => (a.type === 'video' ? -1 : 1) - (b.type === 'video' ? -1 : 1))
    : medias;
  return {
    title: String(title || '').slice(0, 120),
    description: String(description || ''),
    topic: '',
    type,
    medias: ordered.map((item) => ({ type: item.type, url: item.url })),
    meta: { title: '', description: '', url: '' },
    additionalInfo: {
      isAiGenerated: false,
      isDraft: false,
      isAutoAddMusic: false,
      isShareToFeed: false,
      collaborators: [],
      music: { id: '', artist: '', name: '', thumbnail: '', volume: { video: 50, music: 100 } },
      products: [],
      tags: [],
      mentions: [],
      targetCountries: [],
    },
    replies: [],
    scheduleAt,
    accountId,
  };
}

export async function replizPublish({ platform, accountId, caption, mediaUrls, mediaKinds, title }) {
  const medias = normalizePublishMedia(mediaUrls, mediaKinds);
  const payload = buildSchedulePayload({
    accountId,
    type: pickScheduleType(medias),
    description: String(caption || ''),
    title: title || String(caption || '').slice(0, 60),
    medias,
    // "Post now" = scheduled ~60s out: the closest the public API offers
    // to immediate publishing. Repliz delivers it within about a minute.
    scheduleAt: new Date(Date.now() + 60000).toISOString(),
  });
  return replizRequest('/public/schedule', { method: 'POST', body: payload });
}

// ---------------------------------------------------------------------------
// Replies
// ---------------------------------------------------------------------------

export async function replizSendReply({ platform, accountId, threadKey, externalId, body, kind }) {
  if (kind === 'comment') {
    if (!externalId) throw new Error('That comment is missing its platform reference, so the reply cannot be delivered.');
    return replizRequest(`/public/comment/${encodeURIComponent(externalId)}`, { method: 'POST', body: { text: body } });
  }
  const chatId = String(threadKey || '').startsWith('chat:') ? String(threadKey).slice(5) : (externalId || threadKey);
  if (!chatId) throw new Error('That conversation is missing its platform reference, so the reply cannot be delivered.');
  return replizRequest(`/public/chat/${encodeURIComponent(chatId)}/message`, { method: 'POST', body: { type: 'text', text: body } });
}

export async function replizMarkChatRead(chatId) {
  if (!chatId) return;
  return replizRequest(`/public/chat/${encodeURIComponent(chatId)}/read`, { method: 'POST' });
}

export async function replizUpdateCommentStatus(commentId, resolved) {
  if (!commentId) return;
  return replizRequest(`/public/comment/${encodeURIComponent(commentId)}/status`, {
    method: 'PUT',
    body: { status: resolved ? 'resolved' : 'pending' },
  });
}

// ---------------------------------------------------------------------------
// Inbox sync (comments + chats)
// ---------------------------------------------------------------------------

export async function replizFetchInbox({ accountId, platform }) {
  const query = { page: 1, limit: 50 };
  if (accountId) query.accountIds = [accountId];
  const [comments, chats] = await Promise.all([
    replizRequest('/public/comment', { query }).catch(() => ({})),
    replizRequest('/public/chat', { query }).catch(() => ({})),
  ]);
  return { comments, chats };
}

export async function replizFetchChatMessages(chatId, limit = 20) {
  const data = await replizRequest(`/public/chat/${encodeURIComponent(chatId)}/message`, { query: { page: 1, limit } });
  return data?.docs || data?.messages || data?.data || [];
}

export function normalizeReplizComment(doc, platformFallback = '') {
  const content = doc.content || {};
  const sender = doc.sender || doc.user || doc.from || doc.commenter || {};
  const platform = normalizeReplizPlatform((doc.account || {}).type || doc.platform || doc.type) || platformFallback;
  const postId = String(content.id || content.contentId || doc.contentId || doc.postId || '');
  const senderName = String(sender.name || sender.username || doc.senderName || 'Follower');
  const username = String(sender.username || '').replace(/^@/, '');
  return {
    external_id: String(doc._id || doc.id || doc.commentId || ''),
    platform,
    sender_name: senderName,
    sender_handle: username ? `@${username}` : (doc.senderHandle || null),
    sender_avatar: String(sender.picture || sender.avatar || '') || null,
    body: String(doc.text || doc.message || doc.body || doc.comment || ''),
    created_at: doc.createdAt || doc.created_at || new Date().toISOString(),
    status: String(doc.status || 'pending'),
    post_ref: postId,
    post_title: String(content.title || content.description || '').slice(0, 140),
    post_url: String(content.url || content.link || ''),
    thread_key: `${platform || 'unknown'}:comment:${postId || doc._id || doc.id || 'thread'}`,
  };
}

export function normalizeReplizChat(doc, platformFallback = '') {
  const last = doc.lastMessage || doc.last_message || {};
  const account = doc.account || {};
  const platform = normalizeReplizPlatform(account.type || doc.platform) || platformFallback;
  const chatId = String(doc._id || doc.id || doc.chatId || '');
  const sender = doc.sender || {};
  return {
    chat_id: chatId,
    account_id: String(doc.accountId || account._id || account.id || ''),
    external_id: String(last.messageId || last._id || last.id || `${chatId}:last`),
    platform,
    sender_name: String(doc.senderName || doc.sender_name || sender.name || 'Follower'),
    sender_handle: null,
    sender_avatar: String(doc.senderPicture || sender.picture || '') || null,
    body: String(last.text || last.message || last.body || ''),
    created_at: last.sendAt || last.fromSenderAt || doc.updatedAt || new Date().toISOString(),
    direction: last.isFromMe ? 'out' : 'in',
    unread: Number(doc.unreadCount || doc.unread_count || 0),
    thread_key: `chat:${chatId}`,
  };
}

export function normalizeReplizChatMessage(doc, chatId, platformFallback = '', threadKey = '') {
  return {
    external_id: String(doc.messageId || doc._id || doc.id || ''),
    platform: platformFallback,
    sender_name: doc.isFromMe ? '' : String(doc.senderName || doc.sender_name || 'Follower'),
    sender_handle: null,
    sender_avatar: null,
    body: String(doc.text || doc.message || doc.body || ''),
    created_at: doc.sendAt || doc.fromSenderAt || doc.createdAt || new Date().toISOString(),
    direction: doc.isFromMe ? 'out' : 'in',
    thread_key: threadKey || `chat:${chatId}`,
  };
}

// Mock result set for a post-once-to-all publish in demo mode.
export function mockPublishResults(platforms) {
  const now = new Date().toISOString();
  const results = {};
  for (const platform of platforms || []) {
    results[platform] = {
      ok: true,
      mode: 'mock',
      external_id: `mock_${platform}_${Date.now().toString(36)}`,
      posted_at: now,
    };
  }
  return results;
}

// Demo inbox content so the Inbox tab is testable with zero setup.
// Returns rows ready for the social_messages table (store_id included).
// Comment rows carry the original video/post they came from (post_ref,
// post_title, post_url) so the conversation header can show its source.
export function mockSeedThreads(storeId, storeName) {
  const slug = String(storeName || 'mystore').toLowerCase().replace(/[^a-z0-9]+/g, '') || 'mystore';
  const T = (overrides) => ({
    store_id: storeId,
    platform: 'tiktok',
    kind: 'dm',
    thread_key: 'demo',
    sender_name: 'Demo customer',
    sender_handle: null,
    body: '',
    direction: 'in',
    is_read: false,
    is_resolved: false,
    external_id: null,
    post_ref: '',
    post_title: '',
    post_url: '',
    ...overrides,
  });
  return [
    T({ platform: 'tiktok', kind: 'dm', thread_key: 'tiktok:dm:wanjiru', sender_name: 'Wanjiru K.', sender_handle: '@wanjiru.ke', body: 'Hi! Is the Stevo Home Jersey still available in size L?', created_at: '2026-09-20T07:42:00+03:00' }),
    T({ platform: 'tiktok', kind: 'dm', thread_key: 'tiktok:dm:wanjiru', sender_name: 'Wanjiru K.', sender_handle: '@wanjiru.ke', body: 'Na mna deliver Tao?', created_at: '2026-09-20T07:43:00+03:00' }),
    T({ platform: 'tiktok', kind: 'comment', thread_key: 'tiktok:comment:video-991', sender_name: 'Sharon W.', sender_handle: '@sharon.w', body: 'Bei ya jersey??', post_ref: 'video-991', post_title: 'Stevo Home Jersey — new arrival video', post_url: `https://www.tiktok.com/@${slug}/video/991`, created_at: '2026-09-20T06:15:00+03:00' }),
    T({ platform: 'instagram', kind: 'comment', thread_key: 'instagram:comment:post-8841', sender_name: 'Brian O.', sender_handle: '@brian.otieno', body: 'How much is the polo??', post_ref: 'post-8841', post_title: 'Stevo Polo — restock post', post_url: 'https://www.instagram.com/p/8841', created_at: '2026-09-19T21:15:00+03:00' }),
    T({ platform: 'facebook', kind: 'dm', thread_key: 'facebook:dm:aisha', sender_name: 'Aisha M.', sender_handle: '@aisha.m', body: 'Hello, do you have the hoodie in black?', is_read: true, created_at: '2026-09-19T16:02:00+03:00' }),
    T({ platform: 'facebook', kind: 'dm', thread_key: 'facebook:dm:aisha', sender_name: storeName, sender_handle: null, body: 'Hi Aisha! Yes, the Kito Fleece Hoodie is available in black — S to XL. Want me to reserve one for you?', direction: 'out', is_read: true, external_id: 'mock_out_seed_1', created_at: '2026-09-19T16:20:00+03:00' }),
    T({ platform: 'facebook', kind: 'dm', thread_key: 'facebook:dm:aisha', sender_name: 'Aisha M.', sender_handle: '@aisha.m', body: 'Yes please! Nitapitia shop kesho.', created_at: '2026-09-19T16:25:00+03:00' }),
    T({ platform: 'youtube', kind: 'comment', thread_key: 'youtube:comment:video-x12', sender_name: 'Kevin K.', sender_handle: '@kevink', body: 'Hii perfume ni original? Lasting how long?', post_ref: 'video-x12', post_title: 'Kito Perfume — honest review', post_url: 'https://www.youtube.com/watch?v=x12', created_at: '2026-09-18T12:30:00+03:00' }),
    T({ platform: 'threads', kind: 'comment', thread_key: 'threads:reply:post-552', sender_name: 'Zawadi N.', sender_handle: '@zawadi.n', body: 'Hii dress iko in size M?', is_read: true, is_resolved: true, post_ref: 'post-552', post_title: 'Lily Dress launch thread', post_url: 'https://www.threads.net/post/552', created_at: '2026-09-18T09:10:00+03:00' }),
    T({ platform: 'threads', kind: 'comment', thread_key: 'threads:reply:post-552', sender_name: storeName, sender_handle: null, body: 'Hi Zawadi! Yes — M in stock. Order here and we deliver countrywide.', direction: 'out', is_read: true, is_resolved: true, external_id: 'mock_out_seed_2', post_ref: 'post-552', post_title: 'Lily Dress launch thread', post_url: 'https://www.threads.net/post/552', created_at: '2026-09-18T09:40:00+03:00' }),
  ];
}
