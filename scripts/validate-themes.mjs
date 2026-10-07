#!/usr/bin/env node
/**
 * Theme gate: validates every canonical pack against the shared schema.
 *
 * Runs the same owner the site build runs, so a drift between this gate and the
 * rendered site is not possible. Node strips the TypeScript types, no bundler
 * and no dependency is involved.
 *
 *   npm run validate:themes
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDistinct, DEFAULT_THEME_SLUG, orderThemes, validatePack } from '../src/themes/schema.ts';

const packsDir = fileURLToPath(new URL('../src/themes/packs/', import.meta.url));

const files = readdirSync(packsDir).filter((name) => name.endsWith('.json'));
const packs = files.map((name) => {
  const raw = JSON.parse(readFileSync(join(packsDir, name), 'utf8').replace(/^\uFEFF/, ''));
  return validatePack(raw, name);
});

assertDistinct(packs);
const ordered = orderThemes(packs);

if (!ordered.some((pack) => pack.slug === DEFAULT_THEME_SLUG)) {
  throw new Error(`canonical theme "${DEFAULT_THEME_SLUG}" is missing`);
}

console.log(`validate:themes OK — ${ordered.length} packs, 21 tokens each`);
for (const pack of ordered) {
  console.log(`  ${String(pack.order).padStart(3)}  ${pack.slug.padEnd(16)} ${pack.label}`);
}
