/**
 * Theme registry — the only source of colour on the site.
 *
 * Packs are validated at module load, so a malformed or drifted pack fails
 * `astro build` and `astro dev` instead of shipping. `themeCss()` renders the
 * validated data into CSS custom properties: `:root` carries Golden Default
 * (the canonical first paint, no flash, no JS) and every pack is also emitted
 * as a `[data-theme="…"]` scope, so nested palettes and the next slice's
 * switcher need no rebuild and no second copy of the data.
 */
import {
  DEFAULT_THEME_SLUG,
  REQUIRED_TOKENS,
  assertDistinct,
  isDarkBackground,
  orderThemes,
  validatePack,
  type ThemePack,
} from './schema';

const modules = import.meta.glob<Record<string, unknown>>('./packs/*.json', {
  eager: true,
  import: 'default',
});

const packs = Object.entries(modules).map(([path, raw]) =>
  validatePack(raw, path.replace(/^.*\//, '')),
);
assertDistinct(packs);

/** All 16 canonical packs, in deterministic menu order. */
export const themes: ThemePack[] = orderThemes(packs);

export const defaultTheme: ThemePack = (() => {
  const found = themes.find((pack) => pack.slug === DEFAULT_THEME_SLUG);
  if (!found) throw new Error(`canonical theme "${DEFAULT_THEME_SLUG}" is missing from packs/`);
  return found;
})();

export function themeBySlug(slug: string): ThemePack {
  return themes.find((pack) => pack.slug === slug) ?? defaultTheme;
}

/** The `data-theme` scope for one palette, as an attribute string for `<html>`. */
export function themeAttr(slug: string): string {
  return `data-theme="${slug}"`;
}

function declarations(pack: ThemePack): string {
  const vars = REQUIRED_TOKENS.map((token) => `      --${token}: ${pack.tokens[token]};`);
  const scheme = isDarkBackground(pack.tokens.background) ? 'dark' : 'light';
  return [
    `    --theme-slug: "${pack.slug}";`,
    `    --theme-label: "${pack.label}";`,
    `    color-scheme: ${scheme};`,
    ...vars,
  ].join('\n');
}

/**
 * Full palette stylesheet. `:root` + `[data-theme="goldendefault"]` both carry
 * Golden Default, so the canonical identity survives whether the scope sits on
 * `<html>` or on a nested preview box.
 */
export function themeCss(): string {
  const blocks = themes.map((pack) => `  [data-theme="${pack.slug}"] {\n${declarations(pack)}\n  }`);
  return [`:root {\n${declarations(defaultTheme)}\n}`, ...blocks].join('\n');
}
