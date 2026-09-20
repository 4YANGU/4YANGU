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
//  MODES:
//    live — keys present. Connecting binds the store to the REAL Repliz-side
//           account (handle + account id pulled from the Repliz API — never
//           a typed username). Publishing, replies and inbox sync go to the
//           real Repliz API.
//    mock — no (or dummy) keys. Local demo data so the whole flow can be
//           tested end to end with zero setup.
//
//  ADAPTER-VERIFY: endpoint paths below follow the public Repliz API
//  surface (accounts / posts / comments / chats). If Repliz renames a path,
//  only this file changes — callers stay untouched.
// =========================================================================

export const REPLIZ_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube', 'threads'];

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

async function replizRequest(path, { method = 'GET', body, timeoutMs = 25000 } = {}) {
  const { access, secret } = replizKeys();
  if (!access || !secret) throw new Error('Repliz access and secret keys are not configured.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${replizBase()}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${access}:${secret}`).toString('base64')}`,
        'X-Repliz-Access-Key': access,
        'X-Repliz-Secret-Key': secret,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error || data.message || `Repliz request failed (${response.status}).`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
    }
    return data;
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

// ADAPTER-VERIFY: workspace accounts listing. Returns normalized accounts:
// [{ id, platform, handle, display_name, avatar_url }].
export async function replizWorkspaceAccounts() {
  const data = await replizRequest('/v1/accounts');
  const list = Array.isArray(data) ? data : data.accounts || data.data || [];
  return (list || [])
    .map((account) => ({
      id: String(account.id || account.account_id || account.repliz_account_id || ''),
      platform: normalizeReplizPlatform(account.platform || account.network || account.provider),
      handle: String(account.handle || account.username || account.display_name || account.name || ''),
      display_name: String(account.display_name || account.name || ''),
      avatar_url: String(account.avatar_url || account.profile_picture || ''),
    }))
    .filter((account) => account.id && account.platform);
}

// Where the owner completes a platform connection when the Repliz workspace
// has none yet. Repliz owns the platform OAuth, so the actual authorization
// always happens inside Repliz; StoYangu then binds the new account.
export function replizConnectUrl() {
  return 'https://repliz.com/';
}

// ADAPTER-VERIFY: publish endpoint + payload shape.
// Expected to resolve to an object containing the posted id.
export async function replizPublish({ platform, accountId, caption, mediaUrls }) {
  const payload = {
    account_id: accountId,
    platform,
    text: caption,
    caption,
    media_urls: mediaUrls || [],
    media: (mediaUrls || []).map((url) => ({ url })),
  };
  return replizRequest('/v1/posts', { method: 'POST', body: payload });
}

// ADAPTER-VERIFY: reply endpoints (comment replies and DM sends differ).
// Falls back to a unified reply path if the split paths are unavailable.
export async function replizSendReply({ platform, accountId, threadKey, externalId, body, kind }) {
  const payload = {
    account_id: accountId,
    platform,
    thread_key: threadKey,
    conversation_id: threadKey,
    comment_id: externalId || undefined,
    text: body,
    message: body,
  };
  const path = kind === 'comment' ? '/v1/comments/reply' : '/v1/chats/send';
  try {
    return await replizRequest(path, { method: 'POST', body: payload });
  } catch (err) {
    if (/404|not found/i.test(err instanceof Error ? err.message : String(err))) {
      return replizRequest('/v1/reply', { method: 'POST', body: payload });
    }
    throw err;
  }
}

// ADAPTER-VERIFY: inbox sync (comments + chats). Reserved for the live
// background sync (cron) step.
export async function replizFetchInbox({ accountId, platform }) {
  const qs = `?account_id=${encodeURIComponent(accountId || '')}&platform=${encodeURIComponent(platform || '')}`;
  const [comments, chats] = await Promise.all([
    replizRequest(`/v1/comments${qs}`).catch(() => ({})),
    replizRequest(`/v1/chats${qs}`).catch(() => ({})),
  ]);
  return { comments, chats };
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
