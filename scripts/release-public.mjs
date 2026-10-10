#!/usr/bin/env node
/**
 * Public candidate projection (npm run release:public).
 *
 * Copies an already validated build into an isolated staging directory and
 * removes internal-only surfaces, driven by the existing registries — never
 * by hardcoded route lists:
 *   - routes under /debug/ (diagnostic benches from src/content-engine/registry/pages.json)
 *   - top-level locale prefixes that are not public (src/content-engine/i18n/locales.json:
 *     disabled, pseudo-stage or internal-publication locales — qps-ploc, et, ru),
 *     including their per-locale search indexes and AI endpoints
 *   - root search/sitemap/AI index entries pointing at removed routes
 *     (rewritten only when something is actually removed, else byte-identical)
 *
 * Source pages are never deleted and the development build is never modified.
 * The output is verified independently with:
 *   npm run release:verify -- --public --dist <candidate>
 *
 * Usage:
 *   node scripts/release-public.mjs --src dist --dest <dir>
 *
 * Exit status: 0 projected, 1 failure, 2 unusable input.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Suffix for the ownership marker written BESIDE every directory this tool
 * creates (`<dest>.public-candidate-owner.json`). Kept out of the publishable
 * tree so the verifier never sees it as an artifact path.
 */
export const OWNER_SUFFIX = '.public-candidate-owner.json';

/**
 * Repository subtrees that are never valid projection destinations.
 * Compared against the destination relative path (posix form, lowercase on
 * Windows where the filesystem is case-insensitive).
 */
const PROTECTED_PREFIXES = [
  'src', 'scripts', 'tests', 'test', 'public', 'i18n-work', 'roadmap',
  '.astro', '.git', '.github', '.saipen', '.site-work', '.freebuff',
  'reports', 'test-results', 'node_modules', 'dist',
];

const PROTECTED_FILES = new Set([
  'package.json', 'package-lock.json', 'astro.config.mjs', 'tsconfig.json',
  'playwright.config.mjs', 'operator.md', 'readme.md',
]);

function samePath(a, b) {
  if (process.platform === 'win32') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

function isWithin(parent, child) {
  if (samePath(parent, child)) return 'equal';
  const rel = relative(parent, child);
  if (rel === '' ) return 'equal';
  if (rel === '..' || rel.startsWith(`..${sep}`)) return 'outside';
  return 'inside';
}

/** Best-effort physical path: resolve symlinks/junctions where possible. */
function physicalOf(path) {
  try {
    return realpathSync(path);
  } catch {
    // Missing path: resolve the nearest existing ancestor, then re-append.
    let cursor = path;
    const tail = [];
    while (true) {
      let parent = dirname(cursor);
      if (parent === cursor) return resolve(path);
      tail.unshift(cursor.slice(parent.length + 1));
      cursor = parent;
      if (existsSync(cursor)) {
        try {
          return join(realpathSync(cursor), ...tail);
        } catch {
          return resolve(path);
        }
      }
    }
  }
}

/** True when dir looks like a candidate generation or store (never a target). */
function isCandidateStoreDir(dir) {
  try {
    if (existsSync(join(dir, 'current.json'))) return true;
    if (existsSync(join(dir, 'generations'))) return true;
    // Legacy layout: current/index.html + previous/ beside it.
    if (existsSync(join(dir, 'current', 'index.html'))) return true;
  } catch { /* unreadable -> treated as unsafe elsewhere */ }
  return false;
}

/**
 * Fail-closed destination validation for public projection.
 *
 * Throws before anything is deleted when:
 * - the source is not a valid build (missing index.html),
 * - the destination equals the source, is its ancestor, or lies inside it,
 * - the destination is the repository root or a protected subtree/file,
 * - the destination is the candidate store root or a verified generation,
 * - symlink/junction resolution makes any of the above true,
 * - the destination already holds unrelated files (not a previous output of
 *   this tool and not an explicitly owned factory staging directory).
 *
 * @param {{ srcDir: string, destDir: string, root?: string, ownedDirs?: string[] }} options
 *   ownedDirs: absolute paths the caller owns (e.g. the factory's next/);
 *   they may be recycled even though they already exist.
 */
export function assertSafeDestination({ srcDir, destDir, root = ROOT, ownedDirs = [] } = {}) {
  if (!srcDir) throw new Error('[unsafe-destination] srcDir is required');
  if (!destDir) throw new Error('[unsafe-destination] destDir is required');
  const absRoot = resolve(root);
  const absSrc = resolve(srcDir);
  const absDest = resolve(destDir);
  const owned = ownedDirs.map((d) => resolve(String(d)));
  const isOwned = owned.some((o) => samePath(o, absDest));

  // Source must be a valid build BEFORE any destination mutation is allowed.
  let srcStat = null;
  try {
    srcStat = lstatSync(join(absSrc, 'index.html'));
  } catch {
    srcStat = null;
  }
  if (!srcStat || !srcStat.isFile()) {
    throw new Error(`[unsafe-destination] refusing: no valid build at source ${absSrc} (missing index.html); nothing was modified`);
  }

  // Physical (symlink-resolved) comparison so junctions cannot smuggle overlap.
  const physRoot = physicalOf(absRoot);
  const physSrc = physicalOf(absSrc);
  const physDest = physicalOf(absDest);
  const pairs = [[absSrc, absDest, 'logical'], [physSrc, physDest, 'resolved']] ;
  for (const [s, d, kind] of pairs) {
    const rel = isWithin(s, d);
    if (rel === 'equal') throw new Error(`[unsafe-destination] refusing (${kind} paths): destination equals the source (${absDest}); nothing was modified`);
    if (rel === 'inside') throw new Error(`[unsafe-destination] refusing (${kind} paths): destination is inside the source (${absDest} in ${absSrc}); nothing was modified`);
  }
  // Destination must not be an ancestor of the source (would delete the source).
  if (isWithin(absDest, absSrc) === 'inside' || isWithin(physDest, physSrc) === 'inside') {
      throw new Error(`[unsafe-destination] refusing: destination is an ancestor of the source (${absDest} above ${absSrc}); nothing was modified`);
  }
  // Explicitly owned factory staging directories (e.g. the candidate store's
  // next/) are recycled by their owner: overlap and source-validity checks
  // above still apply, but protected-path and existing-content rules do not.
  if (!isOwned) {
  // Never target the candidate store root or a verified generation: checked
  // before the generic protected-path rule so the refusal names the exact
  // reason (the store root lives under .site-work/, which is also protected).
  const storeRoot = join(absRoot, '.site-work', 'release', 'candidates');
  if (samePath(absDest, storeRoot) || samePath(physDest, physicalOf(storeRoot)) || isWithin(storeRoot, absDest) === 'equal') {
    throw new Error('[unsafe-destination] refusing: destination is the candidate store root; nothing was modified');
  }
  if (isCandidateStoreDir(absDest)) {
    throw new Error(`[unsafe-destination] refusing: destination is an existing verified candidate generation (${absDest}); nothing was modified`);
  }
  // Repository root and protected subtrees (logical + resolved).
  for (const [r, d, kind] of [[absRoot, absDest, 'logical'], [physRoot, physDest, 'resolved']]) {
    if (samePath(r, d)) throw new Error(`[unsafe-destination] refusing (${kind} paths): destination is the repository root; nothing was modified`);
    const rel = relative(r, d);
    if (rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`)) {
      const first = rel.split(sep)[0] ?? '';
      const probe = process.platform === 'win32' ? first.toLowerCase() : first;
      if (PROTECTED_PREFIXES.includes(probe)) {
        throw new Error(`[unsafe-destination] refusing (${kind} paths): destination is inside protected repository path ${first}/; nothing was modified`);
      }
      if (PROTECTED_FILES.has(probe) || PROTECTED_FILES.has(first.toLowerCase())) {
        throw new Error(`[unsafe-destination] refusing (${kind} paths): destination names a protected repository file; nothing was modified`);
      }
    }
  }
  }
  // Existing content: only recycle explicitly owned staging dirs or previous
  // outputs of this tool (marker present). Never blindly remove user data.
  let destExists = false;
  try {
    const st = lstatSync(absDest);
    destExists = true;
    if (st.isSymbolicLink()) throw new Error(`[unsafe-destination] refusing: destination is a symlink (${absDest}); nothing was modified`);
  } catch (error) {
    if (error?.message?.startsWith('[unsafe-destination]')) throw error;
    destExists = false;
  }
  if (destExists && !isOwned) {
    // Ownership marker lives BESIDE the directory (never inside the publishable
    // tree, where the verifier would reject it as an unapproved artifact path).
    const marker = existsSync(`${absDest}${OWNER_SUFFIX}`);
    let entries = [];
    try {
      entries = readdirSync(absDest);
    } catch {
      throw new Error(`[unsafe-destination] refusing: destination is unreadable (${absDest}); never treat an unreadable path as permission to delete`);
    }
    if (!marker && entries.length > 0) {
      throw new Error(`[unsafe-destination] refusing: destination exists with ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} not produced by this tool (${absDest}); choose an empty or new directory; nothing was modified`);
    }
  }
  return { src: absSrc, dest: absDest, owned: isOwned };
}

/**
 * The public contract, derived from the registries.
 * @returns {{ nonPublicPrefixes: string[], debugRoutes: string[] }}
 */
export function loadPublicContract(root = ROOT) {
  const localesDoc = JSON.parse(readFileSync(join(root, 'src/content-engine/i18n/locales.json'), 'utf8'));
  const nonPublicPrefixes = localesDoc.locales
    .filter((l) => l.id !== localesDoc.canonical && (!l.enabled || l.stage === 'pseudo' || l.publication === 'internal'))
    .map((l) => String(l.id).toLowerCase());
  const registry = JSON.parse(readFileSync(join(root, 'src/content-engine/registry/pages.json'), 'utf8'));
  const debugRoutes = registry.pages.filter((p) => p.nav === 'debug').map((p) => p.route);
  return { nonPublicPrefixes, debugRoutes };
}

/** True when a dist-relative path is internal-only (diagnostic or non-public locale). */
export function isInternalPath(rel, contract) {
  const lower = rel.toLowerCase();
  if (lower === 'debug' || lower.startsWith('debug/')) return true;
  const first = lower.split('/')[0];
  return contract.nonPublicPrefixes.includes(first);
}

/** True when a route pathname is internal-only. */
export function isInternalRoute(pathname, contract) {
  const lower = pathname.toLowerCase();
  if (lower === '/debug/' || lower.startsWith('/debug/')) return true;
  const first = lower.split('/').filter(Boolean)[0] ?? '';
  return contract.nonPublicPrefixes.includes(first);
}

function listFilesRecursive(dir) {
  const out = [];
  (function walk(current) {
    for (const e of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = join(current, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  })(dir);
  return out.sort();
}

function removeEmptyDirs(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      removeEmptyDirs(full);
      try {
        if (readdirSync(full).length === 0) rmSync(full, { recursive: true, force: true });
      } catch { /* already gone */ }
    }
  }
}

/**
 * Project a validated build into an isolated public candidate directory.
 * @returns {{ removed: string[], scrubbed: string[], files: number }}
 */
export function projectPublicCandidate({ srcDir = join(ROOT, 'dist'), destDir, root = ROOT, ownedDirs = [] } = {}) {
  if (!destDir) throw new Error('projectPublicCandidate: destDir is required');
  // Fail closed BEFORE deleting anything: source validity, overlap, protected
  // paths, symlink escapes and unrelated destination content are all refused.
  // The standalone CLI gets the same protection because it calls this function.
  const safe = assertSafeDestination({ srcDir, destDir, root, ownedDirs });
  const contract = loadPublicContract(root);
  // Copy into an isolated staging directory first: a halfway copy failure
  // leaves any previous destination untouched, and a source that disappears
  // mid-copy fails here instead of producing a half-projected candidate.
  const staging = `${safe.dest}.staging-${process.pid}`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(dirname(staging), { recursive: true });
  try {
    cpSync(safe.src, staging, { recursive: true });
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`projectPublicCandidate: copy failed, destination untouched: ${String(error?.message ?? error).slice(0, 200)}`);
  }
  if (!existsSync(join(staging, 'index.html'))) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error('projectPublicCandidate: source became unreadable during projection (staging has no index.html); destination untouched');
  }
  // Staging is complete: re-validate the destination (TOCTOU), then commit.
  assertSafeDestination({ srcDir: safe.src, destDir: safe.dest, root, ownedDirs });
  rmSync(safe.dest, { recursive: true, force: true });
  mkdirSync(dirname(safe.dest), { recursive: true });
  destDir = safe.dest;
  cpSync(staging, destDir, { recursive: true });
  rmSync(staging, { recursive: true, force: true });

  const removed = [];
  for (const rel of listFilesRecursive(destDir)) {
    if (isInternalPath(rel, contract)) {
      rmSync(join(destDir, rel), { force: true });
      removed.push(rel);
    }
  }

  // Scrub root discovery indexes of removed routes. Files are rewritten only
  // when an entry is actually dropped, so clean builds stay byte-identical.
  const scrubbed = [];
  const internalUrl = (url) => {
    try {
      return isInternalRoute(new URL(url, 'https://candidate.invalid').pathname, contract);
    } catch {
      return false;
    }
  };
  const sitemapPath = join(destDir, 'sitemap.xml');
  if (existsSync(sitemapPath)) {
    const raw = readFileSync(sitemapPath, 'utf8');
    const kept = [];
    let dropped = 0;
    for (const m of raw.matchAll(/<url>[\s\S]*?<\/url>/g)) {
      const loc = m[0].match(/<loc>([^<]*)<\/loc>/);
      if (loc && internalUrl(loc[1].trim())) dropped++;
      else kept.push(m[0]);
    }
    if (dropped > 0) {
      const head = raw.slice(0, raw.indexOf('<url>'));
      const tail = raw.slice(raw.lastIndexOf('</url>') + '</url>'.length);
      writeFileSync(sitemapPath, `${head}${kept.join('')}${tail}`);
      scrubbed.push(`sitemap.xml (${dropped} entries)`);
    }
  }
  const searchPath = join(destDir, 'search-index.json');
  if (existsSync(searchPath)) {
    const entries = JSON.parse(readFileSync(searchPath, 'utf8'));
    const kept = entries.filter((e) => !internalUrl(String(e.url ?? '')));
    if (kept.length !== entries.length) {
      writeFileSync(searchPath, `${JSON.stringify(kept, null, 2)}\n`);
      scrubbed.push(`search-index.json (${entries.length - kept.length} entries)`);
    }
  }
  for (const name of ['llms.txt', 'llms-full.txt']) {
    const filePath = join(destDir, name);
    if (!existsSync(filePath)) continue;
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split('\n');
    const kept = lines.filter((line) => {
      for (const m of line.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
        if (internalUrl(m[1])) return false;
      }
      return true;
    });
    if (kept.length !== lines.length) {
      writeFileSync(filePath, kept.join('\n'));
      scrubbed.push(`${name} (${lines.length - kept.length} lines)`);
    }
  }

  removeEmptyDirs(destDir);
  removed.sort();
  if (!safe.owned) {
    writeFileSync(`${destDir}${OWNER_SUFFIX}`, `${JSON.stringify({ tool: 'release-public', src: relative(root, safe.src).split(sep).join('/'), at: new Date().toISOString() })}\n`);
  }
  return { removed, scrubbed, files: listFilesRecursive(destDir).length };
}

async function main(argv) {
  const args = { src: join(ROOT, 'dist'), dest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--src') args.src = resolve(argv[++i]);
    else if (a === '--dest') args.dest = resolve(argv[++i]);
    else throw new Error(`unknown option ${a}`);
  }
  if (!args.dest) throw new Error('missing required option --dest <dir>');
  const summary = projectPublicCandidate({ srcDir: args.src, destDir: args.dest, root: ROOT });
  process.stdout.write(`${JSON.stringify({ src: relative(ROOT, args.src).split(sep).join('/'), dest: relative(ROOT, args.dest).split(sep).join('/'), ...summary }, null, 2)}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`release:public error: ${error.message}`);
    process.exit(/no built site|destDir is required|unsafe-destination/.test(error.message) ? 2 : 1);
  });
}
