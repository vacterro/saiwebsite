/**
 * Stage G negative controls: package readiness attestation.
 *
 * A package integrity PASS must never upgrade engineering readiness.
 * FULL_RELEASE_READY requires a bound generation FULL receipt; everything
 * else packages as explicitly labelled CANDIDATE_ONLY. These controls use
 * disposable fixture report trees -- no real store, no ZIP builds.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findFullReceipt } from '../release-package.mjs';
import { writeGenerationReceipt, GATE_CONTRACT_VERSION, REQUIRED_FULL_GATES } from '../release-candidate.mjs';

const ORIGIN = 'https://pkg-fixture.example';
const STORE = 'pkg-fixture-store';
const GEN = 'g-abc123';
const SHA = 'a'.repeat(64);

let reports;

beforeEach(() => {
  reports = mkdtempSync(join(tmpdir(), 'sai-pkgatt-'));
});

afterEach(() => {
  rmSync(reports, { recursive: true, force: true });
});

function fullReceipt(overrides = {}) {
  const gates = {};
  for (const id of REQUIRED_FULL_GATES) gates[id] = true;
  return {
    tool: 'release-candidate', receiptKind: 'generation-readiness',
    gateContract: GATE_CONTRACT_VERSION, origin: ORIGIN, storeId: STORE,
    generation: GEN, sha256: SHA, files: 3,
    source: { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' },
    package: '1.5.0', protocol: { version: '8.1.0', commit: 'c'.repeat(40) },
    stagedDigest: SHA,
    profile: 'full', verdict: 'PASS', readiness: 'FULL_RELEASE_READY', commitState: 'COMMITTED',
    gates, releaseVerify: 'PASS', candidateVerify: 'PASS', smoke: 'LOCAL_STATIC_HOST_PASS',
    engine: { tests: 10, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 },
    engineBuild: { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 },
    browser: { tests: 20, passed: 20, failed: 0, skipped: 0, flaky: 0, unknownSkips: 0, missingSuites: 0 },
    ...overrides,
  };
}

function writeReceiptFixture(receipt, generation = GEN) {
  mkdirSync(join(reports, STORE), { recursive: true });
  writeFileSync(join(reports, STORE, `${generation}.json`), JSON.stringify(receipt));
}

function attest(generation = GEN, sha = SHA, origin = ORIGIN) {
  return findFullReceipt({
    reportsDir: reports, storeId: STORE, origin, generation, sha256: sha,
    gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES,
  });
}

describe('findFullReceipt', () => {
  it('2. fully verified generation attests FULL', () => {
    writeReceiptFixture(fullReceipt());
    const r = attest();
    assert.equal(r.status, 'FULL');
    assert.equal(r.reason, null);
  });

  it('1. candidate-only generation (no receipt) packages CANDIDATE_ONLY, labelled', () => {
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /no generation receipt/);
  });

  it('3. FULL receipt for ANOTHER generation does not attest this one', () => {
    writeReceiptFixture(fullReceipt(), 'g-other');
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /no generation receipt/);
  });

  it('4. FULL receipt for ANOTHER origin is refused', () => {
    writeReceiptFixture(fullReceipt({ origin: 'https://other.example' }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /foreign attestation/);
  });

  it('5. receipt lacking mandatory gate evidence is refused', () => {
    const rec = fullReceipt();
    delete rec.gates['test:browser-matrix'];
    writeReceiptFixture(rec);
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /lacks passing mandatory gates.*test:browser-matrix/);
  });

  it('6. receipt with unknown skips is refused', () => {
    writeReceiptFixture(fullReceipt({ browser: { tests: 20, passed: 19, failed: 0, skipped: 1, flaky: 0, unknownSkips: 1, missingSuites: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /unknown skips/);
  });

  it('6b. receipt with failures is refused', () => {
    writeReceiptFixture(fullReceipt({ engine: { tests: 10, pass: 9, fail: 1, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /failures\/cancellations/);
  });

  it('7. changed candidate bytes (stale receipt) do not attest', () => {
    writeReceiptFixture(fullReceipt());
    const r = attest(GEN, 'b'.repeat(64));
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /stale receipt/);
  });

  it('8. corrupt receipt JSON is refused, never crashes', () => {
    mkdirSync(join(reports, STORE), { recursive: true });
    writeFileSync(join(reports, STORE, `${GEN}.json`), '{ corrupt');
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /unreadable/);
  });

  it('9. receipt under a stale gate contract is refused', () => {
    writeReceiptFixture(fullReceipt({ gateContract: '0' }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /gate contract 0/);
  });

  it('9b. candidate-level receipt never attests FULL', () => {
    writeReceiptFixture(fullReceipt({ profile: 'candidate', readiness: 'CANDIDATE_ONLY' }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /candidate-level|CANDIDATE_ONLY/);
  });

  it('B1-zero. FULL receipt with zero engine tests is rejected', () => {
    writeReceiptFixture(fullReceipt({ engine: { tests: 0, pass: 0, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /zero engine tests/);
  });

  it('B1-zero. FULL receipt with zero browser tests is rejected', () => {
    writeReceiptFixture(fullReceipt({ browser: { tests: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, unknownSkips: 0, missingSuites: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /zero browser tests/);
  });

  it('B1-missing. receipt without engine accounting is UNKNOWN, never zero', () => {
    const rec = fullReceipt();
    delete rec.engine;
    writeReceiptFixture(rec);
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /lacks engine accounting/);
  });

  it('B1-missing. receipt without browser accounting is UNKNOWN, never zero', () => {
    const rec = fullReceipt();
    delete rec.browser;
    writeReceiptFixture(rec);
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /lacks browser accounting/);
  });

  it('B1-missing. receipt without unknownSkips is UNKNOWN, never zero', () => {
    const rec = fullReceipt();
    delete rec.engine.unknownSkips;
    writeReceiptFixture(rec);
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /missing unknownSkips/);
  });

  it('B1-contra. receipt with contradictory engine totals is rejected', () => {
    writeReceiptFixture(fullReceipt({ engine: { tests: 10, pass: 7, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /contradictory/);
  });

  it('B1-contra. receipt with contradictory browser totals is rejected', () => {
    writeReceiptFixture(fullReceipt({ browser: { tests: 20, passed: 19, failed: 0, skipped: 0, flaky: 0, unknownSkips: 0, missingSuites: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /contradictory/);
  });

  it('B2-limited. FULL receipt with limited provenance is rejected (no exact-provenance claim)', () => {
    writeReceiptFixture(fullReceipt({ source: { rev: 'a'.repeat(40), dirty: true, dirtyFiles: 341, dirtyIdentity: null, provenance: 'limited' } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /provenance is limited/);
  });

  it('B2-unknown. FULL receipt with unknown revision is rejected', () => {
    writeReceiptFixture(fullReceipt({ source: { rev: 'unknown', dirty: true, dirtyFiles: -1, dirtyIdentity: null, provenance: 'limited' } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /not a valid HEAD identity/);
  });

  it('B2-dirty. dirty tree with no reliable identity is rejected', () => {
    writeReceiptFixture(fullReceipt({ source: { rev: 'a'.repeat(40), dirty: true, dirtyFiles: 5, dirtyIdentity: null, provenance: 'head+dirty-manifest' } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /no reliable identity/);
  });

  it('B2-format. malformed source revision is rejected', () => {
    writeReceiptFixture(fullReceipt({ source: { rev: 'deadbeef', dirty: false, dirtyIdentity: null, provenance: 'head' } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /not a valid HEAD identity/);
  });

  it('B2-dirty-ok. valid HEAD plus dirty-manifest identity attests FULL', () => {
    writeReceiptFixture(fullReceipt({ source: { rev: 'b'.repeat(40), dirty: true, dirtyFiles: 2, dirtyIdentity: 'c'.repeat(64), provenance: 'head+dirty-manifest' } }));
    const r = attest();
    assert.equal(r.status, 'FULL');
  });

  it('A1-missing. receipt without commit state cannot attest FULL', () => {
    const rec = fullReceipt();
    delete rec.commitState;
    writeReceiptFixture(rec);
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /commit state is missing/);
  });

  it('A1-notcommitted. NOT_COMMITTED receipt cannot attest a committed generation', () => {
    writeReceiptFixture(fullReceipt({ commitState: 'NOT_COMMITTED' }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /commit state is NOT_COMMITTED/);
  });

  it('A1-uncertain. COMMIT_STATE_UNCERTAIN receipt cannot attest FULL', () => {
    writeReceiptFixture(fullReceipt({ commitState: 'COMMIT_STATE_UNCERTAIN' }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /COMMIT_STATE_UNCERTAIN/);
  });

  it('A1-degraded. POSTCOMMIT_DEGRADED receipt is honest evidence, not FULL attestation', () => {
    writeReceiptFixture(fullReceipt({ commitState: 'POSTCOMMIT_DEGRADED', verdict: 'FAIL', readiness: 'NOT_READY' }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /never passed|commit state is POSTCOMMIT_DEGRADED/);
  });

  it('A2-fraction. fractional engine test totals are rejected', () => {
    writeReceiptFixture(fullReceipt({ engine: { tests: 10.5, pass: 10.5, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /missing tests|contradictory/);
  });

  it('A2-fraction. fractional browser test totals are rejected', () => {
    writeReceiptFixture(fullReceipt({ browser: { tests: 20.5, passed: 20.5, failed: 0, skipped: 0, flaky: 0, unknownSkips: 0, missingSuites: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /missing tests|contradictory/);
  });

  it('A2-negative. negative unknownSkips are rejected, never netted off', () => {
    writeReceiptFixture(fullReceipt({ engine: { tests: 10, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: -1 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /missing unknownSkips/);
  });

  it('A2-negative. negative missingSuites are rejected', () => {
    writeReceiptFixture(fullReceipt({ browser: { tests: 20, passed: 20, failed: 0, skipped: 0, flaky: 0, unknownSkips: 0, missingSuites: -2 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /missing missingSuites/);
  });

  it('A2-types. non-numeric counts are rejected', () => {
    writeReceiptFixture(fullReceipt({ engine: { tests: '10', pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /missing tests/);
  });

  it('A3-missing. receipt without staged digest cannot attest FULL', () => {
    const rec = fullReceipt();
    delete rec.stagedDigest;
    writeReceiptFixture(rec);
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /staged digest is missing/);
  });

  it('A3-diverged. staged digest differing from committed bytes cannot attest FULL', () => {
    writeReceiptFixture(fullReceipt({ stagedDigest: 'd'.repeat(64) }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /staged digest differs/);
  });

  it('A4-missing. receipt without protocol commit identity cannot attest FULL', () => {
    writeReceiptFixture(fullReceipt({ protocol: { version: '8.1.0' } }));
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /protocol commit identity is missing/);
  });

  it('A4-mismatch. changed upstream protocol snapshot is not silently attested', () => {
    writeReceiptFixture(fullReceipt());
    const r = findFullReceipt({
      reportsDir: reports, storeId: STORE, origin: ORIGIN, generation: GEN, sha256: SHA,
      gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES,
      protocolCommit: 'f'.repeat(40),
    });
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /upstream snapshot changed/);
  });

  it('A5-missing. absent gate registry cannot attest FULL', () => {
    writeReceiptFixture(fullReceipt());
    const r = findFullReceipt({
      reportsDir: reports, storeId: STORE, origin: ORIGIN, generation: GEN, sha256: SHA,
      gateContract: GATE_CONTRACT_VERSION, requiredGates: undefined,
    });
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /gate registry absent or empty/);
  });

  it('A5-empty. empty gate registry cannot attest FULL', () => {
    writeReceiptFixture(fullReceipt());
    const r = findFullReceipt({
      reportsDir: reports, storeId: STORE, origin: ORIGIN, generation: GEN, sha256: SHA,
      gateContract: GATE_CONTRACT_VERSION, requiredGates: [],
    });
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /gate registry absent or empty/);
  });

  it('A-healthy. valid committed FULL receipt with matching protocol still attests', () => {
    writeReceiptFixture(fullReceipt());
    const r = findFullReceipt({
      reportsDir: reports, storeId: STORE, origin: ORIGIN, generation: GEN, sha256: SHA,
      gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES,
      protocolCommit: 'c'.repeat(40),
    });
    assert.equal(r.status, 'FULL');
  });

  it('B4-failed-gate. receipt with a failed mandatory gate is refused', () => {
    const rec = fullReceipt();
    rec.gates['test:browser-matrix'] = false;
    writeReceiptFixture(rec);
    const r = attest();
    assert.equal(r.status, 'CANDIDATE_ONLY');
    assert.match(r.reason, /lacks passing mandatory gates.*test:browser-matrix/);
  });

  it('10/11. a later mutable FAIL cannot destroy the historical FULL receipt', () => {
    writeReceiptFixture(fullReceipt());
    // The mutable latest-attempt summary says FAIL; the generation receipt stands.
    mkdirSync(join(reports), { recursive: true });
    writeFileSync(join(reports, `${STORE}.json`), JSON.stringify({ verdict: 'FAIL', readiness: 'NOT_READY' }));
    const r = attest();
    assert.equal(r.status, 'FULL', 'attestation reads the generation receipt, never the mutable latest report');
  });
});

describe('writeGenerationReceipt keep-PASS rule', () => {
  it('existing PASS receipt survives a later FAIL for the same generation', () => {
    const root = mkdtempSync(join(tmpdir(), 'sai-genrec-'));
    try {
      const pass = fullReceipt();
      const first = writeGenerationReceipt(root, STORE, GEN, pass);
      assert.equal(first.preserved, false);
      const fail = { ...pass, verdict: 'FAIL', readiness: 'NOT_READY' };
      const second = writeGenerationReceipt(root, STORE, GEN, fail);
      assert.equal(second.preserved, true);
      const kept = JSON.parse(readFileSync(second.path, 'utf8'));
      assert.equal(kept.verdict, 'PASS');
      assert.equal(kept.readiness, 'FULL_RELEASE_READY');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a later PASS is recorded when only a FAIL receipt exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'sai-genrec-'));
    try {
      const fail = { ...fullReceipt(), verdict: 'FAIL', readiness: 'NOT_READY' };
      writeGenerationReceipt(root, STORE, GEN, fail);
      const second = writeGenerationReceipt(root, STORE, GEN, fullReceipt());
      assert.equal(second.preserved, false);
      assert.equal(JSON.parse(readFileSync(second.path, 'utf8')).verdict, 'PASS');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('B3-newer-contract. verification under a newer contract is NOT blocked by an older FULL receipt', () => {
    const root = mkdtempSync(join(tmpdir(), 'sai-genrec-'));
    try {
      const reportsDir = join(root, 'reports', 'release', 'candidates');
      const oldPass = { ...fullReceipt(), gateContract: '0' };
      const first = writeGenerationReceipt(root, STORE, GEN, oldPass);
      assert.equal(first.preserved, false);
      const newPass = fullReceipt();
      const second = writeGenerationReceipt(root, STORE, GEN, newPass);
      assert.equal(second.preserved, false, 'newer contract must produce its own receipt');
      const now = findFullReceipt({
        reportsDir, storeId: STORE, origin: ORIGIN, generation: GEN, sha256: SHA,
        gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES,
      });
      assert.equal(now.status, 'FULL');
      const history = findFullReceipt({
        reportsDir, storeId: STORE, origin: ORIGIN, generation: GEN, sha256: SHA,
        gateContract: '0', requiredGates: REQUIRED_FULL_GATES,
      });
      assert.equal(history.status, 'FULL', 'historical contract evidence stays accessible');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('B3-idempotent. re-running the same successful verification changes nothing', () => {
    const root = mkdtempSync(join(tmpdir(), 'sai-genrec-'));
    try {
      const first = writeGenerationReceipt(root, STORE, GEN, fullReceipt());
      assert.equal(first.preserved, false);
      const before = readFileSync(first.path, 'utf8');
      const second = writeGenerationReceipt(root, STORE, GEN, fullReceipt());
      assert.equal(second.preserved, true);
      assert.equal(readFileSync(second.path, 'utf8'), before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('B4-fail-kept. a same-contract FAIL after PASS preserves history in both slots', () => {
    const root = mkdtempSync(join(tmpdir(), 'sai-genrec-'));
    try {
      writeGenerationReceipt(root, STORE, GEN, fullReceipt());
      const fail = { ...fullReceipt(), verdict: 'FAIL', readiness: 'NOT_READY' };
      const second = writeGenerationReceipt(root, STORE, GEN, fail);
      assert.equal(second.preserved, true);
      const reportsDir = join(root, 'reports', 'release', 'candidates');
      const r = findFullReceipt({
        reportsDir, storeId: STORE, origin: ORIGIN, generation: GEN, sha256: SHA,
        gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES,
      });
      assert.equal(r.status, 'FULL', 'failed re-verification must not destroy the proof');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
