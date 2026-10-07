import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { createRequire } from 'node:module';

/**
 * Pixel-perfect gate (SAIPEN UI.md, "Non-antialiased text" and QA before DONE).
 *
 * UI.md is explicit that proof is rendered pixels, not CSS flags: "no shades
 * beyond the tokens (smoothing adds hundreds)". So this suite renders every
 * built page, takes a full-page screenshot at DPR 1 and checks EVERY pixel
 * against the closed set of 21 palette colours. Anti-aliased text, a blurred
 * edge, an opacity blend, a gradient, a stray framework colour — each one
 * produces a colour outside the set and fails the page, with the offending
 * colours and the first coordinate that shows them.
 *
 * It runs in Chromium and in WebKit. On the reference host both engines draw
 * the pixel faces without smoothing (the faces carry a no-grayscale gasp table
 * and an embedded 1-bit strike); what the colour counter then catches is
 * everything else that blends — miter corners, browser-drawn markers, opacity,
 * decoration lines, transformed text. A face used at the wrong size stays
 * palette-clean, which is why the face-pairing check below exists.
 *
 * Instrument controls: the same counter must go red on deliberately smoothed
 * input (a text run shifted half a pixel, an anti-aliased circle). Without
 * those, a colour counter that silently saw nothing would pass forever.
 */

const require = createRequire(import.meta.url);
const { PNG } = require('playwright-core/lib/utilsBundle');

const DIST = 'dist';

function builtRoutes() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === 'index.html') {
        // Alias pages redirect immediately (meta refresh); their target is
        // checked under its own URL.
        if (/http-equiv="refresh"/.test(readFileSync(full, 'utf8'))) continue;
        const rel = relative(DIST, dir).split(sep).join('/');
        out.push(rel ? `/${rel}/` : '/');
      }
    }
  };
  walk(DIST);
  return out.sort();
}

function hex(rgb) {
  return `#${rgb.toString(16).padStart(6, '0').toUpperCase()}`;
}

function palette(slug) {
  const pack = JSON.parse(readFileSync(`src/themes/packs/${slug}.json`, 'utf8').replace(/^﻿/, ''));
  const colours = pack.colors ?? pack.tokens ?? pack.palette ?? pack;
  return new Set(
    Object.values(colours)
      .filter((v) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))
      .map((v) => parseInt(v.slice(1), 16)),
  );
}

const PACKS = readdirSync('src/themes/packs').map((f) => f.replace(/\.json$/, ''));
const GOLDEN = palette('goldendefault');
const ALL_PACKS = new Set(PACKS.flatMap((slug) => [...palette(slug)]));

/** Count every pixel whose colour is outside `allowed`. */
function offPalette(buffer, allowed) {
  const png = PNG.sync.read(buffer);
  const stray = new Map();
  let first = null;
  for (let i = 0; i < png.data.length; i += 4) {
    const rgb = (png.data[i] << 16) | (png.data[i + 1] << 8) | png.data[i + 2];
    if (allowed.has(rgb)) continue;
    stray.set(rgb, (stray.get(rgb) ?? 0) + 1);
    if (!first) {
      const p = i / 4;
      first = { x: p % png.width, y: Math.floor(p / png.width) };
    }
  }
  const total = [...stray.values()].reduce((a, b) => a + b, 0);
  const top = [...stray.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([rgb, n]) => `${hex(rgb)}x${n}`)
    .join(' ');
  return { total, colours: stray.size, top, first };
}

/** Elements that are deliberately not palette-bound: raster samples. */
const MASKS = ['.px-raster', '[data-pixel-exempt]'];

async function settle(page) {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

const ROUTES = builtRoutes();

test.describe('pixel-perfect: every pixel is a palette token (Golden Default, DPR 1)', () => {
  for (const route of ROUTES) {
    test(route, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const shot = await page.screenshot({
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        mask: MASKS.map((selector) => page.locator(selector)),
        maskColor: hex([...GOLDEN][0]),
      });
      const allowed = route === '/debug/themes/' ? ALL_PACKS : GOLDEN;
      const result = offPalette(shot, allowed);
      expect(
        result.total,
        `${route}: ${result.total} off-palette pixels in ${result.colours} colours (${result.top}); first at ${JSON.stringify(result.first)}`,
      ).toBe(0);
    });
  }
});

test.describe('pixel-perfect: compact layout at 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  for (const route of ['/', '/docs/getting-started/introduction/', '/spec/v8/lifecycle/', '/ecosystem/', '/playground/provider-outage/']) {
    test(route, async ({ page }) => {
      await page.goto(route);
      await settle(page);
      const shot = await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' });
      const result = offPalette(shot, GOLDEN);
      expect(
        result.total,
        `${route} @390: ${result.total} off-palette pixels in ${result.colours} colours (${result.top}); first at ${JSON.stringify(result.first)}`,
      ).toBe(0);
    });
  }
});

test.describe('pixel-perfect: every palette stays closed (640x540, full page)', () => {
  test.use({ viewport: { width: 640, height: 540 } });
  for (const slug of PACKS) {
    test(slug, async ({ page }) => {
      await page.goto('/docs/getting-started/introduction/');
      await page.evaluate((value) => window.localStorage.setItem('sai-website.theme', value), slug);
      await page.reload();
      await settle(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', slug);
      const result = offPalette(await page.screenshot({ fullPage: true, animations: 'disabled', caret: 'hide' }), palette(slug));
      expect(result.total, `${slug}: ${result.total} off-palette pixels (${result.top}); first at ${JSON.stringify(result.first)}`).toBe(0);
    });
  }
});

/**
 * Face pairing. Each pixel face is drawn for exactly one size; at any other
 * size its squares are scaled and no longer sit on the grid. Both engines on
 * the reference host render these faces without smoothing (the faces carry a
 * no-grayscale gasp table), so a wrong face at a wrong size shows up as
 * distorted but palette-clean glyphs — invisible to the colour counter. This
 * check reads the computed style of every element that paints text instead.
 */
const FACE_FOR_SIZE = { 10: ['SAI Pixel 10'], 11: ['SAI Pixel 11'], 12: ['SAI Pixel 12', 'SAI Pixel Mono 12'], 14: ['SAI Pixel 14'], 16: ['SAI Pixel 16'] };

async function facePairing(page) {
  return page.evaluate((map) => {
    const bad = [];
    const chars = new Set();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || seen.has(el) || !node.textContent.trim()) continue;
      seen.add(el);
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height || el.closest('[hidden], script, style, noscript')) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      const size = parseFloat(cs.fontSize);
      const face = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
      const allowed = map[size];
      if (!allowed || !allowed.includes(face)) bad.push(`${el.tagName.toLowerCase()}.${[...el.classList].join('.')} ${size}px "${face}"`);
      else if (!document.fonts.check(`${cs.fontWeight} ${cs.fontStyle} ${size}px "${face}"`)) bad.push(`${face} ${size}px not loaded`);
      else for (const ch of new Set(node.textContent)) if (/\S/.test(ch)) chars.add(`${cs.fontWeight}|${cs.fontStyle}|${size}|${face}|${ch}`);
    }
    // A character the face does not map is drawn by a fallback font. On the
    // reference host that fallback is aliased too, so it is palette-clean and
    // invisible to the colour counter; it is still off the face's grid. A
    // character drawn by the face measures the same whatever generic family
    // follows it in the stack; a missing one takes the width of the fallback.
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (font, ch) => {
      ctx.font = font;
      return ctx.measureText(ch).width;
    };
    const missing = new Set();
    for (const key of chars) {
      const [weight, style, size, face, ch] = key.split('|');
      const base = `${weight} ${style} ${size}px "${face}"`;
      const widths = ['monospace', 'serif', 'sans-serif'].map((generic) => width(`${base}, ${generic}`, ch));
      if (widths.some((w) => w !== widths[0])) missing.add(`U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${ch} not in "${face}"`);
    }
    bad.push(...missing);
    return bad;
  }, FACE_FOR_SIZE);
}

test.describe('face pairing: every text element uses the face drawn for its size', () => {
  for (const route of ROUTES) {
    test(route, async ({ page, browserName }) => {
      test.skip(browserName !== 'chromium', 'computed-style check; one engine is enough');
      await page.goto(route);
      await settle(page);
      const bad = await facePairing(page);
      expect(bad.slice(0, 8), `${route}: ${bad.length} text element(s) on a face that is not drawn for their size`).toEqual([]);
    });
  }

  test('control: a 16px paragraph on the 12px face is caught', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'computed-style check; one engine is enough');
    await page.goto('/');
    await settle(page);
    await page.evaluate(() => {
      const p = document.createElement('p');
      p.textContent = 'scaled face control';
      p.style.fontSize = '16px';
      document.querySelector('main').prepend(p);
    });
    expect((await facePairing(page)).length).toBeGreaterThan(0);
  });
});

test.describe('pixel-perfect: instrument controls', () => {
  test('an anti-aliased circle is detected', async ({ page }) => {
    await page.goto('/');
    await settle(page);
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'control-circle';
      div.style.cssText = 'position:fixed;left:10px;top:10px;width:40px;height:40px;z-index:99;';
      div.innerHTML =
        '<svg width="40" height="40"><circle cx="20" cy="20" r="15" fill="var(--textPrimary)"/></svg>';
      document.body.append(div);
    });
    const shot = await page.locator('#control-circle').screenshot();
    expect(offPalette(shot, GOLDEN).total, 'colour counter must see AA edge pixels').toBeGreaterThan(0);
  });

  test('text shifted half a pixel is detected where the engine smooths text', async ({ page, browserName }) => {
    test.skip(
      browserName !== 'webkit',
      'WebKit smooths a sub-pixel-transformed text run; Chromium on a host with system smoothing off does not.',
    );
    await page.goto('/');
    await settle(page);
    await page.evaluate(() => {
      const div = document.createElement('div');
      div.id = 'control-text';
      div.textContent = 'Sub-pixel offset control: The quick brown fox jumps.';
      div.style.cssText =
        'transform:translate(0.5px,0.25px);width:600px;padding:2px;background:var(--background);color:var(--textPrimary);';
      document.querySelector('main').prepend(div);
    });
    await settle(page);
    const shot = await page.locator('#control-text').screenshot();
    expect(offPalette(shot, GOLDEN).total, 'a fractional text origin must produce smoothed pixels').toBeGreaterThan(0);
  });
});

/**
 * Code-face (mono) coverage. The face-pairing sweep proves no built page falls
 * back to a system font; this proves the face itself, including the composite
 * supplement, and that the probe still notices a code point the face does not
 * map. The required characters are the contracted specimen plus every code
 * point the generated coverage metadata records as supplemented, so a build
 * that quietly drops one fails here rather than in a visitor's browser.
 */
const MONO_COVERAGE = JSON.parse(readFileSync('src/content-engine/i18n/font-coverage.json', 'utf8')).mono;
const MONO_SPECIMEN = [
  'A a 0 _ -',
  '– — … “ ” ‘ ’',
  '→ ← ↑ ↓',
  'Š š Ţ ţ ŕ ķ ĝ ĵ ł ż',
  'ș ț ı',
  '€ № ™',
  '─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ═ ║',
].join(' ');

/** Lay text out on the code face and report every code point a fallback drew. */
async function probeCodeSpecimen(page, text) {
  await page.evaluate((value) => {
    document.getElementById('mono-specimen')?.remove();
    const pre = document.createElement('pre');
    pre.id = 'mono-specimen';
    pre.className = 'w-code';
    pre.textContent = value;
    document.querySelector('main')?.append(pre);
  }, text);
  await settle(page);
  return page.evaluate(() => {
    const el = document.getElementById('mono-specimen');
    const cs = getComputedStyle(el);
    const face = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '');
    const ctx = document.createElement('canvas').getContext('2d');
    const width = (font, ch) => {
      ctx.font = font;
      return ctx.measureText(ch).width;
    };
    const base = `${cs.fontWeight} ${cs.fontStyle} ${parseFloat(cs.fontSize)}px "${face}"`;
    const missing = [];
    for (const ch of new Set(el.textContent)) {
      if (!/\S/.test(ch)) continue;
      const widths = ['monospace', 'serif', 'sans-serif'].map((generic) => width(`${base}, ${generic}`, ch));
      if (widths.some((w) => w !== widths[0])) {
        missing.push(`U+${ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${ch}`);
      }
    }
    return { face, size: cs.fontSize, missing };
  });
}

test.describe('mono coverage: the code face draws every required glyph', () => {
  test('specimen: ASCII, punctuation, arrows, extended Latin, box drawing', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'computed-style check; one engine is enough');
    await page.goto('/');
    await settle(page);
    const probe = await probeCodeSpecimen(page, MONO_SPECIMEN);
    expect(probe.face, 'the specimen must be laid out on the code face').toBe('SAI Pixel Mono 12');
    expect(probe.missing).toEqual([]);
  });

  test('every code point the coverage metadata records as supplemented is really drawn', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'computed-style check; one engine is enough');
    const codepoints = MONO_COVERAGE.supplement.codepoints;
    expect(codepoints.length, 'the composite code face records its supplemented code points').toBeGreaterThan(0);
    await page.goto('/');
    await settle(page);
    const probe = await probeCodeSpecimen(page, codepoints.map((cp) => String.fromCodePoint(cp)).join(' '));
    expect(probe.missing).toEqual([]);
  });

  test('coverage metadata keeps Spleen primary and names the approved supplement', () => {
    expect(MONO_COVERAGE.primary.source).toBe('Spleen 6x12');
    expect(MONO_COVERAGE.supplement.source).toBe('DejaVu Sans Mono');
    expect(MONO_COVERAGE.primary.glyphs + MONO_COVERAGE.supplement.glyphs).toBe(MONO_COVERAGE.glyphs);
  });

  test('control: a code point the code face does not map is reported', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'computed-style check; one engine is enough');
    await page.goto('/');
    await settle(page);
    const probe = await probeCodeSpecimen(page, 'α');
    expect(probe.missing, 'missing-glyph detection must still fire on this face').toEqual(['U+03B1 α']);
  });
});
