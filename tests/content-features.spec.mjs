import { test, expect } from '@playwright/test';

/**
 * Behaviour of the content features (MASTER_ROADMAP M5, M7, M9, M12, M13, M23):
 * documentation chrome, the spec visualizer and aliases, the playground
 * stepper with and without JavaScript, search and its keyboard shortcut, and
 * the agent-readable files.
 */

test.describe('documentation', () => {
  test('a doc page has a current tree entry, an on-page TOC, sources and prev/next', async ({ page }) => {
    await page.goto('/docs/concepts/board-and-tickets/');
    const tree = page.locator('nav.docs__tree');
    await expect(tree.locator('a[aria-current="page"]')).toHaveText('BOARD and tickets');
    const toc = page.locator('aside.docs__toc');
    await expect(toc).toBeVisible();
    const first = toc.locator('a').first();
    const target = (await first.getAttribute('href')).slice(1);
    await expect(page.locator(`[id="${target}"]`)).toHaveCount(1);
    await expect(page.locator('.docs__sources a[data-external]').first()).toHaveAttribute('href', /github\.com\/vacterro\/saipen\/blob\/[0-9a-f]{40}\//);
    await expect(page.locator('a[rel="prev"]')).toHaveAttribute('href', '/docs/concepts/state-and-next-action/');
    await expect(page.locator('a[rel="next"]')).toHaveAttribute('href', '/docs/concepts/log-and-events/');
  });

  test('every heading anchor resolves on the same page', async ({ page }) => {
    await page.goto('/docs/protocol/verification/');
    const anchors = await page.locator('.docs__body a.anchor').evaluateAll((els) => els.map((a) => a.getAttribute('href')));
    expect(anchors.length).toBeGreaterThan(2);
    for (const href of anchors) await expect(page.locator(`[id="${href.slice(1)}"]`)).toHaveCount(1);
  });

  test('the raw Markdown twin is served', async ({ request }) => {
    const res = await request.get('/docs/getting-started/introduction.md');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('# Introduction');
  });

  test('narrow screens swap the side tree for a compact disclosure', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/docs/concepts/knowledge/');
    await expect(page.locator('nav.docs__tree')).toBeHidden();
    const compact = page.locator('details.docs__tree-compact');
    await expect(compact).toBeVisible();
    await compact.locator('summary').click();
    await expect(compact.locator('a[aria-current="page"]')).toHaveText('KNOWLEDGE');
  });
});

test.describe('specification', () => {
  test('the visualizer selects a phase by :target, without script', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/spec/v8/lifecycle/');
    await page.locator('a.sm__node', { hasText: 'VERIFY' }).click();
    await expect(page).toHaveURL(/#phase-VERIFY$/);
    const detail = page.locator('#phase-VERIFY');
    await expect(detail).toBeVisible();
    await expect(detail.locator('dd').first()).toContainText('REVIEW');
    await context.close();
  });

  test('/spec/latest/ redirects to the versioned URL', async ({ page }) => {
    await page.goto('/spec/latest/state/');
    await expect(page).toHaveURL(/\/spec\/v\d+\/state\/$/);
    await expect(page.locator('h1')).toHaveText('STATE fields');
  });

  test('machine-readable registry is valid JSON with the phase set', async ({ request }) => {
    const res = await request.get('/spec/v8/registry.json');
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(json.phases.all).toContain('VERIFY');
  });
});

test.describe('playground', () => {
  test('the stepper moves one step at a time with text progress', async ({ page }) => {
    await page.goto('/playground/provider-outage/');
    const count = page.locator('[data-count]');
    await expect(count).toHaveText(/^Step 1 of \d+$/);
    await expect(page.locator('[data-step]:visible')).toHaveCount(1);
    await expect(page.locator('[data-prev]')).toBeDisabled();
    await page.locator('[data-next]').click();
    await expect(count).toHaveText(/^Step 2 of /);
    await expect(page).toHaveURL(/#step-2$/);
    await expect(page.locator('#step-2 pre').first()).toContainText('phase: BUILD');
    await page.locator('[data-reset]').click();
    await expect(count).toHaveText(/^Step 1 of /);
  });

  test('boundaries hold at first and last steps', async ({ page }) => {
    await page.goto('/playground/provider-outage/');
    const count = page.locator('[data-count]');
    const total = Number((await count.textContent())?.match(/of (\d+)/)?.[1]);
    for (let i = 1; i < total; i++) await page.locator('[data-next]').click();
    await expect(count).toHaveText(new RegExp(`^Step ${total} of `));
    await expect(page.locator('[data-next]')).toBeDisabled();
    await expect(page.locator('[data-prev]')).toBeEnabled();
    await page.locator('[data-prev]').click();
    await expect(count).toHaveText(new RegExp(`^Step ${total - 1} of `));
  });

  test('invalid fragment clamps to a real step', async ({ page }) => {
    await page.goto('/playground/provider-outage/#step-99');
    const count = page.locator('[data-count]');
    const total = Number((await count.textContent())?.match(/of (\d+)/)?.[1]);
    await expect(count).toHaveText(new RegExp(`^Step ${total} of `));
    await expect(page).toHaveURL(new RegExp(`#step-${total}$`));
  });

  test('keyboard-only operation keeps focus on the control', async ({ page }) => {
    await page.goto('/playground/provider-outage/');
    const next = page.locator('[data-next]');
    await next.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-count]')).toHaveText(/^Step 2 of /);
    await expect(next).toBeFocused();
  });

  test('step changes are announced through the live counter', async ({ page }) => {
    await page.goto('/playground/provider-outage/');
    const count = page.locator('[data-count]');
    await expect(count).toHaveAttribute('aria-live', 'polite');
    await page.locator('[data-next]').click();
    await expect(count).toHaveText(/^Step 2 of \d+$/);
  });

  test('refresh with a step fragment restores that step', async ({ page }) => {
    await page.goto('/playground/provider-outage/#step-3');
    await expect(page.locator('[data-count]')).toHaveText(/^Step 3 of /);
    await expect(page.locator('#step-3')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-count]')).toHaveText(/^Step 3 of /);
  });

  test('without JavaScript every step is readable in order', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/playground/destructive-op/');
    await expect(page.locator('[data-player-controls]')).toBeHidden();
    const steps = page.locator('[data-step]');
    const n = await steps.count();
    expect(n).toBeGreaterThan(2);
    for (let i = 0; i < n; i++) await expect(steps.nth(i)).toBeVisible();
    await expect(page.getByText('WAIT: destructive-op --').first()).toBeVisible();
    await context.close();
  });
});

test.describe('search', () => {
  test('a query returns technical results first', async ({ page }) => {
    await page.goto('/search/?q=checkpoint');
    await expect(page.locator('[data-status]')).toHaveText(/\d+ results? for "checkpoint"/);
    const first = page.locator('.search__hit').first();
    await expect(first).toContainText(/Docs|Spec/);
  });

  test('empty query shows the prompt state', async ({ page }) => {
    await page.goto('/search/');
    await expect(page.locator('[data-status]')).not.toBeEmpty();
    await expect(page.locator('.search__hit')).toHaveCount(0);
  });

  test('no results is announced truthfully', async ({ page }) => {
    await page.goto('/search/?q=zzzqqqxxy-nothing-matches-this');
    await expect(page.locator('[data-status]')).toHaveText(/No results for/);
    await expect(page.locator('.search__hit')).toHaveCount(0);
  });

  test('failed index request shows the error state, not stale results', async ({ page }) => {
    await page.route('**/search-index.json', (route) => route.abort());
    await page.goto('/search/?q=checkpoint');
    await expect(page.locator('[data-status]')).not.toBeEmpty();
    await expect(page.locator('.search__hit')).toHaveCount(0);
  });

  test('malformed index response shows the error state', async ({ page }) => {
    await page.route('**/search-index.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: 'not json{{{' }),
    );
    await page.goto('/search/?q=checkpoint');
    await expect(page.locator('[data-status]')).not.toBeEmpty();
    await expect(page.locator('.search__hit')).toHaveCount(0);
  });

  test('long input with special characters is safe and answered', async ({ page }) => {
    const q = 'checkpoint <img src=x onerror=alert(1)> "verify" & state (v8) — '.repeat(4);
    await page.goto(`/search/?q=${encodeURIComponent(q)}`);
    await expect(page.locator('[data-status]')).not.toBeEmpty();
    await expect(page.locator('img')).toHaveCount(0);
    const hits = await page.locator('.search__hit').count();
    expect(hits).toBeLessThan(41);
  });

  test('results are keyboard reachable by Tab', async ({ page }) => {
    await page.goto('/search/?q=checkpoint');
    const first = page.locator('.search__hit a').first();
    await expect(first).toBeVisible();
    await page.locator('#q').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    await expect(focused).toHaveAttribute('href', /checkpoint|verify|state|spec|docs/i);
  });

  test('Ctrl+K opens search from any page', async ({ page }) => {
    await page.goto('/about/');
    await page.locator('body').press('Control+k');
    await expect(page).toHaveURL(/\/search\/$/);
  });

  test('on a docs page Ctrl+K focuses the docs search field', async ({ page }) => {
    await page.goto('/docs/');
    await page.locator('body').press('Control+k');
    await expect(page.locator('#tree-search')).toBeFocused();
  });
});

test.describe('agent-readable files', () => {
  for (const [path, needle] of [
    ['/llms.txt', 'Authority: this website explains SAIPEN'],
    ['/llms-full.txt', '# Introduction'],
    ['/sitemap.xml', '<urlset'],
    ['/robots.txt', 'Sitemap:'],
    ['/search-index.json', '"url"'],
  ]) {
    test(path, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      expect(await res.text()).toContain(needle);
    });
  }

  test('404 page is built', async ({ request }) => {
    const res = await request.get('/404.html');
    expect(res.status()).toBe(200);
    expect(await res.text()).toContain('Page not found');
  });
});

test.describe('downloads', () => {
  test('verify commands are copyable without platform labels inside the command text', async ({ request }) => {
    const res = await request.get('/downloads/');
    expect(res.status()).toBe(200);
    const html = await res.text();
    const codeBlocks = [...html.matchAll(/<pre class="w-code"><code[^>]*>(.*?)<\/code><\/pre>/gs)].map((m) => m[1]);
    expect(codeBlocks).toHaveLength(3);
    expect(codeBlocks[0]).toBe('certutil -hashfile FastPrompter.exe SHA256');
    expect(codeBlocks[1]).toBe('sha256sum FastPrompter.exe');
    expect(codeBlocks[2]).toBe('shasum -a 256 FastPrompter.exe');
    for (const block of codeBlocks) {
      expect(block).not.toContain('(Windows)');
      expect(block).not.toContain('(Linux)');
      expect(block).not.toContain('(macOS)');
    }
  });

  test('the scenario player announces step changes through the polite live counter and keeps the heading focusable', async ({ page }) => {
    await page.goto('/playground/provider-outage/');
    const count = page.locator('[data-count]');
    const next = page.locator('[data-next]');
    await expect(count).toHaveAttribute('aria-live', 'polite');
    await expect(count).toHaveText(/^Step 1 of \d+$/);
    const heading = page.locator('[data-step]:visible >> h2');
    await expect(heading).toHaveAttribute('tabindex', '-1');
    await next.click();
    await expect(count).toHaveText(/^Step 2 of \d+$/);
    await expect(count).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('[data-step]:visible >> h2')).toHaveAttribute('tabindex', '-1');
  });
});
