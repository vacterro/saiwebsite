// Public-candidate contract controls (run by npm run test:engine).
// The development build keeps diagnostics (contract mode stays PASS); the
// projected public candidate physically excludes them (public mode PASS).
// Reintroduced internal surfaces must FAIL public verification.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { ROOT, verifyRelease } from '../release-verify.mjs';
import { isInternalPath, loadPublicContract, projectPublicCandidate } from '../release-public.mjs';

/**
 * Resolve the build artifact this suite inspects.
 *
 * The post-build engine gate (runEngineGate/buildDistDir) selects the artifact
 * for THIS run through SAI_RELEASE_ARTIFACT_DIR. That selection is
 * authoritative: the suite then inspects exactly that directory and never
 * falls back to a possibly stale ROOT/dist. Without an explicit selection the
 * historical ROOT/dist default is preserved (developer runs `npm run build`
 * then the suite).
 */
function resolveArtifact() {
  const raw = process.env.SAI_RELEASE_ARTIFACT_DIR;
  if (raw !== undefined && String(raw).trim() !== '') {
    return { dir: resolve(String(raw).trim()), explicit: true };
  }
  return { dir: join(ROOT, 'dist'), explicit: false };
}

const ARTIFACT = resolveArtifact();
const DIST = ARTIFACT.dir;
const isCompleteArtifact = (dir) => existsSync(join(dir, 'index.html')) && existsSync(join(dir, 'release.json'));

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function tempDir() {
  const d = mkdtempSync(join(tmpdir(), 'sai-public-'));
  dirs.push(d);
  return d;
}

/**
 * Gate the build-dependent controls. An EXPLICITLY selected artifact must be
 * complete (index.html + release.json): a missing or incomplete selection
 * FAILS the suite -- it is never a silent skip, and it never quietly reverts
 * to ROOT/dist. Only the implicit default may skip for a developer who has
 * not built yet.
 */
function needsDist(t) {
  if (isCompleteArtifact(DIST)) return true;
  if (ARTIFACT.explicit) {
    assert.fail(`explicit release artifact ${DIST} is missing or incomplete (needs index.html and release.json); refusing to fall back to ROOT/dist`);
  }
  t.skip('no built dist/; run npm run build first (projection needs a real build)');
  return false;
}

/** Project the real development build into an isolated candidate. */
function projectDist() {
  const d = tempDir();
  const dest = join(d, 'candidate');
  const summary = projectPublicCandidate({ srcDir: DIST, destDir: dest, root: ROOT });
  return { dest, summary };
}

const statusOf = (result, id) => result.checks.find((c) => c.id === id)?.status;

/**
 * The dev/public contract tests care about structure, not which origin the
 * current dist/ was stamped with: they verify the artifact against its own
 * recorded origin (dist/release.json). Stale or foreign origin detection has
 * its own dedicated controls in release-origin.test.mjs (J/D) and in
 * release:verify itself. Without this, a dist left behind by a dual-origin or
 * release run would make these tests fail for a reason they do not test.
 */
function artifactOriginEnv() {
  try {
    const rel = JSON.parse(readFileSync(join(DIST, 'release.json'), 'utf8'));
    return rel.origin ? { SAI_SITE_ORIGIN: rel.origin } : {};
  } catch {
    return {};
  }
}

describe('public-candidate contract (projection + public verifier mode)', () => {
  it('1: the development build retains diagnostic routes under its contract', async (t) => {
    if (!needsDist(t)) return;
    assert.ok(existsSync(join(DIST, 'debug', 'components', 'index.html')), 'debug bench present in dev build');
    const r = await verifyRelease({ dist: DIST, env: artifactOriginEnv(), root: ROOT });
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((c) => c.status !== 'PASS')));
  });

  it('2: the development build retains the pseudo-locale', async (t) => {
    if (!needsDist(t)) return;
    assert.ok(existsSync(join(DIST, 'qps-ploc', 'index.html')), 'pseudo-locale page present in dev build');
    assert.ok(existsSync(join(DIST, 'qps-ploc', 'search-index.json')), 'pseudo-locale search index present in dev build');
    assert.ok(existsSync(join(DIST, 'qps-ploc', 'llms.txt')), 'pseudo-locale AI endpoint present in dev build');
  });

  it('3: projection excludes every diagnostic route', async (t) => {
    if (!needsDist(t)) return;
    const { dest, summary } = projectDist();
    const contract = loadPublicContract(ROOT);
    for (const route of contract.debugRoutes) {
      const rel = route.replace(/^\//, '') + 'index.html';
      assert.ok(!existsSync(join(dest, rel)), `${route} physically absent from candidate`);
      assert.ok(summary.removed.includes(rel), `${rel} reported as removed`);
    }
    assert.ok(!existsSync(join(dest, 'debug')), 'no debug/ tree remains');
  });

  it('4: projection excludes the pseudo-locale and unapproved locales', async (t) => {
    if (!needsDist(t)) return;
    const { dest } = projectDist();
    for (const prefix of ['qps-ploc', 'et', 'ru']) {
      assert.ok(!existsSync(join(dest, prefix)), `no ${prefix}/ tree in candidate`);
    }
  });

  it('5: the public sitemap lists only public pages', async (t) => {
    if (!needsDist(t)) return;
    const { dest } = projectDist();
    const sitemap = readFileSync(join(dest, 'sitemap.xml'), 'utf8');
    const locs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    assert.ok(locs.length > 0, 'candidate sitemap is non-empty');
    for (const loc of locs) {
      const path = new URL(loc).pathname;
      assert.ok(!path.startsWith('/debug/'), `sitemap lists diagnostic route ${path}`);
      assert.ok(!/^\/(qps-ploc|et|ru)(\/|$)/.test(path), `sitemap lists non-public route ${path}`);
    }
    const r = await verifyRelease({ dist: dest, env: artifactOriginEnv(), root: ROOT, public: true });
    assert.equal(statusOf(r, 'sitemap.exclusions'), 'PASS');
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((c) => c.status !== 'PASS')));
  });

  it('6: public search and AI indexes contain no internal routes', async (t) => {
    if (!needsDist(t)) return;
    const { dest } = projectDist();
    const entries = JSON.parse(readFileSync(join(dest, 'search-index.json'), 'utf8'));
    for (const e of entries) {
      assert.ok(!/^\/(debug|qps-ploc|et|ru)(\/|$)/.test(new URL(String(e.url), 'https://candidate.invalid').pathname), `search index lists ${e.url}`);
    }
    for (const name of ['llms.txt', 'llms-full.txt']) {
      const text = readFileSync(join(dest, name), 'utf8');
      for (const m of text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
        const path = new URL(m[1]).pathname;
        assert.ok(!/^(\/debug\/|\/(qps-ploc|et|ru)(\/|$))/.test(path), `${name} links ${m[1].slice(0, 80)}`);
      }
    }
    const r = await verifyRelease({ dist: dest, env: artifactOriginEnv(), root: ROOT, public: true });
    assert.equal(statusOf(r, 'artifact.public'), 'PASS');
  });

  it('7: a reintroduced diagnostic page makes public verification FAIL', async (t) => {
    if (!needsDist(t)) return;
    const { dest } = projectDist();
    mkdirSync(join(dest, 'debug', 'components'), { recursive: true });
    cpSync(join(DIST, 'debug', 'components', 'index.html'), join(dest, 'debug', 'components', 'index.html'));
    const r = await verifyRelease({ dist: dest, env: artifactOriginEnv(), root: ROOT, public: true });
    assert.equal(statusOf(r, 'artifact.public'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('8: a reintroduced pseudo-locale artifact makes public verification FAIL', async (t) => {
    if (!needsDist(t)) return;
    const { dest } = projectDist();
    mkdirSync(join(dest, 'qps-ploc'), { recursive: true });
    cpSync(join(DIST, 'qps-ploc', 'index.html'), join(dest, 'qps-ploc', 'index.html'));
    writeFileSync(join(dest, 'qps-ploc', 'search-index.json'), readFileSync(join(DIST, 'qps-ploc', 'search-index.json')));
    const r = await verifyRelease({ dist: dest, env: artifactOriginEnv(), root: ROOT, public: true });
    assert.equal(statusOf(r, 'artifact.public'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('9: public navigation has no dead links to removed internal routes', async (t) => {
    if (!needsDist(t)) return;
    const { dest } = projectDist();
    const { readdirSync, statSync } = await import('node:fs');
    const htmlFiles = [];
    (function walk(current) {
      for (const e of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = join(current, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith('.html')) htmlFiles.push(full);
      }
    })(dest);
    const dead = [];
    const internalRefs = [];
    const resolveTarget = (href) => {
      const path = href.split('#')[0].split('?')[0];
      if (path.endsWith('/')) return join(dest, path.slice(1), 'index.html');
      const direct = join(dest, path.slice(1));
      if (existsSync(direct) && statSync(direct).isFile()) return direct;
      return join(dest, path.slice(1), 'index.html');
    };
    for (const file of htmlFiles) {
      const html = readFileSync(file, 'utf8');
      for (const m of html.matchAll(/href="(\/[^"]*)"/g)) {
        const href = m[1].replace(/&amp;/g, '&');
        if (/^\/(debug|qps-ploc|et|ru)(\/|$)/.test(href.split('#')[0])) {
          internalRefs.push(`${file} -> ${href}`);
          continue;
        }
        if (!existsSync(resolveTarget(href))) dead.push(`${file} -> ${href}`);
      }
    }
    assert.deepEqual(internalRefs, [], `public pages reference removed internal routes: ${internalRefs.slice(0, 5).join('; ')}`);
    assert.deepEqual(dead, [], `public pages contain dead root-relative links: ${dead.slice(0, 5).join('; ')}`);
  });

  it('10: projection is non-destructive — kept files are byte-identical', async (t) => {
    if (!needsDist(t)) return;
    const { dest, summary } = projectDist();
    const { readdirSync, readFileSync: read } = await import('node:fs');
    const candFiles = [];
    (function walk(current, rel) {
      for (const e of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const full = join(current, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(full, r);
        else candFiles.push(r);
      }
    })(dest, '');
    assert.ok(candFiles.length > 100, `candidate holds a full public tree (${candFiles.length} files)`);
    for (const rel of candFiles) {
      assert.deepEqual(read(join(dest, rel)), read(join(DIST, rel)), `${rel} unchanged by projection`);
    }
    assert.ok(summary.removed.length >= 14, `internal surfaces removed (${summary.removed.length})`);
  });

  it('contract registry agrees: isInternalPath matches the verifier boundary', () => {
    const contract = loadPublicContract(ROOT);
    assert.equal(isInternalPath('debug/components/index.html', contract), true);
    assert.equal(isInternalPath('qps-ploc/llms.txt', contract), true);
    assert.equal(isInternalPath('et/index.html', contract), true);
    assert.equal(isInternalPath('about/index.html', contract), false);
    assert.equal(isInternalPath('sitemap.xml', contract), false);
  });
});
