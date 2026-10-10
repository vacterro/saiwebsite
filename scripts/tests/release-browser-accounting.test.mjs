/**
 * Stage B negative controls: Playwright JSON report accounting.
 *
 * The FULL browser matrix must prove every mandatory suite ran on its
 * required projects with zero unknown skips. Exit code zero alone proves
 * nothing. These controls exercise accountPlaywrightJson() /
 * refuseBrowserReport() -- the exact decision path runBrowserMatrix()
 * applies to both the dist-matrix and candidate-host reports -- plus the
 * served-directory refusals that bind candidate-host to the staged
 * artifact. All rejections are demonstrated with synthetic reports and
 * disposable directories; no browser launches here.
 */
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  accountPlaywrightJson,
  refuseBrowserReport,
  describeRunnerFailure,
  resolveMatrixDistDigest,
  computeDigest,
  BROWSER_SUITES,
  BROWSER_SKIP_POLICY,
  BROWSER_MATRIX_SPECS,
  BROWSER_MATRIX_EXPECTED,
  CANDIDATE_HOST_EXPECTED,
  ROOT,
} from '../release-candidate.mjs';
import { resolveServedCandidateDir } from '../release-smoke.mjs';

const WEBKIT_REASON = 'computed-style check; one engine is enough';
const CHROMIUM_REASON = 'WebKit smooths a sub-pixel-transformed text run; Chromium on a host with system smoothing off does not.';

function t(project, status, reason = null) {
  const annotations = reason === null ? [] : [{ type: 'skip', description: reason }];
  return { projectName: project, status, annotations };
}

function specFile(file, testsByProject) {
  const tests = [];
  for (const [project, list] of Object.entries(testsByProject)) {
    for (const [status, reason] of list) tests.push(t(project, status, reason));
  }
  return { file, title: file, suites: [], specs: [{ title: 'probe', tests }] };
}

const ALL_PASS = {
  // 15 discovered results (pixel-perfect and media-delivery run
  // chromium+webkit, the remaining suites run chromium): the runner
  // summary must describe the same run the records show. A
  // stats/records disagreement is contradictory evidence, never a pass
  // (Defect 3).
  stats: { expected: 15, skipped: 0, unexpected: 0, flaky: 0 },
  errors: [],
  suites: BROWSER_SUITES.map((s) => specFile(s.file, Object.fromEntries(s.projects.map((p) => [p, [['expected', null]]])))),
};

/** Recompute the runner summary from the report's own results, like a genuine runner would. */
function restat(report) {
  let expected = 0, skipped = 0, unexpected = 0, flaky = 0;
  const walk = (suites) => {
    for (const s of suites ?? []) {
      for (const spec of s.specs ?? []) {
        for (const tst of spec.tests ?? []) {
          if (tst.status === 'expected') expected++;
          else if (tst.status === 'skipped') skipped++;
          else if (tst.status === 'flaky') flaky++;
          else unexpected++;
        }
      }
      walk(s.suites);
    }
  };
  walk(report.suites);
  report.stats = { expected, skipped, unexpected, flaky };
  return report;
}

const jsonOf = (report) => JSON.stringify(report);

describe('accountPlaywrightJson', () => {
  it('full pass on every suite and project: no refusal', () => {
    const a = accountPlaywrightJson(jsonOf(ALL_PASS));
    assert.equal(a.complete, true);
    assert.deepEqual(a.missingSuites, []);
    assert.equal(a.totals.failed, 0);
    assert.equal(refuseBrowserReport(a), null);
  });

  it('mandatory Chromium test skipped with no cover is rejected', () => {
    const report = structuredClone(ALL_PASS);
    fileOf(report, 'tests/site-shell.spec.mjs').specs[0].tests.push(t('chromium', 'skipped', 'no locale variant built'));
    const a = accountPlaywrightJson(jsonOf(report));
    assert.equal(a.unknownSkips.length, 1);
    assert.match(refuseBrowserReport(a), /skipped with no policy cover/);
  });

  it('mandatory WebKit pixel test skipped with no cover is rejected', () => {
    const report = structuredClone(ALL_PASS);
    fileOf(report, 'tests/pixel-perfect.spec.mjs').specs[0].tests.push(t('webkit', 'skipped', 'a novel excuse'));
    const a = accountPlaywrightJson(jsonOf(report));
    assert.equal(a.unknownSkips.length, 1);
    assert.notEqual(refuseBrowserReport(a), null);
  });

  it('policy webkit skip WITHOUT a chromium complement pass is rejected', () => {
    const report = structuredClone(ALL_PASS);
    // A webkit-only title that never ran on chromium: reason matches, cover does not.
    fileOf(report, 'tests/pixel-perfect.spec.mjs').specs.push({ title: 'webkit-only probe', tests: [t('webkit', 'skipped', WEBKIT_REASON)] });
    const a = accountPlaywrightJson(jsonOf(report));
    assert.equal(a.unknownSkips.length, 1);
    assert.match(refuseBrowserReport(a), /no policy cover/);
  });

  it('policy webkit skip WITH a chromium complement pass is tolerated', () => {
    const report = structuredClone(ALL_PASS);
    fileOf(report, 'tests/pixel-perfect.spec.mjs').specs.push({
      title: 'shared probe',
      tests: [t('chromium', 'expected'), t('webkit', 'skipped', WEBKIT_REASON)],
    });
    restat(report);
    const a = accountPlaywrightJson(jsonOf(report));
    assert.deepEqual(a.unknownSkips, []);
    assert.equal(refuseBrowserReport(a), null);
  });

  it('policy chromium skip WITH a webkit complement pass is tolerated', () => {
    const report = structuredClone(ALL_PASS);
    fileOf(report, 'tests/pixel-perfect.spec.mjs').specs.push({
      title: 'smoothing control',
      tests: [t('webkit', 'expected'), t('chromium', 'skipped', CHROMIUM_REASON)],
    });
    restat(report);
    const a = accountPlaywrightJson(jsonOf(report));
    assert.deepEqual(a.unknownSkips, []);
    assert.equal(refuseBrowserReport(a), null);
  });

  it('9. summary expected count zero with one parsed pass is contradictory (Defect 3)', () => {
    const expected = [{ file: 'tests/probe.spec.mjs', projects: ['chromium'] }];
    const report = {
      stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 },
      errors: [],
      suites: [specFile('tests/probe.spec.mjs', { chromium: [['expected', null]] })],
    };
    const a = accountPlaywrightJson(jsonOf(report), { expected });
    assert.equal(a.totals.passed, 1);
    assert.equal(a.stats.expected, 0);
    assert.match(refuseBrowserReport(a), /contradictory browser summary/);
  });

  it('10. summary count larger than parsed results is contradictory', () => {
    const report = restat(structuredClone(ALL_PASS));
    report.stats.expected += 5;
    const a = accountPlaywrightJson(jsonOf(report));
    assert.match(refuseBrowserReport(a), /contradictory browser summary/);
  });

  it('11. summary count smaller than parsed results is contradictory', () => {
    const report = restat(structuredClone(ALL_PASS));
    report.stats.expected -= 1;
    const a = accountPlaywrightJson(jsonOf(report));
    assert.match(refuseBrowserReport(a), /contradictory browser summary/);
  });

  it('16. nonempty report with a missing runner summary is truncated, never a pass', () => {
    const report = structuredClone(ALL_PASS);
    report.stats = {};
    const a = accountPlaywrightJson(jsonOf(report));
    assert.equal(a.totals.tests, 15);
    assert.equal(a.statsComplete, false);
    assert.match(refuseBrowserReport(a), /summary is missing or truncated/);
  });

  it('visual suite omitted from the report is rejected', () => {
    const report = structuredClone(ALL_PASS);
    report.suites = report.suites.filter((s) => s.file !== 'tests/visual-baseline.spec.mjs');
    const a = accountPlaywrightJson(jsonOf(report));
    assert.ok(a.missingSuites.some((m) => m.includes('visual-baseline')));
    assert.match(refuseBrowserReport(a), /mandatory browser suite missing/);
  });

  it('pixel suite run on chromium only is rejected (webkit missing)', () => {
    const report = structuredClone(ALL_PASS);
    const pix = fileOf(report, 'tests/pixel-perfect.spec.mjs');
    pix.specs[0].tests = pix.specs[0].tests.filter((x) => x.projectName === 'chromium');
    const a = accountPlaywrightJson(jsonOf(report));
    assert.ok(a.missingSuites.some((m) => m.includes('no webkit tests')));
    assert.match(refuseBrowserReport(a), /mandatory browser suite missing/);
  });

  it('empty report (zero tests) is rejected', () => {
    const a = accountPlaywrightJson(JSON.stringify({ stats: {}, errors: [], suites: [] }));
    assert.equal(a.totals.tests, 0);
    assert.match(refuseBrowserReport(a), /zero browser tests discovered/);
  });

  it('runner crash before discovery is rejected', () => {
    const a = accountPlaywrightJson(JSON.stringify({ stats: {}, errors: [{ message: 'Error: browser has been closed' }], suites: [] }));
    assert.match(refuseBrowserReport(a), /browser runner errors/);
  });

  it('malformed JSON is rejected, never parsed as pass', () => {
    const a = accountPlaywrightJson('this is not json {{{');
    assert.equal(a.complete, false);
    assert.match(refuseBrowserReport(a), /unparsable Playwright JSON/);
  });

  it('mandatory browser failure is rejected', () => {
    const report = structuredClone(ALL_PASS);
    fileOf(report, 'tests/content-features.spec.mjs').specs[0].tests.push(t('chromium', 'unexpected'));
    const a = accountPlaywrightJson(jsonOf(report));
    assert.equal(a.totals.failed, 1);
    assert.match(refuseBrowserReport(a), /1 mandatory browser test\(s\) failed/);
  });

  it('flaky result is rejected even when it eventually passed', () => {
    const report = structuredClone(ALL_PASS);
    fileOf(report, 'tests/support.spec.mjs').specs[0].tests.push(t('chromium', 'flaky'));
    const a = accountPlaywrightJson(jsonOf(report));
    assert.match(refuseBrowserReport(a), /flaky browser test/);
  });

  it('registry shape: 13 suites, pixel and media-delivery on both engines, matrix specs exclude candidate-host', () => {
    assert.equal(BROWSER_SUITES.length, 13);
    assert.deepEqual(BROWSER_SUITES.find((s) => s.file.includes('pixel-perfect')).projects, ['chromium', 'webkit']);
    assert.deepEqual(BROWSER_SUITES.find((s) => s.file.includes('media-delivery')).projects, ['chromium', 'webkit']);
    assert.deepEqual(BROWSER_SUITES.find((s) => s.file.includes('secondary-journey')).projects, ['chromium']);
    assert.equal(BROWSER_MATRIX_SPECS.length, 12);
    assert.ok(!BROWSER_MATRIX_SPECS.some((f) => f.includes('candidate-host')));
    assert.equal(BROWSER_SKIP_POLICY.length, 2);
  });

  it('contract-3 quality suite omitted from the report is rejected', () => {
    for (const file of ['tests/docs-journey.spec.mjs', 'tests/theme-contrast.spec.mjs', 'tests/zoom-reflow.spec.mjs']) {
      const report = structuredClone(ALL_PASS);
      report.suites = report.suites.filter((s) => s.file !== file);
      const a = accountPlaywrightJson(jsonOf(report));
      assert.ok(a.missingSuites.some((m) => m.includes(file.split('/').pop().split('.')[0])), file);
      assert.match(refuseBrowserReport(a), /mandatory browser suite missing/, file);
    }
  });

  it('every spec file on disk is registered: no silent outsider suite', () => {
    const onDisk = readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.spec.mjs')).map((f) => `tests/${f}`).sort();
    const registered = BROWSER_SUITES.map((s) => s.file).sort();
    assert.deepEqual(onDisk, registered);
  });
});

describe('resolveMatrixDistDigest: the accounting digest is one effective identity', () => {
  const artifactDirs = [];
  after(() => artifactDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
  function artifact() {
    const dir = mkdtempSync(join(tmpdir(), 'sai-matrix-dist-'));
    artifactDirs.push(dir);
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>\n');
    return dir;
  }

  it('an explicit digest is authoritative and never recomputed', () => {
    const r = resolveMatrixDistDigest('a'.repeat(64), { distDir: join(tmpdir(), 'does-not-exist') });
    assert.equal(r.ok, true);
    assert.equal(r.sha256, 'a'.repeat(64));
  });

  it('without an explicit digest the artifact directory is digested', () => {
    const dir = artifact();
    const r = resolveMatrixDistDigest(null, { distDir: dir });
    assert.equal(r.ok, true);
    assert.equal(r.sha256, computeDigest(dir).sha256);
  });

  it('a missing artifact directory is an explicit failure, never a null identity', () => {
    const r = resolveMatrixDistDigest(null, { distDir: join(tmpdir(), `sai-absent-${Date.now()}`) });
    assert.equal(r.ok, false);
    assert.equal(r.sha256, undefined);
    assert.match(r.reason, /digest unavailable/);
  });

  it('a stale artifact yields the digest of the CURRENT bytes, not a remembered one', () => {
    const dir = artifact();
    const first = resolveMatrixDistDigest(null, { distDir: dir }).sha256;
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>changed</title>\n');
    const second = resolveMatrixDistDigest(null, { distDir: dir }).sha256;
    assert.notEqual(first, second, 'mutated bytes must change the accounted digest');
  });
});

describe('resolveServedCandidateDir', () => {
  it('standalone mode (env unset) returns null: caller projects its own copy', () => {
    assert.deepEqual(resolveServedCandidateDir({}), { dir: null, factoryProvided: false });
  });

  it('factory mode serves the exact staged directory as-is', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-served-'));
    writeFileSync(join(dir, 'index.html'), 'staged');
    try {
      const r = resolveServedCandidateDir({ SAI_CANDIDATE_DIR: dir });
      assert.equal(r.factoryProvided, true);
      assert.equal(r.dir, dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('relative directory is refused', () => {
    assert.throws(() => resolveServedCandidateDir({ SAI_CANDIDATE_DIR: 'next' }), /relative SAI_CANDIDATE_DIR/);
  });

  it('raw dist/ is refused: the host spec requires a public projection', () => {
    assert.throws(() => resolveServedCandidateDir({ SAI_CANDIDATE_DIR: join(ROOT, 'dist') }), /raw development build/);
  });

  it('directory without index.html is refused', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sai-empty-'));
    try {
      assert.throws(() => resolveServedCandidateDir({ SAI_CANDIDATE_DIR: dir }), /no index\.html/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('directory outside the staging boundary is refused', () => {
    const boundary = mkdtempSync(join(tmpdir(), 'sai-bound-'));
    const outside = mkdtempSync(join(tmpdir(), 'sai-out-'));
    writeFileSync(join(outside, 'index.html'), 'x');
    try {
      assert.throws(
        () => resolveServedCandidateDir({ SAI_CANDIDATE_DIR: outside, SAI_CANDIDATE_STAGING_ROOT: boundary }),
        /outside the staging boundary/,
      );
      assert.ok(existsSync(join(outside, 'index.html')), 'refusal mutates nothing');
    } finally {
      rmSync(boundary, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('directory inside the staging boundary is accepted', () => {
    const boundary = mkdtempSync(join(tmpdir(), 'sai-bound-'));
    const inside = join(boundary, 'next');
    mkdirSync(inside);
    writeFileSync(join(inside, 'index.html'), 'staged');
    try {
      const r = resolveServedCandidateDir({ SAI_CANDIDATE_DIR: inside, SAI_CANDIDATE_STAGING_ROOT: boundary });
      assert.equal(r.factoryProvided, true);
    } finally {
      rmSync(boundary, { recursive: true, force: true });
    }
  });
});

/** A dist-matrix report: every registered suite except candidate-host (cloned). */
function matrixReport() {
  const report = structuredClone({ stats: {}, errors: [], suites: ALL_PASS.suites.filter((s) => s.file !== 'tests/candidate-host.spec.mjs') });
  return restat(report);
}

describe('dist-matrix accounting uses the matrix-only registry', () => {
  it('1. complete matrix JSON passes accounting with the matrix-only expectation', () => {
    const a = accountPlaywrightJson(jsonOf(matrixReport()), { expected: BROWSER_MATRIX_EXPECTED });
    assert.deepEqual(a.missingSuites, []);
    assert.equal(refuseBrowserReport(a), null);
  });

  it('2. candidate-host absent from the dist matrix is not an error (defect control)', () => {
    const a = accountPlaywrightJson(jsonOf(matrixReport()), { expected: BROWSER_MATRIX_EXPECTED });
    assert.ok(!a.missingSuites.some((m) => m.includes('candidate-host')));
    assert.equal(refuseBrowserReport(a), null);
    // The OLD default expectation mis-diagnoses the same report -- the bug.
    const byDefault = accountPlaywrightJson(jsonOf(matrixReport()));
    assert.ok(byDefault.missingSuites.some((m) => m.includes('candidate-host.spec.mjs (absent)')));
  });

  it('3. a genuinely missing mandatory matrix suite still fails', () => {
    const report = matrixReport();
    report.suites = report.suites.filter((s) => s.file !== 'tests/visual-baseline.spec.mjs');
    const a = accountPlaywrightJson(jsonOf(report), { expected: BROWSER_MATRIX_EXPECTED });
    assert.ok(a.missingSuites.some((m) => m.includes('visual-baseline')));
    assert.match(refuseBrowserReport(a), /mandatory browser suite missing/);
  });

  it('4. a missing required Chromium project fails', () => {
    const report = matrixReport();
    fileOf(report, 'tests/site-shell.spec.mjs').specs[0].tests = [t('firefox', 'expected')];
    const a = accountPlaywrightJson(jsonOf(report), { expected: BROWSER_MATRIX_EXPECTED });
    assert.ok(a.missingSuites.some((m) => m.includes('no chromium tests')));
    assert.match(refuseBrowserReport(a), /mandatory browser suite missing/);
  });

  it('5. a missing required WebKit media project fails', () => {
    const report = matrixReport();
    const media = fileOf(report, 'tests/media-delivery.spec.mjs');
    media.specs[0].tests = media.specs[0].tests.filter((x) => x.projectName !== 'webkit');
    const a = accountPlaywrightJson(jsonOf(report), { expected: BROWSER_MATRIX_EXPECTED });
    assert.ok(a.missingSuites.some((m) => m.includes('no webkit tests')));
    assert.match(refuseBrowserReport(a), /mandatory browser suite missing/);
  });
});

describe('nonzero browser runner exit stays an honest failure', () => {
  it('6/9. nonzero exit with a clean account is an infrastructure failure, never a pass', () => {
    const clean = accountPlaywrightJson(jsonOf(matrixReport()), { expected: BROWSER_MATRIX_EXPECTED });
    assert.equal(refuseBrowserReport(clean), null);
    const tail = describeRunnerFailure({ label: 'browser matrix', exit: 1, accounting: clean, stderr: 'globalSetup teardown failed' });
    assert.match(tail, /exit 1/);
    assert.match(tail, /infrastructure failure, not a test failure/);
    assert.match(tail, /globalSetup teardown failed/);
  });

  it('7. when tests actually fail the tail names them and never mentions candidate-host', () => {
    const report = matrixReport();
    fileOf(report, 'tests/content-features.spec.mjs').specs[0].tests.push(t('chromium', 'unexpected'));
    restat(report);
    const a = accountPlaywrightJson(jsonOf(report), { expected: BROWSER_MATRIX_EXPECTED });
    const tail = describeRunnerFailure({ label: 'browser matrix', exit: 1, accounting: a });
    assert.match(tail, /exit 1/);
    assert.match(tail, /1 mandatory browser test\(s\) failed/);
    assert.match(tail, /content-features\.spec\.mjs/);
    assert.doesNotMatch(tail, /candidate-host/);
  });

  it('6. nonzero exit with no partial JSON names the exit and hides no cause', () => {
    const tail = describeRunnerFailure({ label: 'browser matrix', exit: 2, accounting: null, stderr: 'spawn ENOENT' });
    assert.match(tail, /exit 2/);
    assert.match(tail, /no partial Playwright JSON/);
    assert.match(tail, /spawn ENOENT/);
  });

  it('8. a truncated/unparsable partial report is surfaced as such', () => {
    const a = accountPlaywrightJson('}{ truncated', { expected: BROWSER_MATRIX_EXPECTED });
    const tail = describeRunnerFailure({ label: 'browser matrix', exit: 1, accounting: a });
    assert.match(tail, /unparsable Playwright JSON/);
  });

  it('failed test identities are preserved in the accounting payload', () => {
    const report = matrixReport();
    fileOf(report, 'tests/support.spec.mjs').specs[0].tests.push(t('chromium', 'unexpected'));
    restat(report);
    const a = accountPlaywrightJson(jsonOf(report), { expected: BROWSER_MATRIX_EXPECTED });
    assert.equal(a.failedTests.length, 1);
    assert.equal(a.failedTests[0].file, 'support.spec.mjs');
    assert.equal(a.failedTests[0].project, 'chromium');
  });
});

describe('dedicated candidate-host accounting', () => {
  const hostOnly = (testsByProject) => restat({ stats: {}, errors: [], suites: [specFile('tests/candidate-host.spec.mjs', testsByProject)] });

  it('11. candidate-host absent from its own dedicated run fails', () => {
    const a = accountPlaywrightJson(jsonOf(restat({ stats: {}, errors: [], suites: [specFile('tests/site-shell.spec.mjs', { chromium: [['expected', null]] })] })), { expected: CANDIDATE_HOST_EXPECTED });
    assert.ok(a.missingSuites.some((m) => m.includes('candidate-host')));
    assert.match(refuseBrowserReport(a), /mandatory browser suite missing/);
  });

  it('12. candidate-host on chromium with a clean run passes', () => {
    const a = accountPlaywrightJson(jsonOf(hostOnly({ chromium: [['expected', null]] })), { expected: CANDIDATE_HOST_EXPECTED });
    assert.deepEqual(a.missingSuites, []);
    assert.equal(refuseBrowserReport(a), null);
  });

  it('13. candidate-host failure (wrong digest) is reported as a failure', () => {
    const a = accountPlaywrightJson(jsonOf(hostOnly({ chromium: [['unexpected', null]] })), { expected: CANDIDATE_HOST_EXPECTED });
    assert.match(refuseBrowserReport(a), /1 mandatory browser test\(s\) failed/);
  });
});

function fileOf(report, file) {
  const found = report.suites.find((s) => s.file === file);
  assert.ok(found, `fixture lacks ${file}`);
  return found;
}

function structuredClone(value) {
  return JSON.parse(JSON.stringify(value));
}
