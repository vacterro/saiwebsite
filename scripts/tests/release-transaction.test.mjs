// Release-transaction controls for Ticket 1 (Stages A+B).
// Deterministic failure injection through the runLockedFactory deps seam
// (no builds) plus commit-boundary unit tests. All fixtures disposable.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ROOT,
  commitGeneration,
  computeDigest,
  finalizeReadiness,
  isPostcommitDegraded,
  readPointer,
  reconcileCommitState,
  repairCompatViews,
  rotateSnapshots,
  runLockedFactory,
  verifyDigest,
  writePointerAtomic,
  GATE_CONTRACT_VERSION,
  REQUIRED_FULL_GATES,
} from '../release-candidate.mjs';
import { decideGenerationReadiness } from '../release-readiness.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function tempDir(prefix = 'sai-txn-') {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}
function writeTree(dir, entries) {
  for (const [rel, content] of Object.entries(entries)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
}
const ORIGIN = 'https://txn.example';

/**
 * One disposable build artifact shared by every injected full-profile run.
 * Real bytes on disk (index.html + release.json), deterministic, digest-
 * verifiable, never the repository dist/, cleaned up with the other temp
 * dirs. Injected runs therefore need no prebuilt production dist/ and cannot
 * silently inspect a stale one.
 */
let sharedArtifact = null;
function disposableArtifact() {
  if (!sharedArtifact) {
    sharedArtifact = join(tempDir('sai-artifact-'), 'dist');
    writeTree(sharedArtifact, {
      'index.html': '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>disposable artifact</title></head><body></body></html>\n',
      'release.json': `${JSON.stringify({ origin: ORIGIN, release: true, package: { name: 'sai-website', version: '1.5.0' }, protocol: { version: '8.1.0', commit: 'c'.repeat(40) } }, null, 2)}\n`,
    });
  }
  return sharedArtifact;
}
/** Digest of the disposable artifact -- the identity its runs must account against. */
function artifactSha() {
  return computeDigest(disposableArtifact()).sha256;
}

/** A store with one committed generation; returns { base, gen, sha }. */
function committedStore() {
  const base = join(tempDir(), 'store');
  writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
  rotateSnapshots(base, { origin: ORIGIN });
  const pointer = readPointer(base, 'current');
  return { base, gen: pointer.generation, sha: pointer.sha256 };
}

function evidenceFor(root, profile = 'full') {
  return {
    tool: 'release-candidate', verdict: 'FAIL', failedStage: null,
    origin: ORIGIN, slug: 'txn-example', storeId: 'txn-test', storeKind: 'store',
    profile, readinessClaim: profile === 'full' ? 'full-readiness' : 'candidate-only',
    engineSkips: [], gates: [],
  };
}

const passVerify = { verdict: 'PASS', checks: [] };
const passSmoke = { verdict: 'LOCAL_STATIC_HOST_PASS', checks: [] };

/**
 * Pre-build gate evidence as runFactory() would record it before the
 * locked phase (site health, source-only static gates, dist-independent
 * engine suites, and the full-profile type check). The runLockedFactory
 * seam starts at the build stage and records the artifact gates itself
 * (validate-content, validate-registry, audit-build) once this run's build
 * exists, so they are deliberately absent here — the seam never invents
 * gate results, but it does run ARTIFACT_GATES against the built artifact.
 */
function preBuildGates() {
  // Contract 8: the source-only set includes the mandatory semantic media
  // gate (SOURCE_GATES runs `npm run validate:media`, recorded under the
  // `validate:media` gate id) and the SOURCE half of the licence gate
  // (`validate-licenses:source`). The artifact gates — validate-content,
  // validate-registry, the ARTIFACT half of the licence gate
  // (`validate-licenses:artifact`) and audit-build — moved into the locked
  // phase, so a "complete" pre-build fixture must NOT list them and must
  // still NOT attest FULL on its own: the artifact gates and the strict
  // decision supply the rest.
  return [
    'site:doctor', 'lint-styles', 'validate-themes', 'validate-canonical',
    'validate-baselines', 'validate-licenses:source', 'validate:media', 'i18n',
    'test:engine', 'check',
  ].map((id) => ({ id, ok: true, exit: 0 }));
}

/** Deps where every gate succeeds; override per-test for injection. */
function okDeps(extra = {}) {
  return {
    runGate: () => ({ ok: true, exit: 0 }),
    engineGate: () => ({ ok: true, exit: 0, skips: [] }),
    browserMatrix: async () => ({ ok: true, exit: 0, skips: [], accounting: { matrix: null, candidateHost: null, distSha: artifactSha() } }),
    verifyRelease: async () => passVerify,
    probeCandidate: async () => passSmoke,
    ...extra,
  };
}

describe('A: precommit failures never move the authoritative pointer', () => {
  it('build failure leaves the pointer and generation bytes unchanged', async () => {
    const { base, gen, sha } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root);
    const deps = okDeps({ runGate: (cmd) => (/astro build/.test(cmd) ? { ok: false, exit: 1, tail: 'injected' } : { ok: true, exit: 0 }) });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root });
    assert.equal(evidence.verdict, 'FAIL');
    assert.equal(evidence.failedStage, 'build');
    assert.equal(evidence.commitState, undefined);
    assert.equal(evidence.readiness, 'NOT_READY');
    assert.equal(readPointer(base, 'current').generation, gen);
    assert.equal(verifyDigest(join(base, 'generations', gen), sha), true);
  });

  it('artifact-gate failure after the build commits nothing (clean-checkout path)', async () => {
    // Contract 7: validate-content/registry/audit-build run inside the lock,
    // after this run's build. A failure there must preserve the committed
    // generation and never advance the pointer.
    const { base, gen, sha } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    const deps = okDeps({
      runGate: (cmd) => (/validate-content/.test(cmd)
        ? { ok: false, exit: 1, tail: 'injected broken-link' }
        : { ok: true, exit: 0 }),
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.verdict, 'FAIL');
    assert.equal(evidence.failedStage, 'artifact-gates');
    assert.ok(evidence.gates.some((g) => g.id === 'validate-content' && g.ok === false), 'the failed artifact gate is recorded');
    assert.equal(readPointer(base, 'current').generation, gen, 'authoritative pointer unmoved');
    assert.equal(verifyDigest(join(base, 'generations', gen), sha), true, 'committed bytes intact');
    assert.equal(evidence.readiness, 'NOT_READY');
  });

  it('release-verify failure names its gate and commits nothing', async () => {
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root);
    const deps = okDeps({ verifyRelease: async () => ({ verdict: 'FAIL', checks: [{ id: 'seo.canonical', status: 'FAIL' }] }) });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root });
    assert.equal(evidence.failedStage, 'release-verify');
    assert.deepEqual(evidence.releaseVerify.failing, ['seo.canonical']);
    assert.equal(readPointer(base, 'current').generation, gen);
    assert.equal(evidence.readiness, 'NOT_READY');
  });

  it('projection failure commits nothing', async () => {
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root);
    const deps = okDeps({ projectPublicCandidate: () => { throw new Error('injected projection failure'); } });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'candidate', deps, root });
    assert.equal(evidence.failedStage, 'project');
    assert.equal(readPointer(base, 'current').generation, gen);
  });

  it('candidate-verify failure commits nothing', async () => {
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root);
    let n = 0;
    const deps = okDeps({
      verifyRelease: async () => (++n === 1 ? passVerify : { verdict: 'FAIL', checks: [{ id: 'artifact.public', status: 'FAIL' }] }),
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'candidate', deps, root });
    assert.equal(evidence.failedStage, 'candidate-verify');
    assert.equal(readPointer(base, 'current').generation, gen);
  });

  it('smoke failure commits nothing', async () => {
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root);
    const deps = okDeps({
      probeCandidate: async () => ({ verdict: 'FAIL', checks: [{ id: 'http.home', status: 'FAIL' }] }),
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'candidate', deps, root });
    assert.equal(evidence.failedStage, 'smoke');
    assert.equal(readPointer(base, 'current').generation, gen);
  });

  it('browser-gate failure is NOT full-ready and moves no pointer', async () => {
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    const deps = okDeps({
      browserMatrix: async () => ({ ok: false, exit: 1, tail: 'injected browser failure', skips: [], accounting: null }),
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.failedStage, 'browser-matrix');
    assert.equal(evidence.readiness, 'NOT_READY', 'failed full attempt never FULL_RELEASE_READY');
    assert.equal(readPointer(base, 'current').generation, gen);
  });

  it('dual-origin failure before promotion leaves the pointer unmoved', async () => {
    const { base, gen, sha } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    const deps = okDeps({
      runGate: (cmd) => (/dual-origin/.test(cmd) ? { ok: false, exit: 1, tail: 'injected dual-origin failure' } : { ok: true, exit: 0 }),
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.failedStage, 'dual-origin');
    assert.equal(evidence.commitState, 'NOT_COMMITTED');
    assert.equal(evidence.readiness, 'NOT_READY');
    assert.equal(readPointer(base, 'current').generation, gen);
    assert.equal(verifyDigest(join(base, 'generations', gen), sha), true);
  });

  it('staging mutated after verification fails the final recheck, pointer unmoved', async () => {
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    const deps = okDeps({
      runGate: (cmd) => {
        if (/dual-origin/.test(cmd)) {
          writeFileSync(join(base, 'next', 'index.html'), 'mutated-by-workspace');
          return { ok: true, exit: 0 };
        }
        return { ok: true, exit: 0 };
      },
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.failedStage, 'staged-digest');
    assert.equal(evidence.commitState, 'NOT_COMMITTED');
    assert.equal(readPointer(base, 'current').generation, gen);
  });

  it('success advances the pointer exactly once with full readiness', async () => {
    // Stage B contract: FULL_RELEASE_READY now requires complete evidence
    // (source identity, package/protocol binding, real test accounting),
    // not just profile plus exit status. This seam run is therefore
    // fully evidenced; a run without such evidence must stay NOT_READY.
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    const engAcc = { files: [{ file: 'x', unknownSkips: [] }], totals: { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, skips: [] };
    // The seam starts at the build stage; dist-independent engine evidence
    // comes from runFactory()'s pre-build gate in production, so the seam
    // carries it in exactly as recorded there.
    evidence.engineAccounting = JSON.parse(JSON.stringify(engAcc));
    const browAcc = {
      matrix: { unknownSkips: [], missingSuites: [] },
      candidateHost: { unknownSkips: [], missingSuites: [] },
      distSha: artifactSha(),
      totals: { tests: 8, passed: 8, failed: 0, skipped: 0, flaky: 0 },
    };
    const deps = okDeps({
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'v3-staged' }); return { removed: [], scrubbed: [], files: 1 }; },
      engineGate: () => ({ ok: true, exit: 0, skips: [], accounting: JSON.parse(JSON.stringify(engAcc)) }),
      browserMatrix: async () => ({ ok: true, exit: 0, skips: [], accounting: JSON.parse(JSON.stringify(browAcc)) }),
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.verdict, 'PASS');
    assert.equal(evidence.readiness, 'FULL_RELEASE_READY');
    assert.equal(evidence.commitState, 'COMMITTED');
    const now = readPointer(base, 'current');
    assert.notEqual(now.generation, gen, 'pointer advanced');
    assert.equal(readPointer(base, 'previous').generation, gen, 'previous preserved exactly once');
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'v3-staged');
  });

  it('candidate-profile success claims CANDIDATE_ONLY, never full readiness', async () => {
    const { base } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root, 'candidate');
    const deps = okDeps({
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'v3-staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'candidate', deps, root });
    assert.equal(evidence.verdict, 'PASS');
    assert.equal(evidence.readiness, 'CANDIDATE_ONLY');
  });
});

describe('B: commit boundary states and explicit repair', () => {
  it('generation copy failure before commit means NOT_COMMITTED', () => {
    const base = join(tempDir(), 'store');
    const staged = join(tempDir(), 'staged');
    writeTree(staged, { 'index.html': 'v' });
    assert.throws(
      () => commitGeneration(base, { stagedDir: staged, digest: { sha256: '0'.repeat(64), files: 1 }, origin: ORIGIN, copy: () => { throw new Error('injected'); } }),
      /nothing was committed/,
    );
    assert.equal(readPointer(base, 'current'), null);
  });

  it('pointer write failure before commit leaves the old pointer intact', () => {
    const { base, gen, sha } = committedStore();
    const saved = readFileSync(join(base, 'current.json'), 'utf8');
    rmSync(join(base, 'current.json'));
    mkdirSync(join(base, 'current.json'), { recursive: true });
    writeFileSync(join(base, 'current.json', 'block'), 'blocks file rename on every platform');
    const staged = join(tempDir(), 'staged');
    writeTree(staged, { 'index.html': 'v-new' });
    const digest = computeDigest(staged);
    assert.throws(() => commitGeneration(base, { stagedDir: staged, digest, origin: ORIGIN }), /./);
    assert.ok(existsSync(join(base, 'current.json', 'block')), 'no pointer file was created over the block');
    rmSync(join(base, 'current.json'), { recursive: true, force: true });
    writeFileSync(join(base, 'current.json'), saved);
    assert.equal(readPointer(base, 'current').generation, gen, 'old pointer identity restored verbatim');
    assert.equal(verifyDigest(join(base, 'generations', gen), sha), true, 'old generation bytes intact');
  });

  it('previous-pointer write failure still leaves current unmoved (previous-first order)', () => {
    const { base, gen } = committedStore();
    const savedCurrent = readFileSync(join(base, 'current.json'), 'utf8');
    const savedPrevious = readFileSync(join(base, 'previous.json'), 'utf8');
    rmSync(join(base, 'previous.json'));
    mkdirSync(join(base, 'previous.json'), { recursive: true });
    writeFileSync(join(base, 'previous.json', 'block'), 'blocks file rename on every platform');
    const staged = join(tempDir(), 'staged');
    writeTree(staged, { 'index.html': 'v-new' });
    const digest = computeDigest(staged);
    assert.throws(() => commitGeneration(base, { stagedDir: staged, digest, origin: ORIGIN }), /./);
    rmSync(join(base, 'previous.json'), { recursive: true, force: true });
    writeFileSync(join(base, 'previous.json'), savedPrevious);
    assert.equal(readFileSync(join(base, 'current.json'), 'utf8'), savedCurrent, 'current pointer byte-identical throughout');
    assert.equal(readPointer(base, 'current').generation, gen, 'current pointer unmoved');
  });

  it('view copy failure after commit reports POSTCOMMIT_DEGRADED, generation recoverable', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    let calls = 0;
    const flaky = (s, d) => { calls++; if (calls > 3) throw new Error('injected view-sync failure'); cpSync(s, d, { recursive: true }); };
    let caught = null;
    try {
      rotateSnapshots(base, { origin: ORIGIN, copy: flaky });
    } catch (error) {
      caught = error;
    }
    assert.ok(caught, 'promotion threw');
    assert.equal(isPostcommitDegraded(caught), true, 'state is POSTCOMMIT_DEGRADED, not untouched');
    assert.ok(caught.generation, 'committed generation identified');
    const pointer = readPointer(base, 'current');
    assert.equal(pointer.generation, caught.generation, 'pointer did move: committed');
    assert.equal(verifyDigest(join(base, 'generations', caught.generation), caught.sha256), true, 'bytes durable');
    const repair = repairCompatViews(base);
    assert.equal(repair.current.status, 'repaired');
    assert.equal(verifyDigest(join(base, 'current'), caught.sha256), true, 'view recovered from commitment');
  });

  it('process ending after commit is recovered by the explicit repair op', () => {
    const base = join(tempDir(), 'store');
    const staged = join(tempDir(), 'staged');
    writeTree(staged, { 'index.html': 'v-process-crash' });
    const digest = computeDigest(staged);
    commitGeneration(base, { stagedDir: staged, digest, origin: ORIGIN });
    assert.ok(!existsSync(join(base, 'current')), 'no view: crash before refresh');
    const repair = repairCompatViews(base);
    assert.equal(repair.current.status, 'repaired');
    assert.equal(verifyDigest(join(base, 'current'), digest.sha256), true);
  });

  it('an older current/ view is re-synced, never trusted', () => {
    const { base } = committedStore();
    writeFileSync(join(base, 'current', 'index.html'), 'stale-view');
    const repair = repairCompatViews(base);
    assert.equal(repair.current.status, 'repaired');
    assert.equal(readPointer(base, 'current').sha256 === computeDigest(join(base, 'current')).sha256, true);
  });

  it('a corrupted previous generation is refused, current still repaired', () => {
    const { base } = committedStore();
    const prev = readPointer(base, 'previous');
    assert.ok(prev, 'previous pointer exists');
    writeFileSync(join(base, 'generations', prev.generation, 'index.html'), 'corrupted');
    const repair = repairCompatViews(base);
    assert.equal(repair.previous.status, 'failed', 'corrupt generation refused for restore');
    assert.ok(['ok', 'repaired'].includes(repair.current.status), 'current unaffected');
  });

  it('repair never invents provenance: pointers byte-identical before and after', () => {
    const { base } = committedStore();
    const beforeCurrent = readFileSync(join(base, 'current.json'), 'utf8');
    const beforePrevious = readFileSync(join(base, 'previous.json'), 'utf8');
    rmSync(join(base, 'current'), { recursive: true, force: true });
    repairCompatViews(base);
    repairCompatViews(base);
    assert.equal(readFileSync(join(base, 'current.json'), 'utf8'), beforeCurrent);
    assert.equal(readFileSync(join(base, 'previous.json'), 'utf8'), beforePrevious);
  });

  it('repeated repair is idempotent', () => {
    const { base } = committedStore();
    rmSync(join(base, 'current'), { recursive: true, force: true });
    const first = repairCompatViews(base);
    const second = repairCompatViews(base);
    assert.equal(first.current.status, 'repaired');
    assert.equal(second.current.status, 'ok', 'second run changes nothing');
    assert.deepEqual(second, repairCompatViews(base));
  });
});

describe('E: commit-state reconciliation prefers observed facts', () => {
  it('pointer on the intended verified generation reconciles COMMITTED', () => {
    const { base, gen, sha } = committedStore();
    const r = reconcileCommitState(base, { expectedDigest: { sha256: sha } });
    assert.equal(r.state, 'COMMITTED');
    assert.equal(r.generation, gen);
    assert.equal(r.generationVerified, true);
  });

  it('pointer on another verified generation reconciles NOT_COMMITTED', () => {
    const { base, gen } = committedStore();
    const r = reconcileCommitState(base, { expectedDigest: { sha256: '0'.repeat(64) } });
    assert.equal(r.state, 'NOT_COMMITTED');
    assert.equal(r.generation, gen);
    assert.equal(r.generationVerified, true);
  });

  it('corrupt pointer reconciles COMMIT_STATE_UNCERTAIN, never COMMITTED', () => {
    const { base } = committedStore();
    writeFileSync(join(base, 'current.json'), '{ corrupt');
    const r = reconcileCommitState(base, { expectedDigest: { sha256: '0'.repeat(64) } });
    assert.equal(r.state, 'COMMIT_STATE_UNCERTAIN');
    assert.equal(r.generationVerified, false);
  });

  it('missing pointer reconciles COMMIT_STATE_UNCERTAIN, never NOT_COMMITTED', () => {
    const { base } = committedStore();
    rmSync(join(base, 'current.json'));
    const r = reconcileCommitState(base, { expectedDigest: { sha256: '0'.repeat(64) } });
    assert.equal(r.state, 'COMMIT_STATE_UNCERTAIN');
  });

  it('intended generation with tampered bytes reconciles UNCERTAIN, never COMMITTED', () => {
    const { base, sha } = committedStore();
    const gen = readPointer(base, 'current').generation;
    writeFileSync(join(base, 'generations', gen, 'index.html'), 'tampered bytes');
    const r = reconcileCommitState(base, { expectedDigest: { sha256: sha } });
    assert.equal(r.state, 'COMMIT_STATE_UNCERTAIN');
    assert.equal(r.generationVerified, false);
  });

  it('ambiguous generic error after the pointer moved reports POSTCOMMIT_DEGRADED, never NOT_COMMITTED', async () => {
    const { base, gen } = committedStore();
    const root = tempDir();
    const evidence = evidenceFor(root, 'candidate');
    const deps = okDeps({
      // The real promotion runs (pointer moves), then its acknowledgement
      // is lost: the factory must read the filesystem, not the exception.
      rotateSnapshots: (b, opts) => {
        const out = rotateSnapshots(b, opts);
        throw new Error('injected: write succeeded but acknowledgement lost');
      },
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    });
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'candidate', deps, root });
    assert.equal(evidence.verdict, 'FAIL');
    assert.equal(evidence.commitState, 'POSTCOMMIT_DEGRADED', 'reconciled COMMITTED, not NOT_COMMITTED');
    assert.notEqual(readPointer(base, 'current').generation, gen, 'pointer did advance');
    assert.equal(verifyDigest(join(base, 'generations', evidence.candidate.generation), evidence.candidate.sha256), true, 'committed bytes durable');
  });

  it('repeated same-generation promotion changes no history', () => {
    const { base, gen, sha } = committedStore();
    const prevGen = readPointer(base, 'previous').generation;
    writeTree(join(base, 'next'), { 'index.html': 'v2' });
    const digest = computeDigest(join(base, 'next'));
    assert.equal(digest.sha256, sha, 'fixture stages bytes identical to the committed generation');
    const out = rotateSnapshots(base, { digest, origin: ORIGIN });
    assert.equal(readPointer(base, 'current').generation, gen);
    assert.equal(readPointer(base, 'previous').generation, prevGen, 'previous history untouched');
    assert.equal(reconcileCommitState(base, { expectedDigest: digest }).state, 'COMMITTED');
    void out;
  });
});

describe('Stage B: factory FULL agrees with the strict shared decision', () => {
  const SHA_E = 'e'.repeat(64);

  const engineTotals = { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const buildTotals = { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const browserTotals = { tests: 8, passed: 8, failed: 0, skipped: 0, flaky: 0 };

  const engineAccounting = { files: [{ file: 'x', unknownSkips: [] }], totals: engineTotals, skips: [] };
  const buildAccounting = { files: [{ file: 'y', unknownSkips: [] }], totals: buildTotals, skips: [] };
  const browserAccounting = {
    matrix: { unknownSkips: [], missingSuites: [] },
    candidateHost: { unknownSkips: [], missingSuites: [] },
    // Accounting must name the artifact these runs digested: the shared
    // disposable artifact, never repository dist/. A fixture reporting a
    // foreign digest is refused by the factory (mismatch control below).
    distSha: artifactSha(), totals: browserTotals,
  };

  /** Every-gate-passing deps seam over a disposable store. */
  function fullDeps(base) {
    return {
      runGate: () => ({ ok: true, exit: 0 }),
      engineGate: () => ({ ok: true, exit: 0, skips: [], accounting: structuredClone(engineAccounting) }),
      browserMatrix: async () => ({ ok: true, exit: 0, skips: [], accounting: structuredClone(browserAccounting) }),
      verifyRelease: async () => passVerify,
      probeCandidate: async () => passSmoke,
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged' }); return { removed: [], scrubbed: [], files: 1 }; },
    };
  }

  function fullEvidence(overrides = {}) {
    return {
      tool: 'release-candidate', verdict: 'PASS', failedStage: null,
      origin: ORIGIN, slug: 'txn-example', storeId: 'txn-test', storeKind: 'store',
      profile: 'full', readinessClaim: 'full-readiness', gateContract: GATE_CONTRACT_VERSION,
      engineSkips: [],
      gates: REQUIRED_FULL_GATES.map((id) => ({ id, ok: true, exit: 0 })),
      git: { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' },
      package: '1.5.0', protocol: { version: '8.1.0', commit: 'c'.repeat(40) },
      releaseVerify: { verdict: 'PASS', failing: [] },
      candidateVerify: { verdict: 'PASS', failing: [] },
      smoke: { verdict: 'LOCAL_STATIC_HOST_PASS', failing: [] },
      stagedDigest: { files: 1, sha256: SHA_E },
      engineAccounting: structuredClone(engineAccounting),
      engineBuildAccounting: structuredClone(buildAccounting),
      browserAccounting: structuredClone(browserAccounting),
      candidate: { directory: 'store/current', generation: 'g-eee', store: 'store', files: 1, sha256: SHA_E },
      commitState: 'COMMITTED',
      ...overrides,
    };
  }

  it('B1/E. full gates pass but source provenance is limited: PASS verdict, exit 4, never FULL', async () => {
    const base = join(tempDir(), 'store');
    mkdirSync(base, { recursive: true });
    const root = tempDir();
    const evidence = evidenceFor(root);
    evidence.git = { rev: 'a'.repeat(40), dirty: true, dirtyFiles: 3, dirtyIdentity: null, provenance: 'limited' };
    evidence.package = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engineAccounting);
    const deps = fullDeps(base);
    deps.engineGate = () => ({ ok: true, exit: 0, skips: [], accounting: structuredClone(engineAccounting) });
    const code = await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.verdict, 'PASS', 'execution genuinely succeeded');
    assert.equal(evidence.readiness, 'NOT_READY', 'limited provenance is not FULL');
    assert.match(evidence.attestation.reason, /provenance is limited/);
    assert.equal(code, 4, 'ATTESTATION_GAP: exit status never implies FULL');
  });

  it('E. receipt persistence failure: PASS verdict, exit 4, evidence preserved', async () => {
    const base = join(tempDir(), 'store');
    mkdirSync(base, { recursive: true });
    const root = tempDir();
    const evidence = evidenceFor(root);
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engineAccounting);
    const deps = fullDeps(base);
    deps.writeReceipt = () => { throw new Error('injected: disk gone'); };
    const code = await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.verdict, 'PASS');
    assert.equal(evidence.readiness, 'NOT_READY');
    assert.match(evidence.attestation.reason, /persistence failed/);
    assert.equal(code, 4);
    assert.ok(evidence.candidate?.generation, 'committed generation evidence preserved');
  });

  it('E. fully attested full execution exits zero; candidate-only exits zero without FULL', async () => {
    const base = join(tempDir(), 'store');
    mkdirSync(base, { recursive: true });
    const root = tempDir();
    const evidence = evidenceFor(root);
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engineAccounting);
    const code = await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps: fullDeps(base), root, builtDistDir: disposableArtifact() });
    assert.equal(code, 0);
    assert.equal(evidence.readiness, 'FULL_RELEASE_READY');
    const base2 = join(tempDir(), 'store');
    mkdirSync(base2, { recursive: true });
    const root2 = tempDir();
    const cand = evidenceFor(root2, 'candidate');
    const code2 = await runLockedFactory({ evidence: cand, origin: ORIGIN, buildEnv: process.env, base: base2, profile: 'candidate', deps: fullDeps(base2), root: root2 });
    assert.equal(code2, 0);
    assert.equal(cand.readiness, 'CANDIDATE_ONLY');
  });

  it('B2. receipt write failure downgrades to NOT_READY without losing the PASS verdict', () => {
    const root = tempDir();
    const evidence = fullEvidence();
    const readiness = finalizeReadiness(evidence, {
      root, writeReceipt: () => { throw new Error('injected: disk gone'); },
    });
    assert.equal(evidence.verdict, 'PASS');
    assert.equal(readiness, 'NOT_READY');
    assert.match(evidence.attestation.reason, /persistence failed/);
  });

  it('B3. uncertain commit state cannot attest FULL', () => {
    const root = tempDir();
    const evidence = fullEvidence({ commitState: 'COMMIT_STATE_UNCERTAIN' });
    assert.equal(finalizeReadiness(evidence, { root }), 'NOT_READY');
    assert.match(evidence.attestation.reason, /commit state is COMMIT_STATE_UNCERTAIN/);
  });

  it('B4. staged digest disagreeing with committed bytes cannot attest FULL', () => {
    const root = tempDir();
    const evidence = fullEvidence({ stagedDigest: { files: 1, sha256: 'd'.repeat(64) } });
    assert.equal(finalizeReadiness(evidence, { root }), 'NOT_READY');
    assert.match(evidence.attestation.reason, /staged digest differs/);
  });

  it('B5. factory PASS with strict rejection keeps verdict but reports the reason', () => {
    const root = tempDir();
    const evidence = fullEvidence({ git: { rev: 'unknown', dirty: true, dirtyFiles: -1, dirtyIdentity: null, provenance: 'limited' } });
    assert.equal(finalizeReadiness(evidence, { root }), 'NOT_READY');
    assert.equal(evidence.verdict, 'PASS');
    assert.ok(evidence.attestation.reason.length > 20);
  });

  it('B6. candidate-only run remains candidate-only', async () => {
    const base = join(tempDir(), 'store');
    mkdirSync(base, { recursive: true });
    const root = tempDir();
    const evidence = evidenceFor(root, 'candidate');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'candidate', deps: fullDeps(base), root });
    assert.equal(evidence.verdict, 'PASS');
    assert.equal(evidence.readiness, 'CANDIDATE_ONLY');
  });

  it('B7. complete valid FULL run: factory, stored receipt, and strict decision agree', async () => {
    const base = join(tempDir(), 'store');
    mkdirSync(base, { recursive: true });
    const root = tempDir();
    const evidence = evidenceFor(root);
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engineAccounting);
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps: fullDeps(base), root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.verdict, 'PASS');
    assert.equal(evidence.readiness, 'FULL_RELEASE_READY');
    const stored = JSON.parse(readFileSync(join(root, evidence.generationReceipt.path), 'utf8'));
    const decision = decideGenerationReadiness(stored, {
      origin: ORIGIN, generation: evidence.candidate.generation, sha256: evidence.candidate.sha256,
      gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES,
    });
    assert.equal(decision.status, 'FULL', 'stored receipt must survive the strict decision');
  });

  function structuredClone(value) {
    return JSON.parse(JSON.stringify(value));
  }
});

describe('Stage B/C: injected full-profile runs stay independent of repository dist', () => {
  const matrixTotals = { tests: 4, passed: 4, failed: 0, skipped: 0, flaky: 0 };
  const engTotals = { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const buildTotals = { tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
  const engAcc = { files: [{ file: 'scripts/tests/release-transaction.test.mjs', unknownSkips: [] }], totals: engTotals, skips: [] };
  const buildAcc = { files: [{ file: 'scripts/tests/release-public.test.mjs', unknownSkips: [] }], totals: buildTotals, skips: [] };
  const browAcc = {
    matrix: { unknownSkips: [], missingSuites: [], totals: matrixTotals },
    candidateHost: { unknownSkips: [], missingSuites: [], totals: { tests: 1, passed: 1, failed: 0, skipped: 0, flaky: 0 } },
    distSha: artifactSha(),
    totals: { tests: matrixTotals.tests + 1, passed: matrixTotals.passed + 1, failed: 0, skipped: 0, flaky: 0 },
  };

  function injectedDeps(overrides = {}) {
    return {
      runGate: () => ({ ok: true, exit: 0 }),
      engineGate: (env, files, opts = {}) => {
        const acc = opts?.distDir ? structuredClone(buildAcc) : structuredClone(engAcc);
        return { ok: true, exit: 0, skips: [], accounting: acc };
      },
      browserMatrix: async () => ({ ok: true, exit: 0, skips: [], accounting: structuredClone(browAcc) }),
      verifyRelease: async () => ({ verdict: 'PASS', checks: [] }),
      probeCandidate: async () => ({ verdict: 'LOCAL_STATIC_HOST_PASS', checks: [] }),
      projectPublicCandidate: ({ destDir }) => { writeTree(destDir, { 'index.html': 'staged', 'release.json': '{}' }); return { removed: [], scrubbed: [], files: 2 }; },
      ...overrides,
    };
  }

  /** Build injected deps for an injected full-profile run that keeps the
   * on-disk promotion path real (so commitGeneration's byte verification
   * passes), while preventing any access to the repository production
   * dist/ and allowing the release-verify mock to reject an absent built
   * artifact on demand.
   */
  function injectedDepsForArtifact({ releaseVerifyFailPresent = false } = {}) {
    return {
      ...okDeps(),
      ...injectedDeps(),
      verifyRelease: async ({ dist }) => {
        if (releaseVerifyFailPresent && (!existsSync(dist) || !existsSync(join(dist, 'index.html')) || !existsSync(join(dist, 'release.json')))) {
          return { verdict: 'FAIL', checks: [{ id: 'artifact.present', status: 'FAIL', detail: 'no built artifact at dist' }] };
        }
        return { verdict: 'PASS', checks: [] };
      },
      computeDigest: (dir) => {
        if (dir === join(ROOT, 'dist')) {
          throw new Error('injected run touched repository dist');
        }
        return computeDigest(dir);
      },
    };
  }

  /** A store with one committed legacy generation AND a next/ candidate staged
   * for promotion. This mirrors committedStore() but also seeds next/ so the
   * factory's promotion path is reachable in injected runs.
   */
  function legacyStoreWithNext() {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'legacy', 'next/index.html': 'next-candidate' });
    rotateSnapshots(base, { origin: ORIGIN });
    return base;
  }

  it('full profile with a disposable built artifact never reads repository dist', async () => {
    const realDist = join(ROOT, 'dist');
    const realDistExisted = existsSync(realDist);
    if (realDistExisted) {
      mkdirSync(join(realDist, '.injected-probe'), { recursive: true });
    }
    const base = legacyStoreWithNext();
    // Shared disposable artifact: same identity the accounting reports.
    const built = disposableArtifact();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.packageVersion = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engAcc);
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps: injectedDepsForArtifact(), root, builtDistDir: built });
    assert.equal(evidence.verdict, 'PASS');
    assert.equal(evidence.readiness, 'FULL_RELEASE_READY');
    assert.equal(evidence.commitState, 'COMMITTED');
    assert.ok(evidence.candidate?.generation);
    if (realDistExisted) rmSync(join(realDist, '.injected-probe'), { recursive: true, force: true });
  });

  it('injected full profile fails closed when its disposable artifact is absent', async () => {
    const base = legacyStoreWithNext();
    const missing = join(tempDir(), 'missing');
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.packageVersion = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engAcc);
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps: injectedDepsForArtifact({ releaseVerifyFailPresent: true }), root, builtDistDir: missing });
    assert.equal(evidence.verdict, 'FAIL');
    assert.equal(evidence.failedStage, 'release-verify');
  });

  it('injected full profile still commits the verified disposable artifact', async () => {
    const base = legacyStoreWithNext();
    const oldGen = readPointer(base, 'current').generation;
    // Shared disposable artifact: same identity the accounting reports.
    const built = disposableArtifact();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.packageVersion = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engAcc);
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps: injectedDepsForArtifact(), root, builtDistDir: built });
    assert.equal(evidence.commitState, 'COMMITTED');
    assert.notEqual(readPointer(base, 'current').generation, oldGen);
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'staged');
  });

  it('negative control: injected full profile cannot inherit a stale package', async () => {
    const base = legacyStoreWithNext();
    // Shared disposable artifact: same identity the accounting reports.
    const built = disposableArtifact();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '9.9.9';
    evidence.packageVersion = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engAcc);
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps: injectedDepsForArtifact(), root, builtDistDir: built });
    assert.equal(evidence.verdict, 'PASS', 'execution itself succeeded for the stale-package case');
    assert.equal(evidence.readiness, 'NOT_READY');
    assert.match(evidence.attestation.reason, /stale package cannot inherit new FULL readiness/);
  });

  it('negative control: browser accounting naming a foreign artifact refuses FULL, pointer unmoved', async () => {
    const base = legacyStoreWithNext();
    const oldGen = readPointer(base, 'current').generation;
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.packageVersion = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engAcc);
    const deps = {
      ...injectedDepsForArtifact(),
      // The matrix claims it inspected some other artifact than this run's build.
      browserMatrix: async () => ({ ok: true, exit: 0, skips: [], accounting: { matrix: null, candidateHost: null, distSha: 'f'.repeat(64) } }),
    };
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: disposableArtifact() });
    assert.equal(evidence.verdict, 'FAIL');
    assert.equal(evidence.failedStage, 'browser-matrix');
    assert.equal(evidence.commitState, 'NOT_COMMITTED');
    assert.equal(evidence.browserAccounting?.distSha, 'f'.repeat(64), 'foreign digest preserved as evidence of the mismatch');
    assert.equal(evidence.matrixDist?.sha256, artifactSha(), 'the run digested its own disposable artifact');
    assert.equal(readPointer(base, 'current').generation, oldGen, 'authoritative pointer unmoved');
    assert.equal(verifyDigest(join(base, 'generations', oldGen), readPointer(base, 'current').sha256), true);
  });

  it('negative control: builtDistDir without an injected deps seam is refused (no production build bypass)', async () => {
    const base = legacyStoreWithNext();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    await assert.rejects(
      () => runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', root, builtDistDir: disposableArtifact() }),
      /test-only artifact seam/,
    );
  });

  it('artifact gates inspect THIS run build via SAI_RELEASE_ARTIFACT_DIR, never an inherited dist', async () => {
    // Contract 7 seam contract: each artifact gate is handed
    // SAI_RELEASE_ARTIFACT_DIR naming the directory this transaction built,
    // so a stale repository dist/ can never be the thing validated.
    const base = legacyStoreWithNext();
    const built = disposableArtifact();
    const root = tempDir();
    const evidence = evidenceFor(root, 'full');
    evidence.git = { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' };
    evidence.package = '1.5.0';
    evidence.packageVersion = '1.5.0';
    evidence.protocol = { version: '8.1.0', commit: 'c'.repeat(40) };
    evidence.gates = preBuildGates();
    evidence.engineAccounting = structuredClone(engAcc);
    const seen = {};
    const deps = {
      ...injectedDepsForArtifact(),
      runGate: (cmd, env) => {
        if (/validate-content|validate-registry|validate-licenses|audit-build/.test(cmd)) {
          seen[cmd] = env?.SAI_RELEASE_ARTIFACT_DIR ?? null;
        }
        return { ok: true, exit: 0 };
      },
    };
    await runLockedFactory({ evidence, origin: ORIGIN, buildEnv: process.env, base, profile: 'full', deps, root, builtDistDir: built });
    assert.equal(evidence.verdict, 'PASS');
    for (const cmd of ['node scripts/validate-content.mjs', 'node scripts/validate-registry.mjs', 'node scripts/validate-licenses.mjs --phase=artifact', 'node scripts/audit-build.mjs']) {
      assert.equal(seen[cmd], built, `${cmd} received the built artifact dir, not repository dist/`);
    }
  });

  function structuredClone(value) {
    return JSON.parse(JSON.stringify(value));
  }
});

