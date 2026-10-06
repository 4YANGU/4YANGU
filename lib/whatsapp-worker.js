// lib/whatsapp-worker.js
// Small wrapper around the StoYangu WhatsApp worker on Railway.
// Put ALL worker HTTP calls here so response parsing can be corrected in
// one place once the exact handler code is shared.
//
// The browser never calls the worker directly and never sees the admin token.
// Server routes in server/media.js (guarded by Supabase auth) use this helper.

const WORKER_URL = (process.env.WHATSAPP_WORKER_URL || '').replace(/\/$/, '');
const ADMIN_TOKEN = process.env.WHATSAPP_WORKER_ADMIN_TOKEN || '';
const DEFAULT_TIMEOUT_MS = 15_000;

function workerUrl(path) {
  if (!WORKER_URL) throw new Error('WhatsApp worker is not configured (WHATSAPP_WORKER_URL missing).');
  return `${WORKER_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

async function workerFetch(path, options = {}) {
  if (!ADMIN_TOKEN) {
    const err = new Error('WhatsApp worker admin token is not configured.');
    err.status = 503;
    throw err;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(workerUrl(path), {
      method: options.method || 'GET',
      headers: {
        'content-type': 'application/json',
        'x-worker-token': ADMIN_TOKEN,
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
    const text = await resp.text().catch(() => '');
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!resp.ok) {
      const msg = json?.error || json?.message || (json && typeof json === 'object' ? JSON.stringify(json) : text) || `Worker returned ${resp.status}`;
      const err = new Error(msg);
      err.status = resp.status;
      err.payload = json;
      throw err;
    }
    return { status: resp.status, data: json, text };
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('The WhatsApp worker took too long to respond. Please try again.');
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// /pair initiates the 8-digit linking flow for a store.
// phoneNumber must be E.164 digits only, e.g. '254712345678' (no '+', no leading 0).
// Expected response: { ok: true, storeId, phoneNumber, status: 'pending' } (or similar) —
// actual shape is reconciled here once the real handler is shared.
export async function workerPair({ storeId, phoneNumber }) {
  return workerFetch('/pair', {
    method: 'POST',
    body: { storeId: Number(storeId), phoneNumber: String(phoneNumber || '').replace(/[^\d]/g, '') },
  });
}

// /unlink logs the store's WhatsApp device out. Credentials are wiped on the
// worker side by design; re-pairing is required afterwards.
export async function workerUnlink({ storeId }) {
  return workerFetch('/unlink', {
    method: 'POST',
    body: { storeId: Number(storeId) },
  });
}

export function isWorkerConfigured() {
  return Boolean(WORKER_URL && ADMIN_TOKEN);
}
