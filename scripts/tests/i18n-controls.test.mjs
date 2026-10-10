import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync } from 'node:fs';
import { join,resolve } from 'node:path';
import { createSiteFixture,removeSiteFixture } from '../lib/fixture.mjs';
import { affectedFiles,FULL_GATES } from '../../src/content-engine/operations/affected.mjs';
import { loadEngine } from '../../src/content-engine/engine.mjs';
import { parseDocument } from '../../src/content-engine/i18n/segments.mjs';
import { checkTranslation,markdownSignature,validateLocales } from '../../src/content-engine/i18n/i18n.mjs';
import { blockHash } from '../../src/content-engine/blocks/blocks.mjs';
import '../../src/content-engine/extensions.mjs';
import { verificationVersionProblems } from '../../src/content-engine/verification.mjs';

test('a historical claim cannot impersonate a current receipt or reference an invented release',()=>{
  const input={version:'1.5.0',siteVersion:'1.4.0',kind:'CURRENT_RECEIPT',hasChangelog:(v)=>v==='1.4.0'};
  assert.ok(verificationVersionProblems(input).length);
  assert.deepEqual(verificationVersionProblems({...input,kind:'HISTORICAL_CLAIM'}),[]);
  assert.ok(verificationVersionProblems({...input,kind:'HISTORICAL_CLAIM',siteVersion:'9.9.9'}).length);
});

test('unsafe markup, wrong code/link/placeholder and missing locale keys are rejected',()=>{
  const e=loadEngine(),glossary=e.store.glossary;
  const block={type:'inline',text:'SAIPEN {version}: [Docs](/docs/) and `saipen continue`'};
  const check=(text)=>checkTranslation({id:'control',type:block.type,en:block.text,text,glossary,locale:'et'});
  assert.deepEqual(check(block.text),[]);
  for(const text of ['SAIPEN {wrong}: [Docs](/docs/) and `saipen continue`','SAIPEN {version}: [Docs](https://bad.example/) and `saipen continue`','SAIPEN {version}: [Docs](/docs/) and `saipen push`','SAIPEN {version}: <script>alert(1)</script> [Docs](/docs/) and `saipen continue`'])assert.ok(check(text).some((p)=>/^\[(markup|placeholder)\]/.test(p)),text);
  assert.notDeepEqual(markdownSignature('## Title\n\n```sh\nsaipen continue\n```'),markdownSignature('## Title\n\n```sh\nsaipen push\n```'));
  assert.notDeepEqual(markdownSignature('A paragraph.'),markdownSignature('<script>alert(1)</script> A paragraph.'));
  const locale=structuredClone(e.store.localesDoc);delete locale.locales[0].direction;assert.ok(validateLocales(locale).length);
  const malformed=structuredClone(e.store.localesDoc);malformed.locales[0].scripts={unsupported:true};assert.ok(validateLocales(malformed).some((p)=>p.startsWith('[malformed]')));
});

test('one changed documentation paragraph selects its segment; infrastructure and deletion require full fallback',()=>{
  const e=loadEngine(),file='src/content/docs/getting-started/introduction.md',source=readFileSync(file,'utf8');
  const parsed=parseDocument({raw:source,slug:'getting-started/introduction'}),segment=parsed.segments.find((s)=>s.kind==='markdown');
  const directive=`<!-- i18n:${segment.id} -->`;
  const before=source.replace(directive,`${directive}\nA previous control paragraph.\n`);
  const r=affectedFiles(e,[file],()=>before);assert.equal(r.fullSuiteBecause.length,0);assert.deepEqual(r.starts,[`segment:${segment.id}`]);assert.ok(r.pages.includes('machine.search-index'));assert.ok(r.gates.includes('test:i18n'));
  assert.deepEqual(affectedFiles(e,['astro.config.mjs'],()=>null).gates,FULL_GATES);
  assert.deepEqual(affectedFiles(e,['deleted-component.astro'],()=>null).gates,FULL_GATES);
});

test('translation packages are atomic, duplicates/hash drift/self review fail and dry runs preserve bytes',()=>{
  const root=createSiteFixture(),run=(...args)=>spawnSync(process.execPath,[resolve(root,'scripts/i18n.mjs'),...args],{cwd:root,encoding:'utf8'});
  try {
    const domainPath=join(root,'src','locales','et','home.json'),domainDoc=JSON.parse(readFileSync(domainPath,'utf8'));
    // Rebase to the fixture's current source hash: the fixture copies the live
    // tree, so a stored hash may predate a legitimate source edit (correctly
    // STALE there). This control needs a draft against current source.
    const liveHash=blockHash(JSON.parse(readFileSync(join(root,'src','content-engine','blocks','home.json'),'utf8')).blocks['home.hero.lead']);
    domainDoc.units['home.hero.lead']={text:domainDoc.units['home.hero.lead'].text,sourceHash:liveHash,status:'MACHINE_DRAFT',author:'fixture-author'};
    writeFileSync(domainPath,`${JSON.stringify(domainDoc,null,2)}\n`);
    const out=join(root,'work.json');assert.equal(run('export','--locale','et','--status','machine_draft','--id','home.hero.lead','--out',out).status,0);
    const pkg=JSON.parse(readFileSync(out,'utf8')), unit=pkg.units[0];unit.translation=JSON.parse(readFileSync(join(root,'src/locales/et/home.json'),'utf8')).units[unit.id].text;unit.status='MACHINE_DRAFT';pkg.author='fixture-author';
    const domain=join(root,'src/locales/et/home.json'),before=readFileSync(domain,'utf8');
    writeFileSync(out,JSON.stringify(pkg));assert.equal(run('import',out,'--dry-run').status,0);assert.equal(readFileSync(domain,'utf8'),before);
    assert.notEqual(run('import',out,'--status','CURRENT','--author','same','--reviewer','same').status,0);assert.equal(readFileSync(domain,'utf8'),before);
    pkg.units.push({...unit,id:'home.action.start',sourceHash:'0'.repeat(16),translation:'Alusta'});writeFileSync(out,JSON.stringify(pkg));assert.notEqual(run('import',out).status,0);assert.equal(readFileSync(domain,'utf8'),before);
    pkg.units=[unit,{...unit}];writeFileSync(out,JSON.stringify(pkg));assert.notEqual(run('import',out).status,0);assert.equal(readFileSync(domain,'utf8'),before);
    assert.notEqual(run('enable','et','--dry-run').status,0);
  } finally {removeSiteFixture(root);}
});
