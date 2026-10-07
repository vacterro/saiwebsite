/** /llms-full.txt: every documentation page as Markdown, in reading order. */
import type { APIRoute } from 'astro';
import { allDocs } from '../lib/docs';
import { SHORT_COMMIT, meta } from '../lib/canonical';
import { SITE } from '../data/site';

export const GET: APIRoute = async () => {
  const docs = await allDocs();
  const parts = [
    `# ${SITE.name} — full documentation`,
    '',
    `Explanatory documentation for SAIPEN ${meta.version} @ ${SHORT_COMMIT}. Normative source: ${meta.repository}.`,
    '',
    ...docs.flatMap((d) => [
      '---',
      '',
      `# ${d.data.title}`,
      '',
      `Source page: ${SITE.origin}/docs/${d.id}/`,
      '',
      `> ${d.data.description}`,
      '',
      (d.body ?? '').trim(),
      '',
    ]),
  ];
  return new Response(parts.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
