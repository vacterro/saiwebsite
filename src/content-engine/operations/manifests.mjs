/** Reviewed upstream identities are explicit inputs to manifest refresh. */
import { withMutationLock, writeTransaction } from './files.mjs';

export function planRefresh(engine, { acceptSources = [] } = {}) {
  const broken = [...engine.contracts, ...engine.integrity, ...engine.cycles.map((c)=>`[cycle] ${c}`)];
  if (broken.length) throw new Error(`refresh refused:\n${broken.join('\n')}`);
  const accepted = new Set(acceptSources);
  const upstream = new Set(engine.sourcesDoc.sources.filter((s)=>s.authority==='upstream').map((s)=>s.id));
  const pending = engine.sourceStates.filter((s)=>upstream.has(s.id) && ['NEW','STALE','REMOVED'].includes(s.state));
  const tokens = pending.map((s)=>`${s.id}@${s.now?.sha256 ?? 'REMOVED'}`);
  const refused = tokens.filter((t)=>!accepted.has(t));
  if (refused.length) throw new Error(`[unreviewed-source] inspect site:impact and snapshot diffs, then acknowledge the exact identities with ${refused.map((t)=>`--accept-source ${t}`).join(' ')}; no manifest was written`);
  for (const token of accepted) if (!tokens.includes(token)) throw new Error(`[source-review-mismatch] ${token}: not an exact pending identity; re-run site:doctor --json`);
  return Object.fromEntries(engine.manifests.filter((m)=>m.committed!==m.fresh).map((m)=>[m.path,m.fresh]));
}

export function refreshManifests(load, options = {}, root='.') {
  const perform=()=>{
    const changes=planRefresh(load(),options);
    if (!options.dryRun) writeTransaction(root,changes);
    return { dryRun:Boolean(options.dryRun), changedFiles:Object.keys(changes), changes };
  };
  return options.dryRun?perform():withMutationLock(root,perform);
}
