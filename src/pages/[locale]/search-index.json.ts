/**
 * Locale search index (content-system M49), built for every routed locale with
 * searchEnabled. It indexes only what exists in that language — the localized
 * documents the variant plan built — so languages are never mixed into one
 * ranking pool, and fallback English is never indexed as a translation.
 */
import type { APIRoute } from 'astro';
import { PLAN, localeOf, renderLocalizedDoc, translator } from '../../content-engine/i18n/catalog';
import { allDocs } from '../../lib/docs';

export function getStaticPaths() {
  return PLAN.filter((p) => localeOf(p.locale).searchEnabled).map((p) => ({ params: { locale: p.prefix }, props: { locale: p.locale } }));
}

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const GET: APIRoute = async ({ props }) => {
  const { locale } = props as { locale: string };
  const tx = translator(locale);
  const plan = PLAN.find((p) => p.locale === locale)!;
  const sections = new Map((await allDocs()).map((d) => [d.id, d.data.section]));
  const entries = [];
  for (const { slug, variant } of plan.docs) {
    const page = await renderLocalizedDoc(slug, locale);
    entries.push({
      url: variant,
      title: page.title,
      kind: `${tx.text('pages.docs.index.label')} · ${tx.text(`docs-ui.section.${sections.get(slug)}`)}`,
      rank: 3,
      text: `${page.description} ${page.body.match(/^#{2,3} .+$/gm)?.join(' ') ?? ''} ${plain(page.body).slice(0, 900)}`,
    });
  }
  return new Response(JSON.stringify(entries), { headers: { 'content-type': 'application/json; charset=utf-8' } });
};
