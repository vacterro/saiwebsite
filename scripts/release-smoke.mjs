#!/usr/bin/env node
/**
 * Local static-host smoke test (npm run release:smoke).
 *
 * Serves a public candidate directory over loopback HTTP with plain static
 * file semantics (directory index.html, 404.html fallback, content types)
 * and probes the surfaces a static host must serve: homepage, docs, spec,
 * search, ecosystem, pricing, blog, downloads, 404 behavior, assets, fonts,
 * robots.txt, sitemap.xml, llms.txt, Markdown twins, canonical/Open Graph
 * metadata — plus physical isolation (diagnostic and pseudo-locale URLs
 * must 404).
 *
 * A pass is reported as LOCAL_STATIC_HOST_PASS. It proves file serving
 * only: compatibility with any real hosting provider stays BLOCKED until
 * tested against the selected actual host.
 *
 * Usage:
 *   node scripts/release-smoke.mjs --dir <candidate> --origin <origin> [--out <report.json>]
 *
 * Exit status: 0 LOCAL_STATIC_HOST_PASS, 1 FAIL.
 */
import { createServer } from 'node:http';
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Resolve which candidate directory a candidate-host browser run must serve.
 *
 * Two modes, never mixed:
 * - Factory mode: SAI_CANDIDATE_DIR names the exact staged candidate
 *   (base/next/). Used as-is after validation; never re-projected, so a
 *   browser PASS always binds to the promotion artifact.
 * - Standalone mode: SAI_CANDIDATE_DIR is unset and the caller projects
 *   dist/ into its own disposable directory (existing dev behavior).
 *
 * Factory mode refuses, before serving anything:
 * - a relative or missing path, or a directory without index.html,
 * - the raw development build (ROOT/dist) -- the host spec must see a
 *   public projection, never debug routes or non-public locales,
 * - any directory outside SAI_CANDIDATE_STAGING_ROOT when that boundary
 *   is set (the factory sets it to its candidate store).
 *
 * @returns {{ dir: string|null, factoryProvided: boolean }}
 *   dir is null in standalone mode (the caller projects its own copy).
 * @throws on any refusal above.
 */
export function resolveServedCandidateDir(env = process.env) {
  const raw = env.SAI_CANDIDATE_DIR;
  if (!raw) return { dir: null, factoryProvided: false };
  if (!isAbsolute(raw)) {
    throw new Error(`[candidate-dir] refusing relative SAI_CANDIDATE_DIR: ${raw}`);
  }
  const dir = resolve(raw);
  if (dir === join(ROOT, 'dist')) {
    throw new Error('[candidate-dir] refusing to serve the raw development build; the host spec requires a public projection');
  }
  const stagingRoot = env.SAI_CANDIDATE_STAGING_ROOT;
  if (stagingRoot) {
    const boundary = resolve(stagingRoot);
    if (dir !== boundary && !dir.startsWith(boundary + sep)) {
      throw new Error(`[candidate-dir] refusing ${dir}: outside the staging boundary ${boundary}`);
    }
  }
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(`[candidate-dir] refusing ${dir}: no index.html, not a servable candidate`);
  }
  return { dir, factoryProvided: true };
}

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.xml', 'application/xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
]);

const typeOf = (file) => {
  const dot = file.lastIndexOf('.');
  return CONTENT_TYPES.get(file.slice(dot).toLowerCase()) ?? 'application/octet-stream';
};

/** Serve a directory with static-host semantics. No traversal outside root. */
export function startStaticServer(rootDir, port = 0) {
  const root = resolve(rootDir);
  const server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://candidate.invalid');
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const full = normalize(join(root, rel));
      if (full !== root && !full.startsWith(root + sep)) {
        res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('bad request');
        return;
      }
      let file = null;
      let status = 200;
      let stat = null;
      try {
        stat = lstatSync(full);
      } catch { /* missing */ }
      if (stat && stat.isDirectory()) {
        const index = join(full, 'index.html');
        if (existsSync(index)) file = index;
      } else if (stat && stat.isFile()) {
        file = full;
      } else {
        const asDir = join(full, 'index.html');
        if (existsSync(asDir)) file = asDir;
      }
      if (!file) {
        status = 404;
        const notFound = join(root, '404.html');
        if (existsSync(notFound)) file = notFound;
      }
      if (!file) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('not found');
        return;
      }
      const body = readFileSync(file);
      res.writeHead(status, { 'content-type': typeOf(file) });
      res.end(body);
    } catch {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('server error');
    }
  });
  return new Promise((res, rej) => {
    server.keepAliveTimeout = 1;
    server.once('error', rej);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      res({ server, port: typeof addr === 'object' && addr ? addr.port : port, base: `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : port}` });
    });
  });
}

function firstAsset(rootDir, dir, ext) {
  try {
    return readdirSync(join(rootDir, dir)).filter((f) => f.endsWith(ext)).sort()[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Probe a candidate directory over loopback HTTP.
 * @returns {Promise<{ verdict: string, checks: Array<{id: string, status: string, detail: string}> }>}
 */
export async function probeCandidate(dir, origin) {
  const checks = [];
  const check = (id, ok, detail) => checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
  const { server, base } = await startStaticServer(dir);
  try {
    // One bounded retry: a loopback keep-alive socket can be recycled by the
    // server between pooled requests under parallel test load. A dead server
    // still fails both attempts and the probe reports FAIL as before.
    const get = async (path) => {
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await fetch(`${base}${path}`);
          return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() };
        } catch (error) {
          if (attempt >= 1) throw error;
        }
      }
    };
    const page = async (id, path) => {
      const r = await get(path);
      const ok = r.status === 200 && r.type.includes('text/html');
      check(id, ok, ok ? `${path} serves HTML (${r.status})` : `${path} returned ${r.status} ${r.type}`);
      return r;
    };

    const home = await page('http.home', '/');
    if (home.status === 200) {
      check('http.canonical', home.text.includes(`rel="canonical" href="${origin}/`) || home.text.includes(`rel='canonical' href='${origin}/`) || home.text.includes(`href="${origin}/"`),
        `homepagehead names ${origin}`);
      check('http.opengraph', /property="og:(url|image)"/.test(home.text), 'Open Graph metadata present');
    } else {
      check('http.canonical', false, 'homepage did not load');
      check('http.opengraph', false, 'homepage did not load');
    }
    await page('http.docs', '/docs/getting-started/introduction/');
    await page('http.spec', '/spec/');
    await page('http.search', '/search/');
    await page('http.ecosystem', '/ecosystem/');
    await page('http.pricing', '/pricing/');
    await page('http.blog', '/blog/');
    await page('http.downloads', '/downloads/');

    const missing = await get('/no-such-route-xyz/');
    check('http.not-found', missing.status === 404, `unknown route returns ${missing.status}`);

    const debugPage = await get('/debug/components/');
    check('http.no-diagnostics', debugPage.status === 404, `/debug/components/ returns ${debugPage.status}`);
    const pseudo = await get('/qps-ploc/');
    check('http.no-pseudo-locale', pseudo.status === 404, `/qps-ploc/ returns ${pseudo.status}`);
    const pseudoIndex = await get('/qps-ploc/search-index.json');
    check('http.no-pseudo-index', pseudoIndex.status === 404, `/qps-ploc/search-index.json returns ${pseudoIndex.status}`);

    const robots = await get('/robots.txt');
    check('http.robots', robots.status === 200 && robots.text.includes(`Sitemap: ${origin}/sitemap.xml`),
      `robots.txt names ${origin}/sitemap.xml`);
    const sitemap = await get('/sitemap.xml');
    check('http.sitemap', sitemap.status === 200 && sitemap.text.includes('<urlset') && !sitemap.text.includes('/debug/') && !sitemap.text.includes('/qps-ploc/'),
      'sitemap serves entries without internal routes');
    const llms = await get('/llms.txt');
    check('http.llms', llms.status === 200 && llms.text.includes(`${origin}/`), 'llms.txt serves origin links');
    const twin = await get('/docs/getting-started/introduction.md');
    check('http.markdown-twin', twin.status === 200 && twin.text.length > 0, 'Markdown twin serves');

    const css = firstAsset(dir, '_astro', '.css');
    if (css) {
      const r = await get(`/_astro/${css}`);
      check('http.css', r.status === 200 && r.type.includes('text/css'), `bundle ${css} serves as CSS`);
    } else {
      check('http.css', false, 'no CSS bundle found in candidate');
    }
    const font = await get('/fonts/sai-pixel-12-regular.woff2');
    check('http.font', font.status === 200 && font.type.includes('font/'), `font serves (${font.status} ${font.type})`);
    const card = await get('/social/card.png');
    check('http.social-card', card.status === 200 && card.type.includes('image/png'), 'social card serves');
    const icon = await get('/favicon.ico');
    check('http.favicon', icon.status === 200, `favicon serves (${icon.status})`);

    const traversal = await fetch(`${base}/..%2f..%2fpackage.json`);
    check('http.no-traversal', traversal.status === 400 || traversal.status === 404, `path traversal rejected (${traversal.status})`);
  } finally {
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    await new Promise((res) => server.close(res));
  }
  const verdict = checks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'LOCAL_STATIC_HOST_PASS';
  return { verdict, checks };
}

async function main(argv) {
  const args = { dir: null, origin: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dir = resolve(argv[++i]);
    else if (a === '--origin') args.origin = argv[++i];
    else if (a === '--out') args.out = resolve(argv[++i]);
    else throw new Error(`unknown option ${a}`);
  }
  if (!args.dir) throw new Error('missing required option --dir <candidate>');
  if (!args.origin) throw new Error('missing required option --origin <origin>');
  const { verdict, checks } = await probeCandidate(args.dir, args.origin);
  const report = { tool: 'release-smoke', verdict, origin: args.origin, checks, external: 'hosting-provider compatibility BLOCKED until tested against the selected actual host' };
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(checks.map((c) => `${c.status} ${c.id} — ${c.detail}`).join('\n') + `\nsmoke: ${verdict}\n`);
  return verdict === 'LOCAL_STATIC_HOST_PASS' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`release:smoke error: ${error.message}`);
    process.exit(2);
  });
}
