import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';

/**
 * Locale variants (content-system roadmap M42, M47, M48).
 *
 * Every locale route the inventory registers — today the qps-ploc
 * pseudo-locale, later every translated locale — is checked for what a
 * translation can break and the static gates cannot see:
 *   - it answers 200 and declares its language on <html>;
 *   - no raw block ID reaches the page;
 *   - longer, accented text does not push the page into horizontal overflow
 *     at 320 / 390 / 1280 px;
 *   - the language selector works without JavaScript and marks the current
 *     locale;
 *   - a localized search runs against the locale's own index.
 * Pixel closure of the same routes is proven by tests/pixel-perfect.spec.mjs,
 * which walks every built page.
 */

const inventory = JSON.parse(readFileSync('src/content-engine/inventory/pages.inventory.json', 'utf8'));
const VARIANTS = [...inventory.public, ...inventory.internal].filter((r) => r.locale !== 'en' && r.kind !== 'machine');
const RAW_KEY = /\b(?:ui|pages|home|about|pricing|search|notfound|docs-ui)\.[a-z0-9-]+\.[a-z0-9.-]+\b/;
const WIDTHS = [320, 390, 1280];

test('the inventory registers locale variants to check', () => {
  expect(VARIANTS.length).toBeGreaterThan(0);
});

for (const r of VARIANTS) {
  test.describe(`${r.route} (${r.locale})`, () => {
    test('answers 200, declares its language, shows no raw block ID', async ({ page }) => {
      const response = await page.goto(r.route);
      expect(response.status()).toBe(200);
      await expect(page.locator('html')).toHaveAttribute('lang', r.locale);
      const text = await page.locator('body').innerText();
      expect(text, 'a block ID leaked into the page').not.toMatch(RAW_KEY);
    });

    for (const width of WIDTHS) {
      test(`no horizontal overflow at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(r.route);
        // Same measure as the shell suite: content inside a scroll container
        // (wide tables, code blocks) may be wider; the page itself may not.
        const overflow = await page.evaluate(() => {
          const root = document.documentElement;
          const scrollable = (el) => {
            for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
              const value = getComputedStyle(node).overflowX;
              if (value === 'auto' || value === 'scroll') return true;
            }
            return false;
          };
          return {
            scroll: root.scrollWidth,
            client: root.clientWidth,
            offenders: [...document.querySelectorAll('body *')]
              .filter((el) => el.getBoundingClientRect().right > root.clientWidth + 1 && !scrollable(el))
              .slice(0, 5)
              .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
          };
        });
        expect(overflow.offenders, `overflowing elements on ${r.route}`).toEqual([]);
        expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
      });
    }
  });
}

test.describe('language selector', () => {
  test.use({ javaScriptEnabled: false });

  test('lists the locale variants of the page and marks the current one', async ({ page }) => {
    const target = VARIANTS.find((r) => r.variantOf === 'about');
    test.skip(!target, 'no locale variant of /about/ is built');
    await page.goto(target.route);
    const bar = page.locator('nav.w-langbar');
    await expect(bar).toHaveCount(1);
    await expect(bar.locator('a[aria-current="true"]')).toHaveAttribute('hreflang', target.locale);
    await bar.locator('a[hreflang="en"]').click();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});

test('localized search reads the locale index', async ({ page }) => {
  const search = VARIANTS.find((r) => r.variantOf === 'search');
  const index = [...inventory.public, ...inventory.internal].find((r) => r.variantOf === 'machine.search-index' && r.locale === search?.locale);
  test.skip(!search || !index, 'no localized search with its own index is built');
  const entries = await (await page.request.get(index.route)).json();
  expect(entries.length).toBeGreaterThan(0);
  const word = entries[0].title.split(/\s+/).find((w) => w.length > 3).replace(/[«»]/g, '');
  await page.goto(`${search.route}?q=${encodeURIComponent(word)}`);
  const first = page.locator('[data-results] a').first();
  await expect(first).toHaveAttribute('href', new RegExp(`^/${search.locale.toLowerCase()}/`));
});
