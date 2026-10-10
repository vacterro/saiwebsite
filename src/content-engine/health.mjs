/** One derived diagnostic contract for the CLI and build-time dashboard. */
import { manifestStates } from './engine.mjs';
import { impact } from './graph/graph.mjs';
import { loadCoverage } from './i18n/engine-ext.mjs';
import { localeReadiness } from './i18n/readiness.mjs';

export function healthReport(engine, controls=[]) {
  const manifests=manifestStates(engine), upstream=new Set(engine.sourcesDoc.sources.filter((s)=>s.authority==='upstream').map((s)=>s.id));
  const sources=engine.sourceStates.map((s)=>({ ...s, identity:s.now ?? engine.lock.sources[s.id] ?? null,
    reviewToken:upstream.has(s.id)&&['NEW','STALE','REMOVED'].includes(s.state)?`${s.id}@${s.now?.sha256 ?? 'REMOVED'}`:null,
    impact:['NEW','STALE','REMOVED','PROVENANCE'].includes(s.state)?impact(engine.graph,`source:${s.id}`):null,
    freshness:'LOCAL_VERIFIED_SNAPSHOT; remote freshness requires site:sync --dry-run',
  }));
  const counts={}; for (const s of sources) counts[s.state]=(counts[s.state]??0)+1;
  const broken=[...engine.contracts,...engine.integrity,...engine.cycles.map((c)=>`[cycle] ${c}`),...manifests.filter((m)=>m.state==='MISSING').map((m)=>`[manifest-missing] ${m.path}: run npm run site:refresh`),...controls.filter((c)=>!c.fired).map((c)=>`[blind-gate] ${c.name}`)];
  const stale=[...sources.filter((s)=>['STALE','NEW','REMOVED'].includes(s.state)).map((s)=>`[source-${s.state.toLowerCase()}] ${s.id}: inspect site:impact and source diff${s.reviewToken?`; exact acknowledgement: --accept-source ${s.reviewToken}`:''}`),...manifests.filter((m)=>m.state==='STALE').map((m)=>`[manifest-stale] ${m.path}: build, then site:refresh`)];
  const locales=engine.store?engine.store.localesDoc.locales.map((l)=>localeReadiness(engine.store,loadCoverage(engine.root),l.id,engine.unitReport)):[];
  const actions=[...sources.filter((s)=>s.impact).map((s)=>({reason:s.state,source:s.id,command:`npm run site:impact -- ${s.id}`,pages:s.impact.pages,gates:s.impact.gates})),...locales.filter((l)=>l.blockers.length).map((l)=>({reason:l.blockers.join(', '),locale:l.locale,command:`npm run i18n:review -- --locale ${l.locale}`})),...(manifests.some((m)=>m.state!=='CURRENT')?[{reason:'GENERATED_MANIFEST_DRIFT',command:'npm run site:prepare; upstream identity acknowledgement requires prior review'}]:[])];
  return {status:broken.length?'BROKEN':stale.length?'STALE':'HEALTHY',sources:{counts:{...counts,FAILED:broken.filter((p)=>p.startsWith('[source-failed]')).length},states:sources},content:{dist:engine.hasDist,pages:engine.inventory?.totals.routes ?? 'UNKNOWN',blocks:engine.blockSummary,pagesByMaturity:engine.records.reduce((a,r)=>{a[r.maturity]=(a[r.maturity]??0)+1;return a;},{})},translations:engine.translationSummary,locales,derived:{manifests,generatedArtifacts:engine.generatedDoc.artifacts.length,integrityProblems:engine.integrity.length},redControls:controls,broken,stale,translationWork:engine.translations.filter((t)=>t.severity==='work').map((t)=>t.message),actions};
}
