/**
 * Route-registry reader for the Node-side gates.
 *
 * `src/data/site.ts` is TypeScript, so the browser can `import` it but the
 * static audit and the Playwright shell suite cannot. One parser here keeps a
 * single source of truth instead of a second hard-coded route array in two
 * test files: both gates read the same registry text and both fail loudly if
 * the file's shape ever drifts.
 *
 * Exported shape per route: { href, label, maturity, inMenu, intent }.
 */
import { readFileSync } from 'node:fs';

const BLOCKS = /href:\s*'([^']+)',[\s\S]*?label:\s*'([^']+)',[\s\S]*?maturity:\s*'([^']+)',[\s\S]*?inMenu:\s*(true|false),/g;

export function readRoutes(file = 'src/data/site.ts') {
  const text = readFileSync(file, 'utf8');
  const routes = [...text.matchAll(BLOCKS)].map((m) => ({
    href: m[1],
    label: m[2],
    maturity: m[3],
    inMenu: m[4] === 'true',
  }));

  // The regex stops at `inMenu`, which is the last field before the closing
  // brace of every route object. Counting `href:` declarations against parsed
  // objects catches a reordered field instead of silently dropping a route.
  const declared = [...text.matchAll(/href:\s*'/g)].length;
  if (declared !== routes.length) {
    throw new Error(
      `${file}: parsed ${routes.length} routes but ${declared} href declarations — route-registry.mjs parser drifted`,
    );
  }
  return routes;
}

/** Routes a visitor must be able to reach from normal navigation. */
export function publicRoutes(routes = readRoutes()) {
  return routes.filter((route) => !route.href.startsWith('/debug/'));
}
