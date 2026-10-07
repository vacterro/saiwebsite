/**
 * Canonical Wintage theme-pack contract.
 *
 * Owner: the 21-token schema and the pack identity rules. Ported from the
 * Wintage source owner (`tools/theme-schema.js` in
 * Wintage_07.10.26-T03-09-39), so a SAI_WEBSITE pack and a Wintage pack mean
 * exactly the same thing. Token order is display order, not a cosmetic
 * preference: the swatch grid and the generated CSS both follow it.
 *
 * No colour literal may be added to this file. Colour lives in `packs/`.
 */

/** The complete token set every pack MUST carry, in canonical display order. */
export const REQUIRED_TOKENS = [
  'background', 'backgroundSoft',
  'surface', 'surfaceRaised', 'surfaceAlt',
  'borderDark', 'borderHighlight', 'bevelLight', 'borderMuted',
  'textPrimary', 'textSecondary', 'textMuted',
  'accentTeal', 'accentTealDeep',
  'success', 'warning', 'danger', 'dangerText',
  'selection', 'compareBack', 'link',
] as const;

export type TokenName = (typeof REQUIRED_TOKENS)[number];

export type ThemeTokens = Record<TokenName, string>;

export interface ThemePack {
  slug: string;
  label: string;
  /** Menu order. Ties break by slug, so the list never reshuffles by accident. */
  order: number;
  /** Provenance note carried by the Wintage pack, when present. */
  source?: string;
  tokens: ThemeTokens;
}

/** Golden Default is the canonical first-render identity. Never derived, never configurable. */
export const DEFAULT_THEME_SLUG = 'goldendefault';

const SLUG_RE = /^[a-z][a-z0-9]*$/;
const HEX_RE = /^#[0-9A-Fa-f]{6}$/;

/**
 * Validate one pack. Throws on the first violation: a malformed pack must fail
 * the build rather than silently vanish from the site.
 */
export function validatePack(raw: unknown, filename: string): ThemePack {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${filename}: not a JSON object`);
  }
  const pack = raw as Partial<ThemePack> & { tokens?: Record<string, string> };

  const slug = pack.slug ?? filename.replace(/\.json$/, '');
  if (!SLUG_RE.test(slug)) {
    throw new Error(`${filename}: slug "${slug}" must be lowercase alphanumeric`);
  }
  if (`${slug}.json` !== filename) {
    throw new Error(
      `${filename}: filename does not match pack.slug "${slug}" — the two must never disagree`,
    );
  }
  if (!pack.label) throw new Error(`${filename}: no label`);
  if (pack.label.includes("'")) {
    throw new Error(`${filename}: label must not contain an apostrophe`);
  }
  if (!pack.tokens || typeof pack.tokens !== 'object') {
    throw new Error(`${filename}: no tokens object`);
  }

  for (const token of REQUIRED_TOKENS) {
    const value = pack.tokens[token];
    if (!value) throw new Error(`${filename}: missing token ${token}`);
    if (!HEX_RE.test(value)) {
      throw new Error(`${filename}: token ${token} = "${value}" is not a 6-digit hex`);
    }
  }

  const extra = Object.keys(pack.tokens).filter(
    (key) => !(REQUIRED_TOKENS as readonly string[]).includes(key),
  );
  if (extra.length) throw new Error(`${filename}: unknown token(s) ${extra.join(', ')}`);

  return {
    slug,
    label: pack.label,
    order: typeof pack.order === 'number' ? pack.order : 99,
    source: pack.source,
    tokens: pack.tokens as ThemeTokens,
  };
}

/** Menu order is each pack's own `order`, ties broken by slug. */
export function orderThemes(packs: ThemePack[]): ThemePack[] {
  return [...packs].sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));
}

/** Duplicate slug or label is a hard error: the selector resolves by slug, humans by label. */
export function assertDistinct(packs: ThemePack[]): void {
  const slugs = new Set<string>();
  const labels = new Set<string>();
  for (const pack of packs) {
    if (slugs.has(pack.slug)) throw new Error(`duplicate theme slug "${pack.slug}"`);
    if (labels.has(pack.label)) throw new Error(`duplicate theme label "${pack.label}"`);
    slugs.add(pack.slug);
    labels.add(pack.label);
  }
}

/**
 * Native-control colour-scheme hint. True when the pack's page background is
 * dark, so scrollbars and UA form chrome match instead of flashing light.
 * Uses the standard relative-luminance coefficients, not a naive average.
 */
export function isDarkBackground(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) < 0.18;
}
