import { expect, test as base, type Locator, type Page, type Route } from '@playwright/test';

/**
 * Helpers for testing the store-owner dashboard (/owner) without a real backend.
 *
 * - A fake owner session is placed in localStorage, so the app thinks someone is logged in.
 * - Every /api/** request is answered with canned data (see handleApi below).
 * - Anything the app does not serve itself (analytics, fonts, Supabase realtime) is blocked,
 *   so the tests are fast and never depend on the internet.
 */

// supabase-js keeps the session under "sb-<first part of the project host>-auth-token".
// playwright.config.ts starts the app with VITE_SUPABASE_URL=https://e2e.supabase.test.
const SESSION_STORAGE_KEY = 'sb-e2e-auth-token';

interface Message {
  id: number;
  store_id: number;
  platform: string;
  kind: 'dm';
  thread_key: string;
  sender_name: string;
  sender_handle: string | null;
  sender_avatar: string | null;
  body: string;
  direction: 'in' | 'out';
  is_read: boolean;
  is_resolved: boolean;
  external_id: string | null;
  post_ref: string;
  post_title: string;
  post_url: string;
  created_at: string;
}

interface Thread {
  thread_key: string;
  platform: string;
  kind: 'dm';
  sender_name: string;
  sender_handle: string | null;
  sender_avatar: string | null;
  unread: number;
  resolved: boolean;
  source_ref: string;
  source_title: string;
  source_url: string;
  last_body: string;
  last_at: string;
  messages: Message[];
}

export interface OwnerMock {
  threads: Thread[];
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function makeThread(threadKey: string, platform: string, senderName: string, senderHandle: string | null, messageCount: number): Thread {
  const messages: Message[] = Array.from({ length: messageCount }, (_, index) => {
    const inbound = index % 3 !== 2; // two customer messages, then one reply from the owner
    return {
      id: threadKey.length * 1000 + index,
      store_id: 1,
      platform,
      kind: 'dm',
      thread_key: threadKey,
      sender_name: inbound ? senderName : 'You',
      sender_handle: null,
      sender_avatar: null,
      body: inbound
        ? `Message ${index + 1} from ${senderName}: is the item still available and how much is delivery?`
        : `Reply ${index + 1}: yes it is, delivery is KES 200.`,
      direction: inbound ? 'in' : 'out',
      is_read: true,
      is_resolved: false,
      external_id: null,
      post_ref: '',
      post_title: '',
      post_url: '',
      created_at: minutesAgo((messageCount - index) * 7),
    };
  });
  const last = messages[messages.length - 1];
  return {
    thread_key: threadKey,
    platform,
    kind: 'dm',
    sender_name: senderName,
    sender_handle: senderHandle,
    sender_avatar: null,
    unread: 0,
    resolved: false,
    source_ref: '',
    source_title: '',
    source_url: '',
    last_body: last.body,
    last_at: last.created_at,
    messages,
  };
}

const STORE = {
  id: 1, name: 'Zawadi Fashions', slug: 'zawadi', owner_name: 'Zawadi', owner_email: 'owner@example.test',
  whatsapp: '0700000000', phone: '0700000000', logo_url: '', design_json: {}, is_active: true,
  billing_started_at: null, billing_paid_until: null, visitor_total: 120, visitor_today: 4, orders_total: 12, orders_today: 1,
  actual_orders_total: 12, visitors_this_period: 80, orders_this_period: 7, upkeep_plan: 'PAID', upkeep_due: 0, upkeep_paid: true,
  management_locked: false, upkeep_period_day: 3, metrics_date: '2026-10-02',
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

const PRODUCTS = [1, 2, 3].map((id) => ({
  id, store_id: 1, name: `Kitenge Dress ${id}`, price: 2500 + id * 100, colors: [], sizes: [], image_url: '', images: [],
  views_total: 10 * id, views_today: 1, views_this_period: 5 * id, orders_total: id, orders_today: 0, orders_this_period: id,
  metrics_date: '2026-10-02', active: true, created_at: '2026-09-02T00:00:00Z',
}));

const PROFILE = { user_id: 'user-1', email: 'owner@example.test', phone: null, full_name: 'Zawadi', role: 'owner', store_id: 1 };

function fakeSession() {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const expiresAt = 4_102_444_800; // year 2100, so supabase-js never tries to refresh it
  return {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: 'user-1', role: 'authenticated', exp: expiresAt })}.signature`,
    refresh_token: 'refresh-token',
    token_type: 'bearer',
    expires_in: 31_536_000,
    expires_at: expiresAt,
    user: {
      id: 'user-1', aud: 'authenticated', role: 'authenticated', email: 'owner@example.test',
      app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
    },
  };
}

function readJsonBody(route: Route): Record<string, unknown> {
  try {
    return (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function handleApi(route: Route, mock: OwnerMock) {
  const request = route.request();
  const url = new URL(request.url());
  const action = url.searchParams.get('action');
  const op = url.searchParams.get('op');
  const reply = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  if (url.pathname === '/api/media' && action === 'profile') return reply(PROFILE);
  if (url.pathname === '/api/dashboard') {
    return reply({ profile: PROFILE, store: STORE, products: PRODUCTS, orders: [], notifications: [], customers: mock.threads.length, customersToday: 1, customersThisPeriod: mock.threads.length });
  }
  if (url.pathname === '/api/orders') return reply([]);
  if (url.pathname === '/api/subscriptions') return reply({ publicKey: '', pushConfigured: false });
  if (url.pathname === '/api/stores') return reply({ slug: 'zawadi', updated_at: null });

  if (url.pathname === '/api/media' && action === 'social') {
    if (request.method() === 'GET' && op === 'inbox') return reply({ threads: mock.threads });
    if (request.method() === 'GET' && op === 'status') return reply({ unread: { total: 0 } });
    if (request.method() === 'GET' && op === 'oauth_pending') return reply({ pending: [] });
    if (request.method() === 'POST') {
      const body = readJsonBody(route);
      if (body.op === 'sync_inbox' || body.op === 'read') return reply({ ok: true });
      if (body.op === 'reply') {
        const thread = mock.threads.find((candidate) => candidate.thread_key === body.thread_key);
        const message: Message = {
          id: Date.now(), store_id: 1, platform: thread?.platform ?? 'instagram', kind: 'dm', thread_key: String(body.thread_key ?? ''),
          sender_name: 'You', sender_handle: null, sender_avatar: null, body: String(body.body ?? ''), direction: 'out',
          is_read: true, is_resolved: false, external_id: null, post_ref: '', post_title: '', post_url: '', created_at: new Date().toISOString(),
        };
        thread?.messages.push(message);
        return reply({ message, delivery: { ok: true } });
      }
    }
  }

  // Page-view analytics and anything else we did not plan for: harmless "ok" / "not found".
  if (url.pathname.startsWith('/api/agon/')) return reply({ ok: true });
  return reply({ error: 'not mocked in tests' }, 404);
}

/** Every test gets the mocks automatically; `owner` is only needed to look at or change the fake data. */
export const test = base.extend<{ owner: OwnerMock }>({
  owner: [
    async ({ context, baseURL }, use) => {
      const appOrigin = new URL(baseURL ?? 'http://127.0.0.1').origin;
      const mock: OwnerMock = {
        threads: [
          makeThread('dm:alice', 'instagram', 'Alice Wanjiru', '@alice', 28), // long enough to need scrolling
          makeThread('dm:brian', 'facebook', 'Brian Otieno', null, 6),
          makeThread('dm:cynthia', 'tiktok', 'Cynthia Mutua', null, 3),
        ],
      };

      await context.addInitScript(({ key, session }) => {
        window.localStorage.setItem(key, JSON.stringify(session));
      }, { key: SESSION_STORAGE_KEY, session: fakeSession() });

      // Later routes win, so register the catch-all "block everything external" rule first.
      await context.route((url) => url.protocol.startsWith('http') && url.origin !== appOrigin, (route) => route.abort());
      await context.route((url) => url.origin === appOrigin && url.pathname.startsWith('/api/'), (route) => handleApi(route, mock));
      await context.routeWebSocket(/\/realtime\/v1\/websocket/, () => { /* accept the connection and stay silent */ });

      await use(mock);
    },
    { auto: true },
  ],
});

export { expect };

// ---------------------------------------------------------------------------------------------
// Small building blocks used by the specs
// ---------------------------------------------------------------------------------------------

/**
 * After switching tabs, the My Products / My Customers pager slides sideways for a moment.
 * Wait until it has arrived before touching anything inside it: Playwright (like a browser's
 * "scroll to element") scrolls its target into view first, and doing that while the pager is still
 * sliding leaves the pager stuck sideways. A real finger or mouse click never does that.
 */
async function waitForPagerToArrive(page: Page, tab: 'products' | 'customers') {
  await expect.poll(() => page.evaluate((destination) => {
    const pager = document.querySelector('.owner-swipe-pager');
    const track = document.querySelector('.owner-swipe-track');
    if (!pager || !track) return false;
    const slidBy = new DOMMatrixReadOnly(getComputedStyle(track).transform).m41;
    const expected = destination === 'customers' ? -pager.clientWidth : 0;
    return Math.abs(slidBy - expected) < 0.5;
  }, tab)).toBe(true);
}

export async function openMyCustomers(page: Page) {
  await page.goto('/owner');
  await page.getByRole('button', { name: 'My Customers', exact: true }).click();
  await waitForPagerToArrive(page, 'customers');
  await expect(page.locator('.social-thread').first()).toBeVisible();
}

export async function openChat(page: Page, customer: string) {
  await openMyCustomers(page);
  await page.locator('.social-thread', { hasText: customer }).click();
  await expect(page.locator('.social-thread-detail')).toBeVisible();
}

export const chatPanel = (page: Page) => page.locator('.social-thread-detail');

/** Position and size on screen, rounded to whole pixels. */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  return box && { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
}

/** Like boxOf, but fails the test (instead of returning null) when the element is not on screen at all. */
export async function requireBox(locator: Locator) {
  const box = await boxOf(locator);
  if (!box) throw new Error('Expected this element to be on screen, but it has no size.');
  return box;
}

export function viewportOf(page: Page) {
  const size = page.viewportSize();
  if (!size) throw new Error('This test needs a fixed viewport size.');
  return size;
}

/** The element starts at the top-left corner and covers the whole screen, exactly. */
export async function expectFillsScreen(page: Page, locator: Locator) {
  const { width, height } = viewportOf(page);
  await expect.poll(() => boxOf(locator)).toEqual({ x: 0, y: 0, width, height });
}

/** The element sits completely inside the visible screen (nothing cut off on any side). */
export async function expectOnScreen(page: Page, locator: Locator) {
  const { width, height } = viewportOf(page);
  await expect.poll(async () => {
    const box = await boxOf(locator);
    return box !== null && box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height;
  }).toBe(true);
}

/** The element is not hidden behind something else (e.g. a bottom menu): whatever is at its centre is the element itself. */
export async function expectNotCovered(locator: Locator) {
  await expect.poll(() => locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  })).toBe(true);
}

/** Which bottom-menu tab is highlighted, e.g. "My Customers". */
export const activeTab = (page: Page) => page.locator('.manage-nav-item.active');

/** A finger swipe through the browser's real touch pipeline (Chromium only). */
export async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page);
  const steps = 10;
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
  for (let step = 1; step <= steps; step += 1) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps }],
    });
    await page.waitForTimeout(8);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
}

/** Pops up the same "new message" banner the app shows when a customer writes. */
export async function showNewMessageBanner(page: Page, customer: { threadKey: string; name: string }, text: string) {
  const banner = page.locator('.notification-toast-banner');
  // Retry in case the dashboard has not finished attaching its listener yet.
  await expect(async () => {
    await page.evaluate((detail) => {
      window.dispatchEvent(new CustomEvent('stoyangu:notification-alert', { detail }));
    }, { id: `banner-${Date.now()}`, sender: customer.name, body: text, platform: 'instagram', threadKey: customer.threadKey, storeId: 1, timestamp: Date.now() });
    await expect(banner).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}
