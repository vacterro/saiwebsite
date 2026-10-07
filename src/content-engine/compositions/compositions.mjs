/**
 * Page composition manifests (content-system roadmap M38). Pure.
 *
 * A content-heavy page can be a manifest instead of an Astro page: an ordered
 * list of typed sections whose words are block IDs. src/views/ComposedView.astro
 * renders it in any locale, so reordering or removing a section is a one-line
 * manifest change that every locale follows without a page copy. Interactive
 * and generated pages stay bespoke Astro where code is the clearer owner.
 *
 *   sections: heading { text } | paragraph { text } | list { ordered, items[] }
 *           | cards { cards[]: { title, body[], action?: { label, href } } }
 *   bindings: name -> "site:<SITE key>" | "saipen-source:<repository path>"
 *             (values for {name} placeholders in block text and action hrefs)
 */
import { placeholders } from '../blocks/blocks.mjs';

export const SECTION_TYPES = ['heading', 'paragraph', 'list', 'cards'];
const BINDING = /^(site:[a-zA-Z]+|saipen-source:[A-Za-z0-9_.\/-]+)$/;

/** Every block ID a composition references, in render order. */
export function compositionBlocks(doc) {
  const ids = [doc.title, doc.description];
  for (const s of doc.sections ?? []) {
    if (s.type === 'heading' || s.type === 'paragraph') ids.push(s.text);
    if (s.type === 'list') ids.push(...(s.items ?? []));
    if (s.type === 'cards') for (const c of s.cards ?? []) ids.push(c.title, ...(c.body ?? []), ...(c.action ? [c.action.label] : []));
  }
  return ids;
}

export function validateComposition(doc, file, blocks, pageIds) {
  const problems = [];
  if (doc?.schemaVersion !== 1) problems.push(`[schema-version] ${file}: schemaVersion ${doc?.schemaVersion}`);
  if (!pageIds.includes(doc?.page)) problems.push(`[unknown-page] ${file}: page "${doc?.page}" is not in pages.json`);
  for (const [name, value] of Object.entries(doc?.bindings ?? {})) if (!BINDING.test(value)) problems.push(`[bad-binding] ${file}: ${name} = "${value}"`);
  const bound = new Set(Object.keys(doc?.bindings ?? {}));
  for (const [i, s] of (doc?.sections ?? []).entries()) {
    if (!SECTION_TYPES.includes(s.type)) problems.push(`[bad-enum] ${file} sections[${i}]: type "${s.type}" is not ${SECTION_TYPES.join(' | ')}`);
    if (s.type === 'list' && (!Array.isArray(s.items) || !s.items.length)) problems.push(`[malformed] ${file} sections[${i}]: a list needs items`);
    if (s.type === 'cards') {
      for (const c of s.cards ?? []) {
        for (const ref of (c.action?.href ?? '').matchAll(/\{([a-zA-Z]+)\}/g)) if (!bound.has(ref[1])) problems.push(`[unbound] ${file} sections[${i}]: href {${ref[1]}} has no binding`);
      }
    }
  }
  for (const id of compositionBlocks(doc ?? {})) {
    const block = blocks[id];
    if (!block) {
      problems.push(`[unknown-block] ${file}: "${id}" is not a canonical block`);
      continue;
    }
    for (const name of placeholders(block.text)) if (!bound.has(name)) problems.push(`[unbound] ${file}: block ${id} needs {${name}}, which has no binding`);
  }
  return problems;
}
