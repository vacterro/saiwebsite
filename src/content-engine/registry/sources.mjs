/**
 * Canonical source registry contract (content-system roadmap M32).
 *
 * `sources.json` describes every authority the site depends on: what it is,
 * where its canonical copy lives, which local files snapshot it, how it is
 * refreshed and validated, whether refreshing needs the network, and what
 * happens when a refresh fails. Consumers are not stored: they are derived
 * from the page registry and the dependency graph, so they cannot drift.
 *
 * Pure: no filesystem, no network. Disk checks live in source-lock.mjs.
 */
import { ID_PATTERN } from './schema.mjs';

export const SOURCE_SCHEMA_VERSION = 1;

/**
 * snapshot        byte copy of an upstream or design authority
 * curated         hand-maintained data module that follows an outside authority
 * content         editorial collection of the site
 * config          site configuration fact (identity, version, verification)
 * asset           generated binary asset with its own manifest
 * project-memory  this repository's own .saipen/ files
 */
export const SOURCE_KINDS = ['snapshot', 'curated', 'content', 'config', 'asset', 'project-memory'];
export const AUTHORITIES = ['upstream', 'site'];
/**
 * How the lock computes a source's identity (see source-lock.mjs):
 *   canonical        snapshot files + version/commit from src/data/canonical/meta.json
 *   ecosystem        snapshot file + snapshot date
 *   file             content hash of the files or directory trees
 *   package-version  only the `version` field of package.json
 *   volatile         changes on every checkpoint; reported, never locked
 */
export const ADAPTERS = ['canonical', 'ecosystem', 'file', 'package-version', 'volatile'];
export const NETWORK = ['none', 'sync-only'];
export const FAILURE_POLICIES = ['keep-last-valid', 'fail-closed'];

const FIELDS = ['id', 'kind', 'authority', 'canonicalLocation', 'paths', 'adapter', 'refresh', 'validator', 'network', 'failurePolicy', 'note'];
const NPM_COMMAND = /^npm run [a-z0-9:.-]+$/;
const LOCAL_PATH = /^\.?[A-Za-z0-9_-][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_.-]+)*$/;

/** Validate a parsed sources.json. Returns problem strings; empty means valid. */
export function validateSources(doc) {
  const problems = [];
  if (doc === null || typeof doc !== 'object' || !Array.isArray(doc.sources)) return ['[malformed] sources.json: expected { schemaVersion, sources: [] }'];
  for (const key of Object.keys(doc)) if (!['schemaVersion', 'sources'].includes(key)) problems.push(`[unknown-field] sources.json: "${key}"`);
  if (doc.schemaVersion !== SOURCE_SCHEMA_VERSION) problems.push(`[schema-version] sources.json: schemaVersion ${doc.schemaVersion} is not ${SOURCE_SCHEMA_VERSION}`);

  const seen = new Set();
  doc.sources.forEach((source, i) => {
    const where = `sources[${i}]${source?.id ? ` ${source.id}` : ''}`;
    if (source === null || typeof source !== 'object') {
      problems.push(`[malformed] ${where}: expected an object`);
      return;
    }
    for (const field of FIELDS) if (!(field in source)) problems.push(`[missing-field] ${where}: no "${field}"`);
    for (const field of Object.keys(source)) if (!FIELDS.includes(field)) problems.push(`[unknown-field] ${where}: "${field}" is not part of the schema`);

    if (typeof source.id !== 'string' || !ID_PATTERN.test(source.id) || !source.id.includes('.')) problems.push(`[bad-source-id] ${where}: "${source.id}" is not a dotted source ID`);
    else if (seen.has(source.id)) problems.push(`[duplicate-source] ${where}: declared twice`);
    seen.add(source.id);

    const enumCheck = (field, allowed) => {
      if (field in source && !allowed.includes(source[field])) problems.push(`[bad-enum] ${where}: ${field} "${source[field]}" is not one of ${allowed.join(' | ')}`);
    };
    enumCheck('kind', SOURCE_KINDS);
    enumCheck('authority', AUTHORITIES);
    enumCheck('adapter', ADAPTERS);
    enumCheck('network', NETWORK);
    enumCheck('failurePolicy', FAILURE_POLICIES);

    if ('canonicalLocation' in source && source.canonicalLocation !== 'local' && !/^https:\/\/\S+$/.test(String(source.canonicalLocation))) {
      problems.push(`[malformed] ${where}: canonicalLocation must be "local" or an https URL`);
    }
    if ('paths' in source) {
      if (!Array.isArray(source.paths) || !source.paths.length) problems.push(`[malformed] ${where}: paths must be a non-empty array`);
      else for (const path of source.paths) if (typeof path !== 'string' || !LOCAL_PATH.test(path)) problems.push(`[malformed] ${where}: path "${path}" is not a repository-relative path`);
    }
    for (const field of ['refresh', 'validator']) {
      if (field in source && source[field] !== null && !NPM_COMMAND.test(String(source[field]))) problems.push(`[malformed] ${where}: ${field} must be null or "npm run <script>"`);
    }
    if (typeof source.note !== 'string' || !source.note.trim()) problems.push(`[malformed] ${where}: note must be a non-empty string`);

    // Contracts between fields.
    if (source.authority === 'upstream' && (source.canonicalLocation === 'local' || source.refresh === null)) {
      problems.push(`[contract] ${where}: an upstream source names its canonical URL and its refresh command`);
    }
    if (source.network === 'sync-only' && source.refresh === null) problems.push(`[contract] ${where}: network sync-only needs a refresh command`);
    if (source.authority === 'site' && source.network !== 'none') problems.push(`[contract] ${where}: a site-local source never needs the network`);
    if ((source.adapter === 'canonical' || source.adapter === 'ecosystem') && source.authority !== 'upstream') problems.push(`[contract] ${where}: the ${source.adapter} adapter is for upstream snapshots`);
  });
  return problems;
}

export const sourceIdsOf = (doc) => (Array.isArray(doc?.sources) ? doc.sources.map((s) => s.id) : []);
