// Local static-host smoke controls (run by npm run test:engine).
// Positive: a complete candidate fixture passes LOCAL_STATIC_HOST_PASS.
// Negative: a missing required route, a reintroduced diagnostic page, a
// reintroduced pseudo-locale and a wrong robots origin each FAIL — the
// smoke gate must be able to fail, not just report PASS.
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { probeCandidate, startStaticServer } from '../release-smoke.mjs';

const ORIGIN = 'https://candidate.example.org';
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function write(dir, rel, content) {
  const full = join(dir, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

/** Minimal but complete candidate fixture covering every smoke surface. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'sai-smoke-'));
  dirs.push(dir);
  const page = (title) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>` +
    `<link rel="canonical" href="${ORIGIN}/"><meta property="og:url" content="${ORIGIN}/">` +
    `</head><body><h1>${title}</h1></body></html>`;
  write(dir, 'index.html', page('Home'));
  write(dir, '404.html', '<!doctype html><html><body><h1>404</h1></body></html>');
  for (const route of ['docs/getting-started/introduction', 'spec', 'search', 'ecosystem', 'pricing', 'blog', 'downloads']) {
    write(dir, `${route}/index.html`, page(route));
  }
  write(dir, 'docs/getting-started/introduction.md', '# Introduction\n');
  write(dir, 'robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
  write(dir, 'sitemap.xml', `<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${ORIGIN}/</loc></url></urlset>\n`);
  write(dir, 'llms.txt', `# Test site\n\n- [Home](${ORIGIN}/)\n`);
  write(dir, '_astro/site.css', 'body{color:#000}\n');
  write(dir, 'fonts/sai-pixel-12-regular.woff2', 'woff2-bytes');
  write(dir, 'social/card.png', 'png-bytes');
  write(dir, 'favicon.ico', 'ico-bytes');
  return dir;
}

describe('release-smoke local static host probe', () => {
  it('a complete candidate passes LOCAL_STATIC_HOST_PASS (incl. traversal rejection)', async () => {
    const dir = fixture();
    const { verdict, checks } = await probeCandidate(dir, ORIGIN);
    const failed = checks.filter((c) => c.status !== 'PASS').map((c) => `${c.id}: ${c.detail}`);
    assert.equal(verdict, 'LOCAL_STATIC_HOST_PASS', failed.join('\n'));
    assert.ok(checks.some((c) => c.id === 'http.no-traversal' && c.status === 'PASS'));
    assert.ok(checks.some((c) => c.id === 'http.not-found' && c.status === 'PASS'));
  });

  it('a missing required public route FAILs local smoke validation', async () => {
    const dir = fixture();
    rmSync(join(dir, 'blog'), { recursive: true, force: true });
    const { verdict, checks } = await probeCandidate(dir, ORIGIN);
    assert.equal(verdict, 'FAIL');
    assert.ok(checks.some((c) => c.id === 'http.blog' && c.status === 'FAIL'));
  });

  it('a reintroduced diagnostic page FAILs local smoke validation', async () => {
    const dir = fixture();
    write(dir, 'debug/components/index.html', '<!doctype html><html><body>debug</body></html>');
    const { verdict, checks } = await probeCandidate(dir, ORIGIN);
    assert.equal(verdict, 'FAIL');
    assert.ok(checks.some((c) => c.id === 'http.no-diagnostics' && c.status === 'FAIL'));
  });

  it('a reintroduced pseudo-locale FAILs local smoke validation', async () => {
    const dir = fixture();
    write(dir, 'qps-ploc/index.html', '<!doctype html><html><body>pseudo</body></html>');
    const { verdict, checks } = await probeCandidate(dir, ORIGIN);
    assert.equal(verdict, 'FAIL');
    assert.ok(checks.some((c) => c.id === 'http.no-pseudo-locale' && c.status === 'FAIL'));
  });

  it('a robots.txt that does not name the effective origin FAILs', async () => {
    const dir = fixture();
    write(dir, 'robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: https://wrong.example.org/sitemap.xml\n');
    const { verdict, checks } = await probeCandidate(dir, ORIGIN);
    assert.equal(verdict, 'FAIL');
    assert.ok(checks.some((c) => c.id === 'http.robots' && c.status === 'FAIL'));
  });

  it('the static server never escapes its root directory', async () => {
    const dir = fixture();
    const { server, base } = await startStaticServer(dir);
    try {
      const res = await fetch(`${base}/..%2f..%2fpackage.json`);
      assert.ok(res.status === 400 || res.status === 404, `expected rejection, got ${res.status}`);
      const res2 = await fetch(`${base}/%2e%2e/%2e%2e/package.json`);
      assert.ok(res2.status === 400 || res2.status === 404, `expected rejection, got ${res2.status}`);
    } finally {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
