/**
 * The built site as the registry sees it. Node only: reads dist/.
 *
 * builtRoutes() lists every addressable document a visitor can request;
 * checkDiscovery() proves the searchable / llmVisible / sitemap flags of the
 * inventory against the discovery outputs that were actually built.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Static asset trees: files there are resources of pages, not addressable documents. */
export const ASSET_DIRS = new Set(['_astro', 'fonts', 'media', 'social']);
const DOCUMENT_EXT = /\.(html|txt|xml|json|md)$/;

/** Every addressable document in dist/, as the route a visitor would request. */
export function builtRoutes(dist = 'dist') {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      const rel = relative(dist, full).split(sep).join('/');
      if (e.isDirectory()) {
        if (!(dir === dist && ASSET_DIRS.has(e.name))) walk(full);
      } else if (e.name === 'index.html') {
        out.push('/' + rel.replace(/index\.html$/, ''));
      } else if (DOCUMENT_EXT.test(e.name)) {
        out.push('/' + rel);
      }
    }
  })(dist);
  return out.sort();
}

const pathOf = (url) => new URL(url, 'https://registry.invalid').pathname;

/**
 * The discovery outputs must agree with the flags in both directions: an index
 * entry for a page that says it is not indexed is as much a lie as a flagged
 * page that no index mentions. `files` lets a caller check a locale's outputs.
 */
export function checkDiscovery(records, dist = 'dist', files = { search: 'search-index.json', llms: 'llms.txt', sitemap: 'sitemap.xml' }) {
  const problems = [];
  const byRoute = new Map(records.map((r) => [r.route, r]));
  if (files.search) problems.push(...checkSearch(records, byRoute, dist, files.search));
  if (files.llms) problems.push(...checkLlms(records, byRoute, dist, files.llms));
  if (files.sitemap) problems.push(...checkSitemap(records, byRoute, dist, files.sitemap));
  return problems;
}

function checkSearch(records, byRoute, dist, file) {
  const problems = [];
  const files = { search: file };
  const search = JSON.parse(readFileSync(join(dist, files.search), 'utf8'));
  const searched = new Set(search.map((entry) => pathOf(entry.url)));
  for (const route of searched) {
    const r = byRoute.get(route);
    if (!r) problems.push(`[flag-searchable] ${files.search} points at ${route}, which is not a registered route`);
    else if (!r.searchable) problems.push(`[flag-searchable] ${r.id}: in ${files.search} but declared searchable: false`);
  }
  for (const r of records) if (r.searchable && !searched.has(r.route)) problems.push(`[flag-searchable] ${r.id}: declared searchable but absent from ${files.search}`);
  return problems;
}

function checkLlms(records, byRoute, dist, file) {
  const problems = [];
  const files = { llms: file };
  const llms = readFileSync(join(dist, files.llms), 'utf8');
  const listed = new Set([...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => pathOf(m[1])));
  const credited = new Set();
  for (const route of listed) {
    const r = byRoute.get(route);
    if (!r) {
      problems.push(`[flag-llm] ${files.llms} points at ${route}, which is not a registered route`);
      continue;
    }
    if (!r.llmVisible) problems.push(`[flag-llm] ${r.id}: listed in ${files.llms} but declared llmVisible: false`);
    credited.add(r.id);
    if (r.twinOf) credited.add(r.twinOf);
  }
  for (const r of records) if (r.llmVisible && !credited.has(r.id)) problems.push(`[flag-llm] ${r.id}: declared llmVisible but neither it nor a twin is listed in ${files.llms}`);
  return problems;
}

function checkSitemap(records, byRoute, dist, file) {
  const problems = [];
  const files = { sitemap: file };
  const sitemap = readFileSync(join(dist, files.sitemap), 'utf8');
  const located = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1])));
  for (const route of located) {
    const r = byRoute.get(route);
    if (!r) problems.push(`[flag-sitemap] ${files.sitemap} lists ${route}, which is not a registered route`);
    else if (!r.sitemap) problems.push(`[flag-sitemap] ${r.id}: in ${files.sitemap} but a ${r.audience} ${r.kind} page is not indexable`);
  }
  for (const r of records) if (r.sitemap && !located.has(r.route)) problems.push(`[flag-sitemap] ${r.id}: an indexable page absent from ${files.sitemap}`);
  return problems;
}
