/**
 * Page registry gate (content-system roadmap M31).
 *
 * Checks, in order:
 *   1. schema         src/content-engine/registry/pages.json against schema.mjs
 *   2. sources        every declared source location exists on disk
 *   3. built site     every built route resolves to exactly one registry entry,
 *                     every static page is built, every family has members
 *   4. flags          searchable / llmVisible / sitemap tell the truth about
 *                     search-index.json, llms.txt and sitemap.xml
 *   5. red controls   the gate proves it can fail: mutated copies of the real
 *                     registry must each be rejected with the expected code
 *   6. inventory      src/content-engine/inventory/pages.inventory.json equals
 *                     the inventory computed from registry + built site
 *
 * Run after `npm run build`:
 *   node scripts/validate-registry.mjs            check (CI)
 *   node scripts/validate-registry.mjs --write    regenerate the inventory
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { buildInventory, validateRegistry } from '../src/content-engine/registry/schema.mjs';

const REGISTRY = 'src/content-engine/registry/pages.json';
const INVENTORY = 'src/content-engine/inventory/pages.inventory.json';
const DIST = 'dist';
/** Static asset trees: files there are resources of pages, not addressable documents. */
const ASSET_DIRS = new Set(['_astro', 'fonts', 'media', 'social']);
const DOCUMENT_EXT = /\.(html|txt|xml|json|md)$/;

const write = process.argv.includes('--write');

if (!existsSync(DIST)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(2);
}

/** Every addressable document in dist/, as the route a visitor would request. */
function builtRoutes(dist = DIST) {
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

const pathOf = (url) => {
  const u = new URL(url, 'https://registry.invalid');
  return u.pathname;
};

/**
 * The three discovery outputs must agree with the flags, in both directions:
 * an index entry for a page that says it is not indexed is as much a lie as a
 * flagged page that no index mentions.
 */
function checkDiscovery(records, dist = DIST) {
  const problems = [];
  const byRoute = new Map(records.map((r) => [r.route, r]));

  const search = JSON.parse(readFileSync(join(dist, 'search-index.json'), 'utf8'));
  const searched = new Set(search.map((entry) => pathOf(entry.url)));
  for (const route of searched) {
    const r = byRoute.get(route);
    if (!r) problems.push(`[flag-searchable] search-index.json points at ${route}, which is not a registered route`);
    else if (!r.searchable) problems.push(`[flag-searchable] ${r.id}: in search-index.json but declared searchable: false`);
  }
  for (const r of records) if (r.searchable && !searched.has(r.route)) problems.push(`[flag-searchable] ${r.id}: declared searchable but absent from search-index.json`);

  const llms = readFileSync(join(dist, 'llms.txt'), 'utf8');
  const listed = new Set([...llms.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map((m) => pathOf(m[1])));
  const credited = new Set();
  for (const route of listed) {
    const r = byRoute.get(route);
    if (!r) {
      problems.push(`[flag-llm] llms.txt points at ${route}, which is not a registered route`);
      continue;
    }
    if (!r.llmVisible) problems.push(`[flag-llm] ${r.id}: listed in llms.txt but declared llmVisible: false`);
    credited.add(r.id);
    if (r.twinOf) credited.add(r.twinOf);
  }
  for (const r of records) if (r.llmVisible && !credited.has(r.id)) problems.push(`[flag-llm] ${r.id}: declared llmVisible but neither it nor a twin is listed in llms.txt`);

  const sitemap = readFileSync(join(dist, 'sitemap.xml'), 'utf8');
  const located = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1])));
  for (const route of located) {
    const r = byRoute.get(route);
    if (!r) problems.push(`[flag-sitemap] sitemap.xml lists ${route}, which is not a registered route`);
    else if (!r.sitemap) problems.push(`[flag-sitemap] ${r.id}: in sitemap.xml but a ${r.audience} ${r.kind} page is not indexable`);
  }
  for (const r of records) if (r.sitemap && !located.has(r.route)) problems.push(`[flag-sitemap] ${r.id}: an indexable page absent from sitemap.xml`);
  return problems;
}

const records = (inventory) => [...inventory.public, ...inventory.internal];

function audit(registry, routes) {
  const problems = validateRegistry(registry);
  if (problems.length) return { problems };
  const { inventory, problems: built } = buildInventory(registry, routes);
  if (built.length) return { problems: built, inventory };
  return { problems: checkDiscovery(records(inventory)), inventory };
}

let failures = 0;
const fail = (msg) => {
  failures++;
  console.log('  FAIL ' + msg);
};

const text = readFileSync(REGISTRY, 'utf8');
const registry = JSON.parse(text);
const routes = builtRoutes();
const clone = () => JSON.parse(text);
const pageOf = (reg, id) => reg.pages.find((p) => p.id === id);

// ---------------------------------------------------------------------------
// 1-4. The real registry against schema, disk, built site and indexes.
// ---------------------------------------------------------------------------
console.log('REGISTRY ' + REGISTRY);
const { problems, inventory } = audit(registry, routes);
for (const p of problems) fail(p);
for (const source of registry.sources) {
  if (!existsSync(source.location)) fail(`[missing-source] ${source.id}: location ${source.location} does not exist`);
}
console.log(`  ${registry.pages.length} pages, ${registry.families.length} families, ${registry.sources.length} sources`);
if (inventory) {
  const t = inventory.totals;
  console.log(`  built routes ${routes.length} -> ${t.routes} registered (${t.public} public, ${t.internal} internal)`);
  console.log(`  kinds  ${Object.entries(t.byKind).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`  owners ${Object.entries(t.byOwner).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`  flags  localizable ${t.flags.localizable}, searchable ${t.flags.searchable}, llmVisible ${t.flags.llmVisible}, sitemap ${t.flags.sitemap}`);
}

// ---------------------------------------------------------------------------
// 5. Red controls. Each mutates a fresh copy of the real registry (never the
//    file) and must be rejected with its code. A control that stays green
//    means the gate has gone blind, which is a failure in its own right.
//    They need a valid baseline, so they run only once the real registry
//    passes; a broken registry is reported above instead of crashing here.
// ---------------------------------------------------------------------------
const CONTROLS = [
  ['duplicate page ID', '[duplicate-id]', (reg) => { pageOf(reg, 'pricing').id = 'about'; }],
  ['duplicate route', '[duplicate-route]', (reg) => { pageOf(reg, 'pricing').route = '/about/'; }],
  ['built public route missing from registry', '[unregistered-route]', (reg) => { reg.pages = reg.pages.filter((p) => p.id !== 'community'); }],
  ['declared route never built', '[missing-route]', (reg) => { reg.pages.push({ ...pageOf(reg, 'pricing'), id: 'ghost', route: '/ghost/' }); }],
  ['malformed route', '[bad-route]', (reg) => { pageOf(reg, 'pricing').route = '/Pricing'; }],
  ['unknown owner', '[bad-enum]', (reg) => { pageOf(reg, 'pricing').owner = 'marketing'; }],
  ['unknown kind', '[bad-enum]', (reg) => { pageOf(reg, 'pricing').kind = 'landingpage'; }],
  ['missing required field', '[missing-field]', (reg) => { delete pageOf(reg, 'pricing').localizable; }],
  ['source ID syntax error', '[bad-source-id]', (reg) => { pageOf(reg, 'pricing').sourceIds = ['Support Data']; }],
  ['undeclared source ID', '[unknown-source]', (reg) => { pageOf(reg, 'pricing').sourceIds = ['vacterro.support.private']; }],
  ['route claimed by a page and a family', '[ambiguous-route]', (reg) => { reg.pages.push({ ...pageOf(reg, 'pricing'), id: 'shadow', route: '/blog/shadow/' }); }],
  ['empty family', '[empty-family]', (reg) => { reg.families.push({ ...reg.families.find((f) => f.id === 'blog.post'), id: 'news.post', routePattern: '/news/{slug}/', idTemplate: 'news.{slug}' }); }],
  ['searchable flag lie', '[flag-searchable]', (reg) => { pageOf(reg, 'about').searchable = true; }],
  ['LLM flag lie', '[flag-llm]', (reg) => { pageOf(reg, 'security').llmVisible = false; }],
];

console.log('\nRED CONTROLS');
if (problems.length) {
  console.log('  skipped: the real registry must pass before its mutations mean anything');
} else {
  for (const [name, code, mutate] of CONTROLS) {
    let found;
    try {
      const reg = clone();
      mutate(reg);
      found = audit(reg, routes).problems;
    } catch (error) {
      found = [`[crash] ${error.message}`];
    }
    const fired = found.some((p) => p.startsWith(code));
    if (!fired) fail(`red control "${name}" did not produce ${code}${found.length ? ' (got ' + found[0] + ')' : ' (registry accepted)'}`);
    console.log(`  ${fired ? 'RED ' : 'MISS'} ${name} -> ${code}`);
  }
}

// ---------------------------------------------------------------------------
// 6. Inventory artifact. Generated, committed, never hand-edited: a stale copy
//    fails here with the command that refreshes it.
// ---------------------------------------------------------------------------
console.log('\nINVENTORY ' + INVENTORY);
if (inventory && !problems.length) {
  const fresh = JSON.stringify(inventory, null, 2) + '\n';
  if (write) {
    writeFileSync(INVENTORY, fresh);
    console.log('  written');
  } else if (!existsSync(INVENTORY)) {
    fail(`${INVENTORY} does not exist — run npm run registry:inventory`);
  } else if (readFileSync(INVENTORY, 'utf8').replace(/\r\n/g, '\n') !== fresh) {
    fail(`${INVENTORY} is stale against the registry and the built site — run npm run registry:inventory`);
  } else {
    console.log('  current');
  }
} else {
  console.log('  skipped: registry problems above');
}

console.log(failures ? `\nFAILED: ${failures} registry problem(s)` : `\nOK: ${CONTROLS.length} red controls fired, registry and inventory current`);
process.exit(failures ? 1 : 0);
