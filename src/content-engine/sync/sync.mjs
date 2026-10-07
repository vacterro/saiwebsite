/**
 * Site sync engine (content-system roadmap M40). Node only; network only when
 * the operator runs it.
 *
 * One controlled path for every upstream-backed source. For each source group
 * (sources that share a refresh command):
 *   1. back up the current snapshot files;
 *   2. run the source's existing sync tool (canonical:sync, ecosystem:sync) —
 *      wrapped, not replaced;
 *   3. validate the new snapshot; on failure restore the backup (failure
 *      policy keep-last-valid) and report SNAPSHOT_INVALID or
 *      SOURCE_UNAVAILABLE;
 *   4. drop pure churn (a new date with identical facts) by restoring the
 *      backup, so an unchanged upstream produces no file change;
 *   5. classify the drift and compute the impact of each changed source;
 *   6. --dry-run restores the backup after reporting; otherwise the new
 *      snapshot stays and the caller refreshes the manifests.
 * Editorial text is never written by sync.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { listFiles } from '../sources/lock.mjs';

export const DRIFT = ['NO_CHANGE', 'SOURCE_CHANGED_COMPATIBLE', 'SOURCE_CHANGED_SCHEMA', 'SOURCE_UNAVAILABLE', 'SNAPSHOT_INVALID'];

/** Validation of a freshly synced snapshot, per adapter. Returns problem strings. */
const VALIDATORS = {
  canonical() {
    const run = spawnSync(process.execPath, ['scripts/validate-canonical.mjs'], { encoding: 'utf8' });
    return run.status === 0 ? [] : [`validate:canonical failed: ${(run.stdout + run.stderr).trim().split('\n').slice(-2).join(' ')}`];
  },
  ecosystem() {
    const problems = [];
    let snap;
    try {
      snap = JSON.parse(readFileSync('src/data/ecosystem.snapshot.json', 'utf8'));
    } catch (error) {
      return [`ecosystem snapshot is not JSON: ${error.message}`];
    }
    const editorial = readFileSync('src/data/ecosystem.ts', 'utf8');
    const projects = editorial.split(/\n  \{\n/).slice(1);
    for (const block of projects) {
      const repo = /repo: gh\('([^']+)'\)/.exec(block)?.[1];
      if (!repo) continue;
      if (!snap.repos?.[repo]) {
        problems.push(`curated project ${repo} is missing from the snapshot`);
        continue;
      }
      const listed = /assets: \{([^}]*)\}/.exec(block)?.[1] ?? '';
      for (const m of listed.matchAll(/'([^']+)':/g)) {
        if (!(snap.repos[repo].release?.assets ?? []).some((a) => a.name === m[1])) problems.push(`${repo}: listed asset ${m[1]} is not in the latest release any more`);
      }
    }
    return problems;
  },
};

/** Facts of a snapshot without its volatile fields, for churn detection. */
const FACTS = {
  ecosystem: (files) => {
    const doc = JSON.parse(files['src/data/ecosystem.snapshot.json']);
    delete doc.snapshot?.date;
    return JSON.stringify(doc);
  },
};

const topKeys = (text) => {
  try {
    const doc = JSON.parse(text);
    return doc && typeof doc === 'object' ? Object.keys(doc).sort().join(',') : '';
  } catch {
    return '';
  }
};

function read(paths) {
  const out = {};
  for (const p of paths.flatMap(listFiles)) out[p] = readFileSync(p, 'utf8');
  return out;
}

function restore(files) {
  for (const [p, text] of Object.entries(files)) writeFileSync(p, text);
}

/**
 * @param {object} o
 * @param {object} o.sourcesDoc
 * @param {string[]} [o.only]       source IDs to sync (default: every upstream source with a refresh command)
 * @param {boolean} [o.dryRun]
 * @param {(cmd: string) => {status: number, output: string}} [o.runner]  injectable for red controls
 */
export function syncSources({ sourcesDoc, only, dryRun = false, runner }) {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const run = runner ?? ((cmd) => {
    const script = pkg.scripts[cmd.replace(/^npm run /, '')];
    const r = spawnSync(script, { shell: true, encoding: 'utf8', env: process.env });
    return { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
  });
  // A sync tool refreshes every source that shares its command, so a group is
  // all of them — backed up and validated together — even when --source names one.
  const upstream = sourcesDoc.sources.filter((s) => s.authority === 'upstream' && s.refresh);
  const wanted = new Set(upstream.filter((s) => !only?.length || only.includes(s.id)).map((s) => s.refresh));
  const groups = new Map();
  for (const s of upstream) if (wanted.has(s.refresh)) groups.set(s.refresh, [...(groups.get(s.refresh) ?? []), s]);

  const results = [];
  for (const [command, sources] of groups) {
    const paths = [...new Set(sources.flatMap((s) => s.paths))];
    // A canonical snapshot is described by meta.json too; back it up with the files.
    if (sources[0].adapter === 'canonical' && !paths.includes('src/data/canonical/meta.json')) paths.push('src/data/canonical/meta.json');
    const before = read(paths);
    const ran = run(command);
    const after = read(paths);
    const changed = Object.keys(after).filter((p) => after[p] !== before[p]);
    const base = { command, sources: sources.map((s) => s.id), changedFiles: changed };

    if (ran.status !== 0) {
      restore(before);
      results.push({ ...base, drift: 'SOURCE_UNAVAILABLE', detail: ran.output.trim().split('\n').slice(-2).join(' '), kept: 'previous snapshot' });
      continue;
    }
    const problems = VALIDATORS[sources[0].adapter]?.() ?? [];
    if (problems.length) {
      restore(before);
      results.push({ ...base, drift: 'SNAPSHOT_INVALID', detail: problems.join('; '), kept: 'previous snapshot' });
      continue;
    }
    const facts = FACTS[sources[0].adapter];
    if (!changed.length || (facts && facts(before) === facts(after))) {
      if (changed.length) restore(before);
      results.push({ ...base, changedFiles: [], drift: 'NO_CHANGE', kept: 'previous snapshot (no churn)' });
      continue;
    }
    // An unexpected shape is never normalized silently: keep the old snapshot
    // and hand the operator the impact instead.
    const schemaChanged = changed.some((p) => p.endsWith('.json') && topKeys(before[p]) !== topKeys(after[p]));
    if (dryRun || schemaChanged) restore(before);
    results.push({ ...base, drift: schemaChanged ? 'SOURCE_CHANGED_SCHEMA' : 'SOURCE_CHANGED_COMPATIBLE', kept: schemaChanged ? 'previous snapshot (schema changed: review first)' : dryRun ? 'previous snapshot (dry run)' : 'new snapshot' });
  }
  return results;
}

export const snapshotExists = (source) => source.paths.every((p) => existsSync(p));
