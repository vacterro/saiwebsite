import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Secondary-page reader journey (Chromium only: narrative coverage, not
 * media proof -- WebKit is owned by pixel-perfect + media-delivery).
 *
 * What this covers that the other suites deliberately do not: a reader chain
 * across the secondary pages followed through REAL visitor-visible links
 * (Home -> Quickstart -> Compatibility -> Hosts and installation -> Security
 * -> Downloads -> Benchmarks -> Status -> Ecosystem), blog/changelog
 * navigation, back/forward restoration, 320px table containment, and
 * external-link marking on these pages. Route 200s, maturity badges, nav
 * exposure, breadcrumbs and landmarks belong to site-shell and are not
 * duplicated here.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const BLOG_DIR = join(HERE, '..', 'src', 'content', 'blog');

/**
 * The authored posts, read from the content collection's own source of truth.
 * The blog index renders one entry per document, so the expected link count is
 * derived (never hardcoded) and a missing generated link cannot pass silently.
 */
const AUTHORED_POSTS = readdirSync(BLOG_DIR)
  .filter((f) => f.endsWith('.md'))
  .map((f) => {
    const text = readFileSync(join(BLOG_DIR, f), 'utf8');
    const date = /^date:\s*(\S+)/m.exec(text)?.[1] ?? '';
    return { id: f.replace(/\.md$/, ''), date };
  })
  .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id.localeCompare(b.id)));

/**
 * Open the reserved-route "More" panel. It is a native <details> at the end of
 * the desktop menu strip, so the links inside it are real anchors a visitor
 * clicks after opening the panel -- no hover and no script.
 */
async function openMoreNav(page) {
  const panel = page.locator('nav[aria-label="Main"] details.w-more');
  await expect(panel, 'the desktop menu strip must expose the More panel').toHaveCount(1);
  if (!(await panel.evaluate((el) => el.open))) {
    await panel.locator('summary').click();
  }
  await expect(panel).toHaveAttribute('open', '');
}

/** Follow a reserved route through the opened More panel (a real link click). */
async function followMoreLink(page, href) {
  await openMoreNav(page);
  await page.locator(`nav[aria-label="Main"] details.w-more a[href="${href}"]`).click();
}

test.describe('secondary reader journey', () => {
  test('reader journey from home to ecosystem follows real links at every step', async ({ page }) => {
    // 1. Home hero CTA -> Quickstart (in-page link).
    await page.goto('/');
    await page.getByRole('link', { name: /get started/i }).first().click();
    await expect(page).toHaveURL(/\/docs\/getting-started\/quickstart\/$/);
    await expect(page.locator('main h1')).toBeVisible();

    // 2. Quickstart -> Compatibility through the More panel.
    await followMoreLink(page, '/compatibility/');
    await expect(page).toHaveURL(/\/compatibility\/$/);
    await expect(page.locator('main h1')).toHaveText(/compatibility/i);

    // 3. Compatibility -> Hosts and installation (in-content link).
    await page.getByRole('link', { name: /hosts and installation/i }).first().click();
    await expect(page).toHaveURL(/\/docs\/operation\/hosts-and-install\/$/);

    // 4. Hosts and installation -> Security through the More panel.
    await followMoreLink(page, '/security/');
    await expect(page).toHaveURL(/\/security\/$/);
    await expect(page.locator('main h1')).toHaveText(/security/i);

    // 5. Security -> Downloads catalogue (in-content link).
    await page.getByRole('link', { name: /downloads catalogue/i }).first().click();
    await expect(page).toHaveURL(/\/downloads\/$/);

    // 6. Downloads -> Benchmarks through the More panel.
    await followMoreLink(page, '/benchmarks/');
    await expect(page).toHaveURL(/\/benchmarks\/$/);
    await expect(page.locator('main h1')).toHaveText(/benchmarks/i);

    // 7. Benchmarks -> Status through the More panel.
    await followMoreLink(page, '/status/');
    await expect(page).toHaveURL(/\/status\/$/);
    await expect(page.locator('main h1')).toHaveText(/status/i);

    // 8. Status -> Ecosystem through the status page's own route index.
    await page.locator('main a[href="/ecosystem/"]').first().click();
    await expect(page).toHaveURL(/\/ecosystem\/$/);
    await expect(page.locator('main h1')).toBeVisible();
  });

  test('blog lists every authored post, newest first, and each link opens a real article', async ({ page }) => {
    // Guard: an empty or mis-located collection cannot make this test vacuous.
    expect(AUTHORED_POSTS.length, 'blog collection should contain authored posts').toBeGreaterThan(0);

    await page.goto('/blog/');
    await expect(page.locator('main h1')).toBeVisible();

    const posts = page.locator('main a[href^="/blog/"]');
    // One link per authored document: a missing generated link fails here.
    await expect(posts, 'blog index must link every authored post').toHaveCount(AUTHORED_POSTS.length);

    const hrefs = await posts.evaluateAll((els) => els.map((e) => e.getAttribute('href')));
    expect(hrefs, 'each post link is a permanent /blog/<id>/ URL').toEqual(
      AUTHORED_POSTS.map((p) => `/blog/${p.id}/`),
    );

    // Follow the newest post with a real click.
    await posts.first().click();
    await expect(page).toHaveURL(/\/blog\/[^/]+\/$/);
    await expect(page.locator('main h1')).toBeVisible();
  });

  test('changelog is ordered newest first and its sections are addressable', async ({ page }) => {
    await page.goto('/changelog/');
    await expect(page.locator('main h1')).toBeVisible();

    const versions = await page.locator('main h3').allInnerTexts();
    const parsed = versions.map((v) => /(\d+\.\d+\.\d+)/.exec(v)?.[1] ?? '').filter(Boolean);
    expect(parsed.length, 'changelog must list release versions').toBeGreaterThan(1);
    const sorted = [...parsed].sort((a, b) => {
      const [am, an, ap] = a.split('.').map(Number);
      const [bm, bn, bp] = b.split('.').map(Number);
      return bm - am || bn - an || bp - ap;
    });
    expect(parsed, 'changelog releases run newest first').toEqual(sorted);

    // Section anchors resolve: jumping to #protocol lands on its heading.
    await expect(page.locator('main h2#protocol')).toHaveCount(1);
    await page.goto('/changelog/#protocol');
    await expect(page.locator('main h2#protocol')).toBeVisible();
  });

  test('back and forward restore secondary pages', async ({ page }) => {
    await page.goto('/compatibility/');
    await page.goto('/security/');
    await page.goBack();
    await expect(page).toHaveURL(/compatibility/);
    await page.goForward();
    await expect(page).toHaveURL(/security/);
  });

  test('data tables scroll inside their region at 320px without page overflow', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    for (const href of ['/compatibility/', '/downloads/', '/status/', '/benchmarks/']) {
      await page.goto(href);
      await expect(page.locator('main h1')).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, href).toBeLessThanOrEqual(1);
      const scroller = page.locator('.wide-scroll').first();
      if (await scroller.count()) await expect(scroller).toBeVisible();
    }
  });

  test('external links on secondary pages are marked and open safely', async ({ page }) => {
    for (const href of ['/compatibility/', '/downloads/', '/security/', '/benchmarks/', '/status/']) {
      await page.goto(href);
      const externals = page.locator('main a[data-external]');
      const n = await externals.count();
      expect(n, `${href} should mark external links`).toBeGreaterThan(0);
      for (const url of await externals.evaluateAll((els) => els.map((e) => e.getAttribute('href')))) {
        expect(url).toMatch(/^https:\/\//);
      }
      for (const rel of await externals.evaluateAll((els) => els.map((e) => e.getAttribute('rel')))) {
        expect(rel).toMatch(/noopener/);
      }
    }
  });

  test('secondary pages keep one h1 and labelled landmarks', async ({ page }) => {
    for (const href of ['/compatibility/', '/status/', '/downloads/', '/benchmarks/', '/security/']) {
      await page.goto(href);
      await expect(page.locator('main h1')).toHaveCount(1);
      await expect(page.locator('nav[aria-label]').first()).toBeVisible();
      await expect(page.locator('main').first()).toBeVisible();
    }
  });
});
