/**
 * Site identity and the navigation shell.
 *
 * Every route lives in the page registry (src/content-engine/registry/pages.json)
 * with its maturity, so a page cannot quietly become "finished" without someone
 * changing the registry, and the menu can never link to a route that was never
 * declared.
 *
 * Maturity vocabulary is fixed by the roadmap, in two closed sets:
 *   page maturity       MASTER_ROADMAP §1 — placeholder | draft | experimental
 *                       | preview | stable | deprecated
 *   integration/project MASTER_ROADMAP §5 — supported | experimental | planned
 *                       | unavailable | unknown
 */
import registry from '../content-engine/registry/pages.json';
import { assertValidRegistry } from '../content-engine/registry/schema.mjs';

export type PageMaturity =
  | 'placeholder'
  | 'draft'
  | 'experimental'
  | 'preview'
  | 'stable'
  | 'deprecated';

export type ProjectMaturity =
  | 'supported'
  | 'experimental'
  | 'planned'
  | 'unavailable'
  | 'unknown';

export type Maturity = PageMaturity | ProjectMaturity;

export type SiteNav = 'primary' | 'secondary' | 'debug';

/** One page entry of src/content-engine/registry/pages.json, as validated by schema.mjs. */
interface RegistryPage {
  id: string;
  route: string;
  label: string;
  intent: string;
  maturity: PageMaturity;
  nav: SiteNav | 'none';
}

export interface SiteRoute {
  /** Stable page ID from the registry; survives a URL change. */
  id: string;
  href: string;
  label: string;
  /** One sentence, honest about what the route will hold. Never marketing. */
  intent: string;
  maturity: PageMaturity;
  /** Shown in the top navigation. */
  inMenu: boolean;
  nav: SiteNav;
}

export const SITE = {
  name: 'SAIPEN Protocol',
  /** Canonical one-line definition, from the SAIPEN README. */
  tagline: 'Continuation protocol for AI coding agents.',
  /** Canonical brochure line. */
  motto: 'The agent forgets. The project remembers.',
  /** Canonical public target. Not yet serving anything (FUTURE_GATES FG-001). */
  domain: 'saipenprotocol.com',
  origin: 'https://saipenprotocol.com',
  /** Confirmed by the SAIPEN HQ branding contract (docs/BRANDING.md). */
  repository: 'https://github.com/vacterro/saipen' as string | null,
  issues: 'https://github.com/vacterro/saipen/issues',
  organization: 'https://github.com/saipenhq',
  author: 'https://github.com/vacterro',
  community: 'https://discord.gg/SEYaYkuVgN',
} as const;

/**
 * The navigation shell, derived from the page registry
 * (src/content-engine/registry/pages.json). The registry is the one owner of
 * routes, labels, maturity and navigation surface; this file only projects the
 * entries that live in the shell (nav primary | secondary | debug). The
 * registry is validated here, so an invalid registry fails `astro build`.
 */
assertValidRegistry(registry);

export const ROUTES: SiteRoute[] = (registry.pages as RegistryPage[])
  .filter((page): page is RegistryPage & { nav: SiteNav } => page.nav !== 'none')
  .map((page) => ({
    id: page.id,
    href: page.route,
    label: page.label,
    intent: page.intent,
    maturity: page.maturity,
    inMenu: page.nav === 'primary',
    nav: page.nav,
  }));

export function routeByHref(href: string): SiteRoute | undefined {
  return ROUTES.find((route) => route.href === href);
}

/** Debug benches are not public shell routes: no breadcrumb, no nav, no discoverability claim. */
export function isPublicRoute(route: SiteRoute): boolean {
  return route.nav !== 'debug';
}

/** Primary desktop menu: only the routes flagged `inMenu`. */
export const MENU_ROUTES: SiteRoute[] = ROUTES.filter((route) => route.inMenu);

/** Every route the public shell promises a navigation path to. */
export const PUBLIC_ROUTES: SiteRoute[] = ROUTES.filter(isPublicRoute);

/** Reserved public routes deliberately left out of the primary menu strip. */
export const SECONDARY_ROUTES: SiteRoute[] = PUBLIC_ROUTES.filter((route) => !route.inMenu);
