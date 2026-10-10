import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createSiteFixture, removeSiteFixture } from '../lib/fixture.mjs';
import { blockHash } from '../../src/content-engine/blocks/blocks.mjs';

const UID = 'home.hero.lead';
const DOMAIN_FILE = join('src', 'locales', 'et', 'home.json');
const BLOCK_FILE = join('src', 'content-engine', 'blocks', 'home.json');

function setup() {
  const root = createSiteFixture();
  const run = (...args) => spawnSync(process.execPath, [resolve(root, 'scripts/i18n.mjs'), ...args], { cwd: root, encoding: 'utf8' });
  const domainPath = join(root, DOMAIN_FILE);
  const readDoc = () => JSON.parse(readFileSync(domainPath, 'utf8'));
  const writeDoc = (doc) => writeFileSync(domainPath, `${JSON.stringify(doc, null, 2)}\n`);
  const originalText = readDoc().units[UID].text;
  // Rebase to the fixture's CURRENT source hash: the fixture copies the live
  // tree, so a stored hash may predate a legitimate source edit (the unit then
  // correctly reports STALE). These tests need a draft against current source.
  const currentHash = blockHash(JSON.parse(readFileSync(join(root, BLOCK_FILE), 'utf8')).blocks[UID]);
  const setUnit = (patch) => {
    const doc = readDoc();
    doc.units[UID] = { text: originalText, sourceHash: currentHash, status: 'MACHINE_DRAFT', ...patch };
    writeDoc(doc);
  };
  const exportSingle = (status, out) => {
    assert.equal(run('export', '--locale', 'et', '--status', status, '--id', UID, '--out', out).status, 0);
    return JSON.parse(readFileSync(join(root, out), 'utf8'));
  };
  const fillAndWrite = (pkg, out, translation) => {
    pkg.units[0].translation = translation;
    writeFileSync(join(root, out), JSON.stringify(pkg));
  };
  return { root, run, domainPath, readDoc, originalText, setUnit, exportSingle, fillAndWrite };
}

test('provenance 1: no-author draft plus invented author and reviewer is REFUSED, files untouched', () => {
  const f = setup();
  try {
    f.setUnit({});
    const before = readFileSync(f.domainPath, 'utf8');
    assert.ok(!('author' in f.readDoc().units[UID]));
    const pkg = f.exportSingle('machine_draft', 'p1.json');
    f.fillAndWrite(pkg, 'p1.json', f.originalText);
    const r = f.run('import', 'p1.json', '--status', 'REVIEWED', '--author', 'invented-author', '--reviewer', 'reviewer-one');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /\[provenance\]/);
    assert.equal(readFileSync(f.domainPath, 'utf8'), before);
  } finally { removeSiteFixture(f.root); }
});

test('provenance 2: existing author A plus attempted replacement B is REFUSED, files untouched', () => {
  const f = setup();
  try {
    f.setUnit({ author: 'author-A' });
    const before = readFileSync(f.domainPath, 'utf8');
    const pkg = f.exportSingle('machine_draft', 'p2.json');
    f.fillAndWrite(pkg, 'p2.json', f.originalText);
    const r = f.run('import', 'p2.json', '--status', 'REVIEWED', '--author', 'author-B', '--reviewer', 'reviewer-one');
    assert.notEqual(r.status, 0);
    assert.match(r.stderr + r.stdout, /\[provenance\]/);
    assert.equal(readFileSync(f.domainPath, 'utf8'), before);
  } finally { removeSiteFixture(f.root); }
});

test('provenance 3: newly authored draft enters as MACHINE_DRAFT with recorded authorship', () => {
  const f = setup();
  try {
    const doc = f.readDoc();
    delete doc.units[UID];
    writeFileSync(f.domainPath, `${JSON.stringify(doc, null, 2)}\n`);
    const pkg = f.exportSingle('missing', 'p3.json');
    assert.equal(pkg.units.length, 1);
    f.fillAndWrite(pkg, 'p3.json', f.originalText);
    assert.equal(f.run('import', 'p3.json', '--status', 'MACHINE_DRAFT', '--author', 'new-author').status, 0);
    const unit = f.readDoc().units[UID];
    assert.equal(unit.status, 'MACHINE_DRAFT');
    assert.equal(unit.author, 'new-author');
    assert.equal(unit.text, f.originalText);
  } finally { removeSiteFixture(f.root); }
});

test('provenance 4: authored draft passes independent review, self-review still fails', () => {
  const f = setup();
  try {
    f.setUnit({ author: 'author-A' });
    const pkg = f.exportSingle('machine_draft', 'p4.json');
    f.fillAndWrite(pkg, 'p4.json', f.originalText);
    assert.notEqual(f.run('import', 'p4.json', '--status', 'REVIEWED', '--author', 'author-A', '--reviewer', 'author-A').status, 0);
    assert.equal(f.run('import', 'p4.json', '--status', 'REVIEWED', '--author', 'author-A', '--reviewer', 'reviewer-one').status, 0);
    const unit = f.readDoc().units[UID];
    assert.equal(unit.status, 'REVIEWED');
    assert.equal(unit.author, 'author-A');
    assert.equal(unit.reviewer, 'reviewer-one');
  } finally { removeSiteFixture(f.root); }
});

test('provenance 5: identical repeated import changes nothing', () => {
  const f = setup();
  try {
    f.setUnit({ author: 'author-A' });
    const pkg = f.exportSingle('machine_draft', 'p5.json');
    f.fillAndWrite(pkg, 'p5.json', f.originalText);
    assert.equal(f.run('import', 'p5.json', '--status', 'REVIEWED', '--author', 'author-A', '--reviewer', 'reviewer-one').status, 0);
    const before = readFileSync(f.domainPath, 'utf8');
    assert.equal(f.run('import', 'p5.json', '--status', 'REVIEWED', '--author', 'author-A', '--reviewer', 'reviewer-one').status, 0);
    assert.equal(readFileSync(f.domainPath, 'utf8'), before);
  } finally { removeSiteFixture(f.root); }
});

test('provenance 7: existing no-author draft plus genuinely new text records new authorship as MACHINE_DRAFT', () => {
  const f = setup();
  try {
    f.setUnit({});
    const pkg = f.exportSingle('machine_draft', 'p7.json');
    f.fillAndWrite(pkg, 'p7.json', `${f.originalText} Täiendus.`);
    assert.equal(f.run('import', 'p7.json', '--status', 'MACHINE_DRAFT', '--author', 'fresh-author').status, 0);
    const unit = f.readDoc().units[UID];
    assert.equal(unit.status, 'MACHINE_DRAFT');
    assert.equal(unit.author, 'fresh-author');
  } finally { removeSiteFixture(f.root); }
});

test('provenance 6: MACHINE_DRAFT re-import preserves genuine authorship instead of wiping it', () => {
  const f = setup();
  try {
    f.setUnit({ author: 'author-A', reviewer: 'reviewer-one', status: 'REVIEWED' });
    const before = readFileSync(f.domainPath, 'utf8');
    const pkg = f.exportSingle('reviewed', 'p6.json');
    f.fillAndWrite(pkg, 'p6.json', f.originalText);
    assert.equal(f.run('import', 'p6.json', '--status', 'MACHINE_DRAFT').status, 0);
    const unit = f.readDoc().units[UID];
    assert.equal(unit.author, 'author-A');
    assert.equal(unit.reviewer, 'reviewer-one');
    assert.equal(unit.status, 'MACHINE_DRAFT');
    assert.notEqual(readFileSync(f.domainPath, 'utf8'), before);
  } finally { removeSiteFixture(f.root); }
});
