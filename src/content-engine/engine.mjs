/**
 * Content-engine loader. Node only.
 *
 * One function reads every registry, validates it, reconciles it with the
 * built site when dist/ exists, recomputes the generated manifests in memory
 * and builds the dependency graph. site:doctor, site:impact, site:refresh and
 * the i18n commands all start here, so they cannot disagree about the state of
 * the tree.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildInventory, validateRegistry } from './registry/schema.mjs';
import { sourceIdsOf, validateSources } from './registry/sources.mjs';
import { builtRoutes, checkDiscovery } from './inventory/built.mjs';
import { computeLock, diffLock, LOCK_FILE, serialize } from './sources/lock.mjs';
import { checkIntegrity, validateGenerated } from './generated/integrity.mjs';
import { buildGraph, findCycles } from './graph/graph.mjs';

export const FILES = {
  pages: 'src/content-engine/registry/pages.json',
  sources: 'src/content-engine/registry/sources.json',
  tests: 'src/content-engine/registry/tests.json',
  generated: 'src/content-engine/registry/generated.json',
  inventory: 'src/content-engine/inventory/pages.inventory.json',
  lock: LOCK_FILE,
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readText = (path) => (existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : null);

/** Hooks let later milestones (blocks, i18n) add graph nodes and manifests without forking the loader. */
const extensions = [];
export function registerExtension(ext) {
  extensions.push(ext);
}

export function loadEngine({ root = '.', dist = 'dist', overrides = {} } = {}) {
  const at = (p) => join(root, p);
  const sourcesDoc = overrides.sourcesDoc ?? readJson(at(FILES.sources));
  const registry = overrides.registry ?? readJson(at(FILES.pages));
  const testsDoc = overrides.testsDoc ?? readJson(at(FILES.tests));
  const generatedDoc = overrides.generatedDoc ?? readJson(at(FILES.generated));
  const declared = sourceIdsOf(sourcesDoc);

  const contracts = [...validateSources(sourcesDoc), ...validateRegistry(registry, declared), ...validateGenerated(generatedDoc, declared)];

  // Built site: inventory + discovery flags. Without dist/ these are UNKNOWN, not failures.
  const hasDist = existsSync(at(dist));
  let inventory = null;
  let records = [];
  if (hasDist && !contracts.length) {
    const built = buildInventory(registry, overrides.routes ?? builtRoutes(at(dist)));
    contracts.push(...built.problems);
    inventory = built.inventory;
    records = [...inventory.public, ...inventory.internal];
    if (!built.problems.length) contracts.push(...checkDiscovery(records, at(dist)));
  } else if (!hasDist && !contracts.length) {
    // Offline: reuse the committed inventory so the graph still works.
    const committed = readText(at(FILES.inventory));
    if (committed) records = [...JSON.parse(committed).public, ...JSON.parse(committed).internal];
  }

  const { lock, problems: lockProblems } = computeLock(sourcesDoc, root);
  contracts.push(...lockProblems);
  const committedLockText = overrides.committedLock ?? readText(at(FILES.lock));
  const committedLock = committedLockText ? JSON.parse(committedLockText) : null;
  const sourceStates = diffLock(committedLock, lock);

  const engine = {
    root,
    files: FILES,
    hasDist,
    sourcesDoc,
    registry,
    testsDoc,
    generatedDoc,
    inventory,
    records,
    lock,
    sourceStates,
    contracts,
    manifests: [],
    extraGraph: { nodes: [], edges: [] },
    translations: [],
  };

  // Generated manifests the engine owns: compare the committed text with a fresh rendering.
  engine.manifests.push({
    id: 'content-engine.source-lock',
    path: FILES.lock,
    fresh: serialize(lock),
    committed: committedLockText,
  });
  if (inventory) {
    engine.manifests.push({
      id: 'content-engine.inventory',
      path: FILES.inventory,
      fresh: serialize(inventory),
      committed: overrides.committedInventory ?? readText(at(FILES.inventory)),
    });
  }

  for (const ext of extensions) ext(engine, { at, overrides });

  engine.integrity = generatedDoc.artifacts.flatMap((a) => checkIntegrity(a, root));
  engine.graph = buildGraph({ sourcesDoc, registry, records, testsDoc, extra: engine.extraGraph });
  engine.cycles = findCycles(engine.graph);
  return engine;
}

/** Manifest states: CURRENT, STALE (differs), MISSING (never written). */
export function manifestStates(engine) {
  return engine.manifests.map((m) => ({
    id: m.id,
    path: m.path,
    state: m.committed === null || m.committed === undefined ? 'MISSING' : m.committed === m.fresh ? 'CURRENT' : 'STALE',
  }));
}
