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
 *       Rewrite every manifest the content engine owns (source lock, content
 *       lock, inventory) from the current tree. Never touches editorial text
 *       or upstream snapshots.
 *   npm run site:sync -- [--source <id>] [--dry-run]                     (M40)
 *       Refresh upstream snapshots through their own sync tools, keep the last
 *       valid snapshot on failure, drop date-only churn, classify the drift
 *       and print its impact. Network only here, only when run.
 *   npm run site:drift [-- --json]                                         (M53)
 *       Meaningful drift (sources changed since the lock, translation work) as
 *       a ready-to-file SAIPEN ticket. Prints; files nothing.
 *   npm run site:affected [-- --base <git ref>] [--json]                   (M54)
 *       The gates a change actually needs: changed files -> sources, blocks,
 *       documents -> impact graph -> gates, plus the mandatory smoke set.
 *       Unknown files (layouts, styles, scripts) mean the full suite.
 *
 * Works offline. Pages and the inventory need `npm run build` first; without
 * dist/ they are reported UNKNOWN instead of failing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadEngine, manifestStates } from '../src/content-engine/engine.mjs';
import { buildGraph, findCycles, impact, resolveNode } from '../src/content-engine/graph/graph.mjs';
import { checkIntegrity } from '../src/content-engine/generated/integrity.mjs';
import { listFiles, serialize } from '../src/content-engine/sources/lock.mjs';
import { syncSources } from '../src/content-engine/sync/sync.mjs';
import { validateComposition } from '../src/content-engine/compositions/compositions.mjs';
import { execFileSync } from 'node:child_process';
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

  // A composition that names a block that does not exist must be caught.
  if (engine.store) {
    const comp = { schemaVersion: 1, page: 'community', title: 'community.title', description: 'community.description', bindings: {}, sections: [{ type: 'heading', text: 'community.no-such-block' }] };
    check('composition with an unknown block is refused', validateComposition(comp, 'control.json', engine.store.blocks, engine.registry.pages.map((p) => p.id)).some((p) => p.startsWith('[unknown-block]')));
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
  list('segments', result.segments);
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

function flagValue(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function sync() {
  const engine = loadEngine();
  const only = flagValue('source') ? [flagValue('source')] : [];
  const unknown = only.filter((id) => !engine.sourcesDoc.sources.some((s) => s.id === id));
  if (unknown.length) {
    console.error(`unknown source ${unknown.join(', ')}`);
    process.exit(2);
  }
  const dryRun = args.includes('--dry-run');
  const results = syncSources({ sourcesDoc: engine.sourcesDoc, only, dryRun });
  if (!results.length) console.log('no upstream source with a refresh command matches');
  let failed = 0;
  for (const r of results) {
    console.log(`\n${r.drift.padEnd(26)} ${r.sources.join(', ')}  (${r.command})`);
    console.log(`  kept       ${r.kept}`);
    if (r.detail) console.log(`  detail     ${r.detail}`);
    if (r.changedFiles.length) console.log(`  changed    ${r.changedFiles.join(', ')}`);
    if (['SOURCE_UNAVAILABLE', 'SNAPSHOT_INVALID', 'SOURCE_CHANGED_SCHEMA'].includes(r.drift)) failed++;
    if (r.drift.startsWith('SOURCE_CHANGED')) {
      for (const id of r.sources) {
        const result = impact(engine.graph, `source:${id}`);
        console.log(`  impact     ${id}: ${result.pages.length} page(s), ${result.locales.length} locale(s), gates ${result.gates.join(' ')}`);
      }
    }
  }
  const kept = results.some((r) => r.kept === 'new snapshot');
  if (kept) console.log('\nnext: npm run build && npm run site:refresh && npm run site:doctor');
  process.exit(failed ? 1 : 0);
}

function drift() {
  const engine = loadEngine();
  const changed = engine.sourceStates.filter((s) => ['STALE', 'NEW', 'REMOVED'].includes(s.state));
  const work = engine.unitReport?.filter((r) => ['STALE', 'MISSING', 'ORPHANED'].includes(r.status)) ?? [];
  const enabled = new Set(engine.store?.localesDoc.locales.filter((l) => l.enabled).map((l) => l.id) ?? []);
  // Only drift that changes what visitors see is a ticket: upstream sources
  // that moved, and stale or missing units of locales that are live.
  const liveWork = work.filter((r) => enabled.has(r.locale));
  const impacts = changed.map((s) => ({ id: s.id, state: s.state, was: s.was ? { version: s.was.version, revision: s.was.revision } : null, now: s.now ? { version: s.now.version, revision: s.now.revision } : null, ...impact(engine.graph, `source:${s.id}`) }));
  const meaningful = impacts.length > 0 || liveWork.length > 0;
  const lines = [
    ...impacts.map((i) => `${i.id} ${i.state}${i.was && i.now && (i.was.version !== i.now.version || i.was.revision !== i.now.revision) ? ` ${i.was.version ?? ''}@${(i.was.revision ?? '').slice(0, 8)} -> ${i.now.version ?? ''}@${(i.now.revision ?? '').slice(0, 8)}` : ''}: ${i.pages.length} pages, ${i.blocks.length} blocks, ${i.locales.length} locales`),
    ...[...new Set(liveWork.map((r) => r.locale))].map((l) => `translations ${l}: ${liveWork.filter((r) => r.locale === l).length} unit(s) stale or missing`),
  ];
  const title = `Website drift: ${lines.length} item(s) — ${lines.map((l) => l.split(':')[0]).join('; ')}`.slice(0, 160);
  const ticket = meaningful
    ? `saipen ticket add P2 ${JSON.stringify(title)} --verify ${JSON.stringify('npm run site:doctor ends HEALTHY with no STALE source and no translation work for enabled locales; npm run build and npm test pass')}`
    : null;
  if (json) {
    console.log(JSON.stringify({ meaningful, sources: impacts, translationWork: liveWork.map(({ locale, kind, id, status }) => ({ locale, kind, id, status })), ticket }, null, 2));
    return;
  }
  if (!meaningful) {
    console.log('NO DRIFT: every source matches the lock and every enabled locale is current. No ticket.');
    return;
  }
  console.log('DRIFT');
  for (const l of lines) console.log(`  ${l}`);
  console.log('\nTo file it as SAIPEN work (run it yourself; this command files nothing):');
  console.log(`  ${ticket}`);
}

function affected() {
  const engine = loadEngine();
  const base = flagValue('base');
  const git = (...a) => execFileSync('git', ['-c', 'core.quotePath=false', ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n').filter(Boolean);
  const files = [...new Set([...(base ? git('diff', '--name-only', `${base}...HEAD`) : []), ...git('diff', '--name-only', 'HEAD'), ...git('ls-files', '--others', '--exclude-standard')])].filter((f) => !f.startsWith('.saipen/'));
  const starts = new Set();
  const unknown = [];
  const sourceOf = (f) => engine.sourcesDoc.sources.find((s) => s.paths.some((p) => f === p || f.startsWith(`${p}/`)));
  for (const f of files) {
    const doc = /^src\/content\/docs\/(.+)\.md$/.exec(f);
    const unitDoc = /^src\/locales\/([^/]+)\/docs\/(.+)\.json$/.exec(f);
    const unitFile = /^src\/locales\/([^/]+)\/([^/]+)\.json$/.exec(f);
    const catalogue = /^src\/content-engine\/blocks\/([^/]+)\.json$/.exec(f);
    const composition = /^src\/content-engine\/compositions\/[^/]+\.json$/.test(f) && existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')).page : null;
    if (composition) starts.add(`page:${composition}`);
    else if (doc) starts.add(`page:docs.${doc[1].split('/').join('.')}`);
    else if (unitDoc) {
      // A segment unit file touches only the segments it actually stores.
      const store = engine.store;
      const entry = store?.docUnits?.[unitDoc[1]]?.[unitDoc[2]];
      for (const id of Object.keys(entry?.doc?.units ?? {})) starts.add(`unit:${unitDoc[1]}:${id}`);
    }
    else if (unitFile) for (const id of Object.keys(engine.store?.units[unitFile[1]] ?? {}).filter((id) => engine.store.blocks[id]?.domain === unitFile[2])) starts.add(`unit:${unitFile[1]}:${id}`);
    else if (catalogue) for (const [id, b] of Object.entries(engine.store?.blocks ?? {})) { if (b.domain === catalogue[1]) starts.add(`block:${id}`); }
    else if (sourceOf(f)) starts.add(`source:${sourceOf(f).id}`);
    else if (/^(src\/content-engine\/(manifests|inventory)\/|README\.md|CONTRIBUTING\.md|roadmap\/|src\/content-engine\/.*\.md$)/.test(f)) continue;
    else unknown.push(f);
  }
  const gates = new Set(['audit:build', 'validate:content', 'validate:registry']);
  const pages = new Set();
  for (const start of starts) {
    if (!engine.graph.nodes.has(start)) continue;
    const r = impact(engine.graph, start);
    r.gates.forEach((g) => gates.add(g));
    r.pages.forEach((p) => pages.add(p));
    if (start.startsWith('page:')) pages.add(start.slice(5));
  }
  const full = unknown.length > 0;
  const result = { files: files.length, starts: [...starts].sort(), pages: [...pages].sort(), gates: full ? ['npm test (full suite)'] : [...gates].sort(), fullSuiteBecause: unknown };
  if (json) return console.log(JSON.stringify(result, null, 2));
  console.log(`${files.length} changed file(s) -> ${starts.size} engine node(s) -> ${pages.size} page(s)`);
  if (full) {
    console.log(`full suite: ${unknown.length} file(s) outside the dependency graph (${unknown.slice(0, 6).join(', ')}${unknown.length > 6 ? ' …' : ''})`);
    console.log('  npm run build && npm run check && npm run lint && npm test');
  } else {
    console.log('gates (impacted + mandatory smoke set):');
    for (const g of result.gates) console.log(`  npm run ${g}`);
  }
}

const commands = { doctor, impact: impactCommand, refresh, sync, drift, affected };
if (!commands[command]) {
  console.error('usage: node scripts/site.mjs doctor|impact|refresh|sync|drift|affected');
  process.exit(2);
}
commands[command]();
