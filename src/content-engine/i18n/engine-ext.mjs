/**
 * Content-engine extension for blocks and translations (roadmap M37, M41-M46,
 * M52). Adds to every engine load:
 *   - the content lock manifest (canonical block and document hashes)
 *   - translation findings: invalid units are broken contracts, STALE and
 *     ORPHANED units are stale work, MISSING units are reported per locale
 *   - graph nodes and edges: block -> page, block -> unit -> locale variant,
 *     docs page -> doc unit -> localized doc page
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { registerExtension } from '../engine.mjs';
import { selectorMatches } from '../graph/graph.mjs';
import { serialize } from '../sources/lock.mjs';
import { contentLock, PATHS, unitReport, validateTranslations } from './store.mjs';
import { validateComposition } from '../compositions/compositions.mjs';
import { readdirSync } from 'node:fs';

export const COVERAGE_FILE = 'src/content-engine/i18n/font-coverage.json';

/** Code points every pixel face can draw (intersection), or null when the coverage file is absent. */
export function loadCoverage(root = '.') {
  const file = join(root, COVERAGE_FILE);
  if (!existsSync(file)) return null;
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const set = new Set();
  for (const [from, to] of doc.common) for (let cp = from; cp <= to; cp++) set.add(cp);
  return set;
}

/** The coverage file must describe the faces actually shipped. */
export function coverageFreshness(root = '.') {
  const file = join(root, COVERAGE_FILE);
  if (!existsSync(file)) return [`[generated-missing] ${COVERAGE_FILE}: run npm run fonts:coverage`];
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const manifest = JSON.parse(readFileSync(join(root, 'public/fonts/manifest.json'), 'utf8'));
  const recorded = new Map(doc.faces.map((f) => [f.file, f.sha256]));
  const stale = manifest.faces.filter((f) => recorded.get(f.file) !== f.sha256).map((f) => f.file);
  return stale.length ? [`[generated-drift] ${COVERAGE_FILE}: describes other faces than public/fonts ships (${stale.join(', ')}) — run npm run fonts:coverage`] : [];
}

registerExtension((engine, { at }) => {
  const store = engine.store;
  if (!store) return;

  engine.manifests.push({
    id: 'content-engine.content-lock',
    path: PATHS.contentLock,
    fresh: serialize(contentLock(store)),
    committed: existsSync(at(PATHS.contentLock)) ? readFileSync(at(PATHS.contentLock), 'utf8').replace(/\r\n/g, '\n') : null,
  });

  engine.contracts.push(...validateTranslations(store, loadCoverage(engine.root)));
  engine.contracts.push(...coverageFreshness(engine.root));
  // Page composition manifests (M38) reference only existing blocks and bindings.
  const compDir = at('src/content-engine/compositions');
  if (existsSync(compDir)) {
    for (const name of readdirSync(compDir).filter((f) => f.endsWith('.json')).sort()) {
      const doc = JSON.parse(readFileSync(`${compDir}/${name}`, 'utf8'));
      engine.contracts.push(...validateComposition(doc, `src/content-engine/compositions/${name}`, store.blocks, engine.registry.pages.map((p) => p.id)));
    }
  }

  const report = unitReport(store);
  engine.unitReport = report;
  const summary = {};
  for (const r of report) {
    summary[r.locale] ??= {};
    summary[r.locale][r.status] = (summary[r.locale][r.status] ?? 0) + 1;
  }
  engine.translationSummary = summary;
  engine.blockSummary = {
    blocks: Object.keys(store.blocks).length,
    documents: Object.keys(store.docs).length,
    segments: Object.values(store.docs).reduce((n, d) => n + d.segments.filter((s) => s.kind === 'markdown').length, 0),
    domains: new Set(Object.values(store.blocks).map((b) => b.domain)).size,
  };
  // Translation work never fails the build: the page falls back to English and
  // the doctor lists the work (severity "work"), per locale and per unit.
  for (const r of report) {
    if (r.status === 'STALE') engine.translations.push({ severity: 'work', message: `[translation-stale] ${r.locale} ${r.kind} ${r.id}: the English changed after this translation — npm run i18n:export -- --locale ${r.locale} --status stale` });
    if (r.status === 'ORPHANED') engine.translations.push({ severity: 'work', message: `[translation-orphaned] ${r.locale} ${r.kind} ${r.id}: no canonical source any more — remove the unit` });
  }

  // Graph: which pages each block feeds, and which locale units depend on it.
  const records = engine.records;
  const matches = (selector, r) => (selector === 'all-html' ? r.kind !== 'machine' : selector.startsWith('page:') && selectorMatches(selector.slice(5), r.id));
  const canonicalRecords = records.filter((r) => !r.variantOf);
  const variantsOf = new Map();
  for (const r of records.filter((x) => x.variantOf)) {
    const key = `${r.locale}\0${r.variantOf}`;
    variantsOf.set(key, [...(variantsOf.get(key) ?? []), r]);
  }
  const locales = store.localesDoc.locales.filter((l) => l.id !== store.localesDoc.canonical);
  for (const [id, block] of Object.entries(store.blocks)) {
    const node = `block:${id}`;
    engine.extraGraph.nodes.push(node);
    const pages = canonicalRecords.filter((r) => block.usedBy.some((s) => matches(s, r)));
    for (const page of pages) engine.extraGraph.edges.push([node, `page:${page.id}`]);
    for (const l of locales) {
      const unit = `unit:${l.id}:${id}`;
      engine.extraGraph.edges.push([node, unit]);
      for (const page of pages) for (const v of variantsOf.get(`${l.id}\0${page.id}`) ?? []) engine.extraGraph.edges.push([unit, `page:${v.id}`]);
    }
  }
  // A documentation SEGMENT is a first-class impacted unit: the document page
  // owns its segments, each segment owns one translation unit per locale, and a
  // unit feeds the locale's variant pages. Changing one segment therefore marks
  // exactly that segment's units stale — never every unit of the document.
  for (const doc of Object.values(store.docs)) {
    const pageId = `docs.${doc.slug.split('/').join('.')}`;
    for (const segment of doc.segments) {
      const node = `segment:${segment.id}`;
      engine.extraGraph.nodes.push(node);
      engine.extraGraph.edges.push([`page:${pageId}`, node]);
      for (const l of locales) {
        const unit = `unit:${l.id}:${segment.id}`;
        engine.extraGraph.edges.push([node, unit]);
        for (const v of variantsOf.get(`${l.id}\0${pageId}`) ?? []) engine.extraGraph.edges.push([unit, `page:${v.id}`]);
      }
    }
  }
});
