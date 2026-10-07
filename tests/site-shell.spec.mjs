import { test, expect } from '@playwright/test';
import { publicRoutes, readRoutes } from '../scripts/route-registry.mjs';

/**
 * M4 site-shell suite (MASTER_ROADMAP M4).
 *
 * What this covers that the other suites deliberately do not:
 *   - every declared route is actually built and served;
 *   - every public route shows the maturity the registry declares for it;
 *   - the desktop and compact navigation surfaces take turns instead of both
 *     being exposed at once;
 *   - navigation works with JavaScript disabled;
 *   - breadcrumbs exist, are semantic, and mark the current page;
 *   - no route overflows the document horizontally at the three acceptance
 *     widths;
 *   - the shell keeps a theme across navigation;
 *   - landmark structure is intact on every public route.
 *
 * Theme internals (pre-paint, no-FOUC, sixteen palettes, nested scopes) belong
 * to tests/theme-runtime.spec.mjs and are not duplicated here.
 */

const PUBLIC = publicRoutes().map((route) => route.href);
const DEBUG = ['/debug/components/', '/debug/themes/', '/debug/rendering/'];
const ALL = [...PUBLIC, ...DEBUG];

/** Public routes deliberately kept out of the primary strip (the More panel). */
const SECONDARY = readRoutes()
  .filter((route) => !route.inMenu && !route.href.startsWith('/debug/'))
  .map((route) => route.href);

/** MASTER_ROADMAP §1: routes the first shell had to reserve. */
const ROADMAP = [
  '/', '/docs/', '/spec/', '/ecosystem/', '/pricing/', '/about/', '/status/', '/playground/',
  '/benchmarks/', '/downloads/', '/security/', '/community/', '/blog/', '/changelog/',
];

const DESKTOP = { width: 1280, height: 720 };
const MOBILE = { width: 390, height: 844 };
const NARROW = { width: 320, height: 568 };

const desktopNav = (page) => page.locator('nav[aria-label="Main"]');
const compactNav = (page) => page.locator('nav[aria-label="Site"]');

/** The registry and the test must not disagree about what the public shell is. */
test('the route registry declares exactly the expected public shell', () => {
  for (const href of ROADMAP) {
    expect(PUBLIC, `${href} is declared public`).toContain(href);
  }
  expect(PUBLIC.length).toBeGreaterThanOrEqual(ROADMAP.length);
  expect(DEBUG).toHaveLength(3);
  const declared = readRoutes().map((route) => route.href);
  expect(new Set(declared).size).toBe(declared.length);
});

test.describe('A. every declared route builds and answers 200', () => {
  for (const href of ALL) {
    test(`${href}`, async ({ page }) => {
      const response = await page.goto(href);
      expect(response.status()).toBe(200);
      await expect(page.locator('main')).toBeAttached();
    });
  }
});

test.describe('B. every public route shows the maturity the registry declares', () => {
  for (const route of readRoutes().filter((r) => !r.href.startsWith('/debug/'))) {
    test(`${route.href}`, async ({ page }) => {
      await page.goto(route.href);
      await expect(page.locator('main .w-badge', { hasText: route.maturity.toUpperCase() }).first()).toBeVisible();
      await expect(page.locator('main .w-badge', { hasText: 'PLACEHOLDER' })).toHaveCount(0);
    });
  }
});

test.describe('C. desktop shell at 1280x720', () => {
  test.use({ viewport: DESKTOP });

  test('the primary strip is the exposed navigation', async ({ page }) => {
    await page.goto('/docs/');
    await expect(desktopNav(page)).toBeVisible();
    await expect(compactNav(page)).toBeHidden();
    await expect(desktopNav(page).locator('a[aria-current="page"]')).toHaveText('Docs');
  });

  test('the secondary panel exposes the secondary routes without hover', async ({ page }) => {
    await page.goto('/');
    const more = desktopNav(page).locator('details.w-more');
    await expect(more).toBeAttached();
    await more.locator('summary').click();
    for (const href of SECONDARY) {
      await expect(more.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await expect(more.locator('a[href="/security/"]')).toHaveAttribute('href', '/security/');
  });
});

test.describe('D. compact shell at 390x844', () => {
  test.use({ viewport: MOBILE });

  test('the compact surface is the exposed navigation, not the desktop strip', async ({ page }) => {
    await page.goto('/');
    await expect(desktopNav(page)).toBeHidden();
    await expect(compactNav(page)).toBeVisible();
    await expect(compactNav(page).locator('summary')).toBeVisible();
  });

  test('documentation, specification, status and security are reachable', async ({ page }) => {
    await page.goto('/');
    const panel = compactNav(page).locator('details.w-compactnav__panel');
    await expect(panel).not.toHaveAttribute('open', '');
    await panel.locator('summary').click();
    await expect(panel).toHaveAttribute('open', '');
    for (const href of ['/docs/', '/spec/', '/status/', '/security/']) {
      await expect(panel.locator(`a[href="${href}"]`)).toBeVisible();
    }
    await panel.locator('a[href="/spec/"]').click();
    await expect(page).toHaveURL(/\/spec\/$/);
  });
});

test.describe('E. navigation without JavaScript', () => {
  test.use({ viewport: MOBILE, javaScriptEnabled: false });

  test('the compact panel opens and navigates', async ({ page }) => {
    await page.goto('/');
    const panel = compactNav(page).locator('details.w-compactnav__panel');
    await panel.locator('summary').click();
    await expect(panel).toHaveAttribute('open', '');
    await panel.locator('a[href="/docs/"]').click();
    await expect(page).toHaveURL(/\/docs\/$/);
    await expect(page.locator('.w-crumbs')).toBeVisible();
  });
});

test.describe('F. breadcrumbs', () => {
  test('a secondary route carries a semantic trail that marks the current page', async ({ page }) => {
    await page.goto('/security/');
    const crumbs = page.locator('.w-window > nav[aria-label="Breadcrumb"]');
    await expect(crumbs).toHaveCount(1);
    await expect(crumbs).toBeVisible();
    await expect(crumbs.locator('ol')).toBeAttached();
    await expect(crumbs.locator('a[href="/"]')).toHaveText('Home');
    const current = crumbs.locator('[aria-current="page"]');
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText('Security');
    await expect(crumbs.locator('a[href="/security/"]')).toHaveCount(0);
  });

  test('the debug bench links Home and keeps the missing intermediate inert', async ({ page }) => {
    await page.goto('/debug/components/');
    // The bench also renders a breadcrumb specimen inside <main>, so target the
    // one the shell owns — the window's own slot, outside the page body.
    const crumbs = page.locator('.w-window > nav[aria-label="Breadcrumb"]');
    await expect(crumbs).toHaveCount(1);
    await expect(crumbs.locator('a[href="/"]')).toHaveText('Home');
    await expect(crumbs.locator('a[href="/debug/"]')).toHaveCount(0);
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText('Components');
  });

  test('the homepage carries no misleading parent trail', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.w-crumbs')).toHaveCount(0);
  });

  test('the documentation layout does not print a second trail', async ({ page }) => {
    await page.goto('/docs/');
    await expect(page.locator('.w-crumbs')).toHaveCount(1);
    await expect(page.getByText('SAIPEN / Docs')).toHaveCount(0);
  });
});

test.describe('G. no whole-page horizontal overflow', () => {
  for (const [name, viewport] of [
    ['1280x720', DESKTOP],
    ['640x540 (UI.md compact target)', { width: 640, height: 540 }],
    ['390x844', MOBILE],
    ['320x568', NARROW],
  ]) {
    test.describe(name, () => {
      test.use({ viewport });

      for (const href of [
        '/',
        '/docs/',
        '/docs/getting-started/introduction/',
        '/spec/v8/lifecycle/',
        '/spec/v8/state/',
        '/ecosystem/',
        '/compatibility/',
        '/downloads/',
        '/playground/provider-outage/',
        '/status/',
        '/debug/components/',
      ]) {
        test(`${href}`, async ({ page }) => {
          await page.goto(href);
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
                .filter(
                  (el) =>
                    el.getBoundingClientRect().right > root.clientWidth + 1 && !scrollable(el),
                )
                .slice(0, 5)
                .map((el) => `${el.tagName.toLowerCase()}.${el.className}`),
            };
          });
          expect(overflow.offenders, `overflowing elements on ${href}`).toEqual([]);
          expect(overflow.scroll).toBeLessThanOrEqual(overflow.client);
        });
      }
    });
  }
});

test.describe('H. the shell keeps a non-default palette across navigation', () => {
  /** Follow a real shell link, opening the secondary panel when the route lives there. */
  const follow = async (page, href) => {
    const strip = desktopNav(page);
    const direct = strip.locator(`a[href="${href}"]`).first();
    if (await direct.isVisible()) {
      await direct.click();
      return;
    }
    const more = strip.locator('details.w-more');
    await more.locator('summary').click();
    await more.locator(`a[href="${href}"]`).click();
  };

  test('dracula survives a walk through the shell', async ({ page }) => {
    await page.goto('/');
    await page.locator('#theme-select').selectOption('dracula');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');

    for (const href of ['/status/', '/docs/', '/security/']) {
      await follow(page, href);
      await expect(page).toHaveURL(new RegExp(`${href.replace(/\//g, '\\/')}$`));
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dracula');
      await expect(page.locator('#status-palette')).toContainText('Dracula');
    }
  });
});

test.describe('I. landmark structure on every public route', () => {
  for (const href of PUBLIC) {
    test(`${href}`, async ({ page }) => {
      await page.goto(href);
      await expect(page.locator('main')).toHaveCount(1);
      await expect(page.locator('main')).toHaveAttribute('id', 'main');
      await expect(page.locator('body > footer, footer.w-statusbar')).toHaveCount(1);
      await expect(page.locator('nav[aria-label="Main"]')).toHaveCount(1);
      await expect(page.locator('nav[aria-label="Site"]')).toHaveCount(1);
      await expect(page.locator('h1')).toHaveCount(1);
      await expect(page.locator('a.skip-link')).toHaveAttribute('href', '#main');
      await expect(page.locator('a[href="#"]')).toHaveCount(0);
    });
  }
});
