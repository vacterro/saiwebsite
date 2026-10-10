import { test, expect } from '@playwright/test';

/**
 * First-time technical visitor journey: Home -> Introduction -> Quickstart
 * -> concepts -> recovery -> spec -> limitations. Each test pins a concrete
 * discoverability or navigation behavior; failures must be inspected (fix
 * the app when wrong, the test when the expectation is wrong).
 */
test.describe('first-time visitor journey', () => {
  test('home exposes Get started and it reaches the quickstart', async ({ page }) => {
    await page.goto('/');
    const cta = page.getByRole('link', { name: /get started/i }).first();
    await expect(cta).toBeVisible();
    await cta.click();
    await expect(page).toHaveURL(/\/docs\/getting-started\/quickstart\/$/);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('home hero keeps its copy, command example and CTA buttons', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.hero__body h1')).toBeVisible();
    await expect(page.locator('.hero__cmd')).toBeVisible();
    for (const name of [/get started/i, /read the spec/i, /recovery/i, /github/i]) {
      await expect(page.locator('.hero__body').getByRole('link', { name }).first()).toBeVisible();
    }
  });

  test('home hero artwork holds its 16:9 frame beside the copy without overlap', async ({ page }) => {
    await page.goto('/');
    const img = page.locator('.hero__cosmos');
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute('alt', /.+/);
    // Explicit dimensions reserve the box before the bytes arrive (no CLS).
    await expect(img).toHaveAttribute('width', '480');
    await expect(img).toHaveAttribute('height', '270');
    const frame = await img.boundingBox();
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2);
    const copy = await page.locator('.hero__body').boundingBox();
    const art = await page.locator('.hero__art').boundingBox();
    expect(art.x).toBeGreaterThanOrEqual(copy.x + copy.width - 1);
    expect(art.y + art.height).toBeLessThanOrEqual(copy.y + copy.height + 1);
    expect(art.y).toBeGreaterThanOrEqual(copy.y - 1);
  });

  // The project config runs browsers with reduced-motion: the hero must
  // serve the static first frame there and never download the animation.
  test('home hero serves the static frame under reduced-motion', async ({ page }) => {
    const seen = [];
    page.on('request', (r) => { if (r.url().includes('saipen-cosmos')) seen.push(r.url()); });
    await page.goto('/');
    const img = page.locator('.hero__cosmos');
    await expect(img).toBeVisible();
    expect(await img.evaluate((el) => el.currentSrc)).toMatch(/saipen-cosmos-still\.png$/);
    expect(seen.some((u) => u.endsWith('saipen-cosmos.gif'))).toBe(false);
  });

  test('home hero still delivers a decodable 200 with the right MIME under reduced-motion', async ({ page }) => {
    const responses = [];
    page.on('response', (r) => { if (r.url().includes('saipen-cosmos')) responses.push(r); });
    await page.goto('/');
    const img = page.locator('.hero__cosmos');
    await expect(img).toBeVisible();
    // A correct currentSrc alone proves nothing: the response must succeed
    // and the bytes must decode at their declared 480x270 size.
    expect(responses).toHaveLength(1);
    expect(responses[0].url()).toMatch(/saipen-cosmos-still\.png$/);
    expect(responses[0].status()).toBe(200);
    expect(await responses[0].headerValue('content-type')).toMatch(/image\/png/);
    const decoded = await img.evaluate((el) => ({
      complete: el.complete,
      naturalWidth: el.naturalWidth,
      naturalHeight: el.naturalHeight,
      decodeOk: el.decode ? true : 'no-decode-api',
    }));
    expect(decoded.complete).toBe(true);
    expect(decoded.naturalWidth).toBe(480);
    expect(decoded.naturalHeight).toBe(270);
    await expect(img.evaluate((el) => el.decode().then(() => true))).resolves.toBe(true);
    const frame = await img.boundingBox();
    expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test.describe('hero animation without reduced-motion', () => {
    test.use({ reducedMotion: 'no-preference' });
    test('serves the looping original, still framed at 16:9', async ({ page }) => {
      await page.goto('/');
      const img = page.locator('.hero__cosmos');
      await expect(img).toBeVisible();
      expect(await img.evaluate((el) => el.currentSrc)).toMatch(/saipen-cosmos\.webp$/);
      // The GIF stays in the markup as the compatible fallback.
      await expect(img).toHaveAttribute('src', /saipen-cosmos\.gif$/);
      const frame = await img.boundingBox();
      expect(frame.width / frame.height).toBeCloseTo(16 / 9, 2);
    });

    test('animation downloads once, decodes, and costs less than the GIF', async ({ page }) => {
      const responses = [];
      page.on('response', (r) => { if (r.url().includes('saipen-cosmos')) responses.push(r); });
      await page.goto('/');
      const img = page.locator('.hero__cosmos');
      await expect(img).toBeVisible();
      const urls = responses.map((r) => r.url());
      // Exactly one animation download, and it must be the WebP: the GIF
      // fallback and the reduced-motion PNG stay on the shelf.
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
      expect(decoded.complete).toBe(true);
      expect(decoded.naturalWidth).toBe(480);
      expect(decoded.naturalHeight).toBe(270);
      await expect(img.evaluate((el) => el.decode().then(() => true))).resolves.toBe(true);
    });

    test('hero copy and artwork never overlap on desktop', async ({ page }) => {
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

  test('docs tree marks the current page', async ({ page }) => {
    await page.goto('/docs/getting-started/quickstart/');
    const current = page.locator('.tree__group a[aria-current="page"]');
    await expect(current.first()).toBeVisible();
    for (const href of await current.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
      expect(href).toMatch(/quickstart/);
    }
  });

  test('pager moves between adjacent docs pages', async ({ page }) => {
    await page.goto('/docs/getting-started/quickstart/');
    const next = page.locator('a[rel="next"]');
    if ((await next.count()) === 0) {
      const prev = page.locator('a[rel="prev"]');
      await expect(prev.first()).toBeVisible();
      await prev.first().click();
      await expect(page).toHaveURL(/\/docs\//);
    } else {
      await next.first().click();
      await expect(page).toHaveURL(/\/docs\//);
    }
    await expect(page.locator('h1')).toBeVisible();
  });

  test('heading anchors support direct navigation', async ({ page }) => {
    await page.goto('/docs/getting-started/introduction/#what-persists');
    await expect(page.locator('#what-persists')).toBeVisible();
  });

  test('code blocks do not force page overflow at 390px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/getting-started/quickstart/');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('back and forward restore docs pages', async ({ page }) => {
    await page.goto('/docs/getting-started/quickstart/');
    await page.goto('/docs/getting-started/introduction/');
    await page.goBack();
    await expect(page).toHaveURL(/quickstart/);
    await page.goForward();
    await expect(page).toHaveURL(/introduction/);
  });

  test('docs remain readable and linked without JavaScript', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/docs/getting-started/introduction/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#what-persists')).toBeVisible();
    await page.locator('a[href*="quickstart"]').first().click();
    await expect(page).toHaveURL(/quickstart/);
    await context.close();
  });
});
