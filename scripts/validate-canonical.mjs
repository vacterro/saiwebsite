/**
 * Drift gate for the canonical snapshot (see scripts/sync-canonical.mjs).
 *
 * 1. Integrity: every snapshot file must still hash to the value recorded in
 *    meta.json. A hand edit to a generated protocol fact fails here.
 * 2. Freshness (only when SAIPEN_SRC points at a checkout of the SAME commit):
 *    the snapshot must be byte-identical to that checkout. Otherwise the website would be
 *    describing a protocol state that no longer exists.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILES, SNAPSHOT_DIR, sha256 } from './sync-canonical.mjs';

const meta = JSON.parse(readFileSync(join(SNAPSHOT_DIR, 'meta.json'), 'utf8'));
const problems = [];

for (const key of Object.keys(FILES)) {
  const file = join(SNAPSHOT_DIR, `${key}.json`);
  if (!existsSync(file)) {
    problems.push(`missing snapshot file ${file}`);
    continue;
  }
  // The recorded hash is of the LF bytes the sync wrote. A Windows checkout
  // with core.autocrlf turns them into CRLF without changing a single fact,
  // so the LF-normalised content is accepted too; any other edit still fails.
  const actual = sha256(file);
  const normalised = createHash('sha256').update(readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex');
  if (actual !== meta.files[key]?.sha256 && normalised !== meta.files[key]?.sha256) {
    problems.push(`${file} hash ${actual.slice(0, 12)} != recorded ${meta.files[key]?.sha256?.slice(0, 12)} (hand-edited?)`);
  }
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    problems.push(`${file} is not valid JSON: ${error.message}`);
  }
}

const src = process.env.SAIPEN_SRC;
if (src) {
  for (const [key, rel] of Object.entries(FILES)) {
    const live = join(src, rel);
    if (!existsSync(live)) problems.push(`live source missing: ${live}`);
    else if (sha256(live) !== meta.files[key].sha256) problems.push(`DRIFT ${rel}: live checkout differs from snapshot — run npm run canonical:sync`);
  }
}

if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\nFAILED: ${problems.length} canonical snapshot problem(s)`);
  process.exit(1);
}
console.log(
  `OK: canonical snapshot SAIPEN ${meta.version} @ ${meta.commit?.slice(0, 8)}, ${Object.keys(FILES).length} files intact${src ? ', identical to live checkout' : ''}`,
);
