/**
 * Stage D negative controls: doctor compatibility-view integrity.
 *
 * inspectStore() used to check only that current/index.html exists. A
 * stale or corrupted view passed as healthy. These controls build
 * disposable fixture stores and prove the doctor hashes each view against
 * its authoritative pointer, distinguishes cache corruption from
 * generation corruption, stays read-only, and repairs only from verified
 * generations -- never the reverse.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectStore, repairStores, diagnose } from '../release-doctor.mjs';

const ORIGIN = 'https://doctor-fixture.example';

function writeTree(dir, entries) {
  for (const [rel, content] of Object.entries(entries)) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
}

function shaOfFiles(files) {
  const names = Object.keys(files).sort();
  const digest = createHash('sha256');
  for (const rel of names) digest.update(`${rel} ${createHash('sha256').update(files[rel]).digest('hex')}\n`);
  return digest.digest('hex');
}

let root;
let store;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'sai-doc-'));
  store = join(root, '.site-work', 'release', 'candidates', 'fixture');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A healthy two-generation store; returns { genA, genB, shaA, shaB }. */
function healthyStore() {
  const filesA = { 'index.html': 'generation A', 'about/index.html': 'a-about' };
  const filesB = { 'index.html': 'generation B', 'about/index.html': 'b-about' };
  const shaA = shaOfFiles(filesA);
  const shaB = shaOfFiles(filesB);
  const tree = { 'current.json': JSON.stringify({ generation: 'g-aaa', sha256: shaB, origin: ORIGIN }) };
  for (const [rel, c] of Object.entries(filesB)) tree[`generations/g-aaa/${rel}`] = c;
  for (const [rel, c] of Object.entries(filesA)) tree[`generations/g-old/${rel}`] = c;
  for (const [rel, c] of Object.entries(filesB)) tree[`current/${rel}`] = c;
  tree['previous.json'] = JSON.stringify({ generation: 'g-old', sha256: shaA, origin: ORIGIN });
  for (const [rel, c] of Object.entries(filesA)) tree[`previous/${rel}`] = c;
  writeTree(store, tree);
  return { shaA, shaB };
}

function findingIds(inspection) {
  return inspection.findings.map((f) => f.id);
}

describe('inspectStore view integrity', () => {
  it('1. healthy generations with matching views: STORE_HEALTHY, both VIEW_CURRENT', () => {
    healthyStore();
    const s = inspectStore(store);
    assert.equal(s.healthy, true);
    assert.equal(s.storeStatus, 'STORE_HEALTHY');
    assert.deepEqual(s.views, { current: 'VIEW_CURRENT', previous: 'VIEW_CURRENT' });
    assert.equal(s.generationHealth['g-aaa'], 'GENERATION_HEALTHY');
  });

  it('2. healthy generation with a stale current view: STORE_DEGRADED, generation intact', () => {
    const { shaA } = healthyStore();
    // current/ holds the PREVIOUS generation's bytes: stale, not corrupt.
    rmSync(join(store, 'current'), { recursive: true, force: true });
    mkdirSync(join(store, 'current', 'about'), { recursive: true });
    writeFileSync(join(store, 'current', 'index.html'), 'generation A');
    writeFileSync(join(store, 'current', 'about', 'index.html'), 'a-about');
    const s = inspectStore(store);
    assert.equal(s.healthy, false);
    assert.equal(s.storeStatus, 'STORE_DEGRADED');
    assert.equal(s.views.current, 'VIEW_STALE');
    assert.ok(findingIds(s).includes('view.stale-current'));
    assert.equal(s.generationHealth['g-aaa'], 'GENERATION_HEALTHY', 'stale view must not invalidate the generation');
    void shaA;
  });

  it('3. healthy generation with a corrupted previous view is an error', () => {
    healthyStore();
    writeFileSync(join(store, 'previous', 'index.html'), 'garbage bytes from nowhere');
    const s = inspectStore(store);
    assert.equal(s.healthy, false);
    assert.equal(s.views.previous, 'VIEW_CORRUPT');
    assert.ok(findingIds(s).includes('view.corrupt-previous'));
  });

  it('4. missing current view is a warning with a repair hint, not silent health', () => {
    healthyStore();
    rmSync(join(store, 'current'), { recursive: true, force: true });
    const s = inspectStore(store);
    assert.equal(s.views.current, 'VIEW_MISSING');
    assert.ok(findingIds(s).includes('view.missing-current'));
  });

  it('5. missing immutable generation: generation error, view unverifiable', () => {
    healthyStore();
    rmSync(join(store, 'generations', 'g-aaa'), { recursive: true, force: true });
    const s = inspectStore(store);
    assert.equal(s.healthy, false);
    assert.equal(s.views.current, 'VIEW_UNVERIFIABLE');
    assert.ok(findingIds(s).some((id) => id.startsWith('view.unverifiable-')));
  });

  it('6. corrupt current generation is GENERATION_CORRUPT, never restored from the view', async () => {
    healthyStore();
    writeFileSync(join(store, 'generations', 'g-aaa', 'index.html'), 'tampered generation bytes');
    const before = readFileSync(join(store, 'current', 'index.html'), 'utf8');
    const s = inspectStore(store);
    assert.equal(s.generationHealth['g-aaa'], 'GENERATION_CORRUPT');
    assert.ok(findingIds(s).includes('generation.digest-mismatch'));
    const r = await repairStores(root);
    assert.equal(r.ok, false);
    assert.match(r.refused, /never rebuild a generation from a view/);
    assert.equal(readFileSync(join(store, 'current', 'index.html'), 'utf8'), before);
    assert.equal(readFileSync(join(store, 'generations', 'g-aaa', 'index.html'), 'utf8'), 'tampered generation bytes');
  });

  it('7. corrupt previous generation refuses even partial repair', async () => {
    healthyStore();
    writeFileSync(join(store, 'generations', 'g-old', 'index.html'), 'tampered');
    const r = await repairStores(root);
    assert.equal(r.ok, false);
    assert.match(r.refused, /previous generation .* unverifiable/);
  });

  it('8. missing pointer: NO_COMMITTED_CANDIDATE, never healthy-by-default', () => {
    writeTree(store, { 'generations/g-aaa/index.html': 'orphan bytes' });
    const s = inspectStore(store);
    assert.equal(s.views.current, 'NO_COMMITTED_CANDIDATE');
    assert.ok(findingIds(s).includes('pointer.current-missing'));
  });

  it('9. corrupt pointer refuses repair without inventing provenance', async () => {
    writeTree(store, {
      'current.json': '{ not json',
      'current/index.html': 'view bytes',
      'generations/g-aaa/index.html': 'generation bytes',
    });
    const s = inspectStore(store);
    assert.ok(findingIds(s).includes('pointer.current-corrupt'));
    const r = await repairStores(root);
    assert.equal(r.ok, false);
    assert.match(r.refused, /corrupt or incomplete/);
    assert.ok(!existsSync(join(store, 'previous', 'index.html')), 'repair invents nothing');
  });

  it('10. interrupted promotion (pending next/) leaves the committed generation selected', () => {
    const { shaB } = healthyStore();
    writeTree(store, { 'next/index.html': 'uncommitted staging' });
    const s = inspectStore(store);
    assert.ok(findingIds(s).includes('promotion.pending'));
    assert.equal(s.current.sha256, shaB);
    assert.equal(s.views.current, 'VIEW_CURRENT');
  });

  it('14. inspectStore is read-only: bytes and findings stable across runs', () => {
    healthyStore();
    const snapshot = (dir) => JSON.stringify(inspectStore(dir).findings);
    const before = snapshot(store);
    const indexBefore = readFileSync(join(store, 'current', 'index.html'), 'utf8');
    assert.equal(snapshot(store), before);
    assert.equal(readFileSync(join(store, 'current', 'index.html'), 'utf8'), indexBefore);
  });
});

describe('repairStores', () => {
  it('11. repair of verified views is a no-op success (idempotent)', async () => {
    healthyStore();
    const first = await repairStores(root);
    assert.equal(first.ok, true);
    assert.deepEqual(first.stores.map((s) => [s.current.status, s.previous.status]), [['ok', 'ok']]);
    const s = inspectStore(store);
    assert.deepEqual(s.views, { current: 'VIEW_CURRENT', previous: 'VIEW_CURRENT' });
  });

  it('12. stale view repair converges: repair, re-inspect HEALTHY, repeat stable', async () => {
    healthyStore();
    // Whole-view rollback to the previous generation's bytes: stale, not corrupt.
    rmSync(join(store, 'current'), { recursive: true, force: true });
    mkdirSync(join(store, 'current', 'about'), { recursive: true });
    writeFileSync(join(store, 'current', 'index.html'), 'generation A');
    writeFileSync(join(store, 'current', 'about', 'index.html'), 'a-about');
    assert.equal(inspectStore(store).views.current, 'VIEW_STALE');
    const r = await repairStores(root);
    assert.equal(r.ok, true);
    const after = inspectStore(store);
    assert.equal(after.healthy, true);
    assert.deepEqual(after.views, { current: 'VIEW_CURRENT', previous: 'VIEW_CURRENT' });
    const again = await repairStores(root);
    assert.equal(again.ok, true, 'repeated repair is idempotent');
  });

  it('13. repair refuses when the generation digest cannot be verified', async () => {
    const { shaB } = healthyStore();
    writeTree(store, { 'current.json': JSON.stringify({ generation: 'g-aaa', sha256: 'dead'.padEnd(64, '0'), origin: ORIGIN }) });
    const r = await repairStores(root);
    assert.equal(r.ok, false);
    assert.match(r.refused, /missing or digest-mismatched/);
    void shaB;
  });

  it('unknown store names and traversal are refused', async () => {
    healthyStore();
    for (const name of ['nope', '..', 'a/b', 'a\\\\b']) {
      const r = await repairStores(root, name);
      assert.equal(r.ok, false, name);
      assert.match(r.refused, /unknown store/);
    }
  });

  it('origin conflict between pointers refuses automatic repair', async () => {
    healthyStore();
    writeTree(store, { 'previous.json': JSON.stringify({ generation: 'g-old', sha256: inspectStore(store).previous.sha256, origin: 'https://other.example' }) });
    const r = await repairStores(root);
    assert.equal(r.ok, false);
    assert.match(r.refused, /origin conflict/);
  });

  it('a lock held on another root never decides this root', async () => {
    healthyStore();
    const other = mkdtempSync(join(tmpdir(), 'sai-doc-other-'));
    try {
      writeTree(other, { '.site-work/release/factory.lock/owner.json': JSON.stringify({ pid: process.pid, command: 'other-root', at: new Date().toISOString() }) });
      assert.equal(diagnose(other).lock.state, 'held', 'the lock inside the inspected root is what counts');
      const r = await repairStores(root);
      assert.equal(r.ok, true, 'a lock held elsewhere must not refuse this root');
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('a lock held in this root still refuses repair here', async () => {
    healthyStore();
    writeTree(root, { '.site-work/release/factory.lock/owner.json': JSON.stringify({ pid: process.pid, command: 'this-root', at: new Date().toISOString() }) });
    const r = await repairStores(root);
    assert.equal(r.ok, false, 'root isolation must not widen what a lock protects');
    assert.match(r.refused, /factory lock is held/);
  });

  it('an abandoned lock stays detectable and still tolerates view repair', async () => {
    healthyStore();
    const ghost = spawnSync(process.execPath, ['-e', ''], { timeout: 30000 });
    writeTree(root, { '.site-work/release/factory.lock/owner.json': JSON.stringify({ pid: ghost.pid, command: 'dead-owner', at: '2020-01-01T00:00:00.000Z' }) });
    assert.equal(diagnose(root).lock.state, 'abandoned');
    const r = await repairStores(root);
    assert.equal(r.ok, true, 'a dead owner never blocks a view-only repair');
    assert.equal(diagnose(root).lock.state, 'abandoned', 'repair never removes a foreign lock');
  });

  it('a lock with no readable owner grants nothing', async () => {
    healthyStore();
    writeTree(root, { '.site-work/release/factory.lock/owner.json': 'not json' });
    const state = diagnose(root).lock.state;
    assert.equal(state === 'unreadable' || state === 'absent', true, 'an unreadable lock is never permission to proceed');
    const r = await repairStores(root);
    if (state === 'unreadable') {
      assert.equal(r.ok, false, 'an uncertain lock refuses repair, it does not authorize it');
      assert.match(r.refused, /factory lock is unreadable/);
    }
  });
});
