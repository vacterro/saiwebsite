// Origin authority and release preflight controls (run by npm run test:engine).
// Every defect class has a fixture artifact that must turn the matching check
// FAIL or BLOCKED, and the consistent artifact must PASS.
import { createHash } from 'node:crypto';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PLANNED_DOMAIN, PLANNED_ORIGIN, normalizeOrigin, resolveDeployment } from '../../src/lib/deployment.mjs';
import { ROOT, verifyRelease } from '../release-verify.mjs';

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const protocolBytes = readFileSync(join(ROOT, 'src/data/canonical/meta.json'));
const protocol = JSON.parse(protocolBytes.toString('utf8'));
const TEMP = 'https://sai-temp.example.org';
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** One HTML page; canonical null omits the canonical link (the not-found page). */
function page({ origin, canonical = `${origin}__ROUTE__`, route, noindex = false, body = '<a href="/about/">About</a>' }) {
  const canon = canonical === null ? '' : `<link rel="canonical" href="${canonical.replace('__ROUTE__', route)}">`;
  const og = canonical === null ? '' : `<meta property="og:url" content="${canonical.replace('__ROUTE__', route)}">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title>${canon}${noindex ? '<meta name="robots" content="noindex">' : ''}${og}</head><body>${body}</body></html>`;
}

/** A consistent artifact for one origin. overrides: rel -> content, or null to remove the file. */
function artifact({ origin, release = false, overrides = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'sai-release-'));
  dirs.push(dir);
  const files = {
    'index.html': page({ origin, route: '/' }),
    'about/index.html': page({ origin, route: '/about/' }),
    'search/index.html': page({ origin, route: '/search/' }),
    'debug/components/index.html': page({ origin, route: '/debug/components/', noindex: true }),
    'qps-ploc/index.html': page({ origin, route: '/qps-ploc/', noindex: true }),
    '404.html': page({ origin, canonical: null, route: '/404/', noindex: true }),
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset>${['/', '/about/', '/search/'].map((p) => `<url><loc>${origin}${p}</loc></url>`).join('')}</urlset>\n`,
    'robots.txt': `User-agent: *\nAllow: /\nDisallow: /debug/\n\nSitemap: ${origin}/sitemap.xml\n`,
    'llms.txt': `# Site\n\n- [About](${origin}/about/): about\n`,
    '_astro/app.js': '',
    'release.json': `${JSON.stringify({
      schemaVersion: 1,
      build: 'production',
      release,
      origin,
      originSource: release ? 'env' : 'default',
      plannedDomain: PLANNED_DOMAIN,
      package: { name: pkg.name, version: pkg.version },
      protocol: { version: protocol.version, commit: protocol.commit, metaSha256: createHash('sha256').update(protocolBytes).digest('hex') },
    }, null, 2)}\n`,
    ...overrides,
  };
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  for (const rel of Object.keys(overrides)) if (overrides[rel] === null) rmSync(join(dir, rel), { force: true });
  return dir;
}

const statusOf = (result, id) => result.checks.find((c) => c.id === id)?.status;
const detailOf = (result, id) => result.checks.find((c) => c.id === id)?.detail ?? '';

describe('origin authority (src/lib/deployment.mjs)', () => {
  it('defaults deterministically to the planned origin when nothing is set', () => {
    const d = resolveDeployment({});
    assert.equal(d.origin, PLANNED_ORIGIN);
    assert.equal(d.source, 'default');
    assert.equal(d.isPlanned, true);
    assert.equal(d.release, false);
  });

  it('normalises a harmless trailing slash and keeps the explicit origin', () => {
    assert.equal(normalizeOrigin(`${TEMP}/`).origin, TEMP);
    assert.equal(resolveDeployment({ SAI_SITE_ORIGIN: `${TEMP}/` }).origin, TEMP);
    assert.equal(resolveDeployment({ SAI_SITE_ORIGIN: TEMP }).isPlanned, false);
  });

  it('rejects unsupported origins: path, query, fragment, credentials, protocol, host, IP and port', () => {
    const cases = {
      'http public origin': 'http://sai-temp.example.org',
      'path-based deployment': `${TEMP}/sub`,
      query: `${TEMP}?x=1`,
      fragment: `${TEMP}#top`,
      credentials: 'https://user:secret@sai-temp.example.org',
      'ftp protocol': 'ftp://sai-temp.example.org',
      'invalid hostname': 'https://sai_temp.example.org',
      'IP literal': 'https://192.0.2.10',
      'public port': 'https://sai-temp.example.org:8443',
      'not a URL': 'sai-temp',
    };
    for (const [label, raw] of Object.entries(cases)) {
      assert.equal(normalizeOrigin(raw).origin, null, `${label} must be rejected`);
      assert.throws(() => resolveDeployment({ SAI_SITE_ORIGIN: raw }), /invalid deployment configuration/, label);
    }
  });

  it('treats a blank origin as unset: dev falls back to the planned origin, release refuses', () => {
    assert.equal(resolveDeployment({ SAI_SITE_ORIGIN: '   ' }).source, 'default');
    assert.throws(() => resolveDeployment({ SAI_SITE_ORIGIN: '  ', SAI_RELEASE_BUILD: '1' }), /required for a release build/);
    assert.equal(normalizeOrigin('   ').origin, null);
  });

  it('allows plain HTTP only for loopback development', () => {
    assert.equal(resolveDeployment({ SAI_SITE_ORIGIN: 'http://localhost:4321' }).origin, 'http://localhost:4321');
  });

  it('requires an explicit origin and a matching acknowledgement for a release build', () => {
    assert.throws(() => resolveDeployment({ SAI_RELEASE_BUILD: '1' }), /required for a release build/);
    assert.throws(() => resolveDeployment({ SAI_RELEASE_BUILD: '1', SAI_SITE_ORIGIN: TEMP }), /SAI_RELEASE_ORIGIN_ACK must repeat/);
    assert.throws(
      () => resolveDeployment({ SAI_RELEASE_BUILD: '1', SAI_SITE_ORIGIN: TEMP, SAI_RELEASE_ORIGIN_ACK: 'https://other.example.org' }),
      /must repeat/,
    );
    assert.throws(
      () => resolveDeployment({ SAI_RELEASE_BUILD: '1', SAI_SITE_ORIGIN: 'http://localhost:4321', SAI_RELEASE_ORIGIN_ACK: 'http://localhost:4321' }),
      /loopback/,
    );
    const ok = resolveDeployment({ SAI_RELEASE_BUILD: '1', SAI_SITE_ORIGIN: TEMP, SAI_RELEASE_ORIGIN_ACK: `${TEMP}/` });
    assert.equal(ok.release, true);
    assert.equal(ok.origin, TEMP);
  });

  it('two origins resolve independently; the planned domain is editorial only', () => {
    assert.notEqual(resolveDeployment({ SAI_SITE_ORIGIN: TEMP }).origin, resolveDeployment({}).origin);
    assert.equal(resolveDeployment({ SAI_SITE_ORIGIN: TEMP }).plannedDomain, PLANNED_DOMAIN);
  });
});

describe('release preflight negative controls (fixture artifacts)', () => {
  it('a consistent temporary-origin artifact passes its own origin contract', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((c) => c.status !== 'PASS')));
    assert.equal(r.origin.effective, TEMP);
    assert.equal(r.external.every((e) => e.status === 'BLOCKED'), true);
  });

  it('J/D: an artifact built for one origin fails when verified against another', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP }), env: {}, root: ROOT });
    assert.equal(r.verdict, 'FAIL');
    assert.equal(statusOf(r, 'origin.expected-match'), 'FAIL');
    assert.equal(statusOf(r, 'config.astro-site'), 'FAIL');
  });

  it('a temporary origin artifact never emits the planned host as an SEO URL', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'about/index.html': page({ origin: PLANNED_ORIGIN, route: '/about/' }) } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'seo.canonical'), 'FAIL');
  });

  it('A/B: release mode without acknowledgement is BLOCKED, never PASS', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, release: true }), env: { SAI_SITE_ORIGIN: TEMP }, release: true, root: ROOT });
    assert.equal(statusOf(r, 'origin.release-acknowledged'), 'BLOCKED');
    assert.equal(r.verdict, 'BLOCKED');
  });

  it('acknowledged release artifact passes release mode', async () => {
    const env = { SAI_SITE_ORIGIN: TEMP, SAI_RELEASE_ORIGIN_ACK: TEMP };
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, release: true }), env, release: true, root: ROOT });
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((c) => c.status !== 'PASS')));
    assert.equal(r.origin.acknowledged, true);
  });

  it('D: a development artifact is BLOCKED for a release verdict', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: PLANNED_ORIGIN }), env: { SAI_RELEASE_ORIGIN_ACK: PLANNED_ORIGIN }, release: true, root: ROOT });
    assert.equal(statusOf(r, 'origin.release-acknowledged'), 'BLOCKED');
    assert.match(detailOf(r, 'origin.release-acknowledged'), /release: false/);
  });

  it('E: a sitemap entry on another host fails the sitemap origin check', async () => {
    const sitemap = `<urlset><url><loc>https://other.example.org/</loc></url></urlset>`;
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'sitemap.xml': sitemap } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'sitemap.origin'), 'FAIL');
  });

  it('E: a canonical link outside the effective origin fails', async () => {
    const r = await verifyRelease({
      dist: artifact({ origin: TEMP, overrides: { 'index.html': page({ origin: 'https://other.example.org', route: '/' }) } }),
      env: { SAI_SITE_ORIGIN: TEMP },
      root: ROOT,
    });
    assert.equal(statusOf(r, 'seo.canonical'), 'FAIL');
  });

  it('F: a robots.txt sitemap line on the wrong host fails', async () => {
    const robots = `User-agent: *\nDisallow: /debug/\n\nSitemap: https://saipenprotocol.com/sitemap.xml\n`;
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'robots.txt': robots } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'robots.sitemap'), 'FAIL');
  });

  it('G: a debug page without the noindex marker fails', async () => {
    const r = await verifyRelease({
      dist: artifact({ origin: TEMP, overrides: { 'debug/components/index.html': page({ origin: TEMP, route: '/debug/components/' }) } }),
      env: { SAI_SITE_ORIGIN: TEMP },
      root: ROOT,
    });
    assert.equal(statusOf(r, 'noindex.debug'), 'FAIL');
  });

  it('H: a pseudo-locale route entering the sitemap fails', async () => {
    const sitemap = `<urlset><url><loc>${TEMP}/</loc></url><url><loc>${TEMP}/qps-ploc/</loc></url></urlset>`;
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'sitemap.xml': sitemap } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'sitemap.exclusions'), 'FAIL');
  });

  it('I: a disabled ET/RU route that is indexable and advertised fails', async () => {
    const overrides = {
      'et/index.html': page({ origin: TEMP, route: '/et/' }),
      'index.html': page({ origin: TEMP, route: '/', body: '<link rel="alternate" hreflang="et" href="' + TEMP + '/et/">' }),
    };
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'locales.restricted'), 'FAIL');
  });

  it('K: an internal link written as an absolute origin URL fails navigation', async () => {
    const r = await verifyRelease({
      dist: artifact({ origin: TEMP, overrides: { 'about/index.html': page({ origin: TEMP, route: '/about/', body: `<a href="${TEMP}/">Home</a>` }) } }),
      env: { SAI_SITE_ORIGIN: TEMP },
      root: ROOT,
    });
    assert.equal(statusOf(r, 'navigation.root-relative'), 'FAIL');
  });

  it('a machine-facing file still naming the previous origin fails', async () => {
    const r = await verifyRelease({
      dist: artifact({ origin: TEMP, overrides: { 'llms.txt': `- [About](${PLANNED_ORIGIN}/about/): stale\n` } }),
      env: { SAI_SITE_ORIGIN: TEMP },
      root: ROOT,
    });
    assert.equal(statusOf(r, 'seo.foreign-origin'), 'FAIL');
  });

  it('a project-memory or evidence file in the artifact fails the cleanliness check', async () => {
    const r = await verifyRelease({
      dist: artifact({ origin: TEMP, overrides: { '.saipen/STATE.md': 'phase: DONE\n', 'reports/run.json': '{}' } }),
      env: { SAI_SITE_ORIGIN: TEMP },
      root: ROOT,
    });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
  });

  it('a stale protocol snapshot identity fails the artifact check', async () => {
    const release = JSON.parse(readFileSync(join(artifact({ origin: TEMP }), 'release.json'), 'utf8'));
    release.protocol.metaSha256 = '0'.repeat(64);
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'release.json': JSON.stringify(release) } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.protocol-identity'), 'FAIL');
  });

  it('no artifact at all is a FAIL, not a silent pass', async () => {
    const r = await verifyRelease({ dist: join(tmpdir(), 'sai-release-does-not-exist'), env: {}, root: ROOT });
    assert.equal(r.verdict, 'FAIL');
  });

  it('S1: .git/config in the artifact fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { '.git/config': '[core]\n' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S2: private/id_rsa in the artifact fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'private/id_rsa': 'PRIVATE\n' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S3: private/credentials.json in the artifact fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'private/credentials.json': '{}' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S4: .env.local in the artifact fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { '.env.local': 'SECRET=x\n' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S5: a .ssh/ directory in the artifact fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { '.ssh/config': 'Host x\n' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S6: a source tree copied into dist/ fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'src/data/site.ts': 'export {}\n', 'scripts/x.mjs': 'x\n' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S7: a nested project-memory directory fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'nested/.saipen/STATE.md': 'phase: DONE\n' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S8: a temporary test-results directory fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'test-results/run.json': '{}' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S9: an unapproved hidden configuration file fails the cleanliness check', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { '.hidden-config.json': '{}' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S10: a symbolic link escaping the artifact root fails the cleanliness check', async (t) => {
    const dir = artifact({ origin: TEMP });
    let linked = false;
    try {
      symlinkSync(join(ROOT, 'package.json'), join(dir, 'about', 'escape.html'));
      linked = true;
    } catch {
      // Windows hosts without symlink privilege fall back to a directory
      // junction, which needs no privilege and exercises the same
      // lstat-based boundary (reparse points are never followed).
      try {
        symlinkSync(ROOT, join(dir, 'about', 'escape-dir'), 'junction');
        linked = true;
      } catch {
        linked = false;
      }
    }
    if (!linked) {
      t.skip('neither symlinks nor junctions can be created on this host; symlink protection NOT verified');
      return;
    }
    const r = await verifyRelease({ dist: dir, env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S11: legitimate font, licence and public manifest files keep passing', async () => {
    const r = await verifyRelease({
      dist: artifact({
        origin: TEMP,
        overrides: {
          'fonts/test.woff2': 'font',
          'fonts/LICENSE-test.txt': 'licence',
          'fonts/manifest.json': '{}',
          'media/MANIFEST.json': '{}',
          'social/MANIFEST.json': '{}',
          'spec/v8/registry.json': '{}',
          'docs/notes.md': '# notes\n',
        },
      }),
      env: { SAI_SITE_ORIGIN: TEMP },
      root: ROOT,
    });
    assert.equal(statusOf(r, 'artifact.clean'), 'PASS', detailOf(r, 'artifact.clean'));
    assert.equal(r.verdict, 'PASS', JSON.stringify(r.checks.filter((c) => c.status !== 'PASS')));
  });

  it('P1: diagnostic policy holds together — noindex, sitemap exclusion, crawl-hint disallow', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'noindex.debug'), 'PASS');
    assert.equal(statusOf(r, 'sitemap.exclusions'), 'PASS');
    assert.equal(statusOf(r, 'robots.debug-disallow'), 'PASS');
    // The policy never claims guaranteed search exclusion: Disallow is a
    // crawl hint only and may hide the noindex directive from crawlers.
    assert.match(detailOf(r, 'robots.debug-disallow'), /never guaranteed/);
    assert.equal(r.external.find((e) => e.id === 'search-indexing')?.status, 'BLOCKED');
  });

  it('P2: robots.txt without the /debug/ disallow fails the crawl-hint check', async () => {
    const robots = `User-agent: *\nAllow: /\n\nSitemap: ${TEMP}/sitemap.xml\n`;
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'robots.txt': robots } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'robots.debug-disallow'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('S12: a normal complete output tree keeps passing artifact.clean', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.clean'), 'PASS');
    assert.equal(r.verdict, 'PASS');
  });
});

describe('release preflight result contract (structured FAIL, never silent)', () => {
  it('invalid release.json is a structured FAIL, not an exception', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'release.json': 'not json{' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.release-metadata'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('missing release.json is a structured FAIL, not an exception', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'release.json': null } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.release-metadata'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('missing sitemap is a structured FAIL', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'sitemap.xml': null } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'sitemap.origin'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('malformed sitemap is a structured FAIL', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'sitemap.xml': 'this is not xml' } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'sitemap.wellformed'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('missing robots.txt is a structured FAIL', async () => {
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'robots.txt': null } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'robots.sitemap'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('an indexable page without its required canonical metadata fails', async () => {
    const bare = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><a href="/about/">About</a></body></html>';
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'index.html': bare } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'seo.canonical'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('a non-production build mode fails the production gate', async () => {
    const release = JSON.parse(readFileSync(join(artifact({ origin: TEMP }), 'release.json'), 'utf8'));
    release.build = 'development';
    const r = await verifyRelease({ dist: artifact({ origin: TEMP, overrides: { 'release.json': JSON.stringify(release) } }), env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.production'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });

  it('no built index page is a FAIL, not a silent pass', async () => {
    const dir = artifact({ origin: TEMP });
    rmSync(join(dir, 'index.html'), { force: true });
    const r = await verifyRelease({ dist: dir, env: { SAI_SITE_ORIGIN: TEMP }, root: ROOT });
    assert.equal(statusOf(r, 'artifact.present'), 'FAIL');
    assert.equal(r.verdict, 'FAIL');
  });
});
