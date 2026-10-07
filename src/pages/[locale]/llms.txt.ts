/**
 * Locale llms.txt (content-system M49), built for every routed locale with
 * llmsEnabled. Canonical English /llms.txt stays primary; this index lists
 * only documents translated to a status the locale renders, each with its
 * Markdown twin, and says that the English original is normative.
 */
import type { APIRoute } from 'astro';
import { SITE } from '../../data/site';
import { PLAN, localeOf, renderLocalizedDoc } from '../../content-engine/i18n/catalog';

export function getStaticPaths() {
  return PLAN.filter((p) => localeOf(p.locale).llmsEnabled).map((p) => ({ params: { locale: p.prefix }, props: { locale: p.locale } }));
}

export const GET: APIRoute = async ({ props }) => {
  const { locale } = props as { locale: string };
  const plan = PLAN.find((p) => p.locale === locale)!;
  const l = localeOf(locale);
  const o = SITE.origin;
  const lines = [
    `# ${SITE.name} (${l.nativeName})`,
    '',
    `> Translated documentation in ${l.displayName} (${locale}). The English site and ${o}/llms.txt are canonical; the SAIPEN repository is normative over both.`,
    '',
    `## Docs (${locale})`,
    '',
  ];
  for (const { slug, variant, status } of plan.docs) {
    const page = await renderLocalizedDoc(slug, locale);
    lines.push(`- [${page.title}](${o}${variant.replace(/\/$/, '')}.md): ${page.description} (status ${status}; original ${o}/docs/${slug}/)`);
  }
  lines.push('');
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
