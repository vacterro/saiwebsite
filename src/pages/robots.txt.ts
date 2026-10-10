/**
 * /robots.txt, generated from the effective public origin (src/data/site.ts).
 * It replaces the former fixed public/robots.txt, so the Sitemap line can never
 * name a different host than the sitemap and canonical URLs of the same build.
 * /debug/ carries a crawl-hint Disallow, and every debug page additionally
 * carries noindex (see SiteLayout). The Disallow is NOT access control and
 * may hide the noindex directive from compliant crawlers, so diagnostic
 * exclusion from search results is never guaranteed. Sensitive diagnostic
 * content is therefore a publication blocker: review /debug/ before any
 * release (see OPERATOR.md).
 */
import type { APIRoute } from 'astro';
import { SITE } from '../data/site';

export const GET: APIRoute = () => {
  const body = [
    '# SAI_WEBSITE — static, no private areas.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /debug/',
    '',
    `Sitemap: ${SITE.origin}/sitemap.xml`,
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
