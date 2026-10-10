/**
 * Translation safety controls: fixture-controlled states, never live
 * translation state.
 *
 * Earlier versions of one test asserted no live ET unit is CURRENT --
 * that rejects legitimate future progress when reviewed translations
 * land. The invariant is narrower: a MISSING unit cannot be CURRENT,
 * hashes alone invent no approval, review must be independent, refresh
 * cannot promote, and unpublished stays unpublished. Every state here
 * is built inside a disposable fixture (full copy, never the live
 * tree); the live tree is only read for bytes and policy flags.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSiteFixture, removeSiteFixture } from '../lib/fixture.mjs';
import { loadEngine } from '../../src/content-engine/engine.mjs';
import { unitReport } from '../../src/content-engine/i18n/store.mjs';
import { unitStatus } from '../../src/content-engine/i18n/i18n.mjs';
import { independentReview } from '../../src/content-engine/i18n/readiness.mjs';
import { localeReadiness } from '../../src/content-engine/i18n/readiness.mjs';
import { loadCoverage } from '../../src/content-engine/i18n/engine-ext.mjs';
import { refreshManifests } from '../../src/content-engine/operations/manifests.mjs';
import { blockHash } from '../../src/content-engine/blocks/blocks.mjs';

const UID = 'home.hero.lead';
const ET_HOME = join('src', 'locales', 'et', 'home.json');
const BLOCK_FILE = join('src', 'content-engine', 'blocks', 'home.json');

const run = (root, ...args) => spawnSync(process.execPath, [resolve(root, 'scripts/i18n.mjs'), ...args], { cwd: root, encoding: 'utf8' });

/** Fixture with UID rebased to a no-author MACHINE_DRAFT against current source. */
function draftFixture() {
  const root = createSiteFixture();
  const blocks = JSON.parse(readFileSync(join(root, BLOCK_FILE), 'utf8'));
  const ep = join(root, ET_HOME);
  const et = JSON.parse(readFileSync(ep, 'utf8'));
  const text = et.units[UID].text;
  et.units[UID] = { text, sourceHash: blockHash(blocks.blocks[UID]), status: 'MACHINE_DRAFT' };
  writeFileSync(ep, JSON.stringify(et));
  return { root, text };
}

function exportSingle(root, status, out) {
  const r = run(root, 'export', '--locale', 'et', '--status', status, '--id', UID, '--out', out);
  assert.equal(r.status, 0, `export must succeed: ${r.stderr}`);
  return JSON.parse(readFileSync(join(root, out), 'utf8'));
}

test('1-3. status truth table: MISSING, STALE, and valid CURRENT', () => {
  assert.equal(unitStatus(undefined, 'abc123'), 'MISSING');
  assert.equal(unitStatus(null, 'abc123'), 'MISSING');
  assert.equal(unitStatus({ sourceHash: '0'.repeat(16), status: 'CURRENT' }, 'abc123'), 'STALE');
  assert.equal(unitStatus({ sourceHash: 'abc123', status: 'CURRENT' }, 'abc123'), 'CURRENT');
  assert.equal(unitStatus({ sourceHash: 'abc123', status: 'MACHINE_DRAFT' }, 'abc123'), 'MACHINE_DRAFT');
  assert.equal(unitStatus({ sourceHash: 'abc123', status: 'CURRENT' }, undefined), 'ORPHANED');
});

test('4. a current hash plus invented authorship cannot promote to REVIEWED', () => {
  const { root, text } = draftFixture();
  try {
    const pkg = exportSingle(root, 'machine_draft', 'p4.json');
    pkg.units[0].translation = text;
    writeFileSync(join(root, 'p4.json'), JSON.stringify(pkg));
    const r = run(root, 'import', 'p4.json', '--status', 'REVIEWED', '--author', 'ghost-author', '--reviewer', 'ghost-reviewer');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /provenance/);
    const after = JSON.parse(readFileSync(join(root, ET_HOME), 'utf8'));
    assert.equal(after.units[UID].status, 'MACHINE_DRAFT', 'refusal writes nothing');
  } finally { removeSiteFixture(root); }
});

test('5. a drifted source hash is refused as source-moved', () => {
  const { root, text } = draftFixture();
  try {
    const pkg = exportSingle(root, 'machine_draft', 'p5.json');
    pkg.units[0].translation = text;
    pkg.units[0].sourceHash = 'f'.repeat(16);
    writeFileSync(join(root, 'p5.json'), JSON.stringify(pkg));
    const r = run(root, 'import', 'p5.json', '--status', 'MACHINE_DRAFT', '--author', 'ghost-author');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /source-moved/);
  } finally { removeSiteFixture(root); }
});

test('6-7. self-review and reviewer-without-author are refused up front', () => {
  const { root, text } = draftFixture();
  try {
    const pkg = exportSingle(root, 'machine_draft', 'p67.json');
    pkg.units[0].translation = text;
    writeFileSync(join(root, 'p67.json'), JSON.stringify(pkg));
    assert.equal(independentReview({ author: 'solo', reviewer: 'solo' }), false);
    assert.equal(independentReview({ author: 'solo' }), false);
    assert.equal(independentReview({ author: 'a', reviewer: 'b' }), true);
    const same = run(root, 'import', 'p67.json', '--status', 'REVIEWED', '--author', 'solo', '--reviewer', 'solo');
    assert.notEqual(same.status, 0);
    assert.match(same.stderr + same.stdout, /different --reviewer/);
    const noReviewer = run(root, 'import', 'p67.json', '--status', 'REVIEWED', '--author', 'solo');
    assert.notEqual(noReviewer.status, 0);
    assert.match(noReviewer.stderr + noReviewer.stdout, /--reviewer/);
  } finally { removeSiteFixture(root); }
});

test('8. forged author replacement is refused', () => {
  const { root, text } = draftFixture();
  try {
    const ep = join(root, ET_HOME);
    const et = JSON.parse(readFileSync(ep, 'utf8'));
    et.units[UID] = { ...et.units[UID], author: 'real-author' };
    writeFileSync(ep, JSON.stringify(et));
    const pkg = exportSingle(root, 'machine_draft', 'p8.json');
    pkg.units[0].translation = text;
    writeFileSync(join(root, 'p8.json'), JSON.stringify(pkg));
    const r = run(root, 'import', 'p8.json', '--status', 'MACHINE_DRAFT', '--author', 'impostor');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /provenance/);
    const after = JSON.parse(readFileSync(ep, 'utf8'));
    assert.equal(after.units[UID].author, 'real-author', 'stored authorship survives refusal');
  } finally { removeSiteFixture(root); }
});

test('E2. fixture rebasing never touches the real locale file', () => {
  const realBefore = readFileSync(ET_HOME, 'utf8');
  const { root } = draftFixture();
  removeSiteFixture(root);
  assert.equal(readFileSync(ET_HOME, 'utf8'), realBefore);
});

test('E7. a source edit stales exactly the affected unit', () => {
  const root = createSiteFixture();
  try {
    const bp = join(root, BLOCK_FILE);
    const blocks = JSON.parse(readFileSync(bp, 'utf8'));
    const ep = join(root, ET_HOME);
    const et = JSON.parse(readFileSync(ep, 'utf8'));
    for (const [id, u] of Object.entries(et.units)) {
      if (blocks.blocks[id]) u.sourceHash = blockHash(blocks.blocks[id]);
    }
    writeFileSync(ep, JSON.stringify(et));
    const staleBefore = unitReport(loadEngine({ root }).store)
      .filter((r) => r.locale === 'et' && r.status === 'STALE')
      .map((r) => r.id)
      .sort();
    blocks.blocks[UID].text += ' (fixture edit)';
    writeFileSync(bp, JSON.stringify(blocks));
    const stale = unitReport(loadEngine({ root }).store)
      .filter((r) => r.locale === 'et' && r.status === 'STALE')
      .map((r) => r.id)
      .sort();
    assert.deepEqual(stale, [...staleBefore, UID].sort());
    assert.ok(!staleBefore.includes(UID), 'edited unit was current before the edit');
  } finally { removeSiteFixture(root); }
});

test('E8. refreshManifests never approves translations or rewrites authorship', () => {
  const root = createSiteFixture();
  try {
    const snap = (store) => unitReport(store)
      .filter((r) => r.locale === 'et')
      .map((r) => [r.id, r.status, r.unit?.author ?? null, r.unit?.reviewer ?? null, r.unit?.sourceHash ?? null]);
    const before = snap(loadEngine({ root }).store);
    refreshManifests(() => loadEngine({ root }), {}, root);
    assert.deepEqual(snap(loadEngine({ root }).store), before);
  } finally { removeSiteFixture(root); }
});

/** Rebase every et block+segment unit in the fixture to MACHINE_DRAFT at current hashes. */
function draftEverything(root) {
  const e = loadEngine({ root });
  const etDir = join(root, 'src', 'locales', 'et');
  for (const f of readdirSync(etDir).filter((x) => x.endsWith('.json'))) {
    const domain = f.slice(0, -5);
    let blocks;
    try { blocks = JSON.parse(readFileSync(join(root, 'src', 'content-engine', 'blocks', `${domain}.json`), 'utf8')).blocks; } catch { continue; }
    const p = join(etDir, f);
    const doc = JSON.parse(readFileSync(p, 'utf8'));
    for (const [id, u] of Object.entries(doc.units ?? {})) {
      if (blocks[id]) doc.units[id] = { text: u.text, sourceHash: blockHash(blocks[id]), status: 'MACHINE_DRAFT' };
    }
    writeFileSync(p, JSON.stringify(doc));
  }
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) { walk(p, `${prefix}${entry.name}/`); continue; }
      if (!entry.name.endsWith('.json')) continue;
      const doc = e.store.docs[`${prefix}${entry.name.slice(0, -5)}`];
      if (!doc) continue;
      const prev = JSON.parse(readFileSync(p, 'utf8'));
      for (const [id, u] of Object.entries(prev.units ?? {})) {
        const seg = doc.segmentsById?.[id];
        if (seg) prev.units[id] = { text: u.text, sourceHash: seg.hash, status: 'MACHINE_DRAFT' };
      }
      writeFileSync(p, JSON.stringify(prev));
    }
  };
  walk(join(etDir, 'docs'), '');
  // Units absent from the files report MISSING: draft them too (fixture-only
  // synthetic text; status math needs hashes, never prose quality).
  const e2 = loadEngine({ root });
  for (const r of unitReport(e2.store).filter((x) => x.locale === 'et' && x.status === 'MISSING')) {
    if (r.kind === 'block') {
      const b = e2.store.blocks[r.id];
      if (!b) continue;
      const p = join(etDir, `${b.domain}.json`);
      const doc = JSON.parse(readFileSync(p, 'utf8'));
      doc.units[r.id] = { text: 'fixture draft', sourceHash: blockHash(b), status: 'MACHINE_DRAFT' };
      writeFileSync(p, JSON.stringify(doc));
    } else {
      const seg = e2.store.docs[r.document]?.segmentsById?.[r.id];
      if (!seg) continue;
      const p = join(etDir, 'docs', `${r.document}.json`);
      const prev = JSON.parse(readFileSync(p, 'utf8'));
      prev.units[r.id] = { text: 'fixture draft', sourceHash: seg.hash, status: 'MACHINE_DRAFT' };
      writeFileSync(p, JSON.stringify(prev));
    }
  }
}

test('11-12. fully drafted yet unpublished stays unpublished; incomplete cannot qualify', () => {
  const root = createSiteFixture();
  try {
    draftEverything(root);
    const coverage = loadCoverage();
    const full = unitReport(loadEngine({ root }).store).filter((r) => r.locale === 'et');
    assert.ok(!full.some((r) => r.status === 'MISSING' || r.status === 'STALE'), 'fixture must be fully drafted');
    const ready = localeReadiness(loadEngine({ root }).store, coverage, 'et', full);
    assert.equal(ready.publicationCompletion, 0, 'drafts are not approvals');
    assert.equal(ready.productionReady, false, 'fully drafted but unpublished stays unpublished');
    const ep = join(root, ET_HOME);
    const et = JSON.parse(readFileSync(ep, 'utf8'));
    delete et.units[UID];
    writeFileSync(ep, JSON.stringify(et));
    const partial = unitReport(loadEngine({ root }).store).filter((r) => r.locale === 'et');
    assert.ok(partial.some((r) => r.id === UID && r.status === 'MISSING'));
    assert.equal(localeReadiness(loadEngine({ root }).store, coverage, 'et', partial).productionReady, false);
  } finally { removeSiteFixture(root); }
});

test('13. enablement requires the validation gate: enable et is refused, flags untouched', () => {
  const root = createSiteFixture();
  try {
    const localesPath = join(root, 'src', 'content-engine', 'i18n', 'locales.json');
    let doc;
    try { doc = JSON.parse(readFileSync(localesPath, 'utf8')); } catch { doc = null; }
    const before = doc ? readFileSync(localesPath, 'utf8') : null;
    const r = run(root, 'enable', 'et');
    assert.notEqual(r.status, 0, 'incomplete locale must not enable');
    if (before !== null) assert.equal(readFileSync(localesPath, 'utf8'), before, 'refusal writes nothing');
    void doc;
  } finally { removeSiteFixture(root); }
});

test('14. live ET/RU publication flags remain disabled and production-unready', () => {
  const e = loadEngine();
  const coverage = loadCoverage();
  const all = unitReport(e.store);
  for (const l of e.store.localesDoc.locales.filter((x) => x.id === 'et' || x.id === 'ru')) {
    assert.equal(l.enabled, false, `${l.id} must stay disabled`);
    assert.equal(localeReadiness(e.store, coverage, l.id, all).productionReady, false);
  }
});
