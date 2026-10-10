import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSiteFixture, removeSiteFixture } from '../lib/fixture.mjs';
import { runContentOperation } from '../../src/content-engine/operations/content.mjs';
import { withMutationLock, writeTransaction, withinRoot } from '../../src/content-engine/operations/files.mjs';
import { planRefresh, refreshManifests } from '../../src/content-engine/operations/manifests.mjs';
import { loadEngine } from '../../src/content-engine/engine.mjs';
import { blockHash } from '../../src/content-engine/blocks/blocks.mjs';
import { unitReport, validateTranslations } from '../../src/content-engine/i18n/store.mjs';
import { loadCoverage } from '../../src/content-engine/i18n/engine-ext.mjs';
import { buildGraph, findCycles, impact } from '../../src/content-engine/graph/graph.mjs';
import { syncSources } from '../../src/content-engine/sync/sync.mjs';
import { computeLock, diffLock, sha256 } from '../../src/content-engine/sources/lock.mjs';
import { validateCanonicalSnapshot } from '../../src/content-engine/sources/canonical.mjs';
import { localeReadiness, independentReview } from '../../src/content-engine/i18n/readiness.mjs';
import '../../src/content-engine/extensions.mjs';

const read=(root,p)=>readFileSync(join(root,p),'utf8');
const json=(root,p)=>JSON.parse(read(root,p));
const write=(root,p,doc)=>writeFileSync(join(root,p),JSON.stringify(doc,null,2)+'\n');
const fixture=(fn)=>{const root=createSiteFixture();try{return fn(root);}finally{removeSiteFixture(root);}};
const store=(root)=>loadEngine({root}).store;
const sources=(root)=>json(root,'src/content-engine/registry/sources.json');

test('content authoring is idempotent, preserves stable IDs and orphaned translation work',()=>fixture((root)=>{
  const op=(...args)=>runContentOperation(args,root);
  const create=['page','create','fixture','--route','/fixture/','--title','Fixture','--description','Disposable control'];
  const before=read(root,'src/content-engine/registry/pages.json');
  assert.ok(op(...create,'--dry-run').changedFiles.length); assert.equal(read(root,'src/content-engine/registry/pages.json'),before);
  op(...create); assert.equal(op(...create).changedFiles.length,0);
  assert.throws(()=>op(...create.slice(0,6),'Changed title','--description','Disposable control','--label','Fixture'),/different text/);
  op('block','add','fixture.copy','--text','First paragraph');
  assert.equal(op('block','add','fixture.copy','--text','First paragraph').changedFiles.length,0);
  assert.throws(()=>op('block','add','fixture.copy','--text','Different'),/already exists/);
  write(root,'section.json',{type:'paragraph',text:'fixture.copy'});
  op('section','add','fixture','lead','--file',join(root,'section.json'));
  assert.equal(op('section','add','fixture','lead','--file',join(root,'section.json')).changedFiles.length,0);
  op('section','add','fixture','second','--file',join(root,'section.json'));
  op('section','move','fixture','second','--before','lead');
  assert.equal(op('section','move','fixture','second','--before','lead').changedFiles.length,0);
  const s=store(root), leadBefore=unitReport(s).find((r)=>r.locale==='et'&&r.id==='home.hero.lead').status, unit={text:'Esimene lõik',sourceHash:blockHash(s.blocks['fixture.copy']),status:'CURRENT',author:'fixture-author',reviewer:'fixture-independent-reviewer'};
  write(root,'src/locales/et/fixture.json',{schemaVersion:1,locale:'et',domain:'fixture',units:{'fixture.copy':unit}});
  // The synthetic reviewer is confined to this disposable test, never imported into the website.
  op('block','edit','fixture.copy','--text','Changed paragraph');
  const rows=unitReport(store(root)); assert.equal(rows.find((r)=>r.locale==='et'&&r.id==='fixture.copy').status,'STALE');
  assert.equal(rows.find((r)=>r.locale==='et'&&r.id==='home.hero.lead').status,leadBefore);
  assert.throws(()=>op('block','remove','fixture.copy'),/still referenced/);
  op('section','remove','fixture','lead'); op('section','remove','fixture','second'); op('block','remove','fixture.copy');
  assert.equal(unitReport(store(root)).find((r)=>r.locale==='et'&&r.id==='fixture.copy').status,'ORPHANED');
  assert.ok(existsSync(join(root,'src/locales/et/fixture.json')));
  op('page','move','fixture','--route','/moved/'); assert.equal(op('page','move','fixture','--route','/moved/').changedFiles.length,0);
  let reg=json(root,'src/content-engine/registry/pages.json'); assert.equal(reg.pages.find((p)=>p.id==='fixture').route,'/moved/'); assert.ok(reg.pages.some((p)=>p.route==='/fixture/'&&p.redirectTo==='fixture'));
  op('page','nav','fixture','--nav','secondary','--label','Fixture'); op('page','deprecate','fixture');
  op('page','remove','fixture','--replacement','community'); reg=json(root,'src/content-engine/registry/pages.json');
  assert.ok(reg.pages.filter((p)=>['/fixture/','/moved/'].includes(p.route)).every((p)=>p.redirectTo==='community'));
  assert.equal(loadEngine({root}).contracts.length,0);
}));

test('unsafe authoring, unknown references and required native sections are rejected',()=>fixture((root)=>{
  const op=(...args)=>runContentOperation(args,root);
  assert.throws(()=>op('section','remove','home','hero'),/required/);
  assert.throws(()=>op('section','hide','home','hero'),/required/);
  assert.throws(()=>op('section','move','home','hero','--after','next'),/required/);
  write(root,'section.json',{type:'cards',items:[{title:'home.hero.title',body:'home.hero.lead',actions:[{label:'home.action.start',href:'javascript:alert(1)'}]}]});
  assert.throws(()=>op('section','add','home','unsafe','--file',join(root,'section.json')),/unsafe|href|malformed|unknown-field/);
  write(root,'section.json',{type:'paragraph',text:'missing.block'});
  assert.throws(()=>op('section','add','home','missing','--file',join(root,'section.json')),/unknown-block/);
  assert.throws(()=>op('dependency','add','home','missing.source'),/unknown source/);
  assert.throws(()=>withinRoot(root,'../operator-file'),/unsafe-path/);
}));

test('source/hash/schema and generated-hash controls fail independently',()=>fixture((root)=>{
  const doc=sources(root), first=computeLock(doc,root).lock;
  const file='src/data/canonical/registry.json', original=read(root,file);
  writeFileSync(join(root,file),original+' ');
  assert.ok(diffLock(first,computeLock(doc,root).lock).some((r)=>r.id==='saipen.protocol.registry'&&r.state==='STALE'));
  assert.ok(validateCanonicalSnapshot(join(root,'src/data/canonical')).some((p)=>/hash/.test(p)));
  writeFileSync(join(root,file),'not JSON'); assert.ok(loadEngine({root}).contracts.some((p)=>p.startsWith('[canonical-file]')));
  rmSync(join(root,file)); assert.ok(computeLock(doc,root).problems.some((p)=>p.includes('missing')));
  writeFileSync(join(root,file),original);
  const canonicalMeta=json(root,'src/data/canonical/meta.json'), locked=computeLock(doc,root).lock;
  canonicalMeta.commitDate='2026-10-08T00:00:00Z';write(root,'src/data/canonical/meta.json',canonicalMeta);
  assert.ok(diffLock(locked,computeLock(doc,root).lock).every((r)=>!['STALE','NEW','REMOVED'].includes(r.state)));
  const faces=json(root,'public/fonts/manifest.json'); faces.faces[0].sha256='f'.repeat(64); write(root,'public/fonts/manifest.json',faces);
  assert.ok(loadEngine({root}).integrity.some((p)=>p.startsWith('[generated-drift]')));
}));

test('graph rejects cycles and unknown dependencies; one segment has a bounded unit impact',()=>{
  const e=loadEngine(), unknown=buildGraph({sourcesDoc:e.sourcesDoc,registry:e.registry,records:e.records,testsDoc:e.testsDoc,extra:{...e.extraGraph,edges:[...e.extraGraph.edges,['source:no-such-source','page:home']]}});
  assert.ok(unknown.problems.some((p)=>p.includes('no-such-source')));
  const cyc=buildGraph({sourcesDoc:e.sourcesDoc,registry:e.registry,records:e.records,testsDoc:e.testsDoc,extra:{...e.extraGraph,edges:[...e.extraGraph.edges,['page:home','source:saipen.protocol.meta']]}}); assert.ok(findCycles(cyc).length);
  const seg=Object.values(e.store.docs)[0].segments.find((s)=>s.kind==='markdown'); const r=impact(e.graph,`segment:${seg.id}`);
  assert.equal(r.units.length,3); assert.ok(r.units.every((u)=>u.endsWith(`:${seg.id}`))); assert.ok(r.pages.includes('machine.search-index')); assert.ok(r.pages.includes('machine.llms-full'));
  assert.ok(impact(e.graph,'source:saipen.protocol.meta').pages.includes('about'));
});

test('sync failure, partial writes, malformed metadata and timestamp churn retain the verified snapshot',()=>fixture((root)=>{
  const doc=sources(root), file='src/data/ecosystem.snapshot.json', before=read(root,file);
  const run=(runner,dryRun=false)=>syncSources({root,sourcesDoc:doc,only:['github.vacterro.releases'],runner,dryRun})[0];
  const partial=(_,o)=>{writeFileSync(join(o.stagingRoot,file),'invalid');return {status:1,output:'offline control'};};
  assert.equal(run(partial).drift,'SOURCE_UNAVAILABLE');assert.equal(read(root,file),before);
  assert.equal(run(()=>{throw new Error('connection reset');}).drift,'SNAPSHOT_INVALID');assert.equal(read(root,file),before);
  const timestamp=(_,o)=>{const d=json(o.stagingRoot,file);d.snapshot.date='2026-10-08';write(o.stagingRoot,file,d);return {status:0,output:''};};
  assert.equal(run(timestamp).drift,'NO_CHANGE');assert.equal(read(root,file),before);
  const malformed=(_,o)=>{const d=json(o.stagingRoot,file);d.repos.saipen.url='javascript:alert(1)';write(o.stagingRoot,file,d);return {status:0,output:''};};
  assert.equal(run(malformed).drift,'SNAPSHOT_INVALID');assert.equal(read(root,file),before);
  const changed=(_,o)=>{const d=json(o.stagingRoot,file);d.repos.saipen.description+=' Changed control.';write(o.stagingRoot,file,d);return {status:0,output:''};};
  assert.equal(run(changed,true).drift,'SOURCE_CHANGED_COMPATIBLE');assert.equal(read(root,file),before);
  assert.equal(run(changed).drift,'SOURCE_CHANGED_COMPATIBLE');assert.notEqual(read(root,file),before);
  assert.equal(run(()=>({status:0,output:''})).drift,'NO_CHANGE');
}));

test('refresh requires exact upstream review, locks concurrent operations and repeats without churn',()=>fixture((root)=>{
  const snapshot=json(root,'src/data/ecosystem.snapshot.json');snapshot.repos.saipen.description+=' Unreviewed control.';write(root,'src/data/ecosystem.snapshot.json',snapshot);
  let e=loadEngine({root}); const pending=e.sourceStates.filter((s)=>['NEW','STALE'].includes(s.state)&&e.sourcesDoc.sources.find((x)=>x.id===s.id)?.authority==='upstream');
  assert.ok(pending.length); assert.throws(()=>planRefresh(e),/unreviewed-source/); assert.throws(()=>planRefresh(e,{acceptSources:['wrong@hash']}),/unreviewed-source/);
  const options={acceptSources:pending.map((s)=>`${s.id}@${s.now.sha256}`)};
  const before=read(root,'src/content-engine/manifests/source-lock.json'); refreshManifests(()=>loadEngine({root}),{...options,dryRun:true},root);assert.equal(read(root,'src/content-engine/manifests/source-lock.json'),before);
  withMutationLock(root,()=>assert.throws(()=>refreshManifests(()=>loadEngine({root}),options,root),/operation-busy/));
  refreshManifests(()=>loadEngine({root}),options,root); assert.equal(refreshManifests(()=>loadEngine({root}),{},root).changedFiles.length,0);
  assert.throws(()=>writeTransaction(root,{'../outside.txt':'unsafe'}),/unsafe-path/);
}));

test('canonical sync refuses invalid schema and missing referenced sources even with matching manifest hashes',()=>fixture((root)=>{
  const doc=sources(root),before=read(root,'src/data/canonical/registry.json'),metaBefore=read(root,'src/data/canonical/meta.json');
  const run=(runner)=>syncSources({root,sourcesDoc:doc,only:['saipen.protocol.meta'],runner})[0];
  const invalid=(_,o)=>{
    const p='src/data/canonical/registry.json',registry=json(o.stagingRoot,p);registry.phases.all=[];write(o.stagingRoot,p,registry);
    const meta=json(o.stagingRoot,'src/data/canonical/meta.json');meta.files.registry.sha256=sha256(read(o.stagingRoot,p));write(o.stagingRoot,'src/data/canonical/meta.json',meta);return {status:0,output:''};
  };
  assert.equal(run(invalid).drift,'SNAPSHOT_INVALID');assert.equal(read(root,'src/data/canonical/registry.json'),before);assert.equal(read(root,'src/data/canonical/meta.json'),metaBefore);
  const missing=(_,o)=>{
    const p='src/data/canonical/documentation.json',d=json(o.stagingRoot,p);delete d.files['README.md'];write(o.stagingRoot,p,d);
    const meta=json(o.stagingRoot,'src/data/canonical/meta.json');meta.documentation.sha256=sha256(read(o.stagingRoot,p));write(o.stagingRoot,'src/data/canonical/meta.json',meta);return {status:0,output:''};
  };
  assert.equal(run(missing).drift,'SNAPSHOT_INVALID');assert.equal(read(root,'src/data/canonical/meta.json'),metaBefore);
}));

test('drafts render honestly; fake review and uncovered scripts cannot qualify for publication',()=>{
  const e=loadEngine(),s=e.store,coverage=loadCoverage();
  // Publication-safety invariants hold regardless of live sync state: a source
  // edit honestly stales translations (completion < 100 with English fallback)
  // but must never qualify a pilot locale for production.
  for (const locale of ['et','ru']) {const r=localeReadiness(s,coverage,locale,unitReport(s));assert.equal(r.publicationCompletion,0);assert.equal(r.productionReady,false);}
  for (const row of unitReport(s).filter((r)=>r.locale==='et'&&!r.outOfScope)) assert.ok(['CURRENT','REVIEWED','MACHINE_DRAFT','STALE','MISSING','ORPHANED'].includes(row.status),row.id);
  assert.equal(independentReview({author:'same',reviewer:'Same'}),false);
  const unit=s.units.et['home.hero.lead']; const old=unit.text;unit.text+=' 漢';assert.ok(validateTranslations(s,coverage).some((p)=>p.includes('glyph')));unit.text=old;
  const b=s.blocks['home.hero.lead'];const liveHash=blockHash(b);unit.sourceHash='0'.repeat(16);assert.equal(unitReport(s).find((r)=>r.locale==='et'&&r.id==='home.hero.lead').status,'STALE');unit.sourceHash=liveHash;
  assert.equal(blockHash(structuredClone(b)),liveHash);
});
