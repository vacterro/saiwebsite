/** File deltas are narrowed by stable content hashes; uncertainty falls back to all gates. */
import { readFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { blockHash } from '../blocks/blocks.mjs';
import { parseDocument } from '../i18n/segments.mjs';
import { impact } from '../graph/graph.mjs';

export const FULL_GATES=['check','lint','build','validate:themes','validate:canonical','validate:content','validate:registry','validate:baselines','validate:licenses','audit:build','site:doctor','i18n:validate','test:engine','test:runtime','test:shell','test:content','test:support','test:i18n','test:pixel','test:visual'];
export function affectedFiles(engine,files,readBefore) {
  const starts=new Set(),unknown=[];
  const add=(node,file)=>{if(engine.graph.nodes.has(node))starts.add(node);else unknown.push(file);};
  const changed=(before,after,key)=>[...new Set([...Object.keys(before),...Object.keys(after)])].filter((id)=>!before[id]||!after[id]||key(before[id])!==key(after[id]));
  for(const file of files) {
    if(file.startsWith('.saipen/'))continue;
    if(/^(README\.md|OPERATOR\.md|CONTRIBUTING\.md|reports\/|roadmap\/|src\/content-engine\/.*\.md$)/.test(file))continue;
    const path=join(engine.root,file);
    if(!existsSync(path)){unknown.push(file);continue;}
    const before=readBefore(file),after=readFileSync(path,'utf8');
    try {
      const doc=/^src\/content\/docs\/(.+)\.md$/.exec(file),catalog=/^src\/content-engine\/blocks\/(.+)\.json$/.exec(file),unit=/^src\/locales\/([^/]+)\/(.+)\.json$/.exec(file);
      if(doc) {
        const old=before?parseDocument({raw:before,slug:doc[1]}).segments:[],now=parseDocument({raw:after,slug:doc[1]}).segments;
        const map=(ss)=>Object.fromEntries(ss.map((s)=>[s.id,s]));
        for(const id of changed(map(old),map(now),(s)=>s.hash))add(`segment:${id}`,file);
        if(before && JSON.stringify(parseDocument({raw:before,slug:doc[1]}).frontmatter)!==JSON.stringify(parseDocument({raw:after,slug:doc[1]}).frontmatter))add(`page:docs.${doc[1].replaceAll('/','.')}`,file);
      } else if(catalog) {
        for(const id of changed(before?JSON.parse(before).blocks:{},JSON.parse(after).blocks,blockHash)) add(`block:${id}`,file);
      } else if(unit) {
        for(const id of changed(before?JSON.parse(before).units:{},JSON.parse(after).units,(u)=>JSON.stringify(u)))add(`unit:${unit[1]}:${id}`,file);
      } else if(/^src\/content-engine\/compositions\/[^/]+\.json$/.test(file))add(`page:${JSON.parse(after).page}`,file);
      else if(/^src\/content-engine\/(manifests|inventory)\//.test(file))continue;
      else {
        const sources=engine.sourcesDoc.sources.filter((s)=>s.paths.some((p)=>file===p||file.startsWith(`${p}/`)));
        if(!sources.length){unknown.push(file);continue;}
        for(const source of sources) {
          if(source.adapter==='canonical-reference') {
            const path=source.canonicalLocation.split('/blob/main/')[1];
            if(before && JSON.parse(before).files?.[path]?.sha256===JSON.parse(after).files?.[path]?.sha256)continue;
          } else if(source.adapter==='ecosystem'&&before) {
            const a=JSON.parse(before),b=JSON.parse(after);delete a.snapshot.date;delete b.snapshot.date;if(JSON.stringify(a)===JSON.stringify(b))continue;
          } else if(file==='src/data/canonical/meta.json'&&before) {
            const a=JSON.parse(before),b=JSON.parse(after);delete a.commitDate;delete b.commitDate;if(JSON.stringify(a)===JSON.stringify(b))continue;
          }
          if(['site.identity','site.package','site.fonts','wintage.theme-packs','saipen.protocol.meta'].includes(source.id))unknown.push(file);
          add(`source:${source.id}`,file);
        }
      }
    } catch {unknown.push(file);}
  }
  const gates=new Set(['check','build','audit:build','validate:content','validate:registry','site:doctor','i18n:validate','test:engine']),pages=new Set();
  for(const start of starts){const r=impact(engine.graph,start);r.gates.forEach((g)=>gates.add(g));r.pages.forEach((p)=>pages.add(p));if(start.startsWith('page:'))pages.add(start.slice(5));}
  return {files:files.length,starts:[...starts].sort(),pages:[...pages].sort(),gates:unknown.length?FULL_GATES:[...gates].sort(),commands:unknown.length?[...FULL_GATES.map((g)=>`npm run ${g}`),'npm test']:[...gates].sort().map((g)=>`npm run ${g}`),fullSuiteBecause:[...new Set(unknown)].sort()};
}
