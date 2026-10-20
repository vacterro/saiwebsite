/** Proposed registries and measured fixtures share the live locale/store contracts. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { blockHash } from '../blocks/blocks.mjs';
import { loadStore, requiredUnits, unitReport } from './store.mjs';
import { loadCoverage } from './engine-ext.mjs';
import { uncoveredScripts, validateLocales } from './i18n.mjs';
import { localeReadiness } from './readiness.mjs';

export const PROPOSAL='src/content-engine/i18n/locale-expansion.proposed.json';
export function proposedRegistry(root='.') {
  const existing=JSON.parse(readFileSync(join(root,'src/content-engine/i18n/locales.json'),'utf8'));
  const proposal=JSON.parse(readFileSync(join(root,PROPOSAL),'utf8'));
  const locales=proposal.locales.map((p)=>existing.locales.find((l)=>l.id===p.id) ?? {id:p.id,displayName:p.displayName,nativeName:p.nativeName,stage:'planned',enabled:false,fallback:existing.canonical,direction:p.direction,scripts:p.scripts,searchEnabled:true,llmsEnabled:true,renderStatuses:['CURRENT'],scope:'pilot',publication:'public'});
  return {proposal,localesDoc:{...existing,locales:[...locales,...existing.locales.filter((l)=>l.stage==='pseudo')]}};
}

/**
 * M51 acceptance surface (mechanical clauses): per-locale completion / current
 * / stale statistics for every entry of the ENGINEERING registry, i.e. the
 * non-frozen proposal in locale-expansion.proposed.json. This exists so the
 * roadmap M51 clauses ("all 33 are registry entries", "each locale exposes
 * completion/current/stale statistics", "missing translations never silently
 * masquerade as translated content") are demonstrable WITHOUT enabling any
 * locale and WITHOUT writing the 33 into the production public registry -- M51
 * itself says "Do not freeze the exact 33-language list until the operator
 * chooses it". A locale is a registry entry here because the proposal declares
 * it; locales.json is not touched. The operator's production selection stays a
 * separate release gate (T-44 / T-45's own blocker).
 */
export function localeStatistics(store, coverage, rows = unitReport(store)) {
  const out = [];
  for (const l of store.localesDoc.locales) {
    if (l.id === store.localesDoc.canonical || l.stage === 'pseudo') continue;
    const mine = rows.filter((r) => r.locale === l.id && !r.outOfScope);
    const counts = {};
    for (const r of mine) counts[r.status] = (counts[r.status] ?? 0) + 1;
    const readiness = localeReadiness(store, coverage, l.id, rows);
    out.push({
      locale: l.id,
      stage: l.stage,
      enabled: l.enabled,
      registryEntry: true,
      requiredUnits: readiness.requiredUnits,
      renderedUnits: readiness.renderedUnits,
      approvedUnits: readiness.approvedUnits,
      completion: readiness.completion,
      publicationCompletion: readiness.publicationCompletion,
      counts: {
        CURRENT: counts.CURRENT ?? 0,
        REVIEWED: counts.REVIEWED ?? 0,
        MACHINE_DRAFT: counts.MACHINE_DRAFT ?? 0,
        STALE: counts.STALE ?? 0,
        MISSING: counts.MISSING ?? 0,
        ORPHANED: counts.ORPHANED ?? 0,
      },
      blockers: readiness.blockers,
      productionReady: readiness.productionReady,
    });
  }
  return out;
}

/** M51 red-control gate: the statistics surface must be complete AND must not
 *  let a MISSING unit masquerade as renderable content. Returns problems. */
export function statisticsProblems(statistics, proposal, canonical) {
  const problems = [];
  const ids = new Set(statistics.map((s) => s.locale));
  for (const p of proposal.locales) {
    if (p.id === canonical) continue;
    if (!ids.has(p.id)) problems.push(`[m51-statistics] proposed locale ${p.id} is not a registry entry with statistics`);
  }
  for (const s of statistics) {
    for (const key of ['completion', 'publicationCompletion']) {
      if (typeof s[key] !== 'number' || Number.isNaN(s[key])) problems.push(`[m51-statistics] locale ${s.locale} exposes no ${key} statistic`);
    }
    for (const key of ['CURRENT', 'STALE', 'MISSING']) {
      if (typeof s.counts[key] !== 'number') problems.push(`[m51-statistics] locale ${s.locale} exposes no ${key} statistic`);
    }
    // Anti-masquerade: a unit that is MISSING must never count toward rendered
    // coverage, so completion can never exceed rendered/required.
    const renderable = s.counts.CURRENT + s.counts.REVIEWED + s.counts.MACHINE_DRAFT;
    if (s.requiredUnits > 0 && s.completion > Math.round((renderable / s.requiredUnits) * 1000) / 10 + 1e-9)
      problems.push(`[m51-statistics] locale ${s.locale} completion ${s.completion} exceeds renderable share; a MISSING unit masqueraded as translated`);
  }
  return problems;
}

export function measureScalePlan(root='.') {
  const registry=JSON.parse(readFileSync(join(root,'src/content-engine/registry/pages.json'),'utf8'));
  const sourceIds=JSON.parse(readFileSync(join(root,'src/content-engine/registry/sources.json'),'utf8')).sources.map((s)=>s.id);
  const {proposal,localesDoc}=proposedRegistry(root);
  const problems=validateLocales(localesDoc);
  const coverage=loadCoverage(root);
  const started=performance.now();
  const store=loadStore({root,registry,sourceIds,overrides:{localesDoc}});
  problems.push(...store.problems);
  const rows=unitReport(store);
  const loadMilliseconds=performance.now()-started;
  // More than the proposal's count: a private-use fixture tag proves there is no 33 ceiling.
  const larger=structuredClone(localesDoc);
  larger.locales.push({...larger.locales.find((l)=>l.stage==='planned'),id:'qaa',displayName:'Capacity control',nativeName:'Capacity control'});
  problems.push(...validateLocales(larger));
  const matrix=proposal.locales.map((p)=>{
    const gaps=[...new Set([...`${p.nativeName} ${p.sample}`.normalize('NFC')].filter((c)=>!coverage?.has(c.codePointAt(0))&&!/\s/.test(c)))];
    const scripts=coverage?uncoveredScripts(p,coverage):p.scripts;
    return {locale:p.id,scripts:p.scripts,direction:p.direction,scriptGaps:scripts,glyphGaps:gaps.map((c)=>`U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')}`),fontReadiness:gaps.length||scripts.length?'BLOCKED_FOR_FONT':'SAMPLE_COVERED_NOT_FULL_TRANSLATION_PROOF'};
  });
  const pilot=requiredUnits(store,'et');
  const pilotSegments=pilot.docSlugs.flatMap((slug)=>store.docs[slug].segments);
  const pilotUnits=pilot.blockIds.length+pilotSegments.length;
  const allUnits=Object.keys(store.blocks).length+Object.values(store.docs).reduce((n,d)=>n+d.segments.length,0);
  const staleStore=loadStore({root,registry,sourceIds,overrides:{localesDoc}});
  const changed='home.hero.lead', keep='home.action.start';
  for (const l of staleStore.localesDoc.locales.filter((l)=>l.id!==localesDoc.canonical&&l.stage!=='pseudo')) staleStore.units[l.id]={[changed]:{text:staleStore.blocks[changed].text,sourceHash:blockHash(staleStore.blocks[changed]),status:'MACHINE_DRAFT'},[keep]:{text:staleStore.blocks[keep].text,sourceHash:blockHash(staleStore.blocks[keep]),status:'MACHINE_DRAFT'}};
  staleStore.blocks[changed]={...staleStore.blocks[changed],text:staleStore.blocks[changed].text+' Scale control.'};
  const start=performance.now(), deltaRows=unitReport(staleStore);
  const invalidationMilliseconds=performance.now()-start;
  const natural=localesDoc.locales.filter((l)=>l.stage!=='pseudo');
  const stale=deltaRows.filter((r)=>r.id===changed&&r.status==='STALE');
  const untouched=deltaRows.filter((r)=>r.id===keep&&r.status==='MACHINE_DRAFT');
  if (stale.length!==natural.length-1 || untouched.length!==natural.length-1) problems.push('[scale-invalidation] one changed block must stale exactly one unit per noncanonical locale and leave its neighbor intact');
  // M51 mechanical acceptance, demonstrated over the engineering registry.
  const statistics=localeStatistics(store,coverage,rows);
  problems.push(...statisticsProblems(statistics,proposal,localesDoc.canonical));
  return {status:problems.length?'FAIL':'PASS',purpose:proposal.status,productionRegistryChanged:false,proposedNaturalLocales:natural.length,capacityControlNaturalLocales:natural.length+1,stressFixture:proposal.stressFixture,configuredUnits:rows.length,pilotUnitsPerLocale:pilotUnits,fullUnitsPerLocale:allUnits,sourceWordsPerPilot:([...pilot.blockIds.map((id)=>store.blocks[id].text),...pilotSegments.map((s)=>s.text)].join(' ').match(/\S+/g)??[]).length,estimatedPilotTranslationUnits:(natural.length-1)*pilotUnits,estimatedFullTranslationUnits:(natural.length-1)*allUnits,m51:{statistics,operatorSelected:false,operatorSelectionNote:'this is the engineering registry, not the operator production language set; M51 forbids freezing the list before the operator chooses'},perLocaleMaintenance:{initialDraftUnits:pilotUnits,independentReviewUnits:pilotUnits,oneChangedParagraph:1,sharedFontBytesIncrement:0,reviewHoursPlanningRange:[Math.round(pilotUnits/120*100)/100,Math.round(pilotUnits/60*100)/100],reviewRateAssumption:'60 to 120 bounded units/hour; planning assumption, not measured reviewer work',monetaryCost:'provider/reviewer rate not selected; no service or expenditure committed',reviewApproval:'REQUIRED; not estimated as performed'},operatorDecisions:['Approve the actual production 10- and 33-language sets; proposal and stress fixture are not that approval','Assign real independent ET/RU reviewers and approve publication only after their review','Approve source/licence/native-size/budget/shaping contracts for selected uncovered scripts','Choose hosting and authorize publication; DNS/monitoring/analytics are separate gates'],metrics:{loadMilliseconds:Math.round(loadMilliseconds*100)/100,invalidationMilliseconds:Math.round(invalidationMilliseconds*100)/100,staleUnits:stale.length,unaffectedNeighborUnits:untouched.length},matrix,problems};
}
