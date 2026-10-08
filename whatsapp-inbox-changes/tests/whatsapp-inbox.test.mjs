// tests/whatsapp-inbox.test.mjs
// =========================================================================
//  The WhatsApp reply route (server/whatsapp-inbox.js) with a mocked
//  database: store resolution for owners and founders, when a reply is
//  allowed, and the text limits.
//
//  Run with:  npm run test:whatsapp-inbox
// =========================================================================

import assert from 'node:assert/strict';
import { test } from 'node:test';

// The route imports a real Supabase client when it loads, so give it harmless
// values first. Every test below passes its own mocked database instead, and
// nothing here ever reaches the network.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://mock-supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'mock-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'mock-service-role-key';

const { handleWhatsAppInbox } = await import('../server/whatsapp-inbox.js');

const TOKEN = 'test-token';
const USER_ID = 'user-1';
const OWNER_STORE = 7;
const CHAT = '254712000111@s.whatsapp.net';

// ------------------------------------------------------------- mock database

function createMockDb({
  role = 'owner',
  profileStoreId = OWNER_STORE,
  stores = [OWNER_STORE],
  messages = [],
  outbox = [],
  insertError = null,
  incomingError = null,
  authenticated = true,
} = {}) {
  const tables = {
    profiles: [],
    stores: stores.map((id) => ({ id })),
    wa_messages: messages.map((row, index) => ({ id: row.id ?? index + 1, status: 'sent', kind: 'text', ...row })),
    wa_outbox: outbox.map((row, index) => ({ id: row.id ?? index + 1, status: 'pending', ...row })),
    wa_sessions: [],
  };
  if (role) tables.profiles = [{ user_id: USER_ID, role, store_id: profileStoreId }];
  // Every write the route attempts, so a test can prove which tables were touched.
  const writes = [];
  let nextId = 100;

  function matches(table, query) {
    return tables[table]
      .filter((row) => query.filters.every(([column, value]) => row[column] === value))
      .slice(0, query.limit ?? undefined);
  }

  function builder(table, query = { filters: [], limit: null, insert: undefined, columns: '' }) {
    const api = {
      select(columns) { query.columns = columns; return api; },
      insert(values) { query.insert = values; return api; },
      eq(column, value) { query.filters.push([column, value]); return api; },
      limit(count) { query.limit = count; return api; },
      single() { return Promise.resolve(resolve(true)); },
      maybeSingle() { return Promise.resolve(resolve(true)); },
      then(onFulfilled, onRejected) { return Promise.resolve(resolve(false)).then(onFulfilled, onRejected); },
    };

    function resolve(asSingle) {
      if (query.insert) {
        const table_ = table;
        if (table_ === 'wa_messages' && incomingError) return { data: null, error: incomingError };
        writes.push({ table: table_, values: query.insert });
        if (insertError) return { data: null, error: insertError };
        const row = { status: 'pending', id: nextId++, ...query.insert };
        tables[table_].push(row);
        return { data: row, error: null };
      }
      if (table === 'wa_messages' && incomingError && query.filters.some(([column, value]) => column === 'direction' && value === 'in')) {
        return { data: null, error: incomingError };
      }
      const rows = matches(table, query);
      return { data: asSingle ? rows[0] ?? null : rows, error: null };
    }

    return api;
  }

  return {
    tables,
    writes,
    auth: {
      getUser: async (token) => (authenticated && token === TOKEN
        ? { data: { user: { id: USER_ID } }, error: null }
        : { data: { user: null }, error: { message: 'Invalid token' } }),
    },
    from: (table) => builder(table),
  };
}

// --------------------------------------------------------------- test helpers

const incoming = (storeId = OWNER_STORE, chatJid = CHAT, extra = {}) => ({ store_id: storeId, chat_jid: chatJid, direction: 'in', body: 'Hello!', ...extra });

function makeReq({ method = 'POST', query = {}, body = {}, token = TOKEN } = {}) {
  return { method, query, body, headers: token ? { authorization: `Bearer ${token}` } : {} };
}

function makeRes() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.setHeader = (key, value) => { res.headers[String(key).toLowerCase()] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.body = payload; return res; };
  res.end = () => res;
  return res;
}

const reply = (body = {}) => makeReq({ body: { op: 'reply', chat_jid: CHAT, text: 'Thank you!', ...body } });

// ---------------------------------------------------------------- the tests

test('an owner replies as the store saved on their profile, never a storeId from the request', async () => {
  const db = createMockDb({ role: 'owner', profileStoreId: OWNER_STORE, messages: [incoming()] });
  const res = makeRes();
  await handleWhatsAppInbox(reply({ storeId: 999 }), res, db);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.ok, true);
  assert.equal(db.writes.length, 1, 'exactly one write');
  assert.equal(db.writes[0].table, 'wa_outbox', 'the only table ever written is wa_outbox');
  assert.equal(db.writes[0].values.store_id, OWNER_STORE);
  assert.equal(db.writes[0].values.kind, 'text');
  assert.equal(db.writes[0].values.chat_jid, CHAT);
});

test('an owner with no store on their profile is refused', async () => {
  const db = createMockDb({ role: 'owner', profileStoreId: null, messages: [incoming()] });
  const res = makeRes();
  await handleWhatsAppInbox(reply(), res, db);

  assert.equal(res.statusCode, 400);
  assert.equal(db.writes.length, 0);
});

test('a founder must choose a store, and it must exist', async () => {
  const missing = makeRes();
  await handleWhatsAppInbox(reply(), missing, createMockDb({ role: 'founder', profileStoreId: null }));
  assert.equal(missing.statusCode, 400, 'a founder without a storeId is refused');

  const unknown = makeRes();
  const unknownDb = createMockDb({ role: 'founder', profileStoreId: null, stores: [OWNER_STORE] });
  await handleWhatsAppInbox(reply({ storeId: 999 }), unknown, unknownDb);
  assert.equal(unknown.statusCode, 404, 'a store that does not exist is refused');
  assert.equal(unknownDb.writes.length, 0);

  const chosen = makeRes();
  const chosenDb = createMockDb({ role: 'founder', profileStoreId: null, stores: [OWNER_STORE], messages: [incoming()] });
  await handleWhatsAppInbox(reply({ storeId: OWNER_STORE }), chosen, chosenDb);
  assert.equal(chosen.statusCode, 201);
  assert.equal(chosenDb.writes[0].values.store_id, OWNER_STORE);
});

test('a reply is allowed after the customer messaged first', async () => {
  const db = createMockDb({ messages: [incoming()] });
  const res = makeRes();
  await handleWhatsAppInbox(reply({ text: 'Karibu! It is available.' }), res, db);

  assert.equal(res.statusCode, 201);
  assert.deepEqual(db.tables.wa_outbox.map((row) => row.body), ['Karibu! It is available.']);
  assert.deepEqual(db.writes.map((write) => write.table), ['wa_outbox']);
});

test('a reply is refused when the customer never messaged first', async () => {
  const db = createMockDb({ messages: [{ store_id: OWNER_STORE, chat_jid: CHAT, direction: 'out', body: 'Hello?' }], outbox: [] });
  const res = makeRes();
  await handleWhatsAppInbox(reply(), res, db);

  assert.equal(res.statusCode, 403);
  assert.equal(db.writes.length, 0, 'nothing is queued for someone who never wrote in');
  assert.match(res.body.error, /messaged this shop first/);
});

test('a reply is refused for a chat in another store', async () => {
  const db = createMockDb({ messages: [incoming(42)] });
  const res = makeRes();
  await handleWhatsAppInbox(reply(), res, db);

  assert.equal(res.statusCode, 403);
  assert.equal(db.writes.length, 0);
});

test('an empty message is refused and never queued', async () => {
  for (const text of ['', '   ', '\n\t ']) {
    const db = createMockDb({ messages: [incoming()] });
    const res = makeRes();
    await handleWhatsAppInbox(reply({ text }), res, db);
    assert.equal(res.statusCode, 400, `"${text}" must be refused`);
    assert.equal(db.writes.length, 0);
  }
});

test('a message of exactly 1000 characters is allowed, 1001 is refused', async () => {
  const allowed = createMockDb({ messages: [incoming()] });
  const allowedRes = makeRes();
  await handleWhatsAppInbox(reply({ text: 'a'.repeat(1000) }), allowedRes, allowed);
  assert.equal(allowedRes.statusCode, 201);
  assert.equal(allowed.writes.length, 1);

  const refused = createMockDb({ messages: [incoming()] });
  const refusedRes = makeRes();
  await handleWhatsAppInbox(reply({ text: 'a'.repeat(1001) }), refusedRes, refused);
  assert.equal(refusedRes.statusCode, 400);
  assert.equal(refused.writes.length, 0);
  assert.match(refusedRes.body.error, /1,000 characters/);
});

test('group chats are never answered', async () => {
  const db = createMockDb({ messages: [incoming(OWNER_STORE, '120363000000000000@g.us')] });
  const res = makeRes();
  await handleWhatsAppInbox(reply({ chat_jid: '120363000000000000@g.us' }), res, db);

  assert.equal(res.statusCode, 400);
  assert.equal(db.writes.length, 0);
});

test('a signed-out caller is refused', async () => {
  const noHeader = makeRes();
  await handleWhatsAppInbox(makeReq({ body: { op: 'reply', chat_jid: CHAT, text: 'Hi' }, token: '' }), noHeader, createMockDb({ messages: [incoming()] }));
  assert.equal(noHeader.statusCode, 401);

  const badToken = makeRes();
  await handleWhatsAppInbox(makeReq({ body: { op: 'reply', chat_jid: CHAT, text: 'Hi' }, token: 'other' }), badToken, createMockDb({ messages: [incoming()] }));
  assert.equal(badToken.statusCode, 401);
});

test('database failures become plain sentences, never raw database text', async () => {
  const db = createMockDb({ messages: [incoming()], insertError: { message: 'relation "wa_outbox" does not exist', code: '42P01' } });
  const res = makeRes();
  await handleWhatsAppInbox(reply(), res, db);

  assert.equal(res.statusCode, 500);
  assert.equal(JSON.stringify(res.body).includes('wa_outbox'), false, 'the table name must not leak');
  assert.equal(res.body.error, 'That reply could not be sent right now. Please try again.');
});

test('the reply status is reported as pending, sent or failed, and only for this store', async () => {
  const db = createMockDb({ messages: [incoming()], outbox: [{ id: 5, store_id: OWNER_STORE, status: 'SENT' }] });
  const sent = makeRes();
  await handleWhatsAppInbox(makeReq({ method: 'GET', query: { op: 'reply-status', id: '5' } }), sent, db);
  assert.deepEqual(sent.body, { id: 5, status: 'sent' });

  const other = createMockDb({ messages: [incoming()], outbox: [{ id: 8, store_id: 42, status: 'failed' }] });
  const notMine = makeRes();
  await handleWhatsAppInbox(makeReq({ method: 'GET', query: { op: 'reply-status', id: '8' } }), notMine, other);
  assert.equal(notMine.statusCode, 404, 'another store\'s reply is not visible');

  const failedDb = createMockDb({ messages: [incoming()], outbox: [{ id: 9, store_id: OWNER_STORE, status: 'failed' }] });
  const failed = makeRes();
  await handleWhatsAppInbox(makeReq({ method: 'GET', query: { op: 'reply-status', id: '9' } }), failed, failedDb);
  assert.deepEqual(failed.body, { id: 9, status: 'failed' });

  const unknown = createMockDb({ messages: [incoming()], outbox: [{ id: 10, store_id: OWNER_STORE, status: 'working_on_it' }] });
  const pending = makeRes();
  await handleWhatsAppInbox(makeReq({ method: 'GET', query: { op: 'reply-status', id: '10' } }), pending, unknown);
  assert.deepEqual(pending.body, { id: 10, status: 'pending' });
});

test('only the reply and reply-status operations exist', async () => {
  const res = makeRes();
  await handleWhatsAppInbox(makeReq({ body: { op: 'broadcast' } }), res, createMockDb({ messages: [incoming()] }));
  assert.equal(res.statusCode, 400);

  const wrongMethod = makeRes();
  await handleWhatsAppInbox(makeReq({ method: 'GET', query: { op: 'reply' } }), wrongMethod, createMockDb({ messages: [incoming()] }));
  assert.equal(wrongMethod.statusCode, 405);
});