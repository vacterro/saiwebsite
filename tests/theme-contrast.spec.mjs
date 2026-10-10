import { test, expect } from '@playwright/test';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCssColor,
  compositeOver,
  resolveBackground,
  ratio,
  isLargeText,
  COLLECTOR_SOURCE,
} from './helpers/contrast-math.mjs';

/**
 * Cross-theme rendered-contrast gate (Waves 3A/B).
 *
 * Every theme in src/themes/packs is loaded in a real browser and the
 * ACTUAL COMPUTED foreground/background pairs are measured -- never
 * token math. Backgrounds are alpha-composited through the whole
 * ancestor stack; a stack with no opaque base is recorded MANUAL_REVIEW,
 * never a fabricated ratio.
 *
 * Coverage: pricing controls (the repaired gate), home/docs navigation
 * incl. selected + hovered states, search form, docs code blocks, status
 * feedback after a forced copy failure, keyboard focus visibility +
 * contrast, disabled-control semantics, and non-text button boundaries.
 *
 * Deliberately NOT gated (documented exceptions): disabled-control colors
 * (WCAG exempts inactive elements -- but they must really BE disabled),
 * input placeholders (every input has a real visible label), decorative
 * breadcrumb separators, and redundant heading-anchor `#` markers.
 *
 * This samples representative elements; it does not claim comprehensive
 * WCAG conformance for the whole site.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKS = join(ROOT, 'src/themes/packs');
const KEY = 'sai-website.theme';
const collect = new Function('return (' + COLLECTOR_SOURCE + ')')();
const slugs = readdirSync(PACKS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.slice(0, -5))
  .sort();

// /pricing/ currently has no .w-button--primary (copy + plain buttons only;
// verified against dist/pricing/index.html). Primary-button label contrast
// is measured on the playground [data-next] control instead -- measuring
// what exists, not a fallback that resolves to nothing.
const PRICING_PAIRS = {
  body: 'body',
  link: 'main a[href^="/"]',
  button: '.js-copy',
  note: '.w-panel__note',
  badge: '.w-badge',
};

const NAV_PAIRS = {
  homeSelected: 'nav.w-menubar a[aria-current="page"]',
  docsTreeLink: 'nav.docs__tree a[href]',
  docsTreeSelected: 'nav.docs__tree a[aria-current="page"]',
  searchInput: '#q',
  searchSubmit: 'form.search button[type="submit"]',
  searchStatus: '[data-status]',
  docsCode: 'pre.w-code code',
};

function checkPairs(collected, slug, context) {
  expect(collected.missing, `${slug}/${context}: selectors must resolve`).toEqual([]);
  const manual = [];
  for (const [name, p] of Object.entries(collected.pairs)) {
    const fg = Array.isArray(p.fg) ? p.fg.slice(0, 3) : null;
    expect(fg, `${slug}/${context}/${name}: foreground must parse`).toBeTruthy();
    const bg = resolveBackground(p.bgStack);
    if (bg.manual) {
      manual.push(`${name}: ${bg.manual}`);
      continue;
    }
    const threshold = isLargeText(p.fontSize, p.fontWeight) ? 3 : 4.5;
    expect(
      ratio(fg, bg.color),
      `${slug}/${context}/${name} rendered contrast (needs ${threshold}:1)`,
    ).toBeGreaterThanOrEqual(threshold);
  }
  return manual;
}

async function gotoThemed(page, slug, path) {
  await page.addInitScript({ content: `localStorage.setItem('${KEY}','${slug}')` });
  await page.goto(path);
  await expect(page.locator('body')).toBeVisible();
  const applied = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(applied, `unregistered theme must be detected (${slug})`).toBe(slug);
}

for (const slug of slugs) {
  test.describe(`contrast/${slug}`, () => {
    test('pricing text pairs (repaired gate)', async ({ page }) => {
      await gotoThemed(page, slug, '/pricing/');
      const collected = await page.evaluate(collect, PRICING_PAIRS);
      const manual = checkPairs(collected, slug, 'pricing');
      expect(manual, `${slug}/pricing: unexpected MANUAL_REVIEW`).toEqual([]);
    });

    test('navigation, search, code across pages', async ({ page }) => {
      const manual = [];
      await gotoThemed(page, slug, '/');
      let c = await page.evaluate(collect, { homeSelected: NAV_PAIRS.homeSelected });
      // The homepage menubar may legitimately have no current-page link;
      // fall back to any menubar link so navigation itself is still measured.
      if (c.missing.length) {
        c = await page.evaluate(collect, { homeLink: 'nav.w-menubar a[href]' });
        manual.push('homeSelected: no aria-current on /; measured plain menubar link instead');
      }
      manual.push(...checkPairs(c, slug, 'home-nav'));

      await page.goto('/docs/');
      c = await page.evaluate(collect, { docsTreeLink: NAV_PAIRS.docsTreeLink });
      manual.push(...checkPairs(c, slug, 'docs-nav'));

      await page.goto('/search/');
      c = await page.evaluate(collect, {
        searchInput: NAV_PAIRS.searchInput,
        searchSubmit: NAV_PAIRS.searchSubmit,
        searchStatus: NAV_PAIRS.searchStatus,
      });
      manual.push(...checkPairs(c, slug, 'search'));

      // A real document page marks the current tree entry: selected-state
      // contrast is measured where the selection genuinely exists.
      await page.goto('/docs/getting-started/introduction/');
      c = await page.evaluate(collect, {
        docsTreeSelected: NAV_PAIRS.docsTreeSelected,
        docsCode: NAV_PAIRS.docsCode,
      });
      manual.push(...checkPairs(c, slug, 'docs-code'));

      expect(
        manual.filter((m) => !m.startsWith('homeSelected:')),
        `${slug}: unexpected MANUAL_REVIEW`,
      ).toEqual([]);
    });

    test('selected and hovered navigation stay legible', async ({ page }) => {
      await gotoThemed(page, slug, '/docs/');
      const link = page.locator('nav.docs__tree a[href]').first();
      await link.hover();
      const m = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const cs = getComputedStyle(el);
        return { fg: cs.color, bg: cs.backgroundColor, hover: el.matches(':hover') };
      }, 'nav.docs__tree a[href]');
      expect(m.hover, `${slug}: hover state must apply`).toBe(true);
      // Hovered background may be transparent (inherits tree surface):
      // composite honestly, same as text pairs.
      const bg = resolveBackground([
        parseCssColor(m.bg),
        ...await page.evaluate(() => {
          const stack = [];
          let n = document.querySelector('nav.docs__tree');
          while (n && n !== document.documentElement) {
            const v = getComputedStyle(n).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
            stack.push(v.length >= 3 ? [v[0], v[1], v[2], v[3] ?? 1] : null);
            n = n.parentElement;
          }
          return stack;
        }),
      ]);
      expect(bg.manual ?? null, `${slug}: hovered background must resolve`).toBeNull();
      expect(
        ratio(parseCssColor(m.fg).slice(0, 3), bg.color),
        `${slug}: hovered nav link contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    });

    test('keyboard focus is visible and reaches 3:1', async ({ page }) => {
      await gotoThemed(page, slug, '/pricing/');
      const m = await page.evaluate(() => {
        const btn = document.querySelector('.js-copy');
        if (!btn) return null;
        btn.focus();
        const cs = getComputedStyle(btn);
        return {
          outline: cs.outlineColor,
          style: cs.outlineStyle,
          width: cs.outlineWidth,
          bg: cs.backgroundColor,
          focused: document.activeElement === btn,
        };
      });
      expect(m, `${slug}: copy button must exist`).toBeTruthy();
      expect(m.focused, `${slug}: button must take focus`).toBe(true);
      expect(m.style, `${slug}: focus outline must render`).not.toBe('none');
      expect(parseFloat(m.width), `${slug}: focus outline must have width`).toBeGreaterThan(0);
      const stack = await page.evaluate(collect, { focusBtn: '.js-copy' });
      const bg = resolveBackground(stack.pairs.focusBtn.bgStack);
      expect(bg.manual ?? null, `${slug}: focus surface must resolve`).toBeNull();
      expect(
        ratio(parseCssColor(m.outline).slice(0, 3), bg.color),
        `${slug} focus outline`,
      ).toBeGreaterThanOrEqual(3);
    });

    test('copy-failure status feedback stays legible', async ({ page }) => {
      // Force the real failure path (no clipboard API): the app must
      // announce via the status region, and that text must contrast.
      await page.addInitScript({
        content: `localStorage.setItem('${KEY}','${slug}');Object.defineProperty(navigator,'clipboard',{value:undefined,configurable:true});`,
      });
      await page.goto('/pricing/');
      await page.locator('.js-copy').first().click();
      const status = page.locator('[data-copy-status]').first();
      await expect(status).not.toBeEmpty();
      const m = await status.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { fg: cs.color, bg: cs.backgroundColor, text: el.textContent };
      });
      expect(m.text.length, `${slug}: failure must announce text`).toBeGreaterThan(0);
      const stack = await page.evaluate(collect, { status: '[data-copy-status]' });
      const bg = resolveBackground(stack.pairs.status.bgStack);
      expect(bg.manual ?? null, `${slug}: status surface must resolve`).toBeNull();
      expect(
        ratio(parseCssColor(m.fg).slice(0, 3), bg.color),
        `${slug}: failure status contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    });

    test('disabled control is really disabled; active sibling contrasts', async ({ page }) => {
      await gotoThemed(page, slug, '/playground/provider-outage/');
      const m = await page.evaluate(() => {
        const prev = document.querySelector('[data-prev]');
        const next = document.querySelector('[data-next]');
        if (!prev || !next) return null;
        const ncs = getComputedStyle(next);
        return {
          prevDisabled: prev.disabled,
          prevAria: prev.getAttribute('aria-disabled'),
          nextFg: ncs.color,
          nextBg: ncs.backgroundColor,
        };
      });
      expect(m, `${slug}: player controls must exist`).toBeTruthy();
      // Inactive-element contrast exemption applies ONLY to a control that
      // is genuinely inactive -- otherwise it would excuse an active one.
      expect(m.prevDisabled === true || m.prevAria === 'true', `${slug}: step-1 prev must be disabled`).toBe(true);
      const stack = await page.evaluate(collect, { nextBtn: '[data-next]' });
      const bg = resolveBackground(stack.pairs.nextBtn.bgStack);
      expect(bg.manual ?? null, `${slug}: next-button surface must resolve`).toBeNull();
      expect(
        ratio(parseCssColor(m.nextFg).slice(0, 3), bg.color),
        `${slug}: active next-button contrast`,
      ).toBeGreaterThanOrEqual(4.5);
    });

    test('button boundary is bevel-drawn: record MANUAL_REVIEW with measured context', async ({ page }) => {
      // Wintage buttons draw their visible boundary with a bevel IMAGE
      // (background-image: var(--bevel-raised), transparent border-color;
      // src/styles/site.css .w-button). Computed-style measurement sees
      // only the flat face color, never the bevel pixels -- so no honest
      // automated ratio exists for the drawn boundary. Record the
      // measurable context (face vs surroundings) and leave the drawn
      // bevel to visual review; pixel-perfect already proves every
      // rendered pixel is a palette token. The button LABEL remains
      // strictly gated (>=4.5) in the pricing test above.
      await gotoThemed(page, slug, '/pricing/');
      const stack = await page.evaluate(collect, { copyBtn: '.js-copy' });
      const layers = stack.pairs.copyBtn.bgStack;
      expect(layers?.length, `${slug}: button background stack must resolve`).toBeGreaterThan(1);
      const surroundings = resolveBackground(layers.slice(1));
      expect(surroundings.manual ?? null, `${slug}: surroundings must resolve`).toBeNull();
      const l0 = layers[0];
      const face = compositeOver([l0[0], l0[1], l0[2], l0[3] ?? 1], surroundings.color);
      test.info().annotations.push({
        type: 'manual-review',
        description: `${slug}: bevel-image boundary; face-vs-surroundings ${ratio(face, surroundings.color).toFixed(2)}:1 (context only, not a verdict)`,
      });
    });
  });
}
