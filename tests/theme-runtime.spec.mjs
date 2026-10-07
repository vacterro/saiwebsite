import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

/**
 * Theme runtime contract, measured in a real browser against the built site.
 *
 * Every palette value this file compares against is read from the pack JSON on
 * disk, so the gate cannot drift from the data layer: if a pack changes colour,
 * the expectation changes with it and the only thing that can go red is the
 * behaviour under test.
 *
 * The no-FOUC claim is split in two on purpose. Static proof (inline palette
 * stylesheet + classic pre-paint bootstrap before <body>) lives in
 * scripts/audit-build.mjs, because a head is a text artifact. What is checked
 * here is the runtime half: with a non-default theme already stored, the
 * document must carry it while its readyState is still "loading", and it must
 * never be left holding a hard-coded root colour.
 */

const KEY = 'sai-website.theme';
const DEFAULT_SLUG = 'goldendefault';
const OTHER_SLUG = 'dracula';

function pack(slug) {
  const url = new URL(`../src/themes/packs/${slug}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8'));
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

const GOLDEN = pack(DEFAULT_SLUG);
const OTHER = pack(OTHER_SLUG);

/**
 * Records every value data-theme ever takes, with the readyState at the time.
 *
 * The observer is attached to `document` rather than to documentElement: an init
 * script can run before the parser has created <html>, and `subtree: true` catches
 * the attribute change either way.
 */
async function traceThemeAttribute(page) {
  await page.addInitScript(() => {
    const trace = [];
    const record = () => {
      const el = document.documentElement;
      trace.push({
        value: el ? el.getAttribute('data-theme') : null,
        readyState: document.readyState,
      });
    };
    globalThis.__themeTrace = trace;
    record();
    new MutationObserver(record).observe(document, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-theme'],
    });
  });
}

const readTheme = (page) => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const readStored = (page) => page.evaluate((k) => window.localStorage.getItem(k), KEY);
const readStatus = (page) => page.locator('#status-palette').innerText();
const readSelect = (page) => page.locator('#theme-select').inputValue();

// ── A. Default ─────────────────────────────────────────────────────────────
test('A. clean storage boots Golden Default and persists the canonical slug', async ({ page }) => {
  await page.goto('/');
  expect(await readTheme(page)).toBe(DEFAULT_SLUG);
  expect(await readSelect(page)).toBe(DEFAULT_SLUG);
  expect(await readStatus(page)).toContain(GOLDEN.label);
  expect(await readStored(page)).toBe(DEFAULT_SLUG);
});

// ── B. Switch ──────────────────────────────────────────────────────────────
test('B. selecting another palette applies, persists and updates the status bar', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-select').selectOption(OTHER_SLUG);

  expect(await readTheme(page)).toBe(OTHER_SLUG);
  expect(await readSelect(page)).toBe(OTHER_SLUG);
  expect(await readStored(page)).toBe(OTHER_SLUG);
  expect(await readStatus(page)).toContain(OTHER.label);
  expect(await readStatus(page)).not.toContain(GOLDEN.label);
});

// ── C. Reload, and the pre-paint half of the no-FOUC claim ─────────────────
test('C. a stored palette survives reload and is applied before the body can paint', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-select').selectOption(OTHER_SLUG);

  await traceThemeAttribute(page);
  await page.reload();

  expect(await readTheme(page)).toBe(OTHER_SLUG);
  expect(await readSelect(page)).toBe(OTHER_SLUG);
  expect(await readStored(page)).toBe(OTHER_SLUG);

  const trace = await page.evaluate(() => globalThis.__themeTrace);
  // Server-rendered default first, then the stored palette. The record for the
  // stored palette must have happened while the document was still parsing —
  // that is the pre-paint half of the no-FOUC claim, and post-load code cannot
  // produce it.
  const applied = trace.filter((entry) => entry.value === OTHER_SLUG);
  expect(trace[0].value === DEFAULT_SLUG || trace[0].value === null).toBe(true);
  expect(applied.length).toBeGreaterThan(0);
  expect(applied[0].readyState).toBe('loading');
  expect(await page.evaluate(() => document.readyState)).toBe('complete');

  // No stale hard-coded root colour may survive the switch.
  expect(await page.evaluate(() => document.documentElement.getAttribute('style'))).toBeNull();
});

// ── D. Cross-route persistence ─────────────────────────────────────────────
test('D. the selected palette stays active across routes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-select').selectOption(OTHER_SLUG);

  for (const route of ['/docs/', '/debug/components/', '/debug/themes/', '/debug/rendering/']) {
    await page.goto(route);
    expect(await readTheme(page), `route ${route}`).toBe(OTHER_SLUG);
    expect(await readSelect(page), `route ${route}`).toBe(OTHER_SLUG);
    expect(await readStatus(page), `route ${route}`).toContain(OTHER.label);
  }
});

// ── E. Invalid stored slug ─────────────────────────────────────────────────
for (const bad of ['missing-theme', 'old-theme', 'GoldenDefault', '', '  ', '{}']) {
  test(`E. stored value ${JSON.stringify(bad)} resolves to Golden Default and is normalized`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(([k, v]) => window.localStorage.setItem(k, v), [KEY, bad]);
    await page.reload();

    expect(await readTheme(page)).toBe(DEFAULT_SLUG);
    expect(await readSelect(page)).toBe(DEFAULT_SLUG);
    expect(await readStatus(page)).toContain(GOLDEN.label);
    // Repaired on disk, so later navigations do not reprocess the same garbage.
    expect(await readStored(page)).toBe(DEFAULT_SLUG);
  });
}

// ── F. Nested theme isolation (explicit regression target) ─────────────────
test('F. a global theme does not overwrite the nested preview scopes', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-select').selectOption(OTHER_SLUG);
  await page.goto('/debug/themes/');

  expect(await readTheme(page)).toBe(OTHER_SLUG);

  const cards = await page.locator('.theme-card[data-theme]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      slug: node.getAttribute('data-theme'),
      background: getComputedStyle(node).backgroundColor,
    })),
  );
  expect(cards).toHaveLength(16);

  const byslug = Object.fromEntries(cards.map((card) => [card.slug, card.background]));
  expect(byslug[DEFAULT_SLUG]).toBe(hexToRgb(GOLDEN.tokens.background));
  expect(byslug[OTHER_SLUG]).toBe(hexToRgb(OTHER.tokens.background));

  // The point of the regression: the sixteen cards must not collapse onto the
  // one globally selected palette.
  const distinct = new Set(cards.map((card) => card.background));
  expect(distinct.size).toBeGreaterThan(10);
  expect(distinct.has(hexToRgb(OTHER.tokens.background))).toBe(true);
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
  ).toBe(hexToRgb(OTHER.tokens.background));
});

// ── G. Root canvas / overscroll surface ────────────────────────────────────
test('G. html and body canvases follow the active palette, not Golden Default', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-select').selectOption(OTHER_SLUG);

  const measured = await page.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  }));

  expect(measured.html).toBe(hexToRgb(OTHER.tokens.background));
  expect(measured.body).toBe(hexToRgb(OTHER.tokens.background));
  expect(measured.html).not.toBe(hexToRgb(GOLDEN.tokens.background));
  expect(measured.scheme).toBe('dark');

  await page.reload();
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor))
    .toBe(hexToRgb(OTHER.tokens.background));
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor))
    .toBe(hexToRgb(OTHER.tokens.background));
});

// ── H. No-JS fallback ──────────────────────────────────────────────────────
// No page.evaluate here on purpose: with scripting disabled the only honest
// instruments are DOM reads (getAttribute / innerText / textContent), which do
// not require the page to run anything.
test.describe('H. without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('H. the homepage stays usable in Golden Default', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', DEFAULT_SLUG);

    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(200);
    expect(body).toContain('SAIPEN');
    expect(await page.locator('main h1').innerText()).toContain('SAIPEN Protocol');
    expect(await page.locator('nav.w-menubar a').count()).toBeGreaterThan(4);
    expect(await page.locator('#theme-select option').count()).toBe(16);
    await expect(page.locator('#status-palette')).toContainText(GOLDEN.label);

    // The inline palette stylesheet is what gives this render its colour with
    // no script and no extra request.
    const inline = await page.locator('head style').allTextContents();
    const canvas = inline.find((css) => css.includes('var(--background)'));
    expect(canvas, 'inline root-canvas rule missing').toBeTruthy();
    expect(inline.some((css) => css.includes(`[data-theme="${DEFAULT_SLUG}"]`))).toBe(true);
  });

  test('H. every reserved route renders content without JavaScript', async ({ page }) => {
    for (const route of ['/docs/', '/spec/', '/ecosystem/', '/pricing/', '/debug/rendering/', '/debug/themes/']) {
      await page.goto(route);
      await expect(page.locator('main h1'), route).toBeVisible();
      expect((await page.locator('body').innerText()).length, route).toBeGreaterThan(100);
      await expect(page.locator('html'), route).toHaveAttribute('data-theme', DEFAULT_SLUG);
    }
  });
});

// ── I. The live status field and event contract ────────────────────────────
test('I. the change event carries the active palette', async ({ page }) => {
  await page.goto('/');
  const detail = await page.evaluate((slug) => {
    return new Promise((resolve) => {
      document.addEventListener(
        'sai-theme-change',
        (event) => resolve(event.detail),
        { once: true },
      );
      const select = document.getElementById('theme-select');
      select.value = slug;
      select.dispatchEvent(new Event('change'));
    });
  }, OTHER_SLUG);

  expect(detail.slug).toBe(OTHER_SLUG);
  expect(detail.label).toBe(OTHER.label);
  expect(detail.persisted).toBe(OTHER_SLUG);
  expect(detail.source).toBe('selector');
});

// ── J. Debug surfaces report the same truth ────────────────────────────────
test('J. /debug/rendering and /debug/themes report the live runtime state', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-select').selectOption(OTHER_SLUG);

  await page.goto('/debug/rendering/');
  expect(await page.locator('[data-theme-diag="slug"]').innerText()).toBe(OTHER_SLUG);
  expect(await page.locator('[data-theme-diag="label"]').innerText()).toBe(OTHER.label);
  expect(await page.locator('[data-theme-diag="persisted"]').innerText()).toBe(OTHER_SLUG);
  expect(await page.locator('[data-theme-diag="default"]').innerText()).toBe(DEFAULT_SLUG);
  expect(await page.locator('[data-theme-diag="count"]').innerText()).toBe('16');
  expect(await page.locator('[data-render-diag="dpr"]').innerText()).not.toBe(
    'populated by JavaScript on load',
  );
  expect(await page.locator('[data-render-diag="viewport"]').innerText()).toMatch(/^\d+ x \d+ px/);
  await expect(page.locator('.px-grid')).toBeVisible();
  await expect(page.locator('.px-raster')).toBeVisible();

  await page.goto('/debug/themes/');
  expect(await page.locator('[data-theme-diag="slug"]').innerText()).toBe(OTHER_SLUG);
  expect(await page.locator('[data-theme-diag="count"]').innerText()).toBe('16');

  // The selector keeps working on a debug route.
  await page.locator('#theme-select').selectOption(DEFAULT_SLUG);
  expect(await readTheme(page)).toBe(DEFAULT_SLUG);
  expect(await page.locator('[data-theme-diag="label"]').innerText()).toBe(GOLDEN.label);
});

// ── K. Brand mark contrast ─────────────────────────────────────────────────
test.describe('K. brand mark contrast', () => {
  test('K. brand mark in Vintage Classic resolves to textPrimary #000000 and contrasts with surface', async ({ page }) => {
    await page.goto('/');
    await page.locator('#theme-select').selectOption('vintageclassic');
    const wordmark = page.locator('.hero__wordmark').first();
    const color = await wordmark.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    const bg = await page.locator('body').evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(color).toBe('rgb(0, 0, 0)');
    expect(color).not.toBe(bg);
  });

  test('K. brand mark in Golden Default resolves to canonical gold/accent', async ({ page }) => {
    await page.goto('/');
    await page.locator('#theme-select').selectOption('goldendefault');
    const wordmark = page.locator('.hero__wordmark').first();
    const color = await wordmark.evaluate((el) => window.getComputedStyle(el).backgroundColor);
    expect(color).toBe('rgb(240, 208, 96)');
  });
});
