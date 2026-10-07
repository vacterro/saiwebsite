import { test, expect } from '@playwright/test';

/**
 * First visual regression baselines (WINTAGE_WEB_CONTRACT §25).
 *
 * Canonical condition, deliberately narrow: Chromium, 1280x720 CSS viewport,
 * devicePixelRatio 1, Golden Default, page top. One baseline per route instead
 * of a cross-browser matrix, and one reduced theme smoke, because the useful
 * fact here is "the shell still renders after a palette swap" rather than
 * sixteen near-identical screenshots.
 *
 * Generate or refresh with `npm run test:visual:update`; the plain run compares
 * and fails on any pixel difference (threshold 0 — a Wintage surface is flat
 * colour and hard edges, so there is nothing legitimately fuzzy to forgive).
 */

const STORAGE_KEY = 'sai-website.theme';

const PAGES = [
  ['home', '/'],
  ['docs', '/docs/'],
  ['spec', '/spec/'],
  ['ecosystem', '/ecosystem/'],
  ['pricing', '/pricing/'],
  ['doc-introduction', '/docs/getting-started/introduction/'],
  ['spec-lifecycle', '/spec/v8/lifecycle/'],
  ['compatibility', '/compatibility/'],
  ['playground', '/playground/provider-outage/'],
  ['security', '/security/'],
  ['debug-components', '/debug/components/'],
  ['debug-themes', '/debug/themes/'],
  ['debug-rendering', '/debug/rendering/'],
];

const SHOT = { animations: 'disabled', caret: 'hide', scale: 'css', maxDiffPixels: 0 };

/**
 * Narrow-viewport baselines (MASTER_ROADMAP M4). Deliberately small: the shell
 * swap is one piece of CSS on every route, so three routes cover the three
 * shapes that differ — the homepage (no breadcrumb), a layout page, and a
 * reserved placeholder. 390x844 is a phone in CSS pixels at DPR 1, the same
 * canonical condition as the desktop set.
 */
const MOBILE_PAGES = [
  ['home-mobile', '/'],
  ['docs-mobile', '/docs/'],
  ['status-mobile', '/status/'],
];

test.describe('visual baselines — Golden Default, Chromium, 1280x720, DPR 1', () => {
  for (const [name, route] of PAGES) {
    test(`${route}`, async ({ page }) => {
      await page.goto(route);
      // Start from clean storage so the baseline is the canonical first render.
      await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'goldendefault');
      await expect(page).toHaveScreenshot(`${name}.png`, SHOT);
    });
  }
});

test.describe('visual baselines — Golden Default, Chromium, 390x844, DPR 1', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [name, route] of MOBILE_PAGES) {
    test(`${route}`, async ({ page }) => {
      await page.goto(route);
      await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'goldendefault');
      // The compact surface, not the desktop strip, is what a narrow viewport shows.
      await expect(page.locator('nav[aria-label="Site"]')).toBeVisible();
      await expect(page).toHaveScreenshot(`${name}.png`, SHOT);
    });
  }
});

/**
 * Reduced cross-theme coverage (MASTER_ROADMAP M16): every palette, one page,
 * at UI.md's compact target of 640x540 CSS pixels.
 */
const PACKS = [
  'golden', 'claudecode', 'antigravity', 'klite', 'freebuff', 'codenomad', 'fpdefault', 'goldenvintage',
  'goldendefault', 'vintagedark', 'vintageclassic', 'oled', 'dracula', 'nord', 'solarized', 'custom',
];

test.describe('visual baselines — all 16 palettes at 640x540', () => {
  test.use({ viewport: { width: 640, height: 540 } });
  for (const slug of PACKS) {
    test(slug, async ({ page }) => {
      await page.goto('/docs/getting-started/introduction/');
      await page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [STORAGE_KEY, slug]);
      await page.reload();
      await page.evaluate(() => document.fonts.ready);
      await expect(page.locator('html')).toHaveAttribute('data-theme', slug);
      await expect(page).toHaveScreenshot(`palette-${slug}.png`, SHOT);
    });
  }
});

test.describe('visual baseline — reduced theme smoke', () => {
  test('homepage with a strongly different palette persisted', async ({ page }) => {
    await page.goto('/');
    await page.locator('#theme-select').selectOption('dracula');
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
    await expect(page).toHaveScreenshot('home-dracula.png', SHOT);
  });
});
