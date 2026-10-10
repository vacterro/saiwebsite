/**
 * Stage F negative controls: deterministic dirty-source identity.
 *
 * gitInfo() used to record only HEAD + a dirty flag + a file count, so two
 * different dirty trees shared one identity. dirtyTreeIdentity() hashes a
 * manifest of status flags + blob hashes + paths instead, and returns null
 * -- never an invented hash -- when it cannot be established.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dirtyTreeIdentity, dirtyTreeProblem, resolvePorcelainPath, ROOT } from '../release-candidate.mjs';

describe('dirtyTreeIdentity', () => {
  it('deterministic: same porcelain twice gives the same 64-hex identity', () => {
    const porcelain = ' M package.json\n M README.md\n';
    const a = dirtyTreeIdentity(porcelain);
    const b = dirtyTreeIdentity(porcelain);
    assert.ok(a && /^[0-9a-f]{64}$/.test(a));
    assert.equal(a, b);
  });

  it('first-line leading space is significant: trim() must never eat status flags', () => {
    // Regression: gitInfo() once called .trim() on whole porcelain output,
    // turning line 0 ' M f' into 'M f'. The fixed slice(3) parser then read
    // path 'f'[1:] (dot dropped) and the identity silently failed. The
    // manifest must record the true ' M' flag for a leading-space line.
    const a = dirtyTreeIdentity(' M package.json\n');
    const b = dirtyTreeIdentity('M  package.json\n');
    assert.ok(a && b);
    assert.notEqual(a, b, 'unstaged and staged flags are different provenance');
    assert.ok(/^[0-9a-f]{64}$/.test(a), 'leading-space line resolves (dot intact)');
  });

  it('sensitive: a different flag or path gives a different identity', () => {
    const a = dirtyTreeIdentity(' M package.json\n');
    const b = dirtyTreeIdentity('M  package.json\n');
    const c = dirtyTreeIdentity(' M README.md\n');
    assert.ok(a && b && c);
    assert.notEqual(a, b);
    assert.notEqual(a, c);
  });

  it('deleted entries are recorded without hashing', () => {
    const a = dirtyTreeIdentity(' D no-such-file-anywhere-xyz123\n');
    assert.ok(a && /^[0-9a-f]{64}$/.test(a));
  });

  it('untracked directories expand to their files', () => {
    const dir = join(ROOT, 'sai-provenance-scratch');
    rmSync(dir, { recursive: true, force: true });
    try {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'a.txt'), 'one');
      writeFileSync(join(dir, 'sub', 'b.txt'), 'two');
      const whole = dirtyTreeIdentity('?? sai-provenance-scratch/\n');
      const partial = dirtyTreeIdentity('?? sai-provenance-scratch/a.txt\n');
      assert.ok(whole && partial);
      assert.notEqual(whole, partial, 'directory identity covers all files inside');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stray carriage-return line endings fall back to the real path', () => {
    const plain = dirtyTreeIdentity(' M package.json\n');
    const crlf = dirtyTreeIdentity(' M package.json\r\n');
    assert.ok(plain && crlf);
    assert.equal(crlf, plain, 'a stray CR never changes the identity');
    assert.equal(resolvePorcelainPath('package.json\r').path, 'package.json');
  });

  it('problem detail exposes hidden characters instead of hiding them', () => {
    const detail = dirtyTreeProblem('?? no-such-file-xyz123\r\n');
    assert.match(detail, /\\r/, 'CR is JSON-escaped and visible');
  });

  it('live working tree resolves to a real identity (regression: untracked dirs broke it)', () => {
    // The regression was a real `git status --porcelain` payload carrying a
    // large untracked directory. Build that condition instead of demanding an
    // already-dirty worktree: a clean checkout must be able to run every gate.
    // The pathspec keeps the payload scoped to this fixture, so an unrelated
    // (or concurrently mutating) ambient tree can neither slow this down by
    // thousands of entries nor break the walk mid-flight.
    const dir = join(ROOT, 'sai-provenance-scale');
    rmSync(dir, { recursive: true, force: true });
    try {
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 320; i++) writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.txt`), `entry ${i}\n`);
      const porcelain = execSync('git -c core.quotePath=false status --porcelain -- sai-provenance-scale', { cwd: ROOT, encoding: 'utf8', timeout: 30000 });
      assert.ok(porcelain.trim().length > 0, 'the constructed 300+ entry tree is dirty');
      const id = dirtyTreeIdentity(porcelain);
      assert.ok(id && /^[0-9a-f]{64}$/.test(id), 'real 300+ entry tree with untracked dirs must resolve');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // No equality re-check here: determinism is proven on fixed input
    // above, and a live tree under parallel suites may legitimately change
    // between two hash passes (a changed tree MUST hash differently).
  });
});
