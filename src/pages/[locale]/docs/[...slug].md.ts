/**
 * Raw Markdown of every localized documentation page, the twin of
 * /docs/<slug>.md in that locale. It names the English page as canonical and
 * normative, so an agent reading a translation always knows what outranks it.
 */
import type { APIRoute } from 'astro';
import { SITE } from '../../../data/site';
import { PLAN, renderLocalizedDoc } from '../../../content-engine/i18n/catalog';

export function getStaticPaths() {
  return PLAN.flatMap((p) => p.docs.map((d) => ({ params: { locale: p.prefix, slug: d.slug }, props: { locale: p.locale, slug: d.slug, status: d.status } })));
}

export const GET: APIRoute = async ({ props }) => {
  const { locale, slug, status } = props as { locale: string; slug: string; status: string };
  const page = await renderLocalizedDoc(slug, locale);
  const header = [
    `# ${page.title}`,
    '',
    `> ${page.description}`,
    '',
    `Language: ${locale}. Translation status: ${status}.`,
    `English original (normative over this translation): ${SITE.origin}/docs/${slug}/`,
    '',
  ].join('\n');
  return new Response(`${header}\n${page.body}`.trimEnd() + '\n', { headers: { 'content-type': 'text/markdown; charset=utf-8' } });
};
