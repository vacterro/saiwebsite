/** Upstream refreshes run in an isolated staging directory, then commit validated snapshots. */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { listFiles } from '../sources/lock.mjs';
import { validateCanonicalSnapshot } from '../sources/canonical.mjs';
import { withinRoot, withMutationLock, writeTransaction } from '../operations/files.mjs';

export const DRIFT = ['NO_CHANGE', 'SOURCE_CHANGED_COMPATIBLE', 'SOURCE_CHANGED_SCHEMA', 'SOURCE_UNAVAILABLE', 'SNAPSHOT_INVALID'];
const safeURL = (value) => typeof value === 'string' && /^https:\/\/(?:github\.com|api\.github\.com)\//.test(value);

export function validateEcosystemSnapshot(doc, editorial) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || !doc.snapshot || !doc.repos || Array.isArray(doc.repos)) return ['[ecosystem-schema] expected snapshot and repos objects'];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.snapshot.date ?? '') || typeof doc.snapshot.source !== 'string') problems.push('[ecosystem-schema] missing freshness/provenance');
  const names = [...editorial.matchAll(/repo: gh\('([^']+)'\)/g)].map((m) => m[1]);
  for (const name of names) {
    const repo = doc.repos[name];
    if (!repo || !safeURL(repo.url) || typeof repo.description !== 'string' || typeof repo.language !== 'string') { problems.push(`[ecosystem-schema] ${name}: missing or malformed repository metadata`); continue; }
    const release = repo.release;
    if (release !== null && (!release || typeof release.tag !== 'string' || !safeURL(release.url) || !Array.isArray(release.assets))) { problems.push(`[ecosystem-schema] ${name}: malformed release`); continue; }
    for (const asset of release?.assets ?? []) if (typeof asset.name !== 'string' || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0 || !safeURL(asset.url) || (asset.sha256 !== null && !/^[0-9a-f]{64}$/.test(asset.sha256 ?? ''))) problems.push(`[ecosystem-schema] ${name}: malformed asset metadata`);
  }
  for (const block of editorial.split(/\n  \{\n/).slice(1)) {
    const name = /repo: gh\('([^']+)'\)/.exec(block)?.[1];
    const assets = /assets: \{([^}]*)\}/.exec(block)?.[1] ?? '';
    for (const m of assets.matchAll(/'([^']+)':/g)) if (!(doc.repos[name]?.release?.assets ?? []).some((a) => a.name === m[1])) problems.push(`[ecosystem-asset] ${name}: listed asset ${m[1]} is missing`);
  }
  return problems;
}

/** Only declared volatile fields are ignored; new facts and provenance are retained. */
export function snapshotFacts(adapter, files) {
  const parsed = Object.fromEntries(Object.entries(files).map(([p, text]) => [p, JSON.parse(text)]));
  if (adapter === 'ecosystem') delete parsed['src/data/ecosystem.snapshot.json']?.snapshot?.date;
  if (adapter === 'canonical') delete parsed['src/data/canonical/meta.json']?.commitDate;
  return JSON.stringify(parsed);
}

function read(root, paths) {
  const out = {};
  const prefix = resolve(root).replaceAll('\\', '/') + '/';
  for (const path of paths) {
    if (!existsSync(withinRoot(root, path))) throw new Error(`[source-missing] ${path}`);
    for (const file of listFiles(withinRoot(root, path))) out[file.replaceAll('\\', '/').slice(prefix.length)] = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  }
  return out;
}

const topKeys = (text) => Object.keys(JSON.parse(text)).sort().join(',');

/** runner(command, { stagingRoot, root, env }) is injectable for independent failure controls. */
export function syncSources({ sourcesDoc, only = [], dryRun = false, root = '.', runner }) {
  const perform = () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    const upstream = sourcesDoc.sources.filter((s) => s.authority === 'upstream' && s.refresh);
    const wanted = new Set(upstream.filter((s) => !only.length || only.includes(s.id)).map((s) => s.refresh));
    const groups = new Map();
    for (const s of upstream) if (wanted.has(s.refresh)) groups.set(s.refresh, [...(groups.get(s.refresh) ?? []), s]);
    const results = [];
    for (const [command, sources] of groups) {
      const paths = [...new Set(sources.flatMap((s) => s.paths))];
      if (sources[0].adapter === 'canonical' && !paths.includes('src/data/canonical/meta.json')) paths.push('src/data/canonical/meta.json');
      const base = { command, sources: sources.map((s) => s.id), changedFiles: [] };
      let stagingRoot;
      try {
        const before = read(root, paths);
        stagingRoot = mkdtempSync(join(tmpdir(), 'sai-site-sync-'));
        for (const [path, text] of Object.entries(before)) {
          const target = withinRoot(stagingRoot, path);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, text);
        }
        const env = { ...process.env, SAI_SYNC_STAGING_ROOT: stagingRoot, SAI_CANONICAL_OUT: join(stagingRoot, 'src/data/canonical'), SAI_ECOSYSTEM_OUT: join(stagingRoot, 'src/data/ecosystem.snapshot.json') };
        const script = /^node (scripts\/[a-z0-9-]+\.mjs)$/.exec(pkg.scripts[command.replace(/^npm run /, '')] ?? '');
        if (!script && !runner) throw new Error(`[sync-command] ${command} is not a supported Node sync script`);
        const ran = runner ? runner(command, { stagingRoot, root, env }) : (() => {
          const r = spawnSync(process.execPath, [resolve(root, script[1])], { cwd: resolve(root), env, encoding: 'utf8', timeout: 180_000 });
          return { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error?.message ?? ''}` };
        })();
        if (ran.status !== 0) { results.push({ ...base, drift: 'SOURCE_UNAVAILABLE', detail: ran.output.trim().split('\n').slice(-2).join(' '), kept: 'previous snapshot' }); continue; }
        const after = read(stagingRoot, paths);
        const problems = sources[0].adapter === 'canonical' ? validateCanonicalSnapshot(join(stagingRoot, 'src/data/canonical'))
          : sources[0].adapter === 'ecosystem' ? validateEcosystemSnapshot(JSON.parse(after['src/data/ecosystem.snapshot.json']), readFileSync(join(root, 'src/data/ecosystem.ts'), 'utf8'))
          : ['[sync-adapter] no snapshot validator'];
        for(const source of sources.filter((s)=>s.adapter==='canonical-reference')) {
          const path=source.canonicalLocation.split('/blob/main/')[1];
          if(!/^[0-9a-f]{64}$/.test(JSON.parse(after[source.paths[0]]).files?.[path]?.sha256 ?? ''))problems.push(`[canonical-reference] missing pinned identity ${path}`);
        }
        if (problems.length) { results.push({ ...base, drift: 'SNAPSHOT_INVALID', detail: problems.join('; '), kept: 'previous snapshot' }); continue; }
        const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
        if (!changed.length || snapshotFacts(sources[0].adapter, before) === snapshotFacts(sources[0].adapter, after)) { results.push({ ...base, drift: 'NO_CHANGE', kept: 'previous snapshot (no churn)' }); continue; }
        const schemaChanged = changed.some((p) => topKeys(before[p]) !== topKeys(after[p]));
        if (JSON.stringify(read(root,paths))!==JSON.stringify(before)) throw new Error('[source-concurrent-change] live snapshots changed during synchronization; staged output was not committed');
        if (!dryRun && !schemaChanged) writeTransaction(root, Object.fromEntries(changed.map((p) => [p, after[p]])));
        const changedSources=sources.filter((s)=>{
          if(s.adapter!=='canonical-reference') return s.paths.some((p)=>changed.includes(p));
          const path=s.canonicalLocation.split('/blob/main/')[1],file=s.paths[0];
          return JSON.parse(before[file]).files?.[path]?.sha256!==JSON.parse(after[file]).files?.[path]?.sha256;
        }).map((s)=>s.id);
        results.push({ ...base, changedFiles: changed, changedSources, provenanceOnly: sources[0].adapter === 'canonical' && changed.every((p) => ['src/data/canonical/meta.json','src/data/canonical/documentation.json'].includes(p)) && changedSources.every((id)=>id==='saipen.protocol.meta'), drift: schemaChanged ? 'SOURCE_CHANGED_SCHEMA' : 'SOURCE_CHANGED_COMPATIBLE', kept: schemaChanged ? 'previous snapshot (schema changed: review first)' : dryRun ? 'previous snapshot (dry run)' : 'new snapshot; source lock still requires review' });
      } catch (error) {
        results.push({ ...base, drift: 'SNAPSHOT_INVALID', detail: error.message, kept: 'previous snapshot' });
      } finally {
        if (stagingRoot) rmSync(stagingRoot, { recursive: true });
      }
    }
    return results;
  };
  // A dry run writes only to a newly created OS temporary directory.
  if (dryRun) {
    if (existsSync(join(root, '.site-work/operation.lock'))) throw new Error('[operation-busy] sync dry run refused during another mutation');
    return perform();
  }
  return withMutationLock(root, perform);
}

export const snapshotExists = (source) => source.paths.every((p) => existsSync(p));
