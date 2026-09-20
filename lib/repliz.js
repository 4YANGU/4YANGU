// =========================================================================
//  Repliz adapter — TikTok, Facebook, Instagram, YouTube, Threads
//
//  StoYangu talks to social platforms ONLY through this file, using the
//  Repliz developer API (Repliz is the approved developer app on Meta,
//  TikTok, YouTube and Threads; StoYangu purchases platform access from them).
//
//  MODES:
//    mock (default) — no keys needed. Connect, post-once-to-all, inbox and
//                     replies all run against local demo data so the whole
//                     flow can be tested end to end.
//    live           — set REPLIZ_API_KEY (and optionally REPLIZ_API_BASE_URL)
//                     in Vercel. Publishing and replies are sent to Repliz.
//
//  IMPORTANT: the Repliz API reference PDF was not attached to this build,
//  so every live HTTP call lives in replizRequest()/replizPublish()/
//  replizSendReply()/replizFetchInbox() below, each marked ADAPTER — verify
//  the path, method and payload against the PDF (mapping table + checklist
//  in REPLIZ-SETUP.md) before going live. The mock mode needs no changes.
// =========================================================================

export const REPLIZ_PLATFORMS = ['tiktok', 'facebook', 'instagram', 'youtube', 'threads'];

export const REPLIZ_LABELS = {
  tiktok: 'TikTok',
  facebook: 'Facebook',
  instagram: 'Instagram',
  youtube: 'YouTube',
  threads: 'Threads',
};

export function replizMode() {
  return process.env.REPLIZ_API_KEY ? 'live' : 'mock';
}

function replizBase() {
  return String(process.env.REPLIZ_API_BASE_URL || 'https://api.repliz.com').replace(/\/$/, '');
}

// ADAPTER: verify base URL, auth scheme (header vs query), path style and
// error payload against the Repliz API reference PDF.
async function replizRequest(path, { method = 'GET', body } = {}) {
  const apiKey = process.env.REPLIZ_API_KEY;
  if (!apiKey) throw new Error('Repliz API key is not configured.');
  const response = await fetch(`${replizBase()}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `Repliz request failed (${response.status}).`);
  return data;
}

// ADAPTER: confirm the publish endpoint + per-platform payload (text field
// name, media array shape, account identifier) in the Repliz reference.
// Expected to resolve to an object containing the posted id.
export async function replizPublish({ platform, accountId, caption, mediaUrls }) {
  return replizRequest('/v1/publish', {
    method: 'POST',
    body: { platform, account_id: accountId, text: caption, media_urls: mediaUrls || [] },
  });
}

// ADAPTER: confirm the reply endpoint (DM vs comment reply paths may differ
// per platform) in the Repliz reference.
export async function replizSendReply({ platform, accountId, threadKey, body }) {
  return replizRequest('/v1/reply', {
    method: 'POST',
    body: { platform, account_id: accountId, thread_key: threadKey, text: body },
  });
}

// ADAPTER: confirm the inbox sync endpoint + polling/webhook model in the
// Repliz reference. Reserved for the live background sync (cron) step.
export async function replizFetchInbox({ platform, accountId }) {
  return replizRequest(`/v1/inbox?platform=${encodeURIComponent(platform)}&account_id=${encodeURIComponent(accountId || '')}`);
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
export function mockSeedThreads(storeId, storeName) {
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
    ...overrides,
  });
  return [
    T({ platform: 'tiktok', kind: 'dm', thread_key: 'tiktok:dm:wanjiru', sender_name: 'Wanjiru K.', sender_handle: '@wanjiru.ke', body: 'Hi! Is the Stevo Home Jersey still available in size L?', created_at: '2026-09-20T07:42:00+03:00' }),
    T({ platform: 'tiktok', kind: 'dm', thread_key: 'tiktok:dm:wanjiru', sender_name: 'Wanjiru K.', sender_handle: '@wanjiru.ke', body: 'Na mna deliver Tao?', created_at: '2026-09-20T07:43:00+03:00' }),
    T({ platform: 'tiktok', kind: 'comment', thread_key: 'tiktok:comment:video-991', sender_name: 'Sharon W.', sender_handle: '@sharon.w', body: 'Bei ya jersey??', created_at: '2026-09-20T06:15:00+03:00' }),
    T({ platform: 'instagram', kind: 'comment', thread_key: 'instagram:comment:post-8841', sender_name: 'Brian O.', sender_handle: '@brian.otieno', body: 'How much is the polo??', created_at: '2026-09-19T21:15:00+03:00' }),
    T({ platform: 'facebook', kind: 'dm', thread_key: 'facebook:dm:aisha', sender_name: 'Aisha M.', sender_handle: '@aisha.m', body: 'Hello, do you have the hoodie in black?', is_read: true, created_at: '2026-09-19T16:02:00+03:00' }),
    T({ platform: 'facebook', kind: 'dm', thread_key: 'facebook:dm:aisha', sender_name: storeName, sender_handle: null, body: 'Hi Aisha! Yes, the Kito Fleece Hoodie is available in black — S to XL. Want me to reserve one for you?', direction: 'out', is_read: true, external_id: 'mock_out_seed_1', created_at: '2026-09-19T16:20:00+03:00' }),
    T({ platform: 'facebook', kind: 'dm', thread_key: 'facebook:dm:aisha', sender_name: 'Aisha M.', sender_handle: '@aisha.m', body: 'Yes please! Nitapitia shop kesho.', created_at: '2026-09-19T16:25:00+03:00' }),
    T({ platform: 'youtube', kind: 'comment', thread_key: 'youtube:comment:video-x12', sender_name: 'Kevin K.', sender_handle: '@kevink', body: 'Hii perfume ni original? Lasting how long?', created_at: '2026-09-18T12:30:00+03:00' }),
    T({ platform: 'threads', kind: 'comment', thread_key: 'threads:reply:post-552', sender_name: 'Zawadi N.', sender_handle: '@zawadi.n', body: 'Hii dress iko in size M?', is_read: true, is_resolved: true, created_at: '2026-09-18T09:10:00+03:00' }),
    T({ platform: 'threads', kind: 'comment', thread_key: 'threads:reply:post-552', sender_name: storeName, sender_handle: null, body: 'Hi Zawadi! Yes — M in stock. Order here and we deliver countrywide.', direction: 'out', is_read: true, is_resolved: true, external_id: 'mock_out_seed_2', created_at: '2026-09-18T09:40:00+03:00' }),
  ];
}
