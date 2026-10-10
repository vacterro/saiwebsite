#!/usr/bin/env node
/**
 * Release-candidate store doctor (npm run release:doctor).
 *
 * READ-ONLY diagnosis of the candidate store at
 * .site-work/release/candidates/. Never changes the selected release:
 * it inspects every origin store (collision-resistant ids and legacy
 * slug paths) and reports:
 *   - active committed generation (current.json pointer) + previous pointer
 *   - generation digest validity (recomputed SHA-256)
 *   - missing or corrupted files (no index.html)
 *   - incomplete staging generations (*.staging-* leftovers, next/ pending)
 *   - pending or interrupted promotion (next/ present, .promote-* leftovers)
 *   - conflicting origin identity (pointer origin vs directory identity)
 *   - orphaned generations (in generations/ but referenced by no pointer)
 *   - legacy stores needing non-destructive migration to a store id
 *   - factory lock state (held / abandoned / unreadable)
 *   - available recovery choices (explicit commands, never executed here)
 *
 * Recovery itself is a separate explicit operation (see the `recover`
 * hints in the report; e.g. re-running the factory re-syncs compatibility
 * views from the committed generation). A generation with an invalid
 * digest is never suggested for restore, and no domain/protocol identity
 * is ever switched automatically.
 *
 * Usage: node scripts/release-doctor.mjs [--out <report.json>]
 * Exit status: 0 healthy, 1 problems found, 2 unusable invocation.
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_CONTRACT_VERSION, REQUIRED_FULL_GATES } from './release-candidate.mjs';
import { readApplicableReceipt, decideGenerationReadiness } from './release-readiness.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CANDIDATES = join(ROOT, '.site-work', 'release', 'candidates');
export const FACTORY_LOCK = join(ROOT, '.site-work', 'release', 'factory.lock');

/**
 * The lock guards one candidate tree: a holder that locks root A does not
 * block root B. Reading the module-level FACTORY_LOCK while diagnosing another
 * root reported this repository's ambient lock and made the verdict depend on
 * whatever else was running here.
 */
export function factoryLockDir(root = ROOT) {
  return join(resolve(root), '.site-work', 'release', 'factory.lock');
}

function computeDigest(dir) {
  const files = [];
  (function walk(current) {
    for (const e of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(current, e.name);
      if (e.isDirectory()) walk(full);
      else files.push(relative(dir, full).split(sep).join('/'));
    }
  })(dir);
  files.sort();
  const digest = createHash('sha256');
  for (const rel of files) digest.update(`${rel} ${createHash('sha256').update(readFileSync(join(dir, rel))).digest('hex')}\n`);
  return { files: files.length, sha256: digest.digest('hex') };
}

function readJson(path) {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error).slice(0, 200) };
  }
}

function listNames(dir) {
  try {
    return readdirSync(dir).sort();
  } catch {
    return null;
  }
}

/**
 * Inspect one origin store directory. Pure reads only.
 * @returns {{ store: string, healthy: boolean, findings: Array<{severity: string, id: string, detail: string}> }}
 */
export function inspectStore(storeDir) {
  const rel = relative(ROOT, storeDir).split(sep).join('/');
  const findings = [];
  const flag = (severity, id, detail) => findings.push({ severity, id, detail });

  const currentPointer = join(storeDir, 'current.json');
  const previousPointer = join(storeDir, 'previous.json');
  let current = null;
  let previous = null;
  if (existsSync(currentPointer)) {
    const r = readJson(currentPointer);
    if (!r.ok) flag('error', 'pointer.current-corrupt', `current.json is unreadable: ${r.error}`);
    else current = r.value;
  } else {
    flag('warn', 'pointer.current-missing', 'no current.json: store predates generation pointers or was never promoted');
  }
  if (existsSync(previousPointer)) {
    const r = readJson(previousPointer);
    if (!r.ok) flag('error', 'pointer.previous-corrupt', `previous.json is unreadable: ${r.error}`);
    else previous = r.value;
  }

  // Generation directories and their digest validity.
  const genRoot = join(storeDir, 'generations');
  const genNames = listNames(genRoot) ?? [];
  const referenced = new Set([current?.generation, previous?.generation].filter(Boolean));
  const generationHealth = {};
  for (const name of genNames) {
    if (name.includes('.staging-')) {
      flag('warn', 'staging.incomplete-generation', `${rel}/generations/${name} is an interrupted staging leftover (safe to remove after inspection)`);
      continue;
    }
    const genDir = join(genRoot, name);
    if (!existsSync(join(genDir, 'index.html'))) {
      generationHealth[name] = 'GENERATION_CORRUPT';
      flag('error', 'generation.missing-index', `${rel}/generations/${name} has no index.html`);
      continue;
    }
    const pointer = name === current?.generation ? current : name === previous?.generation ? previous : null;
    if (pointer?.sha256) {
      let digest = null;
      try {
        digest = computeDigest(genDir);
      } catch (error) {
        generationHealth[name] = 'GENERATION_CORRUPT';
        flag('error', 'generation.unreadable', `${rel}/generations/${name} cannot be hashed: ${String(error?.message ?? error).slice(0, 120)}`);
        continue;
      }
      if (digest.sha256 !== pointer.sha256) {
        generationHealth[name] = 'GENERATION_CORRUPT';
        flag('error', 'generation.digest-mismatch', `${rel}/generations/${name} digest ${digest.sha256.slice(0, 16)}… != recorded ${String(pointer.sha256).slice(0, 16)}…; never restore this generation`);
      } else {
        generationHealth[name] = 'GENERATION_HEALTHY';
      }
    } else if (!referenced.has(name)) {
      generationHealth[name] = 'GENERATION_HEALTHY';
      flag('warn', 'generation.orphaned', `${rel}/generations/${name} is referenced by no pointer (orphan; kept, not selected)`);
    } else {
      generationHealth[name] = 'GENERATION_CORRUPT';
    }
  }
  if (current && !genNames.includes(current.generation) && !current.generation?.includes('staging')) {
    // Pre-pointer legacy store: current/ view without generations/.
    if (!existsSync(join(storeDir, 'current', 'index.html'))) {
      flag('error', 'generation.active-missing', `committed generation ${current.generation} has no directory and no current/ view`);
    }
  }

  // Compatibility views vs committed pointers (Stage D: content-checked).
  // A view is only as trustworthy as its bytes: hash it and compare with
  // the authoritative pointer digest. A stale view degrades the store
  // (error, never silent health) without invalidating the immutable
  // generation it lags behind.
  const views = {};
  const otherDigestOf = (view) => (view === 'current' ? previous?.sha256 : current?.sha256) ?? null;
  for (const [view, pointer] of [['current', current], ['previous', previous]]) {
    const viewDir = join(storeDir, view);
    if (!pointer) {
      if (existsSync(join(viewDir, 'index.html'))) flag('warn', `view.unpointed-${view}`, `${rel}/${view}/ exists with no ${view}.json pointer (legacy view; migrate to claim provenance)`);
      views[view] = 'NO_COMMITTED_CANDIDATE';
      continue;
    }
    if (!existsSync(join(viewDir, 'index.html'))) {
      views[view] = 'VIEW_MISSING';
      flag('warn', `view.missing-${view}`, `${rel}/${view}/ view is absent but generation ${pointer.generation} is committed; recovery: run the doctor with --repair or re-run the factory to re-sync the view from generations/`);
      continue;
    }
    if (generationHealth[pointer.generation] !== 'GENERATION_HEALTHY') {
      views[view] = 'VIEW_UNVERIFIABLE';
      flag('error', `view.unverifiable-${view}`, `${rel}/${view}/ cannot be trusted: its authoritative generation ${pointer.generation} is missing or digest-mismatched; repair the generation first, never copy the view back into it`);
      continue;
    }
    let viewDigest = null;
    try {
      viewDigest = computeDigest(viewDir).sha256;
    } catch (error) {
      views[view] = 'VIEW_CORRUPT';
      flag('error', `view.corrupt-${view}`, `${rel}/${view}/ cannot be hashed: ${String(error?.message ?? error).slice(0, 120)}; recovery: run the doctor with --repair`);
      continue;
    }
    if (viewDigest === pointer.sha256) {
      views[view] = 'VIEW_CURRENT';
      continue;
    }
    if (viewDigest === otherDigestOf(view)) {
      views[view] = 'VIEW_STALE';
      flag('error', `view.stale-${view}`, `${rel}/${view}/ holds the other generation's bytes (expected ${String(pointer.sha256).slice(0, 12)}…, found the ${view === 'current' ? 'previous' : 'current'} generation); the committed generation is intact, the view needs re-sync: run the doctor with --repair`);
    } else {
      views[view] = 'VIEW_CORRUPT';
      flag('error', `view.corrupt-${view}`, `${rel}/${view}/ digest ${viewDigest.slice(0, 12)}… matches neither pointer; the committed generation is intact, the view needs re-sync: run the doctor with --repair`);
    }
  }

  // Pending / interrupted promotion.
  if (existsSync(join(storeDir, 'next', 'index.html'))) {
    flag('warn', 'promotion.pending', `${rel}/next/ holds a staged candidate: promotion was interrupted before pointer commit OR is awaiting a factory run; committed generation is unaffected`);
  }
  for (const name of listNames(storeDir) ?? []) {
    if (/^\.promote-\d+$/.test(name)) flag('warn', 'promotion.interrupted-staging', `${rel}/${name} is an interrupted promotion staging leftover (safe to remove after inspection)`);
    if (/^\.(current|previous)\.staging-\d+$/.test(name)) flag('warn', 'promotion.interrupted-view', `${rel}/${name} is an interrupted view-sync leftover (safe to remove after inspection)`);
  }

  // Origin identity conflict.
  if (current?.origin && previous?.origin && current.origin !== previous.origin) {
    flag('error', 'identity.origin-conflict', `current.json origin ${current.origin} != previous.json origin ${previous.origin}: refusing automatic selection`);
  }

  // Generation-readiness evidence (read-only): the same strict decision the
  // packager applies, reported here as store health. Never mutates
  // generations or evidence; a byte-healthy store without FULL evidence
  // stays healthy but explicitly not FULL-attested.
  let readiness = { status: 'UNKNOWN', reason: 'no committed generation pointer' };
  if (current?.generation && current?.sha256 && current?.origin) {
    const projectRoot = resolve(storeDir, '..', '..', '..', '..');
    const storeId = basename(storeDir);
    let protocolCommit = null;
    try {
      protocolCommit = JSON.parse(readFileSync(join(projectRoot, 'src', 'data', 'canonical', 'meta.json'), 'utf8'))?.commit ?? null;
    } catch { /* format check still applies; canonical comparison skipped */ }
    const sel = readApplicableReceipt(join(projectRoot, 'reports', 'release', 'candidates'), storeId, current.generation, GATE_CONTRACT_VERSION, { sha256: current.sha256 });
    if (!sel.receipt) {
      readiness = { status: 'CANDIDATE_ONLY', reason: 'no generation receipt for the committed generation' };
      flag('warn', 'receipt.absent', `${rel}: no generation receipt for committed ${current.generation} under contract ${GATE_CONTRACT_VERSION}: bytes may verify but FULL readiness is unproven; re-run the full factory`);
    } else {
      const d = decideGenerationReadiness(sel.receipt, {
        origin: current.origin, generation: current.generation, sha256: current.sha256,
        gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES, protocolCommit,
      });
      readiness = { status: d.status, reason: d.reason };
      if (d.status !== 'FULL') {
        flag('warn', 'receipt.not-full', `${rel}: committed ${current.generation} does not attest FULL under contract ${GATE_CONTRACT_VERSION}: ${d.reason}`);
      }
    }
  }

  const healthy = !findings.some((f) => f.severity === 'error');
  return {
    store: rel, healthy, storeStatus: healthy ? 'STORE_HEALTHY' : 'STORE_DEGRADED',
    current, previous, generations: genNames.filter((g) => !g.includes('.staging-')),
    generationHealth, views, readiness, findings,
  };
}

/** Inspect the whole candidate tree plus the factory lock. Read-only. */
export function diagnose(root = ROOT) {
  const candidates = join(resolve(root), '.site-work', 'release', 'candidates');
  const stores = [];
  for (const name of listNames(candidates) ?? []) {
    const full = join(candidates, name);
    try {
      if (!lstatSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    stores.push(inspectStore(full));
  }
  // Factory lock state.
  let lock = { state: 'absent' };
  const lockDir = factoryLockDir(root);
  if (existsSync(lockDir)) {
    const r = readJson(join(lockDir, 'owner.json'));
    if (!r.ok) {
      lock = { state: 'unreadable', detail: 'owner.json unreadable; never treat as permission to proceed — inspect manually' };
    } else {
      const pid = Number(r.value?.pid);
      let alive = false;
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (e) {
        alive = e?.code !== 'ESRCH';
        if (e?.code !== 'ESRCH' && e?.code !== 'EPERM') alive = null;
      }
      lock = { state: alive === true ? 'held' : alive === false ? 'abandoned' : 'uncertain', pid, command: r.value?.command ?? null, at: r.value?.at ?? null };
    }
  }
  const healthy = stores.every((s) => s.healthy) && lock.state !== 'uncertain';
  const recover = [];
  for (const s of stores) {
    if (s.findings.some((f) => f.id === 'promotion.pending')) recover.push(`${s.store}: next/ is staged but uncommitted — re-run the factory to verify+promote, or remove next/ to stay on the committed generation`);
    if (s.findings.some((f) => f.id.startsWith('view.missing-'))) recover.push(`${s.store}: re-sync the missing view from generations/${s.current?.generation ?? '?'} (verbatim copy), then re-run this doctor`);
    if (s.findings.some((f) => f.id.startsWith('view.unpointed-'))) recover.push(`${s.store}: legacy views without pointers — run the factory once to migrate non-destructively (legacy kept as rollback)`);
  }
  if (lock.state === 'abandoned') recover.push('factory lock is abandoned (owner dead): the next factory run recovers it conservatively, preserving the abandoned record');
  if (lock.state === 'uncertain' || lock.state === 'unreadable') recover.push('factory lock state is uncertain: inspect the owning process manually; never delete the lock of a live owner');
  return { tool: 'release-doctor', healthy, stores, lock, recover };
}

/**
 * Explicit view repair (Stage D). NOT read-only: re-syncs compatibility
 * views from verified authoritative generations using repairCompatViews().
 *
 * Prerequisites per store, all verified before anything is copied:
 * - a readable current.json pointer naming a generation + digest + origin,
 * - the named generation exists with a matching digest (verified here),
 * - no origin conflict between current and previous pointers,
 * - no live or uncertain factory lock (an abandoned lock is tolerated:
 *   its owner is dead, and repair touches views only, never pointers).
 *
 * Never repairs a corrupted generation from a view, never invents
 * provenance, never touches pointers, never switches origin identity.
 * Unknown store names and path traversal are refused.
 *
 * @returns {{ ok: boolean, stores: Array<{store: string, current: object, previous: object}> , refused: string|null }}
 */
export async function repairStores(root = ROOT, onlyStore = null) {
  const { repairCompatViews } = await import('./release-candidate.mjs');
  const candidates = join(resolve(root), '.site-work', 'release', 'candidates');
  const lockState = diagnose(root).lock.state;
  if (lockState === 'held' || lockState === 'uncertain' || lockState === 'unreadable') {
    return { ok: false, stores: [], refused: `factory lock is ${lockState}: refusing repair during a possibly active release operation` };
  }
  const names = listNames(candidates) ?? [];
  const targets = onlyStore ? [onlyStore] : names;
  const repaired = [];
  for (const name of targets) {
    if (name.includes('/') || name.includes('\\') || name === '.' || name === '..' || !names.includes(name)) {
      return { ok: false, stores: repaired, refused: `unknown store ${name}: refusing to repair outside the candidate tree` };
    }
    const storeDir = join(candidates, name);
    const inspection = inspectStore(storeDir);
    const cur = inspection.current;
    if (!cur?.generation || !cur?.sha256 || !cur?.origin) {
      if (existsSync(join(storeDir, 'current.json'))) {
        // A pointer file exists but is corrupt or incomplete: something
        // claims authority but cannot establish it -- refuse, never guess.
        return { ok: false, stores: repaired, refused: `${name}: current pointer is corrupt or incomplete; cannot establish repair authority` };
      }
      // Legacy or never-promoted store: no repair authority exists, but
      // nothing is broken either -- skip with a note, keep going.
      repaired.push({ store: inspection.store, current: { status: 'skipped', detail: 'no current pointer; legacy views are left untouched' }, previous: { status: 'skipped', detail: 'no previous pointer; legacy views are left untouched' } });
      continue;
    }
    if (inspection.previous?.origin && inspection.previous.origin !== cur.origin) {
      return { ok: false, stores: repaired, refused: `${name}: origin conflict between pointers; refusing automatic repair` };
    }
    if (inspection.generationHealth[cur.generation] !== 'GENERATION_HEALTHY') {
      return { ok: false, stores: repaired, refused: `${name}: authoritative generation ${cur.generation} is missing or digest-mismatched; never rebuild a generation from a view` };
    }
    if (inspection.previous?.generation && inspection.previous?.sha256
      && inspection.generationHealth[inspection.previous.generation] !== 'GENERATION_HEALTHY') {
      return { ok: false, stores: repaired, refused: `${name}: previous generation ${inspection.previous.generation} is unverifiable; refusing partial repair` };
    }
    const result = repairCompatViews(storeDir);
    repaired.push({ store: inspection.store, ...result });
  }
  const ok = repaired.every((r) => r.current.status !== 'failed' && r.previous.status !== 'failed');
  return { ok, stores: repaired, refused: null };
}

async function main(argv) {
  const args = { out: null, repair: false, store: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = resolve(argv[++i]);
    else if (a === '--repair') args.repair = true;
    else if (a === '--store') args.store = argv[++i];
    else throw new Error(`unknown option ${a}`);
  }
  if (args.store && !args.repair) throw new Error('--store requires --repair');
  if (args.repair) {
    const result = await repairStores(ROOT, args.store);
    const lines = [`release-doctor --repair: ${result.ok ? 'REPAIRED' : 'REFUSED'}`];
    for (const s of result.stores) {
      lines.push(`  ${s.store}: current=${s.current.status} previous=${s.previous.status}`);
      for (const v of [s.current, s.previous]) if (v.detail) lines.push(`    ${v.detail}`);
    }
    if (result.refused) lines.push(`  refused: ${result.refused}`);
    process.stdout.write(`${lines.join('\n')}\n`);
    return result.ok ? 0 : 1;
  }
  const report = diagnose(ROOT);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    const { mkdirSync, writeFileSync } = await import('node:fs');
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, json);
  }
  const lines = [`release-doctor: ${report.healthy ? 'HEALTHY' : 'PROBLEMS'} (${report.stores.length} store(s))`];
  for (const s of report.stores) {
    lines.push(`  ${s.healthy ? 'OK  ' : 'FAIL'} ${s.store} gen=${s.current?.generation ?? 'none'} sha=${s.current?.sha256?.slice(0, 12) ?? 'none'}`);
    for (const f of s.findings) lines.push(`    [${f.severity}] ${f.id}: ${f.detail}`);
  }
  lines.push(`  lock: ${report.lock.state}${report.lock.pid ? ` (pid ${report.lock.pid})` : ''}`);
  for (const r of report.recover) lines.push(`  recover: ${r}`);
  process.stdout.write(`${lines.join('\n')}\n`);
  return report.healthy ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`release:doctor error: ${error.message}`);
    process.exit(2);
  });
}
