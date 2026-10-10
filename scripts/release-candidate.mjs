#!/usr/bin/env node
/**
 * Autonomous release candidate factory (npm run release:candidate).
 *
 * One predictable operator entry point that prepares a public release
 * candidate without performing any remote publication:
 *
 *   BUILD -> VERIFY -> PROJECT PUBLIC CONTENT -> VERIFY PUBLIC CANDIDATE
 *     -> LOCAL SMOKE -> PRESERVE IMMUTABLE SNAPSHOT -> REPORT
 *
 * 1. Records working-tree state (git revision + dirty status).
 * 2. Requires source/content health (site:doctor exit 0).
 * 3. Refuses unreviewed upstream identity changes (doctor covers drift;
 *    protocol identity is re-checked by the verifier, never auto-accepted).
 * 4. Runs the required static validation gates. Gates that read the built
 *    artifact (validate-content, validate-registry, audit-build) therefore
 *    require a prior release-mode build of the same origin:
 *      SAI_SITE_ORIGIN=<origin> SAI_RELEASE_BUILD=1 npm run build
 * 5. Builds for the explicitly configured target origin (release mode).
 * 6. Runs release-mode verification on the build.
 * 7. Projects the isolated public artifact (staging `next/` directory).
 * 8. Verifies the isolated candidate under the public contract.
 * 9. Runs loopback static-host smoke tests (LOCAL_STATIC_HOST_PASS).
 * 10. Computes a deterministic artifact identity (SHA-256).
 * 11. Saves a machine-readable evidence manifest outside the publishable dir.
 * 12. Rotates snapshots: previous <- current <- next (only after full PASS).
 *
 * A failed candidate never replaces a verified one: rotation happens only
 * after every stage passes, and the last verified `current/` is preserved
 * as `previous/` instead of being destroyed.
 *
 * Environment contract (never defaulted, never invented):
 *   SAI_SITE_ORIGIN=<public origin>  SAI_RELEASE_BUILD=1
 *   SAI_RELEASE_ORIGIN_ACK=<same origin>
 * Missing acknowledgement, a loopback origin, or the sai-temp.example.org
 * test fixture as a destination all BLOCK the run (exit 3) — the fixture
 * is a test double, never a publishing destination.
 *
 * Exit status: 0 PASS with FULL attested (full profile) or candidate-only
 * PASS (candidate profile), 1 FAIL, 3 BLOCKED, 4 ATTESTATION_GAP (a
 * full-profile execution passed every gate but strict FULL attestation
 * was withheld — limited provenance, uncertain commit, failed receipt
 * persistence, or a strict-field rejection; the structured report names
 * the reason, and the exit code never implies FULL).
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, cpSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeOrigin } from '../src/lib/deployment.mjs';
import { generationRunId, generationVersionedName, generationLegacyName, listVersionedReceipts, decideGenerationReadiness } from './release-readiness.mjs';
import { verifyRelease } from './release-verify.mjs';
import { projectPublicCandidate } from './release-public.mjs';
import { probeCandidate } from './release-smoke.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE_ORIGIN = 'https://sai-temp.example.org';
export const STORE_ROOT = join(ROOT, '.site-work', 'release', 'candidates');

/** Filesystem-safe slug for one origin (used for snapshot + evidence paths). */
export function slugForOrigin(origin) {
  return origin.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
}

/**
 * Collision-resistant storage identity for one origin (B1).
 *
 * The legacy slug maps https://a.b.com and https://a-b.com to the same
 * directory (a-b-com). The store id keeps a readable host prefix and
 * appends a deterministic 10-hex-char SHA-256 of the full normalized
 * origin (scheme + host + explicit port, lowercased), so distinct origins
 * can never share a candidate store.
 */
export function storeIdForOrigin(origin) {
  const canonical = String(origin).trim().toLowerCase().replace(/\/$/, '');
  const short = createHash('sha256').update(canonical).digest('hex').slice(0, 10);
  return `${slugForOrigin(canonical)}-${short}`;
}

/**
 * Resolve the candidate store directory for an origin.
 *
 * Returns { dir, kind } where kind is 'store' (collision-resistant id),
 * 'legacy' (pre-identity slug path, needs non-destructive migration) or
 * 'fresh' (neither exists yet; the caller creates the id-addressed store).
 */
export function resolveCandidateStore(root, origin) {
  const candidates = join(resolve(root), '.site-work', 'release', 'candidates');
  const idDir = join(candidates, storeIdForOrigin(origin));
  if (existsSync(idDir)) return { dir: idDir, kind: 'store' };
  const legacyDir = join(candidates, slugForOrigin(origin));
  if (existsSync(legacyDir)) return { dir: legacyDir, kind: 'legacy' };
  return { dir: idDir, kind: 'fresh' };
}

/**
 * Validate the factory environment contract before doing any heavy work.
 * @returns {{ ok: boolean, origin?: string, reason?: string }}
 */
export function validateCandidateEnv(env = process.env) {
  const raw = env.SAI_SITE_ORIGIN;
  if (raw === undefined || String(raw).trim() === '') {
    return { ok: false, reason: 'SAI_SITE_ORIGIN is required: a public candidate needs an explicitly selected origin' };
  }
  const { origin, problems } = normalizeOrigin(String(raw));
  if (!origin) return { ok: false, reason: `SAI_SITE_ORIGIN invalid: ${problems.join('; ')}` };
  if (env.SAI_RELEASE_BUILD !== '1') {
    return { ok: false, reason: 'SAI_RELEASE_BUILD=1 is required: only release builds become candidates' };
  }
  const ack = env.SAI_RELEASE_ORIGIN_ACK === undefined ? '' : String(env.SAI_RELEASE_ORIGIN_ACK).trim().replace(/\/$/, '');
  if (ack !== origin) {
    return { ok: false, reason: `SAI_RELEASE_ORIGIN_ACK must repeat ${origin} exactly (operator acknowledgement)` };
  }
  if (/^(localhost|127\.0\.0\.1)(:|$)/.test(origin.replace(/^https?:\/\//, ''))) {
    return { ok: false, reason: 'a public candidate must not target a loopback origin' };
  }
  if (origin === FIXTURE_ORIGIN) {
    return { ok: false, reason: `${FIXTURE_ORIGIN} is a test fixture, never a publishing destination; select the real target origin` };
  }
  return { ok: true, origin };
}

/** Deterministic SHA-256 over every file in a directory (sorted rel + bytes). */
export function computeDigest(dir) {
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

/** Recompute and compare: a corrupted candidate fails its recorded digest. */
export function verifyDigest(dir, expectedSha256) {
  return computeDigest(dir).sha256 === expectedSha256;
}

/**
 * Durably write one pointer file (current.json / previous.json) with an
 * atomic same-filesystem file replacement: temp file + fsync + rename.
 * File rename onto an existing path is atomic where the store uses it;
 * non-empty directory renames (not atomic on Windows) are never used as a
 * commit mechanism — generation directories are immutable and only the
 * small pointer file moves. fsync failures are tolerated (durability is
 * best-effort on consumer filesystems) but rename failures are fatal.
 * Honest limitation: absolute power-loss atomicity is not claimed; what is
 * guaranteed is that a failed or interrupted promotion never deletes the
 * last committed generation before its replacement is durable.
 */
export function writePointerAtomic(base, name, doc) {
  const target = join(base, `${name}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  mkdirSync(base, { recursive: true });
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  try {
    const fd = openSync(tmp, 'r');
    try { fsyncSync(fd); } finally { closeSync(fd); }
  } catch { /* best-effort durability */ }
  renameSync(tmp, target);
  return target;
}

/** Read one pointer file; null when absent, throws when corrupt. */
export function readPointer(base, name) {
  const target = join(base, `${name}.json`);
  if (!existsSync(target)) return null;
  return JSON.parse(readFileSync(target, 'utf8'));
}

/**
 * Commit a staged candidate as an immutable, content-addressed generation.
 *
 * The staged directory is copied to generations/g-<sha16>/ and its digest
 * verified BEFORE the authoritative pointer moves. The previous pointer is
 * preserved as previous.json. The committed generation is never deleted by
 * a later promotion — only the small current.json pointer is replaced.
 *
 * @returns {{ genId: string, genDir: string }}
 */
export function commitGeneration(base, { stagedDir, digest, origin, copy = (s, d) => cpSync(s, d, { recursive: true }) } = {}) {
  if (!stagedDir || !existsSync(join(stagedDir, 'index.html'))) {
    throw new Error('commitGeneration: staged candidate is not a valid build; nothing was committed');
  }
  if (!digest?.sha256) throw new Error('commitGeneration: a verified digest is required before commit');
  const genId = `g-${digest.sha256.slice(0, 16)}`;
  const genDir = join(base, 'generations', genId);
  if (!existsSync(join(genDir, 'index.html'))) {
    mkdirSync(join(base, 'generations'), { recursive: true });
    const tmpGen = `${genDir}.staging-${process.pid}`;
    rmSync(tmpGen, { recursive: true, force: true });
    try {
      copy(stagedDir, tmpGen);
    } catch (error) {
      rmSync(tmpGen, { recursive: true, force: true });
      throw new Error(`commitGeneration: staging copy failed, nothing was committed: ${String(error?.message ?? error).slice(0, 200)}`);
    }
    if (!verifyDigest(tmpGen, digest.sha256)) {
      rmSync(tmpGen, { recursive: true, force: true });
      throw new Error('commitGeneration: staged copy digest mismatch; nothing was committed');
    }
    renameSync(tmpGen, genDir);
  }
  if (!verifyDigest(genDir, digest.sha256)) {
    throw new Error('commitGeneration: committed generation digest mismatch; pointer was not moved');
  }
  const previous = readPointer(base, 'current');
  const doc = { generation: genId, sha256: digest.sha256, files: digest.files, origin, createdAt: new Date().toISOString() };
  // Commit boundary: the previous pointer is preserved FIRST, so a failure
  // between the two pointer writes still leaves a truthful state. Only the
  // single current.json file rename is the atomic commit step; the two
  // renames together are not claimed as one multi-file atomic transaction.
  // States: anything thrown before the current.json rename means
  // NOT_COMMITTED (old generation still selected); anything after means the
  // generation IS committed and later failures are POSTCOMMIT_DEGRADED.
  if (previous) writePointerAtomic(base, 'previous', previous);
  writePointerAtomic(base, 'current', doc);
  // Read-back: the committed pointer must select the verified generation.
  // A mismatch here means the current.json write most likely DID land but
  // cannot be confirmed -- the caller must reconcile observed filesystem
  // state (reconcileCommitState) instead of assuming NOT_COMMITTED.
  const check = readPointer(base, 'current');
  if (check?.generation !== genId || check?.sha256 !== digest.sha256) {
    throw new Error('commitGeneration: pointer read-back mismatch after commit; reconcile before classifying');
  }
  return { genId, genDir };
}

/**
 * Rebuild one compatibility view directory (current/ or previous/) from an
 * immutable generation. The new view is staged beside the target and only
 * swapped in after its digest verifies; a failure leaves the old view
 * intact. Views are convenience copies — the generations/ directory plus
 * current.json/previous.json remain the source of truth.
 */
export function syncCompatView(base, genDir, name, { expectedSha256 = null, copy = (s, d) => cpSync(s, d, { recursive: true }) } = {}) {
  const view = join(base, name);
  const staging = join(base, `.${name}.staging-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  copy(genDir, staging);
  if (!existsSync(join(staging, 'index.html'))) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`syncCompatView: staged ${name}/ has no index.html; old view untouched`);
  }
  if (expectedSha256 && !verifyDigest(staging, expectedSha256)) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`syncCompatView: staged ${name}/ digest mismatch; old view untouched`);
  }
  rmSync(view, { recursive: true, force: true });
  renameSync(staging, view);
  return view;
}

/**
 * Distinguishes commit outcomes for Stage B recovery honesty.
 *
 * A failure thrown BEFORE the current.json rename means NOT_COMMITTED: the
 * old authoritative generation is still selected and no history moved. A
 * failure thrown AFTER it means the generation IS committed; compatibility
 * views are disposable caches and their refresh failure is reported as
 * POSTCOMMIT_DEGRADED with the committed generation identity, never as an
 * uncommitted or untouched operation.
 */
export function isPostcommitDegraded(error) {
  return error?.code === 'POSTCOMMIT_DEGRADED';
}

export function postcommitDegraded(base, { generation, sha256, failedView, cause }) {
  const error = new Error(
    `rotateSnapshots: POSTCOMMIT_DEGRADED after committing ${generation} (${String(sha256).slice(0, 16)}…): ` +
    `${failedView} view refresh failed (${String(cause?.message ?? cause).slice(0, 160)}); ` +
    `the committed generation is durable and recoverable, compatibility views need repair`,
  );
  error.code = 'POSTCOMMIT_DEGRADED';
  error.generation = generation;
  error.sha256 = sha256;
  error.failedView = failedView;
  return error;
}

/**
 * Re-sync compatibility views (current/, previous/) from committed pointer
 * generations. This is the explicit, safe postcommit repair operation:
 * views only, never pointers, never invented provenance.
 *
 * For each of current/previous: when the pointer names a generation whose
 * directory exists with a matching digest, a missing or mismatched view is
 * rebuilt; a missing/corrupt generation is reported and left alone.
 * Idempotent: re-running over healthy views changes nothing.
 *
 * @returns {{ current: {status: string, detail?: string}, previous: {...} }}
 *   status is 'ok' | 'repaired' | 'no-pointer' | 'failed'.
 */
export function repairCompatViews(base, { copy = (s, d) => cpSync(s, d, { recursive: true }) } = {}) {
  const out = {};
  for (const name of ['current', 'previous']) {
    const view = join(base, name);
    let pointer = null;
    try {
      pointer = readPointer(base, name);
    } catch (error) {
      out[name] = { status: 'failed', detail: `pointer unreadable: ${String(error?.message ?? error).slice(0, 120)}` };
      continue;
    }
    if (!pointer?.generation || !pointer?.sha256) {
      out[name] = { status: 'no-pointer', detail: `no ${name}.json pointer; nothing to repair from` };
      continue;
    }
    const genDir = join(base, 'generations', pointer.generation);
    if (!existsSync(join(genDir, 'index.html')) || !verifyDigest(genDir, pointer.sha256)) {
      out[name] = { status: 'failed', detail: `generation ${pointer.generation} missing or digest-mismatched; refusing to restore an unverifiable generation` };
      continue;
    }
    if (existsSync(join(view, 'index.html')) && verifyDigest(view, pointer.sha256)) {
      out[name] = { status: 'ok', detail: `view matches committed ${pointer.generation}` };
      continue;
    }
    try {
      syncCompatView(base, genDir, name, { expectedSha256: pointer.sha256, copy });
      out[name] = { status: 'repaired', detail: `view re-synced from committed ${pointer.generation}` };
    } catch (error) {
      out[name] = { status: 'failed', detail: `view sync failed: ${String(error?.message ?? error).slice(0, 160)}` };
    }
  }
  return out;
}

/**
 * Fail-closed snapshot promotion inside base/: next/ becomes the committed
 * generation only when the caller already verified it.
 *
 * Transaction-safe order (A1):
 *   1. stage next/ into a side directory and verify its digest — a copy
 *      failure here throws while current/ is untouched;
 *   2. durably commit the staged content as an immutable generation and
 *      move only the small current.json pointer (previous.json preserved);
 *   3. refresh the current/ + previous/ compatibility views from durable
 *      generations (view failures leave the committed pointer valid, so
 *      recovery re-syncs the views instead of losing data);
 *   4. remove next/ and staging leftovers only after the commit read-back.
 *
 * The `copy` seam exists for deterministic failure-injection tests.
 */
export function rotateSnapshots(base, { digest = null, origin = null, copy = (s, d) => cpSync(s, d, { recursive: true }) } = {}) {
  const next = join(base, 'next');
  const current = join(base, 'current');
  const previous = join(base, 'previous');
  if (!existsSync(join(next, 'index.html'))) {
    throw new Error('rotateSnapshots: no verified next/ candidate to promote; current/ untouched');
  }
  if (digest && !verifyDigest(next, digest.sha256)) {
    throw new Error('rotateSnapshots: next/ digest mismatch; current/ untouched');
  }
  // 0. adopt a legacy current/ view with no pointer: commit the last verified
  // content as a generation FIRST, so step 3 can never delete the only copy.
  if (!readPointer(base, 'current') && existsSync(join(current, 'index.html'))) {
    try {
      const legacyDigest = computeDigest(current);
      commitGeneration(base, { stagedDir: current, digest: legacyDigest, origin, copy });
    } catch (error) {
      throw new Error(`rotateSnapshots: legacy adoption failed, current/ untouched: ${String(error?.message ?? error).slice(0, 200)}`);
    }
  }
  // 1. stage first: any copy failure throws before current/ is touched.
  const staging = join(base, `.promote-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  try {
    copy(next, staging);
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`rotateSnapshots: staging copy failed, current/ untouched: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  const stagedDigest = digest ?? computeDigest(staging);
  if (!verifyDigest(staging, stagedDigest.sha256)) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error('rotateSnapshots: staged copy digest mismatch; current/ untouched');
  }
  // Idempotent re-promotion: the staged content is byte-identical to the
  // committed generation. Move NO pointers (the real previous generation
  // stays referenced); only ensure the current/ view matches, then clean
  // up staging + next/. A no-change re-run changes no history.
  const existing = readPointer(base, 'current');
  if (existing?.sha256 === stagedDigest.sha256 && existing?.generation) {
    const genDir = join(base, 'generations', existing.generation);
    if (existsSync(join(genDir, 'index.html')) && verifyDigest(genDir, stagedDigest.sha256)) {
      if (!existsSync(join(current, 'index.html')) || !verifyDigest(current, stagedDigest.sha256)) {
        syncCompatView(base, genDir, 'current', { expectedSha256: stagedDigest.sha256, copy });
      }
      rmSync(staging, { recursive: true, force: true });
      rmSync(next, { recursive: true, force: true });
      return { current, previous };
    }
    // Pointer references a missing/corrupt generation: fall through to the
    // normal commit path, which fails closed with a precise error.
  }
  // 2. durable commit (pointer move) — the only irreversible step.
  const { genDir, genId } = commitGeneration(base, { stagedDir: staging, digest: stagedDigest, origin, copy });
  // 3. compatibility views, rebuilt from durable generations. Any failure
  // from here on is POSTCOMMIT_DEGRADED: the generation is committed and the
  // pointer has moved; only the disposable view caches need repair.
  let failedView = 'current';
  try {
    const prevPointer = readPointer(base, 'previous');
    syncCompatView(base, genDir, 'current', { expectedSha256: stagedDigest.sha256, copy });
    failedView = 'previous';
    if (prevPointer) {
      const prevGen = join(base, 'generations', prevPointer.generation);
      if (existsSync(join(prevGen, 'index.html'))) {
        syncCompatView(base, prevGen, 'previous', { expectedSha256: prevPointer.sha256, copy });
      }
    } else if (existsSync(current) && !existsSync(previous)) {
      // First generation commit: no previous generation exists yet; leave the
      // previous/ view absent rather than duplicating current/ as fake history.
    }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    rmSync(next, { recursive: true, force: true });
    if (isPostcommitDegraded(error)) throw error;
    throw postcommitDegraded(base, { generation: genId, sha256: stagedDigest.sha256, failedView, cause: error });
  }
  // 4. cleanup only after the commit read-back succeeded.
  rmSync(staging, { recursive: true, force: true });
  rmSync(next, { recursive: true, force: true });
  return { current, previous, genId, commitState: 'COMMITTED' };
}

/**
 * Reconcile the authoritative commit state from observed filesystem facts
 * after an ambiguous promotion error (Stage E). Never trusts the exception
 * category: a current.json write can succeed while its acknowledgement is
 * lost, so a generic error after the commit boundary must not be reported
 * as NOT_COMMITTED when the pointer actually advanced.
 *
 * @returns {{ state, generation, sha256, generationVerified, detail }}
 *   state is NOT_COMMITTED (pointer still selects another verified
 *   generation), COMMITTED (pointer selects the intended digest and its
 *   bytes verify), or COMMIT_STATE_UNCERTAIN (pointer unreadable, absent,
 *   or selecting unverifiable bytes -- never claim either outcome).
 */
export function reconcileCommitState(base, { expectedDigest = null } = {}) {
  let pointer = null;
  try {
    pointer = readPointer(base, 'current');
  } catch (error) {
    return { state: 'COMMIT_STATE_UNCERTAIN', generation: null, sha256: null, generationVerified: false, detail: `current pointer unreadable: ${String(error?.message ?? error).slice(0, 160)}` };
  }
  if (!pointer?.generation || !pointer?.sha256) {
    return { state: 'COMMIT_STATE_UNCERTAIN', generation: null, sha256: null, generationVerified: false, detail: 'no current pointer selects a generation' };
  }
  let genOk = false;
  try {
    const genDir = join(base, 'generations', pointer.generation);
    genOk = existsSync(join(genDir, 'index.html')) && verifyDigest(genDir, pointer.sha256);
  } catch { genOk = false; }
  if (expectedDigest && pointer.sha256 === expectedDigest.sha256) {
    if (genOk) {
      return { state: 'COMMITTED', generation: pointer.generation, sha256: pointer.sha256, generationVerified: true, detail: 'pointer selects the intended generation and its bytes verify' };
    }
    return { state: 'COMMIT_STATE_UNCERTAIN', generation: pointer.generation, sha256: pointer.sha256, generationVerified: false, detail: 'pointer selects the intended generation but its bytes do not verify' };
  }
  if (genOk) {
    return { state: 'NOT_COMMITTED', generation: pointer.generation, sha256: pointer.sha256, generationVerified: true, detail: 'pointer still selects another verified generation; the intended commit did not land' };
  }
  return { state: 'COMMIT_STATE_UNCERTAIN', generation: pointer.generation, sha256: pointer.sha256, generationVerified: false, detail: 'pointer selects an unverifiable generation' };
}

/**
 * Refuse to reuse a store whose recorded origin differs from the requested
 * one. Throws on conflict; returns the pointer (or null) otherwise.
 */
export function checkStoreOwnership(base, origin) {
  const pointer = readPointer(base, 'current');
  if (pointer && pointer.origin && pointer.origin !== origin) {
    throw new Error(`refusing to reuse a foreign identity: store at ${base} is owned by ${pointer.origin}, not ${origin}`);
  }
  return pointer;
}

/**
 * Non-destructive migration of a legacy slug-addressed store into the
 * collision-resistant id-addressed store (B1).
 *
 * The legacy directory is inspected (valid build?), its current digest is
 * computed, the content is COPIED (never moved) into generations/, and a
 * pointer records migratedFrom plus the legacy digest. The legacy store is
 * left untouched as rollback. Provenance for an unverifiable legacy
 * candidate is never claimed: migration refuses when legacy current/ has
 * no index.html.
 */
export function importLegacyStore(root, origin) {
  const candidates = join(resolve(root), '.site-work', 'release', 'candidates');
  const legacyDir = join(candidates, slugForOrigin(origin));
  const idDir = join(candidates, storeIdForOrigin(origin));
  if (!existsSync(join(legacyDir, 'current', 'index.html'))) {
    throw new Error(`importLegacyStore: legacy store at ${legacyDir} has no verifiable current/; refusing to claim its provenance`);
  }
  if (existsSync(join(idDir, 'current.json'))) return { dir: idDir, kind: 'store', migrated: false };
  const digest = computeDigest(join(legacyDir, 'current'));
  mkdirSync(join(idDir, 'generations'), { recursive: true });
  const { genDir } = commitGeneration(idDir, { stagedDir: join(legacyDir, 'current'), digest, origin });
  syncCompatView(idDir, genDir, 'current', { expectedSha256: digest.sha256 });
  const pointer = readPointer(idDir, 'current');
  writePointerAtomic(idDir, 'current', { ...pointer, migratedFrom: relative(resolve(root), legacyDir).split(sep).join('/') });
  // Legacy previous/ travels as institutional memory when present.
  if (existsSync(join(legacyDir, 'previous', 'index.html'))) {
    const prevDigest = computeDigest(join(legacyDir, 'previous'));
    const prevId = `g-${prevDigest.sha256.slice(0, 16)}`;
    const prevGen = join(idDir, 'generations', prevId);
    if (!existsSync(join(prevGen, 'index.html'))) cpSync(join(legacyDir, 'previous'), prevGen, { recursive: true });
    writePointerAtomic(idDir, 'previous', { generation: prevId, sha256: prevDigest.sha256, files: prevDigest.files, origin, createdAt: new Date().toISOString(), migratedFrom: 'legacy-previous' });
    syncCompatView(idDir, prevGen, 'previous', { expectedSha256: prevDigest.sha256 });
  }
  return { dir: idDir, kind: 'store', migrated: true };
}

/**
 * Exclusive release-factory operation lock (B2).
 *
 * One factory run at a time: a second concurrent run is refused. The lock
 * directory is created exclusively; owner.json identifies the holder.
 * Stale locks are handled conservatively:
 * - owner alive (PID answers) -> refuse, never delete a live owner's lock;
 * - owner dead -> move the abandoned lock aside (evidence preserved), then
 *   acquire; the move keeps the abandoned record instead of deleting it;
 * - owner unreadable or missing -> refuse; an unreadable lock is never
 *   interpreted as permission to proceed.
 * Works on Windows and CI hosts (PID liveness via signal 0).
 */
export function acquireReleaseLock(root = ROOT) {
  const lockDir = join(resolve(root), '.site-work', 'release', 'factory.lock');
  mkdirSync(dirname(lockDir), { recursive: true });
  try {
    mkdirSync(lockDir);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let owner = null;
    try {
      owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
    } catch {
      throw new Error(`[release-busy] factory lock at ${lockDir} is unreadable; refusing to proceed (inspect and recover it manually); nothing was modified`);
    }
    const pid = Number(owner?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`[release-busy] factory lock at ${lockDir} names no usable owner; refusing to proceed (inspect and recover it manually); nothing was modified`);
    }
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = true;
    } catch (killError) {
      alive = killError?.code !== 'ESRCH';
      if (killError?.code !== 'ESRCH' && killError?.code !== 'EPERM') {
        throw new Error(`[release-busy] cannot determine lock owner liveness (pid ${pid}); refusing to proceed; nothing was modified`);
      }
      if (killError?.code === 'EPERM') alive = true; // exists, but not signalable
    }
    if (alive) {
      throw new Error(`[release-busy] another release factory run holds the lock (pid ${pid}, ${owner?.command?.join(' ') ?? 'unknown command'}); refusing a concurrent run; nothing was modified`);
    }
    const aside = `${lockDir}.abandoned-${Date.now()}`;
    renameSync(lockDir, aside);
    mkdirSync(lockDir);
    writeFileSync(join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid, command: process.argv.slice(1), at: new Date().toISOString(), recoveredFrom: aside })}\n`);
    return releaseFactoryLock(lockDir);
  }
  writeFileSync(join(lockDir, 'owner.json'), `${JSON.stringify({ pid: process.pid, command: process.argv.slice(1), at: new Date().toISOString() })}\n`);
  return releaseFactoryLock(lockDir);
}

function releaseFactoryLock(lockDir) {
  let released = false;
  return function release() {
    if (released) return;
    released = true;
    try {
      const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
      if (Number(owner?.pid) !== process.pid) return; // not ours; leave it
    } catch {
      return; // unreadable on release: leave for manual inspection
    }
    rmSync(lockDir, { recursive: true, force: true });
  };
}

/**
 * Mandatory gate registry version. Bump whenever the FULL gate set
 * changes (STATIC_GATES, ENGINE_SUITE_FILES, BROWSER_SUITES, or the
 * stage order): a FULL receipt is only valid under the contract that
 * produced it, and the packager refuses receipts from other contracts.
 *
 * Contract 2 (T-29) materially strengthens what FULL means, so it is a
 * new contract rather than a reinterpretation of version 1:
 * - committed transaction state must be exactly COMMITTED;
 * - all accounting counts are strict nonnegative safe integers
 *   (fractions, negatives, NaN/Infinity, strings, and missing values
 *   are UNKNOWN, never zero);
 * - the staged digest must be a valid SHA-256 equal to the committed
 *   candidate digest;
 * - the protocol source authority must bind version AND a 40-hex commit;
 * - the mandatory gate registry must be present and non-empty;
 * - the factory's FULL claim must itself survive the strict decision
 *   (finalizeReadiness), never rest on profile plus exit status alone.
 * Version-1 receipts stay readable as history but cannot attest FULL
 * under this contract; only a genuine new verification mints version 2.
 *
 * Contract 3 (website quality waves 2-3) expands the mandatory browser
 * matrix with three quality suites on Chromium -- docs-journey (reading
 * and navigation), theme-contrast (cross-theme rendered contrast), and
 * zoom-reflow (reflow, forced-colors, reduced-motion, keyboard reach).
 * Version-2 receipts stay readable as history but cannot attest FULL
 * under contract 3; only a genuine contract-3 verification mints it.
 *
 * Contract 4 makes semantic Cosmos media validation mandatory: the FULL
 * factory runs `npm run validate:media` (scripts/media/check_media.py)
 * as a static gate, so corrupted-but-rehashed image bytes -- which pass
 * generic manifest hash checks -- cannot reach candidate promotion.
 * Version-3 receipts stay readable as history but cannot attest FULL
 * under contract 4; only a genuine contract-4 verification mints it.
 *
 * Contract 5 strengthens what validate:media proves: the delivered WebP
 * must be the deterministic q60/m6 re-derivation of the checked-in GIF
 * (scripts/media/cosmos_derive.py, byte-compared in a disposable
 * directory), so a structurally valid but unrelated animation with a
 * consistently updated manifest hash is rejected. Version-4 receipts
 * stay readable as history but cannot attest FULL under contract 5;
 * only a genuine contract-5 verification mints it.
 *
 * Contract 6 adds the secondary-page reader journey
 * (tests/secondary-journey.spec.mjs, Chromium) to the mandatory browser
 * matrix: cross-page link-following, back/forward restoration, 320px
 * table containment, external-link marking, and landmark structure on
 * the compatibility/status/downloads/benchmarks/security pages.
 * Version-5 receipts stay readable as history but cannot attest FULL
 * under contract 6; only a genuine contract-6 verification mints it.
 */
export const GATE_CONTRACT_VERSION = '6';

/** Gate ids that must each report ok for a FULL verdict to mean anything. */
export const REQUIRED_FULL_GATES = [
  'site:doctor', 'lint-styles', 'validate-themes', 'validate-canonical',
  'validate-content', 'validate-registry', 'validate-baselines',
  'validate-licenses', 'validate:media', 'audit-build', 'i18n', 'test:engine', 'check',
  'astro-build', 'test:engine-build', 'test:browser-matrix', 'release:dual-origin',
];

function gitInfo() {
  try {
    const rev = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: 'pipe', timeout: 30000 }).toString().trim();
    // trimEnd ONLY: trim() would eat the leading status-space of the first
    // line (' M file' -> 'M file'), corrupting its flag semantics. The
    // manifest must record the true index/worktree flags.
    let dirty = execSync('git -c core.quotePath=false status --porcelain', { cwd: ROOT, stdio: 'pipe', timeout: 30000 }).toString().trimEnd();
    if (!dirty) return { rev, dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    let identity = dirtyTreeIdentity(dirty);
    if (!identity) {
      // One re-observation: a transient filesystem race (editor/AV/sync)
      // can make a listed path momentarily unstatable. The retry only
      // re-reads; a computed manifest is always a genuine hash, and a
      // persistent problem still falls through to limited+detail below.
      try {
        execFileSync(process.execPath, ['-e', 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2000)'], { stdio: 'ignore', timeout: 10000 });
      } catch { /* delay is best-effort; the re-read below is what matters */ }
      dirty = execSync('git -c core.quotePath=false status --porcelain', { cwd: ROOT, stdio: 'pipe', timeout: 30000 }).toString().trimEnd();
      identity = dirtyTreeIdentity(dirty);
    }
    return {
      rev, dirty: true, dirtyFiles: dirty.split('\n').length,
      dirtyIdentity: identity,
      provenance: identity ? 'head+dirty-manifest' : 'limited',
      provenanceDetail: identity ? null : dirtyTreeProblem(dirty)?.slice(0, 160) ?? null,
    };
  } catch {
    return { rev: 'unknown', dirty: true, dirtyFiles: -1, dirtyIdentity: null, provenance: 'limited' };
  }
}

/**
 * Deterministic identity of a dirty working tree: SHA-256 over a manifest
 * of status flags + git blob hashes + paths. Two different dirty trees
 * cannot share an identity; a clean tree needs none (HEAD suffices).
 * Returns null when it cannot be established -- never an invented hash.
 */
function hashDirtyFile(rel) {
  try {
    return execFileSync('git', ['hash-object', rel], { cwd: ROOT, stdio: 'pipe', timeout: 30000 }).toString().trim();
  } catch { return null; }
}

function walkDirtyDir(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  } catch { return null; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = walkDirtyDir(full);
      if (!sub) return null;
      out.push(...sub);
    } else if (e.isFile()) {
      out.push(relative(ROOT, full).split(sep).join('/'));
    }
  }
  return out;
}

/**
 * Resolve a porcelain path against ROOT. Some git/output combinations can
 * terminate lines with a stray carriage return that is not part of the
 * filename; when the raw path does not stat, one trailing CR is stripped
 * as a fallback (a real CR-final filename still stats on the first try,
 * so genuine names never change meaning here).
 */
export function resolvePorcelainPath(path) {
  const full = join(ROOT, path);
  try {
    lstatSync(full);
    return { full, path };
  } catch { /* try the CR-stripped fallback below */ }
  if (path.endsWith('\r')) {
    const stripped = path.slice(0, -1);
    try {
      lstatSync(join(ROOT, stripped));
      return { full: join(ROOT, stripped), path: stripped };
    } catch { /* fall through to unresolved */ }
  }
  return { full, path, unresolved: true };
}

/** First porcelain entry that dirtyTreeIdentity cannot establish, for diagnosis. */
export function dirtyTreeProblem(porcelain) {
  try {
    for (const entry of String(porcelain).split('\n').filter(Boolean)) {
      const flag = entry.slice(0, 2);
      const path = entry.slice(3).replace(/^\"(.*)\"$/, '$1');
      if (resolvePorcelainPath(path).unresolved && !flag.includes('D')) {
        return `unresolvable path: ${JSON.stringify(entry.slice(0, 120))}`;
      }
    }
  } catch { /* fall through */ }
  return 'unhashable content (see dirtyTreeIdentity rules)';
}

export function dirtyTreeIdentity(porcelain) {
  try {
    const lines = [];
    for (const entry of porcelain.split('\n').filter(Boolean)) {
      const flag = entry.slice(0, 2);
      const path = entry.slice(3).replace(/^"(.*)"$/, '$1');
      const resolved = resolvePorcelainPath(path);
      let stat = null;
      try { stat = lstatSync(resolved.full); } catch { stat = null; }
      const name = resolved.unresolved ? path : resolved.path;
      if (!stat) {
        if (!flag.includes('D')) return null;
        lines.push(`${flag} deleted ${name}`);
        continue;
      }
      if (stat.isDirectory()) {
        // Untracked directories: identify by every file inside, not the dir.
        const inner = walkDirtyDir(resolved.full);
        if (!inner) return null;
        for (const rel of inner) {
          const h = hashDirtyFile(rel);
          if (!h) return null;
          lines.push(`${flag} ${h} ${rel}`);
        }
        continue;
      }
      const hash = hashDirtyFile(name);
      if (!hash) return null;
      lines.push(`${flag} ${hash} ${name}`);
    }
    if (!lines.length) return null;
    return createHash('sha256').update(`${lines.sort().join('\n')}\n`).digest('hex');
  } catch { return null; }
}

function runGate(cmd, env) {
  try {
    execSync(cmd, { cwd: ROOT, stdio: 'pipe', timeout: 600000, env });
    return { ok: true, exit: 0 };
  } catch (error) {
    const tail = String(error?.stdout ?? error?.stderr ?? error?.message ?? error).split('\n').slice(-4).join(' ').slice(0, 300);
    return { ok: false, exit: Number(error?.status ?? 1), tail };
  }
}

/**
 * Explicit verification policy (Stage C).
 *
 * FAST ITERATION: affected gates via `site:affected -- --run` (not the factory).
 * RELEASE CANDIDATE (`--profile=candidate`, the default): every required
 *   static, security and candidate-integration gate below, then build the
 *   current artifact, verify it, project it, verify the projection and
 *   smoke-test it. Enough for a local candidate, never labelled full readiness.  * FULL RELEASE READINESS (`--profile=full`): everything in `candidate` plus
  *   the type check, the full browser matrix (all dist-suites on Chromium,
  *   pixel-perfect on Chromium+WebKit, candidate-host on the staged artifact
  *   with digest attestation) and the dual-origin proof.
 *   Only a PASS under the full profile (with zero unallowlisted skips) may
 *   be described as release-ready; the candidate profile evidence says so
 *   explicitly via `readinessClaim: 'candidate-only'`.
 */
export const VERIFICATION_PROFILES = {
  candidate: { readinessClaim: 'candidate-only' },
  full: { readinessClaim: 'full-readiness' },
};

/**
 * Engine gate with skip accounting: TAP output is parsed and any skipped
 * test FAILs the gate unless it matches the environmental allowlist
 * (hosts that cannot create symlinks cannot run the symlink guard).
 */
/**
 * Test files that need a REAL production build in dist/ (declared
 * prerequisite). Every other engine file is dist-independent (disposable
 * fixtures) and runs before the build, so a clean checkout works.
 */
export const BUILD_DEPENDENT_TESTS = ['scripts/tests/release-public.test.mjs'];

/**
 * Exact registry of every engine test suite that must run. The gate refuses
 * to pass when a registered suite is missing from disk AND when an
 * unregistered *.test.mjs appears on disk: a removed mandatory suite and
 * an unknown suite are both identity failures. Adding a suite means
 * registering it here explicitly.
 */
export const ENGINE_SUITE_FILES = [
  'scripts/tests/baseline-registry.test.mjs',
  'scripts/tests/contrast-math.test.mjs',
  'scripts/tests/drift.test.mjs',
  'scripts/tests/engine.test.mjs',
  'scripts/tests/font-controls.test.mjs',
  'scripts/tests/i18n-controls.test.mjs',
  'scripts/tests/i18n-provenance.test.mjs',
  'scripts/tests/i18n-safety.test.mjs',
  'scripts/tests/release-browser-accounting.test.mjs',
  'scripts/tests/release-candidate.test.mjs',
  'scripts/tests/release-checklist.test.mjs',
  'scripts/tests/release-checklist-cli.test.mjs',
  'scripts/tests/release-doctor-views.test.mjs',
  'scripts/tests/release-package-attestation.test.mjs',
  'scripts/tests/release-provenance.test.mjs',
  'scripts/tests/release-hardening.test.mjs',
  'scripts/tests/release-origin.test.mjs',
  'scripts/tests/release-public.test.mjs',
  'scripts/tests/release-skip-accounting.test.mjs',
  'scripts/tests/release-smoke.test.mjs',
  'scripts/tests/release-transaction.test.mjs',
  'scripts/tests/render.test.mjs',
];

/**
 * Identity-based environmental skip policy for engine tests (Stage A).
 *
 * An allowed skip must match ALL of: the suite file that ran, the exact
 * test name, and the exact approved reason. A foreign test that copies an
 * approved reason is rejected: the reason alone authorizes nothing. Each
 * entry also records the environmental capability it excuses, so review
 * can judge whether the excuse still applies.
 *
 * Today exactly one entry exists: the release-origin symlink guard, which
 * cannot construct symlinks on hosts that forbid them.
 */
export const ENGINE_SKIP_POLICY = [
  {
    file: 'scripts/tests/release-origin.test.mjs',
    test: 'S10: a symbolic link escaping the artifact root fails the cleanliness check',
    reason: 'neither symlinks nor junctions can be created on this host; symlink protection NOT verified',
    capability: 'symlink-or-junction creation',
  },
];

/** Backwards-compatible alias: the policy with its exact reasons. */
export const ENGINE_SKIP_ALLOWLIST = ENGINE_SKIP_POLICY.map((p) => p.reason);

/**
 * Structured accounting over node:test TAP output (`node --test
 * --test-reporter=tap`, Node's supported machine-readable reporter).
 *
 * Node prints a skipped test as `ok N - name # SKIP reason` (NOT `not
 * ok`), so status-prefix matching misses mandatory skips. This parser
 * extracts every skip as a { name, reason } identity, requires the FULL
 * machine footer (tests/pass/fail/cancelled/skipped/todo), and verifies
 * arithmetic consistency: pass+fail+cancelled+skipped+todo === tests
 * (a todo test counts in tests but in no other bucket). A report with
 * only `# tests N` is incomplete, not complete.
 *
 * `file` binds the report to the suite file that produced it, so the
 * identity-based skip policy can require the right test in the right
 * file with the exact approved reason. Without a file binding no policy
 * entry matches and every skip is unknown.
 */
export function accountEngineTap(output, { file = null } = {}) {
  const lines = String(output ?? '').split('\n');
  const skips = [];
  // Discovered test-result records: every ok/not-ok assertion line EXCEPT
  // suite summaries. Node's TAP reporter marks each assertion with a YAML
  // detail block carrying `type: 'test'` (real test) or `type: 'suite'`
  // (aggregate summary, e.g. the top-level `ok 1 - file` line). A bare
  // footer (`# tests 1` / `# pass 1` with no records) proves nothing and
  // must FAIL: only lines positively identified as suite summaries are
  // excluded, so terse reporters without YAML blocks still account.
  const records = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)(ok|not ok)\s+\d+\s+-\s+(.*?)(?:\s+# SKIP\s*(.*))?$/);
    if (!m) continue;
    const name = m[3].trim();
    if (/^# SKIP\s*/.test(name)) continue;
    let suiteSummary = false;
    for (let j = i + 1; j < lines.length; j++) {
      const dl = lines[j];
      if (/^\s*\.\.\.$/.test(dl)) break;
      const tm = dl.match(/^\s*type:\s*['"]?(test|suite)['"]?\s*$/);
      if (tm) { suiteSummary = tm[1] === 'suite'; break; }
      if (/^(\s*)(ok|not ok)\s+\d+\s/.test(dl) || /^\s*# Subtest/.test(dl) || /^\d+\.\.\d+/.test(dl.trim())) break;
    }
    if (suiteSummary) continue;
    records.push({ line: lines[i].trim(), name, status: m[2], file });
  }
  const seen = new Map();
  const duplicates = [];
  for (const r of records) {
    const n = (seen.get(r.line) ?? 0) + 1;
    seen.set(r.line, n);
    if (n === 2) duplicates.push(r.line);
  }
  for (const raw of lines) {
    const m = raw.trim().match(/^(?:ok|not ok)\s+\d+\s+-\s+(.*?)\s+# SKIP\s*(.*)$/);
    if (m) skips.push({ name: m[1].trim(), reason: (m[2] ?? '').trim(), file });
  }
  const footer = {};
  for (const l of lines) {
    const m = l.match(/^# (tests|suites|pass|fail|cancelled|skipped|todo)\s+(\d+)/);
    if (m) footer[m[1]] = Number(m[2]);
  }
  const required = ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'];
  const missingFields = required.filter((k) => footer[k] === undefined);
  const accounted = (footer.pass ?? 0) + (footer.fail ?? 0) + (footer.cancelled ?? 0)
    + (footer.skipped ?? 0) + (footer.todo ?? 0);
  const consistent = missingFields.length === 0 && accounted === footer.tests;
  const complete = missingFields.length === 0;
  const discovered = records.length;
  const recordsMatchFooter = !complete ? false : discovered === footer.tests;
  const unknownSkips = skips.filter((s) => !ENGINE_SKIP_POLICY.some((p) =>
    p.file === file && s.name === p.test && s.reason === p.reason));
  return {
    file,
    total: footer.tests ?? null,
    pass: footer.pass ?? null,
    fail: footer.fail ?? null,
    cancelled: footer.cancelled ?? null,
    skipped: footer.skipped ?? skips.length,
    todo: footer.todo ?? null,
    skips,
    skipLines: skips.map((s) => `${s.name} # SKIP ${s.reason}`),
    unknownSkips,
    missingFields,
    consistent,
    complete,
    discovered,
    records: records.map((r) => r.name),
    duplicates,
    recordsMatchFooter,
  };
}

/**
 * Gate decision over one suite's accounting. Returns null when the suite
 * passes, otherwise the refusal reason. Every mandatory skip, failure,
 * cancellation, contradiction, truncation, or empty run refuses here --
 * never as a silent PASS. Runner exit status is handled by the caller:
 * any nonzero exit refuses regardless of what the partial report says.
 */
export function refuseEngineSuite(a) {
  if (!a) return 'no test report produced';
  if (!a.complete) {
    const missing = (a.missingFields ?? []).join(', ') || 'TAP footer';
    return `incomplete or truncated report (missing: ${missing}); refusing silent PASS`;
  }
  if (!a.consistent) {
    return `contradictory footer counts (pass/fail/cancelled/skipped/todo do not sum to tests); refusing silent PASS`;
  }
  if ((a.duplicates ?? []).length) {
    return `duplicate test-result records (${a.duplicates.length}): ${String(a.duplicates[0]).slice(0, 120)}; refusing silent PASS`;
  }
  if (a.recordsMatchFooter === false) {
    return `test-result records (${a.discovered ?? 0}) do not match footer tests (${a.total ?? 'missing'}); footer alone proves nothing; refusing silent PASS`;
  }
  if (a.total === 0) return 'zero tests discovered: nothing verified; refusing silent PASS';
  if ((a.fail ?? 0) > 0) return `${a.fail} mandatory test(s) failed; refusing silent PASS`;
  if ((a.cancelled ?? 0) > 0) return `${a.cancelled} test(s) cancelled before asserting; refusing silent PASS`;
  if (a.unknownSkips.length) {
    const first = a.unknownSkips[0];
    return `mandatory test skipped with no policy cover: "${String(first.name).slice(0, 120)}"; refusing silent PASS`;
  }
  return null;
}

/**
 * Resolve the engine suites on disk against the registry. Refuses when a
 * registered mandatory suite is missing AND when an unregistered suite
 * appears: both are suite-identity failures. Split by build prerequisite
 * so dist-independent suites run before the release build.
 */
export function resolveEngineSuites({ includeBuildDependent = false, root = ROOT, registry = ENGINE_SUITE_FILES } = {}) {
  let onDisk;
  try {
    onDisk = readdirSync(join(root, 'scripts', 'tests'))
      .filter((f) => f.endsWith('.test.mjs'))
      .map((f) => `scripts/tests/${f}`)
      .sort();
  } catch (error) {
    return { ok: false, files: [], error: `cannot enumerate engine suites: ${String(error?.message ?? error).slice(0, 160)}` };
  }
  const missing = registry.filter((f) => !onDisk.includes(f));
  if (missing.length) {
    return { ok: false, files: [], error: `missing mandatory engine suite(s): ${missing.join(', ')}` };
  }
  const unregistered = onDisk.filter((f) => !registry.includes(f));
  if (unregistered.length) {
    return { ok: false, files: [], error: `unregistered engine suite(s): ${unregistered.join(', ')} -- register in ENGINE_SUITE_FILES or remove` };
  }
  const files = registry.filter((f) => includeBuildDependent
    ? BUILD_DEPENDENT_TESTS.includes(f)
    : !BUILD_DEPENDENT_TESTS.includes(f));
  return { ok: true, files, error: null };
}

/**
 * Mandatory browser/visual matrix for FULL readiness (Stage B). The seven
 * dist-suites validate the release build (they require /debug/ routes and
 * the qps-ploc locale, which the public projection removes); the
 * candidate-host suite validates the exact staged promotion artifact via
 * SAI_CANDIDATE_DIR. `projects` states which Playwright projects must each
 * execute: pixel-perfect and media-delivery run Chromium AND WebKit
 * (config testMatch), the rest Chromium only. A suite that ran on the
 * wrong set of projects is a missing-suite failure, not partial credit.
 */
export const BROWSER_SUITES = [
  { file: 'tests/theme-runtime.spec.mjs', projects: ['chromium'] },
  { file: 'tests/site-shell.spec.mjs', projects: ['chromium'] },
  { file: 'tests/content-features.spec.mjs', projects: ['chromium'] },
  { file: 'tests/support.spec.mjs', projects: ['chromium'] },
  { file: 'tests/i18n.spec.mjs', projects: ['chromium'] },
  { file: 'tests/docs-journey.spec.mjs', projects: ['chromium'] },
  { file: 'tests/theme-contrast.spec.mjs', projects: ['chromium'] },
  { file: 'tests/zoom-reflow.spec.mjs', projects: ['chromium'] },
  { file: 'tests/pixel-perfect.spec.mjs', projects: ['chromium', 'webkit'] },
  { file: 'tests/media-delivery.spec.mjs', projects: ['chromium', 'webkit'] },
  { file: 'tests/secondary-journey.spec.mjs', projects: ['chromium'] },
  { file: 'tests/visual-baseline.spec.mjs', projects: ['chromium'] },
  { file: 'tests/candidate-host.spec.mjs', projects: ['chromium'] },
];

/** Spec files of the dist-served matrix (candidate-host runs separately). */
export const BROWSER_MATRIX_SPECS = BROWSER_SUITES
  .map((s) => s.file)
  .filter((f) => f !== 'tests/candidate-host.spec.mjs');

/**
 * Expected accounting registry for the dist-served matrix. candidate-host is
 * verified separately against the exact staged candidate, so it must never
 * appear in the matrix expectation -- neither on a clean run nor on a failed
 * one. Keeping this as the single exported identity is what stops a nonzero
 * runner exit from being misdiagnosed as "candidate-host absent".
 */
export const BROWSER_MATRIX_EXPECTED = BROWSER_SUITES
  .filter((s) => s.file !== 'tests/candidate-host.spec.mjs');

/** Expected accounting registry for the dedicated staged-candidate run. */
export const CANDIDATE_HOST_EXPECTED = [
  { file: 'tests/candidate-host.spec.mjs', projects: ['chromium'] },
];

/**
 * Narrowly defined browser skip policy. Each entry excuses an exact skip
 * REASON on an exact suite file under an exact project -- and only when
 * the same test demonstrably passed on the complementary engine
 * (requiresComplementOn). Today's entries are the pixel-perfect
 * engine-conditional checks: 79 Chromium-only computed-style probes skip
 * on WebKit, 1 WebKit-only smoothing probe skips on Chromium, and every
 * one of the 80 passes on its complementary engine. Any other browser
 * skip -- a mandatory Chromium test skipped, a visual suite omitted, an
 * undescribed skip -- is unknown and refuses FULL readiness.
 */
export const BROWSER_SKIP_POLICY = [
  {
    file: 'tests/pixel-perfect.spec.mjs',
    project: 'webkit',
    reason: 'computed-style check; one engine is enough',
    requiresComplementOn: 'chromium',
    note: 'Chromium-only computed-style probes; each passes on Chromium',
  },
  {
    file: 'tests/pixel-perfect.spec.mjs',
    project: 'chromium',
    reason: 'WebKit smooths a sub-pixel-transformed text run; Chromium on a host with system smoothing off does not.',
    requiresComplementOn: 'webkit',
    note: 'WebKit-only text-smoothing control; passes on WebKit',
  },
];

/**
 * Structured accounting over Playwright JSON output (`--reporter=json`).
 * Flattens every (file, title-path, project, status) result, requires all
 * expected suites with all expected projects non-empty, and checks each
 * skip against the identity-based policy including the complementary-pass
 * requirement. Never trusts exit code alone: a zero exit with a missing
 * suite, an unexpected failure, a flake, or an unknown skip refuses.
 */
export function accountPlaywrightJson(text, { expected = BROWSER_SUITES, policy = BROWSER_SKIP_POLICY } = {}) {
  let report;
  try {
    report = JSON.parse(String(text));
  } catch (error) {
    return { parseError: `unparsable Playwright JSON: ${String(error?.message ?? error).slice(0, 160)}`, complete: false };
  }
  const results = [];
  (function walk(suites, trail, file) {
    for (const s of suites ?? []) {
      const f = s.file ?? file;
      const here = [...trail, s.title].filter(Boolean);
      const path = here.join(' > ');
      for (const spec of s.specs ?? []) {
        const title = [path, spec.title].filter(Boolean).join(' > ');
        for (const t of spec.tests ?? []) {
          const skipAnn = (t.annotations ?? []).find((a) => a?.type === 'skip');
          results.push({
            file: f ? String(f).split('/').pop() : null,
            suiteFile: f ?? null,
            title,
            project: t.projectName,
            status: t.status,
            skipReason: t.status === 'skipped' ? String(skipAnn?.description ?? '') : null,
          });
        }
      }
      walk(s.suites, here, f);
    }
  })(report.suites, [], null);
  const stats = report.stats ?? {};
  const passed = new Set(results.filter((r) => r.status === 'expected').map((r) => `${r.suiteFile}|${r.title}|${r.project}`));
  const totals = { tests: results.length, passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const r of results) {
    if (r.status === 'expected') totals.passed++;
    else if (r.status === 'skipped') totals.skipped++;
    else if (r.status === 'flaky') totals.flaky++;
    else totals.failed++;
  }
  const baseName = (p) => { const s = String(p ?? ''); return s.slice(Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\')) + 1); };
  const sameFile = (a, b) => a === b || baseName(a) === baseName(b);
  const missingSuites = [];
  for (const e of expected) {
    const inFile = results.filter((r) => sameFile(r.suiteFile, e.file));
    if (!inFile.length) { missingSuites.push(`${e.file} (absent)`); continue; }
    for (const p of e.projects) {
      if (!inFile.some((r) => r.project === p)) missingSuites.push(`${e.file} (no ${p} tests)`);
    }
  }
  // Preserve the identities of genuinely failing tests. The gate message
  // names them so a nonzero run reports the actual root cause instead of a
  // generic count.
  const failedTests = results
    .filter((r) => r.status !== 'expected' && r.status !== 'skipped' && r.status !== 'flaky')
    .map((r) => ({ file: r.file, project: r.project, title: r.title }));
  const skips = results.filter((r) => r.status === 'skipped');
  const unknownSkips = skips.filter((s) => !policy.some((p) =>
    sameFile(s.suiteFile, p.file)
    && s.project === p.project
    && s.skipReason === p.reason
    && (!p.requiresComplementOn || passed.has(`${s.suiteFile}|${s.title}|${p.requiresComplementOn}`))));
  const statCounts = {
    expected: stats.expected ?? null, skipped: stats.skipped ?? null,
    unexpected: stats.unexpected ?? null, flaky: stats.flaky ?? null,
  };
  const statsComplete = Object.values(statCounts).every((v) => Number.isFinite(v) && v >= 0);
  // The runner summary must describe the same run the records show: a
  // report with one expected result but `expected: 0` (or any other
  // totals/stats disagreement) is contradictory evidence, never a pass.
  const statsConsistent = statsComplete
    && statCounts.expected === totals.passed
    && statCounts.unexpected === totals.failed
    && statCounts.skipped === totals.skipped
    && statCounts.flaky === totals.flaky
    && totals.tests === statCounts.expected + statCounts.unexpected + statCounts.skipped + statCounts.flaky;
  return {
    complete: true, parseError: null,
    stats: statCounts,
    statsComplete,
    statsConsistent,
    totals,
    files: [...new Set(results.map((r) => r.file).filter(Boolean))].sort(),
    missingSuites,
    failedTests,
    skips: skips.map((s) => ({ file: s.file, project: s.project, title: s.title, reason: s.skipReason })),
    unknownSkips: unknownSkips.map((s) => ({ file: s.file, project: s.project, title: s.title, reason: s.skipReason })),
    runnerErrors: Array.isArray(report.errors) ? report.errors.map((e) => String(e?.message ?? e).slice(0, 200)) : [],
  };
}

/**
 * Gate decision over one Playwright JSON report. Null passes; any string
 * refuses FULL readiness with the reason.
 */
export function refuseBrowserReport(a) {
  if (!a) return 'no browser report produced';
  if (!a.complete) return a.parseError ?? 'incomplete browser report; refusing silent PASS';
  if (a.runnerErrors.length) return `browser runner errors: ${a.runnerErrors[0]}`;
  if (a.totals.tests === 0) return 'zero browser tests discovered: nothing verified; refusing silent PASS';
  if (a.missingSuites.length) return `mandatory browser suite missing: ${a.missingSuites.join('; ')}`;
  if (a.totals.failed > 0) {
    const names = (a.failedTests ?? [])
      .slice(0, 3)
      .map((f) => `[${f.project}] ${f.file}: ${String(f.title).slice(-140)}`)
      .join('; ');
    const more = (a.failedTests?.length ?? 0) > 3 ? ` (+${a.failedTests.length - 3} more)` : '';
    return `${a.totals.failed} mandatory browser test(s) failed${names ? `: ${names}${more}` : ''}; refusing silent PASS`;
  }
  if (a.totals.flaky > 0) return `${a.totals.flaky} flaky browser test(s); refusing silent PASS`;
  if ((a.stats.unexpected ?? 0) > 0) return `${a.stats.unexpected} unexpected browser result(s); refusing silent PASS`;
  if (a.unknownSkips.length) {
    const s = a.unknownSkips[0];
    return `mandatory browser test skipped with no policy cover: [${s.project}] ${String(s.title).slice(0, 120)}; refusing silent PASS`;
  }
  // Runner-summary integrity is the last gate: every refusal above already
  // fails closed, and an internally consistent report must also agree with
  // its own summary here. A report with one expected result but
  // `expected: 0` (or any totals/stats disagreement) is contradictory
  // evidence, never a pass.
  if (!a.statsComplete) return 'browser runner summary is missing or truncated (expected/skipped/unexpected/flaky); refusing silent PASS';
  if (!a.statsConsistent) {
    return `contradictory browser summary (stats expected=${a.stats.expected} skipped=${a.stats.skipped} unexpected=${a.stats.unexpected} flaky=${a.stats.flaky} vs discovered passed=${a.totals.passed} failed=${a.totals.failed} skipped=${a.totals.skipped} flaky=${a.totals.flaky} of ${a.totals.tests}); refusing silent PASS`;
  }
  return null;
}

/**
 * Compose the human-readable tail for a nonzero Playwright run. The exit
 * status is always preserved; when the partial JSON accounts cleanly (every
 * mandatory suite present, zero failures/skips/flakes) the failure is an
 * infrastructure one, not a test failure, and the stderr is surfaced so the
 * real cause is visible. Never turns a nonzero exit into a pass.
 */
export function describeRunnerFailure({ label, exit, accounting, stderr, stream = 'stderr' }) {
  const detail = accounting
    ? (refuseBrowserReport(accounting) ?? `Playwright exited ${exit} with an otherwise clean account (runner/infrastructure failure, not a test failure)`)
    : 'no partial Playwright JSON was produced';
  const err = String(stderr ?? '').split('\n').map((s) => s.trim()).filter(Boolean).slice(-4).join(' ').slice(0, 300);
  return `${label} runner failed (exit ${exit}): ${detail}${err ? ` | ${stream}: ${err}` : ''}`;
}
function claimFreePort() {
  return new Promise((res, rej) => {
    const srv = createNetServer();
    srv.once('error', rej);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

/**
 * FULL-profile browser matrix (Stage B). Serves the release-built dist/ on
 * a dedicated loopback astro preview (never a possibly stale shared port),
 * runs the seven dist-suites against it with JSON accounting, then runs
 * candidate-host against the exact staged candidate with digest
 * attestation. Both reports must pass with zero unknown skips; either
 * failure refuses FULL readiness before any pointer moves.
 */
/**
 * Resolve the build-artifact digest the browser accounting must report.
 *
 * An explicitly supplied `distSha` is authoritative (the caller already
 * digested the exact artifact it built). Otherwise the digest is computed from
 * the release dist directory. A digest that cannot be computed is an explicit
 * failure -- never a null or stale identity invented to fill the field.
 */
export function resolveMatrixDistDigest(distSha, { distDir = join(ROOT, 'dist'), digest = computeDigest } = {}) {
  if (distSha !== null && distSha !== undefined && String(distSha).trim() !== '') {
    return { ok: true, sha256: String(distSha) };
  }
  try {
    return { ok: true, sha256: digest(distDir).sha256 };
  } catch (error) {
    return {
      ok: false,
      reason: `build-artifact digest unavailable for ${distDir}: ${String(error?.message ?? error).slice(0, 160)}`,
    };
  }
}

export async function runBrowserMatrix(env, { candidateDir, candidateSha, stagingRoot, distSha = null } = {}) {
  const empty = { matrix: null, candidateHost: null };
  const fail = (tail, extra = {}) => ({ ok: false, exit: 1, tail, skips: [], accounting: { ...empty, ...extra } });
  // One effective digest for every returned branch: the value the accounting
  // reports IS the artifact identity this matrix ran against. A digest that
  // cannot be established refuses the matrix instead of reporting `null`.
  const distDigest = resolveMatrixDistDigest(distSha);
  if (!distDigest.ok) {
    return fail(`browser matrix refused: ${distDigest.reason} -- no verified artifact identity to account against`);
  }
  const distShaFinal = distDigest.sha256;
  const port = await claimFreePort();
  const base = `http://127.0.0.1:${port}`;
  // Single command string with shell:true: .cmd shims (Windows) execute
  // without EINVAL, and no separate args array means no shell-splice risk.
  const preview = spawn(`npx astro preview --port ${port} --host 127.0.0.1`,
    { cwd: ROOT, env, stdio: 'pipe', shell: true, detached: process.platform !== 'win32' });
  // shell:true means the real server is a GRANDCHILD (cmd.exe -> npx -> astro),
  // so killing the wrapper pid alone leaves `astro preview` listening on the
  // loopback port after the run ends. Terminate the whole tree instead: on
  // Windows `taskkill /T`, elsewhere the child's own process group. Both are
  // best-effort -- a no-op when the tree already exited. Never risks an
  // unrelated process: only this spawned pid's tree is targeted.
  const stopPreview = () => {
    const pid = preview.pid;
    if (Number.isInteger(pid)) {
      try {
        if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
        else process.kill(-pid, 'SIGKILL');
      } catch {
        try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
      }
    }
    try { preview.kill('SIGKILL'); } catch { /* already gone */ }
  };
  try {
    const ready = Date.now() + 90000;
    for (;;) {
      try {
        const res = await fetch(`${base}/`);
        if (res.status === 200) break;
      } catch { /* not up yet */ }
      if (Date.now() > ready) { stopPreview(); return fail(`preview server on ${base} never became ready (dist/ unservable)`); }
      await new Promise((r) => setTimeout(r, 1000));
    }
    const matrixEnv = { ...env, SAI_TEST_BASE_URL: base };
    let matrixOut;
    try {
      matrixOut = execSync(`npx playwright test ${BROWSER_MATRIX_SPECS.join(' ')} --reporter=json`,
        { cwd: ROOT, stdio: 'pipe', timeout: 900000, maxBuffer: 64 * 1024 * 1024, env: matrixEnv }).toString();
    } catch (error) {
      const partial = String(error?.stdout ?? '');
      // Same matrix-only expectation as the success path: candidate-host is
      // verified separately, so a nonzero dist-matrix run must never be
      // reported as "candidate-host absent".
      const matrix = partial ? accountPlaywrightJson(partial, { expected: BROWSER_MATRIX_EXPECTED }) : null;
      const exit = Number(error?.status ?? 1);
      stopPreview();
      return {
        ok: false, exit,
        tail: describeRunnerFailure({ label: 'browser matrix', exit, accounting: matrix, stderr: error?.stderr ?? error?.message ?? error }),
        skips: matrix?.skips ?? [], accounting: { matrix, candidateHost: null, distSha: distShaFinal },
      };
    }
    const matrix = accountPlaywrightJson(matrixOut, { expected: BROWSER_MATRIX_EXPECTED });
    const matrixRefusal = refuseBrowserReport(matrix);
    if (matrixRefusal) { stopPreview(); return fail(`browser matrix: ${matrixRefusal}`, { matrix, distSha: distShaFinal }); }
    const hostEnv = {
      ...matrixEnv,
      SAI_CANDIDATE_DIR: candidateDir,
      SAI_CANDIDATE_STAGING_ROOT: stagingRoot,
      SAI_EXPECT_SHA: candidateSha,
    };
    let hostOut;
    try {
      hostOut = execSync('npx playwright test tests/candidate-host.spec.mjs --project=chromium --reporter=json',
        { cwd: ROOT, stdio: 'pipe', timeout: 600000, maxBuffer: 64 * 1024 * 1024, env: hostEnv }).toString();
    } catch (error) {
      const partial = String(error?.stdout ?? '');
      const candidateHost = partial ? accountPlaywrightJson(partial, { expected: CANDIDATE_HOST_EXPECTED }) : null;
      const exit = Number(error?.status ?? 1);
      stopPreview();
      return {
        ok: false, exit,
        tail: describeRunnerFailure({ label: 'candidate-host', exit, accounting: candidateHost, stderr: error?.stderr ?? error?.message ?? error }),
        skips: candidateHost?.skips ?? [], accounting: { matrix, candidateHost, distSha: distShaFinal },
      };
    }
    stopPreview();
    const candidateHost = accountPlaywrightJson(hostOut, { expected: CANDIDATE_HOST_EXPECTED });
    const hostRefusal = refuseBrowserReport(candidateHost);
    if (hostRefusal) return fail(`candidate-host: ${hostRefusal}`, { matrix, candidateHost, distSha: distShaFinal });
    const totals = {
      tests: matrix.totals.tests + candidateHost.totals.tests,
      passed: matrix.totals.passed + candidateHost.totals.passed,
      failed: 0, skipped: matrix.totals.skipped + candidateHost.totals.skipped, flaky: 0,
    };
    return {
      ok: true, exit: 0,
      skips: [...matrix.skips, ...candidateHost.skips],
      accounting: { matrix, candidateHost, distSha: distShaFinal, totals },
    };
  } catch (error) {
    stopPreview();
    return fail(`browser matrix infrastructure failure: ${String(error?.message ?? error).slice(0, 250)}`);
  }
}

/**
 * Engine gate with structured skip accounting. Each suite file runs as its
 * own `node --test` invocation so the TAP report binds to a known file
 * identity (TAP carries no file markers) and a zero-test or broken file
 * cannot hide inside a larger aggregate. Any skipped mandatory test,
 * failure, cancellation, contradiction, truncation, or empty run FAILs;
 * any nonzero runner exit FAILs regardless of partial output.
 */
export function runEngineGate(env, files, { registry = ENGINE_SUITE_FILES, distDir = null } = {}) {
  const list = files === undefined ? [...registry] : (Array.isArray(files) ? files : String(files).split(' ').filter(Boolean));
  const emptyAccounting = { files: [], totals: { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, skips: [] };
  const fail = (tail, extra = {}) => ({
    ok: false, exit: 1, tail, skips: [], accounting: { ...emptyAccounting, ...extra },
  });
  const unregistered = list.filter((f) => !registry.includes(f));
  if (unregistered.length) {
    return fail(`unregistered engine suite(s): ${unregistered.join(', ')} -- register in ENGINE_SUITE_FILES or remove`);
  }
  const missing = list.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    return fail(`test discovery failed: ${missing.join(', ')} not found`);
  }
  // Artifact selection is independent of the test-runner working directory.
  // Suites are always executed FROM ROOT with ROOT-relative paths (discovery
  // and execution must agree); an explicitly selected build artifact is
  // handed to the suite through the SAI_RELEASE_ARTIFACT_DIR contract. Using
  // the artifact as cwd made every registered suite unresolvable: discovery
  // resolved relative to ROOT while execution searched inside dist/.
  let artifactDir = null;
  if (distDir !== null && distDir !== undefined) {
    artifactDir = resolve(String(distDir));
    let isDir = false;
    try { isDir = statSync(artifactDir).isDirectory(); } catch { isDir = false; }
    if (!isDir) {
      return fail(`selected release artifact is missing or not a directory: ${artifactDir} -- refusing to fall back to a stale ROOT/dist`);
    }
  }
  const perFile = [];
  const totals = { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const skips = [];
  for (const f of list) {
    const runEnv = artifactDir
      ? { ...env, SAI_RELEASE_ARTIFACT_DIR: artifactDir }
      : env;
    const runCwd = ROOT;
    let out;
    try {
      out = execSync(`node --test --test-reporter=tap ${f}`, { cwd: runCwd, stdio: 'pipe', timeout: 600000, env: runEnv }).toString();
    } catch (error) {
      const partial = accountEngineTap(String(error?.stdout ?? ''), { file: f });
      const tail = String(error?.stdout ?? error?.stderr ?? error?.message ?? error).split('\n').slice(-4).join(' ').slice(0, 300);
      return {
        ok: false, exit: Number(error?.status ?? 1),
        tail: `suite ${f} runner failed (exit ${Number(error?.status ?? 1)}): ${tail}`,
        skips: partial.skipLines,
        accounting: { files: perFile, totals, skips },
      };
    }
    const a = accountEngineTap(out, { file: f });
    perFile.push({
      file: f, total: a.total, pass: a.pass, fail: a.fail,
      cancelled: a.cancelled, skipped: a.skipped, todo: a.todo,
      complete: a.complete, consistent: a.consistent,
      unknownSkips: a.unknownSkips.map((s) => s.name),
    });
    const refusal = refuseEngineSuite(a);
    if (refusal) {
      return {
        ok: false, exit: 1, tail: `suite ${f}: ${refusal}`,
        skips: a.skipLines, accounting: { files: perFile, totals, skips },
      };
    }
    totals.tests += a.total ?? 0;
    totals.pass += a.pass ?? 0;
    totals.fail += a.fail ?? 0;
    totals.cancelled += a.cancelled ?? 0;
    totals.skipped += a.skipped ?? 0;
    totals.todo += a.todo ?? 0;
    for (const s of a.skips) skips.push(s);
  }
  return { ok: true, exit: 0, skips: skips.map((s) => `${s.name} # SKIP ${s.reason}`), accounting: { files: perFile, totals, skips } };
}

const STATIC_GATES = [
  'node scripts/lint-styles.mjs',
  'node scripts/validate-themes.mjs',
  'node scripts/validate-canonical.mjs',
  'node scripts/validate-content.mjs',
  'node scripts/validate-registry.mjs',
  'node scripts/validate-baselines.mjs',
  'node scripts/validate-licenses.mjs',
  'npm run validate:media',
  'node scripts/audit-build.mjs',
  'node scripts/i18n.mjs validate',
];

async function main(argv) {
  const profile = argv.includes('--profile=full') ? 'full' : 'candidate';
  const evidence = {
    tool: 'release-candidate',
    verdict: 'FAIL',
    failedStage: null,
    origin: null,
    slug: null,
    storeId: null,
    storeKind: null,
    migratedFrom: null,
    profile,
    readinessClaim: VERIFICATION_PROFILES[profile].readinessClaim,
    gateContract: GATE_CONTRACT_VERSION,
    engineSkips: [],
    git: gitInfo(),
    package: null,
    protocol: null,
    gates: [],
    releaseVerify: null,
    candidateVerify: null,
    smoke: null,
    projection: null,
    candidate: null,
    previousPreserved: false,
    publicationAuthorized: false,
    external: ['hosting', 'dns', 'https', 'redirects', 'search-indexing', 'publication-authorization', 'translation-approvals'],
  };
  try {
    evidence.package = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    const meta = JSON.parse(readFileSync(join(ROOT, 'src/data/canonical/meta.json'), 'utf8'));
    evidence.protocol = { version: meta.version, commit: meta.commit };
  } catch { /* gates below will report */ }

  // ---- 0. environment contract (BLOCKED, before any heavy work) --------------
  const envCheck = validateCandidateEnv(process.env);
  if (!envCheck.ok) {
    evidence.verdict = 'BLOCKED';
    evidence.failedStage = 'env-contract';
    return finish(evidence, `BLOCKED at env-contract: ${envCheck.reason}`);
  }
  const origin = envCheck.origin;
  evidence.origin = origin;
  evidence.slug = slugForOrigin(origin);
  evidence.storeId = storeIdForOrigin(origin);
  const buildEnv = { ...process.env, SAI_SITE_ORIGIN: origin, SAI_RELEASE_BUILD: '1', SAI_RELEASE_ORIGIN_ACK: origin };

  // ---- 0b. store resolution: migrate legacy slugs, refuse foreign ownership --
  let base;
  try {
    const resolved = resolveCandidateStore(ROOT, origin);
    evidence.storeKind = resolved.kind;
    if (resolved.kind === 'legacy') {
      const migrated = importLegacyStore(ROOT, origin);
      evidence.migratedFrom = relative(ROOT, join(ROOT, '.site-work', 'release', 'candidates', slugForOrigin(origin))).split(sep).join('/');
      evidence.storeKind = migrated.migrated ? 'store (migrated)' : 'store';
      base = migrated.dir;
    } else {
      base = resolved.dir;
    }
    checkStoreOwnership(base, origin);
  } catch (error) {
    evidence.failedStage = 'store-ownership';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at store-ownership: ${String(error?.message ?? error).slice(0, 250)}`);
  }

  // Pre-build gates (doctor, static checks, fixture-based unit tests) run
  // unlocked: they never modify shared build state, and the engine suite
  // itself contains the lock-refusal control, which needs an unlocked
  // factory to demonstrate the contention honestly.
  return await runFactory(argv, { evidence, origin, buildEnv, base, profile });
}

async function runFactory(argv, { evidence, origin, buildEnv, base, profile }) {
  // ---- 1-2. source/content health (refuse drift) -------------------------------
  const doctor = runGate('node scripts/site.mjs doctor', process.env);
  evidence.gates.push({ id: 'site:doctor', ...doctor });
  if (!doctor.ok) {
    evidence.failedStage = 'source-health';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at source-health: site:doctor exit ${doctor.exit}; refusing to build on drift`);
  }

  // ---- 3. static validation ----------------------------------------------------
  for (const cmd of STATIC_GATES) {
    const r = runGate(cmd, process.env);
    evidence.gates.push({ id: cmd.replace(/^node scripts\//, '').replace(/^npm run /, '').replace(/\.mjs.*$/, ''), ...r });
    if (!r.ok) {
      evidence.failedStage = 'static-gates';
      evidence.verdict = 'FAIL';
      return finish(evidence, `FAIL at static-gates: ${cmd} exit ${r.exit}: ${r.tail}`);
    }
  }
  // Engine tests are split by prerequisite (Stage C): dist-independent files
  // (self-contained fixtures) prove the tooling BEFORE the build and never
  // consume yesterday's dist/; build-dependent files run AFTER the release
  // build below, against the artifact generated during THIS run.
  // A skipped mandatory test is a FAIL, never a silent PASS — only the
  // explicitly authorized S10 symlink-construction skip is tolerated, and
  // only from its own suite file with its exact approved reason.
  const preBuildSuites = resolveEngineSuites({ includeBuildDependent: false });
  if (!preBuildSuites.ok) {
    evidence.gates.push({ id: 'test:engine', ok: false, exit: 1, tail: preBuildSuites.error });
    evidence.failedStage = 'static-gates';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at static-gates: test:engine suite identity: ${preBuildSuites.error}`);
  }
  const engine = runEngineGate(process.env, preBuildSuites.files);
  evidence.gates.push({ id: 'test:engine', ok: engine.ok, exit: engine.exit, tail: engine.tail });
  evidence.engineSkips = engine.skips;
  evidence.engineAccounting = engine.accounting ?? null;
  if (!engine.ok) {
    evidence.failedStage = 'static-gates';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at static-gates: test:engine exit ${engine.exit}: ${engine.tail}`);
  }
  if (profile === 'full') {
    // Type safety is a release-readiness gate: a failed type check can never
    // produce full-readiness status (regression C4).
    const check = runGate('npx astro check', process.env);
    evidence.gates.push({ id: 'check', ...check });
    if (!check.ok) {
      evidence.failedStage = 'static-gates';
      evidence.verdict = 'FAIL';
      return finish(evidence, `FAIL at static-gates: astro check exit ${check.exit}: ${check.tail}`);
    }
  }

  // ---- 3b. exclusive factory lock (second concurrent run is refused) --------
  // Acquired immediately before shared build state is touched (dist/,
  // .site-work/release/, reports/) and held through promotion. Pre-build
  // gates above are read-only or fixture-local and run without the lock.
  let releaseLock = null;
  try {
    releaseLock = acquireReleaseLock(ROOT);
  } catch (error) {
    evidence.failedStage = 'factory-lock';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at factory-lock: ${String(error?.message ?? error).slice(0, 250)}`);
  }
  try {
    return await runLockedFactory({ evidence, origin, buildEnv, base, profile });
  } finally {
    releaseLock();
  }
}

/**
 * Locked build/promotion transaction. Order is the release contract:
 * BUILD -> ARTIFACT VALIDATION -> PUBLIC PROJECTION -> CANDIDATE
 * VERIFICATION -> LOCAL SMOKE -> REQUIRED BROWSER GATES -> DUAL-ORIGIN
 * VERIFICATION -> FINAL STAGED-DIGEST RECHECK -> COMMIT GENERATION ->
 * COMMIT READ-BACK -> EVIDENCE. The authoritative pointer moves only in
 * the COMMIT step; every earlier failure leaves it unchanged.
 *
 * The `deps` seam swaps stage implementations for deterministic
 * failure-injection tests (no builds required); production uses the real
 * gates. `root` scopes evidence output for tests.
 */
export async function runLockedFactory({ evidence, origin, buildEnv, base, profile, deps = {}, root = ROOT, builtDistDir = null }) {
  const D = {
    runGate,
    engineGate: runEngineGate,
    browserMatrix: runBrowserMatrix,
    rotateSnapshots,
    verifyRelease,
    probeCandidate,
    projectPublicCandidate,
    computeDigest,
    ...deps,
  };
  // Deterministic artifact source for injected full-profile runs.
  // A real production invocation leaves this null, so the factory still
  // builds and verifies ROOT/dist; an injected run can point at a disposable
  // directory so the suite stays independent of any prebuilt production dist.
  // The seam is test-only: it is honoured only alongside an explicit `deps`
  // injection, so it can never become a production build bypass.
  if (builtDistDir && Object.keys(deps).length === 0) {
    throw new Error('builtDistDir is a test-only artifact seam: an explicit deps injection is required (refusing an uncontrolled production build bypass)');
  }
  const distSrc = builtDistDir ?? join(ROOT, 'dist');
  // ---- 4. release build ----------------------------------------------------------
  const built = builtDistDir
    ? { ok: true, exit: 0 }
    : D.runGate('npx astro build', buildEnv);
  evidence.gates.push({ id: 'astro-build', ...built });
  if (!built.ok) {
    evidence.failedStage = 'build';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at build: astro build exit ${built.exit}: ${built.tail}`, root);
  }

  // ---- 5. release-mode verification ----------------------------------------------
  const dist = builtDistDir ?? join(ROOT, 'dist');
  const releaseResult = await D.verifyRelease({ dist, env: buildEnv, release: true, root });
  evidence.releaseVerify = { verdict: releaseResult.verdict, failing: releaseResult.checks.filter((c) => c.status !== 'PASS').map((c) => c.id) };
  if (releaseResult.verdict !== 'PASS') {
    evidence.failedStage = 'release-verify';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at release-verify: ${evidence.releaseVerify.failing.join(', ')}`, root);
  }

  // ---- 5b. build-dependent integration tests (fresh artifact, this run) --------
  // These declare a real production build as prerequisite, so they run here:
  // the dist/ they inspect was generated above, never inherited. A failed
  // build (stage 4) never reaches this gate, and a skip here is a FAIL.
  // Injected full-profile runs supply `builtDistDir` so this gate inspects
  // the same disposable artifact the verifier just checked instead of the
  // repository's production dist/.
  const postBuild = D.engineGate(
    { ...process.env, SAI_RELEASE_BUILD: '1', SAI_SITE_ORIGIN: origin, SAI_RELEASE_ARTIFACT_DIR: dist },
    BUILD_DEPENDENT_TESTS.join(' '),
    { distDir: dist },
  );
  evidence.gates.push({ id: 'test:engine-build', ok: postBuild.ok, exit: postBuild.exit, tail: postBuild.tail });
  evidence.engineSkips = [...evidence.engineSkips, ...postBuild.skips];
  evidence.engineBuildAccounting = postBuild.accounting ?? null;
  if (!postBuild.ok) {
    evidence.failedStage = 'static-gates';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at static-gates: test:engine-build exit ${postBuild.exit}: ${postBuild.tail}`, root);
  }

  // ---- 6. project + verify public candidate (into next/, never current/) -----------
  const nextDir = join(base, 'next');
  let projection;
  try {
    projection = D.projectPublicCandidate({ srcDir: dist, destDir: nextDir, root, ownedDirs: [nextDir] });
  } catch (error) {
    evidence.failedStage = 'project';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at project: ${String(error?.message ?? error).slice(0, 200)}`, root);
  }
  evidence.projection = { removed: projection.removed.length, scrubbed: projection.scrubbed, files: projection.files };
  const candidateResult = await D.verifyRelease({ dist: nextDir, env: buildEnv, release: true, public: true, root });
  evidence.candidateVerify = { verdict: candidateResult.verdict, failing: candidateResult.checks.filter((c) => c.status !== 'PASS').map((c) => c.id) };
  if (candidateResult.verdict !== 'PASS') {
    evidence.failedStage = 'candidate-verify';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at candidate-verify: ${evidence.candidateVerify.failing.join(', ')} (previous verified candidate untouched)`, root);
  }

  // ---- 7. loopback smoke ------------------------------------------------------------
  const smoke = await D.probeCandidate(nextDir, origin);
  evidence.smoke = { verdict: smoke.verdict, failing: smoke.checks.filter((c) => c.status !== 'PASS').map((c) => c.id) };
  if (smoke.verdict !== 'LOCAL_STATIC_HOST_PASS') {
    evidence.failedStage = 'smoke';
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at smoke: ${evidence.smoke.failing.join(', ')} (previous verified candidate untouched)`, root);
  }

  // ---- 8. full-profile browser matrix (this run's artifacts only) -------------
  // The seven dist-suites run against the stage-4 release build served on a
  // dedicated loopback preview; candidate-host serves the exact staged
  // next/ tree with digest attestation (never a fresh projection). Any
  // browser failure refuses full readiness and the committed generation is
  // never advanced on failure. The staged digest is recorded BEFORE the
  // matrix so the candidate-host attestation binds to verified bytes.
  const stagedDigest = D.computeDigest(nextDir);
  evidence.stagedDigest = { files: stagedDigest.files, sha256: stagedDigest.sha256 };
  if (profile === 'full') {
    // The artifact identity the browser matrix must account against: the
    // exact directory this run built/selected. A digest that cannot be
    // computed is an explicit failure, never a silently absent identity.
    let matrixDistSha;
    try {
      matrixDistSha = D.computeDigest(distSrc).sha256;
    } catch (error) {
      evidence.failedStage = 'browser-matrix';
      evidence.verdict = 'FAIL';
      evidence.commitState = 'NOT_COMMITTED';
      return finish(evidence, `FAIL at browser-matrix: build-artifact digest unavailable for ${distSrc}: ${String(error?.message ?? error).slice(0, 200)} (committed generation untouched)`, root);
    }
    evidence.matrixDist = { sha256: matrixDistSha };
    const browser = await D.browserMatrix(buildEnv, { candidateDir: nextDir, candidateSha: stagedDigest.sha256, stagingRoot: base, distSha: matrixDistSha });
    evidence.gates.push({ id: 'test:browser-matrix', ok: browser.ok, exit: browser.exit, tail: browser.tail });
    evidence.browserAccounting = browser.accounting ?? null;
    if (!browser.ok) {
      evidence.failedStage = 'browser-matrix';
      evidence.verdict = 'FAIL';
      evidence.commitState = 'NOT_COMMITTED';
      return finish(evidence, `FAIL at browser-matrix: exit ${browser.exit}: ${browser.tail} (committed generation untouched)`, root);
    }
    // The accounting the matrix returned must name the artifact this run
    // digested. A divergent (stale/foreign) digest means the browser tests
    // inspected something other than the verified build: refuse FULL before
    // any pointer can move.
    const accountedSha = browser.accounting?.distSha ?? null;
    if (accountedSha !== matrixDistSha) {
      evidence.failedStage = 'browser-matrix';
      evidence.verdict = 'FAIL';
      evidence.commitState = 'NOT_COMMITTED';
      return finish(evidence, `FAIL at browser-matrix: browser accounting names artifact ${String(accountedSha).slice(0, 16) || 'null'} but this run digested ${matrixDistSha.slice(0, 16)} (stale/foreign artifact; committed generation untouched)`, root);
    }
  }

  // ---- 9. full-profile dual-origin BEFORE promotion ---------------------------
  // Dual-origin rebuilds dist/ twice in its own workspace, so the recheck
  // below proves staging survived untouched. A dual-origin failure returns
  // BEFORE any pointer moves (Stage A transaction contract).
  if (profile === 'full') {
    const dual = D.runGate('node scripts/release-dual-origin.mjs', process.env);
    evidence.gates.push({ id: 'release:dual-origin', ...dual });
    if (!dual.ok) {
      evidence.failedStage = 'dual-origin';
      evidence.verdict = 'FAIL';
      evidence.commitState = 'NOT_COMMITTED';
      return finish(evidence, `FAIL at dual-origin: exit ${dual.exit}: ${dual.tail} (authoritative pointer unchanged; staged candidate not committed)`, root);
    }
    evidence.distLeftAs = 'dual-origin work area (rebuild to restore the development artifact)';
  }

  // ---- 10. final staged-digest recheck (staging must be byte-identical) ------
  // Guards against workspace interference (dual-origin rebuilds dist/): the
  // committed bytes must equal the bytes every gate above verified. Never
  // promote a mutated or fixture-origin staging tree.
  const finalDigest = D.computeDigest(nextDir);
  if (finalDigest.sha256 !== stagedDigest.sha256) {
    evidence.failedStage = 'staged-digest';
    evidence.verdict = 'FAIL';
    evidence.commitState = 'NOT_COMMITTED';
    return finish(evidence, 'FAIL at staged-digest: staged candidate changed after verification (expected ' + stagedDigest.sha256.slice(0, 16) + ', found ' + finalDigest.sha256.slice(0, 16) + '); authoritative pointer unchanged', root);
  }

  // ---- 11. authoritative promotion (pointer moves ONLY here) ------------------
  // One shared degraded-report path: the generation IS committed but the
  // run was not clean, so the verdict stays FAIL with recovery evidence.
  const finishDegraded = (failedStage, generation, sha256, note) => {
    let repair = null;
    try {
      repair = repairCompatViews(base);
    } catch (repairError) {
      repair = { error: String(repairError?.message ?? repairError).slice(0, 200) };
    }
    evidence.commitState = 'POSTCOMMIT_DEGRADED';
    evidence.candidate = {
      directory: relative(root, join(base, 'current')).split(sep).join('/'),
      generation,
      store: relative(root, base).split(sep).join('/'),
      files: finalDigest.files,
      sha256,
      viewsDegraded: true,
    };
    evidence.recovery = { repairAttempted: true, views: repair, hint: 'run npm run release:doctor, then re-run the explicit view repair until views report ok' };
    evidence.previousPreserved = readPointer(base, 'previous') !== null;
    evidence.failedStage = failedStage;
    evidence.verdict = 'FAIL';
    return finish(evidence, `FAIL at ${failedStage}: generation ${generation} IS committed (pointer moved) but ${note}; committed bytes durable, views need repair`, root);
  };
  const finishUncertain = (failedStage, detail) => {
    evidence.failedStage = failedStage;
    evidence.verdict = 'FAIL';
    evidence.commitState = 'COMMIT_STATE_UNCERTAIN';
    return finish(evidence, `FAIL at ${failedStage}: ${detail}; authoritative state could not be verified -- inspect current.json and generations/ before any retry`, root);
  };
  let current;
  let previous;
  try {
    ({ current, previous } = D.rotateSnapshots(base, { digest: finalDigest, origin }));
  } catch (error) {
    if (isPostcommitDegraded(error)) {
      return finishDegraded('promote-views', error.generation, error.sha256, `the ${error.failedView}/ view refresh failed`);
    }
    // Ambiguous generic error: prefer observed filesystem facts over the
    // exception category. A lost write acknowledgement must never be
    // reported as NOT_COMMITTED when the pointer actually advanced.
    const reconciled = reconcileCommitState(base, { expectedDigest: finalDigest });
    if (reconciled.state === 'COMMITTED') {
      return finishDegraded('promote', reconciled.generation, reconciled.sha256, `an ambiguous promotion error followed the pointer move (${String(error?.message ?? error).slice(0, 160)})`);
    }
    if (reconciled.state === 'COMMIT_STATE_UNCERTAIN') {
      return finishUncertain('promote', `ambiguous promotion error (${String(error?.message ?? error).slice(0, 160)}); ${reconciled.detail}`);
    }
    evidence.failedStage = 'promote';
    evidence.verdict = 'FAIL';
    evidence.commitState = 'NOT_COMMITTED';
    return finish(evidence, `FAIL at promote: ${String(error?.message ?? error).slice(0, 250)} (committed generation untouched)`, root);
  }
  // Read-back: the committed pointer must select the digest-verified
  // generation. rotateSnapshots returned, so the pointer moved -- a
  // mismatch here is postcommit degradation or uncertainty, never
  // NOT_COMMITTED.
  const pointer = readPointer(base, 'current');
  const genDir = join(base, 'generations', pointer?.generation ?? '');
  if (!pointer || !verifyDigest(genDir, finalDigest.sha256) || !verifyDigest(current, finalDigest.sha256)) {
    const reconciled = reconcileCommitState(base, { expectedDigest: finalDigest });
    if (reconciled.state === 'COMMITTED') {
      return finishDegraded('promote-verify', reconciled.generation, reconciled.sha256, 'the final read-back found unverifiable view bytes while the committed generation verifies');
    }
    if (reconciled.state === 'NOT_COMMITTED') {
      evidence.failedStage = 'promote-verify';
      evidence.verdict = 'FAIL';
      evidence.commitState = 'NOT_COMMITTED';
      return finish(evidence, 'FAIL at promote-verify: pointer no longer selects the promoted generation (committed generation untouched)', root);
    }
    return finishUncertain('promote-verify', `committed generation read-back digest mismatch; ${reconciled.detail}`);
  }
  evidence.previousPreserved = existsSync(previous) || readPointer(base, 'previous') !== null;
  evidence.commitState = 'COMMITTED';
  evidence.candidate = {
    directory: relative(root, current).split(sep).join('/'),
    generation: pointer.generation,
    store: relative(root, base).split(sep).join('/'),
    files: finalDigest.files,
    sha256: finalDigest.sha256,
  };
  evidence.verdict = 'PASS';
  return finish(evidence, null, root, { writeReceipt: D.writeReceipt });
}

/**
 * Immutable generation-specific verification receipt (Stage F).
 *
 * The mutable per-origin report is a latest-attempt summary; THIS file is
 * the authority for historical readiness. Keyed by generation id, written
 * once: an existing PASS receipt is never overwritten by a later attempt,
 * so a subsequent failure cannot destroy the proof that an earlier
 * generation passed. A later PASS for a generation whose only receipt is
 * a FAIL is still recorded (the generation did pass eventually).
 *
 * @returns {{ path: string|null, preserved: boolean }}
 *   preserved is true when an existing PASS receipt was kept.
 */
export function writeGenerationReceipt(root, storeId, generation, record) {
  if (!storeId || !generation || !record) return { path: null, preserved: false };
  const relDir = join('reports', 'release', 'candidates', storeId);
  const dir = join(root, relDir);
  const legacy = join(dir, generationLegacyName(generation));
  // Immutable record layout: generation -> verification contract -> run
  // identity. A newer gate contract always gets its own slot; a
  // re-verification under a changed tree gets a new run slot while the old
  // slot stays readable; re-running the same verification is idempotent.
  // The legacy name mirrors the newest verified record for existing
  // consumers (selection prefers versioned records).
  const contract = record.gateContract ?? 'unknown';
  const runId = generationRunId(record);
  const versioned = join(dir, generationVersionedName(generation, contract, runId));
  mkdirSync(dir, { recursive: true });
  const isFullPass = (r) => r?.verdict === 'PASS' && r?.readiness === 'FULL_RELEASE_READY';
  const readJson = (p) => {
    try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return undefined; }
  };
  const priorLegacy = readJson(legacy);
  const sameSlot = listVersionedReceipts(join(root, 'reports', 'release', 'candidates'), storeId, generation, contract)
    .filter((c) => c.receipt.sha256 === record.sha256);
  if (sameSlot.some((c) => isFullPass(c.receipt))) {
    // A passing record for these exact bytes under this contract already
    // stands: keep history (a later FAIL must never destroy the proof) and
    // repair the legacy pointer only when it holds nothing passing.
    if (!isFullPass(priorLegacy)) {
      const best = sameSlot.find((c) => isFullPass(c.receipt));
      try { writeFileSync(legacy, `${JSON.stringify(best.receipt, null, 2)}\n`); } catch { /* pointer repair is best-effort */ }
    }
    return { path: legacy, preserved: true };
  }
  if (!isFullPass(record)) {
    // A failed verification is recorded in its own run slot but never
    // replaces successful historical evidence anywhere.
    if (!existsSync(versioned)) {
      writeFileSync(versioned, `${JSON.stringify(record, null, 2)}\n`);
    }
    if (priorLegacy === undefined) {
      writeFileSync(legacy, `${JSON.stringify(record, null, 2)}\n`);
      return { path: legacy, preserved: false };
    }
    return { path: legacy, preserved: true };
  }
  // New FULL record: immutable in its run slot...
  writeFileSync(versioned, `${JSON.stringify(record, null, 2)}\n`);
  // ...and mirrored to the legacy pointer, preserving history first: an
  // older-contract PASS moves to its versioned slot before the pointer
  // advances, and a same-contract predecessor is never lost because its
  // own run slot already holds it.
  if (isFullPass(priorLegacy) && priorLegacy.gateContract !== contract) {
    const backfill = join(dir, generationVersionedName(generation, priorLegacy.gateContract ?? 'unknown', generationRunId(priorLegacy)));
    if (!existsSync(backfill)) {
      writeFileSync(backfill, `${JSON.stringify(priorLegacy, null, 2)}\n`);
    }
  }
  writeFileSync(legacy, `${JSON.stringify(record, null, 2)}\n`);
  return { path: legacy, preserved: false };
}

/** Generation receipt body: the exact binding a FULL claim rests on. */
function generationReceiptFor(evidence) {
  const gateResults = {};
  for (const g of evidence.gates ?? []) gateResults[g.id] = g.ok === true;
  const engine = evidence.engineAccounting?.totals ?? null;
  const engineBuild = evidence.engineBuildAccounting?.totals ?? null;
  const browser = evidence.browserAccounting?.totals ?? null;
  return {
    tool: 'release-candidate',
    receiptKind: 'generation-readiness',
    gateContract: GATE_CONTRACT_VERSION,
    origin: evidence.origin,
    storeId: evidence.storeId,
    generation: evidence.candidate.generation,
    sha256: evidence.candidate.sha256,
    files: evidence.candidate.files,
    source: evidence.git ?? null,
    package: evidence.package ?? null,
    protocol: evidence.protocol ?? null,
    profile: evidence.profile,
    verdict: evidence.verdict,
    readiness: evidence.readiness,
    commitState: evidence.commitState ?? null,
    gates: gateResults,
    releaseVerify: evidence.releaseVerify?.verdict ?? null,
    candidateVerify: evidence.candidateVerify?.verdict ?? null,
    smoke: evidence.smoke?.verdict ?? null,
    engine: engine ? { ...engine, unknownSkips: evidence.engineAccounting?.files?.reduce((n, f) => n + (f.unknownSkips?.length ?? 0), 0) ?? null } : null,
    engineBuild: engineBuild
      ? { ...engineBuild, unknownSkips: evidence.engineBuildAccounting?.files?.reduce((n, f) => n + (f.unknownSkips?.length ?? 0), 0) ?? null }
      : null,
    browser: browser ? { ...browser, unknownSkips: (evidence.browserAccounting?.matrix?.unknownSkips?.length ?? 0) + (evidence.browserAccounting?.candidateHost?.unknownSkips?.length ?? 0), missingSuites: (evidence.browserAccounting?.matrix?.missingSuites ?? []).length + (evidence.browserAccounting?.candidateHost?.missingSuites ?? []).length } : null,
    stagedDigest: evidence.stagedDigest?.sha256 ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Unify the factory's final FULL classification with the strict shared
 * generation-readiness decision (Stage B). A full-profile PASS is not
 * enough on its own: the provisional receipt is validated by
 * decideGenerationReadiness() first. Limited provenance, an uncertain
 * commit, a staged-digest disagreement, or a failed receipt write all
 * downgrade the run to NOT_READY instead of a falsely attested FULL.
 * The verdict (execution succeeded) stays PASS; readiness (attested FULL)
 * does not. `writeReceipt` is injectable for failure-path tests.
 */
export function finalizeReadiness(evidence, { root = ROOT, writeReceipt = writeGenerationReceipt, packageVersion = null } = {}) {
  const provisional = { ...evidence, verdict: 'PASS', readiness: 'FULL_RELEASE_READY' };
  const record = generationReceiptFor(provisional);
  const decision = decideGenerationReadiness(record, {
    origin: evidence.origin,
    generation: evidence.candidate.generation,
    sha256: evidence.candidate.sha256,
    gateContract: GATE_CONTRACT_VERSION,
    requiredGates: REQUIRED_FULL_GATES,
    packageVersion: packageVersion ?? evidence.packageVersion ?? null,
  });
  if (decision.status !== 'FULL') {
    evidence.readiness = 'NOT_READY';
    evidence.attestation = { status: 'CANDIDATE_ONLY', reason: decision.reason };
  } else {
    try {
      const kept = writeReceipt(root, evidence.storeId, evidence.candidate.generation, record);
      evidence.readiness = 'FULL_RELEASE_READY';
      evidence.attestation = { status: 'FULL', reason: null };
      evidence.generationReceipt = {
        path: relative(root, kept.path).split(sep).join('/'),
        preserved: kept.preserved,
      };
    } catch (error) {
      evidence.readiness = 'NOT_READY';
      evidence.attestation = { status: 'CANDIDATE_ONLY', reason: `generation receipt persistence failed: ${String(error?.message ?? error).slice(0, 160)}` };
      evidence.generationReceipt = { path: null, error: String(error?.message ?? error).slice(0, 160) };
    }
    return evidence.readiness;
  }
  // The run executed cleanly but cannot be strictly attested: persist the
  // honest NOT_READY record (the keep-PASS rule protects older FULL proof).
  try {
    const honest = generationReceiptFor(evidence);
    const kept = writeReceipt(root, evidence.storeId, evidence.candidate.generation, honest);
    evidence.generationReceipt = {
      path: relative(root, kept.path).split(sep).join('/'),
      preserved: kept.preserved,
    };
  } catch { /* an honest record that cannot persist still downgrades above */ }
  return evidence.readiness;
}

function finish(evidence, errorDetail, root = ROOT, opts = {}) {
  // Final readiness classification: a full-profile PASS with a committed
  // generation goes through the strict shared decision; anything else
  // keeps the legacy verdict/profile mapping. No path claims more than
  // its evidence proves.
  if (!evidence.readiness) {
    if (evidence.verdict === 'PASS' && evidence.profile === 'full'
      && evidence.candidate?.generation && evidence.candidate?.sha256 && evidence.storeId) {
      finalizeReadiness(evidence, { root, writeReceipt: opts.writeReceipt });
    } else {
      evidence.readiness = evidence.verdict === 'PASS'
        ? 'CANDIDATE_ONLY'
        : 'NOT_READY';
    }
  }
  const outPath = join(root, 'reports', 'release', 'candidates', `${evidence.storeId ?? evidence.slug ?? 'blocked'}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
  // Immutable per-generation receipt beside the mutable latest-attempt
  // report. finalizeReadiness() already persisted PASS-run receipts;
  // every other terminal state naming a committed generation is recorded
  // here (degraded-FAIL alike); the keep-PASS rule inside protects
  // historical proof from later failures.
  if (!evidence.generationReceipt && evidence.candidate?.generation && evidence.candidate?.sha256 && evidence.storeId) {
    try {
      const kept = writeGenerationReceipt(root, evidence.storeId, evidence.candidate.generation, generationReceiptFor(evidence));
      evidence.generationReceipt = {
        path: relative(root, kept.path).split(sep).join('/'),
        preserved: kept.preserved,
      };
      writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
    } catch { /* receipt IO must never fail the run itself */ }
  }
  const lines = [
    `release-candidate: ${evidence.verdict}${evidence.failedStage ? ` (failed at ${evidence.failedStage})` : ''}`,
    `origin: ${evidence.origin ?? 'none'}`,
    `readiness: ${evidence.readiness}`,
    errorDetail ? `detail: ${errorDetail}` : null,
    evidence.candidate ? `candidate: ${evidence.candidate.directory} (${evidence.candidate.files} files, sha256 ${evidence.candidate.sha256.slice(0, 16)}…)` : null,
    `evidence: ${relative(root, outPath).split(sep).join('/')}`,
    evidence.attestation && evidence.verdict === 'PASS' && evidence.readiness !== 'FULL_RELEASE_READY'
      ? `attestation: FULL withheld (${evidence.attestation.reason ?? 'unproven'}); engineering execution itself passed`
      : null,
    'publicationAuthorized: false (operator decision; no remote action performed)',
  ].filter(Boolean);
  process.stdout.write(`${lines.join('\n')}\n`);
  // Honest exit contract (Stage E): a full-profile PASS whose strict FULL
  // attestation was withheld is NOT exit zero. The execution succeeded
  // (evidence preserved, generations intact) but no FULL claim may be
  // inferred from the process status — callers must read the report.
  // Exit 4 = ATTESTATION_GAP: engineering PASS, FULL unattested.
  if (evidence.verdict === 'PASS' && evidence.profile === 'full' && evidence.readiness !== 'FULL_RELEASE_READY') {
    return 4;
  }
  return evidence.verdict === 'PASS' ? 0 : evidence.verdict === 'BLOCKED' ? 3 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let code = 1;
  try {
    const maybe = main(process.argv.slice(2));
    code = maybe instanceof Promise ? await maybe : maybe;
  } catch (error) {
    process.stderr.write(`release:candidate error: ${String(error?.message ?? error).slice(0, 500)}\n`);
    code = 1;
  }
  process.exit(code);
}
