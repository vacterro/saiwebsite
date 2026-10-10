import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { ROOT } from '../release-checklist.mjs';
import { computeDigest, GATE_CONTRACT_VERSION, REQUIRED_FULL_GATES } from '../release-candidate.mjs';
import { writeDeterministicZip } from '../release-package.mjs';

/**
 * CLI-boundary controls: the real entrypoint (`node
 * scripts/release-checklist.mjs`) is exercised in a subprocess against
 * disposable fixtures under the repo ROOT (.site-work, gitignored).
 * Function-level PASS means nothing if omitting --factory still prints
 * an approved-looking sheet — these tests pin the process exit codes
 * and the exact bytes left behind at --out.
 */
describe('CLI boundary (subprocess, real entrypoint)', () => {
  const CLI = join(ROOT, 'scripts', 'release-checklist.mjs');
  const CLI_ORIGIN = 'https://cli-fixture.example';
  const GEN_A = 'g-aaaaaaaaaaaaaaaa';
  const GEN_B = 'g-bbbbbbbbbbbbbbbb';
  const REAL_COMMIT = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'canonical', 'meta.json'), 'utf8')).commit;
  let seq = 0;
  const liveBases = [];
  const liveStores = [];

  afterEach(() => {
    while (liveBases.length) rmSync(liveBases.pop(), { recursive: true, force: true });
    while (liveStores.length) {
      rmSync(join(ROOT, 'reports', 'release', 'candidates', liveStores.pop()), { recursive: true, force: true });
    }
  });

  function runCli(args) {
    const p = spawnSync('node', [CLI, ...args], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000,
    });
    return { code: p.status ?? 1, stdout: p.stdout ?? '', stderr: p.stderr ?? '' };
  }

  /**
   * Disposable fixture the real CLI can verify: store generations +
   * current.json under .site-work, generation receipts under the real
   * reports tree (unique storeId), package ZIP + receipts beside them.
   * Returns absolute paths { factory, receipt, out } plus digests.
   */
  function cliFixture({
    gens = ['a'], pointerGen = 'a', factoryGen = 'a',
    factoryOverrides = {}, receiptGen = 'a', candidateOnly = false,
    dropPointer = false,
  } = {}) {
    const n = seq++;
    const base = join(ROOT, '.site-work', `cli-${process.pid}-${n}`);
    const storeId = `cli-store-${process.pid}-${n}`;
    const storeRel = join('.site-work', `cli-${process.pid}-${n}`, storeId);
    assert.equal(basename(storeRel), storeId);
    liveBases.push(base);
    liveStores.push(storeId);
    const genOf = (k) => (k === 'a' ? GEN_A : GEN_B);
    const digests = {};
    mkdirSync(join(ROOT, 'reports', 'release', 'candidates', storeId), { recursive: true });
    for (const k of gens) {
      const gdir = join(base, storeId, 'generations', genOf(k));
      mkdirSync(gdir, { recursive: true });
      writeFileSync(join(gdir, 'index.html'), `cli-bytes-${storeId}-${k}`);
      digests[k] = computeDigest(gdir).sha256;
      const gates = {};
      for (const id of REQUIRED_FULL_GATES) gates[id] = true;
      const rec = {
        tool: 'release-candidate', receiptKind: 'generation-readiness',
        gateContract: GATE_CONTRACT_VERSION, origin: CLI_ORIGIN, storeId,
        generation: genOf(k), sha256: digests[k], files: 1,
        source: { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' },
        package: '1.5.0', protocol: { version: '8.1.0', commit: REAL_COMMIT },
        profile: 'full', verdict: 'PASS', readiness: 'FULL_RELEASE_READY', commitState: 'COMMITTED',
        gates, releaseVerify: 'PASS', candidateVerify: 'PASS', smoke: 'LOCAL_STATIC_HOST_PASS',
        engine: { tests: 10, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 },
        engineBuild: { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 },
        browser: { tests: 20, passed: 20, failed: 0, skipped: 0, flaky: 0, unknownSkips: 0, missingSuites: 0 },
        stagedDigest: digests[k], createdAt: new Date().toISOString(),
      };
      if (candidateOnly && k === receiptGen) {
        rec.profile = 'candidate';
        rec.readiness = 'CANDIDATE_ONLY';
      }
      writeFileSync(
        join(ROOT, 'reports', 'release', 'candidates', storeId, `${genOf(k)}.json`),
        JSON.stringify(rec),
      );
    }
    if (!dropPointer) {
      writeFileSync(join(base, storeId, 'current.json'), JSON.stringify({
        generation: genOf(pointerGen), sha256: digests[pointerGen], files: 1,
        origin: CLI_ORIGIN, createdAt: new Date().toISOString(),
      }));
    }
    const { bytes, sha256: pkgSha } = writeDeterministicZip(
      new Map([['index.html', Buffer.from(`cli-bytes-${storeId}-${receiptGen}`)]]),
    );
    mkdirSync(join(base, 'pkg'), { recursive: true });
    const pkgRel = join('.site-work', `cli-${process.pid}-${n}`, 'pkg', 'store.zip');
    writeFileSync(join(base, 'pkg', 'store.zip'), bytes);
    const rk = receiptGen;
    const receipt = {
      tool: 'release-package', verdict: 'PASS', origin: CLI_ORIGIN,
      candidate: { store: storeRel, generation: genOf(rk), files: 1, sha256: digests[rk] },
      package: { file: pkgRel, files: 1, sha256: pkgSha, bytes: bytes.length },
      extractionVerify: { verdict: 'PASS', failing: [] },
      extractionSmoke: { verdict: 'LOCAL_STATIC_HOST_PASS', failing: [] },
      fullReceipt: candidateOnly
        ? { status: 'CANDIDATE_ONLY', reason: 'candidate profile', generation: genOf(rk), gateContract: GATE_CONTRACT_VERSION }
        : { status: 'FULL', reason: null, generation: genOf(rk), gateContract: GATE_CONTRACT_VERSION },
      readiness: candidateOnly ? 'CANDIDATE_ONLY' : 'FULL_RELEASE_READY',
      publicationAuthorized: false,
    };
    const receiptPath = join(base, 'pkg-receipt.json');
    writeFileSync(receiptPath, JSON.stringify(receipt));
    const fk = factoryGen;
    const factory = {
      tool: 'release-candidate', verdict: 'PASS', readiness: 'FULL_RELEASE_READY',
      profile: 'full', origin: CLI_ORIGIN, gateContract: GATE_CONTRACT_VERSION,
      candidate: { generation: genOf(fk), files: 1, sha256: digests[fk] },
      package: '1.5.0', protocol: { version: '8.1.0', commit: REAL_COMMIT },
      commitState: 'COMMITTED', publicationAuthorized: false,
      ...factoryOverrides,
    };
    const factoryPath = join(base, 'factory.json');
    writeFileSync(factoryPath, JSON.stringify(factory));
    return {
      factory: factoryPath, receipt: receiptPath, out: join(base, 'CHECKLIST.md'),
      digests, pkgZip: join(base, 'pkg', 'store.zip'), storeId,
    };
  }

  it('CLI1. valid current handoff with --factory: exit 0, approved sheet', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 0);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /FULL_READY_FOR_OPERATOR_HANDOFF/);
    assert.match(text, /\[x\] Package holds the verified public tree/);
  });

  it('CLI2. missing --factory: exit 2, current handoff refused', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /requires --factory/);
    assert.equal(existsSync(f.out), false);
  });

  it('CLI3. missing --factory with valid package: exit 2, no approval file', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 2);
    assert.equal(existsSync(f.out), false);
  });

  it('CLI4. missing current.json with --factory: exit 1, BLOCKED', () => {
    const f = cliFixture({ dropPointer: true });
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /BLOCKED/);
    assert.match(readFileSync(f.out, 'utf8'), /DIAGNOSTIC/);
  });

  it('CLI5. missing current.json with --inspect-package: no current-release approval', () => {
    const f = cliFixture({ dropPointer: true });
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--inspect-package', '--out', f.out]);
    const text = readFileSync(f.out, 'utf8');
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
    assert.match(text, /NOT a current-release approval|do NOT deploy/);
    assert.equal(r.code, 0);
  });

  it('CLI6. failed factory with valid package: exit 1, diagnostic overwrites', () => {
    const f = cliFixture({ factoryOverrides: { verdict: 'FAIL', readiness: 'NOT_READY', commitState: 'NOT_COMMITTED' } });
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 1);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /DIAGNOSTIC/);
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
  });

  it('CLI7. NOT_COMMITTED factory with valid package: exit 1', () => {
    const f = cliFixture({ factoryOverrides: { commitState: 'NOT_COMMITTED' } });
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /NOT_COMMITTED/);
  });

  it('CLI8. stale factory generation: exit 1, STALE_OR_MISMATCHED', () => {
    const f = cliFixture({ gens: ['a', 'b'], factoryGen: 'b' });
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /STALE_OR_MISMATCHED/);
  });

  it('CLI9. corrupted package: exit 1, no approval', () => {
    const f = cliFixture();
    writeFileSync(f.pkgZip, Buffer.concat([readFileSync(f.pkgZip), Buffer.from('tamper')]));
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 1);
    assert.doesNotMatch(readFileSync(f.out, 'utf8'), /\[x\] Package holds the verified public tree/);
  });

  it('CLI10. candidate-only package: exit 1, never current-release approved', () => {
    const f = cliFixture({ candidateOnly: true });
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 1);
    assert.doesNotMatch(readFileSync(f.out, 'utf8'), /\[x\] Package holds the verified public tree/);
  });

  it('CLI11. explicit package-inspection mode: exit 0, integrity without approval', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--inspect-package', '--out', f.out]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /NOT a current-release approval/);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /PACKAGE_INTEGRITY_VERIFIED/);
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
  });

  it('CLI12. explicit valid historical rollback: exit 0, labelled HISTORICAL_ROLLBACK', () => {
    const f = cliFixture({ gens: ['a', 'b'], receiptGen: 'b' });
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN,
      '--rollback-generation', GEN_B, '--rollback-sha256', f.digests.b, '--out', f.out]);
    assert.equal(r.code, 0);
    assert.match(r.stderr, /HISTORICAL_ROLLBACK/);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /HISTORICAL_ROLLBACK/);
    assert.match(text, /NOT the current release/);
  });

  it('CLI13. rollback flags without --factory: exit 2', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN,
      '--rollback-generation', GEN_A, '--rollback-sha256', f.digests.a, '--out', f.out]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /require --factory/);
    assert.equal(existsSync(f.out), false);
  });

  it('CLI14. missing origin: exit 2', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--out', f.out]);
    assert.equal(r.code, 2);
  });

  it('CLI15. different package and target origin: exit nonzero, no approval', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', 'https://other-host.example', '--out', f.out]);
    assert.notEqual(r.code, 0);
    if (existsSync(f.out)) {
      assert.doesNotMatch(readFileSync(f.out, 'utf8'), /\[x\] Package holds the verified public tree/);
    }
  });

  it('CLI16. correct factory + pointer + package identities: exit 0 with matching digests', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 0);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, new RegExp(GEN_A));
    assert.match(text, new RegExp(f.digests.a.slice(0, 16)));
  });

  it('CLI17. exit-code contract: usage errors exit 2, failed verification exits 1', () => {
    const usage = cliFixture();
    assert.equal(runCli(['--receipt', usage.receipt, '--origin', CLI_ORIGIN]).code, 2);
    const failed = cliFixture({ factoryOverrides: { verdict: 'FAIL', readiness: 'NOT_READY', commitState: 'NOT_COMMITTED' } });
    assert.equal(runCli(['--receipt', failed.receipt, '--factory', failed.factory, '--origin', CLI_ORIGIN, '--out', failed.out]).code, 1);
  });

  it('CLI18. a failed run cannot leave a previous approval behind', () => {
    const f = cliFixture();
    const ok = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(ok.code, 0);
    assert.match(readFileSync(f.out, 'utf8'), /\[x\] Package holds the verified public tree/);
    writeFileSync(f.pkgZip, Buffer.concat([readFileSync(f.pkgZip), Buffer.from('tamper')]));
    const bad = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(bad.code, 1);
    const text = readFileSync(f.out, 'utf8');
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
    assert.match(text, /DIAGNOSTIC|FAILED/);
  });

  // Output-state controls: early usage failures (exit 2) neutralize a
  // stale generated approval through the same shared helper as
  // verification failures. Unrelated files are never touched, nothing is
  // created for first-time failures, and inputs are never modified.
  function snapshotTree(base) {
    const out = new Map();
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        try {
          if (statSync(p).isDirectory()) { walk(p); continue; }
          out.set(p.slice(base.length), createHash('sha256').update(readFileSync(p)).digest('hex'));
        } catch { /* unreadable entries are not approval evidence */ }
      }
    };
    walk(base);
    return out;
  }

  function seedApproval(f) {
    const ok = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(ok.code, 0);
    assert.match(readFileSync(f.out, 'utf8'), /\[x\] Package holds the verified public tree/);
  }

  function assertNeutralized(f, before, code) {
    const text = readFileSync(f.out, 'utf8');
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
    assert.match(text, /DIAGNOSTIC — not handoff-ready/);
    assert.match(text, /Refusal:/);
    const after = snapshotTree(dirname(f.out));
    const skipOut = ([k]) => !k.endsWith('CHECKLIST.md');
    assert.deepEqual([...after.entries()].filter(skipOut), [...before.entries()].filter(skipOut));
  }

  it('CLIS1. existing approval + missing --factory: exit 2, neutralized, inputs intact', () => {
    const f = cliFixture();
    seedApproval(f);
    const before = snapshotTree(dirname(f.out));
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /requires --factory/);
    assertNeutralized(f, before, r.code);
  });

  it('CLIS2. existing approval + missing --origin: exit 2, neutralized', () => {
    const f = cliFixture();
    seedApproval(f);
    const before = snapshotTree(dirname(f.out));
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--out', f.out]);
    assert.equal(r.code, 2);
    assertNeutralized(f, before, r.code);
  });

  it('CLIS3. existing approval + incomplete rollback flags: exit 2, neutralized, inputs intact', () => {
    const f = cliFixture();
    seedApproval(f);
    const before = snapshotTree(dirname(f.out));
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN,
      '--rollback-generation', GEN_A, '--out', f.out]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /required together/);
    assertNeutralized(f, before, r.code);
  });

  it('CLIS4. existing approval + incompatible inspection flags: exit 2, neutralized', () => {
    const f = cliFixture();
    seedApproval(f);
    const before = snapshotTree(dirname(f.out));
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN,
      '--inspect-package', '--out', f.out]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /cannot combine/);
    assertNeutralized(f, before, r.code);
  });

  it('CLIS5. existing approval + unknown option after --out: exit 2, neutralized', () => {
    const f = cliFixture();
    seedApproval(f);
    const before = snapshotTree(dirname(f.out));
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN,
      '--out', f.out, '--bogus-flag']);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /unknown option/);
    assertNeutralized(f, before, r.code);
  });

  it('CLIS6. existing approval + failed package verification: exit 1, neutralized, inputs intact', () => {
    const f = cliFixture();
    seedApproval(f);
    const base = dirname(f.out);
    const storeDir = readdirSync(base).find((n) => existsSync(join(base, n, 'generations', GEN_A, 'index.html')));
    assert.ok(storeDir);
    rmSync(join(base, storeDir, 'generations', GEN_A, 'index.html'));
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 1);
    const text = readFileSync(f.out, 'utf8');
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
    assert.match(text, /DIAGNOSTIC|FAILED/);
    assert.ok(existsSync(f.receipt));
    assert.ok(existsSync(f.factory));
    assert.ok(existsSync(f.pkgZip));
  });

  it('CLIS7. invalid first-time invocation creates nothing; unrelated files untouched', () => {
    const f = cliFixture();
    const fresh = join(dirname(f.out), 'never-created.md');
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--out', fresh]);
    assert.equal(r.code, 2);
    assert.equal(existsSync(fresh), false);
    const userFile = join(dirname(f.out), 'operator-notes.txt');
    writeFileSync(userFile, 'operator private notes');
    const r2 = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--out', userFile]);
    assert.equal(r2.code, 2);
    assert.equal(readFileSync(userFile, 'utf8'), 'operator private notes');
  });

  it('CLIS8. valid current-release invocation still approves', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
    assert.equal(r.code, 0);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /FULL_READY_FOR_OPERATOR_HANDOFF/);
    assert.match(text, /\[x\] Package holds the verified public tree/);
  });

  it('CLIS9. valid explicit package inspection stays unapproved', () => {
    const f = cliFixture();
    const r = runCli(['--receipt', f.receipt, '--origin', CLI_ORIGIN, '--inspect-package', '--out', f.out]);
    assert.equal(r.code, 0);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /PACKAGE_INTEGRITY_VERIFIED/);
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
  });

  it('CLIS10. valid historical rollback stays labelled, never current', () => {
    const f = cliFixture({ gens: ['a', 'b'], receiptGen: 'b' });
    const r = runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN,
      '--rollback-generation', GEN_B, '--rollback-sha256', f.digests.b, '--out', f.out]);
    assert.equal(r.code, 0);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /HISTORICAL_ROLLBACK/);
    assert.match(text, /NOT the current release/);
  });

  // Contract-currency controls (Stage A): a CURRENT_RELEASE_HANDOFF
  // requires the factory report, the package attestation, AND the
  // generation receipt to attest under the current gate contract. The
  // default fixture above is current; old-version evidence is explicit
  // here and must be rejected (exit 1, diagnostic sheet, no approval).
  function rewriteJson(path, mutate) {
    const obj = JSON.parse(readFileSync(path, 'utf8'));
    mutate(obj);
    writeFileSync(path, JSON.stringify(obj));
  }
  function reportsReceipt(f, gen) {
    return join(ROOT, 'reports', 'release', 'candidates', f.storeId, `${gen}.json`);
  }
  function runHandoff(f) {
    return runCli(['--receipt', f.receipt, '--factory', f.factory, '--origin', CLI_ORIGIN, '--out', f.out]);
  }
  function assertRejected(f, r, pattern) {
    assert.equal(r.code, 1);
    assert.match(r.stderr, pattern);
    const text = readFileSync(f.out, 'utf8');
    assert.match(text, /DIAGNOSTIC/);
    assert.doesNotMatch(text, /\[x\] Package holds the verified public tree/);
  }

  it('CLIC1. factory v2 + package v2 under a v3 generation receipt: REJECT current handoff', () => {
    const f = cliFixture();
    rewriteJson(f.factory, (o) => { o.gateContract = '2'; });
    rewriteJson(f.receipt, (o) => { o.fullReceipt.gateContract = '2'; });
    assertRejected(f, runHandoff(f), /factory report gate contract 2 != current required gate contract/);
  });

  it('CLIC2. factory v3 + package v2 + receipt v3: REJECT', () => {
    const f = cliFixture();
    rewriteJson(f.receipt, (o) => { o.fullReceipt.gateContract = '2'; });
    assertRejected(f, runHandoff(f), /gate-contract disagreement/);
  });

  it('CLIC3. factory v2 + package v3 + receipt v3: REJECT', () => {
    const f = cliFixture();
    rewriteJson(f.factory, (o) => { o.gateContract = '2'; });
    assertRejected(f, runHandoff(f), /gate-contract disagreement/);
  });

  it('CLIC4. factory/package v3 + generation receipt v2: REJECT', () => {
    const f = cliFixture();
    rewriteJson(reportsReceipt(f, GEN_A), (o) => { o.gateContract = '2'; });
    assertRejected(f, runHandoff(f), /STALE_OR_MISMATCHED/);
  });

  it('CLIC5. missing factory contract field: REJECT', () => {
    const f = cliFixture();
    rewriteJson(f.factory, (o) => { delete o.gateContract; });
    assertRejected(f, runHandoff(f), /gate-contract disagreement/);
  });

  it('CLIC6. unknown future contract on factory + package: REJECT', () => {
    const f = cliFixture();
    rewriteJson(f.factory, (o) => { o.gateContract = '99'; });
    rewriteJson(f.receipt, (o) => { o.fullReceipt.gateContract = '99'; });
    assertRejected(f, runHandoff(f), /gate contract 99/);
  });

  it('CLIC7. current generation has no applicable receipt: REJECT', () => {
    const f = cliFixture();
    rmSync(reportsReceipt(f, GEN_A));
    assertRejected(f, runHandoff(f), /CANDIDATE_ONLY/);
  });
});
