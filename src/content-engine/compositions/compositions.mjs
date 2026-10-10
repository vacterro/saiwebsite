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
import { ID_PATTERN, PAGE_MATURITIES } from '../registry/schema.mjs';

export const SECTION_TYPES = ['heading', 'paragraph', 'list', 'cards', 'slot'];
const BINDING = /^(site:[a-zA-Z]+|saipen-source:[A-Za-z0-9_.\/-]+)$/;

export const orderedSections = (doc) => [...(doc.sections ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const visibleSections = (doc) => orderedSections(doc).filter((s) => s.visibility !== 'hidden');
export const sectionBlocks = (section) => compositionBlocks({ sections: [section] }).filter(Boolean);
export const safeActionHref = (href) => typeof href === 'string' && (/^(?:https?:\/\/|\/(?!\/)|#)/.test(href) || /^\{[a-zA-Z]+\}/.test(href)) && !/[<>"\u0000-\u001f]/.test(href);

/** Every block ID a composition references, in render order. */
export function compositionBlocks(doc) {
  const ids = [doc.title, doc.description,...(doc.metadataBlocks ?? [])].filter(Boolean);
  for (const s of doc.sections ?? []) {
    if (s.type === 'heading' || s.type === 'paragraph') ids.push(s.text);
    if (s.type === 'list') ids.push(...(s.items ?? []));
    if (s.type === 'cards') for (const c of s.cards ?? []) ids.push(c.title, ...(c.body ?? []), ...(c.action ? [c.action.label] : []));
    if (s.type === 'slot') ids.push(...(s.blocks ?? []));
  }
  return ids;
}

/** @param {string[] | null} sourceIds */
export function validateComposition(doc, file, blocks, pageIds, sourceIds = null) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return [`[malformed] ${file}: expected a composition object`];
  if (![1, 2].includes(doc?.schemaVersion)) problems.push(`[schema-version] ${file}: schemaVersion ${doc?.schemaVersion}`);
  if (!pageIds.includes(doc?.page)) problems.push(`[unknown-page] ${file}: page "${doc?.page}" is not in pages.json`);
  if (!Array.isArray(doc.sections)) return [...problems, `[malformed] ${file}: sections must be an array`];
  if(doc.bindings!==undefined&&(!doc.bindings||typeof doc.bindings!=='object'||Array.isArray(doc.bindings))) problems.push(`[malformed] ${file}: bindings must be an object`);
  for(const key of ['metadataBlocks','availableSlots']) if(doc[key]!==undefined&&(!Array.isArray(doc[key])||doc[key].some((s)=>typeof s!=='string')))problems.push(`[malformed] ${file}: ${key} must be a string array`);
  if(problems.some((p)=>p.startsWith('[malformed]')))return problems;
  if (doc.schemaVersion === 2 && !['page', 'append', 'slots'].includes(doc.mode)) problems.push(`[bad-enum] ${file}: mode must be page, append or slots`);
  if ((doc.mode ?? 'page') === 'page' && (!doc.title || !doc.description)) problems.push(`[malformed] ${file}: a full page requires title and description blocks`);
  for (const field of Object.keys(doc)) if (!['schemaVersion', 'page', 'note', 'title', 'description', 'bindings', 'sections', 'mode', 'availableSlots', 'metadataBlocks'].includes(field)) problems.push(`[unknown-field] ${file}: ${field}`);
  for (const [name, value] of Object.entries(doc?.bindings ?? {})) if (!BINDING.test(value)) problems.push(`[bad-binding] ${file}: ${name} = "${value}"`);
  const bound = new Set(Object.keys(doc?.bindings ?? {}));
  const ids = new Set();
  const orders = new Set();
  for (const [i, s] of (doc?.sections ?? []).entries()) {
    if (!s || typeof s !== 'object' || Array.isArray(s)) { problems.push(`[malformed] ${file} sections[${i}]: expected an object`); continue; }
    if (doc.schemaVersion === 2) {
      if (!ID_PATTERN.test(s.id ?? '') || ids.has(s.id)) problems.push(`[section-id] ${file}: missing, invalid or duplicate section ID ${s.id}`);
      if (s.owner !== doc.page) problems.push(`[section-owner] ${file}: ${s.id} belongs to ${s.owner}, expected ${doc.page}`);
      if (!Number.isSafeInteger(s.order) || s.order < 0 || orders.has(s.order)) problems.push(`[section-order] ${file}: ${s.id} needs a unique nonnegative integer order`);
      if (!['public', 'hidden'].includes(s.visibility) || !PAGE_MATURITIES.includes(s.maturity) || typeof s.localizable !== 'boolean') problems.push(`[section-policy] ${file}: ${s.id} needs visibility, maturity and localization policy`);
      if (!Array.isArray(s.sourceIds) || (sourceIds && s.sourceIds.some((id) => !sourceIds.includes(id)))) problems.push(`[unknown-source] ${file}: ${s.id} has missing or unknown source dependencies`);
      if (!s.validation || !Array.isArray(s.validation.gates) || s.validation.gates.some((g) => typeof g !== 'string')) problems.push(`[section-validation] ${file}: ${s.id} needs validation.gates`);
      ids.add(s.id); orders.add(s.order);
    }
    if (!SECTION_TYPES.includes(s.type)) problems.push(`[bad-enum] ${file} sections[${i}]: type "${s.type}" is not ${SECTION_TYPES.join(' | ')}`);
    const allowed = ['type', 'id', 'owner', 'order', 'visibility', 'maturity', 'sourceIds', 'localizable', 'validation', ...(s.type === 'heading' || s.type === 'paragraph' ? ['text'] : s.type === 'list' ? ['ordered', 'items'] : s.type === 'cards' ? ['cards'] : s.type==='slot'?['slot','blocks']:[])];
    for (const field of Object.keys(s)) if (!allowed.includes(field)) problems.push(`[unknown-field] ${file} sections[${i}]: ${field}`);
    if (['heading', 'paragraph'].includes(s.type) && typeof s.text !== 'string') problems.push(`[malformed] ${file} sections[${i}]: text must reference a block ID`);
    if (s.type === 'list' && (!Array.isArray(s.items) || !s.items.length || s.items.some((id)=>typeof id!=='string') || typeof s.ordered!=='boolean')) problems.push(`[malformed] ${file} sections[${i}]: a list needs string items and an ordered boolean`);
    if (s.type==='slot' && (doc.mode!=='slots' || !doc.availableSlots?.includes(s.slot) || !Array.isArray(s.blocks))) problems.push(`[slot-contract] ${file}: ${s.id} needs a declared code-owned slot and block references`);
    if (s.validation?.required && (s.visibility==='hidden' || s.order!==Math.min(...doc.sections.map((x)=>x.order)))) problems.push(`[required-section] ${file}: ${s.id} is the required first section`);
    if (s.type === 'cards') {
      if (!Array.isArray(s.cards) || !s.cards.length) { problems.push(`[malformed] ${file} sections[${i}]: cards must be a nonempty array`); continue; }
      for (const c of s.cards ?? []) {
        if (!c || typeof c.title !== 'string' || !Array.isArray(c.body) || !c.body.length) { problems.push(`[malformed] ${file} sections[${i}]: each card needs title and body blocks`); continue; }
        if (c.action && (typeof c.action.label !== 'string' || !safeActionHref(c.action.href))) problems.push(`[unsafe-link] ${file} sections[${i}]: invalid action label or URL`);
        for (const ref of (c.action?.href ?? '').matchAll(/\{([a-zA-Z]+)\}/g)) if (!bound.has(ref[1])) problems.push(`[unbound] ${file} sections[${i}]: href {${ref[1]}} has no binding`);
      }
    }
  }
  if (problems.some((p) => p.startsWith('[malformed]'))) return problems;
  const nativeBlocks=new Set([...doc.sections.filter((s)=>s.type==='slot').flatMap((s)=>s.blocks ?? []),...(doc.mode==='slots'?doc.metadataBlocks ?? []:[])]);
  for (const id of compositionBlocks(doc ?? {})) {
    const block = blocks[id];
    if (!block) {
      problems.push(`[unknown-block] ${file}: "${id}" is not a canonical block`);
      continue;
    }
    for (const name of placeholders(block.text)) if (!nativeBlocks.has(id) && !bound.has(name)) problems.push(`[unbound] ${file}: block ${id} needs {${name}}, which has no binding`);
  }
  return problems;
}
