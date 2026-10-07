/**
 * Specification topics. One list drives the spec navigation, the version
 * overview, the /spec/latest/ aliases, the sitemap and llms.txt.
 */
export const SPEC_TOPICS = [
  {
    slug: 'lifecycle',
    title: 'State machine',
    description: 'All sixteen phases, every legal transition, and the ticket-bearing and enter-from-anywhere sets.',
  },
  {
    slug: 'routing',
    title: 'Routing and checkpoint',
    description: 'Action priority, the continuation pipeline and the fixed checkpoint write order.',
  },
  {
    slug: 'state',
    title: 'STATE fields',
    description: 'Every STATE.md frontmatter field: required, known, typed, and the closed enums.',
  },
  {
    slug: 'next-action',
    title: 'next_action and WAIT',
    description: 'The executable next_action forms and the seven WAIT categories.',
  },
  {
    slug: 'board',
    title: 'BOARD tickets',
    description: 'Board sections, checkbox projection, required ticket fields and the closed field list.',
  },
  {
    slug: 'limits',
    title: 'Cold-agent limits',
    description: 'Byte and character budgets for orientation reads, log events and board records, and the witness levels.',
  },
  {
    slug: 'commands',
    title: 'Commands and shortcuts',
    description: 'The complete SAIPEN command vocabulary and the whole-message shortcut keys.',
  },
  {
    slug: 'errors',
    title: 'Error codes',
    description: 'Every refusal and error code the SAIPEN runtime can return.',
  },
] as const;

export type SpecTopic = (typeof SPEC_TOPICS)[number]['slug'];

export const topicBySlug = (slug: string) => SPEC_TOPICS.find((t) => t.slug === slug);
