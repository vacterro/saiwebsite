/**
 * Roadmap milestones (MASTER_ROADMAP §8) and where each one lives on the site.
 * Rendered on /status/. A milestone is "delivered" only when its page or file
 * exists in this build — audit-build checks every `where` path.
 */
export interface Milestone {
  id: string;
  title: string;
  state: 'delivered' | 'deferred';
  where?: string;
  note?: string;
}

export const MILESTONES: Milestone[] = [
  { id: 'M0', title: 'Repository bootstrap', state: 'delivered', where: '/about/' },
  { id: 'M1', title: 'Wintage design kernel', state: 'delivered', where: '/debug/components/' },
  { id: 'M2', title: 'Component lab', state: 'delivered', where: '/debug/components/' },
  { id: 'M3', title: 'Full 16-theme system', state: 'delivered', where: '/debug/themes/' },
  { id: 'M4', title: 'Site shell', state: 'delivered', where: '/' },
  { id: 'M5', title: 'Documentation shell', state: 'delivered', where: '/docs/' },
  { id: 'M6', title: 'Core explanatory content', state: 'delivered', where: '/docs/getting-started/introduction/' },
  { id: 'M7', title: 'Specification surface', state: 'delivered', where: '/spec/' },
  { id: 'M8', title: 'Homepage V1', state: 'delivered', where: '/' },
  { id: 'M9', title: 'Protocol visualizer V1', state: 'delivered', where: '/spec/v8/lifecycle/' },
  { id: 'M10', title: 'Ecosystem catalogue', state: 'delivered', where: '/ecosystem/' },
  { id: 'M11', title: 'Compatibility matrix', state: 'delivered', where: '/compatibility/' },
  { id: 'M12', title: 'Agent-readable documentation', state: 'delivered', where: '/llms.txt' },
  { id: 'M13', title: 'Search', state: 'delivered', where: '/search/' },
  { id: 'M14', title: 'Accessibility hardening', state: 'delivered', where: '/about/#accessibility' },
  { id: 'M15', title: 'Performance budget', state: 'delivered', where: '/about/#performance' },
  { id: 'M16', title: 'Visual regression', state: 'delivered', where: '/about/#quality-gates' },
  { id: 'M17', title: 'Content validation', state: 'delivered', where: '/about/#quality-gates' },
  { id: 'M18', title: 'SEO and discoverability foundation', state: 'delivered', where: '/sitemap.xml' },
  { id: 'M19', title: 'Downloads surface', state: 'delivered', where: '/downloads/' },
  { id: 'M20', title: 'Security page', state: 'delivered', where: '/security/' },
  { id: 'M21', title: 'Benchmarks methodology', state: 'delivered', where: '/benchmarks/' },
  { id: 'M22', title: 'Pricing statement', state: 'delivered', where: '/pricing/' },
  { id: 'M23', title: 'Deterministic playground', state: 'delivered', where: '/playground/' },
  { id: 'M24', title: 'Blog and changelog', state: 'delivered', where: '/changelog/' },
  { id: 'M25', title: 'Deployment-ready static build', state: 'delivered', where: '/about/#deployment' },
  { id: 'M26', title: 'Domain and production hosting', state: 'deferred', note: 'future gate FG-001: needs a domain and a host decision' },
  { id: 'M27', title: 'Production monitoring', state: 'deferred', note: 'needs a public endpoint first' },
  { id: 'M28', title: 'Analytics', state: 'deferred', note: 'future gate FG-015: no public traffic yet' },
  { id: 'M29', title: 'Internationalization', state: 'deferred', note: 'future gate FG-019: English content must stabilise first' },
  { id: 'M30', title: 'Public launch readiness', state: 'deferred', note: 'follows hosting' },
];
