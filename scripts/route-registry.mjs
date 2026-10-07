/**
 * Route-registry reader for the Node-side gates.
 *
 * The page registry (src/content-engine/registry/pages.json) is plain JSON, so
 * the static audit and the Playwright shell suite read the same file the site
 * is built from, validated by the same schema module. There is no second
 * hard-coded route array and no source-text parsing.
 *
 * Exported shape per shell route: { id, href, label, maturity, inMenu, intent, nav },
 * the same projection src/data/site.ts builds.
 */
import { readFileSync } from 'node:fs';
import { assertValidRegistry } from '../src/content-engine/registry/schema.mjs';

export const REGISTRY_FILE = 'src/content-engine/registry/pages.json';

export function readRegistry(file = REGISTRY_FILE) {
  return assertValidRegistry(JSON.parse(readFileSync(file, 'utf8')), file);
}

/** Every route the navigation shell knows: nav primary, secondary or debug. */
export function readRoutes(file = REGISTRY_FILE) {
  return readRegistry(file)
    .pages.filter((page) => page.nav !== 'none')
    .map((page) => ({
      id: page.id,
      href: page.route,
      label: page.label,
      maturity: page.maturity,
      inMenu: page.nav === 'primary',
      intent: page.intent,
      nav: page.nav,
    }));
}

/** Routes a visitor must be able to reach from normal navigation. */
export function publicRoutes(routes = readRoutes()) {
  return routes.filter((route) => route.nav !== 'debug');
}
