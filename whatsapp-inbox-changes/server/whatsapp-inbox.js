// server/whatsapp-inbox.js
// =========================================================================
//  WhatsApp inbox reply route  →  /api/media?action=whatsapp-inbox
//
//  The browser reads wa_messages itself (RLS keeps owners on their own store)
//  and polls every 3 seconds. There is no Realtime.
//
//  This file does only the two things the browser must NOT do itself:
//
//    POST ?op=reply         — queue ONE text reply by inserting ONE row into
//                              wa_outbox. The worker picks it up and sends it
//                              within a few seconds.
//    GET  ?op=reply-status  — read that row's status so the app can keep
//                              showing "Sending…" and turn the row's
//                              'failed' state into a plain sentence.
//
//  Rules kept in this file:
//    • Owners always act as profiles.store_id — a storeId in the request is
//      ignored outright. Founders must name a store and the store must exist.
//    • A chat may only be answered after it has at least one incoming message
//      in this store, so we never message someone who did not write first.
//      No bulk / no broadcast, no group chats.
//    • The single insert into wa_outbox below is the ONLY write this app ever
//      makes to any wa_ table. wa_sessions and wa_messages are NEVER written
//      to from this file or anywhere else in the app.
//    • Database error text is logged on the server and never sent to the
//      browser; the app only sees plain sentences written here.
//
//  The Supabase client is a parameter so tests can pass a mocked database.
// =========================================================================

import supabase from '../lib/db-client.js';

const MAX_REPLY_LENGTH = 1000;
const REPLY_OPS = new Set(['reply', 'reply-status']);
const OUTBOX_FAILED = /fail|error|cancel/i;
const OUTBOX_SENT = /sent|deliver|read|ok|done|complete/i;

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

function fail(res, status, message) {
  return res.status(status).json({ error: message });
}

// Reads the signed-in profile and decides which store this request may touch.
// Owners: always their own profiles.store_id. Founders: the store they name,
// which must exist. Anything else is refused.
async function resolveStore(req, client) {
  const token = req.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return { status: 401, error: 'Please sign in first.' };
  const { data: authPayload, error: authError } = await client.auth.getUser(token);
  if (authError || !authPayload?.user) return { status: 401, error: 'Please sign in again.' };

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('user_id,role,store_id')
    .eq('user_id', authPayload.user.id)
    .single();
  if (profileError || !profile) return { status: 403, error: 'No workspace is assigned to this account.' };

  if (profile.role === 'owner') {
    // The store comes from the profile, never from the request body.
    const storeId = Number(profile.store_id);
    if (!Number.isSafeInteger(storeId) || storeId < 1) {
      return { status: 400, error: 'This owner account has no store assigned in its profile. Contact support.' };
    }
    return { storeId };
  }

  if (profile.role === 'founder') {
    const requested = Number(req.body?.storeId ?? req.query?.storeId);
    if (!Number.isSafeInteger(requested) || requested < 1) {
      return { status: 400, error: 'Founders must choose a store before replying.' };
    }
    const { data: store, error: storeError } = await client.from('stores').select('id').eq('id', requested).maybeSingle();
    if (storeError) return { status: 500, error: 'The store could not be checked. Please try again.' };
    if (!store) return { status: 404, error: 'The selected store does not exist. Choose an existing store.' };
    return { storeId: requested };
  }

  return { status: 403, error: 'Only store owners and founders can reply to WhatsApp messages.' };
}

function readChatJid(req) {
  return String(req.body?.chat_jid || '').trim();
}

// One chat, one text, up to 1000 characters, and only after the customer
// wrote first. Queues exactly one row in wa_outbox.
async function queueReply(req, res, client, storeId) {
  const chatJid = readChatJid(req);
  if (!chatJid || chatJid.length > 120 || /\s/.test(chatJid) || !chatJid.includes('@')) {
    return fail(res, 400, 'Choose a WhatsApp chat before replying.');
  }
  if (chatJid.endsWith('@g.us')) {
    return fail(res, 400, 'Group chats are not supported.');
  }

  const text = String(req.body?.text ?? '').trim();
  if (!text) return fail(res, 400, 'Type a message before sending.');
  if (text.length > MAX_REPLY_LENGTH) {
    return fail(res, 400, `Messages can be up to ${MAX_REPLY_LENGTH.toLocaleString('en-KE')} characters. Please shorten your reply.`);
  }

  // Reply only to customers who messaged this store first. Never a new chat,
  // never a broadcast.
  const { data: incoming, error: incomingError } = await client
    .from('wa_messages')
    .select('id')
    .eq('store_id', storeId)
    .eq('chat_jid', chatJid)
    .eq('direction', 'in')
    .limit(1);
  if (incomingError) return fail(res, 500, 'The chat could not be checked. Please try again.');
  if (!incoming || !incoming.length) {
    return fail(res, 403, 'You can only reply to someone who messaged this shop first.');
  }

  // The single allowed write to any wa_ table in this whole app.
  const { data: queued, error: queueError } = await client
    .from('wa_outbox')
    .insert({ store_id: storeId, chat_jid: chatJid, kind: 'text', body: text })
    .select('id,status')
    .single();
  if (queueError) {
    console.error('WhatsApp reply could not be queued:', queueError.message);
    return fail(res, 500, 'That reply could not be sent right now. Please try again.');
  }

  return res.status(201).json({ ok: true, id: queued?.id ?? null, status: 'pending' });
}

// Plain status for one queued reply, so the screen can stop saying "Sending…"
// and can explain a failure without ever seeing a database message.
async function readReplyStatus(req, res, client, storeId) {
  const id = Number(req.query?.id);
  if (!Number.isSafeInteger(id) || id < 1) return fail(res, 400, 'Choose a reply to check.');
  const { data, error } = await client
    .from('wa_outbox')
    .select('id,status')
    .eq('store_id', storeId)
    .eq('id', id)
    .maybeSingle();
  if (error) return fail(res, 500, 'That reply could not be checked. Please try again.');
  if (!data) return fail(res, 404, 'That reply could not be found.');
  const raw = String(data.status || '');
  const status = OUTBOX_FAILED.test(raw) ? 'failed' : OUTBOX_SENT.test(raw) ? 'sent' : 'pending';
  return res.status(200).json({ id: data.id, status });
}

export async function handleWhatsAppInbox(req, res, client = supabase) {
  applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  try {
    const op = String(req.query?.op || req.body?.op || '').toLowerCase();
    if (!REPLY_OPS.has(op)) return fail(res, 400, 'Unknown WhatsApp inbox action.');
    if (op === 'reply' && req.method !== 'POST') return fail(res, 405, 'Method not allowed.');
    if (op === 'reply-status' && req.method !== 'GET') return fail(res, 405, 'Method not allowed.');

    const resolved = await resolveStore(req, client);
    if (resolved.error) return fail(res, resolved.status, resolved.error);

    if (op === 'reply') return await queueReply(req, res, client, resolved.storeId);
    return await readReplyStatus(req, res, client, resolved.storeId);
  } catch (error) {
    console.error('WhatsApp inbox request failed:', error?.message || error);
    return fail(res, 500, 'Something went wrong. Please try again.');
  }
}

export default handleWhatsAppInbox;