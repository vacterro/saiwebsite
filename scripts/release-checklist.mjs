#!/usr/bin/env node
/**
 * Origin-specific operator go-live checklist (Stage D).
 *
 * Formatting and handoff admission are SEPARATE. A package receipt that
 * merely declares readiness proves nothing: verifyPackageHandoff()
 * re-establishes every handoff invariant against the live filesystem
 * (package bytes, generation bytes, applicable generation receipt under
 * the current contract, protocol identity) before any checklist may
 * carry checked LOCAL READY claims.
 *
 * Handoff states:
 *   FULL_READY_FOR_OPERATOR_HANDOFF — every invariant holds; only this
 *     state produces checked readiness claims.
 *   CANDIDATE_ONLY — verified only as a candidate, never publication-ready.
 *   STALE_OR_MISMATCHED — bytes, generation, contract, or origin disagree.
 *   FAILED — verification failed somewhere in the chain.
 *   BLOCKED — evidence missing or unreadable; nothing can be decided.
 *
 * Origin grammar is the central validator (src/lib/deployment.mjs), never
 * a local regex: credentials, query strings, fragments, paths, and
 * non-loopback ports are all refused there.
 *
 * Generated instructions live outside the public ZIP.
 *
 * Usage:
 *   node scripts/release-checklist.mjs --receipt reports/release/packages/<slug>.json --origin https://host.example [--out reports/release/GO-LIVE-CHECKLIST.md]
 * Exit status: 0 handoff verified + written, 1 not handoff-ready (state + reasons printed), 2 unusable invocation.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeOrigin } from '../src/lib/deployment.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HEX64 = /^[0-9a-f]{64}$/;
const GEN_RE = /^g-[0-9a-f]{16}$/;

/**
 * Normalize a checklist target through the central origin validator.
 * @throws when the target is not a release-compatible public origin.
 */
export function normalizeTarget(origin) {
  const { origin: normalized, problems } = normalizeOrigin(origin);
  if (!normalized) {
    throw new Error(`checklist target refused: ${(problems ?? ['invalid origin']).join('; ')}`);
  }
  return normalized;
}

/**
 * Verify one package receipt as an operator-handoff candidate.
 *
 * Reuses existing release infrastructure (shared readiness decision,
 * digest verification) instead of duplicating it. Reads files but never
 * writes outside its return value.
 *
 * @returns {{ state: string, reasons: string[], detail: object }}
 */
export function verifyPackageHandoff({ root = ROOT, receiptPath, targetOrigin }) {
  const fail = (state, reasons, detail = {}) => ({ state, reasons: [].concat(reasons), detail });
  let receipt = null;
  try {
    receipt = JSON.parse(readFileSync(resolve(root, receiptPath), 'utf8'));
  } catch (error) {
    return fail('BLOCKED', [`package receipt unreadable: ${String(error?.message ?? error).slice(0, 160)}`], { receiptPath });
  }
  if (!receipt || typeof receipt !== 'object') return fail('BLOCKED', ['package receipt is not an object'], { receiptPath });
  let target = null;
  try {
    target = normalizeTarget(targetOrigin);
  } catch (error) {
    return fail('BLOCKED', [String(error.message).slice(0, 200)], { receiptPath });
  }
  const packaged = typeof receipt.origin === 'string' ? receipt.origin.trim().replace(/\/$/, '') : '';
  if (packaged !== target) {
    return fail('STALE_OR_MISMATCHED', [`checklist target ${target} != packaged candidate origin ${packaged || 'missing'}: rebuild for the target hostname first`], { target, packaged });
  }
  if (receipt.verdict === 'BLOCKED') return fail('BLOCKED', ['package run was BLOCKED: no packaging decision exists'], { target });
  if (receipt.verdict !== 'PASS') {
    return fail('FAILED', [`package verdict is ${receipt.verdict ?? 'missing'}: the chain failed, not a handoff candidate`], { target });
  }
  const cand = receipt.candidate ?? {};
  const pkg = receipt.package ?? {};
  if (!GEN_RE.test(String(cand.generation ?? ''))) {
    return fail('FAILED', ['package receipt names no valid candidate generation'], { target });
  }
  if (!HEX64.test(String(cand.sha256 ?? ''))) {
    return fail('FAILED', ['package receipt carries no valid candidate SHA-256'], { target, generation: cand.generation });
  }
  if (!HEX64.test(String(pkg.sha256 ?? '')) || !pkg.file || !Number.isSafeInteger(pkg.bytes) || pkg.bytes <= 0) {
    return fail('FAILED', ['package receipt carries no valid package file binding (sha256/file/bytes)'], { target, generation: cand.generation });
  }
  const pkgPath = join(root, pkg.file);
  let statOk = false;
  try {
    statOk = lstatSync(pkgPath).isFile();
  } catch { statOk = false; }
  if (!statOk) {
    return fail('BLOCKED', [`package file absent (${pkg.file}): missing verification, not silent acceptance`], { target, generation: cand.generation });
  }
  let actualPkgSha = null;
  try {
    actualPkgSha = createHash('sha256').update(readFileSync(pkgPath)).digest('hex');
  } catch (error) {
    return fail('BLOCKED', [`package file unreadable (${pkg.file}): ${String(error?.message ?? error).slice(0, 120)}`], { target, generation: cand.generation });
  }
  if (actualPkgSha !== pkg.sha256) {
    return fail('STALE_OR_MISMATCHED', [`package file corrupted or replaced (recorded ${String(pkg.sha256).slice(0, 12)}…, on disk ${actualPkgSha.slice(0, 12)}…): refusing handoff`], { target, generation: cand.generation });
  }
  if (receipt.extractionVerify?.verdict !== 'PASS') {
    return fail('FAILED', [`package extraction verification is ${receipt.extractionVerify?.verdict ?? 'missing'}: refusing handoff`], { target, generation: cand.generation });
  }
  if (receipt.extractionSmoke?.verdict !== 'LOCAL_STATIC_HOST_PASS') {
    return fail('FAILED', [`package static-host smoke is ${receipt.extractionSmoke?.verdict ?? 'missing'}: refusing handoff`], { target, generation: cand.generation });
  }
  // Generation-byte binding: the committed bytes must still verify.
  const storeRel = typeof cand.store === 'string' ? cand.store : null;
  if (!storeRel) {
    return fail('BLOCKED', ['package receipt names no candidate store: generation bytes unavailable'], { target, generation: cand.generation });
  }
  if (!handoffLoadersInstalled()) {
    return fail('BLOCKED', ['handoff verification infrastructure not installed: refusing to decide'], { target, generation: cand.generation });
  }
  const genDir = join(root, storeRel, 'generations', cand.generation);
  let genOk = false;
  try {
    genOk = verifyDigestLoader().verifyDigest(genDir, cand.sha256);
  } catch { genOk = false; }
  if (!genOk) {
    return fail('STALE_OR_MISMATCHED', [`generation ${cand.generation} bytes do not verify against ${String(cand.sha256).slice(0, 12)}…: stale or replaced generation`], { target, generation: cand.generation });
  }
  // Applicable FULL receipt under the CURRENT contract via the shared decision.
  let decision = null;
  try {
    const readiness = readinessLoader();
    const storeId = basename(storeRel);
    const reportsDir = join(root, 'reports', 'release', 'candidates');
    const selected = readiness.readApplicableReceipt(reportsDir, storeId, cand.generation, readiness.currentContract().gateContract, { sha256: cand.sha256 });
    if (!selected.receipt) {
      return fail('CANDIDATE_ONLY', [`no generation receipt for ${cand.generation} under the current contract: candidate bytes verify but FULL is unproven`], { target, generation: cand.generation });
    }
    decision = readiness.decideHandoff(selected.receipt, {
      origin: target, generation: cand.generation, sha256: cand.sha256,
      protocolCommit: canonicalCommit(root),
    });
  } catch (error) {
    return fail('BLOCKED', [`readiness infrastructure unavailable: ${String(error?.message ?? error).slice(0, 140)}`], { target, generation: cand.generation });
  }
  if (decision.status !== 'FULL') {
    const reason = decision.reason ?? 'unproven';
    if (/stale|mismatch|does not match|another generation|other contract|re-verify/i.test(reason)) {
      return fail('STALE_OR_MISMATCHED', [`generation receipt does not attest this handoff: ${reason.slice(0, 200)}`], { target, generation: cand.generation });
    }
    if (/never passed|FAIL/i.test(reason)) {
      return fail('FAILED', [`generation receipt records failure: ${reason.slice(0, 200)}`], { target, generation: cand.generation });
    }
    return fail('CANDIDATE_ONLY', [`generation receipt withholds FULL: ${reason.slice(0, 200)}`], { target, generation: cand.generation });
  }
  if (receipt.profile !== undefined && receipt.profile !== null && receipt.profile !== 'full' && decision.receipt?.profile !== 'full') {
    return fail('CANDIDATE_ONLY', ['verification profile is not full-readiness: candidate only'], { target, generation: cand.generation });
  }
  return {
    state: 'FULL_READY_FOR_OPERATOR_HANDOFF',
    reasons: [],
    detail: {
      target, generation: cand.generation, files: cand.files ?? null,
      candidateSha256: cand.sha256, packageFile: pkg.file,
      packageSha256: pkg.sha256, packageBytes: pkg.bytes,
      gateContract: decision.receipt?.gateContract ?? null,
      receiptPath,
    },
  };
}

// Installable loaders keep this module importable without pulling the
// whole factory graph in unit tests. verifyPackageHandoff() refuses to
// decide when they are absent (BLOCKED), never throws past its boundary.
let cachedVerify = null;
function verifyDigestLoader() {
  if (!cachedVerify?.verifyDigest) throw new Error('digest verifier not installed');
  return cachedVerify;
}

let cachedReadiness = null;
function readinessLoader() {
  if (!cachedReadiness) throw new Error('readiness module not installed');
  return cachedReadiness;
}

/** True when the real release infrastructure is installed (CLI path). */
export function handoffLoadersInstalled() {
  return Boolean(cachedVerify?.verifyDigest && cachedReadiness?.readPointer);
}

/** Install the real loaders (called by the CLI entrypoint and tests). */
export function installHandoffLoaders({ verifyDigest, readApplicableReceipt, decideGenerationReadiness, gateContract, requiredGates, readPointer }) {
  cachedVerify = { verifyDigest };
  cachedReadiness = {
    currentContract: () => ({ gateContract, requiredGates }),
    readApplicableReceipt,
    readPointer,
    decideHandoff: (receipt, { origin, generation, sha256, protocolCommit }) =>
      decideGenerationReadiness(receipt, { origin, generation, sha256, gateContract, requiredGates, protocolCommit }),
  };
}

function canonicalCommit(root) {
  try {
    return JSON.parse(readFileSync(join(root, 'src', 'data', 'canonical', 'meta.json'), 'utf8'))?.commit ?? null;
  } catch { return null; }
}

/**
 * Render the operator checklist. Only a FULL_READY_FOR_OPERATOR_HANDOFF
 * verification produces checked LOCAL READY claims; every other state
 * renders a diagnostic sheet with unchecked boxes and the blocking
 * reasons up front. A target/origin mismatch always throws (gate).
 */
export function buildChecklist(receipt, targetOrigin, verification = null) {
  if (!receipt || typeof receipt !== 'object') throw new Error('checklist needs a readable package receipt object');
  const target = normalizeTarget(targetOrigin);
  const packaged = String(receipt.origin ?? '').trim().replace(/\/$/, '');
  if (packaged !== target) {
    throw new Error(`checklist target ${target} != packaged candidate origin ${packaged || 'missing'}: refusing cross-origin handoff; rebuild for the target hostname first`);
  }
  // PACKAGE_INTEGRITY_VERIFIED and HISTORICAL_ROLLBACK are honest weaker
  // proofs: package bytes genuinely verified, but NOT a current-release
  // approval. Only CURRENT_RELEASE_HANDOFF_VERIFIED renders checked
  // current-release LOCAL READY claims.
  const rollback = verification?.rollback === true;
  const ready = verification?.state === 'FULL_READY_FOR_OPERATOR_HANDOFF' && !rollback;
  const box = ready ? '[x]' : '[ ]';
  const header = rollback
    ? ['# Go-live checklist (HISTORICAL ROLLBACK — NOT the current release)', '', `Handoff state: ${verification?.state ?? 'HISTORICAL_ROLLBACK'} — rollback target verified below; do NOT mistake this generation for the authoritative current release.`]
    : ready
      ? ['# Go-live checklist (generated, origin-specific)', '', 'Handoff state: FULL_READY_FOR_OPERATOR_HANDOFF — every invariant below was re-verified against live bytes and receipts.']
      : ['# Go-live checklist (DIAGNOSTIC — not handoff-ready)', '', `Handoff state: ${verification?.state ?? 'UNVERIFIED'} — do NOT deploy from this sheet.`];
  const reasons = ready
    ? []
    : ['', 'Blocking reasons:', ...(verification?.reasons ?? ['package handoff was not verified against live bytes and receipts']).map((r) => `- ${r}`)];
  const readinessLine = ready
    ? 'FULL_READY_FOR_OPERATOR_HANDOFF (bound generation receipt, package bytes re-verified)'
    : `${receipt.readiness ?? 'UNKNOWN'} (NOT a handoff approval)`;
  return [
    ...header,
    ...reasons,
    '',
    'Derived from the verified package receipt below. Do not hand-edit the',
    'metadata lines; regenerate with `node scripts/release-checklist.mjs`.',
    'No hosting account action has been taken. Nothing here deploys anything.',
    '',
    `- Origin (exact): ${packaged}`,
    `- Generation: ${receipt.candidate?.generation ?? 'unknown'}`,
    `- Candidate files: ${receipt.candidate?.files ?? 'unknown'}`,
    `- Candidate SHA-256: ${receipt.candidate?.sha256 ?? 'unknown'}`,
    `- Package file: ${receipt.package?.file ?? 'unknown'}`,
    `- Package SHA-256: ${receipt.package?.sha256 ?? 'unknown'}`,
    `- Package bytes: ${receipt.package?.bytes ?? 'unknown'}`,
    `- Readiness: ${readinessLine}`,
    `- Extraction: ${receipt.extractionVerify?.verdict ?? 'unknown'} + ${receipt.extractionSmoke?.verdict ?? 'unknown'}`,
    `- Publication authorized: ${receipt.publicationAuthorized === true ? 'true' : 'false (operator decision; no remote action performed)'}`,
    '',
    `## LOCAL READY ${ready ? '' : '(UNPROVEN — boxes unchecked)'}`,
    '',
    `${box} Package holds the verified public tree for THIS origin only.`,
    `${box} Homepage, docs, spec, sitemap, robots, llms.txt, 404 verified for THIS origin.`,
    `${box} No backend required; no credentials, reports, or project state in the ZIP.`,
    `${box} Rollback: previous verified generation or shelf ZIP (see \`npm run release:doctor\`).`,
    '',
    '## EXTERNAL BLOCKED (never claimed offline)',
    '',
    '- [ ] DNS for the hostname above.',
    '- [ ] HTTPS/TLS on the host.',
    '- [ ] Host static behavior: clean directory URLs, content types, 404 handling.',
    '- [ ] Live redirects and permanent-domain migration policy.',
    '- [ ] Live search-indexing behavior.',
    '- [ ] Publication authorization by the operator.',
    '',
    '## OPERATOR ACTION REQUIRED',
    '',
    '1. Upload ONLY the package file above (never the repo root, never raw `dist/`).',
    '2. Serve it and check canonical/sitemap/robots/content-types ON THE REAL ORIGIN.',
    '3. Keep the previous verified generation/ZIP as the rollback artifact.',
    '4. ET/RU publication stays disabled pending independent review.',
    '',
  ].join('\n');
}

export function buildChecklistFromFile(receiptPath, targetOrigin, verification = null) {
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  return buildChecklist(receipt, targetOrigin, verification);
}

/**
 * Exact cross-artifact release-handoff identity (Stage D).
 *
 * The factory report and the package receipt must describe the SAME
 * artifact: origin, generation, candidate bytes, gate contract, and
 * protocol identity must agree, and the package must independently
 * verify via verifyPackageHandoff(). A new factory run never silently
 * invalidates an old package — but the default handoff selects the
 * CURRENT factory generation; a historical rollback needs an explicit
 * operator selection ({ generation, sha256 }), and is then reported
 * honestly as a rollback, never as the current release.
 *
 * @returns {{ ok: boolean, rollback: boolean, state: string, reasons: string[], identity: object }}
 */
export function verifyReleaseHandoff({ root = ROOT, factoryReceiptPath, packageReceiptPath, targetOrigin, allowHistorical = null }) {
  const nope = (state, reasons, identity = {}) => ({ ok: false, rollback: false, state, reasons: [].concat(reasons), identity });
  let factory = null;
  let pkg = null;
  try {
    factory = JSON.parse(readFileSync(resolve(root, factoryReceiptPath), 'utf8'));
    pkg = JSON.parse(readFileSync(resolve(root, packageReceiptPath), 'utf8'));
  } catch (error) {
    return nope('BLOCKED', [`handoff evidence unreadable: ${String(error?.message ?? error).slice(0, 160)}`]);
  }
  let target = null;
  try {
    target = normalizeTarget(targetOrigin);
  } catch (error) {
    return nope('BLOCKED', [String(error.message).slice(0, 200)]);
  }
  const identity = {
    target,
    factoryGeneration: factory?.candidate?.generation ?? null,
    packageGeneration: pkg?.candidate?.generation ?? null,
    factorySha256: factory?.candidate?.sha256 ?? null,
    packageSha256: pkg?.candidate?.sha256 ?? null,
    factoryContract: factory?.gateContract ?? null,
    packageContract: pkg?.fullReceipt?.gateContract ?? null,
    factoryOrigin: factory?.origin ?? null,
    packageOrigin: pkg?.origin ?? null,
  };
  // Explicit historical rollback first: an operator-selected generation is
  // judged on its own package evidence, not on the latest factory run
  // (a FAIL factory is precisely when rollback is the honest move).
  if (allowHistorical?.generation && allowHistorical?.sha256) {
    if (identity.packageGeneration === allowHistorical.generation
      && identity.packageSha256 === allowHistorical.sha256) {
      const v = verifyPackageHandoff({ root, receiptPath: packageReceiptPath, targetOrigin: target });
      if (v.state !== 'FULL_READY_FOR_OPERATOR_HANDOFF') {
        return nope(v.state, [`explicit rollback target fails handoff verification: ${v.reasons.join('; ').slice(0, 240)}`], identity);
      }
      return {
        ok: true, rollback: true, state: 'HISTORICAL_ROLLBACK',
        reasons: [`operator-selected rollback to ${allowHistorical.generation} (package attestation contract ${identity.packageContract ?? 'missing'}; NOT the current release); historical bytes and receipt verified`],
        identity,
      };
    }
    return nope('STALE_OR_MISMATCHED', [`explicit rollback selection ${allowHistorical.generation} != packaged ${identity.packageGeneration ?? 'missing'}: refusing`], identity);
  }
  // Stage A — factory admission: the factory report must itself describe
  // a successful committed full execution. Identity agreement below is
  // not enough — a FAIL/NOT_READY/NOT_COMMITTED factory with matching
  // strings is a contradicted claim, never a handoff.
  const admission = admitFactoryReport(factory, target);
  if (admission) return nope('FAILED', admission, identity);
  const canonCommit = canonicalCommit(root);
  if (canonCommit && factory?.protocol?.commit && factory.protocol.commit !== canonCommit) {
    return nope('STALE_OR_MISMATCHED', [`factory protocol snapshot ${String(factory.protocol.commit).slice(0, 12)}… != canonical ${canonCommit.slice(0, 12)}…: unacknowledged upstream change`], identity);
  }
  const mismatch = [];
  if (identity.factoryOrigin !== target || identity.packageOrigin !== target) {
    mismatch.push(`origin disagreement (factory ${identity.factoryOrigin ?? 'missing'} / package ${identity.packageOrigin ?? 'missing'} / target ${target})`);
  }
  if (identity.factoryGeneration !== identity.packageGeneration) {
    mismatch.push(`generation disagreement (factory ${identity.factoryGeneration ?? 'missing'} / package ${identity.packageGeneration ?? 'missing'})`);
  }
  if (identity.factorySha256 !== identity.packageSha256) {
    mismatch.push('candidate digest disagreement between factory and package');
  }
  if (identity.factoryContract !== identity.packageContract) {
    mismatch.push(`gate-contract disagreement (factory ${identity.factoryContract ?? 'missing'} / package receipt ${identity.packageContract ?? 'missing'}): re-package the current generation`);
  }
  if (mismatch.length) {
    return nope('STALE_OR_MISMATCHED', mismatch, identity);
  }
  // Stage B — authoritative pointer binding: current.json selects the
  // release. Report filenames are never the authority. Read-only: the
  // pointer is never created, repaired, or moved here.
  if (!handoffLoadersInstalled()) {
    return nope('BLOCKED', ['handoff verification infrastructure not installed: refusing to decide'], identity);
  }
  const storeRel = typeof pkg?.candidate?.store === 'string' ? pkg.candidate.store : null;
  if (!storeRel) {
    return nope('BLOCKED', ['package receipt names no candidate store: authoritative selection unavailable'], identity);
  }
  let pointer = null;
  try {
    pointer = cachedReadiness.readPointer(join(root, storeRel), 'current');
  } catch {
    pointer = null;
  }
  if (!pointer || typeof pointer !== 'object') {
    return nope('BLOCKED', [`no authoritative current pointer (${storeRel}/current.json missing or unreadable): current handoff unauthorized`], identity);
  }
  const pointerProblems = [];
  if (pointer.generation !== identity.factoryGeneration) {
    pointerProblems.push(`authoritative pointer selects ${pointer.generation ?? 'missing'}, factory reports ${identity.factoryGeneration ?? 'missing'}: refusing`);
  }
  if (pointer.sha256 !== identity.packageSha256) {
    pointerProblems.push('authoritative pointer digest differs from the packaged candidate digest: refusing');
  }
  if (pointer.origin !== target) {
    pointerProblems.push(`authoritative pointer origin ${pointer.origin ?? 'missing'} != ${target}: refusing`);
  }
  if (pointerProblems.length) {
    return nope('STALE_OR_MISMATCHED', pointerProblems, { ...identity, pointerGeneration: pointer.generation ?? null });
  }
  let pointerBytesOk = false;
  try {
    pointerBytesOk = verifyDigestLoader().verifyDigest(join(root, storeRel, 'generations', pointer.generation), pointer.sha256);
  } catch { pointerBytesOk = false; }
  if (!pointerBytesOk) {
    return nope('STALE_OR_MISMATCHED', [`authoritative generation ${pointer.generation} bytes do not verify: corrupt or replaced generation`], { ...identity, pointerGeneration: pointer.generation });
  }
  const v = verifyPackageHandoff({ root, receiptPath: packageReceiptPath, targetOrigin: target });
  if (v.state !== 'FULL_READY_FOR_OPERATOR_HANDOFF') {
    return nope(v.state, v.reasons, identity);
  }
  // Stage C — contract currency for CURRENT handoff: the factory report,
  // the package attestation, AND the generation receipt must all attest
  // under the currently required gate contract. verifyPackageHandoff()
  // already binds the generation receipt to the current contract, but
  // without this check a current handoff would silently inherit those
  // stronger guarantees while resting on outdated factory/package
  // attestations. Historical generations use explicit rollback instead.
  const current = cachedReadiness.currentContract().gateContract;
  for (const [which, contract] of [
    ['factory report', identity.factoryContract],
    ['package attestation', identity.packageContract],
    ['generation receipt', v.detail?.gateContract ?? null],
  ]) {
    if (contract !== current) {
      return nope('STALE_OR_MISMATCHED', [`${which} gate contract ${contract ?? 'missing'} != current required gate contract ${current}: re-verify the current generation under contract ${current}; use explicit rollback for historical generations`], identity);
    }
  }
  return { ok: true, rollback: false, state: 'HANDOFF_VERIFIED', reasons: [], identity: { ...identity, pointerGeneration: pointer.generation, packageSha256: v.detail.packageSha256, packageFile: v.detail.packageFile } };
}

/**
 * Stage A factory admission. Returns null when the factory report
 * describes a successful committed full execution, otherwise the precise
 * rejection reasons (automation-suitable, no prose).
 */
function admitFactoryReport(factory, target) {
  const problems = [];
  if (!factory || typeof factory !== 'object') return ['factory report is not an object'];
  if (factory.tool !== 'release-candidate') problems.push(`factory tool identity is ${factory.tool ?? 'missing'} (expected release-candidate)`);
  if (factory.verdict !== 'PASS') problems.push(`factory verdict is ${factory.verdict ?? 'missing'}: execution did not succeed`);
  if (factory.profile !== 'full') problems.push(`factory profile is ${factory.profile ?? 'missing'}: not a full-readiness execution`);
  if (factory.readiness !== 'FULL_RELEASE_READY') problems.push(`factory readiness is ${factory.readiness ?? 'missing'}: not a full-readiness claim`);
  if (factory.commitState !== 'COMMITTED') problems.push(`factory commit state is ${factory.commitState ?? 'missing'}: no committed generation`);
  if (!GEN_RE.test(String(factory.candidate?.generation ?? ''))) problems.push('factory names no valid candidate generation');
  if (!HEX64.test(String(factory.candidate?.sha256 ?? ''))) problems.push('factory carries no valid candidate SHA-256');
  if (factory.origin !== target) problems.push(`factory origin ${factory.origin ?? 'missing'} != ${target}: foreign execution record`);
  if (!factory.package) problems.push('factory package identity is missing');
  if (!factory.protocol?.version) problems.push('factory protocol version is missing');
  if (!/^[0-9a-f]{40}$/.test(String(factory.protocol?.commit ?? ''))) problems.push('factory protocol commit identity is missing or malformed');
  return problems.length ? problems : null;
}

/**
 * Shared CLI refusal helper: no failed invocation may leave a
 * previously generated approval behind at the requested output path.
 *
 * Only a regular file that looks like a generated checklist (`# Go-live
 * checklist` marker) is ever replaced — unrelated user files, symlinks,
 * directories, and missing paths are left untouched, and nothing is
 * created for first-time invalid invocations. Replacement is atomic
 * (temp file + rename in the same directory). Input receipts, generation
 * bytes, and package ZIPs are never touched. Never throws.
 *
 * @returns a short description of the action taken (for stderr logging).
 */
export function neutralizeStaleApproval(outPath, reason) {
  if (!outPath) return 'no output path requested: nothing written';
  let full = null;
  try {
    full = resolve(outPath);
  } catch {
    return 'output path unresolvable: nothing written';
  }
  let st = null;
  try {
    st = lstatSync(full);
  } catch {
    return 'no pre-existing output: nothing created';
  }
  if (st.isSymbolicLink()) return 'output path is a symlink: refusing to follow, leaving untouched';
  if (!st.isFile()) return 'output path is not a regular file: leaving untouched';
  let text = '';
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    return 'existing output unreadable: leaving untouched';
  }
  if (!text.includes('# Go-live checklist')) return 'existing output is not a generated checklist: leaving untouched';
  const note = '# Go-live checklist (DIAGNOSTIC — not handoff-ready)\n\nHandoff state: FAILED — do NOT deploy from this sheet.\n\n'
    + `Refusal: ${String(reason ?? 'unsuccessful invocation').slice(0, 200)}\n`;
  const tmp = join(dirname(full), `.checklist-refusal-${process.pid}.tmp`);
  try {
    writeFileSync(tmp, note);
    renameSync(tmp, full);
    return 'stale generated checklist atomically replaced with diagnostic refusal';
  } catch {
    try { unlinkSync(tmp); } catch { /* best-effort temp cleanup */ }
    return 'replacement failed: stale file left untouched, nonzero exit is the gate';
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let receiptPath = null;
  let origin = null;
  let out = null;
  let factoryPath = null;
  let rollbackGen = null;
  let rollbackSha = null;
  let inspectPackage = false;
  // Unknown options are recorded but parsing continues so the requested
  // --out path is still known and its stale approval (if any) can be
  // neutralized before exiting 2.
  let badOption = null;
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--receipt') receiptPath = process.argv[++i];
    else if (a === '--origin') origin = process.argv[++i];
    else if (a === '--out') out = process.argv[++i];
    else if (a === '--factory') factoryPath = process.argv[++i];
    else if (a === '--rollback-generation') rollbackGen = process.argv[++i];
    else if (a === '--rollback-sha256') rollbackSha = process.argv[++i];
    else if (a === '--inspect-package') inspectPackage = true;
    else if (badOption === null) badOption = a;
  }
  // Every usage failure neutralizes a stale generated approval at --out
  // through the shared helper (unrelated files, symlinks, and missing
  // paths are left alone; nothing is created for first-time failures).
  const usageFail = (message) => {
    const action = neutralizeStaleApproval(out, message);
    process.stderr.write(`release:checklist BLOCKED: ${message} [output: ${action}]\n`);
    process.exit(2);
  };
  if (badOption !== null) usageFail(`unknown option ${badOption}`);
  if (!receiptPath || !origin) {
    usageFail('--receipt <package-receipt.json> and --origin <exact https origin> are required');
  }
  if ((rollbackGen && !rollbackSha) || (!rollbackGen && rollbackSha)) {
    usageFail('--rollback-generation and --rollback-sha256 are required together');
  }
  // Explicit verification modes. The ordinary current-release handoff
  // REQUIRES --factory; a package receipt alone never selects current.
  // --inspect-package is the only package-only path and never approves.
  if (inspectPackage && (factoryPath || rollbackGen || rollbackSha)) {
    usageFail('--inspect-package is package-only and cannot combine with --factory or rollback flags');
  }
  if ((rollbackGen || rollbackSha) && !factoryPath) {
    usageFail('rollback flags require --factory handoff context (rollback is judged against the factory/pointer identity, never against a bare package)');
  }
  if (!factoryPath && !inspectPackage) {
    usageFail('current-release handoff requires --factory <factory-report.json>; for package-only integrity inspection pass explicit --inspect-package (never a current-release approval)');
  }
  const writeText = (text) => {
    if (out) {
      const full = resolve(out);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, text);
    } else {
      process.stdout.write(text);
    }
  };
  try {
    const [candidate, readiness] = await Promise.all([
      import('./release-candidate.mjs'),
      import('./release-readiness.mjs'),
    ]);
    installHandoffLoaders({
      verifyDigest: candidate.verifyDigest,
      readApplicableReceipt: readiness.readApplicableReceipt,
      decideGenerationReadiness: readiness.decideGenerationReadiness,
      gateContract: candidate.GATE_CONTRACT_VERSION,
      requiredGates: candidate.REQUIRED_FULL_GATES,
      readPointer: candidate.readPointer,
    });
    const receipt = JSON.parse(readFileSync(resolve(receiptPath), 'utf8'));
    // PACKAGE_INSPECTION: proves package/generation integrity only. Never
    // a current-release approval — the sheet stays diagnostic (unchecked).
    if (inspectPackage) {
      const v = verifyPackageHandoff({ root: ROOT, receiptPath: resolve(receiptPath), targetOrigin: origin });
      const verification = v.state === 'FULL_READY_FOR_OPERATOR_HANDOFF'
        ? {
          state: 'PACKAGE_INTEGRITY_VERIFIED',
          reasons: ['package bytes and generation receipt verified; current-release approval NOT granted (no factory admission, no authoritative pointer check)'],
          detail: v.detail,
        }
        : v;
      writeText(buildChecklist(receipt, origin, verification));
      if (v.state !== 'FULL_READY_FOR_OPERATOR_HANDOFF') {
        process.stderr.write(`release:checklist inspection ${v.state}: ${v.reasons.join('; ').slice(0, 300)}\n`);
        process.exit(1);
      }
      process.stdout.write(`checklist: PACKAGE_INSPECTION for ${normalizeTarget(origin)} (NOT a current-release approval)\n`);
      process.exit(0);
    }
    // CURRENT_RELEASE_HANDOFF (+ explicit HISTORICAL_ROLLBACK selection).
    const handoff = verifyReleaseHandoff({
      root: ROOT, factoryReceiptPath: resolve(factoryPath),
      packageReceiptPath: resolve(receiptPath), targetOrigin: origin,
      allowHistorical: rollbackGen ? { generation: rollbackGen, sha256: rollbackSha } : null,
    });
    if (!handoff.ok) {
      // A failed attempt must never leave a stale approval behind: the
      // requested output path is overwritten with the diagnostic sheet
      // (input receipts are never touched).
      writeText(buildChecklist(receipt, origin, { state: handoff.state, reasons: handoff.reasons, detail: handoff.identity }));
      process.stderr.write(`release:checklist handoff ${handoff.state}: ${handoff.reasons.join('; ').slice(0, 400)}\n`);
      process.exit(1);
    }
    if (handoff.rollback) {
      process.stderr.write(`release:checklist HISTORICAL_ROLLBACK: ${handoff.reasons.join('; ').slice(0, 300)}\n`);
      writeText(buildChecklist(receipt, origin, { state: 'HISTORICAL_ROLLBACK', reasons: handoff.reasons, detail: handoff.identity, rollback: true }));
      process.exit(0);
    }
    writeText(buildChecklist(receipt, origin, { state: 'FULL_READY_FOR_OPERATOR_HANDOFF', reasons: [], detail: handoff.identity }));
    process.stdout.write(`checklist: FULL_READY_FOR_OPERATOR_HANDOFF for ${normalizeTarget(origin)}\n`);
  } catch (error) {
    // Never leave a stale approval behind: an unreadable receipt or
    // internal failure neutralizes the requested output through the same
    // shared helper (input receipts are never touched).
    const action = neutralizeStaleApproval(out, String(error?.message ?? error));
    process.stderr.write(`release:checklist FAIL: ${String(error?.message ?? error).slice(0, 300)} [output: ${action}]\n`);
    process.exit(1);
  }
}
