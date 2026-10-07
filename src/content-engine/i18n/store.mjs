/**
 * Translation store for the Node gates and CLIs (roadmap M41-M46). Reads disk.
 *
 * Layout (all plain, diffable files):
 *   src/content-engine/blocks/<domain>.json         canonical English blocks
 *   src/content-engine/i18n/locales.json            locale registry
 *   src/content-engine/i18n/glossary.json           terminology contract
 *   src/locales/<locale>/<domain>.json              block translation units
 *   src/locales/<locale>/docs/<section>/<name>.json document SEGMENT translations
 *   src/content/docs/<section>/<name>.md            canonical English docs
 *
 * Documentation is not one unit: every canonical document is split into
 * stable segments (see segments.mjs) and a locale stores one entry per segment
 * ID, so editing one paragraph marks one segment STALE, never a whole page.
 *
 * Everything returned here is computed from those files; nothing is cached on
 * disk except the content lock, which site:refresh rewrites.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { blockHash, validateCatalog } from '../blocks/blocks.mjs';
import { checkTranslation, enabledLocales, pseudoLocalize, STORED_STATUSES, uncoveredScripts, unitStatus, validateLocales, variantPlan } from './i18n.mjs';
import { documentSegmentPrefix, parseDocument } from './segments.mjs';
import { mergeCatalogs, pageLabelBlocks, unitsByLocale } from './units.mjs';

export const PATHS = {
  blocks: 'src/content-engine/blocks',
  locales: 'src/content-engine/i18n/locales.json',
  glossary: 'src/content-engine/i18n/glossary.json',
  units: 'src/locales',
  docs: 'src/content/docs',
  contentLock: 'src/content-engine/manifests/content-lock.json',
};

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function walk(dir, ext) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(full, ext));
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out.sort();
}

/**
 * @param {{ root?: string, registry: any, sourceIds?: string[], overrides?: Record<string, any> }} options
 */
export function loadStore({ root = '.', registry, sourceIds = [], overrides = {} }) {
  const at = (p) => join(root, p).split('\\').join('/');
  const problems = [];

  const localesDoc = overrides.localesDoc ?? readJson(at(PATHS.locales));
  const glossary = overrides.glossary ?? readJson(at(PATHS.glossary));
  problems.push(...validateLocales(localesDoc));

  const catalogDocs = walk(at(PATHS.blocks), '.json').map((file) => ({ file, doc: readJson(file) }));
  for (const { file, doc } of catalogDocs) problems.push(...validateCatalog(doc, file.slice(at('').length), sourceIds));
  let blocks = {};
  try {
    blocks = mergeCatalogs([...catalogDocs.map((c) => c.doc), ...pageLabelBlocks(registry)]);
  } catch (error) {
    problems.push(`[duplicate-id] ${error.message}`);
  }

  // Block translation units: src/locales/<locale>/<domain>.json
  const unitFiles = [];
  if (existsSync(at(PATHS.units))) {
    for (const locale of readdirSync(at(PATHS.units), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      for (const file of walk(at(`${PATHS.units}/${locale}`), '.json').filter((f) => !f.includes('/docs/'))) {
        const doc = overrides.unitDocs?.[file] ?? readJson(file);
        unitFiles.push({ file, locale, doc });
      }
    }
  }
  const units = unitsByLocale(unitFiles.map((u) => u.doc));
  for (const { file, locale, doc } of unitFiles) {
    if (doc.locale !== locale) problems.push(`[malformed] ${file}: locale "${doc.locale}" does not match its directory`);
    if (doc.schemaVersion !== 1) problems.push(`[schema-version] ${file}: schemaVersion ${doc.schemaVersion}`);
  }

  // Canonical docs, split into their stable segments.
  const docs = {};
  for (const file of walk(at(PATHS.docs), '.md')) {
    const slug = file.slice(at(PATHS.docs).length + 1).replace(/\.md$/, '');
    const raw = overrides.docRaw?.[file] ?? readFileSync(file, 'utf8');
    const parsed = parseDocument({ raw, slug });
    for (const problem of parsed.problems) problems.push(`[${file}] ${problem}`);
    docs[slug] = {
      slug,
      section: parsed.frontmatter.section,
      title: String(parsed.frontmatter.title ?? ''),
      description: String(parsed.frontmatter.description ?? ''),
      body: parsed.body,
      segments: parsed.segments,
      segmentsById: Object.fromEntries(parsed.segments.map((s) => [s.id, s])),
    };
  }

  // Document segment translations: src/locales/<locale>/docs/<section>/<name>.json
  const docUnits = {};
  if (existsSync(at(PATHS.units))) {
    for (const locale of readdirSync(at(PATHS.units), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      for (const file of walk(at(`${PATHS.units}/${locale}/docs`), '.json')) {
        const slug = file.slice(at(`${PATHS.units}/${locale}/docs`).length + 1).replace(/\.json$/, '');
        docUnits[locale] ??= {};
        docUnits[locale][slug] = { file, doc: overrides.docUnitDocs?.[file] ?? readJson(file) };
      }
    }
  }

  const store = { localesDoc, glossary, blocks, units, unitFiles, docs, docUnits, problems };
  store.plan = problems.length ? [] : variantPlan({ localesDoc, registry, docs, docUnits });
  return store;
}

/** IDs of the canonical units a locale must cover: its scope's block domains and doc sections. */
export function requiredUnits(store, locale) {
  const l = store.localesDoc.locales.find((x) => x.id === locale);
  const scope = l.scope === 'all' ? null : store.localesDoc.scopes[l.scope];
  const blockIds = Object.entries(store.blocks).filter(([, b]) => !scope || scope.domains.includes(b.domain)).map(([id]) => id);
  const docSlugs = Object.values(store.docs).filter((d) => !scope || scope.docSections.includes(d.section)).map((d) => d.slug);
  return { blockIds, docSlugs };
}

/** Every unit of every non-canonical, non-pseudo locale with its computed status. */
export function unitReport(store) {
  const rows = [];
  for (const l of store.localesDoc.locales) {
    if (l.id === store.localesDoc.canonical || l.stage === 'pseudo') continue;
    const { blockIds, docSlugs } = requiredUnits(store, l.id);
    const known = new Set();
    for (const id of blockIds) {
      known.add(id);
      const unit = store.units[l.id]?.[id];
      rows.push({ locale: l.id, kind: 'block', id, status: unitStatus(unit, blockHash(store.blocks[id])), unit });
    }
    for (const [id, unit] of Object.entries(store.units[l.id] ?? {})) {
      if (known.has(id)) continue;
      const block = store.blocks[id];
      rows.push({ locale: l.id, kind: 'block', id, status: block ? unitStatus(unit, blockHash(block)) : 'ORPHANED', unit, outOfScope: Boolean(block) });
    }
    // Documentation: one row per stable segment, not one per document.
    const knownSegments = new Set();
    for (const slug of docSlugs) {
      const doc = store.docs[slug];
      const entry = store.docUnits[l.id]?.[slug];
      const units = entry?.doc?.units ?? {};
      for (const segment of doc.segments) {
        knownSegments.add(segment.id);
        rows.push({
          locale: l.id,
          kind: 'segment',
          id: segment.id,
          document: slug,
          hash: segment.hash,
          type: segment.kind,
          file: entry?.file,
          status: unitStatus(units[segment.id], segment.hash),
          unit: units[segment.id],
        });
      }
    }
    for (const [slug, entry] of Object.entries(store.docUnits[l.id] ?? {})) {
      const doc = store.docs[slug];
      for (const [id, unit] of Object.entries(entry.doc?.units ?? {})) {
        if (knownSegments.has(id)) continue;
        const segment = doc?.segmentsById[id];
        rows.push({ locale: l.id, kind: 'segment', id, document: slug, file: entry.file, type: segment?.kind,
          status: segment ? unitStatus(unit, segment.hash) : 'ORPHANED', unit, outOfScope: Boolean(doc) });
      }
    }
  }
  return rows;
}

/**
 * Translation correctness: stored shape, placeholders, markup, glossary and
 * glyph coverage are always enforced. Completeness is enforced only when a
 * locale is being enabled (`forEnable`): once it is live, an English edit
 * makes units STALE or MISSING, the page falls back to English for them, and
 * the work is reported — an English author is never blocked by a translation.
 * ORPHANED units (their block was deleted) are reported the same way.
 */
export function validateTranslations(store, coverage = null, { forEnable = false } = {}) {
  const problems = [];
  const { glossary } = store;
  for (const { file, doc } of store.unitFiles) {
    for (const [id, unit] of Object.entries(doc.units ?? {})) {
      const where = `${file} ${id}`;
      for (const key of Object.keys(unit)) if (!['text', 'sourceHash', 'status', 'reviewer'].includes(key)) problems.push(`[unknown-field] ${where}: "${key}"`);
      if (!STORED_STATUSES.includes(unit.status)) problems.push(`[bad-enum] ${where}: status "${unit.status}" is not ${STORED_STATUSES.join(' | ')}`);
      if (!/^[0-9a-f]{16}$/.test(unit.sourceHash ?? '')) problems.push(`[malformed] ${where}: sourceHash must be the 16-hex canonical hash from the work package`);
      const block = store.blocks[id];
      if (!block) continue;
      problems.push(...checkTranslation({ id, type: block.type, en: block.text, text: unit.text, glossary, locale: doc.locale }));
    }
  }
  // Document segment units: src/locales/<locale>/docs/<section>/<name>.json
  for (const [locale, byslug] of Object.entries(store.docUnits)) {
    for (const [slug, entry] of Object.entries(byslug)) {
      const where = entry.file;
      const doc = store.docs[slug];
      if (entry.doc?.schemaVersion !== 1) problems.push(`[schema-version] ${where}: schemaVersion ${entry.doc?.schemaVersion}`);
      if (entry.doc?.locale !== locale) problems.push(`[malformed] ${where}: locale "${entry.doc?.locale}" does not match its directory`);
      if (entry.doc?.document !== slug) problems.push(`[malformed] ${where}: document "${entry.doc?.document}" does not match its path`);
      if (!doc) {
        problems.push(`[orphaned] ${where}: no canonical document "${slug}"`);
        continue;
      }
      for (const [id, unit] of Object.entries(entry.doc?.units ?? {})) {
        const at = `${where} ${id}`;
        for (const key of Object.keys(unit)) if (!['text', 'sourceHash', 'status', 'reviewer'].includes(key)) problems.push(`[unknown-field] ${at}: "${key}"`);
        if (!STORED_STATUSES.includes(unit.status)) problems.push(`[bad-enum] ${at}: status "${unit.status}" is not ${STORED_STATUSES.join(' | ')}`);
        if (!/^[0-9a-f]{16}$/.test(unit.sourceHash ?? '')) problems.push(`[malformed] ${at}: sourceHash must be the 16-hex segment hash from the work package`);
        const segment = doc.segmentsById[id];
        if (!segment) continue;
        problems.push(...checkTranslation({ id, type: segment.kind, en: segment.text, text: unit.text, glossary, locale }));
      }
    }
  }

  // Enabling a locale requires every required unit renderable; the pixel
  // faces must always draw every character an enabled locale uses.
  const report = unitReport(store);
  for (const l of enabledLocales(store.localesDoc)) {
    if (l.stage === 'pseudo' || !forEnable) continue;
    const missing = report.filter((r) => r.locale === l.id && !r.outOfScope && r.status !== 'ORPHANED' && !l.renderStatuses.includes(r.status));
    if (missing.length) problems.push(`[enable-blocked] locale ${l.id} is enabled but ${missing.length} required unit(s) are not renderable (${[...new Set(missing.map((m) => m.status))].join(', ')}) — finish them or set enabled: false`);
  }
  if (coverage) {
    // Every locale name is drawn in the language selector.
    for (const l of store.localesDoc.locales) {
      const bad = [...l.nativeName].filter((ch) => !/\s/.test(ch) && !coverage.has(ch.codePointAt(0)));
      if (bad.length && l.enabled) problems.push(`[glyph-coverage] locale ${l.id}: its native name "${l.nativeName}" uses ${bad.join(' ')}, which the pixel faces cannot draw`);
    }
    for (const l of enabledLocales(store.localesDoc)) {
      const missingScripts = uncoveredScripts(l, coverage);
      if (missingScripts.length) problems.push(`[enable-blocked] locale ${l.id} is enabled but the pixel faces do not cover ${missingScripts.join(', ')} — keep it planned until a font milestone adds the script`);
    }
    for (const l of store.localesDoc.locales) {
      if (l.id === store.localesDoc.canonical) continue;
      // The pseudo-locale is generated, so its output is checked instead of stored units.
      const docUnitTexts = Object.values(store.docUnits[l.id] ?? {}).flatMap((entry) => Object.values(entry.doc?.units ?? {}).map((u) => u.text));
      const texts = l.stage === 'pseudo'
        ? [
            ...Object.values(store.blocks).map((b) => pseudoLocalize(b.text, store.glossary, b.type)),
            ...Object.values(store.docs).flatMap((d) => d.segments.map((s) => pseudoLocalize(s.text, store.glossary, s.kind))),
          ]
        : [...Object.values(store.units[l.id] ?? {}).map((u) => u.text), ...docUnitTexts];
      const missingGlyphs = new Set();
      for (const text of texts) for (const ch of text) if (!coverage.has(ch.codePointAt(0)) && !/\s/.test(ch)) missingGlyphs.add(ch);
      if (missingGlyphs.size) problems.push(`[glyph-coverage] locale ${l.id}: the pixel faces cannot draw ${[...missingGlyphs].slice(0, 20).map((c) => `U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')} ${c}`).join(', ')}${missingGlyphs.size > 20 ? ' …' : ''}`);
    }
  }
  return problems;
}

/**
 * The content lock (M41): every canonical block hash and, for documentation,
 * the hash of every stable SEGMENT rather than one hash for the whole page.
 * A translation records the hash it was made from; a different hash here makes
 * exactly that unit STALE. Regenerate with npm run site:refresh.
 */
export function contentLock(store) {
  const blocks = Object.fromEntries(Object.keys(store.blocks).sort().map((id) => [id, blockHash(store.blocks[id])]));
  const docs = {};
  for (const slug of Object.keys(store.docs).sort()) {
    const doc = store.docs[slug];
    const segments = Object.fromEntries(doc.segments.filter((s) => s.kind === 'markdown').map((s) => [s.id, s.hash]));
    docs[slug] = { title: doc.segmentsById[`${documentSegmentPrefix(slug)}.title`].hash, description: doc.segmentsById[`${documentSegmentPrefix(slug)}.description`].hash, segments };
  }
  return {
    schemaVersion: 1,
    generator: 'scripts/site.mjs refresh',
    note: 'Canonical hash of every content block and of every stable documentation SEGMENT (title, description and each section). A translation records the hash it was made from; a different hash here makes exactly that unit STALE. Regenerate with npm run site:refresh.',
    blocks,
    docs,
  };
}

/**
 * The locale routes the variant plan expects, as inventory variants: pages,
 * documents with their Markdown twins, and the locale's search index and
 * llms.txt when the locale enables them.
 */
export function inventoryVariants(store) {
  const out = [];
  for (const p of store.plan) {
    const l = store.localesDoc.locales.find((x) => x.id === p.locale);
    const base = { locale: p.locale, prefix: p.prefix, internal: p.stage === 'pseudo', searchable: l.searchEnabled, llmVisible: l.llmsEnabled };
    for (const x of p.pages) out.push({ ...base, route: x.variant, of: x.route });
    for (const d of p.docs) {
      out.push({ ...base, route: d.variant, of: `/docs/${d.slug}/` });
      out.push({ ...base, route: d.variant.replace(/\/$/, '.md'), of: `/docs/${d.slug}.md` });
    }
    if (l.searchEnabled) out.push({ ...base, route: `/${p.prefix}/search-index.json`, of: '/search-index.json' });
    if (l.llmsEnabled) out.push({ ...base, route: `/${p.prefix}/llms.txt`, of: '/llms.txt' });
  }
  return out;
}

/** Which discovery outputs to check, per locale: canonical ones plus each locale's own. */
export function discoveryTargets(store) {
  const targets = [{ locale: store.localesDoc.canonical, files: { search: 'search-index.json', llms: 'llms.txt', sitemap: null } }];
  for (const p of store.plan) {
    const l = store.localesDoc.locales.find((x) => x.id === p.locale);
    targets.push({ locale: p.locale, files: { search: l.searchEnabled ? `${p.prefix}/search-index.json` : null, llms: l.llmsEnabled ? `${p.prefix}/llms.txt` : null, sitemap: null } });
  }
  return targets;
}
