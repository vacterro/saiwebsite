/**
 * Stage A/D controls: visual baselines cannot silently drift, and proving
 * it must never mutate the canonical tests/baselines/ directory.
 *
 * All destructive mutations run in disposable fixture roots (a copy of the
 * baseline directory plus MANIFEST.json only -- never the whole repo).
 * The production validator (scripts/validate-baselines.mjs) resolves
 * tests/baselines relative to its working directory, so the SAME
 * validator runs unmodified with cwd set to the fixture root.
 *
 * The canonical directory is read-only here: a module-level snapshot
 * proves it is byte-identical after every fixture test in this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const CANONICAL = join(ROOT, 'tests', 'baselines');
const VALIDATOR = join(ROOT, 'scripts', 'validate-baselines.mjs');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const snapshotDir = (dir) => Object.fromEntries(
  readdirSync(dir).map((f) => [f, sha(readFileSync(join(dir, f)))]),
);
const realBefore = snapshotDir(CANONICAL);

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), 'sai-baseline-fixture-'));
  const dir = join(root, 'tests', 'baselines');
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(CANONICAL)) cpSync(join(CANONICAL, f), join(dir, f));
  return { root, dir };
}

function destroyFixture(root) {
  const parent = realpathSync(tmpdir());
  const target = realpathSync(root);
  const rel = relative(parent, target);
  if (!rel || rel.startsWith('..') || !basename(target).startsWith('sai-baseline-fixture-')) {
    throw new Error(`[unsafe-fixture-cleanup] ${root}`);
  }
  rmSync(target, { recursive: true, force: true });
}

const validateAt = (root) => spawnSync(process.execPath, [VALIDATOR], { cwd: root, encoding: 'utf8' });

test('1. extra PNG inside fixture fails validation', () => {
  const { root, dir } = makeFixture();
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.png'));
    cpSync(join(dir, files[0]), join(dir, 'zz-extra-unrecorded.png'));
    const r = validateAt(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /unrecorded baseline zz-extra-unrecorded\.png/);
  } finally {
    destroyFixture(root);
  }
});

test('2. corrupted fixture PNG fails validation as hash drift', () => {
  const { root, dir } = makeFixture();
  try {
    const target = join(dir, 'home.png');
    const tampered = Buffer.from(readFileSync(target));
    tampered[tampered.length - 1] ^= 1;
    writeFileSync(target, tampered);
    const r = validateAt(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /home\.png differs from its recorded SHA-256/);
  } finally {
    destroyFixture(root);
  }
});

test('3. missing fixture PNG fails validation', () => {
  const { root, dir } = makeFixture();
  try {
    rmSync(join(dir, 'home.png'));
    const r = validateAt(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /missing baseline home\.png/);
  } finally {
    destroyFixture(root);
  }
});

test('4. fixture manifest mismatch fails validation', () => {
  const { root, dir } = makeFixture();
  try {
    const m = join(dir, 'MANIFEST.json');
    const doc = JSON.parse(readFileSync(m, 'utf8'));
    doc.files['home.png'] = '0'.repeat(64);
    writeFileSync(m, JSON.stringify(doc));
    const r = validateAt(root);
    assert.notEqual(r.status, 0);
    assert.match(r.stdout + r.stderr, /home\.png differs from its recorded SHA-256/);
  } finally {
    destroyFixture(root);
  }
});

test('5. valid fixture passes with the production validator', () => {
  const { root } = makeFixture();
  try {
    assert.equal(validateAt(root).status, 0);
  } finally {
    destroyFixture(root);
  }
});

test('7. concurrent isolated fixtures do not collide', () => {
  const a = makeFixture();
  const b = makeFixture();
  try {
    assert.notEqual(a.root, b.root);
    const tampered = Buffer.from(readFileSync(join(a.dir, 'home.png')));
    tampered[tampered.length - 1] ^= 1;
    writeFileSync(join(a.dir, 'home.png'), tampered);
    assert.notEqual(validateAt(a.root).status, 0, 'corrupted fixture A must fail');
    assert.equal(validateAt(b.root).status, 0, 'untouched fixture B must still pass');
  } finally {
    destroyFixture(a.root);
    destroyFixture(b.root);
  }
});

test('8. an abandoned mutated fixture leaves canonical baselines untouched', () => {
  const { root, dir } = makeFixture();
  // Simulate interruption: mutate, verify canonical health WITHOUT
  // cleaning up first -- the real directory must already be unaffected.
  const tampered = Buffer.from(readFileSync(join(dir, 'home.png')));
  tampered[0] ^= 255;
  writeFileSync(join(dir, 'home.png'), tampered);
  try {
    const r = spawnSync(process.execPath, [VALIDATOR], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(r.status, 0, 'canonical validation must pass despite the abandoned fixture');
    assert.deepEqual(snapshotDir(CANONICAL), realBefore);
  } finally {
    destroyFixture(root);
  }
});

test('9. fixture cleanup cannot escape its ownership boundary', () => {
  assert.throws(() => destroyFixture(ROOT), /unsafe-fixture-cleanup/);
  assert.throws(() => destroyFixture(join(tmpdir(), 'not-a-fixture')), /unsafe-fixture-cleanup|ENOENT/);
  assert.ok(readdirSync(CANONICAL).length > 0, 'canonical directory must survive refusal');
});

test('config wires the baseline immutability guard into every Playwright run', async () => {
  const cfg = readFileSync(join(ROOT, 'playwright.config.mjs'), 'utf8');
  assert.match(cfg, /globalSetup.*baseline-immutability\.setup\.mjs/);
  // The setup must return the enforcing teardown closure (a configured
  // globalTeardown receives only the config, never setup state).
  const setup = await import('../../tests/baseline-immutability.setup.mjs');
  const returned = await setup.default();
  assert.equal(typeof returned, 'function', 'globalSetup must return the teardown closure');
  await returned();
});

test('guard logic: matching digest passes, drift throws', async () => {
  const setup = await import('../../tests/baseline-immutability.setup.mjs');
  const { checkImmutability: teardown } = await import('../../tests/baseline-immutability.teardown.mjs');
  const digest = setup.digestBaselines();
  await teardown(structuredClone(digest));
  const drifted = structuredClone(digest);
  drifted.digests['home.png'] = '0'.repeat(64);
  assert.throws(() => teardown(drifted), /mutated approved baseline home\.png/);
  // A file appearing after setup == a digest missing it beforehand.
  const added = structuredClone(digest);
  delete added.digests['home.png'];
  assert.throws(() => teardown(added), /unapproved new baseline home\.png/);
  assert.throws(() => teardown(null), /missing pre-run digest/);
});

test('6. real canonical baselines are byte-identical after all fixture tests', () => {
  assert.deepEqual(snapshotDir(CANONICAL), realBefore);
  const r = spawnSync(process.execPath, [VALIDATOR], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, 'normal read-only baseline validation still passes');
});
