/**
 * Page registry contract (content-system roadmap M31).
 *
 * `pages.json` beside this file is the one canonical owner of every public
 * address the site serves: its stable page ID, kind, ownership class,
 * maturity, navigation surface, localization/search/LLM flags and declared
 * source dependencies. `src/data/site.ts` derives the navigation shell from it
 * and the Node gates read it directly, so there is no second route truth.
 *
 * This module is pure: no filesystem, no network. The same functions run
 * inside `astro build` (through site.ts, so an invalid registry fails the
 * build) and inside `scripts/validate-registry.mjs`, which adds the checks that
 * need disk: source locations, the built tree and the derived indexes.
 *
 * Every problem string starts with a stable `[code]` so red controls and
 * agents can match on it.
 */

export const SCHEMA_VERSION = 1;

/** What a page is, independent of how it is produced. */
export const KINDS = ['landing', 'index', 'article', 'reference', 'tool', 'alias', 'debug', 'system', 'machine'];

/**
 * Who owns the words on the page.
 *   editorial    written by a human or agent; sync never overwrites it
 *   generated    reproduced from registered sources; never hand-edited
 *   mixed        editorial frame around generated facts
 *   interactive  bespoke code is the clearer owner (playground, search, benches)
 */
export const OWNERS = ['editorial', 'generated', 'mixed', 'interactive'];

/** MASTER_ROADMAP §1 page maturity. Families may defer it to each entry. */
export const PAGE_MATURITIES = ['placeholder', 'draft', 'experimental', 'preview', 'stable', 'deprecated'];
export const PER_ENTRY = 'per-entry';

export const AUDIENCES = ['public', 'internal'];

/** primary: menu strip; secondary: More panel; debug: inert Debug trail; none: not in shell navigation. */
export const NAVS = ['primary', 'secondary', 'debug', 'none'];

const ENTRY_FIELDS = ['id', 'label', 'intent', 'kind', 'owner', 'maturity', 'audience', 'nav', 'localizable', 'searchable', 'llmVisible', 'sourceIds'];
const PAGE_FIELDS = [...ENTRY_FIELDS, 'route'];
const FAMILY_FIELDS = [...ENTRY_FIELDS, 'routePattern', 'params', 'idTemplate'];
const FAMILY_OPTIONAL = ['twinOf'];
const SOURCE_FIELDS = ['id', 'location', 'note'];
const TOP_FIELDS = ['schemaVersion', 'sources', 'pages', 'families'];

const SEGMENT = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** Dotted lowercase segments: `home`, `docs.index`, `saipen.protocol.registry`. */
export const ID_PATTERN = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*$`);
/** Directory route served as `<route>index.html`: `/`, `/docs/`, `/debug/themes/`. */
const DIR_ROUTE = new RegExp(`^/(?:${SEGMENT}/)*$`);
/** Single-file route: `/404.html`, `/llms.txt`, `/spec/v8/state.schema.json`. */
const FILE_ROUTE = new RegExp(`^/(?:${SEGMENT}/)*[a-z0-9]+(?:[.-][a-z0-9]+)*\\.(html|txt|xml|json|md)$`);

const NON_NAV_KINDS = ['alias', 'system', 'machine'];

/** Shape of a route: `dir`, an extension such as `txt`/`html`, or null when malformed. */
export function routeShape(route) {
  if (typeof route !== 'string') return null;
  if (DIR_ROUTE.test(route)) return 'dir';
  return FILE_ROUTE.exec(route)?.[1] ?? null;
}

/** A page enters sitemap.xml exactly when it is a public, addressable document. */
export function inSitemap(entry) {
  return entry.audience === 'public' && !NON_NAV_KINDS.includes(entry.kind);
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const placeholders = (text) => [...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile `/spec/{version}/{topic}/` into an anchored RegExp with named groups. */
export function compileFamily(family) {
  let source = '^';
  let last = 0;
  for (const m of family.routePattern.matchAll(/\{([a-zA-Z]+)\}/g)) {
    source += escapeRegExp(family.routePattern.slice(last, m.index));
    source += `(?<${m[1]}>${family.params[m[1]]})`;
    last = m.index + m[0].length;
  }
  source += escapeRegExp(family.routePattern.slice(last)) + '$';
  return new RegExp(source);
}

/** Member ID: idTemplate with each placeholder filled, `/` inside a value becoming `.`. */
export function memberId(family, groups) {
  return family.idTemplate.replace(/\{([a-zA-Z]+)\}/g, (_, name) => String(groups[name]).split('/').join('.'));
}

function checkFields(value, where, required, optional, problems) {
  if (!isObject(value)) {
    problems.push(`[malformed] ${where}: expected an object`);
    return false;
  }
  for (const field of required) {
    if (!(field in value)) problems.push(`[missing-field] ${where}: no "${field}"`);
  }
  for (const field of Object.keys(value)) {
    if (!required.includes(field) && !optional.includes(field)) problems.push(`[unknown-field] ${where}: "${field}" is not part of the schema`);
  }
  return true;
}

function checkEnum(value, allowed, where, field, problems) {
  if (value !== undefined && !allowed.includes(value)) {
    problems.push(`[bad-enum] ${where}: ${field} "${value}" is not one of ${allowed.join(' | ')}`);
  }
}

function checkEntry(entry, where, isFamily, sourceIds, problems) {
  if (entry.id !== undefined && (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id))) {
    problems.push(`[bad-id] ${where}: "${entry.id}" is not a dotted lowercase ID`);
  }
  for (const field of ['label', 'intent']) {
    if (field in entry && (typeof entry[field] !== 'string' || !entry[field].trim())) problems.push(`[malformed] ${where}: ${field} must be a non-empty string`);
  }
  for (const field of ['localizable', 'searchable', 'llmVisible']) {
    if (field in entry && typeof entry[field] !== 'boolean') problems.push(`[malformed] ${where}: ${field} must be true or false`);
  }
  checkEnum(entry.kind, KINDS, where, 'kind', problems);
  checkEnum(entry.owner, OWNERS, where, 'owner', problems);
  checkEnum(entry.maturity, isFamily ? [...PAGE_MATURITIES, PER_ENTRY] : PAGE_MATURITIES, where, 'maturity', problems);
  checkEnum(entry.audience, AUDIENCES, where, 'audience', problems);
  checkEnum(entry.nav, NAVS, where, 'nav', problems);

  if ('sourceIds' in entry) {
    if (!Array.isArray(entry.sourceIds)) {
      problems.push(`[malformed] ${where}: sourceIds must be an array`);
    } else {
      const seen = new Set();
      for (const id of entry.sourceIds) {
        if (typeof id !== 'string' || !ID_PATTERN.test(id) || !id.includes('.')) {
          problems.push(`[bad-source-id] ${where}: "${id}" is not a dotted source ID such as saipen.protocol.registry`);
        } else if (!sourceIds.has(id)) {
          problems.push(`[unknown-source] ${where}: "${id}" is not declared in sources`);
        }
        if (seen.has(id)) problems.push(`[duplicate-source] ${where}: "${id}" listed twice`);
        seen.add(id);
      }
    }
  }

  // Cross-field contracts. Each one encodes a promise another part of the
  // site relies on; breaking it would make the flags lie.
  const internal = entry.audience === 'internal';
  if (internal !== (entry.nav === 'debug') || internal !== (entry.kind === 'debug')) {
    problems.push(`[contract] ${where}: audience internal, nav debug and kind debug must go together`);
  }
  if (internal && (entry.localizable || entry.searchable || entry.llmVisible)) {
    problems.push(`[contract] ${where}: an internal page cannot be localizable, searchable or LLM-visible`);
  }
  if ((entry.nav === 'primary' || entry.nav === 'secondary') && (entry.audience !== 'public' || NON_NAV_KINDS.includes(entry.kind))) {
    problems.push(`[contract] ${where}: only a public, addressable page can sit in the ${entry.nav} navigation`);
  }
  if (entry.kind === 'alias' && (entry.owner !== 'generated' || entry.nav !== 'none' || entry.searchable || entry.llmVisible)) {
    problems.push(`[contract] ${where}: an alias is generated, outside navigation, and neither searchable nor LLM-visible`);
  }
  if (entry.kind === 'machine' && (entry.localizable || entry.searchable || entry.nav !== 'none')) {
    problems.push(`[contract] ${where}: a machine output is not localizable, not searchable and not in navigation`);
  }
  if (isFamily && entry.nav !== undefined && entry.nav !== 'none') {
    problems.push(`[contract] ${where}: a family is never in shell navigation (nav must be none)`);
  }
}

function checkRouteKind(route, kind, where, problems) {
  const shape = routeShape(route);
  if (!shape) return;
  if (kind === 'machine' && (shape === 'dir' || shape === 'html')) problems.push(`[contract] ${where}: a machine output needs a non-HTML file route, got ${route}`);
  if (kind === 'system' && shape !== 'html') problems.push(`[contract] ${where}: a system page is a single .html file, got ${route}`);
  if (kind !== 'machine' && kind !== 'system' && shape !== 'dir') problems.push(`[contract] ${where}: a ${kind} page needs a directory route, got ${route}`);
}

/**
 * Validate a parsed registry. Returns problem strings; empty means valid.
 * Covers shape, closed enums, ID/route/source syntax, uniqueness, family
 * patterns and static-versus-family ambiguity. Nothing here reads disk.
 */
export function validateRegistry(registry) {
  const problems = [];
  if (!checkFields(registry, 'registry', TOP_FIELDS, [], problems)) return problems;
  if (registry.schemaVersion !== SCHEMA_VERSION) problems.push(`[schema-version] registry: schemaVersion ${registry.schemaVersion} is not ${SCHEMA_VERSION}`);
  for (const list of ['sources', 'pages', 'families']) {
    if (!Array.isArray(registry[list])) problems.push(`[malformed] registry: ${list} must be an array`);
  }
  if (problems.length) return problems;

  const sourceIds = new Set();
  registry.sources.forEach((source, i) => {
    const where = `sources[${i}]${source?.id ? ` ${source.id}` : ''}`;
    if (!checkFields(source, where, SOURCE_FIELDS, [], problems)) return;
    if (typeof source.id !== 'string' || !ID_PATTERN.test(source.id) || !source.id.includes('.')) problems.push(`[bad-source-id] ${where}: "${source.id}" is not a dotted source ID`);
    else if (sourceIds.has(source.id)) problems.push(`[duplicate-source] ${where}: declared twice`);
    sourceIds.add(source.id);
    for (const field of ['location', 'note']) {
      if (typeof source[field] !== 'string' || !source[field].trim()) problems.push(`[malformed] ${where}: ${field} must be a non-empty string`);
    }
  });

  const ids = new Map();
  const claimId = (id, where) => {
    if (typeof id !== 'string') return;
    if (ids.has(id)) problems.push(`[duplicate-id] ${where}: "${id}" is already used by ${ids.get(id)}`);
    else ids.set(id, where);
  };
  const routes = new Map();

  registry.pages.forEach((page, i) => {
    const where = `pages[${i}]${page?.id ? ` ${page.id}` : ''}`;
    if (!checkFields(page, where, PAGE_FIELDS, [], problems)) return;
    checkEntry(page, where, false, sourceIds, problems);
    claimId(page.id, where);
    if (!routeShape(page.route)) {
      problems.push(`[bad-route] ${where}: "${page.route}" is not a lowercase /dir/ route or a /file.ext route`);
    } else {
      checkRouteKind(page.route, page.kind, where, problems);
      if (routes.has(page.route)) problems.push(`[duplicate-route] ${where}: ${page.route} is already declared by ${routes.get(page.route)}`);
      else routes.set(page.route, where);
    }
  });

  const families = new Map();
  registry.families.forEach((family, i) => {
    const where = `families[${i}]${family?.id ? ` ${family.id}` : ''}`;
    if (!checkFields(family, where, FAMILY_FIELDS, FAMILY_OPTIONAL, problems)) return;
    checkEntry(family, where, true, sourceIds, problems);
    claimId(family.id, where);
    families.set(family.id, family);

    const pattern = family.routePattern;
    if (typeof pattern !== 'string' || !isObject(family.params) || typeof family.idTemplate !== 'string') {
      problems.push(`[bad-pattern] ${where}: routePattern, params and idTemplate are required and typed`);
      return;
    }
    const used = placeholders(pattern);
    const declared = Object.keys(family.params);
    if (!used.length) problems.push(`[bad-pattern] ${where}: routePattern has no {placeholder}; declare a static page instead`);
    for (const name of used) if (!declared.includes(name)) problems.push(`[bad-pattern] ${where}: {${name}} has no params entry`);
    for (const name of declared) if (!used.includes(name)) problems.push(`[bad-pattern] ${where}: param "${name}" is not used in routePattern`);
    const inId = placeholders(family.idTemplate);
    for (const name of declared) if (!inId.includes(name)) problems.push(`[bad-pattern] ${where}: param "${name}" is missing from idTemplate, so member IDs could collide`);
    for (const name of inId) if (!declared.includes(name)) problems.push(`[bad-pattern] ${where}: idTemplate {${name}} has no params entry`);
    for (const [name, rx] of Object.entries(family.params)) {
      try {
        new RegExp(rx);
      } catch {
        problems.push(`[bad-pattern] ${where}: param "${name}" is not a valid regular expression`);
      }
    }
    // The pattern must itself be a well-formed route once filled with a sample.
    const sample = pattern.replace(/\{[a-zA-Z]+\}/g, 'x');
    if (!routeShape(sample)) problems.push(`[bad-route] ${where}: routePattern ${pattern} does not describe a valid route`);
    else checkRouteKind(sample, family.kind, where, problems);
  });

  for (const family of families.values()) {
    if (family.twinOf === undefined) continue;
    const target = families.get(family.twinOf);
    if (!target) problems.push(`[bad-twin] family ${family.id}: twinOf "${family.twinOf}" is not a family`);
    else if (target.twinOf !== undefined) problems.push(`[bad-twin] family ${family.id}: twinOf "${family.twinOf}" is itself a twin`);
    if (family.kind !== 'machine') problems.push(`[bad-twin] family ${family.id}: a twin is a machine rendition of another family`);
  }

  // Every declared source is a dependency of something; an unused one is dead weight.
  const used = new Set([...registry.pages, ...registry.families].flatMap((entry) => (Array.isArray(entry?.sourceIds) ? entry.sourceIds : [])));
  for (const id of sourceIds) if (!used.has(id)) problems.push(`[unused-source] sources ${id}: no page or family depends on it`);

  // A static route that a family pattern also matches would resolve twice.
  if (!problems.some((p) => p.startsWith('[bad-pattern]'))) {
    for (const family of families.values()) {
      const rx = compileFamily(family);
      for (const route of routes.keys()) if (rx.test(route)) problems.push(`[ambiguous-route] ${route}: declared statically and matched by family ${family.id}`);
    }
  }
  return problems;
}

/** Throws one error listing every problem. Used where an invalid registry must stop the build. */
export function assertValidRegistry(registry, label = 'src/content-engine/registry/pages.json') {
  const problems = validateRegistry(registry);
  if (problems.length) throw new Error(`${label} is invalid:\n  ${problems.join('\n  ')}`);
  return registry;
}

function record(entry, route, id, origin) {
  return {
    id,
    route,
    entry: origin,
    kind: entry.kind,
    owner: entry.owner,
    maturity: entry.maturity,
    audience: entry.audience,
    nav: entry.nav,
    localizable: entry.localizable,
    searchable: entry.searchable,
    llmVisible: entry.llmVisible,
    sitemap: inSitemap(entry),
    sourceIds: [...entry.sourceIds],
  };
}

/**
 * Reconcile a valid registry with the routes that actually exist in the built
 * site. Every built route must resolve to exactly one entry, every static page
 * must be built and every family must have members. Returns the per-route
 * inventory (sorted, deterministic) and any problems.
 */
export function buildInventory(registry, builtRoutes) {
  const problems = [];
  const statics = new Map(registry.pages.map((page) => [page.route, page]));
  const families = registry.families.map((family) => ({ family, rx: compileFamily(family) }));
  const records = [];
  const ids = new Map([...registry.pages.map((p) => [p.id, `page ${p.route}`]), ...registry.families.map((f) => [f.id, `family ${f.routePattern}`])]);
  const members = new Map(registry.families.map((family) => [family.id, 0]));

  for (const route of [...new Set(builtRoutes)].sort()) {
    const page = statics.get(route);
    const hits = families.map(({ family, rx }) => ({ family, m: rx.exec(route) })).filter((hit) => hit.m);
    if (page && hits.length) {
      problems.push(`[ambiguous-route] ${route}: page ${page.id} and family ${hits[0].family.id} both match`);
      continue;
    }
    if (hits.length > 1) {
      problems.push(`[ambiguous-route] ${route}: matched by families ${hits.map((h) => h.family.id).join(', ')}`);
      continue;
    }
    if (page) {
      records.push(record(page, route, page.id, page.id));
      continue;
    }
    if (!hits.length) {
      problems.push(`[unregistered-route] ${route}: built but not declared in the page registry`);
      continue;
    }
    const { family, m } = hits[0];
    const id = memberId(family, m.groups ?? {});
    if (!ID_PATTERN.test(id)) problems.push(`[bad-id] ${route}: member ID "${id}" of family ${family.id} is not a dotted lowercase ID`);
    if (ids.has(id)) problems.push(`[duplicate-id] ${route}: member ID "${id}" collides with ${ids.get(id)}`);
    ids.set(id, `member ${route}`);
    members.set(family.id, members.get(family.id) + 1);
    const entry = record(family, route, id, family.id);
    if (family.twinOf) {
      const twinFamily = registry.families.find((f) => f.id === family.twinOf);
      entry.twinOf = memberId(twinFamily, m.groups ?? {});
    }
    records.push(entry);
  }

  const built = new Set(builtRoutes);
  for (const page of registry.pages) {
    if (!built.has(page.route)) problems.push(`[missing-route] ${page.route}: declared as ${page.id} but not present in the built site`);
  }
  for (const [id, count] of members) {
    if (!count) problems.push(`[empty-family] ${id}: no built route matches this family`);
  }
  const byId = new Set(records.map((r) => r.id));
  for (const r of records) {
    if (r.twinOf && !byId.has(r.twinOf)) problems.push(`[orphan-twin] ${r.route}: twin page ${r.twinOf} was not built`);
  }

  const count = (list, field) => Object.fromEntries([...new Set(list.map((r) => r[field]))].sort().map((v) => [v, list.filter((r) => r[field] === v).length]));
  const publicRecords = records.filter((r) => r.audience === 'public');
  const internalRecords = records.filter((r) => r.audience === 'internal');
  const inventory = {
    schemaVersion: SCHEMA_VERSION,
    generator: 'scripts/validate-registry.mjs --write',
    registry: 'src/content-engine/registry/pages.json',
    totals: {
      routes: records.length,
      public: publicRecords.length,
      internal: internalRecords.length,
      byKind: count(records, 'kind'),
      byOwner: count(records, 'owner'),
      flags: {
        localizable: records.filter((r) => r.localizable).length,
        searchable: records.filter((r) => r.searchable).length,
        llmVisible: records.filter((r) => r.llmVisible).length,
        sitemap: records.filter((r) => r.sitemap).length,
      },
    },
    public: publicRecords,
    internal: internalRecords,
  };
  return { inventory, problems };
}
