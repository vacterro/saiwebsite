/**
 * Static search index (MASTER_ROADMAP M13): built with the site, served as one
 * JSON file, searched in the browser. No hosted service, no third-party
 * script. Technical material is ranked above editorial material by `rank`.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { allDocs, SECTION_TITLES } from '../lib/docs';
import { ERROR_CODES, PHASES, SPEC_VERSION } from '../lib/canonical';
import { SPEC_TOPICS } from '../lib/spec';
import { PHASE_PURPOSE } from '../data/phases';
import { PROJECTS } from '../data/ecosystem';

const plain = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const GET: APIRoute = async () => {
  const docs = await allDocs();
  const posts = await getCollection('blog');
  const entries = [
    ...docs.map((d) => ({
      url: `/docs/${d.id}/`,
      title: d.data.title,
      kind: `Docs · ${SECTION_TITLES[d.data.section]}`,
      rank: 3,
      text: `${d.data.description} ${(d.body ?? '').match(/^#{2,3} .+$/gm)?.join(' ') ?? ''} ${plain(d.body ?? '').slice(0, 900)}`,
    })),
    ...SPEC_TOPICS.map((t) => ({ url: `/spec/${SPEC_VERSION}/${t.slug}/`, title: t.title, kind: `Spec ${SPEC_VERSION}`, rank: 3, text: t.description })),
    ...PHASES.map((p) => ({
      url: `/spec/${SPEC_VERSION}/lifecycle/#phase-${p}`,
      title: `${p} phase`,
      kind: 'Spec · phase',
      rank: 3,
      text: PHASE_PURPOSE[p] ?? '',
    })),
    ...ERROR_CODES.map((code) => ({
      url: `/spec/${SPEC_VERSION}/errors/#${code}`,
      title: code,
      kind: 'Spec · error code',
      rank: 2,
      text: code.replace(/_/g, ' ').toLowerCase(),
    })),
    ...PROJECTS.map((p) => ({ url: `/ecosystem/#${p.name.toLowerCase()}`, title: p.name, kind: 'Ecosystem', rank: 2, text: `${p.role} ${p.relation}` })),
    ...posts.map((p) => ({ url: `/blog/${p.id}/`, title: p.data.title, kind: 'Blog', rank: 1, text: `${p.data.description} ${plain(p.body ?? '').slice(0, 600)}` })),
  ];
  return new Response(JSON.stringify(entries), { headers: { 'content-type': 'application/json; charset=utf-8' } });
};
