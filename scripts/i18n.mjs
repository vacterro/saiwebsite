/**
 * Translation CLI (content-system roadmap M44-M46). The whole workflow of a
 * translator — human or agent — without searching the repository:
 *
 *   npm run i18n:status [-- --locale et] [-- --json]
 *       Units per locale and status; with --locale, every unit not CURRENT.
 *   npm run i18n:export -- --locale et [--status missing,stale] [--out FILE]
 *       Write a bounded work package (JSON): only the units to do, with the
 *       English source, its hash, placeholders, markup to keep, context notes,
 *       glossary, the previous translation of stale units and exact matches
 *       from translation memory. Documentation arrives as ordinary bounded
 *       units — one per stable SEGMENT — with the surrounding segments as
 *       context, so a translator never receives (or re-translates) a whole
 *       page. Default file: i18n-work/<locale>.work.json.
 *   npm run i18n:import -- FILE [--status MACHINE_DRAFT|REVIEWED|CURRENT] [--reviewer NAME]
 *       Validate every filled unit (hash still current, placeholders, markup,
 *       glossary, glyph coverage) and write it into src/locales/<locale>/.
 *       Units that fail are reported and not written.
 *   npm run i18n:validate
 *       Every translation file, enablement and coverage rule, after red
 *       controls proving the checks can fail. CI runs it.
 *   npm run i18n:memory -- --locale et [--apply]
 *       Exact-match translation memory: MISSING/STALE units whose English is
 *       identical to an already REVIEWED/CURRENT unit. --apply copies them in
 *       as MACHINE_DRAFT, which still needs review.
 *   npm run i18n:add -- <locale> --name <English name> --native <native name> [--script Latn] [--dir ltr]
 *       Register a planned locale (disabled). Pure data; no code changes.
 *   npm run i18n:enable -- <locale> [--disable]
 *       Enable a locale's public routes, refused unless every required unit
 *       renders and the pixel faces cover its scripts.
 *
 * The rules a translation must obey are written for translators in
 * src/content-engine/i18n/TRANSLATING.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { blockHash, markupSignature, normalizeText, placeholders } from '../src/content-engine/blocks/blocks.mjs';
import { checkTranslation, markdownSignature, uncoveredScripts, unitStatus, validateLocales } from '../src/content-engine/i18n/i18n.mjs';
import { markFallback, planSegments } from '../src/content-engine/i18n/assemble.mjs';
import { segmentHash } from '../src/content-engine/i18n/segments.mjs';
import { createTranslator } from '../src/content-engine/i18n/translator.mjs';
import { loadStore, PATHS, unitReport, validateTranslations } from '../src/content-engine/i18n/store.mjs';
import { loadCoverage } from '../src/content-engine/i18n/engine-ext.mjs';
import { readRegistry, readSources } from './route-registry.mjs';
import { localeReadiness, independentReview } from '../src/content-engine/i18n/readiness.mjs';
import { withMutationLock, writeTransaction } from '../src/content-engine/operations/files.mjs';

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const has = (name) => rest.includes(`--${name}`);
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !['--json', '--apply', '--disable', '--preview', '--dry-run'].includes(rest[i - 1])));

const registry = readRegistry();
const sourceIds = readSources().sources.map((s) => s.id);
const load = (overrides) => loadStore({ registry, sourceIds, overrides });
/** A translator over the real catalogue with one locale's units replaced (red controls). */
function createTranslatorForTest(store, locale, units) {
  return createTranslator({ locale, localesDoc: store.localesDoc, blocks: store.blocks, units: { [locale]: units }, glossary: store.glossary });
}

const writeJson = (file, doc) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
};
const die = (msg, code = 2) => {
  const error=new Error(msg); error.exitCode=code; throw error;
};

function localeOrDie(store, id) {
  if (!id) die('missing --locale <id>');
  const l = store.localesDoc.locales.find((x) => x.id === id);
  if (!l) die(`unknown locale ${id}; known: ${store.localesDoc.locales.map((x) => x.id).join(', ')}`);
  if (l.id === store.localesDoc.canonical) die(`${id} is the canonical locale; it is edited in the block catalogues and src/content/docs, not translated`);
  if (l.stage === 'pseudo') die(`${id} is generated pseudo-localization; it has nothing to translate`);
  return l;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------
function status() {
  const store = load();
  const report = unitReport(store);
  const locales = flag('locale') ? [localeOrDie(store, flag('locale'))] : store.localesDoc.locales.filter((l) => l.id !== store.localesDoc.canonical && l.stage !== 'pseudo');
  const coverage = loadCoverage();
  const out = locales.map((l) => {
    const rows = report.filter((r) => r.locale === l.id);
    const counts = {};
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const required = rows.filter((r) => !r.outOfScope && r.status !== 'ORPHANED');
    const done = required.filter((r) => l.renderStatuses.includes(r.status)).length;
    return {
      locale: l.id,
      name: l.displayName,
      stage: l.stage,
      enabled: l.enabled,
      completion: required.length ? Math.round((done / required.length) * 1000) / 10 : 100,
      counts,
      uncoveredScripts: coverage ? uncoveredScripts(l, coverage) : null,
      readiness:localeReadiness(store,coverage,l.id,report),
      todo: flag('locale') ? rows.filter((r) => r.status !== 'CURRENT').map((r) => ({ kind: r.kind, id: r.id, status: r.status })) : undefined,
    };
  });
  if (has('json')) return console.log(JSON.stringify(out, null, 2));
  for (const o of out) {
    console.log(`${o.locale.padEnd(8)} ${o.name.padEnd(12)} ${o.stage.padEnd(8)} ${o.enabled ? 'enabled ' : 'disabled'} ${String(o.completion).padStart(5)}% renderable / ${o.readiness.publicationCompletion}% approved  ${Object.entries(o.counts).map(([k, n]) => `${k} ${n}`).join(' / ')}${o.readiness.fontGaps.length ? `  FONT GAP: ${o.readiness.fontGaps.join(', ')}` : ''}`);
    for (const t of o.todo ?? []) console.log(`  ${t.status.padEnd(13)} ${t.kind.padEnd(5)} ${t.id}`);
  }
}

// ---------------------------------------------------------------------------
// translation memory: exact normalized English -> approved translation
// ---------------------------------------------------------------------------
/** Every canonical segment of every document, keyed by its stable ID. */
function segmentIndex(store) {
  const index = new Map();
  for (const [slug, doc] of Object.entries(store.docs)) for (const segment of doc.segments) index.set(segment.id, { slug, segment });
  return index;
}

function memoryIndex(store, locale) {
  const index = new Map();
  const add = (type, source, from, text) => {
    const key = `${type}\0${normalizeText(source)}`;
    if (!index.has(key)) index.set(key, { from, text });
  };
  for (const [id, unit] of Object.entries(store.units[locale] ?? {})) {
    const block = store.blocks[id];
    if (!block) continue;
    if (!['REVIEWED', 'CURRENT'].includes(unitStatus(unit, blockHash(block))) || !independentReview(unit)) continue;
    add(block.type, block.text, id, unit.text);
  }
  // Documentation segments take part in translation memory exactly like blocks.
  for (const [slug, entry] of Object.entries(store.docUnits[locale] ?? {})) {
    const doc = store.docs[slug];
    if (!doc) continue;
    for (const [id, unit] of Object.entries(entry.doc?.units ?? {})) {
      const segment = doc.segmentsById[id];
      if (!segment) continue;
      if (!['REVIEWED', 'CURRENT'].includes(unitStatus(unit, segment.hash)) || !independentReview(unit)) continue;
      add(segment.kind, segment.text, id, unit.text);
    }
  }
  return index;
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------
function exportPackage() {
  const store = load();
  const l = localeOrDie(store, flag('locale'));
  const wanted = (flag('status') ?? 'missing,stale').toUpperCase().split(',');
  let report = unitReport(store).filter((r) => r.locale === l.id && wanted.includes(r.status));
  if (flag('domain')) report=report.filter((r)=>r.kind==='block' && store.blocks[r.id]?.domain===flag('domain'));
  if (flag('document')) report=report.filter((r)=>r.document===flag('document'));
  if (flag('id')) report=report.filter((r)=>r.id===flag('id'));
  report.sort((a,b)=>a.id.localeCompare(b.id));
  const offset=Number(flag('offset') ?? 0), limit=Number(flag('limit') ?? report.length);
  if (!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<0) die('--offset and --limit must be nonnegative integers');
  report=report.slice(offset,offset+limit);
  const memory = memoryIndex(store, l.id);
  const glossary = {
    doNotTranslate: store.glossary.terms.filter((t) => !t.translate).map((t) => ({ term: t.en, notes: t.notes })),
    terms: store.glossary.terms.filter((t) => t.translate).map((t) => ({ id: t.id, en: t.en, notes: t.notes, ...(store.glossary.locales?.[l.id]?.[t.id] ?? {}) })),
  };
  const units = [];
  let segments = 0;
  for (const r of report) {
    if (r.kind === 'block') {
      const block = store.blocks[r.id];
      if (!block) continue;
      const tm = memory.get(`${block.type}\0${normalizeText(block.text)}`);
      units.push({
        id: r.id,
        kind: 'block',
        domain: block.domain,
        status: r.status,
        type: block.type,
        source: block.text,
        sourceHash: blockHash(block),
        note: block.note ?? null,
        usedBy: block.usedBy,
        placeholders: placeholders(block.text),
        keepMarkup: block.type === 'inline' ? markupSignature(block.text) || null : null,
        previous: r.unit ? { text: r.unit.text, status: r.unit.status } : null,
        memory: tm ? [tm] : [],
        translation: '',
      });
      continue;
    }
    // A documentation segment is an ordinary bounded unit with context.
    const doc = store.docs[r.document];
    const segment = doc?.segmentsById[r.id];
    if (!doc || !segment) continue;
    segments++;
    const all = doc.segments;
    const at = all.findIndex((s) => s.id === segment.id);
    const tm = memory.get(`${segment.kind}\0${normalizeText(segment.text)}`);
    units.push({
      id: segment.id,
      kind: 'segment',
      domain: doc.section,
      document: doc.slug,
      section: doc.section,
      status: r.status,
      type: segment.kind,
      source: segment.text,
      sourceHash: segment.hash,
      note: segment.name === 'title' || segment.name === 'description' ? `The document's front-matter ${segment.name}.` : `Documentation segment "${segment.name}" of ${doc.slug}.`,
      usedBy: [`page:docs.${doc.slug.split('/').join('.')}`],
      placeholders: placeholders(segment.text),
      keepMarkdown: segment.kind === 'markdown' ? JSON.parse(markdownSignature(segment.text)) : null,
      keepMarkup: null,
      context: { before: (all[at - 1]?.text ?? '').slice(-240), after: (all[at + 1]?.text ?? '').slice(0, 240) },
      previous: r.unit ? { text: r.unit.text, status: r.unit.status } : null,
      memory: tm ? [tm] : [],
      translation: '',
    });
  }
  const pkg = {
    kind: 'sai-website-translation-package',
    schemaVersion: 2,
    locale: l.id,
    localeInfo: { displayName: l.displayName, nativeName: l.nativeName, direction: l.direction, scripts: l.scripts },
    statuses: wanted,
    instructions: 'Read src/content-engine/i18n/TRANSLATING.md first. Fill `translation` of every unit; leave a unit empty to skip it. A unit is a UI block or one stable documentation segment (`kind: segment`) — the surrounding segments are in `context` for reference only, never translate them. Keep every {placeholder}, `code span`, link target, **emphasis** structure and fenced code block, keep every doNotTranslate term verbatim, and use only characters the pixel faces draw. Then run: npm run i18n:import -- <this file>',
    glossary,
    units,
  };
  const out = flag('out') ?? `i18n-work/${l.id}.work.json`;
  writeJson(out, pkg);
  console.log(`wrote ${out}: ${units.length - segments} block unit(s), ${segments} documentation segment(s) for ${l.id} (${wanted.join(', ')})`);
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------
function importPackage() {
  const file = positional[0];
  if (!file || !existsSync(file)) die('usage: npm run i18n:import -- <package.json> [--status MACHINE_DRAFT|REVIEWED|CURRENT] [--reviewer NAME]');
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  if (pkg.kind !== 'sai-website-translation-package') die(`${file} is not a translation package`);
  const store = load();
  const l = localeOrDie(store, pkg.locale);
  const status = flag('status') ?? 'MACHINE_DRAFT';
  if (!['MACHINE_DRAFT', 'REVIEWED', 'CURRENT'].includes(status)) die(`--status must be MACHINE_DRAFT, REVIEWED or CURRENT`);
  const reviewer = flag('reviewer');
  const author=flag('author') ?? pkg.author;
  if (status !== 'MACHINE_DRAFT' && !reviewer) die(`--status ${status} records a review: pass --reviewer <who reviewed it>`);
  if (status !== 'MACHINE_DRAFT' && (!author || author.trim().toLowerCase()===reviewer.trim().toLowerCase())) die('approved translations require --author and a different --reviewer; never record your own review as independent');
  const coverage = loadCoverage();
  const refused = [];
  const glyphCheck = (id, text) => {
    if (!coverage) return [];
    const bad = [...new Set([...text].filter((ch) => !/\s/.test(ch) && !coverage.has(ch.codePointAt(0))))];
    return bad.length ? [`[glyph-coverage] ${l.id} ${id}: the pixel faces cannot draw ${bad.join(' ')}`] : [];
  };

  const segments = segmentIndex(store);
  const byDomain = new Map();
  const byDocument = new Map();
  let written = 0;
  let segmentsWritten = 0;
  const seen=new Set();
  const sameIdentity = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
  const storedUnit = (domain, slug, id) => {
    try {
      const path = slug ? `${PATHS.units}/${l.id}/docs/${slug}.json` : `${PATHS.units}/${l.id}/${domain}.json`;
      if (!existsSync(path)) return null;
      return JSON.parse(readFileSync(path, 'utf8')).units?.[id] ?? null;
    } catch { return null; }
  };
  const provenanceRefusal = (id, stored) => {
    if (stored?.author && author && !sameIdentity(stored.author, author))
      return `[provenance] ${l.id} ${id}: stored author "${stored.author}" differs from asserted "${author}" — author replacement requires the documented provenance-correction workflow, never a review import`;
    if (stored && !stored.author && author && status !== 'MACHINE_DRAFT')
      return `[provenance] ${l.id} ${id}: no stored author — ${status} promotion on newly asserted authorship is refused; establish provenance first, never invent it`;
    return null;
  };
  // Review evidence belongs to the exact text a reviewer read. A MACHINE_DRAFT
  // import states the text is a draft, so it must not inherit the stored
  // reviewer/reference of a previous version — that would assert a review of
  // text nobody reviewed. Only an explicit --reviewer/--review-reference on a
  // REVIEWED/CURRENT import records a review.
  const carryReview = status !== 'MACHINE_DRAFT';
  const effectiveMeta = (stored) => ({
    ...((stored?.author ?? author) ? { author: stored?.author ?? author } : {}),
    ...((reviewer ?? (carryReview ? stored?.reviewer : undefined)) ? { reviewer: reviewer ?? (carryReview ? stored?.reviewer : undefined) } : {}),
    ...((flag('review-reference') ?? (carryReview ? stored?.reviewReference : undefined)) ? { reviewReference: flag('review-reference') ?? (carryReview ? stored?.reviewReference : undefined) } : {}),
  });
  for (const u of pkg.units ?? []) {
    if (seen.has(u.id)) {refused.push(`[duplicate-id] ${u.id}: repeated in the package`);continue;}
    seen.add(u.id);
    if (!normalizeText(u.translation ?? '')) continue;
    const block = store.blocks[u.id];
    const found = block ? null : segments.get(u.id);
    if (!block && !found) {
      refused.push(`[orphaned] ${u.id}: no canonical block or documentation segment any more`);
      continue;
    }
    if (block) {
      if (blockHash(block) !== u.sourceHash) {
        refused.push(`[source-moved] ${u.id}: the English changed after export — export again`);
        continue;
      }
      const problems = [...checkTranslation({ id: u.id, type: block.type, en: block.text, text: u.translation, glossary: store.glossary, locale: l.id }), ...glyphCheck(u.id, u.translation)];
      if (problems.length) {
        refused.push(...problems);
        continue;
      }
      const stored = storedUnit(block.domain, null, u.id);
      const identityRefusal = provenanceRefusal(u.id, stored);
      if (identityRefusal) { refused.push(identityRefusal); continue; }
      if (stored && !stored.author && author && status === 'MACHINE_DRAFT' && normalizeText(u.translation) === normalizeText(stored.text ?? '')) {
        refused.push(`[provenance] ${l.id} ${u.id}: identical text cannot acquire newly asserted authorship — translate anew to record a new author`);
        continue;
      }
      if (!byDomain.has(block.domain)) byDomain.set(block.domain, []);
      byDomain.get(block.domain).push([u.id, { text: u.translation, sourceHash: u.sourceHash, status, ...effectiveMeta(stored) }]);
      written++;
      continue;
    }
    const { slug, segment } = found;
    if (segment.hash !== u.sourceHash) {
      refused.push(`[source-moved] ${u.id}: the English changed after export — export again`);
      continue;
    }
    const problems = [...checkTranslation({ id: u.id, type: segment.kind, en: segment.text, text: u.translation, glossary: store.glossary, locale: l.id }), ...glyphCheck(u.id, u.translation)];
    if (problems.length) {
      refused.push(...problems);
      continue;
    }
    const storedSeg = storedUnit(null, slug, u.id);
    const segIdentityRefusal = provenanceRefusal(u.id, storedSeg);
    if (segIdentityRefusal) { refused.push(segIdentityRefusal); continue; }
    if (storedSeg && !storedSeg.author && author && status === 'MACHINE_DRAFT' && normalizeText(u.translation) === normalizeText(storedSeg.text ?? '')) {
      refused.push(`[provenance] ${l.id} ${u.id}: identical text cannot acquire newly asserted authorship — translate anew to record a new author`);
      continue;
    }
    if (!byDocument.has(slug)) byDocument.set(slug, []);
    byDocument.get(slug).push([u.id, { text: u.translation, sourceHash: u.sourceHash, status, ...effectiveMeta(storedSeg) }]);
    segmentsWritten++;
  }
  if (refused.length) die(`IMPORT REFUSED: no translation files were written\n${refused.join('\n')}`,1);
  const changes={};
  for (const [domain, entries] of byDomain) {
    const path = `${PATHS.units}/${l.id}/${domain}.json`;
    const doc = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, locale: l.id, domain, units: {} };
    for (const [id, unit] of entries) doc.units[id] = unit;
    doc.units = Object.fromEntries(Object.entries(doc.units).sort(([a], [b]) => a.localeCompare(b)));
    changes[path]=JSON.stringify(doc,null,2)+'\n';
  }
  for (const [slug, entries] of byDocument) {
    const path = `${PATHS.units}/${l.id}/docs/${slug}.json`;
    const doc = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, locale: l.id, document: slug, units: {} };
    doc.schemaVersion = 1;
    doc.locale = l.id;
    doc.document = slug;
    for (const [id, unit] of entries) doc.units[id] = unit;
    doc.units = Object.fromEntries(Object.entries(doc.units).sort(([a], [b]) => a.localeCompare(b)));
    changes[path]=JSON.stringify(doc,null,2)+'\n';
  }
  for (const file of Object.keys(changes)) if (existsSync(file) && readFileSync(file,'utf8').replace(/\r\n/g,'\n')===changes[file]) delete changes[file];
  if (!has('dry-run')) writeTransaction('.',changes);
  console.log(`${refused.length ? 'PARTIAL' : 'OK'}: wrote ${written} block unit(s) and ${segmentsWritten} documentation segment(s) to src/locales/${l.id}/ as ${status}${refused.length ? `; ${refused.length} refused` : ''}`);
  console.log('next: npm run site:refresh && npm run i18n:validate && npm run build');
  return;
}

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------
function memory() {
  const store = load();
  const l = localeOrDie(store, flag('locale'));
  const index = memoryIndex(store, l.id);
  const todo = unitReport(store).filter((r) => r.locale === l.id && ['MISSING', 'STALE'].includes(r.status));
  const hits = [];
  for (const r of todo) {
    if (r.kind === 'block') {
      const block = store.blocks[r.id];
      if (!block) continue;
      const tm = index.get(`${block.type}\0${normalizeText(block.text)}`);
      if (tm && tm.from !== r.id) hits.push({ id: r.id, where: { domain: block.domain }, kind: 'block', from: tm.from, text: tm.text, sourceHash: blockHash(block) });
    } else {
      const doc = store.docs[r.document];
      const segment = doc?.segmentsById[r.id];
      if (!segment) continue;
      const tm = index.get(`${segment.kind}\0${normalizeText(segment.text)}`);
      if (tm && tm.from !== r.id) hits.push({ id: r.id, where: { document: doc.slug }, kind: 'segment', from: tm.from, text: tm.text, sourceHash: segment.hash });
    }
  }
  for (const h of hits) console.log(`  ${h.id}  <=  ${h.from}: ${h.text}`);
  if (has('apply') && hits.length) {
    const changes={};
    const byDomain = new Map();
    const byDocument = new Map();
    for (const h of hits) {
      const map = h.kind === 'block' ? byDomain : byDocument;
      const key = h.where.domain ?? h.where.document;
      map.set(key, [...(map.get(key) ?? []), h]);
    }
    for (const [domain, list] of byDomain) {
      const path = `${PATHS.units}/${l.id}/${domain}.json`;
      const doc = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, locale: l.id, domain, units: {} };
      for (const h of list) doc.units[h.id] = { text: h.text, sourceHash: h.sourceHash, status: 'MACHINE_DRAFT' };
      doc.units = Object.fromEntries(Object.entries(doc.units).sort(([a], [b]) => a.localeCompare(b)));
      changes[path]=JSON.stringify(doc,null,2)+'\n';
    }
    for (const [slug, list] of byDocument) {
      const path = `${PATHS.units}/${l.id}/docs/${slug}.json`;
      const doc = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, locale: l.id, document: slug, units: {} };
      doc.schemaVersion = 1;
      doc.locale = l.id;
      doc.document = slug;
      for (const h of list) doc.units[h.id] = { text: h.text, sourceHash: h.sourceHash, status: 'MACHINE_DRAFT' };
      doc.units = Object.fromEntries(Object.entries(doc.units).sort(([a], [b]) => a.localeCompare(b)));
      changes[path]=JSON.stringify(doc,null,2)+'\n';
    }
    if (!has('dry-run')) writeTransaction('.',changes);
  }
  console.log(`${hits.length} exact match(es) for ${l.id}${has('apply') ? has('dry-run')?' would apply as MACHINE_DRAFT':' applied as MACHINE_DRAFT (review them)' : '; add --apply to copy them in as MACHINE_DRAFT'}`);
}

// ---------------------------------------------------------------------------
// add / enable
// ---------------------------------------------------------------------------
function add() {
  const id = positional[0];
  const name = flag('name');
  const native = flag('native');
  if (!id || !name || !native) die('usage: npm run i18n:add -- <locale> --name <English name> --native <native name> [--script Latn] [--dir ltr]');
  const doc = JSON.parse(readFileSync(PATHS.locales, 'utf8'));
  doc.locales.push({
    id,
    displayName: name,
    nativeName: native,
    stage: 'planned',
    enabled: false,
    fallback: doc.canonical,
    direction: flag('dir') ?? 'ltr',
    scripts: (flag('script') ?? 'Latn').split(','),
    searchEnabled: true,
    llmsEnabled: false,
    renderStatuses: ['CURRENT', 'REVIEWED', 'MACHINE_DRAFT'],
    scope: 'pilot',
  });
  const problems = validateLocales(doc);
  if (problems.length) die(problems.join('\n'), 1);
  writeJson(PATHS.locales, doc);
  const glossary = JSON.parse(readFileSync(PATHS.glossary, 'utf8'));
  glossary.locales[id] ??= {};
  writeJson(PATHS.glossary, glossary);
  const coverage = loadCoverage();
  const gaps = coverage ? uncoveredScripts(doc.locales.at(-1), coverage) : [];
  console.log(`added ${id} (${name} / ${native}) as planned, disabled${gaps.length ? `; FONT GAP: the pixel faces do not draw ${gaps.join(', ')} yet` : ''}`);
  console.log(`next: npm run i18n:export -- --locale ${id}`);
}

function enable() {
  const id = positional[0];
  const doc = JSON.parse(readFileSync(PATHS.locales, 'utf8'));
  const l = doc.locales.find((x) => x.id === id);
  if (!l || l.id === doc.canonical) die(`unknown or canonical locale ${id}`);
  l.enabled = !has('disable');
  l.publication=has('preview')?'internal':'public';
  if (l.enabled && l.stage === 'planned') l.stage = 'pilot';
  const store = load({ localesDoc: doc });
  const problems = validateTranslations(store, loadCoverage(), { forEnable: true }).filter((p) => p.includes(`locale ${id} `));
  if (l.enabled && problems.length) die(`refused to enable ${id}:\n  ${problems.join('\n  ')}`, 1);
  if (!has('dry-run')) writeJson(PATHS.locales, doc);
  console.log(`${id} ${l.enabled ? 'enabled' : 'disabled'}; next: npm run build && npm run site:refresh && npm run site:doctor`);
}

function review() {
  const store=load(), rows=unitReport(store), coverage=loadCoverage();
  const locales=flag('locale')?[localeOrDie(store,flag('locale'))]:store.localesDoc.locales.filter((l)=>l.stage!=='pseudo');
  const report=locales.map((l)=>({...localeReadiness(store,coverage,l.id,rows),reviewWork:rows.filter((r)=>r.locale===l.id && !r.outOfScope && (r.status!=='CURRENT'||!r.unit?.author||!r.unit?.reviewer)).map(({id,status,unit})=>({id,status,author:unit?.author ?? null,reviewer:unit?.reviewer ?? null}))}));
  if (has('json')) return console.log(JSON.stringify(report,null,2));
  for (const l of report) console.log(`${l.locale}: ${l.completion}% renderable; ${l.publicationCompletion}% approved; ${l.productionReady?'PRODUCTION_READY':l.blockers.join(', ')}; ${l.reviewWork.length} unit(s) need review or translation`);
  console.log('Review packages: i18n:export -- --locale <id> --status machine_draft,reviewed --limit 40; approval requires a different actual reviewer and --author. This command approves nothing.');
}

function cleanup() {
  const store=load();
  const selected=flag('locale')?localeOrDie(store,flag('locale')).id:null;
  const rows=unitReport(store).filter((r)=>r.status==='ORPHANED' && (!selected||r.locale===selected));
  const changes={};
  for (const row of rows) {
    const file=row.kind==='segment'?row.file:`${PATHS.units}/${row.locale}/${row.unit.domain}.json`;
    if (!changes[file]) changes[file]=JSON.parse(readFileSync(file,'utf8'));
    delete changes[file].units[row.id];
  }
  if (!has('dry-run')) writeTransaction('.',Object.fromEntries(Object.entries(changes).map(([p,d])=>[p,JSON.stringify(d,null,2)+'\n'])));
  console.log(JSON.stringify({dryRun:has('dry-run'),orphaned:rows.map(({locale,id})=>({locale,id})),changedFiles:Object.keys(changes)},null,2));
}

function deprecate() {
  const store=load(), locale=localeOrDie(store,positional[0]);
  const doc=store.localesDoc, entry=doc.locales.find((l)=>l.id===locale.id);
  entry.enabled=false;entry.stage='deprecated';entry.publication='public';
  if (!has('dry-run')) writeTransaction('.',{[PATHS.locales]:JSON.stringify(doc,null,2)+'\n'});
  console.log(`${has('dry-run')?'PREVIEW':'OK'}: ${locale.id} deprecated and disabled; every translation file retained; run site:prepare`);
}

// ---------------------------------------------------------------------------
// validate (+ red controls)
// ---------------------------------------------------------------------------
/**
 * Visible block text must say which language it is in. tx.html() wraps a
 * fallback in <span lang>; tx.text() used as an element's text must sit in an
 * element carrying lang={tx.langOf(id)}. Attribute values are exempt.
 * Returns `file:line` findings for one template source.
 */
export function unmarkedTextChildren(source, file = 'template') {
  const fm = source.startsWith('---') ? source.indexOf('\n---', 4) + 4 : 0;
  const findings = [];
  let at = source.indexOf('{tx.text(', fm);
  while (at >= 0) {
    let k = at - 1;
    while (k >= 0 && /\s/.test(source[k])) k--;
    if (!'=(,:?'.includes(source[k])) {
      const open = source.lastIndexOf('<', at);
      const tag = source.slice(open, source.indexOf('>', open) + 1);
      if (!tag.includes('lang={tx.langOf(')) findings.push(`${file}:${source.slice(0, at).split('\n').length}`);
    }
    at = source.indexOf('{tx.text(', at + 1);
  }
  return findings;
}

function templateFindings() {
  const dirs = ['src/views', 'src/layouts', 'src/components', 'src/pages'];
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.astro')) files.push(p);
    }
  };
  dirs.filter(existsSync).forEach(walk);
  return files.flatMap((f) => unmarkedTextChildren(readFileSync(f, 'utf8'), f));
}

function redControls() {
  const results = [];
  const check = (name, fired) => results.push({ name, fired: Boolean(fired) });
  const base = load();
  const coverage = loadCoverage();
  const hashOf = (id) => blockHash(base.blocks[id]);
  const unitFile = (units) => ({ ['src/locales/et/home.json']: { schemaVersion: 1, locale: 'et', domain: 'home', units } });
  const withUnits = (units) => {
    const s = load({ unitDocs: unitFile(units) });
    s.unitFiles.push({ file: 'src/locales/et/home.json', locale: 'et', doc: unitFile(units)['src/locales/et/home.json'] });
    s.units.et = { ...(s.units.et ?? {}), ...Object.fromEntries(Object.entries(units).map(([k, v]) => [k, { ...v, domain: 'home' }])) };
    return s;
  };
  const problemsFor = (units) => validateTranslations(withUnits(units), coverage);

  check('placeholder mismatch is refused', problemsFor({ 'home.hero.licence': { text: 'MIT. Protokoll {version}.', sourceHash: hashOf('home.hero.licence'), status: 'REVIEWED' } }).some((p) => p.startsWith('[placeholder]')));
  check('changed link target is refused', problemsFor({ 'home.practice.note': { text: 'Sama moodi — [oma tahvel](/wrong/).', sourceHash: hashOf('home.practice.note'), status: 'REVIEWED' } }).some((p) => p.startsWith('[markup]')));
  check('dropped do-not-translate term is refused', problemsFor({ 'home.hero.lead': { text: 'Projekt hoiab mälu failides.', sourceHash: hashOf('home.hero.lead'), status: 'REVIEWED' } }).some((p) => p.startsWith('[glossary]')));
  check('unit of a deleted block is ORPHANED', unitReport(withUnits({ 'home.no-such-block': { text: 'x', sourceHash: '0'.repeat(16), status: 'REVIEWED' } })).some((r) => r.id === 'home.no-such-block' && r.status === 'ORPHANED'));
  check('glyph the faces cannot draw is refused', problemsFor({ 'home.action.start': { text: '開始', sourceHash: hashOf('home.action.start'), status: 'REVIEWED' } }).some((p) => p.startsWith('[glyph-coverage]')));
  const stale = withUnits({ 'home.action.start': { text: 'Alusta', sourceHash: '0'.repeat(16), status: 'CURRENT' } });
  check('changed English makes the unit STALE', unitReport(stale).some((r) => r.locale === 'et' && r.id === 'home.action.start' && r.status === 'STALE'));
  // A synthetic locale with no translation files at all, switched on.
  const docs = JSON.parse(readFileSync(PATHS.locales, 'utf8'));
  docs.locales.push({ ...docs.locales.find((x) => x.stage === 'pilot'), id: 'xx', displayName: 'Control', nativeName: 'Control', enabled: true });
  check('enabling an untranslated locale is refused', validateTranslations(load({ localesDoc: docs }), coverage, { forEnable: true }).some((p) => p.startsWith('[enable-blocked] locale xx')));
  // The renderer never shows a stale unit: it falls back to English.
  const tx = createTranslatorForTest(base, 'et', { 'home.action.start': { text: 'Alusta', sourceHash: '0'.repeat(16), status: 'CURRENT' } });
  check('a stale unit renders the English fallback', tx.text('home.action.start') === base.blocks['home.action.start'].text && tx.fallbacks().includes('home.action.start'));
  check('a stale unit rendered as HTML is marked lang="en"', tx.html('home.action.start').includes('lang="en"') && tx.langOf('home.action.start') === 'en');
  check('visible tx.text() without a lang marker is refused', unmarkedTextChildren('---\n---\n<p>{tx.text(\'home.hero.lead\')}</p>').length === 1 && unmarkedTextChildren('---\n---\n<b lang={tx.langOf(\'x.y\')}>{tx.text(\'x.y\')}</b><i title={tx.text(\'x.y\')}></i>').length === 0);
  const current = createTranslatorForTest(base, 'et', { 'home.action.start': { text: 'Alusta', sourceHash: hashOf('home.action.start'), status: 'REVIEWED' } });
  check('a current unit renders the translation', current.text('home.action.start') === 'Alusta');
  let threw = false;
  try {
    current.text('home.no-such-block');
  } catch {
    threw = true;
  }
  check('a raw key can never render', threw);

  // -------------------------------------------------------------------------
  // Documentation segment granularity: one hash per SEGMENT, not per page.
  // These controls mutate the model in memory only, so nothing on disk moves.
  // -------------------------------------------------------------------------
  const segSlug = 'getting-started/introduction';
  const canonical = base.docs[segSlug];
  const body = canonical.segments.filter((s) => s.kind === 'markdown');
  const [keep, edit] = body;
  const ids = [keep.id, edit.id];
  const withDocUnits = (slug, units) => {
    const s = load();
    s.docUnits.et = { ...(s.docUnits.et ?? {}), [slug]: { file: `src/locales/et/docs/${slug}.json`, doc: { schemaVersion: 1, locale: 'et', document: slug, units } } };
    return s;
  };
  const mutate = (s, slug, fn) => {
    const doc = s.docs[slug];
    const segments = fn(doc.segments);
    s.docs[slug] = { ...doc, segments, segmentsById: Object.fromEntries(segments.map((x) => [x.id, x])) };
    return s;
  };
  const rowsFor = (s, list) => unitReport(s).filter((r) => r.locale === 'et' && list.includes(r.id));
  const aUnit = { [keep.id]: { text: 'Säilitatud', sourceHash: keep.hash, status: 'CURRENT' }, [edit.id]: { text: 'Muudetud', sourceHash: edit.hash, status: 'CURRENT' } };
  const baseline = rowsFor(withDocUnits(segSlug, aUnit), ids);

  // 1. Change one canonical paragraph: exactly that segment goes STALE.
  const changedText = `${edit.text}\n\nUus lõik.`;
  const editedRows = rowsFor(
    mutate(withDocUnits(segSlug, aUnit), segSlug, (list) => list.map((x) => (x.id === edit.id ? { ...x, text: changedText, hash: segmentHash(x.kind, changedText) } : x))),
    ids,
  );
  check(
    'one canonical paragraph edit stales exactly its segment',
    baseline.length === 2 && baseline.every((r) => r.status === 'CURRENT') && editedRows.filter((r) => r.status === 'STALE').length === 1 && editedRows.find((r) => r.id === keep.id)?.status === 'CURRENT',
  );

  // 2. Add a segment: the new one is MISSING, the others stay CURRENT.
  const freshId = `${canonical.prefix}.fresh-section`;
  const addedRows = rowsFor(
    mutate(withDocUnits(segSlug, aUnit), segSlug, (list) => [...list, { id: freshId, name: 'fresh-section', kind: 'markdown', text: '## Fresh', hash: segmentHash('markdown', '## Fresh') }]),
    [...ids, freshId],
  );
  check('a new documentation segment is MISSING and leaves the others CURRENT', addedRows.find((r) => r.id === freshId)?.status === 'MISSING' && rowsFor(withDocUnits(segSlug, aUnit), ids).every((r) => r.status === 'CURRENT'));

  // 3. Delete a segment: its translation is ORPHANED, the others stay CURRENT.
  const deletedRows = rowsFor(
    mutate(withDocUnits(segSlug, aUnit), segSlug, (list) => list.filter((x) => x.id !== edit.id)),
    ids,
  );
  check('a deleted documentation segment ORPHANS its translation', deletedRows.find((r) => r.id === edit.id)?.status === 'ORPHANED' && deletedRows.find((r) => r.id === keep.id)?.status === 'CURRENT');

  // 4. Reorder segments: identities and translations are unchanged.
  const reorderedRows = rowsFor(
    mutate(withDocUnits(segSlug, aUnit), segSlug, (list) => [...list].reverse()),
    ids,
  );
  check('reordering documentation segments keeps their translations CURRENT', reorderedRows.length === 2 && reorderedRows.every((r) => r.status === 'CURRENT'));

  // 5. Change a stable ID: the old translation is ORPHANED, the new ID MISSING.
  const renamedId = `${canonical.prefix}.renamed-section`;
  const renamedRows = rowsFor(
    mutate(withDocUnits(segSlug, aUnit), segSlug, (list) => list.map((x) => (x.id === edit.id ? { ...x, id: renamedId, name: 'renamed-section' } : x))),
    [...ids, renamedId],
  );
  check('changing a stable segment ID ORPHANS the old unit and MISSES the new one', renamedRows.find((r) => r.id === edit.id)?.status === 'ORPHANED' && renamedRows.find((r) => r.id === renamedId)?.status === 'MISSING');

  // 6. Markup damage inside a translated segment fails validation.
  const linked = body.find((s) => /\]\([^)]+\)/.test(s.text));
  const damaged = withDocUnits(segSlug, { [linked.id]: { text: linked.text.replace(/\]\([^)]+\)/, '](/wrong-target/)'), sourceHash: linked.hash, status: 'CURRENT' } });
  check('a changed link target in a translated segment is refused', validateTranslations(damaged, coverage).some((p) => p.startsWith('[markup]') && p.includes(linked.id)));

  // 7. A partially translated document: translated segments stay in the
  //    locale, every English fallback fragment carries lang="en".
  const plan = planSegments({
    segments: [keep, edit],
    locale: 'et',
    canonical: 'en',
    stage: 'pilot',
    units: { [keep.id]: { text: 'Säilitatud', sourceHash: keep.hash, status: 'REVIEWED' } },
    renderStatuses: ['CURRENT', 'REVIEWED', 'MACHINE_DRAFT'],
  });
  const assembled = plan.map((p) => (p.lang === 'et' ? `<p>${p.text}</p>` : markFallback(`<p>${p.text}</p>`, p.lang))).join('');
  check(
    'a partially translated document marks each English fallback fragment lang="en"',
    plan.filter((p) => p.lang === 'et').length === 1 && (assembled.match(/lang="en" data-i18n-fallback/g) ?? []).length === 1 && assembled.includes('Säilitatud') && plan.find((p) => p.id === edit.id).lang === 'en',
  );
  return results;
}

function validate() {
  const store = load();
  const controls = redControls();
  const problems = [...store.problems, ...validateTranslations(store, loadCoverage()), ...templateFindings().map((f) => `[unmarked-fallback] ${f}: visible tx.text() — use set:html={tx.html(id)} or lang={tx.langOf(id)} on the element`)];
  console.log('RED CONTROLS');
  for (const c of controls) console.log(`  ${c.fired ? 'RED ' : 'MISS'} ${c.name}`);
  for (const c of controls.filter((x) => !x.fired)) problems.push(`[blind-gate] red control "${c.name}" did not fire`);
  console.log('\nTRANSLATIONS');
  const report = unitReport(store);
  for (const l of store.localesDoc.locales.filter((x) => x.id !== store.localesDoc.canonical && x.stage !== 'pseudo')) {
    const counts = {};
    for (const r of report.filter((x) => x.locale === l.id)) counts[r.status] = (counts[r.status] ?? 0) + 1;
    console.log(`  ${l.id.padEnd(8)} ${l.enabled ? 'enabled ' : 'disabled'} ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' / ')}`);
  }
  for (const p of problems) console.log('  FAIL ' + p);
  console.log(problems.length ? `\nFAILED: ${problems.length} translation problem(s)` : `\nOK: ${controls.length} red controls fired, every translation valid`);
  process.exit(problems.length ? 1 : 0);
}

const commands = { status, export: exportPackage, import: importPackage, validate, memory, add, enable, review, cleanup, deprecate };
if (!commands[command]) die('usage: node scripts/i18n.mjs status|export|import|validate|memory|add|enable');
try {
  if ((['import','add','enable','cleanup','deprecate'].includes(command) || command==='memory'&&has('apply')) && !has('dry-run')) withMutationLock('.',()=>commands[command]());
  else commands[command]();
} catch (error) {console.error(error.message);process.exitCode=error.exitCode ?? 1;}
