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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEngine } from '../src/content-engine/engine.mjs';
import { buildGraph, findCycles, impact, resolveNode } from '../src/content-engine/graph/graph.mjs';
import { checkIntegrity } from '../src/content-engine/generated/integrity.mjs';
import { serialize } from '../src/content-engine/sources/lock.mjs';
import { syncSources } from '../src/content-engine/sync/sync.mjs';
import { validateComposition } from '../src/content-engine/compositions/compositions.mjs';
import { execFileSync } from 'node:child_process';
import { runContentOperation } from '../src/content-engine/operations/content.mjs';
import { refreshManifests } from '../src/content-engine/operations/manifests.mjs';
import '../src/content-engine/extensions.mjs';
import { healthReport } from '../src/content-engine/health.mjs';
import { driftReport, intakeDrift } from './lib/drift.mjs';
import { affectedFiles } from '../src/content-engine/operations/affected.mjs';

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
  const drift = loadEngine({ root: engine.root, inspectBuilt: engine.hasDist, overrides: { committedLock: serialize(tampered) } }).sourceStates;
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
    const htmlPages=(ids)=>ids.filter((id)=>engine.records.find((r)=>r.id===id)?.kind!=='machine');
    check('support source impacts exactly pricing HTML and its variants', support.pages.includes('pricing') && htmlPages(support.pages).every((id) => pricingFamily.has(id)));
    // One canonical block change marks exactly its own unit in every locale stale.
    const block = impact(engine.graph, 'block:pricing.support.copy');
    const blockLocales = engine.store.localesDoc.locales.filter((l) => l.id !== engine.store.localesDoc.canonical).map((l) => `${l.id}:pricing.support.copy`);
    check('one block change touches only its own units', JSON.stringify(block.units) === JSON.stringify(blockLocales.sort()) && htmlPages(block.pages).every((id) => pricingFamily.has(id)));
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
  // `--source-only` runs the health report WITHOUT inspecting any built site:
  // sources, locks, generated manifests, translations and red controls, but no
  // dist/ inventory or discovery. The release factory uses it pre-build so the
  // source-health gate can never validate (or trust) an inherited dist/ from an
  // earlier transaction; the built site is checked after this run's own build
  // by the artifact gates (validate-content / validate-registry) against
  // SAI_RELEASE_ARTIFACT_DIR, inside the exclusive lock, before promotion.
  const sourceOnly = args.includes('--source-only');
  const dist = process.env.SAI_RELEASE_ARTIFACT_DIR ? resolve(process.env.SAI_RELEASE_ARTIFACT_DIR) : 'dist';
  const engine = loadEngine({ dist, inspectBuilt: !sourceOnly });
  const controls = redControls(engine);
  const report=healthReport(engine,controls);
  const {broken,stale,translationWork:work,derived:{manifests}}=report;
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
  list('sections', result.sections);
  list('models', result.models);
  list('artifacts', result.artifacts);
  list('locales', result.locales);
  list('units', result.units);
  list('gates', result.gates);
}

function refresh() {
  const acceptSources=args.flatMap((a,i)=>a==='--accept-source'?[args[i+1]]:[]);
  const report=refreshManifests(()=>loadEngine(),{acceptSources,dryRun:args.includes('--dry-run')});
  if (json) return console.log(JSON.stringify(report,null,2));
  for (const file of report.changedFiles) console.log(`  ${report.dryRun?'would write':'wrote'} ${file}`);
  console.log(`OK: ${report.changedFiles.length} manifest(s) ${report.dryRun?'planned':'refreshed'}`);
}

function content() {
  const report=runContentOperation(args);
  if (report.json) return console.log(JSON.stringify(report,null,2));
  console.log(`${report.dryRun?'PREVIEW':'OK'}: ${report.operation}; ${report.changedFiles.length} file(s)`);
  for (const file of report.changedFiles) console.log(`  ${file}`);
  for (const row of report.invalidated) console.log(`  ${row.status} ${row.locale} ${row.id}`);
  console.log(`next: ${report.next}`);
}

function prepare() {
  const run=(script,extra=[])=>{
    console.log(`RUN ${script}${extra.length?` ${extra.join(' ')}`:''}`);
    try {execFileSync(process.execPath,[script,...extra],{stdio:'inherit'});} catch (error) {throw new Error(`[prepare-failed] ${script}: exit ${error.status}; subsequent actions were not run`);}
  };
  run('node_modules/astro/astro.js',['check']);
  run('node_modules/astro/astro.js',['build']);
  const accept=args.flatMap((a,i)=>a==='--accept-source'?[a,args[i+1]]:[]);
  const changes=refreshManifests(()=>loadEngine(),{acceptSources:accept.filter((a)=>a!=='--accept-source'),dryRun:true}).changedFiles;
  run('scripts/site.mjs',['refresh',...accept]);
  if(changes.length){
    console.log(`REBUILD: ${changes.length} manifest(s) changed; update build-time diagnostic projections`);
    run('node_modules/astro/astro.js',['build']);
    run('scripts/site.mjs',['refresh']);
  }
  for (const script of ['lint-styles','validate-themes','validate-canonical','validate-content','validate-registry','validate-baselines','validate-licenses','audit-build']) run(`scripts/${script}.mjs`);
  run('scripts/i18n.mjs',['validate']);
  run('scripts/site.mjs',['doctor']);
  if (args.includes('--test')) run('node_modules/@playwright/test/cli.js',['test']);
  console.log('PREPARED: validated static build; publication remains an operator decision');
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
      for (const id of r.changedSources ?? r.sources) {
        const result = impact(engine.graph, `source:${id}`);
        console.log(`  impact     ${id}: ${result.pages.length} page(s), ${result.locales.length} locale(s), gates ${result.gates.join(' ')}`);
      }
    }
  }
  const kept = results.some((r) => r.kept.startsWith('new snapshot'));
  if (kept) console.log('\nnext: npm run build && npm run site:refresh && npm run site:doctor');
  process.exit(failed ? 1 : 0);
}

function drift() {
  const report=driftReport(loadEngine());
  if (args.includes('--intake')) report.intake=intakeDrift(report,{dryRun:args.includes('--dry-run')});
  if (json) console.log(JSON.stringify(report,null,2));
  else {
    console.log(report.meaningful?`DRIFT ${report.identity}: ${report.sources.length} source(s), ${report.translationWork.length} public translation unit(s)`:'NO DRIFT: no meaningful source or public translation delta; no ticket');
    for (const s of report.sources) console.log(`  ${s.id}: ${s.pages.length} pages; gates ${s.gates.join(', ')}`);
    if (report.intake) console.log(`${report.intake.status}: ${report.intake.ticket ?? report.intake.report ?? report.identity}`);
    else if (report.meaningful) console.log('next: site:impact <source>; site:drift --intake --dry-run; site:drift --intake');
  }
  if (report.intake?.status==='INTAKE_REFUSED') process.exitCode=1;
  return;
}

function affected() {
  const engine=loadEngine(),base=flagValue('base') ?? 'HEAD';
  const git=(...a)=>execFileSync('git',['-c','core.quotePath=false',...a],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).split('\n').filter(Boolean);
  const files=[...new Set([...git('diff','--name-only',base),...git('ls-files','--others','--exclude-standard')])];
  const previous=(file)=>{try{return execFileSync('git',['show',`${base}:${file}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']});}catch{return null;}};
  const result=affectedFiles(engine,files,previous);
  if(json)console.log(JSON.stringify(result,null,2));
  else {console.log(`${result.files} files -> ${result.starts.length} nodes -> ${result.pages.length} pages`);if(result.fullSuiteBecause.length)console.log(`FULL SUITE: ${result.fullSuiteBecause.join(', ')}`);result.commands.forEach((c)=>console.log(`  ${c}`));}
  if(args.includes('--run')) {
    prepare(); // dependency order: check -> build -> reviewed manifests -> static gates
    for(const gate of [...result.gates.filter((g)=>g.startsWith('test:')),...(result.fullSuiteBecause.length?['test']:[])]){
    if(!/^[a-z0-9:.-]+$/.test(gate)||!JSON.parse(readFileSync('package.json','utf8')).scripts[gate])throw new Error(`[unknown-gate] ${gate}`);
    console.log(`RUN ${gate}`);
    if(process.platform==='win32')execFileSync('npm.cmd',['run',gate],{stdio:'inherit',shell:true});
    else execFileSync('npm',['run',gate],{stdio:'inherit'});
    }
  }
  return;
}

const commands = { doctor, impact: impactCommand, refresh, sync, drift, affected, content, prepare };
if (!commands[command]) {
  console.error('usage: node scripts/site.mjs doctor|impact|refresh|sync|drift|affected|content|prepare');
  process.exit(2);
}
try {commands[command]();} catch (error) {console.error(error.message);process.exitCode=1;}
