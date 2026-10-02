import { expect, test as base } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { CUSTOMERS, STORE_ID, installMockBackend } from './support/mock-backend';
import type { MockBackend } from './support/mock-backend';

/**
 * "My Customers" inbox layout.
 *
 * Background: the owner dashboard slides between My Products and My Customers
 * with a CSS `transform`. A transform turns that sliding track into the
 * containing block of every `position: fixed` element inside it, which used to
 * leave the full-screen phone chat (and the camera/gallery sheet) twice as wide
 * as the screen, shifted left and starting below the header. These tests open
 * the real app in a real browser and measure where things actually end up.
 */

const test = base.extend<{ backend: MockBackend; pageErrors: void }>({
  // Every test gets the fake signed-in owner, fake /api/** answers and fake realtime socket.
  backend: [async ({ page }, provide) => { await provide(await installMockBackend(page)); }, { auto: true }],
  // None of the scenarios may throw an uncaught error in the page.
  pageErrors: [async ({ page }, provide) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await provide();
    expect(errors, 'the page must not throw errors').toEqual([]);
  }, { auto: true }],
});

type Rect = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

const PHONES = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 720, height: 1024 }, // the widest size that still gets the phone layout
];
const PHONE = PHONES[1];
const DESKTOP = { width: 1280, height: 800 };
const { amina, wanjiku } = CUSTOMERS;

// ---------------------------------------------------------------- helpers

/** Position and size on screen, whole pixels, never "-0". */
async function rectOf(page: Page, selector: string): Promise<Rect> {
  return page.locator(selector).first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { x: Math.round(box.x) + 0, y: Math.round(box.y) + 0, width: Math.round(box.width), height: Math.round(box.height) };
  });
}

const screenSize = (page: Page) => page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
const activeTab = (page: Page): Locator => page.locator('.manage-nav-item.active');

/** The chat must cover exactly the whole screen: x 0, y 0, full width, full height. */
async function expectChatFillsScreen(page: Page) {
  const screen = await screenSize(page);
  await expect
    .poll(() => rectOf(page, '.social-thread-detail'), { message: 'the chat should cover exactly the whole screen' })
    .toEqual({ x: 0, y: 0, ...screen });
}

/** Desktop layout: the conversation sits to the right of the list and level with it, not stretched over the screen. */
async function expectSideBySide(page: Page) {
  const screen = await screenSize(page);
  await expect
    .poll(async () => {
      const list = await rectOf(page, '.social-thread-list');
      const detail = await rectOf(page, '.social-thread-detail');
      return {
        listIsOnTheLeft: list.width > 250 && detail.x >= list.x + list.width,
        levelWithEachOther: Math.abs(detail.y - list.y) <= 1,
        conversationIsNotFullScreen: detail.width > 300 && detail.width < screen.width * 0.75,
      };
    }, { message: 'the list and the conversation should sit side by side' })
    .toEqual({ listIsOnTheLeft: true, levelWithEachOther: true, conversationIsNotFullScreen: true });
}

/** The element is fully on screen and nothing (e.g. the bottom menu) is drawn over its middle. */
async function expectUsable(page: Page, selector: string) {
  const result = await page.locator(selector).first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    const onScreen = box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight;
    const topmost = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { onScreen, notCovered: topmost === element || element.contains(topmost) };
  });
  expect(result, `${selector} must be fully on screen and not covered`).toEqual({ onScreen: true, notCovered: true });
}

async function openDashboard(page: Page) {
  await page.goto('/owner');
  await expect(page.getByRole('heading', { name: 'My Products' })).toBeVisible();
}

async function openMyCustomers(page: Page) {
  await openDashboard(page);
  await page.getByRole('button', { name: 'My Customers', exact: true }).click();
  await expect(page.locator('.social-thread').first()).toBeVisible();
}

async function openChat(page: Page, customer: string = amina.name) {
  await page.locator('.social-thread', { hasText: customer }).click();
  await expect(page.locator('.social-detail-head strong', { hasText: customer })).toBeVisible();
}

/** A real finger swipe (touch events), as the phone's browser would send it. */
async function swipe(page: Page, from: Point, to: Point) {
  const session = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', point?: Point) =>
    session.send('Input.dispatchTouchEvent', { type, touchPoints: point ? [point] : [] });
  const steps = 10;
  await touch('touchStart', from);
  for (let step = 1; step <= steps; step++) {
    await touch('touchMove', { x: from.x + ((to.x - from.x) * step) / steps, y: from.y + ((to.y - from.y) * step) / steps });
  }
  await touch('touchEnd');
  await session.detach();
}

// ------------------------------------------------------- phones: 320 / 390 / 720

for (const phone of PHONES) {
  test.describe(`on a phone, ${phone.width}px wide`, () => {
    test.use({ viewport: phone, hasTouch: true, isMobile: true });

    test('an opened chat fills the screen exactly and the reply box is fully visible', async ({ page }) => {
      await openMyCustomers(page);
      await openChat(page);

      await expectChatFillsScreen(page);
      for (const part of ['.social-detail-head', '.social-back', '.social-reply textarea', '.social-camera', '.social-send']) {
        await expectUsable(page, part);
      }
      // The reply box sits at the very bottom edge of the screen.
      const reply = await rectOf(page, '.social-reply');
      expect(reply.y + reply.height).toBe(phone.height);
    });

    test('the Back button and the phone Back gesture both return to the customer list', async ({ page }) => {
      await openMyCustomers(page);

      await openChat(page);
      await page.getByRole('button', { name: 'Back to customers' }).click();
      await expect(page.locator('.social-thread-detail')).toBeHidden();
      await expect(page.locator('.social-thread-list')).toBeVisible();

      await openChat(page);
      await page.goBack(); // what the phone's Back gesture / hardware button does
      await expect(page.locator('.social-thread-detail')).toBeHidden();
      await expect(page.locator('.social-thread-list')).toBeVisible();
      await expect(activeTab(page)).toHaveText(/My Customers/); // the gesture only closed the chat
    });

    test('a new-message notification opens that chat full screen', async ({ page, backend }) => {
      await openDashboard(page); // starts on My Products
      await backend.receiveMessage(wanjiku.threadKey, 'Do you have this dress in size 38?');

      const toast = page.locator('.notification-toast-banner');
      await expect(toast).toContainText(wanjiku.name);
      await toast.click();

      await expect(page.locator('.social-detail-head strong', { hasText: wanjiku.name })).toBeVisible();
      await expect(page.locator('.social-bubble.in', { hasText: 'Do you have this dress in size 38?' })).toBeVisible();
      await expectChatFillsScreen(page);
      await expectUsable(page, '.social-reply textarea');
    });

    test('a push notification from the service worker opens that chat full screen too', async ({ page }) => {
      await openDashboard(page); // starts on My Products
      // This is the message the app's service worker posts when a push notification arrives.
      await page.evaluate(({ storeId, threadKey, sender }) => {
        navigator.serviceWorker.dispatchEvent(new MessageEvent('message', {
          data: { type: 'stoyangu-inbox-update', storeId, sender_name: sender, body: 'Is it still available?', platform: 'tiktok', threadKey },
        }));
      }, { storeId: STORE_ID, threadKey: wanjiku.threadKey, sender: wanjiku.name });

      const toast = page.locator('.notification-toast-banner');
      await expect(toast).toContainText(wanjiku.name);
      await toast.click();

      await expect(page.locator('.social-detail-head strong', { hasText: wanjiku.name })).toBeVisible();
      await expectChatFillsScreen(page);
    });

    test('new messages appear live inside an open chat', async ({ page, backend }) => {
      await openMyCustomers(page);
      await openChat(page);

      await backend.receiveMessage(amina.threadKey, 'Are you still there?');
      await expect(page.locator('.social-thread-detail .social-bubble.in', { hasText: 'Are you still there?' })).toBeVisible();
      await expectChatFillsScreen(page);
    });

    test('the chat shrinks to the visible area when the phone keyboard opens, and lets go afterwards', async ({ page }) => {
      const keyboard = 300;
      await openMyCustomers(page);
      await openChat(page);
      expect(await page.evaluate(() => document.body.style.overflow), 'the page behind the chat is locked').toBe('hidden');

      // Pretend a keyboard covers the bottom of the screen: browsers then report a shorter visual viewport.
      await page.evaluate((covered) => {
        const viewport = window.visualViewport!;
        Object.defineProperty(viewport, 'height', { configurable: true, get: () => window.innerHeight - covered });
        viewport.dispatchEvent(new Event('resize'));
      }, keyboard);
      await expect
        .poll(() => rectOf(page, '.social-thread-detail'), { message: 'the chat should end exactly where the keyboard starts' })
        .toEqual({ x: 0, y: 0, width: phone.width, height: phone.height - keyboard });
      await expectUsable(page, '.social-reply textarea'); // the reply box stays above the keyboard

      // Closing the chat releases the page again.
      await page.getByRole('button', { name: 'Back to customers' }).click();
      await expect(page.locator('.social-thread-detail')).toBeHidden();
      expect(await page.evaluate(() => ({
        bodyOverflow: document.body.style.overflow,
        height: document.documentElement.style.getPropertyValue('--chat-viewport-height'),
        top: document.documentElement.style.getPropertyValue('--chat-viewport-top'),
      }))).toEqual({ bodyOverflow: '', height: '', top: '' });
    });

    test('the camera and gallery sheet opens full screen and Back returns to the chat', async ({ page }) => {
      await openMyCustomers(page);
      await openChat(page);

      await page.getByRole('button', { name: 'Open camera and gallery' }).click();
      await expect(page.locator('.media-capture-sheet')).toBeVisible();
      const screen = await screenSize(page);
      await expect.poll(() => rectOf(page, '.media-capture-backdrop')).toEqual({ x: 0, y: 0, ...screen });
      const sheet = await rectOf(page, '.media-capture-sheet');
      expect(sheet.x).toBe(0);
      expect(sheet.width).toBe(screen.width);
      expect(sheet.y + sheet.height).toBe(screen.height); // docked to the bottom of the screen
      await expectUsable(page, '.media-capture-header button');

      // The sheet's own file input is hidden (it used to show up as a raw "Choose Files" strip),
      // and the Gallery button still opens the phone's photo picker.
      const rawPicker = await rectOf(page, '.media-capture-sheet input[type="file"]');
      expect(rawPicker.width, 'the raw file input must not take up space').toBeLessThanOrEqual(1);
      expect(rawPicker.height, 'the raw file input must not take up space').toBeLessThanOrEqual(1);
      const photoPicker = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Browse photos and videos' }).click();
      await photoPicker;

      await page.goBack();
      await expect(page.locator('.media-capture-sheet')).toBeHidden();
      await expect(page.locator('.social-detail-head strong', { hasText: amina.name })).toBeVisible(); // still in the chat
      await expectChatFillsScreen(page);
    });

    test('swiping between My Products and My Customers works, but not inside an open chat', async ({ page }) => {
      await openDashboard(page);

      // Swipe left on My Products -> My Customers.
      const heading = await rectOf(page, '.products-panel .dash-section-head');
      const headingY = heading.y + heading.height / 2;
      await swipe(page, { x: phone.width * 0.85, y: headingY }, { x: phone.width * 0.15, y: headingY });
      await expect(activeTab(page)).toHaveText(/My Customers/);

      // Swiping right inside an open chat must not change tab (it would hide the chat).
      await openChat(page);
      await swipe(page, { x: phone.width * 0.15, y: phone.height / 2 }, { x: phone.width * 0.85, y: phone.height / 2 });
      await page.waitForTimeout(500); // longer than the 0.32s slide, so a wrong switch would have shown by now
      await expect(activeTab(page)).toHaveText(/My Customers/);
      await expectChatFillsScreen(page);

      // Back at the list, swiping right goes to My Products.
      await page.getByRole('button', { name: 'Back to customers' }).click();
      const thread = await rectOf(page, '.social-thread');
      const threadY = thread.y + thread.height / 2;
      await swipe(page, { x: phone.width * 0.15, y: threadY }, { x: phone.width * 0.85, y: threadY });
      await expect(activeTab(page)).toHaveText(/My Products/);
    });
  });
}

// ------------------------------------------------- rotating / resizing a phone

test.describe('resizing between desktop and phone', () => {
  test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

  test('a typed reply draft is kept, and a chat never covers My Products', async ({ page }) => {
    const draft = 'Habari Amina, your order is ready for pickup!';
    const message = page.getByPlaceholder('Message');

    await page.setViewportSize(DESKTOP);
    await openMyCustomers(page);
    await openChat(page);
    await message.fill(draft);

    // Desktop -> phone: the chat goes full screen, the draft is still there.
    await page.setViewportSize(PHONE);
    await expectChatFillsScreen(page);
    await expect(message).toHaveValue(draft);

    // Phone -> desktop: the chat returns next to the list, draft still there.
    await page.setViewportSize(DESKTOP);
    await expect(message).toHaveValue(draft);
    await expectSideBySide(page);

    // The exact breakpoint: 720px is a phone, 721px is desktop.
    await page.setViewportSize({ width: 720, height: 900 });
    await expectChatFillsScreen(page);
    await page.setViewportSize({ width: 721, height: 900 });
    await expectSideBySide(page);
    await expect(message).toHaveValue(draft);

    // Leave the conversation open but go to My Products, then shrink to a phone.
    await page.setViewportSize(DESKTOP);
    await page.getByRole('button', { name: 'My Products', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'My Products' })).toBeVisible();
    await page.setViewportSize(PHONE);
    await expect(page.locator('.social-thread-detail')).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const centre = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return Boolean(centre?.closest('.owner-swipe-page-products'));
    }), { message: 'what is drawn in the middle of the screen should be My Products' }).toBe(true);
  });
});

// ----------------------------------------------------------------- desktop

test.describe('on a desktop', () => {
  test.use({ viewport: DESKTOP });

  test('the customer list and the conversation sit side by side', async ({ page }) => {
    await openMyCustomers(page);
    await openChat(page);

    await expectSideBySide(page);
    await expectUsable(page, '.social-thread-list .social-thread');
    await expectUsable(page, '.social-reply textarea');
  });
});
