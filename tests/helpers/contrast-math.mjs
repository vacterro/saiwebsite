/**
 * Pure foreground/background contrast math shared by the browser
 * contrast gate (tests/theme-contrast.spec.mjs, injected into the page)
 * and its node-side negative controls
 * (scripts/tests/contrast-math.test.mjs).
 *
 * No DOM here: callers supply parsed colors. Alpha is composited
 * correctly through the whole background stack instead of treating the
 * first non-transparent ancestor as opaque. A stack that never reaches
 * an opaque layer yields { manual } -- record MANUAL_REVIEW, never a
 * fabricated ratio.
 */

export function parseCssColor(s) {
  const m = String(s ?? '').match(/[\d.]+/g)?.map(Number) ?? [];
  if (m.length >= 3) return [m[0], m[1], m[2], m.length >= 4 ? m[3] : 1];
  const hex = String(s ?? '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  return null;
}

/** Composite top-over-bottom; both [r,g,b,a]. Returns opaque [r,g,b]. */
export function compositeOver([fr, fg, fb, fa], [br, bg, bb]) {
  const a = Math.min(Math.max(fa, 0), 1);
  return [fr * a + br * (1 - a), fg * a + bg * (1 - a), fb * a + bb * (1 - a)];
}

/**
 * Resolve the effective background behind a foreground.
 * layers: array of [r,g,b,a] from the element outward (element's own
 * background first, viewport base last). The last layer MUST be opaque;
 * otherwise no honest ratio exists.
 */
export function resolveBackground(layers) {
  if (!Array.isArray(layers) || !layers.length) return { manual: 'empty background stack' };
  let acc = null;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (!l) return { manual: `unparsable background layer at depth ${layers.length - 1 - i}` };
    if (acc === null) {
      if (l[3] < 1) return { manual: 'no opaque base layer; backdrop unknown' };
      acc = l.slice(0, 3);
    } else {
      acc = compositeOver([l[0], l[1], l[2], l[3]], acc);
    }
  }
  return { color: acc };
}

export function luminance([r, g, b]) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG large text: >=24px, or >=19px (≈14pt) bold (>=700). */
export function isLargeText(fontSizePx, fontWeight) {
  const w = Number(fontWeight) || (fontWeight === 'bold' ? 700 : 400);
  return fontSizePx >= 24 || (fontSizePx >= 19 && w >= 700);
}

/** Source text of the page-side collector (same compositing rules).
 * Single self-contained function: Playwright serializes only the
 * function's own source, so nothing may close over outer scope. */
export const COLLECTOR_SOURCE = `((selectors) => {
  const ctx2d = document.createElement('canvas').getContext('2d');
  const rgba = (s) => {
    const m = String(s ?? '').match(/[\\d.]+/g)?.map(Number) ?? [];
    if (m.length >= 3) return [m[0], m[1], m[2], m.length >= 4 ? m[3] : 1];
    // System color keywords (CanvasText, ButtonText, ...): getComputedStyle
    // may return the keyword itself. Resolve through canvas fillStyle,
    // which serializes to rgb(); unresolvable stays null (MANUAL_REVIEW).
    try {
      ctx2d.fillStyle = '#000000';
      ctx2d.fillStyle = String(s ?? '');
      const r = String(ctx2d.fillStyle).match(/[\\d.]+/g)?.map(Number) ?? [];
      return r.length >= 3 ? [r[0], r[1], r[2], r.length >= 4 ? r[3] : 1] : null;
    } catch { return null; }
  };
    const out = { pairs: {}, missing: [] };
    for (const [name, sel] of Object.entries(selectors)) {
      const el = document.querySelector(sel);
      if (!el) { out.missing.push(name + ' <- ' + sel); continue; }
      const cs = getComputedStyle(el);
      const stack = [];
      let n = el;
      while (n && n !== document.documentElement) {
        stack.push(rgba(getComputedStyle(n).backgroundColor));
        n = n.parentElement;
      }
      stack.push(rgba(getComputedStyle(document.documentElement).backgroundColor));
      out.pairs[name] = {
        fg: rgba(cs.color),
        bgStack: stack,
        fontSize: parseFloat(cs.fontSize),
        fontWeight: cs.fontWeight,
      };
    }
    out.appliedTheme = document.documentElement.dataset.theme ?? null;
    return out;
  })`;
