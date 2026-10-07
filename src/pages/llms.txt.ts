/**
 * /llms.txt (MASTER_ROADMAP M12): a plain index for agents. It states the
 * authority boundary first, then lists every canonical page with a one-line
 * description and its raw Markdown twin where one exists.
 */
import type { APIRoute } from 'astro';
import { allDocs, SECTION_TITLES } from '../lib/docs';
import { SHORT_COMMIT, SPEC_VERSION, meta } from '../lib/canonical';
import { SPEC_TOPICS } from '../lib/spec';
import { SITE } from '../data/site';
import { DOC_SECTIONS } from '../content.config';

export const GET: APIRoute = async () => {
  const docs = await allDocs();
  const o = SITE.origin;
  const lines = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.tagline} ${SITE.motto} Project memory lives in plain files in .saipen/, so any compatible cold agent can run \`saipen continue\` and resume from the persisted next_action.`,
    '',
    'Authority: this website explains SAIPEN; it does not define it. The normative protocol is the SAIPEN repository',
    `(${meta.repository}): SPEC.md, saipen/CORE.md and saipen/REGISTRY.json. This build describes SAIPEN ${meta.version} @ ${SHORT_COMMIT}.`,
    'On any disagreement between this site and the repository, the repository wins.',
    '',
    ...DOC_SECTIONS.flatMap((section) => {
      const group = docs.filter((d) => d.data.section === section);
      if (!group.length) return [];
      return [
        `## Docs: ${SECTION_TITLES[section]}`,
        '',
        ...group.map((d) => `- [${d.data.title}](${o}/docs/${d.id}.md): ${d.data.description}`),
        '',
      ];
    }),
    `## Specification ${SPEC_VERSION} (generated from REGISTRY.json)`,
    '',
    ...SPEC_TOPICS.map((t) => `- [${t.title}](${o}/spec/${SPEC_VERSION}/${t.slug}/): ${t.description}`),
    `- [registry.json](${o}/spec/${SPEC_VERSION}/registry.json): the closed protocol vocabulary, machine-readable`,
    `- [state.schema.json](${o}/spec/${SPEC_VERSION}/state.schema.json): JSON Schema for STATE.md frontmatter`,
    `- [adapters.json](${o}/spec/${SPEC_VERSION}/adapters.json): supported agent hosts and declared enforcement`,
    '',
    '## Optional',
    '',
    `- [Full docs in one file](${o}/llms-full.txt): every documentation page as Markdown`,
    `- [Ecosystem](${o}/ecosystem/): projects around SAIPEN with maturity labels`,
    `- [Compatibility](${o}/compatibility/): host adapter matrix`,
    `- [Security](${o}/security/): scope and reporting`,
    '',
  ];
  return new Response(lines.join('\n'), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
};
