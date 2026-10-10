/** Canonical references are read from documentation frontmatter, not duplicated in views. */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from '../i18n/segments.mjs';
import { CANONICAL_FILES } from './canonical.mjs';
export const referenceId=(path)=>`saipen.reference.${path.toLowerCase().replace(/\.md$/,'').replace(/[^a-z0-9]+/g,'.')}`;
export function documentReferences(root='.') {
  const refs=new Map();
  const walk=(dir)=>{for(const entry of readdirSync(dir,{withFileTypes:true})) {const file=join(dir,entry.name);if(entry.isDirectory())walk(file);else if(entry.name.endsWith('.md')) {
    const slug=file.slice(join(root,'src/content/docs').length+1).replaceAll('\\','/').replace(/\.md$/,'');
    const parsed=parseDocument({raw:readFileSync(file,'utf8'),slug});
    for(const source of parsed.frontmatter.sources ?? []) {
      if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(source.path)||source.path.split('/').includes('..')) throw new Error(`[canonical-reference] unsafe upstream path ${source.path}`);
      const list=refs.get(source.path) ?? [];if(!list.includes(`docs.${slug.replaceAll('/','.')}`)) list.push(`docs.${slug.replaceAll('/','.')}`);refs.set(source.path,list);
    }
  }}};
  walk(join(root,'src/content/docs'));return new Map([...refs].sort(([a],[b])=>a.localeCompare(b)));
}
export function referenceSources(root='.') {
  const refs=documentReferences(root);
  const registered=JSON.parse(readFileSync(join(root,'src/content-engine/registry/sources.json'),'utf8'));
  for (const source of registered.sources.filter((s)=>s.adapter==='canonical-reference')) {
    const path=source.canonicalLocation.split('/blob/main/')[1];
    if (!path) throw new Error(`[canonical-reference] ${source.id}: expected a canonical main-branch document URL`);
    if (!refs.has(path)) refs.set(path,[]);
  }
  const machine=Object.fromEntries(Object.entries(CANONICAL_FILES).map(([key,path])=>[path,`saipen.protocol.${key==='stateSchema'?'state-schema':key}`]));
  return [...refs].sort(([a],[b])=>a.localeCompare(b)).map(([path,pages])=>({path,pages,id:machine[path] ?? referenceId(path),machine:Boolean(machine[path])}));
}
