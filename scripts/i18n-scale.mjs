/** Run offline capacity checks or a private, disposable multi-locale build. */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createSiteFixture, removeSiteFixture } from './lib/fixture.mjs';
import { measureScalePlan, proposedRegistry } from '../src/content-engine/i18n/scale.mjs';
import { blockHash } from '../src/content-engine/blocks/blocks.mjs';
import { pseudoLocalize } from '../src/content-engine/i18n/i18n.mjs';
import { loadStore, requiredUnits } from '../src/content-engine/i18n/store.mjs';

const args=process.argv.slice(2), flag=(name)=>args[args.indexOf(`--${name}`)+1];
const write=(path,value)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,JSON.stringify(value,null,2)+'\n');};
const walk=(dir)=>readdirSync(dir,{withFileTypes:true}).flatMap((e)=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);
const run=(root,script,extra=[])=>{
  const result=spawnSync(process.execPath,[resolve(root,script),...extra],{cwd:root,encoding:'utf8',timeout:180_000});
  if (result.status!==0) throw new Error(`${script}: exit ${result.status}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
};

const report=measureScalePlan();
if (report.problems.length) {console.error(report.problems.join('\n'));process.exitCode=1;}
else if (args.includes('--build')||args.includes('--pilot')) {
  const root=createSiteFixture();
  try {
    const {proposal,localesDoc}=proposedRegistry(root);
    const ids=args.includes('--pilot')?['en','et','ru']:proposal.stressFixture.locales;
    localesDoc.locales=localesDoc.locales.filter((l)=>ids.includes(l.id));
    for (const l of localesDoc.locales) if (l.id!==localesDoc.canonical) Object.assign(l,{stage:'pilot',enabled:true,publication:'internal',scope:'pilot',renderStatuses:['CURRENT','REVIEWED','MACHINE_DRAFT'],llmsEnabled:true});
    write(join(root,'src/content-engine/i18n/locales.json'),localesDoc);
    const registry=JSON.parse(readFileSync(join(root,'src/content-engine/registry/pages.json'),'utf8'));
    const sourceIds=JSON.parse(readFileSync(join(root,'src/content-engine/registry/sources.json'),'utf8')).sources.map((s)=>s.id);
    const store=loadStore({root,registry,sourceIds});
    for (const l of localesDoc.locales.filter((l)=>l.id!==localesDoc.canonical)) {
      const required=requiredUnits(store,l.id),domains=new Map();
      for (const id of required.blockIds) {
        const b=store.blocks[id],existing=store.units[l.id]?.[id];
        const unit=existing && existing.sourceHash===blockHash(b)?existing:{text:pseudoLocalize(b.text,store.glossary,b.type),sourceHash:blockHash(b),status:'MACHINE_DRAFT',author:'synthetic-scale-fixture'};
        if (!domains.has(b.domain)) domains.set(b.domain,{});
        const {domain:_domain,...persisted}=unit;
        domains.get(b.domain)[id]=persisted;
      }
      for (const [domain,units] of domains) write(join(root,`src/locales/${l.id}/${domain}.json`),{schemaVersion:1,locale:l.id,domain,units});
      for (const slug of required.docSlugs) {
        const units={};
        for (const s of store.docs[slug].segments) {
          const existing=store.docUnits[l.id]?.[slug]?.doc.units[s.id];
          units[s.id]=existing && existing.sourceHash===s.hash?existing:{text:pseudoLocalize(s.text,store.glossary,s.kind),sourceHash:s.hash,status:'MACHINE_DRAFT',author:'synthetic-scale-fixture'};
        }
        write(join(root,`src/locales/${l.id}/docs/${slug}.json`),{schemaVersion:1,locale:l.id,document:slug,units});
      }
    }
    run(root,'scripts/i18n.mjs',['validate']);
    const started=performance.now();
    run(root,'node_modules/astro/astro.js',['build']);
    const buildSeconds=(performance.now()-started)/1000;
    // These are copies of already inspected local snapshots, not an upstream trust bypass.
    const health=JSON.parse(run(root,'scripts/site.mjs',['doctor','--json','--allow-stale']));
    const accepted=health.sources.states.filter((s)=>s.reviewToken).flatMap((s)=>['--accept-source',s.reviewToken]);
    run(root,'scripts/site.mjs',['refresh',...accepted]);
    for (const script of ['validate-content','validate-registry','audit-build']) run(root,`scripts/${script}.mjs`);
    run(root,'scripts/site.mjs',['doctor']);
    const files=walk(join(root,'dist')), html=files.filter((p)=>p.endsWith('.html'));
    const fonts=files.filter((p)=>p.endsWith('.woff2'));
    const indexes=files.filter((p)=>p.endsWith('search-index.json'));
    const inventory=JSON.parse(readFileSync(join(root,'src/content-engine/inventory/pages.inventory.json'),'utf8'));
    const output=args.includes('--out')?resolve(flag('out')):null;
    if (output) {
      if (existsSync(output)) throw new Error(`output already exists: ${output}; choose a new preview directory`);
      cpSync(join(root,'dist'),output,{recursive:true});
      write(join(output,'PREVIEW-INVENTORY.json'),inventory);
      write(join(output,'FIXTURE-INFO.json'),{purpose:args.includes('--pilot')?'ET_RU_MACHINE_DRAFT_PRIVATE_PREVIEW':proposal.stressFixture.purpose,locales:ids,publication:'INTERNAL_ONLY',productionRegistryChanged:false});
    }
    report.build={purpose:args.includes('--pilot')?'ET_RU_MACHINE_DRAFT_PRIVATE_PREVIEW':proposal.stressFixture.purpose,naturalLocales:ids.length,publicNaturalLocales:1,previewNaturalLocales:ids.length-1,buildSeconds:Math.round(buildSeconds*1000)/1000,htmlPages:html.length,routes:inventory.totals.routes,htmlBytes:html.reduce((n,p)=>n+statSync(p).size,0),sharedFontBytes:fonts.reduce((n,p)=>n+statSync(p).size,0),searchIndexes:indexes.map((p)=>({file:p.slice(join(root,'dist').length+1).replaceAll('\\','/'),bytes:statSync(p).size})),privatePreviewOutput:output,validation:['i18n:validate','build','validate:content','validate:registry','audit:build','site:doctor']};
  } catch (error) {report.status='FAIL';report.problems.push(error.message);process.exitCode=1;}
  finally {removeSiteFixture(root);}
}
if (args.includes('--report')) write(resolve(flag('report')),report);
console.log(JSON.stringify(report,null,2));
