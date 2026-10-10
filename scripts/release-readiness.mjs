/**
 * One authoritative generation-readiness decision (Stage C).
 *
 * The factory, the generation receipt, the doctor, and the packager used to
 * derive readiness through separate checks, so a factory FULL could coexist
 * with a weaker historical receipt predicate. Every consumer that answers
 * "may this generation inherit FULL?" must go through
 * decideGenerationReadiness() here instead of duplicating the predicate.
 *
 * Responsibilities stay distinct:
 * - Factory (release-candidate.mjs): reports whether THIS execution passed.
 * - Generation receipt: records what was actually verified.
 * - Doctor (release-doctor.mjs): reports existing store/evidence health.
 * - Packager (release-package.mjs): confirms which readiness level a
 *   packaged generation may inherit via findFullReceipt().
 *
 * A SHA-256 digest proves byte identity against a recorded value, not
 * authenticity: operator-controlled local JSON is integrity-checked, never
 * treated as cryptographically authentic. Integrity, provenance, readiness,
 * and actual public deployment stay honestly distinct.
 *
 * No database, no external signing service: pure predicates over receipt
 * objects plus receipt-file naming/selection helpers (node:fs only).
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Deterministic run slot for one verification of a generation:
 * generation -> verification contract -> run identity. The run identity
 * binds the candidate bytes plus the source identity that produced them,
 * so re-running the same successful verification is idempotent (same
 * slot) while a re-verification under a changed tree preserves history
 * (new slot, old slot untouched).
 */
export function generationRunId(record) {
  const seed = [
    record?.sha256 ?? '', record?.source?.rev ?? '',
    record?.source?.dirtyIdentity ?? '', record?.gateContract ?? '',
  ].join('|');
  return createHash('sha256').update(seed).digest('hex').slice(0, 12);
}

/** File holding one immutable per-contract verification record. */
export function generationVersionedName(generation, gateContract, runId) {
  return `${generation}.c${gateContract}.${runId}.json`;
}

/** Legacy compatibility pointer: mirrors the newest verified record. */
export function generationLegacyName(generation) {
  return `${generation}.json`;
}

const isFullPass = (r) => r?.verdict === 'PASS' && r?.readiness === 'FULL_RELEASE_READY';

/**
 * Select the receipt applicable to this exact generation under the given
 * gate contract. Prefers the immutable per-contract record; falls back to
 * the legacy pointer only when it names the same contract. A legacy record
 * from another contract is served as-is so the decision below refuses it
 * with a stale-contract reason instead of a misleading "missing" one.
 *
 * @returns {{ receipt: object|null, path: string|null, contractServed: string|null }}
 */
/** All versioned record files for one generation+contract (plus the first-gen single-contract name). */
export function listVersionedReceipts(reportsDir, storeId, generation, gateContract) {
  const dir = `${reportsDir}/${storeId}`;
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const prefix = `${generation}.c${gateContract}.`;
  const legacySingle = `${generation}.c${gateContract}.json`;
  const out = [];
  for (const name of names) {
    if (name !== legacySingle && !name.startsWith(prefix)) continue;
    if (!name.endsWith('.json')) continue;
    try {
      const receipt = JSON.parse(readFileSync(`${dir}/${name}`, 'utf8'));
      if (receipt && typeof receipt === 'object' && receipt.generation === generation) {
        out.push({ receipt, path: `${storeId}/${name}` });
      }
    } catch { /* unreadable slot: not evidence */ }
  }
  return out;
}

/**
 * Select the receipt applicable to this exact generation under the given
 * gate contract. Among versioned records, a passing record for the
 * requested bytes wins (a failed re-verification never hides a
 * successful historical proof); otherwise the newest record explains why.
 * Falls back to the legacy pointer only when it names the same contract.
 * A legacy record from another contract is served as-is so the decision
 * below refuses it with a stale-contract reason instead of "missing".
 */
export function readApplicableReceipt(reportsDir, storeId, generation, gateContract, { sha256 = null } = {}) {
  const keyed = sha256
    ? listVersionedReceipts(reportsDir, storeId, generation, gateContract).filter((c) => c.receipt.sha256 === sha256)
    : [];
  const pool = keyed.length ? keyed : listVersionedReceipts(reportsDir, storeId, generation, gateContract);
  if (pool.length) {
    const byTime = [...pool].sort((a, b) => String(b.receipt.createdAt ?? '') < String(a.receipt.createdAt ?? '') ? -1 : 1);
    const pass = byTime.find((c) => isFullPass(c.receipt));
    const chosen = pass ?? byTime[0];
    return { receipt: chosen.receipt, path: chosen.path, contractServed: chosen.receipt?.gateContract ?? null };
  }
  const legacy = `${storeId}/${generationLegacyName(generation)}`;
  try {
    if (!existsSync(`${reportsDir}/${legacy}`)) return { receipt: null, path: null, contractServed: null };
    const receipt = JSON.parse(readFileSync(`${reportsDir}/${legacy}`, 'utf8'));
    if (!receipt || typeof receipt !== 'object') return { receipt: null, path: null, contractServed: null };
    return { receipt, path: legacy, contractServed: receipt?.gateContract ?? null };
  } catch {
    return { receipt: null, path: null, contractServed: null };
  }
}


const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Refuse a weak source identity. Returns null when the receipt carries a
 * coherent source binding: a valid clean HEAD, or a valid HEAD plus a
 * deterministic dirty-manifest identity. Limited/unknown/missing provenance
 * is never exact-provenance FULL evidence.
 */
export function refuseSourceIdentity(source) {
  if (!source || typeof source !== 'object') return 'receipt lacks source identity: refusing exact-provenance FULL';
  if (!HEX40.test(String(source.rev ?? ''))) {
    return `receipt source revision ${String(source.rev ?? 'missing').slice(0, 24)} is not a valid HEAD identity: candidate-only export`;
  }
  if (source.provenance === 'head') {
    if (source.dirty) return 'receipt claims clean HEAD provenance for a dirty tree: candidate-only export';
    return null;
  }
  if (source.provenance === 'head+dirty-manifest') {
    if (!source.dirty) return 'receipt claims dirty-manifest provenance for a clean tree: candidate-only export';
    if (!HEX64.test(String(source.dirtyIdentity ?? ''))) {
      return 'receipt names a dirty tree with no reliable identity: candidate-only export';
    }
    return null;
  }
  return `receipt source provenance is ${source.provenance ?? 'missing'} (limited or unknown): candidate-only export`;
}

function isCount(n) {
  // Strict nonnegative safe-integer domain: fractions, negatives, NaN,
  // Infinity, numeric strings, and missing values are all UNKNOWN — never
  // zero, never silently valid.
  return Number.isSafeInteger(n) && n >= 0;
}

/**
 * Strict accounting over one engine-suite aggregate stored in a receipt.
 * Every field must be present and numeric (missing is UNKNOWN, never zero),
 * totals must be positive and internally consistent, and no unknown skip,
 * failure, or cancellation may hide inside.
 */
export function refuseEngineAccounting(t, label) {
  if (!t || typeof t !== 'object') return `receipt lacks ${label} accounting: candidate-only export`;
  for (const k of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    if (!isCount(t[k])) return `receipt ${label} accounting is missing ${k} (UNKNOWN, not zero): candidate-only export`;
  }
  if (!isCount(t.unknownSkips)) {
    return `receipt ${label} accounting is missing unknownSkips (UNKNOWN, not zero): candidate-only export`;
  }
  if (t.tests === 0) return `receipt records zero ${label} tests: nothing verified: candidate-only export`;
  if (t.pass + t.fail + t.cancelled + t.skipped + t.todo !== t.tests) {
    return `receipt ${label} totals are contradictory (pass/fail/cancelled/skipped/todo do not sum to tests): candidate-only export`;
  }
  if (t.fail > 0 || t.cancelled > 0) return `receipt records ${label} failures/cancellations: candidate-only export`;
  if (t.unknownSkips > 0) return `receipt records ${label} unknown skips: candidate-only export`;
  return null;
}

/** Strict accounting over the browser aggregate stored in a receipt. */
export function refuseBrowserAccounting(t) {
  if (!t || typeof t !== 'object') return 'receipt lacks browser accounting: candidate-only export';
  for (const k of ['tests', 'passed', 'failed', 'skipped', 'flaky']) {
    if (!isCount(t[k])) return `receipt browser accounting is missing ${k} (UNKNOWN, not zero): candidate-only export`;
  }
  if (!isCount(t.unknownSkips)) {
    return 'receipt browser accounting is missing unknownSkips (UNKNOWN, not zero): candidate-only export';
  }
  if (!isCount(t.missingSuites)) {
    return 'receipt browser accounting is missing missingSuites (UNKNOWN, not zero): candidate-only export';
  }
  if (t.tests === 0) return 'receipt records zero browser tests: nothing verified: candidate-only export';
  if (t.passed + t.failed + t.skipped + t.flaky !== t.tests) {
    return 'receipt browser totals are contradictory (passed/failed/skipped/flaky do not sum to tests): candidate-only export';
  }
  if (t.failed > 0) return 'receipt records browser failures: candidate-only export';
  if (t.flaky > 0) return 'receipt records flaky browser tests: candidate-only export';
  if (t.unknownSkips > 0) return 'receipt records browser unknown skips: candidate-only export';
  if (t.missingSuites > 0) return 'receipt records missing browser suites: candidate-only export';
  return null;
}

/**
 * The single strict generation-readiness decision. FULL is granted only by
 * a valid generation-specific FULL receipt naming this exact origin,
 * generation, bytes, source binding, profile, and gate contract, with
 * complete gates, positive internally-consistent test totals, zero unknown
 * skips, and strong source provenance. Anything else is CANDIDATE_ONLY --
 * explicitly labelled, never silent.
 *
 * @returns {{ status: 'FULL'|'CANDIDATE_ONLY', reason: string|null, receipt: object|null }}
 */
export function decideGenerationReadiness(receipt, { origin, generation, sha256, gateContract, requiredGates, protocolCommit = null, packageVersion = null } = {}) {
  const no = (reason) => ({ status: 'CANDIDATE_ONLY', reason, receipt: receipt ?? null });
  if (!receipt || typeof receipt !== 'object') {
    return { status: 'CANDIDATE_ONLY', reason: 'no generation receipt: candidate-only export', receipt: null };
  }
  if (!Array.isArray(requiredGates) || requiredGates.length === 0) {
    return no('mandatory gate registry absent or empty: no FULL claim possible without a registry: candidate-only export');
  }
  if (receipt.origin !== origin) return no(`receipt origin ${receipt.origin ?? 'missing'} != ${origin}: refusing foreign attestation`);
  if (receipt.generation !== generation) return no('receipt names another generation: refusing mismatched attestation');
  if (!HEX64.test(String(receipt.sha256 ?? ''))) return no('receipt candidate digest is not a valid SHA-256 identity: candidate-only export');
  if (receipt.sha256 !== sha256) return no('receipt digest does not match the committed bytes: stale receipt, refusing');
  if (receipt.verdict !== 'PASS') return no(`generation never passed (receipt verdict ${receipt.verdict ?? 'missing'}): candidate-only export`);
  if (receipt.commitState !== 'COMMITTED') {
    return no(`receipt commit state is ${receipt.commitState ?? 'missing'} (not a committed generation): candidate-only export`);
  }
  if (!HEX64.test(String(receipt.stagedDigest ?? ''))) {
    return no('receipt staged digest is missing or not a valid SHA-256 identity: candidate-only export');
  }
  if (receipt.stagedDigest !== receipt.sha256) {
    return no('receipt staged digest differs from the committed candidate digest: candidate-only export');
  }
  if (receipt.profile !== 'full' || receipt.readiness !== 'FULL_RELEASE_READY') {
    return no(`receipt readiness is ${receipt.readiness ?? 'missing'} under profile ${receipt.profile ?? 'missing'}: candidate-only export`);
  }
  if (receipt.gateContract !== gateContract) {
    return no(`receipt gate contract ${receipt.gateContract ?? 'missing'} != current ${gateContract}: re-verify under the current contract`);
  }
  const badGates = requiredGates.filter((id) => receipt?.gates?.[id] !== true);
  if (badGates.length) return no(`receipt lacks passing mandatory gates (${badGates.join(', ')}): candidate-only export`);
  if (receipt.releaseVerify !== 'PASS' || receipt.candidateVerify !== 'PASS') {
    return no('receipt lacks public verification PASS: candidate-only export');
  }
  if (receipt.smoke !== 'LOCAL_STATIC_HOST_PASS') return no('receipt lacks static-host smoke PASS: candidate-only export');
  const engineRefusal = refuseEngineAccounting(receipt.engine, 'engine');
  if (engineRefusal) return no(engineRefusal);
  const buildRefusal = refuseEngineAccounting(receipt.engineBuild, 'build-dependent engine');
  if (buildRefusal) return no(buildRefusal);
  const browserRefusal = refuseBrowserAccounting(receipt.browser);
  if (browserRefusal) return no(browserRefusal);
  const sourceRefusal = refuseSourceIdentity(receipt.source);
  if (sourceRefusal) return no(sourceRefusal);
  const receiptPackageVersion =
    typeof receipt.package === 'string' ? receipt.package
    : (receipt.package?.version ?? null);
  if (!receiptPackageVersion || !receipt.protocol?.version) {
    return no('receipt lacks source/package/protocol binding: candidate-only export');
  }
  if (packageVersion !== null && receiptPackageVersion !== packageVersion) {
    return no(`receipt package version ${receiptPackageVersion} != current ${packageVersion}: stale package cannot inherit new FULL readiness`);
  }
  if (!HEX40.test(String(receipt.protocol.commit ?? ''))) {
    return no('receipt protocol commit identity is missing or malformed: candidate-only export');
  }
  if (protocolCommit !== null && protocolCommit !== undefined && receipt.protocol.commit !== protocolCommit) {
    return no(`receipt protocol commit ${String(receipt.protocol.commit).slice(0, 12)}… != canonical ${String(protocolCommit).slice(0, 12)}…: upstream snapshot changed without acknowledgement: candidate-only export`);
  }
  return { status: 'FULL', reason: null, receipt };
}

export { isFullPass };
