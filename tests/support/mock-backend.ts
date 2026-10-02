import type { Page, Route, WebSocketRoute } from '@playwright/test';
import type { DashboardData, Product, Profile, SocialMessage, SocialThread, Store } from '../../src/types';

/**
 * A fake backend for the owner dashboard, living entirely inside the browser
 * session: the signed-in owner, every `/api/**` call and Supabase's realtime
 * socket. The tests therefore need no Supabase project, no Vercel functions
 * and no internet connection, and can never touch real customer data.
 */

// playwright.config.ts starts the dev server with these values, so the app can
// never talk to a real Supabase project while the tests run.
export const MOCK_SUPABASE_URL = 'https://mock-supabase.invalid';
export const MOCK_SUPABASE_ANON_KEY = 'mock-anon-key';
// supabase-js keeps the signed-in session under `sb-<first label of the host>-auth-token`.
const SESSION_STORAGE_KEY = 'sb-mock-supabase-auth-token';

export const STORE_ID = 7;
export const CUSTOMERS = {
  /** Long conversation (taller than a small phone) with two unread messages. */
  amina: { name: 'Amina Wanjiru', threadKey: 'whatsapp:254712000111' },
  brian: { name: 'Brian Otieno', threadKey: 'instagram:brian.otieno' },
  wanjiku: { name: 'Wanjiku Mwangi', threadKey: 'tiktok:comment-5521' },
} as const;

export type MockBackend = {
  /** A customer writes in: it is saved in the fake inbox and announced over the fake realtime socket. */
  receiveMessage(threadKey: string, body: string): Promise<void>;
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

type Turn = ['in' | 'out', string];
type ThreadSeed = {
  key: string;
  name: string;
  handle: string;
  platform: string;
  kind: 'dm' | 'comment';
  unread: number;
  source_title?: string;
  turns: Turn[];
};

const SEEDS: ThreadSeed[] = [
  {
    key: CUSTOMERS.amina.threadKey,
    name: CUSTOMERS.amina.name,
    handle: '+254712000111',
    platform: 'whatsapp',
    kind: 'dm',
    unread: 2,
    turns: [
      ['in', 'Hi! Is the blue kitenge dress still available?'],
      ['out', 'Hello Amina, yes it is. Which size do you need?'],
      ['in', 'Medium please. How much is delivery to Kisumu?'],
      ['out', 'Delivery to Kisumu is KES 350 and takes 2 days.'],
      ['in', 'Great. Do you have it in red too?'],
      ['out', 'Yes, red is also in stock in medium and large.'],
      ['in', 'Can I see a photo of the red one on a model?'],
      ['out', 'Sure, sending the photo now.'],
      ['in', 'Lovely, the red is nicer. What is the final price?'],
      ['out', 'The red dress is KES 2,500 including the belt.'],
      ['in', 'Can you do 2,300 if I take two?'],
      ['out', 'For two dresses I can do KES 4,600 in total.'],
      ['in', 'Deal. I will pay by M-Pesa now.'],
      ['in', 'Sent! Please confirm when you receive it.'],
    ],
  },
  {
    key: CUSTOMERS.brian.threadKey,
    name: CUSTOMERS.brian.name,
    handle: '@brian.otieno',
    platform: 'instagram',
    kind: 'dm',
    unread: 0,
    turns: [
      ['in', 'Do you ship to Mombasa?'],
      ['out', 'Yes we do, 3 days by bus.'],
      ['in', 'Perfect, thanks!'],
    ],
  },
  {
    key: CUSTOMERS.wanjiku.threadKey,
    name: CUSTOMERS.wanjiku.name,
    handle: '@wanjiku',
    platform: 'tiktok',
    kind: 'comment',
    unread: 1,
    source_title: 'Kitenge dress video',
    turns: [['in', 'This dress is so pretty! Price?']],
  },
];

function buildThreads(): SocialThread[] {
  let nextId = 1;
  return SEEDS.map((seed, seedIndex) => {
    const messages: SocialMessage[] = seed.turns.map(([direction, body], index) => {
      const fromEnd = seed.turns.length - 1 - index;
      return {
        id: nextId++,
        store_id: STORE_ID,
        platform: seed.platform,
        kind: seed.kind,
        thread_key: seed.key,
        sender_name: direction === 'in' ? seed.name : 'You',
        sender_handle: direction === 'in' ? seed.handle : null,
        sender_avatar: null,
        body,
        direction,
        is_read: direction === 'out' || fromEnd >= seed.unread,
        is_resolved: false,
        external_id: null,
        post_ref: seed.source_title ? 'post-5521' : '',
        post_title: seed.source_title || '',
        post_url: '',
        created_at: minutesAgo(seedIndex * 90 + fromEnd * 4 + 1),
      };
    });
    const last = messages[messages.length - 1];
    return {
      thread_key: seed.key,
      platform: seed.platform,
      kind: seed.kind,
      sender_name: seed.name,
      sender_handle: seed.handle,
      sender_avatar: null,
      last_body: last.body,
      last_at: last.created_at,
      unread: seed.unread,
      resolved: false,
      source_ref: seed.source_title ? 'post-5521' : '',
      source_title: seed.source_title || '',
      source_url: '',
      messages,
    };
  });
}

const profile: Profile = {
  user_id: 'owner-1',
  email: 'owner@example.com',
  phone: null,
  full_name: 'Zawadi Mwangi',
  role: 'owner',
  store_id: STORE_ID,
};

const store: Store = {
  id: STORE_ID,
  name: 'Zawadi Fashions',
  slug: 'zawadi-fashions',
  owner_name: 'Zawadi Mwangi',
  owner_email: 'owner@example.com',
  whatsapp: '254700000000',
  phone: '254700000000',
  logo_url: '',
  design_json: {},
  is_active: true,
  billing_started_at: null,
  billing_paid_until: null,
  visitor_total: 120,
  visitor_today: 5,
  orders_total: 12,
  orders_today: 1,
  visitors_this_period: 80,
  orders_this_period: 9,
  upkeep_plan: 'PAID',
  upkeep_due: 0,
  upkeep_paid: true,
  management_locked: false,
  upkeep_period_day: 3,
  metrics_date: '2026-10-02',
  created_at: '2026-09-01T00:00:00.000Z',
};

const products: Product[] = ['Kitenge dress', 'Ankara jumpsuit', 'Maasai beaded sandals'].map((name, index) => ({
  id: index + 1,
  store_id: STORE_ID,
  name,
  price: 1800 + index * 700,
  colors: [],
  sizes: [],
  image_url: '/stoyangu-logo.png',
  images: [],
  views_total: 40 + index,
  views_today: 2,
  orders_total: 3,
  orders_today: 0,
  metrics_date: '2026-10-02',
  active: true,
  created_at: '2026-09-02T00:00:00.000Z',
}));

const dashboard: DashboardData = {
  profile,
  store,
  products,
  notifications: [],
  customers: 3,
  customersToday: 1,
  customersThisPeriod: 3,
};

type Frame = [joinRef: string | null, ref: string | null, topic: string, event: string, payload: unknown];
type Binding = { topic: string; id: number; table: string; event: string; socket: WebSocketRoute };

export async function installMockBackend(page: Page): Promise<MockBackend> {
  const context = page.context();
  const threads = buildThreads();
  let nextMessageId = 1000;

  // --- the signed-in owner (supabase-js reads this from localStorage) ---
  const session = {
    access_token: 'mock-access-token',
    refresh_token: 'mock-refresh-token',
    token_type: 'bearer',
    expires_in: 86_400,
    expires_at: Math.floor(Date.now() / 1000) + 86_400,
    user: {
      id: profile.user_id,
      aud: 'authenticated',
      role: 'authenticated',
      email: profile.email,
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    },
  };
  await context.addInitScript(
    ({ key, value }) => {
      try { window.localStorage.setItem(key, value); } catch { /* opaque frames have no storage */ }
    },
    { key: SESSION_STORAGE_KEY, value: JSON.stringify(session) },
  );

  // --- network: nothing leaves the machine; the latest-registered matching route wins ---
  const isLocal = (url: URL) => url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  // Third parties (Google Fonts, analytics beacons...) get an empty answer instead of the internet.
  await context.route((url) => !isLocal(url), (route) => route.fulfill({ status: 204 }));
  await context.route((url) => url.origin === MOCK_SUPABASE_URL, (route) => route.fulfill({ status: 404, json: { error: 'not mocked' } }));
  await context.route((url) => isLocal(url) && url.pathname.startsWith('/api/'), (route) => handleApi(route, threads, () => nextMessageId++));

  // --- Supabase realtime: just enough of the Phoenix protocol (v2 JSON frames) ---
  const bindings: Binding[] = [];
  let nextBindingId = 1;
  await context.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => {
    socket.onMessage((raw) => {
      const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw)) as Frame;
      const reply = (replyTopic: string, response: unknown) =>
        socket.send(JSON.stringify([joinRef, ref, replyTopic, 'phx_reply', { status: 'ok', response }]));
      if (event === 'phx_join') {
        const filters = (payload as { config?: { postgres_changes?: Array<{ event: string; table: string }> } })?.config?.postgres_changes ?? [];
        const accepted = filters.map((filter) => {
          const id = nextBindingId++;
          bindings.push({ topic, id, table: filter.table, event: filter.event, socket });
          return { ...filter, id };
        });
        reply(topic, { postgres_changes: accepted });
      } else if (event === 'phx_leave') {
        for (let index = bindings.length - 1; index >= 0; index--) {
          if (bindings[index].socket === socket && bindings[index].topic === topic) bindings.splice(index, 1);
        }
        reply(topic, {});
      } else if (event === 'heartbeat') {
        reply('phoenix', {});
      }
    });
  });

  return {
    async receiveMessage(threadKey, body) {
      const thread = threads.find((item) => item.thread_key === threadKey);
      if (!thread) throw new Error(`No mock thread ${threadKey}`);
      const message: SocialMessage = {
        id: nextMessageId++,
        store_id: STORE_ID,
        platform: thread.platform,
        kind: thread.kind,
        thread_key: thread.thread_key,
        sender_name: thread.sender_name,
        sender_handle: thread.sender_handle,
        sender_avatar: null,
        body,
        direction: 'in',
        is_read: false,
        is_resolved: false,
        external_id: null,
        post_ref: thread.source_ref,
        post_title: thread.source_title,
        post_url: '',
        created_at: new Date().toISOString(),
      };
      thread.messages.push(message);
      thread.unread += 1;
      thread.last_body = body;
      thread.last_at = message.created_at;

      // The app opens its realtime channels right after the dashboard loads.
      const deadline = Date.now() + 10_000;
      while (!bindings.some((binding) => binding.table === 'social_messages')) {
        if (Date.now() > deadline) throw new Error('The app never subscribed to realtime social_messages changes');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const matching = bindings.filter((binding) => binding.table === 'social_messages' && ['INSERT', '*'].includes(binding.event.toUpperCase()));
      for (const topic of new Set(matching.map((binding) => binding.topic))) {
        const own = matching.filter((binding) => binding.topic === topic);
        const change = { schema: 'public', table: 'social_messages', commit_timestamp: message.created_at, type: 'INSERT', record: message, columns: [], errors: null };
        own[0].socket.send(JSON.stringify([null, null, topic, 'postgres_changes', { ids: own.map((binding) => binding.id), data: change }]));
      }
    },
  };
}

async function handleApi(route: Route, threads: SocialThread[], newMessageId: () => number) {
  const request = route.request();
  const url = new URL(request.url());
  const action = url.searchParams.get('action');
  const op = url.searchParams.get('op');
  const unreadTotal = () => threads.reduce((sum, thread) => sum + thread.unread, 0);

  if (url.pathname === '/api/media' && action === 'profile') return route.fulfill({ json: profile });
  if (url.pathname === '/api/dashboard') return route.fulfill({ json: dashboard });
  if (url.pathname === '/api/orders') return route.fulfill({ json: [] });
  if (url.pathname === '/api/subscriptions') return route.fulfill({ json: { publicKey: '', pushConfigured: false } });

  if (url.pathname === '/api/media' && action === 'social') {
    if (request.method() === 'GET') {
      if (op === 'inbox') return route.fulfill({ json: { threads } });
      if (op === 'status') return route.fulfill({ json: { unread: { total: unreadTotal() } } });
      return route.fulfill({ json: {} });
    }
    const body: { op?: string; thread_key?: string; body?: string } = request.postDataJSON() ?? {};
    const thread = threads.find((item) => item.thread_key === body.thread_key);
    if (body.op === 'read' && thread) {
      thread.unread = 0;
      thread.messages.forEach((message) => { message.is_read = true; });
    }
    if (body.op === 'reply' && thread) {
      const message: SocialMessage = {
        ...thread.messages[thread.messages.length - 1],
        id: newMessageId(),
        sender_name: 'You',
        sender_handle: null,
        body: body.body || '',
        direction: 'out',
        is_read: true,
        created_at: new Date().toISOString(),
      };
      thread.messages.push(message);
      thread.last_body = message.body;
      thread.last_at = message.created_at;
      return route.fulfill({ json: { message, delivery: { ok: true } } });
    }
    return route.fulfill({ json: { ok: true } });
  }

  return route.fulfill({ status: 404, json: { error: `No mock for ${request.method()} ${url.pathname}` } });
}
