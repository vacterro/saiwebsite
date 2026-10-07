/**
 * Site identity and route registry.
 *
 * Every route the bootstrap reserves lives here with its maturity, so a page
 * cannot quietly become "finished" without someone changing this file, and the
 * menu can never link to a route that was never declared.
 *
 * Maturity vocabulary is fixed by the roadmap, in two closed sets:
 *   page maturity       MASTER_ROADMAP §1 — placeholder | draft | experimental
 *                       | preview | stable | deprecated
 *   integration/project MASTER_ROADMAP §5 — supported | experimental | planned
 *                       | unavailable | unknown
 */
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

export interface SiteRoute {
  href: string;
  label: string;
  /** One sentence, honest about what the route will hold. Never marketing. */
  intent: string;
  maturity: PageMaturity;
  /** Shown in the top navigation. */
  inMenu: boolean;
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

export const ROUTES: SiteRoute[] = [
  {
    href: '/',
    label: 'Home',
    intent: 'Entry point: what SAIPEN is, what breaks without it, and where to go next.',
    maturity: 'preview',
    inMenu: true,
  },
  {
    href: '/docs/',
    label: 'Docs',
    intent: 'Explanatory documentation: concepts, lifecycle, recovery, evidence, operation.',
    maturity: 'stable',
    inMenu: true,
  },
  {
    href: '/spec/',
    label: 'Spec',
    intent: 'Protocol reference generated from the canonical SAIPEN registry, with permanent version URLs.',
    maturity: 'stable',
    inMenu: true,
  },
  {
    href: '/ecosystem/',
    label: 'Ecosystem',
    intent: 'SAIPEN ecosystem projects, how each touches a SAIPEN project, with honest maturity labels.',
    maturity: 'preview',
    inMenu: true,
  },
  {
    href: '/playground/',
    label: 'Playground',
    intent: 'Deterministic, client-side protocol scenarios. Nothing is executed and no model is called.',
    maturity: 'preview',
    inMenu: true,
  },
  {
    href: '/search/',
    label: 'Search',
    intent: 'Static search over docs, spec, ecosystem and blog, computed in the browser.',
    maturity: 'stable',
    inMenu: true,
  },
  {
    href: '/about/',
    label: 'About',
    intent: 'Scope and authority of this website, who maintains SAIPEN, and the quality gates the site keeps.',
    maturity: 'stable',
    inMenu: true,
  },
  {
    href: '/compatibility/',
    label: 'Compatibility',
    intent: 'Supported agent hosts and their declared enforcement, rendered from the adapter registry.',
    maturity: 'stable',
    inMenu: false,
  },
  {
    href: '/downloads/',
    label: 'Downloads',
    intent: 'Release catalogue with GitHub-reported SHA-256 digests. The site hosts no binaries.',
    maturity: 'preview',
    inMenu: false,
  },
  {
    href: '/security/',
    label: 'Security',
    intent: 'Scope, supported versions, how to report a vulnerability, and the trust model of this site.',
    maturity: 'stable',
    inMenu: false,
  },
  {
    href: '/community/',
    label: 'Community',
    intent: 'Where to discuss, where to file bugs, and how to propose a protocol change.',
    maturity: 'stable',
    inMenu: false,
  },
  {
    href: '/status/',
    label: 'Status',
    intent: 'Static build status and roadmap milestones. No hosted service exists, so no uptime is reported.',
    maturity: 'stable',
    inMenu: false,
  },
  {
    href: '/benchmarks/',
    label: 'Benchmarks',
    intent: 'Benchmark methodology. No recovery or performance numbers are published yet.',
    maturity: 'draft',
    inMenu: false,
  },
  {
    href: '/pricing/',
    label: 'Pricing',
    intent: 'A plain statement: free and open, no hosted service, no paid plan.',
    maturity: 'stable',
    inMenu: false,
  },
  {
    href: '/blog/',
    label: 'Blog',
    intent: 'Design notes and explanations. Editorial, never protocol authority.',
    maturity: 'preview',
    inMenu: false,
  },
  {
    href: '/changelog/',
    label: 'Changelog',
    intent: 'Factual release history of the website and recent protocol releases.',
    maturity: 'stable',
    inMenu: false,
  },
  {
    href: '/debug/components/',
    label: 'Components',
    intent: 'Visual acceptance bench for every Wintage primitive.',
    maturity: 'draft',
    inMenu: false,
  },
  {
    href: '/debug/themes/',
    label: 'Themes',
    intent: 'All 16 canonical palettes rendered side by side for inspection.',
    maturity: 'draft',
    inMenu: false,
  },
  {
    href: '/debug/fonts/',
    label: 'Fonts',
    intent: 'Wintage faces against the open-licence pixel candidate, for the publication licence decision.',
    maturity: 'draft',
    inMenu: false,
  },
  {
    href: '/debug/rendering/',
    label: 'Rendering',
    intent: 'Deterministic rendering surface: viewport, DPR, active palette, integer grid, bevels, raster scaling, font rendering.',
    maturity: 'draft',
    inMenu: false,
  },
];

export function routeByHref(href: string): SiteRoute | undefined {
  return ROUTES.find((route) => route.href === href);
}

/** Debug benches are not public shell routes: no breadcrumb, no nav, no discoverability claim. */
export function isPublicRoute(route: SiteRoute): boolean {
  return !route.href.startsWith('/debug/');
}

/** Primary desktop menu: only the routes flagged `inMenu`. */
export const MENU_ROUTES: SiteRoute[] = ROUTES.filter((route) => route.inMenu);

/** Every route the public shell promises a navigation path to. */
export const PUBLIC_ROUTES: SiteRoute[] = ROUTES.filter(isPublicRoute);

/** Reserved public routes deliberately left out of the primary menu strip. */
export const SECONDARY_ROUTES: SiteRoute[] = PUBLIC_ROUTES.filter((route) => !route.inMenu);
