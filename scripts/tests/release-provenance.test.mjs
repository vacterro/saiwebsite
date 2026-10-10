/**
 * Stage F negative controls: deterministic dirty-source identity.
 *
 * gitInfo() used to record only HEAD + a dirty flag + a file count, so two
 * different dirty trees shared one identity. dirtyTreeIdentity() hashes a
 * manifest of status flags + blob hashes + paths instead, and returns null
 * -- never an invented hash -- when it cannot be established.
 *
 * Every fixture below owns its scratch directory: mkdtempSync() gives it a
 * unique name, so two suites running in parallel (or a directory an operator
 * already had) can never share it, and the finally block removes exactly what
 * this test created. Nothing here deletes a pre-existing path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { dirtyTreeIdentity, dirtyTreeProblem, resolvePorcelainPath, ROOT } from '../release-candidate.mjs';

const FIXTURE_PREFIX = 'sai-provenance-';
const BYSTANDER_NAME = 'sai-provenance-scratch';

/** A unique scratch directory inside ROOT that git can see as untracked. */
function fixtureDir() {
  return mkdtempSync(join(ROOT, FIXTURE_PREFIX));
}

/** Repository-relative, POSIX-separated form git reports and the identity expects. */
function repoPath(dir) {
  assert.ok(isAbsolute(dir), 'fixture directories are absolute');
  const rel = relative(ROOT, dir);
  assert.ok(rel.length > 0 && !rel.startsWith('..'), 'fixtures live inside the repository root');
  return rel.split(sep).join('/');
}

/** Every path under dir, relative to ROOT, POSIX-separated, sorted. */
function listTree(dir) {
  const out = [];
  (function walk(current) {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.push(repoPath(full));
    }
  })(dir);
  return out.sort();
}

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

  it('two different real paths with identical content keep different identities', () => {
    // Path participates in the identity: two scratch trees holding the same
    // bytes are still different provenance.
    const first = fixtureDir();
    const second = fixtureDir();
    try {
      for (const dir of [first, second]) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'a.txt'), 'same bytes');
      }
      const a = dirtyTreeIdentity(`?? ${repoPath(first)}/\n`);
      const b = dirtyTreeIdentity(`?? ${repoPath(second)}/\n`);
      assert.ok(a && b);
      assert.notEqual(a, b, 'identity covers the path, not only the bytes');
    } finally {
      rmSync(first, { recursive: true, force: true });
      rmSync(second, { recursive: true, force: true });
    }
  });

  it('deleted entries are recorded without hashing', () => {
    const a = dirtyTreeIdentity(' D no-such-file-anywhere-xyz123\n');
    assert.ok(a && /^[0-9a-f]{64}$/.test(a));
  });

  it('untracked directories expand to their files', () => {
    const dir = fixtureDir();
    try {
      mkdirSync(join(dir, 'sub'), { recursive: true });
      writeFileSync(join(dir, 'a.txt'), 'one');
      writeFileSync(join(dir, 'sub', 'b.txt'), 'two');
      const name = repoPath(dir);
      const whole = dirtyTreeIdentity(`?? ${name}/\n`);
      const partial = dirtyTreeIdentity(`?? ${name}/a.txt\n`);
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
    const dir = fixtureDir();
    try {
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 320; i++) writeFileSync(join(dir, `f${String(i).padStart(3, '0')}.txt`), `entry ${i}\n`);
      const name = repoPath(dir);
      const porcelain = execSync(`git -c core.quotePath=false status --porcelain -- ${name}`, { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
      assert.ok(porcelain.includes(name), 'the constructed scratch tree is reported by git');
      assert.ok(porcelain.split('\n').filter((l) => l.trim()).length > 0, 'it is an untracked entry');
      const id = dirtyTreeIdentity(porcelain);
      assert.ok(id && /^[0-9a-f]{64}$/.test(id), 'real 300+ entry tree with untracked dirs must resolve');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // No equality re-check here: determinism is proven on fixed input
    // above, and a live tree under parallel suites may legitimately change
    // between two hash passes (a changed tree MUST hash differently).
  });

  it('a similarly named pre-existing directory is never removed by fixture setup', () => {
    // Negative control. The old suite called rmSync('sai-provenance-scratch')
    // as setup and teardown, so any directory with that name an operator or
    // another suite had put there was destroyed before the test even ran.
    const bystander = join(ROOT, BYSTANDER_NAME);
    const created = !existsSync(bystander);
    if (created) {
      mkdirSync(bystander, { recursive: true });
      writeFileSync(join(bystander, 'canary.txt'), 'not test data');
    }
    // A same-named directory may hold real content; it may also exist as a
    // file. Either way it must come out of this test exactly as it went in.
    const bystanderIsDir = existsSync(bystander) && statSync(bystander).isDirectory();
    const before = bystanderIsDir ? listTree(bystander) : null;
    const fixture = fixtureDir();
    try {
      mkdirSync(fixture, { recursive: true });
      writeFileSync(join(fixture, 'a.txt'), 'fixture data');
      const id = dirtyTreeIdentity(`?? ${repoPath(fixture)}/\n`);
      assert.ok(id && /^[0-9a-f]{64}$/.test(id), 'the owned fixture resolves normally');
      const after = bystanderIsDir ? listTree(bystander) : null;
      assert.deepEqual(after, before, `fixture setup and teardown must not touch ${BYSTANDER_NAME}`);
      if (!bystanderIsDir) assert.equal(existsSync(bystander), !created, 'a non-directory bystander is left alone');
    } finally {
      rmSync(fixture, { recursive: true, force: true });
      if (created) rmSync(bystander, { recursive: true, force: true });
    }
  });
});
