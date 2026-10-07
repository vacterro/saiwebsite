/**
 * sitemap.xml (MASTER_ROADMAP M18), generated from the same sources the pages
 * are: the route registry, the docs and blog collections, the spec topics and
 * the playground scenarios, and the translated pages of every public locale.
 * Alias, debug and pseudo-locale pages are left out on purpose.
 */
import type { APIRoute } from 'astro';
import { allPosts } from '../lib/blog';
import { PUBLIC_ROUTES, SITE } from '../data/site';
import { allDocs } from '../lib/docs';
import { SPEC_VERSION } from '../content-engine/models/protocol';
import { SPEC_TOPICS } from '../lib/spec';
import { SCENARIOS } from '../data/scenarios';
import { PLAN } from '../content-engine/i18n/catalog';

export const GET: APIRoute = async () => {
  const paths = [
    ...PUBLIC_ROUTES.map((r) => r.href),
    ...(await allDocs()).map((d) => `/docs/${d.id}/`),
    `/spec/${SPEC_VERSION}/`,
    ...SPEC_TOPICS.map((t) => `/spec/${SPEC_VERSION}/${t.slug}/`),
    ...(await allPosts()).map((p) => `/blog/${p.id}/`),
    ...SCENARIOS.map((s) => `/playground/${s.slug}/`),
    // Public locale variants (content-system M49): translated pages only, never
    // the pseudo-locale and never the 404 page.
    ...PLAN.filter((p) => p.stage !== 'pseudo').flatMap((p) => [
      ...p.pages.filter((x) => x.route !== '/404.html').map((x) => x.variant),
      ...p.docs.map((d) => d.variant),
    ]),
  ];
  const unique = [...new Set(paths)];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...unique.map((p) => `  <url><loc>${new URL(p, SITE.origin).href}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'application/xml; charset=utf-8' } });
};
