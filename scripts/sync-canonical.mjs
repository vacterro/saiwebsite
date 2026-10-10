/**
 * Copy the canonical SAIPEN machine sources into the site (MASTER_ROADMAP §4,
 * "canonical spec -> generator -> website reference -> CI verification").
 *
 * The website never re-types protocol facts. The spec reference pages, the
 * compatibility matrix and the downloadable schema files are generated from a
 * byte-exact snapshot of three files in a SAIPEN checkout, recorded with the
 * checkout's VERSION, commit and SHA-256 of every file:
 *
 *   saipen/REGISTRY.json                    phases, STATE shape, next_action
 *                                           forms, WAIT categories, commands,
 *                                           shortcuts, error codes, limits
 *   extensions/schemas/state.schema.json    STATE.md frontmatter schema
 *   extensions/adapters/registry.json       host adapters and their declared
 *                                           enforcement strength
 *
 * Usage:  SAIPEN_REF=main npm run canonical:sync           (published GitHub state;
 *                                                         the default for the site)
 *         SAIPEN_SRC=<path to checkout> npm run canonical:sync   (local, unpublished)
 *
 * The public site should cite what the public can open, so the GitHub mode
 * pins the resolved commit SHA and every source link on the site points at it.
 * Check:  npm run validate:canonical   (hashes; plus live drift when SAIPEN_SRC is set)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { withMutationLock, writeTransaction } from '../src/content-engine/operations/files.mjs';
import { referenceSources } from '../src/content-engine/sources/references.mjs';
import { validateCanonicalSnapshot } from '../src/content-engine/sources/canonical.mjs';

export const SNAPSHOT_DIR = process.env.SAI_CANONICAL_OUT ?? 'src/data/canonical';
export const FILES = {
  registry: 'saipen/REGISTRY.json',
  stateSchema: 'extensions/schemas/state.schema.json',
  adapters: 'extensions/adapters/registry.json',
};

export const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function git(src, ...args) {
  try {
    return execFileSync('git', ['-C', src, ...args], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const REPO = 'vacterro/saipen';

async function fromGitHub(ref) {
  const api = await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'sai-website-sync' }, signal: AbortSignal.timeout(30_000),
  });
  if (!api.ok) throw new Error(`GitHub: cannot resolve ${REPO}@${ref}: HTTP ${api.status}`);
  const commit = await api.json();
  const sha = commit.sha;
  const raw = async (path) => {
    const res = await fetch(`https://raw.githubusercontent.com/${REPO}/${sha}/${path}`, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`GitHub raw ${path}@${sha}: HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };
  return {
    commit: sha,
    commitDate: commit.commit.committer.date,
    version: (await raw('VERSION')).toString('utf8').trim(),
    read: raw,
  };
}

function fromCheckout(src) {
  return {
    commit: git(src, 'rev-parse', 'HEAD'),
    commitDate: git(src, 'log', '-1', '--format=%cI'),
    version: readFileSync(join(src, 'VERSION'), 'utf8').trim(),
    read: async (path) => readFileSync(join(src, path)),
  };
}

if (process.argv[1]?.endsWith('sync-canonical.mjs')) {
  const src = process.env.SAIPEN_SRC;
  const ref = process.env.SAIPEN_REF ?? (!src ? 'main' : undefined);
  if (!ref && !src) {
    console.error('Set SAIPEN_REF=<branch|tag|sha> (GitHub) or SAIPEN_SRC=<local checkout>.');
    process.exit(2);
  }
  const origin = ref ? await fromGitHub(ref) : fromCheckout(src);
  const files = {};
  const changes = {};
  for (const [key, rel] of Object.entries(FILES)) {
    const bytes = await origin.read(rel);
    JSON.parse(bytes.toString('utf8'));
    changes[`${key}.json`] = bytes;
    files[key] = { source: rel, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  const meta = {
    note: 'Byte-exact snapshot of canonical SAIPEN machine sources. Do not edit by hand; run npm run canonical:sync.',
    repository: `https://github.com/${REPO}`,
    origin: ref ? `github:${ref}` : 'local checkout',
    published: Boolean(ref),
    version: origin.version,
    commit: origin.commit,
    commitDate: origin.commitDate,
    files,
  };
  const documentation={schemaVersion:1,commit:origin.commit,version:origin.version,files:{}};
  for (const ref of referenceSources().filter((r)=>!r.machine)) {
    const bytes=await origin.read(ref.path);
    documentation.files[ref.path]={sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  const documentationBytes=JSON.stringify(documentation,null,2)+'\n';
  changes['documentation.json']=documentationBytes;
  meta.documentation={file:'documentation.json',sha256:createHash('sha256').update(documentationBytes).digest('hex')};
  changes['meta.json'] = JSON.stringify(meta, null, 2) + '\n';
  const validationDir=mkdtempSync(join(tmpdir(),'sai-canonical-validate-'));
  try {
    for(const [name,bytes] of Object.entries(changes))writeFileSync(join(validationDir,name),bytes);
    const problems=validateCanonicalSnapshot(validationDir);
    if(problems.length)throw new Error(`[canonical-sync-refused] ${problems.join('; ')}; previous snapshot retained`);
  } finally {rmSync(validationDir,{recursive:true});}
  const root = process.env.SAI_SYNC_STAGING_ROOT ?? '.';
  const { relative } = await import('node:path');
  const scoped = Object.fromEntries(Object.entries(changes).map(([name, bytes]) => [relative(root, join(SNAPSHOT_DIR, name)), bytes]));
  withMutationLock(root, () => writeTransaction(root, scoped));
  console.log(`snapshot: SAIPEN ${meta.version} @ ${meta.commit?.slice(0, 8)} from ${meta.origin} (${Object.keys(files).length} files)`);
}
