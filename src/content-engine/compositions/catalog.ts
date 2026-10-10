/** Build-time discovery projection of the same composition manifests used by the renderer. */
import registry from '../registry/pages.json';
import { SITE } from '../../data/site';
import { sourceUrl } from '../models/protocol';
import { translator } from '../i18n/catalog';
import { sectionBlocks, visibleSections } from './compositions.mjs';
type Doc = Record<string, any>;
const files=import.meta.glob<Doc>('./*.json',{eager:true,import:'default'});

export function compositionVars(doc: Doc): Record<string,string> {
  const site=SITE as unknown as Record<string,string>;
  return Object.fromEntries(Object.entries(doc.bindings ?? {}).map(([name,value])=>{
    const [kind,ref]=String(value).split(/:(.*)/s);
    const resolved=kind==='site'?site[ref]:sourceUrl(ref);
    if (!resolved) throw new Error(`unknown composition binding ${value}`);
    return [name,resolved];
  }));
}

export function compositionEntries(locale='en') {
  const tx=translator(locale);
  const canonical=translator('en');
  return Object.values(files).filter((doc)=>doc.mode!=='slots').map((doc)=>{
    const owner=registry.pages.find((p)=>p.id===doc.page)!;
    const vars=compositionVars(doc);
    const body=visibleSections(doc).flatMap((s:Doc)=>sectionBlocks(s).map((id:string)=>(s.localizable===false?canonical:tx).text(id,vars))).join('\n\n');
    return {id:owner.id,url:tx.href(owner.route),title:doc.title?tx.text(doc.title,vars):owner.label,description:doc.description?tx.text(doc.description,vars):owner.intent,body,searchable:owner.searchable,llmVisible:owner.llmVisible};
  });
}
