/**
 * Dependency graph and impact analysis (content-system roadmap M34).
 *
 * Nodes are typed IDs:
 *   source:<id>   registered authority (sources.json)
 *   family:<id>   route family (pages.json)
 *   page:<id>     one built address (inventory record, static page or family member)
 *   block:<id>    stable content block (blocks catalogue, M37)
 *   unit:<locale>:<block id>   translation unit (M43)
 *   gate:<id>     verification gate (tests.json)
 *
 * Edges point from a dependency to its dependant: `source -> page` reads
 * "the page is built from the source", so the impact of a change is every node
 * reachable downstream. The graph is built only from declared data, so the same
 * inputs always produce the same impact set. Pure: no disk, no network.
 */

const sortUnique = (list) => [...new Set(list)].sort();

/** `docs.*` matches `docs.recovery.overview`; anything else must match exactly. */
export function selectorMatches(pattern, id) {
  return pattern.endsWith('.*') ? id.startsWith(pattern.slice(0, -1)) : pattern === id;
}

/**
 * @param {object} input
 * @param {object} input.sourcesDoc   parsed sources.json
 * @param {object} input.registry     parsed pages.json
 * @param {object[]} input.records    inventory records (public + internal)
 * @param {object} [input.testsDoc]   parsed tests.json
 * @param {{nodes?: string[], edges?: [string, string][]}} [input.extra]  blocks, units, models
 */
export function buildGraph({ sourcesDoc, registry, records, testsDoc, extra = {} }) {
  const nodes = new Map();
  const out = new Map();
  const addNode = (id, data = {}) => {
    if (!nodes.has(id)) nodes.set(id, { id, type: id.split(':')[0], ...data });
    if (!out.has(id)) out.set(id, new Set());
  };
  const addEdge = (from, to) => {
    addNode(from);
    addNode(to);
    out.get(from).add(to);
  };

  for (const source of sourcesDoc.sources) addNode(`source:${source.id}`, { kind: source.kind, authority: source.authority });
  for (const family of registry.families) {
    addNode(`family:${family.id}`, { kind: family.kind });
    for (const s of family.sourceIds) addEdge(`source:${s}`, `family:${family.id}`);
  }
  const byEntry = new Map();
  for (const r of records) {
    addNode(`page:${r.id}`, { kind: r.kind, route: r.route, audience: r.audience, nav: r.nav, record: r });
    if (r.entry !== r.id) {
      addEdge(`family:${r.entry}`, `page:${r.id}`);
    } else {
      for (const s of r.sourceIds) addEdge(`source:${s}`, `page:${r.id}`);
    }
    if (!byEntry.has(r.entry)) byEntry.set(r.entry, []);
    byEntry.get(r.entry).push(r);
    // A Markdown twin is produced from the page it mirrors.
    if (r.twinOf) addEdge(`page:${r.twinOf}`, `page:${r.id}`);
  }
  // Outputs assembled from other pages (search index, llms.txt, sitemap...).
  for (const r of records) {
    for (const ref of r.consumes ?? []) {
      const [kind, value] = ref.split(/:(.*)/s);
      const inputs =
        kind === 'flag' ? records.filter((x) => x[value] && x.id !== r.id)
        : kind === 'family' ? byEntry.get(value) ?? []
        : records.filter((x) => x.id === value);
      for (const input of inputs) addEdge(`page:${input.id}`, `page:${r.id}`);
    }
  }
  for (const id of extra.nodes ?? []) addNode(id);
  for (const [from, to] of extra.edges ?? []) addEdge(from, to);

  // Gates hang off everything their selectors cover.
  for (const gate of testsDoc?.gates ?? []) {
    const gid = `gate:${gate.id}`;
    addNode(gid, { command: gate.command });
    for (const sel of gate.covers) {
      const [kind, value] = sel === 'all-html' ? ['all-html', ''] : sel.split(/:(.*)/s);
      for (const node of nodes.values()) {
        const rec = node.record;
        const hit =
          (kind === 'all-html' && rec && rec.kind !== 'machine') ||
          (kind === 'kind' && rec?.kind === value) ||
          (kind === 'nav' && rec?.nav === value) ||
          (kind === 'page' && node.type === 'page' && selectorMatches(value, node.id.slice(5))) ||
          (kind === 'source' && node.type === 'source' && selectorMatches(value, node.id.slice(7)));
        if (hit) addEdge(node.id, gid);
      }
    }
  }
  return { nodes, out };
}

/** Every cycle-closing edge, as `a -> b` strings. A valid graph has none. */
export function findCycles(graph) {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map([...graph.nodes.keys()].map((id) => [id, WHITE]));
  const cycles = [];
  const visit = (id) => {
    colour.set(id, GREY);
    for (const next of graph.out.get(id) ?? []) {
      if (colour.get(next) === GREY) cycles.push(`${id} -> ${next}`);
      else if (colour.get(next) === WHITE) visit(next);
    }
    colour.set(id, BLACK);
  };
  for (const id of [...graph.nodes.keys()].sort()) if (colour.get(id) === WHITE) visit(id);
  return cycles;
}

/** Resolve a bare ID (`pricing`, `vacterro.support.public`, `docs.page`) to a node ID. */
export function resolveNode(graph, id) {
  if (graph.nodes.has(id)) return id;
  const hits = ['source', 'page', 'family', 'block', 'gate'].map((t) => `${t}:${id}`).filter((n) => graph.nodes.has(n));
  return hits.length === 1 ? hits[0] : hits.length ? { ambiguous: hits } : null;
}

/**
 * Impact of changing one node: direct dependants, the transitive closure
 * grouped by type, affected locales and the gates to run. Deterministic order.
 */
export function impact(graph, start) {
  const direct = sortUnique([...(graph.out.get(start) ?? [])]);
  const seen = new Set();
  const queue = [start];
  while (queue.length) {
    const id = queue.shift();
    for (const next of graph.out.get(id) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  const all = sortUnique([...seen]);
  const of = (type) => all.filter((n) => n.startsWith(`${type}:`)).map((n) => n.slice(type.length + 1));
  const units = of('unit');
  return {
    start,
    direct,
    pages: of('page'),
    families: of('family'),
    blocks: of('block'),
    units,
    locales: sortUnique(units.map((u) => u.split(':')[0])),
    gates: of('gate'),
    total: all.length,
  };
}
