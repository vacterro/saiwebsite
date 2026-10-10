import { test, expect } from '@playwright/test';

/**
 * Cosmos media-delivery contract (narrow scope, both engines).
 *
 * docs-journey owns the full visitor narrative on Chromium; this suite
 * owns exactly what ships over the wire and decodes on screen, and it
 * runs on Chromium AND WebKit (playwright.config testMatch +
 * BROWSER_SUITES). Animation TIMING and LOOPING are owned by the
 * deterministic Python metadata contract (`npm run validate:media`:
 * 128 frames, ~8 s, infinite loop, first-frame identity) -- a passing
 * `image.decode()` proves the bytes render at 480x270, never that the
 * frames advance, so no time-based frame assertions live here.
 */
test.describe('cosmos media delivery', () => {
  test('reduced-motion serves the still: 200 PNG, decoded, no animation bytes', async ({ page }) => {
    const responses = [];
    page.on('response', (r) => { if (r.url().includes('saipen-cosmos')) responses.push(r); });
    await page.goto('/');
    const img = page.locator('.hero__cosmos');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => el.currentSrc)).toMatch(/saipen-cosmos-still\.png$/);
    expect(responses).toHaveLength(1);
    expect(responses[0].status()).toBe(200);
    expect(await responses[0].headerValue('content-type')).toMatch(/image\/png/);
    const decoded = await img.evaluate((el) => ({
      complete: el.complete,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
    }));
    expect(decoded).toEqual({ complete: true, naturalWidth: 480, naturalHeight: 270 });
    await expect(img.evaluate((el) => el.decode().then(() => true))).resolves.toBe(true);
  });

  test.describe('without reduced-motion', () => {
    test.use({ reducedMotion: 'no-preference' });

    test('normal motion serves the animated WebP framed at 16:9, GIF kept as fallback', async ({ page }) => {
      await page.goto('/');
      const img = page.locator('.hero__cosmos');
      await expect(img).toBeVisible();
      expect(await img.evaluate((el) => el.currentSrc)).toMatch(/saipen-cosmos\.webp$/);
      await expect(img).toHaveAttribute('src', /saipen-cosmos\.gif$/);
      const frame = await img.boundingBox();
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2);
    });

    test('exactly one animation download: 200 WebP smaller than the GIF, decoded', async ({ page }) => {
      const responses = [];
      page.on('response', (r) => { if (r.url().includes('saipen-cosmos')) responses.push(r); });
      await page.goto('/');
      const img = page.locator('.hero__cosmos');
      await expect(img).toBeVisible();
      const urls = responses.map((r) => r.url());
      expect(urls.filter((u) => u.endsWith('saipen-cosmos.webp'))).toHaveLength(1);
      expect(urls.some((u) => u.endsWith('saipen-cosmos.gif'))).toBe(false);
      expect(urls.some((u) => u.endsWith('saipen-cosmos-still.png'))).toBe(false);
      const webp = responses.find((r) => r.url().endsWith('saipen-cosmos.webp'));
      expect(webp.status()).toBe(200);
      expect(await webp.headerValue('content-type')).toMatch(/image\/webp/);
      expect((await webp.body()).length).toBeLessThan(8_177_970);
      const decoded = await img.evaluate((el) => ({
        complete: el.complete,
        naturalWidth: el.naturalWidth,
        naturalHeight: el.naturalHeight,
      }));
      expect(decoded).toEqual({ complete: true, naturalWidth: 480, naturalHeight: 270 });
      await expect(img.evaluate((el) => el.decode().then(() => true))).resolves.toBe(true);
    });

    test('desktop keeps copy and artwork apart without horizontal overflow', async ({ page }) => {
      await page.goto('/');
      const img = page.locator('.hero__cosmos');
      await expect(img).toBeVisible();
      const boxes = await page.locator('.hero__body .row, .hero__art').evaluateAll((els) =>
        els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
      const [cta, art] = boxes;
      const overlaps = cta.x < art.x + art.w && art.x < cta.x + cta.w && cta.y < art.y + art.h && art.y < cta.y + cta.h;
      expect(overlaps).toBe(false);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });

    test('mobile stacks the artwork below the CTA group without overflow', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto('/');
      const img = page.locator('.hero__cosmos');
      await expect(img).toBeVisible();
      const boxes = await page.locator('.hero__body .row, .hero__art').evaluateAll((els) =>
        els.map((el) => { const r = el.getBoundingClientRect(); return { y: r.y, h: r.height }; }));
      const [cta, art] = boxes;
      expect(art.y).toBeGreaterThanOrEqual(cta.y + cta.h - 1);
      const frame = await img.boundingBox();
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
    });
  });
});
