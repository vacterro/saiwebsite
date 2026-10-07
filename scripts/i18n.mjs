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
 *       from translation memory. Default file: i18n-work/<locale>.work.json.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { blockHash, markupSignature, normalizeText, placeholders } from '../src/content-engine/blocks/blocks.mjs';
import { checkTranslation, markdownSignature, uncoveredScripts, unitStatus, validateLocales } from '../src/content-engine/i18n/i18n.mjs';
import { createTranslator } from '../src/content-engine/i18n/translator.mjs';
import { loadStore, PATHS, unitReport, validateTranslations } from '../src/content-engine/i18n/store.mjs';
import { loadCoverage } from '../src/content-engine/i18n/engine-ext.mjs';
import { readRegistry, readSources } from './route-registry.mjs';

const [command, ...rest] = process.argv.slice(2);
const flag = (name) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const has = (name) => rest.includes(`--${name}`);
const positional = rest.filter((a, i) => !a.startsWith('--') && !(i > 0 && rest[i - 1].startsWith('--') && !['--json', '--apply', '--disable'].includes(rest[i - 1])));

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
  console.error(msg);
  process.exit(code);
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
      todo: flag('locale') ? rows.filter((r) => r.status !== 'CURRENT').map((r) => ({ kind: r.kind, id: r.id, status: r.status })) : undefined,
    };
  });
  if (has('json')) return console.log(JSON.stringify(out, null, 2));
  for (const o of out) {
    console.log(`${o.locale.padEnd(8)} ${o.name.padEnd(12)} ${o.stage.padEnd(8)} ${o.enabled ? 'enabled ' : 'disabled'} ${String(o.completion).padStart(5)}%  ${Object.entries(o.counts).map(([k, n]) => `${k} ${n}`).join(' / ')}${o.uncoveredScripts?.length ? `  FONT GAP: ${o.uncoveredScripts.join(', ')}` : ''}`);
    for (const t of o.todo ?? []) console.log(`  ${t.status.padEnd(13)} ${t.kind.padEnd(5)} ${t.id}`);
  }
}

// ---------------------------------------------------------------------------
// translation memory: exact normalized English -> approved translation
// ---------------------------------------------------------------------------
function memoryIndex(store, locale) {
  const index = new Map();
  for (const [id, unit] of Object.entries(store.units[locale] ?? {})) {
    const block = store.blocks[id];
    if (!block) continue;
    if (!['REVIEWED', 'CURRENT'].includes(unitStatus(unit, blockHash(block)))) continue;
    const key = `${block.type}\0${normalizeText(block.text)}`;
    if (!index.has(key)) index.set(key, { from: id, text: unit.text });
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
  const report = unitReport(store).filter((r) => r.locale === l.id && wanted.includes(r.status));
  const memory = memoryIndex(store, l.id);
  const glossary = {
    doNotTranslate: store.glossary.terms.filter((t) => !t.translate).map((t) => ({ term: t.en, notes: t.notes })),
    terms: store.glossary.terms.filter((t) => t.translate).map((t) => ({ id: t.id, en: t.en, notes: t.notes, ...(store.glossary.locales?.[l.id]?.[t.id] ?? {}) })),
  };
  const units = [];
  const documents = [];
  for (const r of report) {
    if (r.kind === 'block') {
      const block = store.blocks[r.id];
      if (!block) continue;
      const tm = memory.get(`${block.type}\0${normalizeText(block.text)}`);
      units.push({
        id: r.id,
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
    } else {
      const doc = store.docs[r.id];
      if (!doc) continue;
      documents.push({
        slug: r.id,
        section: doc.section,
        status: r.status,
        sourceHash: doc.hash,
        source: { title: doc.title, description: doc.description, body: doc.body },
        keepMarkdown: JSON.parse(markdownSignature(doc.body)),
        previous: r.unit ? { title: r.unit.frontmatter.title, description: r.unit.frontmatter.description, body: r.unit.body, status: r.unit.frontmatter.status } : null,
        translation: { title: '', description: '', body: '' },
      });
    }
  }
  const pkg = {
    kind: 'sai-website-translation-package',
    schemaVersion: 1,
    locale: l.id,
    localeInfo: { displayName: l.displayName, nativeName: l.nativeName, direction: l.direction, scripts: l.scripts },
    statuses: wanted,
    instructions: 'Read src/content-engine/i18n/TRANSLATING.md first. Fill `translation` of every unit and document; leave a unit empty to skip it. Keep every {placeholder}, `code span`, link target and **emphasis** structure, keep every doNotTranslate term verbatim, and use only characters the pixel faces draw. Then run: npm run i18n:import -- <this file>',
    glossary,
    units,
    documents,
  };
  const out = flag('out') ?? `i18n-work/${l.id}.work.json`;
  writeJson(out, pkg);
  console.log(`wrote ${out}: ${units.length} block unit(s), ${documents.length} document(s) for ${l.id} (${wanted.join(', ')})`);
}

// ---------------------------------------------------------------------------
// import
// ---------------------------------------------------------------------------
function frontmatterValue(v) {
  return JSON.stringify(String(v));
}

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
  if (status !== 'MACHINE_DRAFT' && !reviewer) die(`--status ${status} records a review: pass --reviewer <who reviewed it>`);
  const coverage = loadCoverage();
  const refused = [];
  const glyphCheck = (id, text) => {
    if (!coverage) return [];
    const bad = [...new Set([...text].filter((ch) => !/\s/.test(ch) && !coverage.has(ch.codePointAt(0))))];
    return bad.length ? [`[glyph-coverage] ${l.id} ${id}: the pixel faces cannot draw ${bad.join(' ')}`] : [];
  };

  const byDomain = new Map();
  let written = 0;
  for (const u of pkg.units ?? []) {
    if (!normalizeText(u.translation ?? '')) continue;
    const block = store.blocks[u.id];
    if (!block) {
      refused.push(`[orphaned] ${u.id}: no canonical block any more`);
      continue;
    }
    if (blockHash(block) !== u.sourceHash) {
      refused.push(`[source-moved] ${u.id}: the English changed after export — export again`);
      continue;
    }
    const problems = [...checkTranslation({ id: u.id, type: block.type, en: block.text, text: u.translation, glossary: store.glossary, locale: l.id }), ...glyphCheck(u.id, u.translation)];
    if (problems.length) {
      refused.push(...problems);
      continue;
    }
    if (!byDomain.has(block.domain)) byDomain.set(block.domain, []);
    byDomain.get(block.domain).push([u.id, { text: u.translation, sourceHash: u.sourceHash, status, ...(reviewer ? { reviewer } : {}) }]);
  }
  for (const [domain, entries] of byDomain) {
    const path = `${PATHS.units}/${l.id}/${domain}.json`;
    const doc = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, locale: l.id, domain, units: {} };
    for (const [id, unit] of entries) doc.units[id] = unit;
    doc.units = Object.fromEntries(Object.entries(doc.units).sort(([a], [b]) => a.localeCompare(b)));
    writeJson(path, doc);
    written += entries.length;
  }

  let docsWritten = 0;
  for (const d of pkg.documents ?? []) {
    const t = d.translation ?? {};
    if (!normalizeText(t.body ?? '')) continue;
    const doc = store.docs[d.slug];
    if (!doc) {
      refused.push(`[orphaned] docs/${d.slug}: no canonical document any more`);
      continue;
    }
    if (doc.hash !== d.sourceHash) {
      refused.push(`[source-moved] docs/${d.slug}: the English changed after export — export again`);
      continue;
    }
    const problems = [
      ...checkTranslation({ id: `docs/${d.slug}`, type: 'markdown', en: doc.body, text: t.body, glossary: store.glossary, locale: l.id }),
      ...checkTranslation({ id: `docs/${d.slug}#title`, type: 'text', en: doc.title, text: t.title ?? '', glossary: store.glossary, locale: l.id }),
      ...checkTranslation({ id: `docs/${d.slug}#description`, type: 'text', en: doc.description, text: t.description ?? '', glossary: store.glossary, locale: l.id }),
      ...glyphCheck(`docs/${d.slug}`, `${t.title}${t.description}${t.body}`),
    ];
    if (problems.length) {
      refused.push(...problems);
      continue;
    }
    const fm = ['---', `title: ${frontmatterValue(t.title)}`, `description: ${frontmatterValue(t.description)}`, `sourceHash: ${JSON.stringify(d.sourceHash)}`, `status: ${status}`, ...(reviewer ? [`reviewer: ${frontmatterValue(reviewer)}`] : []), '---', ''];
    const path = `${PATHS.units}/${l.id}/docs/${d.slug}.md`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${fm.join('\n')}\n${t.body.replace(/\r\n/g, '\n').trim()}\n`);
    docsWritten++;
  }
  for (const r of refused) console.log('  REFUSED ' + r);
  console.log(`${refused.length ? 'PARTIAL' : 'OK'}: wrote ${written} unit(s) and ${docsWritten} document(s) to src/locales/${l.id}/ as ${status}${refused.length ? `; ${refused.length} refused` : ''}`);
  console.log('next: npm run site:refresh && npm run i18n:validate && npm run build');
  process.exit(refused.length ? 1 : 0);
}

// ---------------------------------------------------------------------------
// memory
// ---------------------------------------------------------------------------
function memory() {
  const store = load();
  const l = localeOrDie(store, flag('locale'));
  const index = memoryIndex(store, l.id);
  const todo = unitReport(store).filter((r) => r.locale === l.id && r.kind === 'block' && ['MISSING', 'STALE'].includes(r.status));
  const hits = [];
  for (const r of todo) {
    const block = store.blocks[r.id];
    if (!block) continue;
    const tm = index.get(`${block.type}\0${normalizeText(block.text)}`);
    if (tm && tm.from !== r.id) hits.push({ id: r.id, domain: block.domain, from: tm.from, text: tm.text, sourceHash: blockHash(block) });
  }
  for (const h of hits) console.log(`  ${h.id}  <=  ${h.from}: ${h.text}`);
  if (has('apply') && hits.length) {
    const byDomain = new Map();
    for (const h of hits) byDomain.set(h.domain, [...(byDomain.get(h.domain) ?? []), h]);
    for (const [domain, list] of byDomain) {
      const path = `${PATHS.units}/${l.id}/${domain}.json`;
      const doc = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { schemaVersion: 1, locale: l.id, domain, units: {} };
      for (const h of list) doc.units[h.id] = { text: h.text, sourceHash: h.sourceHash, status: 'MACHINE_DRAFT' };
      doc.units = Object.fromEntries(Object.entries(doc.units).sort(([a], [b]) => a.localeCompare(b)));
      writeJson(path, doc);
    }
  }
  console.log(`${hits.length} exact match(es) for ${l.id}${has('apply') ? ' applied as MACHINE_DRAFT (review them)' : '; add --apply to copy them in as MACHINE_DRAFT'}`);
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
  if (l.enabled && l.stage === 'planned') l.stage = 'pilot';
  const store = load({ localesDoc: doc });
  const problems = validateTranslations(store, loadCoverage(), { forEnable: true }).filter((p) => p.includes(`locale ${id} `));
  if (l.enabled && problems.length) die(`refused to enable ${id}:\n  ${problems.join('\n  ')}`, 1);
  writeJson(PATHS.locales, doc);
  console.log(`${id} ${l.enabled ? 'enabled' : 'disabled'}; next: npm run build && npm run site:refresh && npm run site:doctor`);
}

// ---------------------------------------------------------------------------
// validate (+ red controls)
// ---------------------------------------------------------------------------
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
  const current = createTranslatorForTest(base, 'et', { 'home.action.start': { text: 'Alusta', sourceHash: hashOf('home.action.start'), status: 'REVIEWED' } });
  check('a current unit renders the translation', current.text('home.action.start') === 'Alusta');
  let threw = false;
  try {
    current.text('home.no-such-block');
  } catch {
    threw = true;
  }
  check('a raw key can never render', threw);
  return results;
}

function validate() {
  const store = load();
  const controls = redControls();
  const problems = [...store.problems, ...validateTranslations(store, loadCoverage())];
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

const commands = { status, export: exportPackage, import: importPackage, validate, memory, add, enable };
if (!commands[command]) die('usage: node scripts/i18n.mjs status|export|import|validate|memory|add|enable');
commands[command]();
