/**
 * sitemap.xml (MASTER_ROADMAP M18), generated from the same sources the pages
 * are: the route registry, the docs and blog collections, the spec topics and
 * the playground scenarios. Alias and debug pages are left out on purpose.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { PUBLIC_ROUTES, SITE } from '../data/site';
import { allDocs } from '../lib/docs';
import { SPEC_VERSION } from '../lib/canonical';
import { SPEC_TOPICS } from '../lib/spec';
import { SCENARIOS } from '../data/scenarios';

export const GET: APIRoute = async () => {
  const paths = [
    ...PUBLIC_ROUTES.map((r) => r.href),
    ...(await allDocs()).map((d) => `/docs/${d.id}/`),
    `/spec/${SPEC_VERSION}/`,
    ...SPEC_TOPICS.map((t) => `/spec/${SPEC_VERSION}/${t.slug}/`),
    ...(await getCollection('blog')).map((p) => `/blog/${p.id}/`),
    ...SCENARIOS.map((s) => `/playground/${s.slug}/`),
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
