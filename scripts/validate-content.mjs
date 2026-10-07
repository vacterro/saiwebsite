/**
 * Content validation of the BUILT site (MASTER_ROADMAP M17).
 *
 * Fails on:
 *   broken-link     an internal href/src that resolves to no file in dist/
 *   broken-anchor   a #fragment (same page or another page) with no element id
 *   duplicate-id    the same id twice on one page
 *   alt             an <img> without an alt attribute
 *   meta            a page without a description or canonical link
 *
 * Front-matter shape, duplicate slugs and maturity values are enforced earlier,
 * by the content collection schema during `astro build`.
 * Run after `npm run build`: node scripts/validate-content.mjs
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const DIST = 'dist';
if (!existsSync(DIST)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(2);
}

const pages = new Map(); // url path -> { file, ids:Set, html }
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name.endsWith('.html')) {
      const rel = relative(DIST, full).split(sep).join('/');
      const url = rel === 'index.html' ? '/' : rel.endsWith('/index.html') || rel === 'index.html' ? `/${rel.replace(/index\.html$/, '')}` : `/${rel}`;
      pages.set(url, { file: full, html: readFileSync(full, 'utf8') });
    }
  }
})(DIST);

const problems = [];
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

for (const [url, page] of pages) {
  const ids = [...page.html.matchAll(/\sid="([^"]+)"/g)].map((m) => decode(m[1]));
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) problems.push(`[duplicate-id] ${url}: id="${id}" appears more than once`);
    seen.add(id);
  }
  page.ids = seen;
}

function resolve(path) {
  if (pages.has(path)) return { kind: 'page', page: pages.get(path) };
  const file = join(DIST, decodeURI(path));
  if (existsSync(file) && statSync(file).isFile()) return { kind: 'file' };
  if (existsSync(join(file, 'index.html'))) return { kind: 'page', page: pages.get(path.endsWith('/') ? path : `${path}/`) };
  return null;
}

let links = 0;
let anchors = 0;
for (const [url, page] of pages) {
  const html = page.html.replace(/<script[\s\S]*?<\/script>/g, '');
  for (const m of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    const raw = decode(m[1]);
    if (/^(https?:|mailto:|data:|javascript:)/.test(raw)) continue;
    if (raw.startsWith('#')) {
      anchors++;
      const id = raw.slice(1);
      if (id && !page.ids.has(id)) problems.push(`[broken-anchor] ${url}: #${id} has no target on the same page`);
      continue;
    }
    if (!raw.startsWith('/')) {
      problems.push(`[broken-link] ${url}: relative link "${raw}" — every internal link must be root-relative`);
      continue;
    }
    links++;
    const [pathPart, fragment] = raw.split('#');
    const path = pathPart.split('?')[0];
    const target = resolve(path);
    if (!target) {
      problems.push(`[broken-link] ${url}: ${raw} resolves to nothing in dist/`);
      continue;
    }
    if (fragment) {
      anchors++;
      if (target.kind === 'page' && target.page && !target.page.ids.has(fragment)) {
        problems.push(`[broken-anchor] ${url}: ${raw} — target page has no id "${fragment}"`);
      }
    }
  }
  for (const m of page.html.matchAll(/<img\b[^>]*>/g)) {
    if (!/\salt=/.test(m[0])) problems.push(`[alt] ${url}: <img> without alt`);
  }
  if (!/<meta name="description" content="[^"]{20,}"/.test(page.html)) problems.push(`[meta] ${url}: missing or too-short meta description`);
  if (!/<link rel="canonical" href="https:\/\/[^"]+"/.test(page.html)) problems.push(`[meta] ${url}: no canonical link`);
}

if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\nFAILED: ${problems.length} content problem(s) across ${pages.size} pages`);
  process.exit(1);
}
console.log(`OK: ${pages.size} pages, ${links} internal links and ${anchors} anchors resolve, no duplicate ids`);
