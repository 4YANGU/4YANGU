// lib/repliz.js
// =========================================================================
//  Repliz adapter — lets StoYangu stores connect TikTok, Facebook,
//  Instagram, YouTube and Threads, post once to all of them, and manage
//  every DM + comment from one inbox.
//
//  KEYS: set REPLIZ_ACCESS_KEY and REPLIZ_SECRET_KEY in the Vercel dashboard
//  (Settings > API on repliz.com). The aliases REPLIZ_API_KEY / REPLIZ_API_SECRET
//  and REPLIZ_KEY / REPLIZ_SECRET are also accepted.
//
//  MOCK MODE: when the keys are missing or look like dummy values
//  (mock/dummy/test/placeholder...), every function below returns null and
//  the API layer serves realistic demo data from Supabase instead. That is
//  how the preview deployment works with zero real credentials. On the
//  founder's Vercel — where the REAL keys are already configured — the same
//  code automatically talks to api.repliz.com with no code changes.
//
//  Auth follows the Repliz public API convention: Basic base64(access:secret)
//  plus X-Repliz-Access-Key / X-Repliz-Secret-Key headers, base URL
//  https://api.repliz.com (override with REPLIZ_BASE_URL).
// =========================================================================

const BASE_URL = (process.env.REPLIZ_BASE_URL || 'https://api.repliz.com').replace(/\/$/, '');
const ACCESS_KEY =
  process.env.REPLIZ_ACCESS_KEY || process.env.REPLIZ_API_KEY || process.env.REPLIZ_KEY || '';
const SECRET_KEY =
  process.env.REPLIZ_SECRET_KEY || process.env.REPLIZ_API_SECRET || process.env.REPLIZ_SECRET || '';

const LOOKS_FAKE = (value) =>
  !value || /mock|dummy|placeholder|example|test|changeme|your-|xxx|12345/i.test(String(value));

export function isMockRepliz() {
  return LOOKS_FAKE(ACCESS_KEY) || LOOKS_FAKE(SECRET_KEY);
}

export function replizStatus() {
  return { mockMode: isMockRepliz(), baseUrl: BASE_URL, hasKeys: Boolean(ACCESS_KEY && SECRET_KEY) };
}

async function call(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${ACCESS_KEY}:${SECRET_KEY}`).toString('base64')}`,
        'X-Repliz-Access-Key': ACCESS_KEY,
        'X-Repliz-Secret-Key': SECRET_KEY,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || `Repliz responded ${response.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function tryPaths(paths, options) {
  let lastError = null;
  for (const path of paths) {
    try {
      const data = await call(path, options);
      return { path, data };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Repliz request failed');
}

const pickList = (data, keys) => {
  if (Array.isArray(data)) return data;
  for (const key of keys) {
    const value = data?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') {
      for (const nested of keys) {
        if (Array.isArray(value[nested])) return value[nested];
      }
    }
  }
  return [];
};

// Connected social accounts in the Repliz workspace.
// Returns null in mock mode (caller falls back to Supabase rows).
export async function replizAccounts() {
  if (isMockRepliz()) return null;
  const { data } = await tryPaths(['/public/account/list', '/public/accounts', '/api/accounts', '/v1/accounts']);
  return pickList(data, ['accounts', 'data', 'items', 'results']).map((account) => ({
    platform: String(account.platform || account.provider || account.network || '').toLowerCase(),
    handle: String(account.username || account.handle || account.name || ''),
    display_name: String(account.display_name || account.name || ''),
    avatar_url: String(account.avatar || account.profile_picture || account.avatar_url || ''),
    repliz_account_id: String(account.id || account.account_id || ''),
    status: 'connected',
  }));
}

// Publish one post to several platforms at once. Returns null in mock mode.
export async function replizPublish({ caption, platforms, mediaUrls }) {
  if (isMockRepliz()) return null;
  const payload = {
    text: caption,
    caption,
    platforms,
    media_urls: mediaUrls,
    media: mediaUrls,
  };
  const { data } = await tryPaths(
    ['/public/post/create', '/public/posts', '/api/posts', '/v1/posts'],
    { method: 'POST', body: payload }
  );
  return { id: String(data?.id || data?.post_id || `rz-${Date.now()}`), raw: data };
}

// Pending comments + open DM chats. Returns null in mock mode.
export async function replizInbox() {
  if (isMockRepliz()) return null;
  const [comments, chats] = await Promise.all([
    tryPaths(['/public/comment/list?status=pending', '/public/comments', '/api/comments'])
      .then((result) => pickList(result.data, ['comments', 'data', 'items']))
      .catch(() => []),
    tryPaths(['/public/chat/list', '/public/chats', '/api/chats'])
      .then((result) => pickList(result.data, ['chats', 'conversations', 'data', 'items']))
      .catch(() => []),
  ]);
  return { comments, chats };
}

// Reply to a DM conversation or a comment. Returns null in mock mode.
export async function replizReply({ platform, conversationId, body }) {
  if (isMockRepliz()) return null;
  const payload = {
    text: body,
    message: body,
    platform,
    conversation_id: conversationId,
  };
  const { data } = await tryPaths(
    ['/public/message/send', '/public/comment/reply', '/api/messages'],
    { method: 'POST', body: payload }
  );
  return { id: String(data?.id || data?.message_id || `rzm-${Date.now()}`) };
}
