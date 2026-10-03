// lib/whatsapp.js
// WhatsApp Business Cloud API adapter for StoYangu.
//
// Responsibilities:
//  - Generate & validate 6-digit pairing codes used by the linking screen.
//  - Send outbound text/image/document messages via the Cloud API (v21.0).
//  - Ingest inbound webhook events (text, image, document, video, audio,
//    stickers, location, contacts, delivery/read receipts, status changes),
//    normalizing them into social_messages rows (platform='whatsapp') and
//    appending a delivery log in whatsapp_messages.
//  - Track relink-required state when tokens rotate or numbers unbind.
//
// Without credentials it runs in MOCK MODE so the UI can still be tested end
// to end: codes generate, messages save locally, and the webhook accepts a
// signed ping. Live mode requires these env vars (all four required):
//   WHATSAPP_ACCESS_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_PHONE_NUMBER_ID,
//   WHATSAPP_WEBHOOK_VERIFY_TOKEN (>=8 characters).
// Per-store overrides live in whatsapp_pairs.phone_number_id / access_token_cipher.

import crypto from 'node:crypto';
import { pushStoreEvent } from './push-events.js';

const CLOUD_API_VERSION = 'v21.0';
const CLOUD_API_BASE = `https://graph.facebook.com/${CLOUD_API_VERSION}`;
const SUPPORTED_INBOUND_TYPES = new Set(['text', 'image', 'video', 'audio', 'document', 'sticker', 'location', 'contacts']);
// WhatsApp Customer Service window: you can only free-form reply within 24h
// of the customer's last inbound message. After that the Cloud API rejects
// with error 131047/131051. We detect this proactively and return a specific
// reason so the inbox can show a clear CTA instead of "delivery failed".
const CUSTOMER_CARE_WINDOW_MS = 24 * 60 * 60 * 1000;

let relinkAlerted = new Set();
setInterval(() => { relinkAlerted = new Set(); }, 6 * 60 * 60 * 1000);

export function whatsappConfigured() {
  return Boolean(
    process.env.WHATSAPP_ACCESS_TOKEN &&
    process.env.WHATSAPP_APP_SECRET &&
    process.env.WHATSAPP_PHONE_NUMBER_ID &&
    process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN &&
    String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN).length >= 8
  );
}

export function whatsappMode() {
  return whatsappConfigured() ? 'live' : 'mock';
}

export function newPairingCode() {
  const n = crypto.randomInt(0, 1_000_000);
  return n.toString(10).padStart(6, '0');
}

export function newVerifyToken() {
  return crypto.randomBytes(24).toString('hex');
}

function normalizePhone(input) {
  const digits = String(input || '').replace(/[^\d+]/g, '');
  if (!digits) return '';
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('254')) return `+${digits}`;
  if (digits.startsWith('0')) return `+254${digits.slice(1)}`;
  return `+${digits}`;
}

function threadKeyFor(customerPhone) {
  return `whatsapp:${normalizePhone(customerPhone)}`;
}

export async function findStoreByRecipient(supabase, phoneNumberId, displayPhone) {
  const normDisplay = normalizePhone(displayPhone);
  if (phoneNumberId) {
    const { data: byPid } = await supabase
      .from('whatsapp_pairs')
      .select('store_id, status')
      .eq('phone_number_id', String(phoneNumberId))
      .in('status', ['paired', 'relink_required'])
      .limit(1)
      .maybeSingle();
    if (byPid?.store_id) return { storeId: byPid.store_id, pairStatus: byPid.status };
  }
  if (normDisplay) {
    const { data: byDisplay } = await supabase
      .from('whatsapp_pairs')
      .select('store_id, status')
      .eq('display_phone', normDisplay)
      .in('status', ['paired', 'relink_required'])
      .limit(1)
      .maybeSingle();
    if (byDisplay?.store_id) return { storeId: byDisplay.store_id, pairStatus: byDisplay.status };
    const { data: byStoreField } = await supabase
      .from('stores')
      .select('id')
      .eq('whatsapp', normDisplay)
      .limit(1)
      .maybeSingle();
    if (byStoreField?.id) return { storeId: byStoreField.id, pairStatus: 'paired' };
  }
  return { storeId: null, pairStatus: null };
}

// --- Outbound send -----------------------------------------------------------

function authHeaderFor(pair) {
  const token = pair?.access_token_cipher || process.env.WHATSAPP_ACCESS_TOKEN;
  return token ? `Bearer ${token}` : '';
}

function phoneNumberIdFor(pair) {
  return pair?.phone_number_id || process.env.WHATSAPP_PHONE_NUMBER_ID;
}

export async function sendWhatsAppMessage(supabase, { storeId, to, text = '', attachmentUrl = '', attachmentMime = '', attachmentName = '', replyToWamid = '' }) {
  if (!storeId) throw new Error('Store is required.');
  const recipient = normalizePhone(to);
  if (!recipient) throw new Error('A valid customer WhatsApp number is required.');

  const { data: pair, error: pairError } = await supabase
    .from('whatsapp_pairs')
    .select('*')
    .eq('store_id', storeId)
    .maybeSingle();
  if (pairError) throw pairError;

  const mode = whatsappMode();
  const threadKey = threadKeyFor(recipient);

  // 24-hour customer-care window check. If the customer hasn't messaged the
  // store in over 24 hours we must NOT attempt a free-form send — WhatsApp
  // will hard-reject it. Save locally and return a clear reason.
  const { data: lastInbound, error: lastErr } = await supabase
    .from('social_messages')
    .select('created_at')
    .eq('store_id', storeId)
    .eq('platform', 'whatsapp')
    .eq('thread_key', threadKey)
    .eq('direction', 'in')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastErr) throw lastErr;
  const lastInboundAt = lastInbound?.created_at ? new Date(lastInbound.created_at).getTime() : 0;
  const withinWindow = lastInboundAt && (Date.now() - lastInboundAt) < CUSTOMER_CARE_WINDOW_MS;
  if (mode === 'live' && !withinWindow) {
    const body = text?.trim() || (attachmentName ? `Attachment: ${attachmentName}` : 'Attachment');
    const { data: saved, error: saveErr } = await supabase.from('social_messages').insert({
      store_id: storeId, platform: 'whatsapp', kind: 'dm', thread_key: threadKey,
      sender_name: 'You', sender_handle: recipient, body,
      attachment_url: attachmentUrl || null, attachment_name: attachmentName || null,
      media_mime: attachmentMime || null,
      direction: 'out', is_read: true, is_resolved: false,
      whatsapp_status: 'window_closed',
    }).select().single();
    if (saveErr) throw saveErr;
    await supabase.from('whatsapp_messages').insert({
      store_id: storeId, social_message_id: saved.id, direction: 'out', customer_phone: recipient,
      message_type: attachmentUrl ? (attachmentMime?.startsWith('image/') ? 'image' : 'document') : 'text',
      body, media_url: attachmentUrl || null, media_mime: attachmentMime || null,
      media_name: attachmentName || null, status: 'failed', error_code: 'WINDOW_CLOSED',
      error_message: '24-hour window closed',
    });
    return {
      socialMessage: saved, log: null,
      delivery: {
        ok: false, mode, wamid: null, reason: 'window_closed',
        error: 'Customer care window closed: WhatsApp only allows free-form replies within 24 hours of a customer\'s last message. To restart the conversation, open the customer\'s WhatsApp chat directly (a template message is required).',
      },
    };
  }

  const messageType = attachmentUrl ? (attachmentMime?.startsWith('image/') ? 'image' : attachmentMime?.startsWith('video/') ? 'video' : attachmentMime?.startsWith('audio/') ? 'audio' : 'document') : 'text';
  const body = text?.trim() || (attachmentName ? `Attachment: ${attachmentName}` : 'Attachment');
  const { data: socialRow, error: socialError } = await supabase
    .from('social_messages')
    .insert({
      store_id: storeId, platform: 'whatsapp', kind: 'dm', thread_key: threadKey,
      sender_name: 'You', sender_handle: recipient, body,
      attachment_url: attachmentUrl || null, attachment_name: attachmentName || null,
      media_mime: attachmentMime || null,
      direction: 'out', is_read: true, is_resolved: false,
      whatsapp_status: mode === 'live' ? 'queued' : 'sent-mock',
    })
    .select().single();
  if (socialError) throw socialError;

  const logInsert = await supabase.from('whatsapp_messages').insert({
    store_id: storeId, social_message_id: socialRow.id, direction: 'out', customer_phone: recipient,
    message_type: messageType, body,
    media_url: attachmentUrl || null, media_mime: attachmentMime || null, media_name: attachmentName || null,
    status: mode === 'live' ? 'queued' : 'sent',
    sent_at: mode === 'live' ? null : new Date().toISOString(),
  }).select().single();
  const logRow = logInsert.data;

  let delivery = { ok: mode !== 'live', mode, wamid: null, error: null };
  if (mode === 'live') {
    try {
      const phoneNumberId = phoneNumberIdFor(pair);
      const auth = authHeaderFor(pair);
      if (!phoneNumberId || !auth) throw new Error('WhatsApp is not paired for this store yet.');
      const payload = {
        messaging_product: 'whatsapp', recipient_type: 'individual',
        to: recipient.replace(/^\+/, ''),
        ...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
      };
      if (messageType === 'text') { payload.type = 'text'; payload.text = { preview_url: true, body }; }
      else if (messageType === 'image') { payload.type = 'image'; payload.image = { link: attachmentUrl, caption: text || undefined }; }
      else if (messageType === 'video') { payload.type = 'video'; payload.video = { link: attachmentUrl, caption: text || undefined }; }
      else if (messageType === 'audio') { payload.type = 'audio'; payload.audio = { link: attachmentUrl }; }
      else { payload.type = 'document'; payload.document = { link: attachmentUrl, caption: text || undefined, filename: attachmentName || 'attachment' }; }
      const resp = await fetch(`${CLOUD_API_BASE}/${phoneNumberId}/messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: auth },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || data.error) {
        const errMsg = data?.error?.message || data?.error?.error_data?.details || `WhatsApp API error ${resp.status}`;
        const errCode = data?.error?.code ? String(data.error.code) : String(resp.status);
        const fatal = data?.error?.code === 190 || data?.error?.code === 100 || /token|permission|unauthor|revoked/i.test(errMsg);
        if (fatal && pair?.id) {
          await supabase.from('whatsapp_pairs').update({ status: 'relink_required', last_error: errMsg.slice(0, 500), updated_at: new Date().toISOString() }).eq('id', pair.id);
          if (!relinkAlerted.has(storeId)) {
            relinkAlerted.add(storeId);
            pushStoreEvent(storeId, 'WhatsApp needs relinking', errMsg.slice(0, 120), `wa-relink-${Date.now()}`, '/owner', { platform: 'whatsapp' }).catch(() => undefined);
          }
        }
        await supabase.from('whatsapp_messages').update({ status: 'failed', error_code: errCode, error_message: errMsg.slice(0, 500) }).eq('id', logRow.id);
        await supabase.from('social_messages').update({ whatsapp_status: 'failed' }).eq('id', socialRow.id);
        delivery.ok = false; delivery.error = errMsg;
      } else {
        const wamid = data?.messages?.[0]?.id || null;
        await supabase.from('whatsapp_messages').update({ status: 'sent', wamid, sent_at: new Date().toISOString() }).eq('id', logRow.id);
        await supabase.from('social_messages').update({ whatsapp_wamid: wamid, whatsapp_status: 'sent', external_id: wamid }).eq('id', socialRow.id);
        await supabase.from('whatsapp_pairs').update({ last_outbound_at: new Date().toISOString(), last_error: '', updated_at: new Date().toISOString() }).eq('store_id', storeId);
        delivery.wamid = wamid;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'WhatsApp send failed.';
      await supabase.from('whatsapp_messages').update({ status: 'failed', error_message: msg.slice(0, 500) }).eq('id', logRow.id);
      await supabase.from('social_messages').update({ whatsapp_status: 'failed' }).eq('id', socialRow.id);
      delivery.ok = false; delivery.error = msg;
    }
  } else {
    const wamid = `wamid-mock-${Date.now().toString(36)}`;
    await supabase.from('whatsapp_messages').update({ wamid }).eq('id', logRow.id);
    await supabase.from('social_messages').update({ whatsapp_wamid: wamid, external_id: wamid, whatsapp_status: 'sent-mock' }).eq('id', socialRow.id);
    delivery.wamid = wamid;
  }
  return { socialMessage: socialRow, log: logRow, delivery };
}

// --- Inbound webhook ---------------------------------------------------------

function bodyFromInbound(value) {
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text?.body === 'string') return value.text.body;
  if (typeof value.image?.caption === 'string') return value.image.caption;
  if (typeof value.video?.caption === 'string') return value.video.caption;
  if (typeof value.document?.caption === 'string') return value.document.caption;
  if (value.location) {
    const lat = value.location.latitude, lng = value.location.longitude;
    const name = value.location.name ? `${value.location.name} · ` : '';
    const addr = value.location.address ? value.location.address : '';
    return `📍 Location: ${name}${addr || `${lat}, ${lng}`}`;
  }
  if (Array.isArray(value.contacts) && value.contacts[0]) {
    const c = value.contacts[0];
    const name = [c.name?.first_name, c.name?.formatted_name].filter(Boolean)[0] || 'Contact';
    const phones = (Array.isArray(c.phones) ? c.phones.map(p => p.phone).filter(Boolean) : []).join(', ');
    return `👤 Contact shared: ${name}${phones ? ` · ${phones}` : ''}`;
  }
  if (value.sticker) return 'Sticker';
  if (value.audio) return '🎤 Voice note';
  if (value.image) return '📷 Photo';
  if (value.video) return '🎬 Video';
  if (value.document) return `📄 ${value.document.filename || 'Document'}`;
  return '';
}

function mediaFromInbound(value) {
  if (!value || typeof value !== 'object') return null;
  for (const kind of ['image', 'video', 'audio', 'document', 'sticker']) {
    const block = value[kind];
    if (block && (block.id || block.link)) {
      return { kind, id: block.id || '', mime: block.mime_type || '', sha256: block.sha256 || '', filename: block.filename || block.caption || '', caption: block.caption || '' };
    }
  }
  return null;
}

export async function handleWhatsAppInbound(supabase, payload) {
  const results = [];
  const entries = Array.isArray(payload?.entry) ? payload.entry : (payload?.changes ? [payload] : []);
  for (const entry of entries) {
  for (const change of entry?.changes || []) {
    if (change?.field !== 'messages') continue;
    const value = change.value || {};
    const metadata = value.metadata || {};
    const phoneNumberId = metadata.phone_number_id;
    const displayPhone = metadata.display_phone_number;
    const { storeId } = await findStoreByRecipient(supabase, phoneNumberId, displayPhone);
    if (!storeId) { results.push({ ignored: true, reason: 'no-store-match', duplicate: false }); continue; }

    // Status receipts first (sent / delivered / read / failed). Idempotent.
    for (const status of value.statuses || []) {
      const wamid = status.id;
      const newStatus = status.status === 'failed' ? 'failed' : status.status;
      const errCode = status.errors?.[0]?.code ? String(status.errors[0].code) : null;
      const errMsg = status.errors?.[0]?.title || status.errors?.[0]?.message || null;
      const timestamp = status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
      if (wamid) {
        await supabase.from('whatsapp_messages').update({
          status: newStatus, error_code: errCode, error_message: errMsg,
          delivered_at: newStatus === 'delivered' ? timestamp : undefined,
          read_at: newStatus === 'read' ? timestamp : undefined,
        }).eq('wamid', wamid).eq('store_id', storeId);
        const socialUpdate = { whatsapp_status: newStatus };
        if (newStatus === 'read') socialUpdate.is_read = true;
        await supabase.from('social_messages').update(socialUpdate).eq('whatsapp_wamid', wamid).eq('store_id', storeId);
      }
      results.push({ storeId, kind: 'receipt', status: newStatus, wamid });
    }

    // Inbound messages.
    for (const msg of value.messages || []) {
      if (msg.type === 'reaction' || msg.type === 'system' || msg.errors) continue;
      const type = msg.type && SUPPORTED_INBOUND_TYPES.has(msg.type) ? msg.type : (msg.text ? 'text' : 'unsupported');
      if (type === 'unsupported') continue;
      const from = normalizePhone(msg.from);
      if (!from) continue;
      const contact = (value.contacts || []).find(c => normalizePhone(c.wa_id) === from);
      const senderName = contact?.profile?.name || from;
      const body = bodyFromInbound(msg) || (msg.text?.body || '');
      const media = mediaFromInbound(msg);
      const wamid = msg.id;
      const threadKey = threadKeyFor(from);
      const timestamp = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

      // Deduplicate by wamid across both tables so Meta retries don't dup rows.
      const [{ data: existingSocial }, { data: existingLog }] = await Promise.all([
        supabase.from('social_messages').select('id').eq('store_id', storeId).eq('platform', 'whatsapp').eq('whatsapp_wamid', wamid).limit(1).maybeSingle(),
        supabase.from('whatsapp_messages').select('id').eq('store_id', storeId).eq('wamid', wamid).eq('direction', 'in').limit(1).maybeSingle(),
      ]);
      if (existingSocial?.id || existingLog?.id) { results.push({ storeId, kind: 'duplicate', wamid, duplicate: true }); continue; }

      const { data: storeProfile } = await supabase.from('stores').select('name').eq('id', storeId).maybeSingle();
      const storeName = storeProfile?.name || 'Store';

      const insert = {
        store_id: storeId, platform: 'whatsapp', kind: 'dm', thread_key: threadKey,
        sender_name: senderName, sender_handle: from,
        body: body || (media ? `${senderName} sent a ${media.kind}` : ''),
        direction: 'in', is_read: false, is_resolved: false,
        external_id: wamid, whatsapp_wamid: wamid, whatsapp_status: 'received',
        sender_avatar: null, created_at: timestamp,
      };
      if (media?.id && !media.id.startsWith('wamid-mock-')) {
        insert.attachment_name = media.filename || media.kind;
        insert.media_mime = media.mime;
      }
      const { data: socialRow, error } = await supabase.from('social_messages').insert(insert).select().single();
      if (error) { results.push({ storeId, kind: 'error', error: error.message, duplicate: false }); continue; }

      await supabase.from('whatsapp_messages').insert({
        store_id: storeId, social_message_id: socialRow.id, direction: 'in', wamid,
        customer_phone: from, customer_name: senderName,
        message_type: media?.kind || type, body: insert.body,
        media_mime: media?.mime || null, media_name: media?.filename || null,
        status: 'received', sent_at: timestamp,
      });

      await supabase.from('whatsapp_pairs').update({ last_inbound_at: timestamp, updated_at: new Date().toISOString() }).eq('store_id', storeId);

      // Mock auto-reply for first message so the demo inbox feels alive.
      if (whatsappMode() !== 'live') {
        const { count } = await supabase.from('social_messages').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('thread_key', threadKey).eq('direction', 'out');
        if (!count) {
          setTimeout(() => {
            sendWhatsAppMessage(supabase, { storeId, to: from, text: `Hello ${senderName}, thank you for messaging ${storeName} on WhatsApp! How can we help you today?` }).catch(() => undefined);
          }, 1500);
        }
      }
      results.push({ storeId, kind: 'message', wamid, from, threadKey, duplicate: false });
    }
  }
  }
  return results;
}

// WHATSAPP_APP_SECRET is REQUIRED: any POST missing or with an invalid
// X-Hub-Signature-256 header is rejected with 401 before any processing.
export function verifyWhatsAppSignature(req) {
  const secret = String(process.env.WHATSAPP_APP_SECRET || '').trim();
  if (!secret) return { ok: false, reason: 'WHATSAPP_APP_SECRET is not configured.' };
  const header = String(req.headers?.['x-hub-signature-256'] || req.headers?.['x-hub-signature'] || '');
  const signature = header.replace(/^sha256=/, '').trim();
  if (!signature) return { ok: false, reason: 'Missing X-Hub-Signature-256 header.' };
  const payload = req.rawBody || (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
  const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    const a = Buffer.from(signature, 'hex');
    const b = Buffer.from(hmac, 'hex');
    if (a.length !== b.length) return { ok: false, reason: 'Bad signature length.' };
    return { ok: crypto.timingSafeEqual(a, b) };
  } catch {
    return { ok: false, reason: 'Malformed signature.' };
  }
}

export function verifyWebhookChallenge(mode, token, challenge) {
  const expected = String(process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || '').trim();
  if (mode === 'subscribe' && token && expected && token === expected) return String(challenge || '');
  return null;
}
