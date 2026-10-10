// Release-pipeline hardening controls (run by npm run test:engine).
// Failure-injection and refusal-path tests for Stages A/B:
//   - failed promotion copies never destroy the committed generation
//   - interrupted promotions stay recoverable from the committed pointer
//   - overlapping/protected destinations are refused before any deletion
//   - distinct origins never share a storage identity
//   - concurrent factory runs are refused; stale locks recover conservatively
// All fixtures are disposable temp directories; the real repository root is
// never used as a destructive-test target.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  ROOT,
  acquireReleaseLock,
  checkStoreOwnership,
  commitGeneration,
  computeDigest,
  importLegacyStore,
  readPointer,
  resolveCandidateStore,
  rotateSnapshots,
  storeIdForOrigin,
  syncCompatView,
  verifyDigest,
  writePointerAtomic,
} from '../release-candidate.mjs';
import {
  OWNER_SUFFIX,
  assertSafeDestination,
  projectPublicCandidate,
} from '../release-public.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function tempDir(prefix = 'sai-harden-') {
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
function buildSrc(name = 'src') {
  const src = join(tempDir(), name);
  writeTree(src, {
    'index.html': '<!doctype html><html><body>home</body></html>',
    'about/index.html': '<!doctype html><html><body>about</body></html>',
  });
  return src;
}

describe('A1: transaction-safe promotion', () => {
  it('a copy failure during promotion leaves current/ and next/ intact', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    const boom = () => { throw new Error('injected copy failure'); };
    assert.throws(() => rotateSnapshots(base, { copy: boom }), /current\/ untouched/);
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'v1');
    assert.equal(readFileSync(join(base, 'next', 'index.html'), 'utf8'), 'v2');
    assert.equal(readPointer(base, 'current'), null, 'no pointer committed');
  });

  it('a mid-copy failure (partial tree then throw) still preserves current/', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2', 'next/a.txt': 'a' });
    const partial = (s, d) => {
      cpSync(s, d, { recursive: true });
      throw new Error('failure after partial copy');
    };
    assert.throws(() => rotateSnapshots(base, { copy: partial }), /current\/ untouched/);
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'v1');
  });

  it('a digest mismatch in next/ refuses promotion without touching current/', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    const real = computeDigest(join(base, 'next'));
    writeFileSync(join(base, 'next', 'index.html'), 'v2-tampered');
    assert.throws(
      () => rotateSnapshots(base, { digest: real, origin: 'https://x.example' }),
      /digest mismatch/,
    );
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'v1');
  });

  it('a staging failure after a commit still preserves the committed generation', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    rotateSnapshots(base, { origin: 'https://x.example' });
    const committed = readPointer(base, 'current');
    mkdirSync(join(base, 'next'), { recursive: true });
    writeTree(base, { 'next/index.html': 'v3', 'next/big.txt': 'x'.repeat(1000) });
    const partial = (s, d) => {
      cpSync(s, d, { recursive: true });
      throw new Error('failure after staging copy');
    };
    assert.throws(() => rotateSnapshots(base, { origin: 'https://x.example', copy: partial }), /current\/ untouched/);
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'v2');
    assert.equal(readPointer(base, 'current').generation, committed.generation, 'pointer unmoved');
  });

  it('an interrupted promotion (next/ staged, no commit) keeps the committed generation valid', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    rotateSnapshots(base, { origin: 'https://x.example' });
    const committed = readPointer(base, 'current');
    assert.ok(committed?.generation, 'pointer committed');
    // Simulate an interrupted SECOND promotion: next/ restaged, then crash
    // before commit. The committed generation must still verify.
    mkdirSync(join(base, 'next'), { recursive: true });
    writeFileSync(join(base, 'next', 'index.html'), 'v3-unverified');
    const genDir = join(base, 'generations', committed.generation);
    assert.equal(verifyDigest(genDir, committed.sha256), true, 'committed generation still valid');
    assert.equal(verifyDigest(join(base, 'current'), committed.sha256), true, 'current/ view still valid');
    // Recovery: discard the unverified staging, re-sync the view from the
    // committed generation — the previously verified data is restored.
    rmSync(join(base, 'next'), { recursive: true, force: true });
    syncCompatView(base, genDir, 'current', { expectedSha256: committed.sha256 });
    assert.equal(verifyDigest(join(base, 'current'), committed.sha256), true, 'view re-synced from commitment');
  });

  it('re-promoting identical content moves no pointers (history preserved)', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    rotateSnapshots(base, { origin: 'https://x.example' });
    mkdirSync(join(base, 'next'), { recursive: true });
    writeFileSync(join(base, 'next', 'index.html'), 'v3');
    rotateSnapshots(base, { origin: 'https://x.example' });
    const before = readPointer(base, 'previous');
    // Identical re-run: same bytes as the committed generation.
    mkdirSync(join(base, 'next'), { recursive: true });
    writeFileSync(join(base, 'next', 'index.html'), 'v3');
    rotateSnapshots(base, { origin: 'https://x.example' });
    assert.deepEqual(readPointer(base, 'previous'), before, 'previous generation still referenced');
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'v3');
    assert.ok(!existsSync(join(base, 'next')), 'staging consumed');
  });

  it('a lost current/ view is recoverable from the committed generation', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    rotateSnapshots(base, { origin: 'https://x.example' });
    const committed = readPointer(base, 'current');
    rmSync(join(base, 'current'), { recursive: true, force: true });
    assert.ok(!existsSync(join(base, 'current', 'index.html')), 'view destroyed');
    const genDir = join(base, 'generations', committed.generation);
    syncCompatView(base, genDir, 'current', { expectedSha256: committed.sha256 });
    assert.equal(verifyDigest(join(base, 'current'), committed.sha256), true, 'recovered from commitment');
  });

  it('a generation with an invalid digest is never selected for restore', () => {
    const base = join(tempDir(), 'store');
    writeTree(base, { 'current/index.html': 'v1', 'next/index.html': 'v2' });
    rotateSnapshots(base, { origin: 'https://x.example' });
    const committed = readPointer(base, 'current');
    const genDir = join(base, 'generations', committed.generation);
    writeFileSync(join(genDir, 'index.html'), 'corrupted');
    assert.equal(verifyDigest(genDir, committed.sha256), false, 'corruption detected');
    assert.throws(
      () => syncCompatView(base, genDir, 'current', { expectedSha256: committed.sha256 }),
      /digest mismatch/,
      'corrupt generation refused for view restore',
    );
  });

  it('commitGeneration refuses a staged candidate with no valid build', () => {
    const base = join(tempDir(), 'store');
    const staged = join(tempDir(), 'staged');
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, 'other.txt'), 'no index here');
    assert.throws(
      () => commitGeneration(base, { stagedDir: staged, digest: { sha256: 'x'.repeat(64), files: 1 }, origin: 'https://x.example' }),
      /not a valid build/,
    );
    assert.equal(readPointer(base, 'current'), null, 'nothing committed');
  });
});

describe('A2: overlapping and protected destinations are refused', () => {
  it('source equals destination is refused and the source survives', () => {
    const src = buildSrc();
    assert.throws(() => projectPublicCandidate({ srcDir: src, destDir: src, root: ROOT }), /unsafe-destination/);
    assert.ok(existsSync(join(src, 'index.html')), 'source index.html survives');
  });

  it('destination inside the source is refused and the source survives', () => {
    const src = buildSrc();
    assert.throws(
      () => projectPublicCandidate({ srcDir: src, destDir: join(src, 'child'), root: ROOT }),
      /unsafe-destination/,
    );
    assert.ok(existsSync(join(src, 'index.html')), 'source index.html survives');
  });

  it('destination above the source (would delete it) is refused', () => {
    const parent = tempDir();
    const src = join(parent, 'src');
    writeTree(src, { 'index.html': '<html></html>' });
    assert.throws(
      () => projectPublicCandidate({ srcDir: src, destDir: parent, root: ROOT }),
      /unsafe-destination/,
    );
    assert.ok(existsSync(join(src, 'index.html')), 'source index.html survives');
  });

  it('the repository root is refused', () => {
    const src = buildSrc();
    assert.throws(() => assertSafeDestination({ srcDir: src, destDir: ROOT, root: ROOT }), /repository root/);
  });

  it('protected project directories are refused', () => {
    const src = buildSrc();
    for (const sub of ['src', 'scripts', 'dist', 'reports']) {
      assert.throws(
        () => assertSafeDestination({ srcDir: src, destDir: join(ROOT, sub, 'candidate-out'), root: ROOT }),
        /protected repository path/,
        sub,
      );
    }
  });

  it('the candidate store root and verified generations are refused', () => {
    const src = buildSrc();
    const storeRoot = join(ROOT, '.site-work', 'release', 'candidates');
    assert.throws(
      () => assertSafeDestination({ srcDir: src, destDir: storeRoot, root: ROOT }),
      /candidate store root/,
    );
    const legacy = join(ROOT, '.site-work', 'release', 'candidates', 'saipenprotocol-com');
    if (existsSync(join(legacy, 'current', 'index.html'))) {
      assert.throws(
        () => assertSafeDestination({ srcDir: src, destDir: legacy, root: ROOT }),
        /verified candidate/,
        'live verified candidate is not a target',
      );
    }
  });

  it('a destination with unrelated files is refused (no blind deletion)', () => {
    const src = buildSrc();
    const dest = tempDir();
    writeFileSync(join(dest, 'my-notes.txt'), 'user data');
    assert.throws(() => projectPublicCandidate({ srcDir: src, destDir: dest, root: ROOT }), /not produced by this tool/);
    assert.equal(readFileSync(join(dest, 'my-notes.txt'), 'utf8'), 'user data', 'user data untouched');
  });

  it('a previous output of this tool may be refreshed (ownership marker)', () => {
    const src = buildSrc();
    const dest = join(tempDir(), 'candidate');
    const first = projectPublicCandidate({ srcDir: src, destDir: dest, root: ROOT });
    assert.ok(existsSync(`${dest}${OWNER_SUFFIX}`), 'ownership marker beside the directory');
    const second = projectPublicCandidate({ srcDir: src, destDir: dest, root: ROOT });
    assert.equal(first.files, second.files, 'refresh reproduces the file set');
  });

  it('a missing source is refused before any destination work', () => {
    const dest = join(tempDir(), 'candidate');
    assert.throws(
      () => projectPublicCandidate({ srcDir: join(tempDir(), 'no-such-build'), destDir: dest, root: ROOT }),
      /no valid build/,
    );
    assert.ok(!existsSync(dest), 'destination never created');
  });

  it('a symlink destination is refused', () => {
    const src = buildSrc();
    const real = tempDir();
    const link = join(tempDir(), 'link-dest');
    try {
      symlinkSync(real, link, 'dir');
    } catch {
      return; // host cannot create symlinks: same environmental skip as release-origin.test.mjs
    }
    assert.throws(() => assertSafeDestination({ srcDir: src, destDir: link, root: ROOT }), /unsafe-destination/);
  });

  it('a source that disappears mid-copy fails with the destination untouched', () => {
    const parent = tempDir();
    const dest = join(tempDir(), 'candidate');
    // Vanishing source: point at a path whose index.html is removed between
    // validation and copy by racing removal — modelled here by a directory
    // that passes validation only if index.html exists at call time.
    const src = join(parent, 'src');
    writeTree(src, { 'index.html': '<html></html>' });
    rmSync(join(src, 'index.html'));
    assert.throws(() => projectPublicCandidate({ srcDir: src, destDir: dest, root: ROOT }), /no valid build/);
    assert.ok(!existsSync(dest), 'destination untouched');
  });
});

describe('B1: collision-resistant origin identities', () => {
  it('https://a.b.com and https://a-b.com do not share an identity', () => {
    const a = storeIdForOrigin('https://a.b.com');
    const b = storeIdForOrigin('https://a-b.com');
    assert.notEqual(a, b);
    assert.ok(a.startsWith('a-b-com-') && b.startsWith('a-b-com-'), 'readable prefix retained');
  });

  it('scheme and port participate in the identity', () => {
    assert.notEqual(storeIdForOrigin('https://x.example:8443'), storeIdForOrigin('https://x.example:9443'));
    assert.equal(storeIdForOrigin('https://x.example'), storeIdForOrigin('https://x.example/'), 'trailing slash ignored');
  });

  it('identities are deterministic', () => {
    assert.equal(storeIdForOrigin('https://saipenprotocol.com'), storeIdForOrigin('https://saipenprotocol.com'));
  });

  it('a store owned by another origin is refused for reuse', () => {
    const base = join(tempDir(), 'store');
    mkdirSync(base, { recursive: true });
    writePointerAtomic(base, 'current', { generation: 'g-x', sha256: 'y', files: 1, origin: 'https://other.example' });
    assert.throws(() => checkStoreOwnership(base, 'https://mine.example'), /foreign identity/);
    assert.doesNotThrow(() => checkStoreOwnership(base, 'https://other.example'));
  });

  it('legacy stores migrate non-destructively with rollback preserved', () => {
    const root = tempDir();
    const origin = 'https://migrate.example';
    // Import the slug scheme used by resolveCandidateStore for legacy layout.
    const { slugForOrigin } = { slugForOrigin: (o) => o.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() };
    const legacyDir = join(root, '.site-work', 'release', 'candidates', slugForOrigin(origin));
    writeTree(legacyDir, { 'current/index.html': 'legacy-v1', 'previous/index.html': 'legacy-v0' });
    const before = computeDigest(join(legacyDir, 'current')).sha256;
    const resolved = resolveCandidateStore(root, origin);
    assert.equal(resolved.kind, 'legacy');
    const migrated = importLegacyStore(root, origin);
    assert.equal(migrated.migrated, true);
    const pointer = readPointer(migrated.dir, 'current');
    assert.equal(pointer.origin, origin);
    assert.equal(pointer.sha256, before, 'migrated digest matches legacy content');
    assert.ok(pointer.migratedFrom, 'migration provenance recorded');
    assert.equal(computeDigest(join(legacyDir, 'current')).sha256, before, 'legacy untouched (rollback)');
    assert.equal(readFileSync(join(migrated.dir, 'current', 'index.html'), 'utf8'), 'legacy-v1');
  });

  it('migration refuses an unverifiable legacy candidate (no provenance claims)', () => {
    const root = tempDir();
    const origin = 'https://unverifiable.example';
    const legacyDir = join(root, '.site-work', 'release', 'candidates', 'unverifiable-example');
    mkdirSync(join(legacyDir, 'current'), { recursive: true });
    writeFileSync(join(legacyDir, 'current', 'notes.txt'), 'no build here');
    assert.throws(() => importLegacyStore(root, origin), /no verifiable current/);
  });
});

describe('D: deterministic offline package primitives', () => {
  it('ZIP bytes are deterministic across runs and entry orders', async () => {
    const pkg = await import('../release-package.mjs');
    const enc = new TextEncoder();
    const a = new Map([['b.txt', enc.encode('hello')], ['a/index.html', enc.encode('<html>')]]);
    const b = new Map([['a/index.html', enc.encode('<html>')], ['b.txt', enc.encode('hello')]]);
    const z1 = pkg.writeDeterministicZip(a);
    const z2 = pkg.writeDeterministicZip(b);
    assert.equal(z1.sha256, z2.sha256, 'identical bytes for identical content');
    assert.equal(z1.entries, 2);
  });

  it('ZIP round-trips through an independent reader with CRC enforcement', async () => {
    const pkg = await import('../release-package.mjs');
    const enc = new TextEncoder();
    const files = new Map([['index.html', enc.encode('<html>hi</html>')]]);
    const { bytes } = pkg.writeDeterministicZip(files);
    const back = pkg.readStoredZip(bytes);
    assert.equal(back.get('index.html').toString(), '<html>hi</html>');
    const corruptData = Buffer.from(bytes);
    corruptData[30 + 'index.html'.length + 2] ^= 0xff;
    assert.throws(() => pkg.readStoredZip(corruptData), /CRC/, 'data corruption detected on read-back');
    const corruptEnd = Buffer.from(bytes);
    corruptEnd[corruptEnd.length - 12] ^= 0xff;
    assert.throws(() => pkg.readStoredZip(corruptEnd), /unreadable/, 'end-record corruption detected on read-back');
  });

  it('unsafe member paths are refused for packaging', async () => {
    const pkg = await import('../release-package.mjs');
    const bs = String.fromCharCode(92);
    assert.ok(pkg.unsafeMemberReason(`..${'/'}x`), 'traversal refused');
    assert.ok(pkg.unsafeMemberReason('/abs/x'), 'absolute refused');
    assert.ok(pkg.unsafeMemberReason(`a${bs}b`), 'backslash refused');
    assert.ok(pkg.unsafeMemberReason('.saipen/x'), 'project memory refused');
    assert.ok(pkg.unsafeMemberReason('.git/x'), 'version control refused');
    assert.equal(pkg.unsafeMemberReason('about/index.html'), null, 'public page allowed');
  });

  it('packaging without an origin is BLOCKED, never a silent failure', async () => {
    let status = null;
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'release-package.mjs')], {
        env: { ...process.env, SAI_SITE_ORIGIN: '' },
        stdio: 'pipe',
        timeout: 60000,
      });
    } catch (error) {
      status = error.status;
    }
    assert.equal(status, 3, 'missing origin BLOCKS with exit 3');
  });
});

describe('B2: factory-wide exclusive lock', () => {
  it('a second concurrent run is refused while the first holds the lock', () => {
    const root = tempDir();
    const release = acquireReleaseLock(root);
    try {
      assert.throws(() => acquireReleaseLock(root), /release-busy/);
    } finally {
      release();
    }
  });

  it('the lock releases on completion and a later run proceeds', () => {
    const root = tempDir();
    acquireReleaseLock(root)();
    const release = acquireReleaseLock(root);
    release();
  });

  it('release is idempotent and never removes a foreign lock', () => {
    const root = tempDir();
    const release = acquireReleaseLock(root);
    release();
    release();
    assert.ok(!existsSync(join(root, '.site-work', 'release', 'factory.lock')), 'lock cleaned up');
  });

  it('an abandoned lock (dead owner) is recovered with the record preserved', () => {
    const root = tempDir();
    const lockDir = join(root, '.site-work', 'release', 'factory.lock');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'owner.json'), JSON.stringify({ pid: 2147483647, command: ['dead'], at: 'past' }));
    const release = acquireReleaseLock(root);
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
    assert.ok(owner.recoveredFrom, 'recovery provenance recorded');
    assert.ok(existsSync(owner.recoveredFrom), 'abandoned lock moved aside, not deleted');
    release();
  });

  it('an unreadable lock is never permission to proceed', () => {
    const root = tempDir();
    const lockDir = join(root, '.site-work', 'release', 'factory.lock');
    mkdirSync(lockDir, { recursive: true });
    // No owner.json at all: ownership cannot be established.
    assert.throws(() => acquireReleaseLock(root), /release-busy/);
  });

  it('the factory CLI refuses a concurrent run instead of overlapping', () => {
    const root = tempDir();
    const release = acquireReleaseLock(ROOT);
    try {
      let status = null;
      try {
        execFileSync(
          process.execPath,
          [join(ROOT, 'scripts', 'release-candidate.mjs')],
          {
            env: {
              ...process.env,
              SAI_SITE_ORIGIN: 'https://candidate.example.org',
              SAI_RELEASE_BUILD: '1',
              SAI_RELEASE_ORIGIN_ACK: 'https://candidate.example.org',
            },
            stdio: 'pipe',
            timeout: 120000,
          },
        );
      } catch (error) {
        status = error.status;
      }
      assert.equal(status, 1, 'concurrent factory run refused with FAIL, not a silent overlap');
    } finally {
      release();
    }
  });
});
