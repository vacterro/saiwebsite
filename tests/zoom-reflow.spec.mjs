import { test, expect } from '@playwright/test';

/**
 * Zoom and reflow conditions (Wave 3B).
 *
 * METHOD RECORDED: Playwright cannot drive real browser zoom; these tests
 * use narrow CSS viewports as the reflow equivalent (640 CSS px ~= 200% zoom
 * on a 1280 CSS px layout; 320 CSS px covers 400% conditions and the narrow
 * mobile viewport). This verifies reflow behavior, not the browser's own
 * zoom machinery. Forced-colors and reduced-motion use real browser
 * emulation, not substitutes.
 */
const ROUTES = ['/', '/pricing/', '/docs/getting-started/quickstart/', '/search/'];

for (const width of [640, 320]) {
  test.describe(`reflow at ${width}px CSS width`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
    });

    for (const route of ROUTES) {
      test(`${route} has no page-level horizontal overflow`, async ({ page }) => {
        await page.goto(route);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${route} overflow at ${width}px`).toBeLessThanOrEqual(1);
      });
    }

    test('primary actions stay visible and enabled', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: /get started/i }).first()).toBeVisible();
      await page.goto('/search/');
      await expect(page.locator('#q')).toBeVisible();
      await expect(page.locator('.w-button--primary')).toBeEnabled();
    });
  });
}

test.describe('forced settings', () => {
  test('forced-colors mode keeps controls visible', async ({ browser }) => {
    const context = await browser.newContext({ forcedColors: 'active' });
    const page = await context.newPage();
    await page.goto('/pricing/');
    await expect(page.locator('.js-copy').first()).toBeVisible();
    await page.goto('/');
    await expect(page.getByRole('link', { name: /get started/i }).first()).toBeVisible();
    await context.close();
  });

  test('reduced-motion keeps the stepper fully usable', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto('/playground/provider-outage/');
    await page.locator('[data-next]').click();
    await expect(page.locator('[data-count]')).toHaveText(/^Step 2 of /);
    await context.close();
  });

  test('skip link is first in tab order', async ({ page }) => {
    await page.goto('/search/');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => document.activeElement?.textContent?.trim());
    expect(first, 'first Tab stop must be the skip link').toMatch(/skip/i);
  });

  test('real Tab walk reaches search input then submit, Shift+Tab reverses', async ({ page }) => {
    await page.goto('/search/');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    let seenQ = -1, seenSubmit = -1;
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      const id = await page.evaluate(() => document.activeElement?.id);
      if (id === 'q' && seenQ < 0) seenQ = i;
      const isSubmit = await page.evaluate(() => {
        const a = document.activeElement;
        return a?.tagName === 'BUTTON' && a?.getAttribute('type') === 'submit';
      });
      if (isSubmit && seenSubmit < 0) seenSubmit = i;
      if (seenQ >= 0 && seenSubmit >= 0) break;
    }
    expect(seenQ, 'Tab must reach #q').toBeGreaterThanOrEqual(0);
    expect(seenSubmit, 'Tab must reach the submit button').toBeGreaterThanOrEqual(0);
    expect(seenSubmit, 'submit follows the input in tab order').toBeGreaterThan(seenQ);
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => document.activeElement?.id), 'Shift+Tab returns to #q').toBe('q');
  });

  test('search works without a mouse: type, Enter, results announce', async ({ page }) => {
    await page.goto('/search/');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      if ((await page.evaluate(() => document.activeElement?.id)) === 'q') break;
    }
    await page.keyboard.type('checkpoint');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-status]')).toContainText(/results? for/i);
    await expect(page.locator('.search__hit').first()).toBeVisible();
  });

  test('long search input causes no page overflow and reports honestly', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto('/search/?q=' + encodeURIComponent('x'.repeat(500)));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'long query must not overflow the page').toBeLessThanOrEqual(1);
    await expect(page.locator('[data-status]')).not.toBeEmpty();
  });

  test('copy works through the keyboard: Tab, Enter, status announces', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('/pricing/');
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    let found = false;
    for (let i = 0; i < 80; i++) {
      await page.keyboard.press('Tab');
      const cls = await page.evaluate(() => document.activeElement?.className?.baseVal ?? document.activeElement?.className);
      if (String(cls).includes('js-copy')) { found = true; break; }
    }
    expect(found, 'Tab must reach a copy button').toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('.js-copy:focus')).toHaveText('Copied');
  });

  test('visible focus renders on interactive controls', async ({ page }) => {
    for (const [route, sel] of [['/search/', '#q'], ['/pricing/', '.js-copy']]) {
      await page.goto(route);
      await page.locator(sel).first().focus();
      const w = await page.evaluate(
        (s) => parseFloat(getComputedStyle(document.querySelector(s)).outlineWidth),
        sel,
      );
      expect(w, `${route} ${sel} focused outline width`).toBeGreaterThan(0);
    }
  });

  test('native disclosure operates from the keyboard', async ({ page }) => {
    await page.goto('/docs/getting-started/introduction/');
    const summary = page.locator('summary').first();
    await summary.focus();
    await expect(summary).toBeFocused();
    const wasOpen = await summary.evaluate((el) => el.parentElement.hasAttribute('open'));
    await page.keyboard.press('Enter');
    await expect
      .poll(async () => summary.evaluate((el) => el.parentElement.hasAttribute('open')))
      .toBe(!wasOpen);
  });

  test('keyboard theme change preserves focus and applies the theme', async ({ page }) => {
    await page.goto('/');
    const select = page.locator('#theme-select');
    await select.focus();
    await select.selectOption('dracula');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
    expect(await page.evaluate(() => document.activeElement?.id), 'focus stays on the theme control').toBe('theme-select');
  });
});
