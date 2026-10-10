/**
 * Stage A negative controls: identity-based skip accounting.
 *
 * The old gate matched an allowlisted reason TEXT, so a foreign test
 * borrowing the approved reason passed silently. The policy now requires
 * the suite file + exact test name + exact reason, and the report must
 * carry the full machine footer with consistent arithmetic.
 *
 * Every control below exercises refuseEngineSuite()/accountEngineTap() --
 * the exact decision path runEngineGate() calls per suite file -- or the
 * discovery paths runEngineGate()/resolveEngineSuites() take without
 * executing anything. All rejections are demonstrated, not described.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accountEngineTap,
  refuseEngineSuite,
  resolveEngineSuites,
  runEngineGate,
  ENGINE_SKIP_POLICY,
  ENGINE_SUITE_FILES,
} from '../release-candidate.mjs';

const POLICY = ENGINE_SKIP_POLICY[0];
const FILE = POLICY.file;
const TEST = POLICY.test;
const REASON = POLICY.reason;

const footer = (t) => [
  '# tests 2',
  `# pass ${t.pass ?? 2}`,
  `# fail ${t.fail ?? 0}`,
  `# cancelled ${t.cancelled ?? 0}`,
  `# skipped ${t.skipped ?? 0}`,
  `# todo ${t.todo ?? 0}`,
].join('\n');

const PASS_SUITE = `TAP version 13\nok 1 - first passes\nok 2 - second passes\n1..2\n${footer({})}\n`;

const allowlistedLine = (name, reason) => `ok 1 - ${name} # SKIP ${reason}`;

describe('accountEngineTap identity parsing', () => {
  it('1. fully passing suite: complete, consistent, no unknown skips', () => {
    const a = accountEngineTap(PASS_SUITE, { file: FILE });
    assert.equal(a.complete, true);
    assert.equal(a.consistent, true);
    assert.equal(a.total, 2);
    assert.equal(refuseEngineSuite(a), null);
  });

  it('5. unknown skipped test is rejected', () => {
    const out = `TAP version 13\nok 1 - first passes\n${allowlistedLine('some mandatory test', 'no reason given')}\n1..2\n${footer({ pass: 1, skipped: 1 })}\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.skips.length, 1);
    assert.equal(a.skips[0].name, 'some mandatory test');
    assert.equal(a.unknownSkips.length, 1);
    assert.match(refuseEngineSuite(a), /skipped with no policy cover/);
  });

  it('6. known test with the WRONG reason is rejected', () => {
    const out = `TAP version 13\nok 1 - first passes\n${allowlistedLine(TEST, 'a reworded excuse')}\n1..2\n${footer({ pass: 1, skipped: 1 })}\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.unknownSkips.length, 1);
    assert.match(refuseEngineSuite(a), /skipped with no policy cover/);
  });

  it('7. UNKNOWN test borrowing the allowlisted reason is rejected (the A1 defect)', () => {
    const out = `TAP version 13\nok 1 - first passes\n${allowlistedLine('unrelated critical security test', REASON)}\n1..2\n${footer({ pass: 1, skipped: 1 })}\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.skips.length, 1);
    assert.equal(a.unknownSkips.length, 1);
    assert.match(refuseEngineSuite(a), /unrelated critical security test/);
  });

  it('7b. policy test+reason in the WRONG file is rejected', () => {
    const out = `TAP version 13\nok 1 - first passes\n${allowlistedLine(TEST, REASON)}\n1..2\n${footer({ pass: 1, skipped: 1 })}\n`;
    const a = accountEngineTap(out, { file: 'scripts/tests/release-smoke.test.mjs' });
    assert.equal(a.unknownSkips.length, 1);
    assert.notEqual(refuseEngineSuite(a), null);
  });

  it('8. known test with the approved limitation in its own file is tolerated', () => {
    const out = `TAP version 13\nok 1 - guards unsafe link creation\n${allowlistedLine(TEST, REASON)}\n1..2\n${footer({ pass: 1, skipped: 1 })}\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.complete, true);
    assert.equal(a.consistent, true);
    assert.deepEqual(a.unknownSkips, []);
    assert.equal(refuseEngineSuite(a), null);
  });

  it('2. failed mandatory test is rejected', () => {
    const out = `TAP version 13\nnot ok 1 - something broke\nok 2 - second passes\n1..2\n${footer({ pass: 1, fail: 1 })}\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.fail, 1);
    assert.match(refuseEngineSuite(a), /1 mandatory test\(s\) failed/);
  });

  it('14. cancelled test is rejected even when totals are consistent', () => {
    const out = `TAP version 13\nok 1 - first passes\nnot ok 2 - never ran\n1..2\n${footer({ pass: 1, cancelled: 1 })}\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.complete, true);
    assert.equal(a.consistent, true);
    assert.match(refuseEngineSuite(a), /cancelled before asserting/);
  });

  it('4. zero discovered tests are rejected', () => {
    const out = `TAP version 13\n1..0\n${footer({ pass: 0 }).replace('# tests 2', '# tests 0')}\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.complete, true);
    assert.equal(a.consistent, true);
    assert.equal(a.total, 0);
    assert.match(refuseEngineSuite(a), /zero tests discovered/);
  });

  it('9. contradictory footer counts are rejected', () => {
    const out = `TAP version 13\nok 1 - first passes\nok 2 - second passes\n1..2\n# tests 10\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.complete, true);
    assert.equal(a.consistent, false);
    assert.match(refuseEngineSuite(a), /contradictory footer counts/);
  });

  it('10. missing pass/fail totals are rejected (bare "# tests N" is NOT complete)', () => {
    const a = accountEngineTap('TAP version 13\nok 1 - x\n1..1\n# tests 10\n', { file: FILE });
    assert.equal(a.complete, false);
    assert.deepEqual(a.missingFields.sort(), ['cancelled', 'fail', 'pass', 'skipped', 'todo']);
    assert.match(refuseEngineSuite(a), /incomplete or truncated/);
  });

  it('11. truncated output with no footer is rejected', () => {
    const a = accountEngineTap('TAP version 13\nok 1 - first passes\nok 2 - output cut off here\n', { file: FILE });
    assert.equal(a.complete, false);
    assert.notEqual(refuseEngineSuite(a), null);
  });

  it('genuine captured TAP (render.test.mjs) parses complete and consistent', () => {
    const out = [
      'TAP version 13',
      '# Subtest: add/edit/reorder/remove renders, updates discovery, leaves unrelated output byte-stable and rolls back',
      'ok 1 - add/edit/reorder/remove renders, updates discovery, leaves unrelated output byte-stable and rolls back',
      '  ---',
      '  duration_ms: 30672.9725',
      "  type: 'test'",
      '  ...',
      '1..1',
      '# tests 1',
      '# suites 0',
      '# pass 1',
      '# fail 0',
      '# cancelled 0',
      '# skipped 0',
      '# todo 0',
      '# duration_ms 31198.9029',
      '',
    ].join('\n');
    const a = accountEngineTap(out, { file: 'scripts/tests/render.test.mjs' });
    assert.equal(a.complete, true);
    assert.equal(a.consistent, true);
    assert.equal(refuseEngineSuite(a), null);
  });

  it('A1-footer-only. TAP footer with zero test-result records is rejected (Defect 2)', () => {
    const out = [
      'TAP version 13',
      '# tests 1',
      '# pass 1',
      '# fail 0',
      '# cancelled 0',
      '# skipped 0',
      '# todo 0',
      '',
    ].join('\n');
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.complete, true);
    assert.equal(a.consistent, true);
    assert.equal(a.discovered, 0);
    assert.match(refuseEngineSuite(a), /do not match footer tests/);
  });

  it('A1-missing. footer count larger than discovered records is rejected', () => {
    const out = `TAP version 13\nok 1 - first passes\nok 2 - second passes\n1..2\n# tests 3\n# pass 3\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.consistent, true);
    assert.equal(a.discovered, 2);
    assert.match(refuseEngineSuite(a), /records \(2\) do not match footer tests \(3\)/);
  });

  it('A1-smaller. footer count smaller than discovered records is rejected', () => {
    const out = `TAP version 13\nok 1 - first passes\nok 2 - second passes\nok 3 - third passes\n1..3\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.consistent, true);
    assert.equal(a.discovered, 3);
    assert.match(refuseEngineSuite(a), /records \(3\) do not match footer tests \(2\)/);
  });

  it('A1-dup. duplicate test-result records are rejected even with a consistent footer', () => {
    const out = `TAP version 13\nok 1 - same probe twice\nok 1 - same probe twice\n1..2\n# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.consistent, true);
    assert.deepEqual(a.duplicates, ['ok 1 - same probe twice']);
    assert.match(refuseEngineSuite(a), /duplicate test-result records/);
  });

  it('A1-suite. top-level suite summaries are not test records', () => {
    const out = [
      'TAP version 13',
      '# Subtest: my suite',
      '    ok 1 - real test one',
      '      ---',
      '      duration_ms: 1.2',
      "      type: 'test'",
      '      ...',
      '    ok 2 - real test two',
      '      ---',
      '      duration_ms: 0.8',
      "      type: 'test'",
      '      ...',
      '    1..2',
      'ok 1 - my suite',
      '  ---',
      '  duration_ms: 5.0',
      "  type: 'suite'",
      '  ...',
      '1..1',
      '# tests 2',
      '# suites 1',
      '# pass 2',
      '# fail 0',
      '# cancelled 0',
      '# skipped 0',
      '# todo 0',
      '',
    ].join('\n');
    const a = accountEngineTap(out, { file: FILE });
    assert.equal(a.discovered, 2);
    assert.deepEqual(a.records, ['real test one', 'real test two']);
    assert.equal(a.recordsMatchFooter, true);
    assert.equal(refuseEngineSuite(a), null);
  });

  it('policy is narrow: one named test in one file with one exact reason', () => {
    assert.equal(ENGINE_SKIP_POLICY.length, 1);
    assert.equal(POLICY.file, 'scripts/tests/release-origin.test.mjs');
    assert.match(POLICY.test, /^S10:/);
    assert.equal(typeof POLICY.capability, 'string');
  });
});

describe('suite discovery and gate refusal paths', () => {
  function fixtureRoot(files) {
    const root = mkdtempSync(join(tmpdir(), 'sai-suites-'));
    mkdirSync(join(root, 'scripts', 'tests'), { recursive: true });
    for (const f of files) writeFileSync(join(root, f), '// fixture suite\n');
    return root;
  }

  it('3. missing mandatory suite file is rejected without executing anything', () => {
    const root = fixtureRoot(['scripts/tests/present.test.mjs']);
    const r = resolveEngineSuites({ root, registry: ['scripts/tests/present.test.mjs', 'scripts/tests/absent.test.mjs'] });
    assert.equal(r.ok, false);
    assert.match(r.error, /missing mandatory engine suite.*absent/);
  });

  it('15. unregistered suite on disk is rejected (suite identity mismatch)', () => {
    const root = fixtureRoot(['scripts/tests/known.test.mjs', 'scripts/tests/surprise.test.mjs']);
    const r = resolveEngineSuites({ root, registry: ['scripts/tests/known.test.mjs'] });
    assert.equal(r.ok, false);
    assert.match(r.error, /unregistered engine suite.*surprise/);
  });

  it('live registry resolves: every registered suite exists on disk', () => {
    const pre = resolveEngineSuites({ includeBuildDependent: false });
    assert.equal(pre.ok, true);
    assert.ok(pre.files.length >= 12);
    assert.ok(!pre.files.some((f) => f.includes('release-public')));
    const post = resolveEngineSuites({ includeBuildDependent: true });
    assert.equal(post.ok, true);
    assert.deepEqual(post.files, ['scripts/tests/release-public.test.mjs']);
    assert.ok(pre.files.every((f) => ENGINE_SUITE_FILES.includes(f)));
  });

  it('12/13. runEngineGate refuses an unregistered file and a missing file before running', () => {
    const unreg = runEngineGate(process.env, ['scripts/tests/surprise.test.mjs']);
    assert.equal(unreg.ok, false);
    assert.match(unreg.tail, /unregistered engine suite/);
    const gone = runEngineGate(process.env, ['scripts/tests/gone.test.mjs'], {
      registry: ['scripts/tests/gone.test.mjs'],
    });
    assert.equal(gone.ok, false);
    assert.match(gone.tail, /test discovery failed/);
  });
});

describe('engine gate: artifact selection is independent of the runner cwd', () => {
  // The fixture suite (not *.test.mjs, so unregistered by construction)
  // asserts from inside the child process that it ran from ROOT and received
  // the selected artifact through SAI_RELEASE_ARTIFACT_DIR.
  const FIXTURE = 'scripts/tests/fixtures/engine-gate-suite.mjs';
  const artifactDirs = [];
  after(() => artifactDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  // A parent node:test process exports NODE_TEST_CONTEXT; inherited by a
  // nested `node --test` it makes the runner refuse recursively and emit no
  // TAP footer. A real factory run has no such marker, so the controls run
  // the gate with the environment a production execution would see.
  function factoryEnv(extra = {}) {
    const env = { ...process.env, ...extra };
    delete env.NODE_TEST_CONTEXT;
    return env;
  }
  function disposableArtifact() {
    const dir = mkdtempSync(join(tmpdir(), 'sai-gate-artifact-'));
    artifactDirs.push(dir);
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>disposable</title>\n');
    writeFileSync(join(dir, 'release.json'), '{"release":true}\n');
    return dir;
  }

  it('a registered suite executes from ROOT with a disposable artifact selected', () => {
    const dir = disposableArtifact();
    const r = runEngineGate(factoryEnv(), [FIXTURE], { registry: [FIXTURE], distDir: dir });
    assert.equal(r.ok, true, r.tail);
    assert.equal(r.accounting.files.length, 1);
    assert.equal(r.accounting.files[0].pass, 2, 'both fixture assertions ran and passed');
    assert.equal(r.accounting.totals.fail, 0);
  });

  it('a missing selected artifact is refused, never silently skipped or reverted', () => {
    const missing = join(tmpdir(), `sai-gate-absent-${Date.now()}`);
    const r = runEngineGate(factoryEnv(), [FIXTURE], { registry: [FIXTURE], distDir: missing });
    assert.equal(r.ok, false);
    assert.match(r.tail, /selected release artifact is missing or not a directory/);
    assert.match(r.tail, /never|refusing to fall back/);
  });

  it('a selected artifact that is a file, not a directory, is refused', () => {
    const dir = disposableArtifact();
    const asFile = join(dir, 'index.html');
    const r = runEngineGate(factoryEnv(), [FIXTURE], { registry: [FIXTURE], distDir: asFile });
    assert.equal(r.ok, false);
    assert.match(r.tail, /selected release artifact is missing or not a directory/);
  });

  it('no artifact selected: the suite still runs from ROOT (env contract absent)', () => {
    const env = factoryEnv();
    delete env.SAI_RELEASE_ARTIFACT_DIR;
    const r = runEngineGate(env, [FIXTURE], { registry: [FIXTURE] });
    // The fixture's second assertion requires the artifact env var, so a run
    // without a selection must genuinely FAIL it -- proof the gate executes
    // the suite rather than reporting a fabricated pass.
    assert.equal(r.ok, false);
    assert.match(r.tail, /runner failed/);
  });
});
