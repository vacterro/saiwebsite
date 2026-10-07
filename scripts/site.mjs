/**
 * Site maintenance CLI (content-system roadmap M33, M34, M36, M39).
 *
 *   npm run site:doctor [-- --json] [-- --allow-stale]
 *       Read-only health report: sources, content, translations, derived
 *       outputs, broken contracts. Exit 0 healthy, 1 broken, 2 stale.
 *       Runs its own red controls first, so a blind doctor cannot pass.
 *   npm run site:impact -- <id> [--json]
 *       What becomes stale when <id> (source, page, family or block) changes.
 *   npm run site:refresh
 *       Rewrite every manifest the content engine owns (source lock,
 *       inventory, and later content and translation locks) from the current
 *       tree. Never touches editorial text or upstream snapshots.
 *
 * Works offline. Pages and the inventory need `npm run build` first; without
 * dist/ they are reported UNKNOWN instead of failing.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEngine, manifestStates } from '../src/content-engine/engine.mjs';
import { buildGraph, findCycles, impact, resolveNode } from '../src/content-engine/graph/graph.mjs';
import { checkIntegrity } from '../src/content-engine/generated/integrity.mjs';
import { serialize } from '../src/content-engine/sources/lock.mjs';
import '../src/content-engine/extensions.mjs';

const [command, ...args] = process.argv.slice(2);
const json = args.includes('--json');
const positional = args.filter((a) => !a.startsWith('--'));

function redControls(engine) {
  const results = [];
  const check = (name, fired) => results.push({ name, fired: Boolean(fired) });

  // A source whose content moved since the lock must surface as STALE.
  const someId = Object.keys(engine.lock.sources).find((id) => engine.lock.sources[id].locked);
  const tampered = JSON.parse(serialize(engine.lock));
  tampered.sources[someId].sha256 = '0'.repeat(64);
  const drift = loadEngine({ root: engine.root, overrides: { committedLock: serialize(tampered) } }).sourceStates;
  check('source lock drift is reported STALE', drift.some((s) => s.id === someId && s.state === 'STALE'));

  // A dependency cycle must be found.
  const cyclic = buildGraph({
    sourcesDoc: engine.sourcesDoc,
    registry: engine.registry,
    records: engine.records,
    testsDoc: engine.testsDoc,
    extra: { edges: [...engine.extraGraph.edges, ['page:pricing', 'source:vacterro.support.public']] },
  });
  check('graph cycle is detected', findCycles(cyclic).length > 0);

  // A known mutation has a known blast radius: /pricing/ and its locale
  // variants, nothing else.
  if (engine.records.length) {
    const support = impact(engine.graph, 'source:vacterro.support.public');
    const pricingFamily = new Set(engine.records.filter((r) => r.id === 'pricing' || r.variantOf === 'pricing').map((r) => r.id));
    check('support source impacts exactly pricing and its variants', support.pages.includes('pricing') && support.pages.every((id) => pricingFamily.has(id)));
    // One canonical block change marks exactly its own unit in every locale stale.
    const block = impact(engine.graph, 'block:pricing.support.copy');
    const blockLocales = engine.store.localesDoc.locales.filter((l) => l.id !== engine.store.localesDoc.canonical).map((l) => `${l.id}:pricing.support.copy`);
    check('one block change touches only its own units', JSON.stringify(block.units) === JSON.stringify(blockLocales.sort()) && block.pages.every((id) => pricingFamily.has(id)));
    check('support source recommends test:support', support.gates.includes('test:support'));
    const protocol = impact(engine.graph, 'source:saipen.protocol.registry');
    check('protocol registry impact leaves /about/ alone', !protocol.pages.includes('about') && protocol.pages.includes('spec.v8.lifecycle'));
  }

  // A manifest hash that no longer matches its file must be caught.
  const fonts = engine.generatedDoc.artifacts.find((a) => a.integrity.kind === 'manifest-list');
  if (fonts) {
    const lie = JSON.parse(readFileSync(fonts.integrity.manifest, 'utf8'));
    lie[fonts.integrity.list][0].sha256 = 'f'.repeat(64);
    check('generated file with a wrong recorded hash is drift', checkIntegrity(fonts, engine.root, lie).some((p) => p.startsWith('[generated-drift]')));
  }
  return results;
}

function doctor() {
  const engine = loadEngine();
  const controls = redControls(engine);
  const manifests = manifestStates(engine);
  const sourceCounts = {};
  for (const s of engine.sourceStates) sourceCounts[s.state] = (sourceCounts[s.state] ?? 0) + 1;
  const failedSources = engine.contracts.filter((p) => p.startsWith('[source-failed]'));

  const broken = [
    ...engine.contracts,
    ...engine.integrity,
    ...engine.cycles.map((c) => `[cycle] ${c}`),
    ...manifests.filter((m) => m.state === 'MISSING').map((m) => `[manifest-missing] ${m.path}: run npm run site:refresh`),
    ...controls.filter((c) => !c.fired).map((c) => `[blind-gate] red control "${c.name}" did not fire`),
  ];
  const stale = [
    ...engine.sourceStates.filter((s) => ['STALE', 'NEW', 'REMOVED'].includes(s.state)).map((s) => `[source-${s.state.toLowerCase()}] ${s.id}: changed since the source lock — review site:impact ${s.id}, then npm run site:refresh`),
    ...manifests.filter((m) => m.state === 'STALE').map((m) => `[manifest-stale] ${m.path}: run npm run site:refresh`),
  ];
  const work = engine.translations.filter((t) => t.severity === 'work').map((t) => t.message);

  const report = {
    status: broken.length ? 'BROKEN' : stale.length ? 'STALE' : 'HEALTHY',
    sources: {
      counts: { ...sourceCounts, FAILED: failedSources.length },
      states: engine.sourceStates.map(({ id, state }) => ({ id, state })),
    },
    content: {
      dist: engine.hasDist,
      pages: engine.inventory ? engine.inventory.totals.routes : 'UNKNOWN',
      blocks: engine.blockSummary ?? null,
    },
    translations: engine.translationSummary ?? null,
    derived: { manifests, generatedArtifacts: engine.generatedDoc.artifacts.length, integrityProblems: engine.integrity.length },
    redControls: controls,
    broken,
    stale,
    translationWork: work,
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const line = (label, value) => console.log(`  ${label.padEnd(18)}${value}`);
    console.log('SOURCES');
    line('states', Object.entries(report.sources.counts).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' / '));
    for (const s of engine.sourceStates.filter((x) => x.state !== 'CURRENT')) line(s.state, s.id);
    console.log('\nCONTENT');
    line('built pages', engine.hasDist ? `${report.content.pages} registered routes` : 'UNKNOWN (no dist/ — run npm run build)');
    if (engine.blockSummary) line('blocks', Object.entries(engine.blockSummary).map(([k, n]) => `${k} ${n}`).join(' / '));
    console.log('\nTRANSLATIONS');
    if (!engine.translationSummary) line('locales', 'canonical English only');
    else for (const [locale, counts] of Object.entries(engine.translationSummary)) line(locale, Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(' / '));
    console.log('\nDERIVED OUTPUTS');
    for (const m of manifests) line(m.state, m.path);
    line('generated', `${report.derived.generatedArtifacts} artifacts, ${engine.integrity.length} integrity problem(s)`);
    console.log('\nRED CONTROLS');
    for (const c of controls) line(c.fired ? 'RED' : 'MISS', c.name);
    console.log('\nBROKEN CONTRACTS');
    if (!broken.length) line('none', '');
    for (const p of broken) console.log('  FAIL ' + p);
    if (stale.length) {
      console.log('\nSTALE');
      for (const p of stale) console.log('  STALE ' + p);
    }
    if (work.length) {
      console.log('\nTRANSLATION WORK (pages fall back to English; never fails the build)');
      for (const p of work.slice(0, 20)) console.log('  TODO ' + p);
      if (work.length > 20) console.log(`  … ${work.length - 20} more: npm run i18n:status -- --locale <id>`);
    }
    console.log(`\n${report.status}: ${broken.length} broken, ${stale.length} stale`);
  }
  if (broken.length) process.exit(1);
  if (stale.length && !args.includes('--allow-stale')) process.exit(2);
}

function impactCommand() {
  const id = positional[0];
  if (!id) {
    console.error('usage: npm run site:impact -- <source|page|family|block id> [--json]');
    process.exit(2);
  }
  const engine = loadEngine();
  const node = resolveNode(engine.graph, id);
  if (!node || node.ambiguous) {
    console.error(node ? `ambiguous id ${id}: ${node.ambiguous.join(', ')}` : `unknown id ${id}`);
    process.exit(2);
  }
  const result = impact(engine.graph, node);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const list = (label, items) => console.log(`${label.padEnd(10)}${items.length ? `${items.length}  ${items.join(', ')}` : '0'}`);
  console.log(`IMPACT ${node}`);
  list('direct', result.direct);
  list('pages', result.pages);
  list('families', result.families);
  list('blocks', result.blocks);
  list('locales', result.locales);
  list('units', result.units);
  list('gates', result.gates);
}

function refresh() {
  const engine = loadEngine();
  const hard = engine.contracts.filter((p) => !p.startsWith('[flag-'));
  if (hard.length) {
    for (const p of hard) console.log('  FAIL ' + p);
    console.log('\nrefresh refused: fix the broken contracts first (manifests are never written from an invalid registry)');
    process.exit(1);
  }
  let written = 0;
  for (const m of engine.manifests) {
    if (m.committed === m.fresh) continue;
    mkdirSync(dirname(m.path), { recursive: true });
    writeFileSync(m.path, m.fresh);
    written++;
    console.log(`  wrote ${m.path}`);
  }
  if (!engine.hasDist) console.log('  note: no dist/ — the inventory was not refreshed; run npm run build first');
  console.log(`OK: ${written} manifest(s) refreshed, ${engine.manifests.length - written} already current`);
}

const commands = { doctor, impact: impactCommand, refresh };
if (!commands[command]) {
  console.error('usage: node scripts/site.mjs doctor|impact|refresh');
  process.exit(2);
}
commands[command]();
