/** Publication eligibility is separate from renderable draft coverage. */
import { uncoveredScripts } from './i18n.mjs';
import { blockHash } from '../blocks/blocks.mjs';
import { compositionBlocks, visibleSections } from '../compositions/compositions.mjs';

export function pageIsApproved(store, registry, route, locale) {
  if (locale===store.localesDoc.canonical) return true;
  const l=store.localesDoc.locales.find((x)=>x.id===locale);
  if (!l?.enabled || l.stage==='pseudo' || l.publication==='internal') return false;
  const slug=/^\/docs\/(.+)\/$/.exec(route)?.[1];
  const pageId=registry.pages.find((p)=>p.route===route)?.id ?? (slug?`docs.${slug.replaceAll('/','.')}`:'');
  const ids=pageBlockIds(store,pageId);
  for (const id of ids) {
    const unit=store.units[locale]?.[id];
    if (!unit || unit.status!=='CURRENT' || unit.sourceHash!==blockHash(store.blocks[id]) || !independentReview(unit)) return false;
  }
  if (slug) for (const segment of store.docs[slug]?.segments ?? []) {
    const entry=store.docUnits[locale]?.[slug];
    const unit=(entry?.doc?.units ?? entry?.units)?.[segment.id];
    if (!unit || unit.status!=='CURRENT' || unit.sourceHash!==segment.hash || !independentReview(unit)) return false;
  }
  return true;
}

export function independentReview(unit) {
  return typeof unit?.author==='string' && Boolean(unit.author.trim()) && typeof unit?.reviewer==='string' && Boolean(unit.reviewer.trim()) && unit.author.trim().toLowerCase()!==unit.reviewer.trim().toLowerCase();
}

/** Localization eligibility follows visible sections; native views keep their metadata explicit. */
export function pageBlockIds(store,pageId) {
  const docs=(store.compositions ?? []).filter((d)=>d.page===pageId);
  const full=docs.find((d)=>['page','slots'].includes(d.mode ?? 'page'));
  const refs=new Set(docs.flatMap((d)=>compositionBlocks({...d,sections:visibleSections(d).filter((s)=>s.localizable!==false)})));
  const used=(selector)=>selector==='all-html' || selector===`page:${pageId}` || selector.endsWith('.*')&&`page:${pageId}`.startsWith(selector.slice(0,-1));
  for (const [id,block] of Object.entries(store.blocks)) if (block.usedBy.some(used) && (!full || refs.has(id) || block.usedBy.includes('all-html'))) refs.add(id);
  return [...refs];
}

export function localeReadiness(store, coverage, locale, rows) {
  const l=store.localesDoc.locales.find((x)=>x.id===locale);
  const required=rows.filter((r)=>r.locale===locale && !r.outOfScope && r.status!=='ORPHANED');
  const canonical=locale===store.localesDoc.canonical;
  const requiredCount=canonical?Object.keys(store.blocks).length+Object.values(store.docs).reduce((n,d)=>n+d.segments.length,0):required.length;
  const rendered=canonical?requiredCount:required.filter((r)=>l.renderStatuses.includes(r.status)).length;
  const approved=canonical?requiredCount:required.filter((r)=>r.status==='CURRENT' && independentReview(r.unit)).length;
  const fontGaps=coverage?[...uncoveredScripts(l,coverage).map((s)=>`SCRIPT:${s}`),...[...new Set([...l.nativeName].filter((c)=>!coverage.has(c.codePointAt(0)) && !/\s/.test(c)))].map((c)=>`U+${c.codePointAt(0).toString(16).toUpperCase()}`)]:['COVERAGE_UNAVAILABLE'];
  const blockers=[...(['planned','deprecated'].includes(l.stage)?['LOCALE_ROLLOUT_NOT_APPROVED']:[]),...(fontGaps.length?['BLOCKED_FOR_FONT']:[]),...(canonical||l.stage==='pseudo'?[]:required.filter((r)=>['MISSING','STALE'].includes(r.status)).length?['TRANSLATION_INCOMPLETE']:[]),...(canonical||l.stage==='pseudo'?[]:approved<required.length?['INDEPENDENT_REVIEW_REQUIRED']:[])];
  return {locale,configured:true,enabled:l.enabled,publication:l.publication ?? (l.stage==='pseudo'?'internal':'public'),stage:l.stage,requiredUnits:requiredCount,renderedUnits:rendered,approvedUnits:approved,completion:canonical||!required.length?100:Math.round(rendered/required.length*1000)/10,publicationCompletion:canonical||!required.length?100:Math.round(approved/required.length*1000)/10,fontGaps,blockers,productionReady:canonical||l.stage!=='pseudo'&&!blockers.length};
}
