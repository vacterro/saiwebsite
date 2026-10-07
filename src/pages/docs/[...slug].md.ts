/**
 * Raw Markdown for every documentation page (MASTER_ROADMAP M12): the same
 * text the HTML page renders, without the window chrome, for agents and tools.
 */
import type { APIRoute } from 'astro';
import { allDocs } from '../../lib/docs';
import { SITE } from '../../data/site';

export async function getStaticPaths() {
  const docs = await allDocs();
  return docs.map((doc) => ({ params: { slug: doc.id }, props: { doc } }));
}

export const GET: APIRoute = ({ props }) => {
  const { doc } = props as { doc: Awaited<ReturnType<typeof allDocs>>[number] };
  const header = [
    `# ${doc.data.title}`,
    '',
    `> ${doc.data.description}`,
    '',
    `Canonical page: ${SITE.origin}/docs/${doc.id}/`,
    `Maturity: ${doc.data.maturity}. Authority: ${doc.data.authority} (the SAIPEN repository is normative).`,
    '',
  ].join('\n');
  return new Response(`${header}\n${doc.body ?? ''}`.trimEnd() + '\n', {
    headers: { 'content-type': 'text/markdown; charset=utf-8' },
  });
};
