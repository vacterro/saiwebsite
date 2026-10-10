// Release-candidate factory controls (run by npm run test:engine).
// Fast unit tests over pure helpers plus CLI BLOCKED paths. The full
// happy-path factory run is exercised live (evidence manifest), not here:
// it needs a real build plus every static gate.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ROOT,
  computeDigest,
  rotateSnapshots,
  slugForOrigin,
  validateCandidateEnv,
  verifyDigest,
} from '../release-candidate.mjs';
import { projectPublicCandidate } from '../release-public.mjs';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'sai-candidate-'));
  dirs.push(d);
  return d;
}
function writeTree(dir, entries) {
  for (const [rel, content] of Object.entries(entries)) {
    mkdirSync(join(dir, rel.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
}

describe('release-candidate factory (helpers and refusal paths)', () => {
  it('slugs origins deterministically for snapshot paths', () => {
    assert.equal(slugForOrigin('https://saipenprotocol.com'), 'saipenprotocol-com');
    assert.equal(slugForOrigin('https://example.org:8443/x'), 'example-org-8443-x');
    assert.equal(slugForOrigin('https://saipenprotocol.com'), slugForOrigin('https://saipenprotocol.com/'));
  });

  it('missing origin BLOCKS before any heavy work', () => {
    const r = validateCandidateEnv({});
    assert.equal(r.ok, false);
    assert.match(r.reason, /SAI_SITE_ORIGIN is required/);
  });

  it('missing release flag or acknowledgement BLOCKS', () => {
    const origin = 'https://candidate.example.org';
    assert.match(validateCandidateEnv({ SAI_SITE_ORIGIN: origin }).reason, /SAI_RELEASE_BUILD/);
    assert.match(validateCandidateEnv({ SAI_SITE_ORIGIN: origin, SAI_RELEASE_BUILD: '1' }).reason, /SAI_RELEASE_ORIGIN_ACK/);
    assert.match(
      validateCandidateEnv({ SAI_SITE_ORIGIN: origin, SAI_RELEASE_BUILD: '1', SAI_RELEASE_ORIGIN_ACK: 'https://other.example.org' }).reason,
      /must repeat/,
    );
  });

  it('loopback origins BLOCK', () => {
    const r = validateCandidateEnv({
      SAI_SITE_ORIGIN: 'http://localhost:4321',
      SAI_RELEASE_BUILD: '1',
      SAI_RELEASE_ORIGIN_ACK: 'http://localhost:4321',
    });
    assert.equal(r.ok, false);
  });

  it('the test fixture origin is BLOCKED as a publishing destination', () => {
    const r = validateCandidateEnv({
      SAI_SITE_ORIGIN: 'https://sai-temp.example.org',
      SAI_RELEASE_BUILD: '1',
      SAI_RELEASE_ORIGIN_ACK: 'https://sai-temp.example.org',
    });
    assert.equal(r.ok, false);
    assert.match(r.reason, /test fixture/);
  });

  it('an acknowledged real origin passes the contract', () => {
    const r = validateCandidateEnv({
      SAI_SITE_ORIGIN: 'https://candidate.example.org',
      SAI_RELEASE_BUILD: '1',
      SAI_RELEASE_ORIGIN_ACK: 'https://candidate.example.org/',
    });
    assert.equal(r.ok, true);
    assert.equal(r.origin, 'https://candidate.example.org');
  });

  it('digests are deterministic and detect corruption', () => {
    const d = tempDir();
    writeTree(d, { 'index.html': '<html></html>', 'a/b.txt': 'hello' });
    const first = computeDigest(d);
    const second = computeDigest(d);
    assert.equal(first.sha256, second.sha256);
    assert.equal(first.files, 2);
    assert.equal(verifyDigest(d, first.sha256), true);
    writeFileSync(join(d, 'a', 'b.txt'), 'tampered');
    assert.equal(verifyDigest(d, first.sha256), false);
  });

  it('rotation promotes next to current and preserves previous', () => {
    const base = join(tempDir(), 'snaps');
    mkdirSync(join(base, 'current'), { recursive: true });
    mkdirSync(join(base, 'next'), { recursive: true });
    writeFileSync(join(base, 'current', 'index.html'), 'v1');
    writeFileSync(join(base, 'next', 'index.html'), 'v2');
    const { current, previous } = rotateSnapshots(base);
    assert.equal(readFileSync(join(current, 'index.html'), 'utf8'), 'v2');
    assert.equal(readFileSync(join(previous, 'index.html'), 'utf8'), 'v1');
  });

  it('rotation refuses without a verified next candidate', () => {
    const base = join(tempDir(), 'empty');
    mkdirSync(join(base, 'current'), { recursive: true });
    writeFileSync(join(base, 'current', 'index.html'), 'v1');
    assert.throws(() => rotateSnapshots(base), /no verified next/);
    assert.equal(readFileSync(join(base, 'current', 'index.html'), 'utf8'), 'v1');
  });

  it('projection is deterministic: two projections of one build digest identically', () => {
    // Self-contained fixture: engine tests never consume yesterday's dist/.
    // Exercises the scrub paths (debug tree, pseudo-locale, sitemap entry).
    const src = join(tempDir(), 'src');
    writeTree(src, {
      'index.html': '<!doctype html><html><head><title>t</title></head><body>home</body></html>',
      'about/index.html': '<!doctype html><html><body>about</body></html>',
      'debug/components/index.html': '<!doctype html><html><body>debug</body></html>',
      'qps-ploc/index.html': '<!doctype html><html><body>pseudo</body></html>',
      'sitemap.xml': '<?xml version="1.0"?><urlset><url><loc>https://x.example/</loc></url><url><loc>https://x.example/debug/components/</loc></url></urlset>',
      'search-index.json': '[{"url":"https://x.example/"},{"url":"https://x.example/qps-ploc/"}]',
    });
    const a = join(tempDir(), 'a');
    const b = join(tempDir(), 'b');
    const pa = projectPublicCandidate({ srcDir: src, destDir: a, root: ROOT });
    const pb = projectPublicCandidate({ srcDir: src, destDir: b, root: ROOT });
    assert.ok(pa.removed.length > 0 && pb.removed.length > 0, 'internal surfaces removed');
    assert.equal(readFileSync(join(src, 'index.html'), 'utf8').includes('home'), true, 'source untouched');
    const da = computeDigest(a);
    const db = computeDigest(b);
    assert.equal(da.files, db.files);
    assert.equal(da.sha256, db.sha256);
  });

  it('factory CLI exits BLOCKED (3) with machine-readable evidence when unacknowledged', () => {
    const env = { ...process.env };
    delete env.SAI_SITE_ORIGIN;
    delete env.SAI_RELEASE_BUILD;
    delete env.SAI_RELEASE_ORIGIN_ACK;
    let status = null;
    try {
      execFileSync(process.execPath, [join(ROOT, 'scripts', 'release-candidate.mjs')], { env, stdio: 'pipe', timeout: 120000 });
    } catch (error) {
      status = error.status;
    }
    assert.equal(status, 3);
    const evidence = JSON.parse(readFileSync(join(ROOT, 'reports', 'release', 'candidates', 'blocked.json'), 'utf8'));
    assert.equal(evidence.verdict, 'BLOCKED');
    assert.equal(evidence.failedStage, 'env-contract');
    assert.equal(evidence.publicationAuthorized, false);
  });
});
