import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { impact } from '../../src/content-engine/graph/graph.mjs';
import { writeTransaction, withMutationLock } from '../../src/content-engine/operations/files.mjs';
import { discoverSaipen, invokeSaipen } from './saipen.mjs';

export function driftReport(engine) {
  const changed=engine.sourceStates.filter((s)=>['STALE','NEW','REMOVED'].includes(s.state));
  const publicLocales=new Set(engine.store?.localesDoc.locales.filter((l)=>l.enabled&&l.stage!=='pseudo'&&l.publication!=='internal').map((l)=>l.id) ?? []);
  const work=engine.unitReport.filter((r)=>publicLocales.has(r.locale)&&['STALE','MISSING','ORPHANED'].includes(r.status));
  const facts={sources:changed.map((s)=>({id:s.id,state:s.state,sha256:s.now?.sha256 ?? 'REMOVED'})),units:work.map((r)=>({locale:r.locale,id:r.id,status:r.status,sourceHash:r.sourceHash ?? null})).sort((a,b)=>`${a.locale}:${a.id}`.localeCompare(`${b.locale}:${b.id}`))};
  const identity=createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0,16);
  return {schemaVersion:1,meaningful:changed.length>0||work.length>0,identity,marker:`site-drift:${identity}`,sources:changed.map((s)=>({...s,...impact(engine.graph,`source:${s.id}`)})),translationWork:facts.units,verification:'npm run site:doctor ends HEALTHY; npm run build and npm test pass',publication:'REPORT_ONLY'};
}

export function intakeDrift(report,{root=process.cwd(),discovery=discoverSaipen({root}),invoke=invokeSaipen,dryRun=false}={}) {
  if (!report.meaningful) return {status:'NO_DRIFT',ticket:null};
  const board=join(root,'.saipen/BOARD.md');
  const match=existsSync(board)?readFileSync(board,'utf8').split(/\r?\n/).find((line)=>line.includes(`[${report.marker}]`)):null;
  if (match) return {status:'ALREADY_TRACKED',ticket:/T-\d+/.exec(match)?.[0] ?? null,identity:report.identity};
  if (dryRun) return {status:'PREVIEW',identity:report.identity,command:['ticket','add','P2',`Website source drift [${report.marker}]`,'--verify',report.verification]};
  return withMutationLock(root,()=>{
    const path=`reports/drift/${report.identity}.json`;
    writeTransaction(root,{[path]:JSON.stringify(report,null,2)+'\n'});
    if (!discovery.available||!discovery.executionCapable) return {status:'SAIPEN_CLI_UNAVAILABLE',report:path,discovery};
    const result=invoke(['ticket','add','P2',`Website source drift [${report.marker}]`,'--verify',`${report.verification}; source details: ${path}`],{root,discovery});
    if (result.status!==0) return {status:'INTAKE_REFUSED',report:path,exitCode:result.status,detail:result.stderr||result.stdout};
    return {status:'INTAKEN',report:path,output:result.stdout.trim(),identity:report.identity};
  });
}
