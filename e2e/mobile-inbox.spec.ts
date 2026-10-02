import type { Page } from '@playwright/test';
import {
  activeTab, chatPanel, expect, expectFillsScreen, expectNotCovered, expectOnScreen,
  openChat, openMyCustomers, requireBox, showNewMessageBanner, swipe, test, viewportOf,
} from './support/ownerApp';

/**
 * Regression tests for the "My Customers" chat on phones.
 *
 * The bug: on a phone an opened chat was twice as wide as the screen (x = -390, width = 780 on a
 * 390px phone) and its reply box was pushed below the screen. The My Products / My Customers pager
 * slides with a CSS transform, and a transformed parent turns every "position: fixed" child (the
 * chat and the camera/gallery sheet) into a child of the pager instead of the screen.
 * The chat and the sheet are now rendered straight into <body>, outside the pager.
 *
 * The tests also guard the things that must keep working: Back, notifications, swiping, the
 * two-column layout on big screens, and keeping a half-typed reply while the window changes size.
 */

const ALICE = 'Alice Wanjiru';
const DRAFT = 'Thanks Alice, the blue dress is KES 2,500!';

const replyBox = (page: Page) => page.getByPlaceholder('Message');
const openMenu = (page: Page, tab: 'My Products' | 'My Customers') => page.getByRole('button', { name: tab, exact: true });

// ---------------------------------------------------------------------------------------------
// The bug itself, on small, typical and widest-"phone" screens (the phone layout ends at 720px)
// ---------------------------------------------------------------------------------------------
for (const phone of [
  { label: 'small phone (320px)', width: 320, height: 640 },
  { label: 'typical phone (390px)', width: 390, height: 844 },
  { label: 'widest phone layout (720px)', width: 720, height: 900 },
]) {
  test.describe(`chat on a ${phone.label}`, () => {
    test.use({ viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true });

    test('an opened chat fills the whole screen', async ({ page }) => {
      await openChat(page, ALICE);
      await expectFillsScreen(page, chatPanel(page));
    });

    test('the reply box is fully on screen and not hidden behind the bottom menu', async ({ page }) => {
      await openChat(page, ALICE);
      await expectOnScreen(page, page.locator('.social-reply'));
      await expectNotCovered(replyBox(page));
      await expectNotCovered(page.getByRole('button', { name: 'Open camera and gallery' }));
      await expectNotCovered(page.getByRole('button', { name: 'Send message' }));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Everything that has to keep working on a typical phone
// ---------------------------------------------------------------------------------------------
test.describe('chat on a typical phone (390px): navigation, pop-ups and swiping', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the Back arrow returns to the customer list', async ({ page }) => {
    await openChat(page, ALICE);
    await page.getByRole('button', { name: 'Back to customers' }).click();
    await expect(chatPanel(page)).toBeHidden();
    await expectNotCovered(page.locator('.social-thread').first());
  });

  test('the phone Back gesture returns to the customer list without leaving the app', async ({ page }) => {
    await openChat(page, ALICE);
    await page.goBack();
    await expect(chatPanel(page)).toBeHidden();
    await expectNotCovered(page.locator('.social-thread').first());
    expect(new URL(page.url()).pathname).toBe('/owner');
  });

  test('the camera and gallery sheet covers the screen, and Back returns to the same chat', async ({ page }) => {
    await openChat(page, ALICE);
    await page.getByRole('button', { name: 'Open camera and gallery' }).click();

    await expectFillsScreen(page, page.locator('.media-capture-backdrop'));
    const { width, height } = viewportOf(page);
    await expect.poll(async () => {
      const sheet = await requireBox(page.getByRole('dialog'));
      return { left: sheet.x, right: sheet.x + sheet.width, bottom: sheet.y + sheet.height };
    }).toEqual({ left: 0, right: width, bottom: height });
    await expectNotCovered(page.getByRole('button', { name: 'Close media picker' }));

    await page.goBack();
    await expect(page.locator('.media-capture-backdrop')).toHaveCount(0);
    await expectFillsScreen(page, chatPanel(page));
    await expect(chatPanel(page)).toContainText(ALICE);
  });

  test('tapping a new-message banner opens that customer\u2019s chat full-screen', async ({ page }) => {
    await openMyCustomers(page);
    await showNewMessageBanner(page, { threadKey: 'dm:brian', name: 'Brian Otieno' }, 'Hello, are you still open?');
    await page.locator('.notification-toast-banner').click();
    await expect(chatPanel(page)).toContainText('Brian Otieno');
    await expectFillsScreen(page, chatPanel(page));
  });

  test('tapping a new-message banner while on My Products switches to My Customers and opens the chat', async ({ page }) => {
    await page.goto('/owner');
    await expect(activeTab(page)).toContainText('My Products');
    await showNewMessageBanner(page, { threadKey: 'dm:cynthia', name: 'Cynthia Mutua' }, 'Please send photos');
    await page.locator('.notification-toast-banner').click();
    await expect(activeTab(page)).toContainText('My Customers');
    await expect(chatPanel(page)).toContainText('Cynthia Mutua');
    await expectFillsScreen(page, chatPanel(page));
  });

  test('swiping moves between My Products and My Customers, but never while a chat is open', async ({ page }) => {
    const { width } = viewportOf(page);
    await page.goto('/owner');
    await expect(activeTab(page)).toContainText('My Products');

    // Swipe left, starting on a product's name (plain text, not a button), to reach My Customers.
    const productName = await requireBox(page.locator('.owner-product-card h3').first());
    const productRow = productName.y + productName.height / 2;
    await swipe(page, { x: productName.x + productName.width - 10, y: productRow }, { x: 20, y: productRow });
    await expect(activeTab(page)).toContainText('My Customers');
    await expectOnScreen(page, page.locator('.social-thread').first());

    // Swipe right, starting on the "My Customers" heading, to go back.
    const heading = await requireBox(page.locator('.social-inbox-head h2'));
    const headingRow = heading.y + heading.height / 2;
    await swipe(page, { x: 20, y: headingRow }, { x: width - 20, y: headingRow });
    await expect(activeTab(page)).toContainText('My Products');

    // With a chat open, swipes in either direction must not change tab or close the chat.
    await openMyCustomers(page);
    await page.locator('.social-thread', { hasText: ALICE }).click();
    await expectFillsScreen(page, chatPanel(page));
    await swipe(page, { x: 40, y: 400 }, { x: width - 40, y: 400 });
    await swipe(page, { x: width - 40, y: 300 }, { x: 40, y: 300 });
    await expect(activeTab(page)).toContainText('My Customers');
    await expectFillsScreen(page, chatPanel(page));

    // After closing the chat, swiping works again.
    await page.getByRole('button', { name: 'Back to customers' }).click();
    await expect(chatPanel(page)).toBeHidden();
    await swipe(page, { x: 20, y: headingRow }, { x: width - 20, y: headingRow });
    await expect(activeTab(page)).toContainText('My Products');
  });

  test('a half-typed reply survives rotating the phone', async ({ page }) => {
    await openChat(page, ALICE);
    await replyBox(page).fill(DRAFT);

    await page.setViewportSize({ width: 844, height: 390 }); // landscape is wide enough for two columns
    await expect(replyBox(page)).toHaveValue(DRAFT);
    await expect.poll(async () => {
      const list = await requireBox(page.locator('.social-thread-list'));
      const chat = await requireBox(chatPanel(page));
      return list.x + list.width <= chat.x + 1;
    }).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectFillsScreen(page, chatPanel(page));
    await expect(replyBox(page)).toHaveValue(DRAFT);
  });
});

// ---------------------------------------------------------------------------------------------
// Big screens keep their two-column layout
// ---------------------------------------------------------------------------------------------
test.describe('chat in a computer-sized window (1280px)', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('the customer list and the conversation sit side by side, in place', async ({ page }) => {
    await openChat(page, ALICE);
    const list = await requireBox(page.locator('.social-thread-list'));
    const chat = await requireBox(chatPanel(page));
    expect(list.x + list.width).toBeLessThanOrEqual(chat.x + 1);
    expect(Math.abs(list.y - chat.y)).toBeLessThanOrEqual(4);
    await expectOnScreen(page, page.locator('.social-reply'));
    await expect(chatPanel(page)).toHaveCSS('position', 'static'); // not a full-screen overlay
    await expect(page.locator('body > .social-chat-overlay')).toHaveCount(0);
  });

  test('the camera and gallery sheet is a centred pop-up over the page', async ({ page }) => {
    await openChat(page, ALICE);
    await page.getByRole('button', { name: 'Open camera and gallery' }).click();
    await expectFillsScreen(page, page.locator('.media-capture-backdrop'));
    await expect.poll(async () => {
      const sheet = await requireBox(page.getByRole('dialog'));
      return Math.abs(sheet.x + sheet.width / 2 - 640) <= 2;
    }).toBe(true);
  });

  test('shrinking the window to phone size makes the chat full-screen and keeps the typed reply', async ({ page }) => {
    await openChat(page, ALICE);
    await replyBox(page).fill(DRAFT);

    await page.setViewportSize({ width: 390, height: 844 });
    await expectFillsScreen(page, chatPanel(page));
    await expectOnScreen(page, page.locator('.social-reply'));
    await expect(replyBox(page)).toHaveValue(DRAFT);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(chatPanel(page)).toHaveCSS('position', 'static');
    await expect(page.locator('body > .social-chat-overlay')).toHaveCount(0);
    await expect(replyBox(page)).toHaveValue(DRAFT);
  });

  test('a chat left open never covers My Products when the window is made phone-sized', async ({ page }) => {
    await openChat(page, ALICE);
    await replyBox(page).fill(DRAFT);
    await openMenu(page, 'My Products').click();
    await page.setViewportSize({ width: 390, height: 844 });

    await expect(activeTab(page)).toContainText('My Products');
    // Whatever is in the middle of the screen belongs to My Products, not to the chat.
    await expect.poll(() => page.evaluate(() => {
      const hit = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      return Boolean(hit?.closest('.owner-swipe-page-products')) && !hit?.closest('.social-thread-detail');
    })).toBe(true);
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden'); // page is not scroll-locked

    // Going back to My Customers brings the chat back, full-screen, with the typed reply.
    await openMenu(page, 'My Customers').click();
    await expectFillsScreen(page, chatPanel(page));
    await expect(replyBox(page)).toHaveValue(DRAFT);
  });
});
