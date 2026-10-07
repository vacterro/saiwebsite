/**
 * Source lock (content-system roadmap M33). Node only: reads disk.
 *
 * The lock records, for every registered source, the identity of the local
 * snapshot the build represents: a content hash, and where the source has one,
 * the upstream version, revision and revision date. It never records the time
 * the lock was written, so an unchanged tree produces a byte-identical lock.
 *
 * Text is hashed with CRLF folded to LF, so a Windows checkout with
 * core.autocrlf and a Linux CI checkout agree on every hash.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const LOCK_FILE = 'src/content-engine/manifests/source-lock.json';
export const LOCK_SCHEMA_VERSION = 1;

const TEXT = /\.(json|md|mdx|ts|mjs|js|astro|css|txt|xml|html|yml|yaml|py|svg)$/i;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

/** Hash of one file, newline-normalised for text. */
export function fileHash(path) {
  const bytes = readFileSync(path);
  return sha256(TEXT.test(path) ? bytes.toString('utf8').replace(/\r\n/g, '\n') : bytes);
}

/** Every file under a path, as sorted repository-relative POSIX paths. */
export function listFiles(path) {
  if (!existsSync(path)) return [];
  if (!statSync(path).isDirectory()) return [path];
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(full);
      else out.push(full);
    }
  })(path.replace(/\/$/, ''));
  return out.sort();
}

/**
 * One hash over a set of paths: sorted `path\0hash` lines. Paths are named
 * relative to the repository root (`prefix` is stripped), so the same tree
 * hashes the same from any working directory.
 */
export function treeHash(paths, prefix = '') {
  const files = paths.flatMap(listFiles).sort();
  const name = (f) => (prefix && f.startsWith(prefix) ? f.slice(prefix.length) : f);
  return { sha256: sha256(files.map((f) => `${name(f)}\0${fileHash(f)}`).join('\n')), files: files.length };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Identity of one source, computed by its adapter. Missing paths are reported, never guessed. */
export function identify(source, root = '.') {
  const at = (p) => join(root, p).split('\\').join('/');
  const prefix = root === '.' ? '' : `${join(root).split('\\').join('/').replace(/\/$/, '')}/`;
  const tree = (paths) => treeHash(paths.map(at), prefix);
  const missing = source.paths.filter((p) => !existsSync(at(p)));
  if (missing.length) return { status: 'FAILED', reason: `missing ${missing.join(', ')}` };

  const base = { adapter: source.adapter, version: null, revision: null, revisionDate: null, syncTool: null };
  switch (source.adapter) {
    case 'volatile':
      // Changes on every checkpoint by design: record nothing that moves, or
      // the lock itself would go stale with every SAIPEN event.
      return { status: 'VOLATILE', ...base, sha256: null, files: null };
    case 'package-version': {
      const version = readJson(at(source.paths[0])).version ?? null;
      return { status: 'OK', ...base, version, sha256: sha256(`version\0${version}`), files: 1 };
    }
    case 'canonical': {
      const meta = readJson(at('src/data/canonical/meta.json'));
      return {
        status: 'OK',
        ...base,
        ...tree(source.paths),
        version: meta.version ?? null,
        revision: meta.commit ?? null,
        revisionDate: meta.commitDate ?? null,
        syncTool: 'scripts/sync-canonical.mjs',
      };
    }
    case 'ecosystem': {
      const snapshot = readJson(at(source.paths[0]));
      return {
        status: 'OK',
        ...base,
        ...tree(source.paths),
        revisionDate: snapshot.snapshot?.date ?? null,
        syncTool: 'scripts/sync-ecosystem.mjs',
      };
    }
    default:
      return { status: 'OK', ...base, ...tree(source.paths) };
  }
}

/** The lock document for the current tree. Deterministic: sorted, no wall-clock time. */
export function computeLock(sourcesDoc, root = '.') {
  const sources = {};
  const failed = [];
  for (const source of [...sourcesDoc.sources].sort((a, b) => a.id.localeCompare(b.id))) {
    const id = identify(source, root);
    if (id.status === 'FAILED') {
      failed.push(`[source-failed] ${source.id}: ${id.reason}`);
      continue;
    }
    const { status, ...rest } = id;
    sources[source.id] = { ...rest, locked: status === 'OK' };
  }
  return {
    lock: {
      schemaVersion: LOCK_SCHEMA_VERSION,
      generator: 'scripts/site.mjs refresh',
      note: 'Identity of every registered source at the state this build represents. Regenerate with npm run site:refresh.',
      sources,
    },
    problems: failed,
  };
}

/**
 * Compare a committed lock with the current tree.
 * Returns per-source states: CURRENT, STALE (content moved since the lock),
 * NEW (registered but not locked), REMOVED (locked but no longer registered),
 * VOLATILE (never locked by design).
 */
export function diffLock(committed, fresh) {
  const out = [];
  const ids = new Set([...Object.keys(committed?.sources ?? {}), ...Object.keys(fresh.sources)]);
  for (const id of [...ids].sort()) {
    const was = committed?.sources?.[id];
    const now = fresh.sources[id];
    if (!now) out.push({ id, state: 'REMOVED' });
    else if (!now.locked) out.push({ id, state: 'VOLATILE' });
    else if (!was) out.push({ id, state: 'NEW', now });
    else if (was.sha256 !== now.sha256 || was.version !== now.version || was.revision !== now.revision) out.push({ id, state: 'STALE', was, now });
    else out.push({ id, state: 'CURRENT' });
  }
  return out;
}

export const serialize = (doc) => JSON.stringify(doc, null, 2) + '\n';
