import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,existsSync,rmSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSiteFixture,removeSiteFixture } from '../lib/fixture.mjs';
import { runContentOperation } from '../../src/content-engine/operations/content.mjs';
import { loadEngine } from '../../src/content-engine/engine.mjs';
import { refreshManifests } from '../../src/content-engine/operations/manifests.mjs';
import { impact } from '../../src/content-engine/graph/graph.mjs';
import '../../src/content-engine/extensions.mjs';

test('add/edit/reorder/remove renders, updates discovery, leaves unrelated output byte-stable and rolls back', {timeout:120000},()=>{
  const root=createSiteFixture(), at=(p)=>join(root,p),read=(p)=>readFileSync(at(p),'utf8');
  const run=(script,args=[])=>{const r=spawnSync(process.execPath,[resolve(root,script),...args],{cwd:root,encoding:'utf8',timeout:60000});assert.equal(r.status,0,`${script}\n${r.stdout}\n${r.stderr}`);};
  const refresh=()=>{const e=loadEngine({root});const accept=e.sourceStates.filter((s)=>['NEW','STALE','REMOVED'].includes(s.state)&&e.sourcesDoc.sources.find((x)=>x.id===s.id)?.authority==='upstream').map((s)=>`${s.id}@${s.now?.sha256 ?? 'REMOVED'}`);refreshManifests(()=>loadEngine({root}),{acceptSources:accept},root);};
  const op=(...args)=>runContentOperation(args,root);
  try {
    run('node_modules/astro/astro.js',['build']);refresh();
    const pricing=read('dist/pricing/index.html'),community=read('dist/community/index.html');
    const original=new Map(['src/content-engine/registry/pages.json','src/content-engine/compositions/community.json','src/content-engine/blocks/community.json'].map((p)=>[p,read(p)]));
    const changed=new Set();const mutate=(...args)=>{const result=op(...args);result.changedFiles.forEach((p)=>changed.add(p));return result;};
    mutate('page','create','fixture','--route','/fixture/','--title','Fixture','--description','Disposable render proof');
    mutate('block','add','fixture.copy','--text','First fixture paragraph');
    mutate('block','add','fixture.second','--text','Second fixture paragraph');
    const section=(text)=>{writeFileSync(at('section.json'),JSON.stringify({type:'paragraph',text}));};
    section('fixture.copy');mutate('section','add','fixture','first','--file',at('section.json'));
    section('fixture.second');mutate('section','add','fixture','second','--file',at('section.json'));
    mutate('block','edit','fixture.copy','--text','Edited fixture paragraph');
    mutate('section','move','fixture','second','--before','first');
    run('node_modules/astro/astro.js',['build']);refresh();
    let html=read('dist/fixture/index.html');assert.ok(html.includes('Edited fixture paragraph'));assert.ok(html.indexOf('Second fixture paragraph')<html.indexOf('Edited fixture paragraph'));
    assert.equal(read('dist/pricing/index.html'),pricing);assert.equal(read('dist/community/index.html'),community);
    for(const file of ['dist/search-index.json','dist/llms.txt','dist/llms-full.txt','dist/sitemap.xml']) assert.ok(read(file).includes('/fixture/'),file);
    const e=loadEngine({root});const delta=impact(e.graph,'block:fixture.copy');for(const id of ['machine.search-index','machine.llms','machine.llms-full','machine.sitemap']) assert.ok(delta.pages.includes(id),id);
    assert.equal(op('section','move','fixture','second','--before','first').changedFiles.length,0);
    mutate('section','remove','fixture','first');mutate('block','remove','fixture.copy');
    run('node_modules/astro/astro.js',['build']);refresh();assert.ok(!read('dist/fixture/index.html').includes('Edited fixture paragraph'));assert.ok(read('dist/fixture/index.html').includes('Second fixture paragraph'));assert.equal(read('dist/pricing/index.html'),pricing);
    for(const p of changed) {if(original.has(p))writeFileSync(at(p),original.get(p));else if(existsSync(at(p)))rmSync(at(p));}
    run('node_modules/astro/astro.js',['build']);refresh();
    assert.equal(read('dist/community/index.html'),community);assert.equal(read('dist/pricing/index.html'),pricing);assert.ok(!existsSync(at('dist/fixture/index.html')));
    for(const script of ['validate-content','validate-registry']) run(`scripts/${script}.mjs`);
  } finally {removeSiteFixture(root);}
});
