/**
 * Documentation index: ordering, the contents tree, previous/next.
 *
 * One ordering for the whole site: section order (DOC_SECTIONS), then each
 * page's `order`. The sidebar, previous/next links, llms.txt, the search index
 * and the docs landing page all read this list, so they cannot disagree.
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { DOC_SECTIONS } from '../content.config';
import { stripSegmentDirectives } from '../content-engine/i18n/segments.mjs';

export type Doc = CollectionEntry<'docs'>;

export const SECTION_TITLES: Record<(typeof DOC_SECTIONS)[number], string> = {
  'getting-started': 'Getting started',
  concepts: 'Concepts',
  protocol: 'Protocol',
  recovery: 'Recovery',
  evidence: 'Evidence',
  operation: 'Operation',
  reference: 'Reference',
};

export const SECTION_LEADS: Record<(typeof DOC_SECTIONS)[number], string> = {
  'getting-started': 'What SAIPEN is, why it exists, and how to install it.',
  concepts: 'The files in .saipen/ and the ideas each one carries.',
  protocol: 'The state machine, routing, checkpoints and verification rules.',
  recovery: 'What happens when an agent, a session or a file breaks.',
  evidence: 'What counts as proof, and what SAIPEN does and does not guarantee.',
  operation: 'Commands, autonomous modes and supported agent hosts.',
  reference: 'Glossary and frequently asked questions.',
};

export const docHref = (doc: Doc) => `/docs/${doc.id}/`;

/**
 * Every documentation page, in the one site order. Segment directives are
 * content-engine metadata: they are stripped here so the raw `.md` twin, the
 * search index and `llms-full.txt` carry the prose exactly as it was written.
 */
export async function allDocs(): Promise<Doc[]> {
  const docs = await getCollection('docs');
  const rank = (doc: Doc) => DOC_SECTIONS.indexOf(doc.data.section);
  return docs
    .map((doc) => ({ ...doc, body: stripSegmentDirectives(doc.body ?? '') }))
    .sort((a, b) => rank(a) - rank(b) || a.data.order - b.data.order);
}

export async function docTree() {
  const docs = await allDocs();
  return DOC_SECTIONS.map((section) => ({
    section,
    title: SECTION_TITLES[section],
    lead: SECTION_LEADS[section],
    docs: docs.filter((doc) => doc.data.section === section),
  })).filter((group) => group.docs.length > 0);
}

export async function neighbours(id: string) {
  const docs = await allDocs();
  const index = docs.findIndex((doc) => doc.id === id);
  return {
    prev: index > 0 ? docs[index - 1] : undefined,
    next: index >= 0 && index < docs.length - 1 ? docs[index + 1] : undefined,
  };
}
