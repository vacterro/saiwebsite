/**
 * Page registry gate (content-system roadmap M31).
 *
 * Checks, in order:
 *   1. schema         pages.json against schema.mjs, sources.json against sources.mjs
 *   2. sources        every declared source path exists on disk
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { builtRoutes, checkDiscovery } from '../src/content-engine/inventory/built.mjs';
import { buildInventory, validateRegistry } from '../src/content-engine/registry/schema.mjs';
import { sourceIdsOf, validateSources } from '../src/content-engine/registry/sources.mjs';

const REGISTRY = 'src/content-engine/registry/pages.json';
const SOURCES = 'src/content-engine/registry/sources.json';
const INVENTORY = 'src/content-engine/inventory/pages.inventory.json';
const DIST = 'dist';
const write = process.argv.includes('--write');

if (!existsSync(DIST)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(2);
}

const records = (inventory) => [...inventory.public, ...inventory.internal];

function audit(registry, routes) {
  const problems = validateRegistry(registry, declared);
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

const sourceDoc = JSON.parse(readFileSync(SOURCES, 'utf8'));
const declared = sourceIdsOf(sourceDoc);
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
for (const p of validateSources(sourceDoc)) fail(p);
for (const p of problems) fail(p);
for (const source of sourceDoc.sources) {
  for (const path of source.paths ?? []) if (!existsSync(path)) fail(`[missing-source] ${source.id}: path ${path} does not exist`);
}
console.log(`  ${registry.pages.length} pages, ${registry.families.length} families, ${sourceDoc.sources.length} sources`);
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
    fail(`${INVENTORY} does not exist — run npm run site:refresh`);
  } else if (readFileSync(INVENTORY, 'utf8').replace(/\r\n/g, '\n') !== fresh) {
    fail(`${INVENTORY} is stale against the registry and the built site — run npm run site:refresh`);
  } else {
    console.log('  current');
  }
} else {
  console.log('  skipped: registry problems above');
}

console.log(failures ? `\nFAILED: ${failures} registry problem(s)` : `\nOK: ${CONTROLS.length} red controls fired, registry and inventory current`);
process.exit(failures ? 1 : 0);
