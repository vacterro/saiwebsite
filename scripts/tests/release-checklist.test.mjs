/**
 * Stage B + C + D controls: the operator checklist never trusts a
 * readiness string. verifyPackageHandoff() re-establishes every
 * invariant against live bytes (package file, generation bytes,
 * applicable generation receipt under the current contract) using the
 * REAL shared readiness decision and digest verifier. Only
 * FULL_READY_FOR_OPERATOR_HANDOFF renders checked LOCAL READY claims.
 *
 * Origin grammar comes from the central validator: credentials, query
 * strings, fragments, paths, and public ports are all refused there.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import {
  ROOT,
  buildChecklist,
  normalizeTarget,
  verifyPackageHandoff,
  verifyReleaseHandoff,
  installHandoffLoaders,
} from '../release-checklist.mjs';
import {
  verifyDigest,
  computeDigest,
  readPointer,
  GATE_CONTRACT_VERSION,
  REQUIRED_FULL_GATES,
} from '../release-candidate.mjs';
import { readApplicableReceipt, decideGenerationReadiness } from '../release-readiness.mjs';
import { writeDeterministicZip } from '../release-package.mjs';

installHandoffLoaders({
  verifyDigest,
  readApplicableReceipt,
  decideGenerationReadiness,
  gateContract: GATE_CONTRACT_VERSION,
  requiredGates: REQUIRED_FULL_GATES,
  readPointer,
});

const ORIGIN = 'https://checklist-fixture.example';
const GEN = 'g-abc123def4567890';
const STORE = 'fixture-store';

let root;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sai-check-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function fullGenerationReceipt(sha, overrides = {}) {
  const gates = {};
  for (const id of REQUIRED_FULL_GATES) gates[id] = true;
  return {
    tool: 'release-candidate', receiptKind: 'generation-readiness',
    gateContract: GATE_CONTRACT_VERSION, origin: ORIGIN, storeId: STORE,
    generation: GEN, sha256: sha, files: 1,
    source: { rev: 'a'.repeat(40), dirty: false, dirtyFiles: 0, dirtyIdentity: null, provenance: 'head' },
    package: '1.5.0', protocol: { version: '8.1.0', commit: 'c'.repeat(40) },
    profile: 'full', verdict: 'PASS', readiness: 'FULL_RELEASE_READY', commitState: 'COMMITTED',
    gates, releaseVerify: 'PASS', candidateVerify: 'PASS', smoke: 'LOCAL_STATIC_HOST_PASS',
    engine: { tests: 10, pass: 10, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 },
    engineBuild: { tests: 5, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0, unknownSkips: 0 },
    browser: { tests: 20, passed: 20, failed: 0, skipped: 0, flaky: 0, unknownSkips: 0, missingSuites: 0 },
    stagedDigest: sha,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** A fully honest fixture tree; returns { receiptRel, receipt }. */
function honestHandoff() {
  // Store directory name and reports directory name must agree, exactly as
  // the factory lays them out (candidate.store basename == reports subdir).
  const genDir = join(root, STORE, 'generations', GEN);
  mkdirSync(genDir, { recursive: true });
  writeFileSync(join(genDir, 'index.html'), 'staged-bytes');
  const candSha = computeDigest(genDir).sha256;
  const { bytes, sha256: pkgSha } = writeDeterministicZip(new Map([['index.html', Buffer.from('staged-bytes')]]));
  mkdirSync(join(root, 'pkg'), { recursive: true });
  writeFileSync(join(root, 'pkg', 'store.zip'), bytes);
  mkdirSync(join(root, 'reports', 'release', 'candidates', STORE), { recursive: true });
  writeFileSync(
    join(root, 'reports', 'release', 'candidates', STORE, `${GEN}.json`),
    JSON.stringify(fullGenerationReceipt(candSha)),
  );
  const receipt = {
    tool: 'release-package', verdict: 'PASS', origin: ORIGIN,
    candidate: { store: STORE, generation: GEN, files: 1, sha256: candSha },
    package: { file: 'pkg/store.zip', files: 1, sha256: pkgSha, bytes: bytes.length },
    extractionVerify: { verdict: 'PASS', failing: [] },
    extractionSmoke: { verdict: 'LOCAL_STATIC_HOST_PASS', failing: [] },
    fullReceipt: { status: 'FULL', reason: null, generation: GEN, gateContract: GATE_CONTRACT_VERSION },
    readiness: 'FULL_RELEASE_READY',
    publicationAuthorized: false,
  };
  const receiptRel = 'pkg-receipt.json';
  writeFileSync(join(root, receiptRel), JSON.stringify(receipt));
  // Genuine authoritative selection: the store's current.json pointer
  // names the same generation, digest, and origin (Stage C fixture rule).
  writeFileSync(join(root, STORE, 'current.json'), JSON.stringify({
    generation: GEN, sha256: candSha, files: 1, origin: ORIGIN,
    createdAt: new Date().toISOString(),
  }));
  return { receiptRel, receipt, pkgBytes: bytes, candSha, pkgSha };
}

/** A factory per-origin report matching the honest handoff; returns its path. */
function matchingFactory(candSha, overrides = {}) {
  const report = {
    tool: 'release-candidate', verdict: 'PASS', readiness: 'FULL_RELEASE_READY',
    profile: 'full', origin: ORIGIN, gateContract: GATE_CONTRACT_VERSION,
    candidate: { generation: GEN, files: 1, sha256: candSha },
    package: '1.5.0', protocol: { version: '8.1.0', commit: 'c'.repeat(40) },
    commitState: 'COMMITTED',
    publicationAuthorized: false,
    ...overrides,
  };
  const rel = 'factory.json';
  writeFileSync(join(root, rel), JSON.stringify(report));
  return rel;
}

function handoff(factoryRel, receiptRel, extra = {}) {
  return verifyReleaseHandoff({ root, factoryReceiptPath: factoryRel, packageReceiptPath: receiptRel, targetOrigin: ORIGIN, ...extra });
}

function verify(rel, origin = ORIGIN) {
  return verifyPackageHandoff({ root, receiptPath: rel, targetOrigin: origin });
}

describe('verifyPackageHandoff states', () => {
  it('valid matching FULL package: FULL_READY_FOR_OPERATOR_HANDOFF', () => {
    const { receiptRel } = honestHandoff();
    const v = verify(receiptRel);
    assert.equal(v.state, 'FULL_READY_FOR_OPERATOR_HANDOFF');
    assert.deepEqual(v.reasons, []);
    assert.equal(v.detail.generation, GEN);
  });

  it('1. failed package with a FULL readiness string: FAILED, never handoff', () => {
    const { receiptRel, receipt } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({ ...receipt, verdict: 'FAIL' }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'FAILED');
    assert.match(v.reasons.join(' '), /verdict is FAIL/);
  });

  it('2. empty fabricated FULL receipt: FAILED, never handoff', () => {
    const rel = 'empty.json';
    writeFileSync(join(root, rel), JSON.stringify({ verdict: 'PASS', origin: ORIGIN, readiness: 'FULL_RELEASE_READY' }));
    const v = verify(rel);
    assert.equal(v.state, 'FAILED');
    assert.match(v.reasons.join(' '), /no valid candidate generation/);
  });

  it('3. missing package file: BLOCKED with missing-verification report', () => {
    const { receiptRel } = honestHandoff();
    rmSync(join(root, 'pkg', 'store.zip'));
    const v = verify(receiptRel);
    assert.equal(v.state, 'BLOCKED');
    assert.match(v.reasons.join(' '), /absent/);
  });

  it('4. corrupted package file: STALE_OR_MISMATCHED', () => {
    const { receiptRel } = honestHandoff();
    writeFileSync(join(root, 'pkg', 'store.zip'), Buffer.concat([readFileSync(join(root, 'pkg', 'store.zip')), Buffer.from('tamper')]));
    const v = verify(receiptRel);
    assert.equal(v.state, 'STALE_OR_MISMATCHED');
    assert.match(v.reasons.join(' '), /corrupted or replaced/);
  });

  it('5. incorrect package digest in receipt: STALE_OR_MISMATCHED', () => {
    const { receiptRel, receipt } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, package: { ...receipt.package, sha256: 'f'.repeat(64) },
    }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'STALE_OR_MISMATCHED');
  });

  it('6. incorrect generation: STALE_OR_MISMATCHED', () => {
    const { receiptRel, receipt } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, candidate: { ...receipt.candidate, generation: 'g-ffffffffffffffff' },
    }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'STALE_OR_MISMATCHED');
  });

  it('7. incorrect candidate digest: STALE_OR_MISMATCHED', () => {
    const { receiptRel, receipt } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, candidate: { ...receipt.candidate, sha256: 'e'.repeat(64) },
    }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'STALE_OR_MISMATCHED');
  });

  it('8. stale verification contract: STALE_OR_MISMATCHED, history kept', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(
      join(root, 'reports', 'release', 'candidates', STORE, `${GEN}.json`),
      JSON.stringify(fullGenerationReceipt(candSha, { gateContract: '1' })),
    );
    const v = verify(receiptRel);
    assert.equal(v.state, 'STALE_OR_MISMATCHED');
    assert.match(v.reasons.join(' '), /contract 1|re-verify|does not attest/i);
  });

  it('9. candidate-only verification: CANDIDATE_ONLY, never handoff', () => {
    const { receiptRel, receipt, candSha } = honestHandoff();
    writeFileSync(
      join(root, 'reports', 'release', 'candidates', STORE, `${GEN}.json`),
      JSON.stringify(fullGenerationReceipt(candSha, { profile: 'candidate', readiness: 'CANDIDATE_ONLY' })),
    );
    writeFileSync(join(root, receiptRel), JSON.stringify({ ...receipt, readiness: 'CANDIDATE_ONLY' }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'CANDIDATE_ONLY');
  });

  it('10. missing source provenance: CANDIDATE_ONLY', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(
      join(root, 'reports', 'release', 'candidates', STORE, `${GEN}.json`),
      JSON.stringify(fullGenerationReceipt(candSha, {
        source: { rev: 'a'.repeat(40), dirty: true, dirtyFiles: 3, dirtyIdentity: null, provenance: 'limited' },
      })),
    );
    const v = verify(receiptRel);
    assert.equal(v.state, 'CANDIDATE_ONLY');
    assert.match(v.reasons.join(' '), /limited/);
  });

  it('11. missing mandatory gate evidence: CANDIDATE_ONLY', () => {
    const { receiptRel, candSha } = honestHandoff();
    const rec = fullGenerationReceipt(candSha);
    delete rec.gates['test:browser-matrix'];
    writeFileSync(join(root, 'reports', 'release', 'candidates', STORE, `${GEN}.json`), JSON.stringify(rec));
    const v = verify(receiptRel);
    assert.equal(v.state, 'CANDIDATE_ONLY');
    assert.match(v.reasons.join(' '), /mandatory gates/);
  });

  it('12. extraction failure: FAILED', () => {
    const { receiptRel, receipt } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, extractionVerify: { verdict: 'FAIL', failing: ['seo.canonical'] },
    }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'FAILED');
  });

  it('13. smoke failure: FAILED', () => {
    const { receiptRel, receipt } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, extractionSmoke: { verdict: 'STATIC_HOST_FAIL', failing: ['probe'] },
    }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'FAILED');
  });

  it('unreadable receipt: BLOCKED, never a crash', () => {
    const v = verify('no-such-receipt.json');
    assert.equal(v.state, 'BLOCKED');
    const corrupt = 'corrupt.json';
    writeFileSync(join(root, corrupt), '{ corrupt');
    assert.equal(verify(corrupt).state, 'BLOCKED');
  });
});

describe('buildChecklist rendering', () => {
  it('FULL_READY verification renders checked LOCAL READY claims', () => {
    const { receiptRel, receipt } = honestHandoff();
    const v = verify(receiptRel);
    assert.equal(v.state, 'FULL_READY_FOR_OPERATOR_HANDOFF');
    const text = buildChecklist(receipt, ORIGIN, v);
    assert.match(text, /FULL_READY_FOR_OPERATOR_HANDOFF/);
    assert.ok(text.includes('[x] Package holds the verified public tree'));
    assert.ok(!text.includes('[ ] Package holds'));
  });

  it('FAILED verification renders a diagnostic sheet with unchecked boxes', () => {
    const { receiptRel, receipt } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({ ...receipt, verdict: 'FAIL' }));
    const v = verify(receiptRel);
    assert.equal(v.state, 'FAILED');
    const text = buildChecklist(receipt, ORIGIN, v);
    assert.match(text, /DIAGNOSTIC/);
    assert.ok(text.includes('[ ] Package holds the verified public tree'));
    assert.ok(!text.includes('[x] Package holds'));
    assert.match(text, /verdict is FAIL/);
  });

  it('unverified receipt renders diagnostic, never checked claims', () => {
    const { receipt } = honestHandoff();
    const text = buildChecklist(receipt, ORIGIN);
    assert.match(text, /UNVERIFIED/);
    assert.ok(!text.includes('[x] Package holds'));
  });

  it('a target hostname differing from the packaged origin fails the handoff gate', () => {
    const { receiptRel, receipt } = honestHandoff();
    assert.throws(
      () => buildChecklist(receipt, 'https://temporary-host.example'),
      /!= packaged candidate origin/,
    );
    assert.equal(verify(receiptRel, 'https://temporary-host.example').state, 'STALE_OR_MISMATCHED');
  });

  it('Stage C: credentials, query, fragment, and public ports are refused centrally', () => {
    assert.throws(() => normalizeTarget('https://user:pass@host.example'), /credentials/);
    assert.throws(() => normalizeTarget('https://host.example/?q=1'), /query string or fragment/);
    assert.throws(() => normalizeTarget('https://host.example/#frag'), /query string or fragment/);
    assert.throws(() => normalizeTarget('https://host.example:8443'), /explicit port/);
    assert.throws(() => normalizeTarget('https://host.example/docs/'), /bare origin/);
    assert.throws(() => normalizeTarget('http://plain.example'), /unsupported protocol|fully qualified/);
    assert.equal(normalizeTarget(`${ORIGIN}/`), ORIGIN);
  });

  it('an unreadable receipt object never produces a checklist', () => {
    assert.throws(() => buildChecklist(null, ORIGIN), /readable package receipt/);
  });
});

describe('verifyReleaseHandoff cross-artifact identity', () => {
  it('8. correct current package and factory: HANDOFF_VERIFIED, not a rollback', () => {
    const { receiptRel, candSha } = honestHandoff();
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, true);
    assert.equal(h.rollback, false);
    assert.equal(h.state, 'HANDOFF_VERIFIED');
    assert.equal(h.identity.factoryGeneration, h.identity.packageGeneration);
  });

  it('D1. current factory v2 with an old v1 package: STALE_OR_MISMATCHED', () => {
    const { receiptRel, receipt, candSha } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, fullReceipt: { status: 'FULL', reason: null, generation: GEN, gateContract: '1' },
    }));
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /gate-contract disagreement/);
  });

  it('D2. same contract but different generation: handoff refused', () => {
    const { receiptRel, candSha } = honestHandoff();
    const h = handoff(matchingFactory(candSha, { candidate: { generation: 'g-ffffffffffffffff', files: 1, sha256: candSha } }), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /generation disagreement/);
  });

  it('D3. same generation but different digest: handoff refused', () => {
    const { receiptRel } = honestHandoff();
    const h = handoff(matchingFactory('e'.repeat(64)), receiptRel);
    assert.equal(h.ok, false);
    assert.match(h.reasons.join(' '), /digest disagreement/);
  });

  it('D4. same generation but different origin: handoff refused', () => {
    const { receiptRel, candSha } = honestHandoff();
    const h = handoff(matchingFactory(candSha, { origin: 'https://other.example' }), receiptRel);
    assert.equal(h.ok, false);
    assert.match(h.reasons.join(' '), /origin disagreement|foreign execution record/);
  });

  it('D5. same generation but different protocol identity: handoff refused', () => {
    const { receiptRel, candSha } = honestHandoff();
    mkdirSync(join(root, 'src', 'data', 'canonical'), { recursive: true });
    writeFileSync(join(root, 'src', 'data', 'canonical', 'meta.json'), JSON.stringify({ version: '8.1.0', commit: 'c'.repeat(40) }));
    const h = handoff(matchingFactory(candSha, { protocol: { version: '8.1.0', commit: 'f'.repeat(40) } }), receiptRel);
    assert.equal(h.ok, false);
    assert.match(h.reasons.join(' '), /unacknowledged upstream change/);
  });

  it('D6. corrupted package after receipt creation: handoff refused', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(join(root, 'pkg', 'store.zip'), Buffer.concat([readFileSync(join(root, 'pkg', 'store.zip')), Buffer.from('x')]));
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.ok(['STALE_OR_MISMATCHED', 'FAILED', 'BLOCKED'].includes(h.state));
  });

  it('C2. factory FAIL with matching package: REJECT, never HANDOFF_VERIFIED', () => {
    const { receiptRel, candSha } = honestHandoff();
    const factoryRel = matchingFactory(candSha, { verdict: 'FAIL', readiness: 'NOT_READY', commitState: 'NOT_COMMITTED' });
    const h = handoff(factoryRel, receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'FAILED');
    assert.match(h.reasons.join(' '), /verdict is FAIL/);
  });

  it('C3. factory NOT_READY with matching package: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    const factoryRel = matchingFactory(candSha, { verdict: 'PASS', readiness: 'NOT_READY' });
    const h = handoff(factoryRel, receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'FAILED');
    assert.match(h.reasons.join(' '), /readiness is NOT_READY/);
  });

  it('C4. factory NOT_COMMITTED with matching package: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    const factoryRel = matchingFactory(candSha, { commitState: 'NOT_COMMITTED' });
    const h = handoff(factoryRel, receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'FAILED');
    assert.match(h.reasons.join(' '), /commit state is NOT_COMMITTED/);
  });

  it('C5. missing factory verdict: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    const report = { ...JSON.parse(readFileSync(join(root, matchingFactory(candSha)), 'utf8')) };
    delete report.verdict;
    writeFileSync(join(root, 'factory.json'), JSON.stringify(report));
    const h = handoff('factory.json', receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'FAILED');
    assert.match(h.reasons.join(' '), /verdict is missing/);
  });

  it('C6. missing factory commit state: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    const report = { ...JSON.parse(readFileSync(join(root, matchingFactory(candSha)), 'utf8')) };
    delete report.commitState;
    writeFileSync(join(root, 'factory.json'), JSON.stringify(report));
    const h = handoff('factory.json', receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'FAILED');
    assert.match(h.reasons.join(' '), /commit state is missing/);
  });

  it('C7. candidate-only factory with FULL package: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    const factoryRel = matchingFactory(candSha, { profile: 'candidate', readiness: 'CANDIDATE_ONLY' });
    const h = handoff(factoryRel, receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'FAILED');
    assert.match(h.reasons.join(' '), /not a full-readiness/);
  });

  it('C8. missing authoritative current pointer: current handoff BLOCKED', () => {
    const { receiptRel, candSha } = honestHandoff();
    rmSync(join(root, STORE, 'current.json'));
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'BLOCKED');
    assert.match(h.reasons.join(' '), /no authoritative current pointer/);
  });

  it('C9. pointer selects a different generation: REJECT current handoff', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(join(root, STORE, 'current.json'), JSON.stringify({
      generation: 'g-ffffffffffffffff', sha256: candSha, files: 1, origin: ORIGIN,
    }));
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /pointer selects/);
  });

  it('C10. pointer digest differs: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(join(root, STORE, 'current.json'), JSON.stringify({
      generation: GEN, sha256: 'e'.repeat(64), files: 1, origin: ORIGIN,
    }));
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /pointer digest differs/);
  });

  it('C11. pointer origin differs: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(join(root, STORE, 'current.json'), JSON.stringify({
      generation: GEN, sha256: candSha, files: 1, origin: 'https://other.example',
    }));
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /pointer origin/);
  });

  it('C12. corrupted authoritative generation: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(join(root, STORE, 'generations', GEN, 'index.html'), 'tampered bytes');
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /do not verify|stale or replaced/i);
  });

  it('C16. read-only verification never changes pointers or generation bytes', () => {
    const { receiptRel, candSha } = honestHandoff();
    const before = (p) => readFileSync(join(root, p), 'utf8');
    const pointerBefore = before(join(STORE, 'current.json'));
    const bytesBefore = before(join(STORE, 'generations', GEN, 'index.html'));
    const hPass = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(hPass.ok, true);
    const hFail = handoff(matchingFactory(candSha, { verdict: 'FAIL', readiness: 'NOT_READY', commitState: 'NOT_COMMITTED' }), receiptRel);
    assert.equal(hFail.ok, false);
    assert.equal(before(join(STORE, 'current.json')), pointerBefore);
    assert.equal(before(join(STORE, 'generations', GEN, 'index.html')), bytesBefore);
  });

  it('X1. factory v2 plus package v2 under a current v3 receipt: REJECT current handoff', () => {
    const { receiptRel, receipt, candSha } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, fullReceipt: { status: 'FULL', reason: null, generation: GEN, gateContract: '2' },
    }));
    const h = handoff(matchingFactory(candSha, { gateContract: '2' }), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /current required gate contract/);
  });

  it('X2. current factory v3 with an outdated v2 package: REJECT', () => {
    const { receiptRel, receipt, candSha } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, fullReceipt: { status: 'FULL', reason: null, generation: GEN, gateContract: '2' },
    }));
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /gate-contract disagreement|package attestation gate contract 2/);
  });

  it('X3. outdated v2 factory with a current v3 package: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    const h = handoff(matchingFactory(candSha, { gateContract: '2' }), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /gate-contract disagreement|factory report gate contract 2/);
  });

  it('X4. current factory and package but v2 generation receipt: REJECT', () => {
    const { receiptRel, candSha } = honestHandoff();
    writeFileSync(
      join(root, 'reports', 'release', 'candidates', STORE, `${GEN}.json`),
      JSON.stringify(fullGenerationReceipt(candSha, { gateContract: '2' })),
    );
    const h = handoff(matchingFactory(candSha), receiptRel);
    assert.equal(h.ok, false);
    assert.ok(['CANDIDATE_ONLY', 'STALE_OR_MISMATCHED'].includes(h.state), h.state);
  });

  it('X5. factory and package with no contract fields: REJECT as missing', () => {
    const { receiptRel, receipt, candSha } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, fullReceipt: { status: 'FULL', reason: null, generation: GEN },
    }));
    const factoryRel = matchingFactory(candSha);
    const report = JSON.parse(readFileSync(join(root, factoryRel), 'utf8'));
    delete report.gateContract;
    writeFileSync(join(root, factoryRel), JSON.stringify(report));
    const h = handoff(factoryRel, receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /missing/);
  });

  it('X6. unknown future contract on all three: REJECT unless supported', () => {
    const { receiptRel, receipt, candSha } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, fullReceipt: { status: 'FULL', reason: null, generation: GEN, gateContract: '99' },
    }));
    const h = handoff(matchingFactory(candSha, { gateContract: '99' }), receiptRel);
    assert.equal(h.ok, false);
    assert.equal(h.state, 'STALE_OR_MISMATCHED');
    assert.match(h.reasons.join(' '), /current required gate contract/);
  });

  it('X7. explicit rollback to a v2 package states its historical contract', () => {
    const { receiptRel, receipt, candSha } = honestHandoff();
    writeFileSync(join(root, receiptRel), JSON.stringify({
      ...receipt, fullReceipt: { status: 'FULL', reason: null, generation: GEN, gateContract: '2' },
    }));
    const factoryRel = matchingFactory(candSha, { candidate: { generation: 'g-ffffffffffffffff', files: 1, sha256: candSha } });
    const allowed = handoff(factoryRel, receiptRel, { allowHistorical: { generation: GEN, sha256: candSha } });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.state, 'HISTORICAL_ROLLBACK');
    assert.match(allowed.reasons.join(' '), /package attestation contract 2/);
    assert.match(allowed.reasons.join(' '), /NOT the current release/);
  });

  it('D7. historical rollback without explicit selection: refused; with it: honest rollback', () => {
    const { receiptRel, candSha } = honestHandoff();
    const factoryRel = matchingFactory(candSha, { candidate: { generation: 'g-ffffffffffffffff', files: 1, sha256: candSha } });
    const refused = handoff(factoryRel, receiptRel);
    assert.equal(refused.ok, false);
    const allowed = handoff(factoryRel, receiptRel, { allowHistorical: { generation: GEN, sha256: candSha } });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.rollback, true);
    assert.equal(allowed.state, 'HISTORICAL_ROLLBACK');
    assert.match(allowed.reasons.join(' '), /NOT the current release/);
  });
});
