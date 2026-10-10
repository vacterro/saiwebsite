#!/usr/bin/env node
/**
 * Host-neutral offline publication package (npm run release:package).
 *
 * Exports the committed, digest-verified public candidate as a reproducible
 * deployment ZIP plus a separate machine-readable verification receipt:
 *
 *   1. Resolve the candidate store for the requested origin (store id or
 *      migrated legacy store) and require a committed current.json pointer.
 *   2. Re-verify the committed generation: digest recomputed over the exact
 *      generation bytes, and the public release verifier re-run against it
 *      (origin + public contract, release mode).
 *   3. Refuse a corrupted generation, a foreign origin identity, or any ZIP
 *      member that is unsafe (absolute path, parent traversal, backslash,
 *      trailing dot/space, symlink or junction escape, hidden segment).
 *   4. Build the ZIP deterministically: sorted entry order, STORED (no
 *      compression variance), fixed timestamps and modes. Repeated runs over
 *      unchanged inputs produce identical bytes.
 *   5. Extract the ZIP into a disposable directory with an independent
 *      reader, re-run public verification AND the loopback static-host
 *      smoke against the extracted content.
 *   6. Record the candidate digest and the package digest SEPARATELY in a
 *      receipt kept OUTSIDE the ZIP (reports/release/packages/).
 *
 * The ZIP contains exactly the verified public candidate tree — no source,
 * no reports, no credentials, no internal evidence. Packaging NEVER uploads
 * or deploys anything; there is deliberately no deploy step here.
 *
 * Usage:
 *   SAI_SITE_ORIGIN=https://host.example npm run release:package
 *   node scripts/release-package.mjs --origin https://host.example [--out <receipt.json>]
 *
 * Exit status: 0 packaged+verified, 1 failure, 3 blocked (no committed candidate).
 */
import { createHash } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync,
  readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, computeDigest, readPointer, resolveCandidateStore, verifyDigest,
} from './release-candidate.mjs';
import { verifyRelease } from './release-verify.mjs';
import { probeCandidate } from './release-smoke.mjs';
import { readApplicableReceipt, decideGenerationReadiness } from './release-readiness.mjs';

// Fixed ZIP timestamp (2020-01-01 00:00:00 UTC) for reproducible bytes.
const ZIP_DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;
const ZIP_DOS_TIME = 0;

function crc32Table() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC_TABLE = crc32Table();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Reject ZIP-unsafe member paths. Returns null when safe, else the reason.
 * Mirrors the verifier's publishable-output boundary in path form.
 */
export function unsafeMemberReason(rel) {
  if (!rel || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) return 'absolute path';
  if (rel.includes('\\')) return 'backslash separator';
  if (rel.split('/').some((seg) => seg === '..' || seg === '' )) return 'traversal or empty segment';
  const base = rel.split('/').pop();
  if (base.endsWith('.') || base.endsWith(' ')) return 'windows-stripped trailing name';
  if (rel.split('/').some((seg) => seg.startsWith('.') && seg !== '.well-known' && seg !== '.nojekyll')) {
    return 'hidden file or folder';
  }
  return null;
}

function listFilesRecursive(dir) {
  const out = [];
  (function walk(current) {
    for (const e of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(current, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  })(dir);
  return out.sort();
}

/**
 * Write a deterministic STORED-method ZIP. No compression (no variance),
 * sorted entries, fixed timestamps/modes, UTF-8 names.
 * @returns {{ bytes: Buffer, sha256: string, entries: number }}
 */
export function writeDeterministicZip(files) {
  const names = [...files.keys()].sort();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const data = files.get(name);
    const nameBytes = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(ZIP_DOS_TIME, 10);
    local.writeUInt16LE(ZIP_DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  }
  const centralStart = offset;
  let centralSize = 0;
  for (const e of central) {
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(0x0800, 8);
    head.writeUInt16LE(0, 10);
    head.writeUInt16LE(ZIP_DOS_TIME, 12);
    head.writeUInt16LE(ZIP_DOS_DATE, 14);
    head.writeUInt32LE(e.crc, 16);
    head.writeUInt32LE(e.size, 20);
    head.writeUInt32LE(e.size, 24);
    head.writeUInt16LE(e.nameBytes.length, 28);
    head.writeUInt16LE(0, 30);
    head.writeUInt16LE(0, 32);
    head.writeUInt16LE(0, 34);
    head.writeUInt16LE(0, 36);
    head.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    head.writeUInt32LE(e.offset, 42);
    chunks.push(head, e.nameBytes);
    centralSize += head.length + e.nameBytes.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 8);
  end.writeUInt16LE(0, 10);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  chunks.push(end);
  const bytes = Buffer.concat(chunks);
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex'), entries: names.length };
}

/**
 * Read back a STORED-method ZIP into a Map (independent extraction path).
 * Validates signatures, lengths and CRCs; rejects anything unexpected.
 */
export function readStoredZip(bytes) {
  const files = new Map();
  let pos = 0;
  let localCount = 0;
  while (pos < bytes.length) {
    const sig = bytes.readUInt32LE(pos);
    if (sig === 0x06054b50 || sig === 0x02014b50) break; // central directory or end record
    if (sig !== 0x04034b50) throw new Error(`package unreadable: bad local header at offset ${pos}`);
    const method = bytes.readUInt16LE(pos + 8);
    const crc = bytes.readUInt32LE(pos + 14);
    const size = bytes.readUInt32LE(pos + 18);
    const nameLen = bytes.readUInt16LE(pos + 26);
    const extraLen = bytes.readUInt16LE(pos + 28);
    if (method !== 0) throw new Error('package unreadable: unsupported compression method (expected stored)');
    const name = bytes.slice(pos + 30, pos + 30 + nameLen).toString('utf8');
    const data = bytes.slice(pos + 30 + nameLen + extraLen, pos + 30 + nameLen + extraLen + size);
    if (data.length !== size) throw new Error(`package unreadable: truncated entry ${name}`);
    if (crc32(data) !== crc) throw new Error(`package unreadable: CRC mismatch in ${name}`);
    const reason = unsafeMemberReason(name);
    if (reason) throw new Error(`package unsafe: member ${name} (${reason})`);
    files.set(name, Buffer.from(data));
    localCount++;
    pos += 30 + nameLen + extraLen + size;
  }
  // Validate the end record: entry counts must match the local headers read.
  const endPos = bytes.length - 22;
  if (endPos < 0 || bytes.readUInt32LE(endPos) !== 0x06054b50) {
    throw new Error('package unreadable: missing end-of-central-directory record');
  }
  const totalEntries = bytes.readUInt16LE(endPos + 10);
  if (totalEntries !== localCount || totalEntries !== files.size) {
    throw new Error('package unreadable: central directory entry count mismatch');
  }
  return files;
}

/**
 * FULL-readiness attestation for packaging (Stage G).
 *
 * A package integrity PASS proves bytes were packaged and locally
 * verified. It must never upgrade engineering readiness: FULL is granted
 * only by a valid generation-specific FULL receipt naming this exact
 * origin, generation, bytes, source binding, profile, and gate contract,
 * with complete gates and zero unknown skips. Anything else packages as
 * CANDIDATE_ONLY -- explicitly labelled, never silent.
 *
 * @returns {{ status: 'FULL'|'CANDIDATE_ONLY', reason: string|null, receipt: object|null }}
 */
export function findFullReceipt({ reportsDir, storeId, origin, generation, sha256, gateContract, requiredGates, protocolCommit = null }) {
  // Single authoritative decision (Stage C): selection + verdict both live
  // in release-readiness.mjs so factory, doctor, and packager agree.
  const selected = readApplicableReceipt(reportsDir, storeId, generation, gateContract, { sha256 });
  if (!selected.receipt) {
    const rel = `${storeId}/${generation}.json`;
    return { status: 'CANDIDATE_ONLY', reason: `no generation receipt (${rel} unreadable): candidate-only export`, receipt: null };
  }
  return decideGenerationReadiness(selected.receipt, { origin, generation, sha256, gateContract, requiredGates, protocolCommit });
}

function gitInfo() {
  try {
    const rev = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: 'pipe', timeout: 30000 }).toString().trim();
    return { rev };
  } catch {
    return { rev: 'unknown' };
  }
}

async function main(argv) {
  const args = { origin: process.env.SAI_SITE_ORIGIN ?? null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--origin') args.origin = argv[++i];
    else if (a === '--out') args.out = resolve(argv[++i]);
    else throw new Error(`unknown option ${a}`);
  }
  const receipt = {
    tool: 'release-package',
    verdict: 'FAIL',
    origin: args.origin,
    candidate: null,
    package: null,
    extractionVerify: null,
    extractionSmoke: null,
    git: gitInfo().rev,
    publicationAuthorized: false,
    external: 'no upload or deployment performed or claimed',
  };
  const fail = (detail) => {
    process.stderr.write(`release:package FAIL: ${detail}\n`);
    return 1;
  };
  if (!args.origin) {
    receipt.verdict = 'BLOCKED';
    writeReceipt(args, receipt);
    process.stderr.write('release:package BLOCKED: SAI_SITE_ORIGIN or --origin is required\n');
    return 3;
  }
  const origin = String(args.origin).trim().replace(/\/$/, '');
  receipt.origin = origin;

  // 1. committed candidate required.
  const resolved = resolveCandidateStore(ROOT, origin);
  if (resolved.kind !== 'store') {
    receipt.verdict = 'BLOCKED';
    writeReceipt(args, receipt);
    process.stderr.write(`release:package BLOCKED: no committed candidate store for ${origin} (legacy stores migrate on the next factory run)\n`);
    return 3;
  }
  const pointer = readPointer(resolved.dir, 'current');
  if (!pointer?.generation || !pointer?.sha256) {
    receipt.verdict = 'BLOCKED';
    writeReceipt(args, receipt);
    process.stderr.write(`release:package BLOCKED: no committed generation for ${origin}\n`);
    return 3;
  }
  if (pointer.origin && pointer.origin !== origin) {
    return fail(`store identity conflict: committed for ${pointer.origin}, requested ${origin}; refusing`);
  }
  const genDir = join(resolved.dir, 'generations', pointer.generation);

  // 2. digest re-verification over the exact committed bytes.
  let digest;
  try {
    digest = computeDigest(genDir);
  } catch (error) {
    return fail(`committed generation unreadable: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  if (!verifyDigest(genDir, pointer.sha256) || digest.sha256 !== pointer.sha256) {
    return fail('committed generation digest mismatch; refusing to package a corrupted candidate');
  }

  // 3. public verifier re-run (effective origin + public contract, release mode).
  const env = { ...process.env, SAI_SITE_ORIGIN: origin, SAI_RELEASE_BUILD: '1', SAI_RELEASE_ORIGIN_ACK: origin };
  const pre = await verifyRelease({ dist: genDir, env, release: true, public: true, root: ROOT });
  if (pre.verdict !== 'PASS') {
    return fail(`public verification of the committed generation: ${pre.verdict} (${pre.checks.filter((c) => c.status !== 'PASS').map((c) => c.id).join(', ')})`);
  }
  receipt.candidate = {
    store: relative(ROOT, resolved.dir).split(sep).join('/'),
    generation: pointer.generation,
    files: digest.files,
    sha256: digest.sha256,
  };

  // 4. collect + screen every member; symlinks/junctions can never enter.
  const rels = listFilesRecursive(genDir);
  const files = new Map();
  for (const rel of rels) {
    const reason = unsafeMemberReason(rel);
    if (reason) return fail(`unsafe candidate member ${rel} (${reason}); refusing to package`);
    let st;
    try {
      st = lstatSync(join(genDir, rel));
    } catch {
      return fail(`candidate member unreadable: ${rel}`);
    }
    if (st.isSymbolicLink() || st.isDirectory()) return fail(`candidate member is not a regular file: ${rel}`);
    files.set(rel, readFileSync(join(genDir, rel)));
  }
  if (!files.has('index.html')) return fail('candidate has no index.html; refusing to package');

  // 4b. readiness attestation: FULL only with a bound generation receipt.
  const { storeIdForOrigin, GATE_CONTRACT_VERSION, REQUIRED_FULL_GATES } = await import('./release-candidate.mjs');
  const storeId = storeIdForOrigin(origin);
  let protocolCommit = null;
  try {
    protocolCommit = JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'canonical', 'meta.json'), 'utf8'))?.commit ?? null;
  } catch { /* format check still applies; canonical comparison skipped */ }
  const attestation = findFullReceipt({
    reportsDir: join(ROOT, 'reports', 'release', 'candidates'),
    storeId, origin, generation: pointer.generation, sha256: pointer.sha256,
    gateContract: GATE_CONTRACT_VERSION, requiredGates: REQUIRED_FULL_GATES, protocolCommit,
  });
  receipt.fullReceipt = {
    status: attestation.status,
    reason: attestation.reason,
    generation: pointer.generation,
    gateContract: GATE_CONTRACT_VERSION,
  };
  receipt.readiness = attestation.status === 'FULL' ? 'FULL_RELEASE_READY' : 'CANDIDATE_ONLY';

  // 5. deterministic ZIP.
  const { bytes, sha256 } = writeDeterministicZip(files);
  const zipName = `${storeId}-${digest.sha256.slice(0, 12)}.zip`;
  const zipPath = join(ROOT, '.site-work', 'release', 'packages', storeId, zipName);
  mkdirSync(dirname(zipPath), { recursive: true });
  writeFileSync(zipPath, bytes);
  receipt.package = {
    file: relative(ROOT, zipPath).split(sep).join('/'),
    files: files.size,
    sha256,
    bytes: bytes.length,
  };

  // 6. independent extraction + same verification gates on the extracted tree.
  const { mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const extractDir = mkdtempSync(join(tmpdir(), 'sai-package-verify-'));
  try {
    const extracted = readStoredZip(bytes);
    for (const [name, data] of extracted) {
      const full = join(extractDir, name);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, data);
    }
    const post = await verifyRelease({ dist: extractDir, env, release: true, public: true, root: ROOT });
    receipt.extractionVerify = { verdict: post.verdict, failing: post.checks.filter((c) => c.status !== 'PASS').map((c) => c.id) };
    if (post.verdict !== 'PASS') {
      receipt.verdict = 'FAIL';
      writeReceipt(args, receipt);
      return fail(`extracted package failed public verification: ${receipt.extractionVerify.failing.join(', ')}`);
    }
    const smoke = await probeCandidate(extractDir, origin);
    receipt.extractionSmoke = { verdict: smoke.verdict, failing: smoke.checks.filter((c) => c.status !== 'PASS').map((c) => c.id) };
    if (smoke.verdict !== 'LOCAL_STATIC_HOST_PASS') {
      receipt.verdict = 'FAIL';
      writeReceipt(args, receipt);
      return fail(`extracted package failed static-host smoke: ${receipt.extractionSmoke.failing.join(', ')}`);
    }
  } finally {
    const { rmSync } = await import('node:fs');
    rmSync(extractDir, { recursive: true, force: true });
  }

  receipt.verdict = 'PASS';
  const outPath = writeReceipt(args, receipt);
  process.stdout.write([
    'release-package: PASS',
    `origin: ${origin}`,
    `candidate: ${pointer.generation} (${digest.files} files, sha256 ${digest.sha256.slice(0, 16)}…)`,
    `package: ${relative(ROOT, zipPath).split(sep).join('/')} (sha256 ${sha256.slice(0, 16)}…, ${bytes.length} bytes)`,
    'extraction: public verification PASS + LOCAL_STATIC_HOST_PASS',
    `readiness: ${receipt.readiness}${attestation.reason ? ` (${attestation.reason})` : ' (bound generation FULL receipt)'}`,
    `receipt: ${outPath}`,
    'publicationAuthorized: false (no upload or deployment performed)',
  ].join('\n') + '\n');
  return 0;
}

function writeReceipt(args, receipt) {
  const name = receipt.origin ? receipt.origin.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() : 'blocked';
  const outPath = args.out ?? join(ROOT, 'reports', 'release', 'packages', `${name}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(receipt, null, 2)}\n`);
  return relative(ROOT, outPath).split(sep).join('/');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`release:package error: ${error.message}`);
    process.exit(2);
  });
}
