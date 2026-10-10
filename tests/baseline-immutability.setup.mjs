/**
 * Baseline immutability guard for every Playwright run.
 *
 * globalSetup records SHA-256 of every file in tests/baselines/ and
 * RETURNS the teardown closure (this is how Playwright threads setup
 * state into teardown). The closure fails the run if a normal
 * verification mutated, added, or removed an approved baseline.
 * Explicit baseline updates (`--update-snapshots`, i.e.
 * test:visual:update) are exempt: the owner rewrites PNGs plus MANIFEST
 * there on purpose.
 *
 * Pure node:crypto/node:fs -- no project imports, no browsers.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'baselines');

export function digestBaselines() {
  const files = readdirSync(DIR).sort();
  const out = {};
  for (const f of files) out[f] = createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex');
  return { files, digests: out };
}

export function checkImmutability(before) {
  if (!before || !before.digests) throw new Error('baseline guard: missing pre-run digest; refusing silent PASS');
  const after = digestBaselines();
  const problems = [];
  for (const [f, sha] of Object.entries(before.digests)) {
    if (!(f in after.digests)) problems.push(`removed approved baseline ${f}`);
    else if (after.digests[f] !== sha) problems.push(`mutated approved baseline ${f}`);
  }
  for (const f of Object.keys(after.digests)) {
    if (!(f in before.digests)) problems.push(`unapproved new baseline ${f}`);
  }
  if (problems.length) {
    throw new Error(`normal verification mutated approved baselines (use test:visual:update for reviewed refresh): ${problems.join('; ')}`);
  }
}

export default async function globalSetup() {
  const before = digestBaselines();
  return async () => {
    const explicitUpdate =
      process.argv.some((a) => a === '--update-snapshots' || a.startsWith('--update-snapshots='));
    if (explicitUpdate) return;
    checkImmutability(before);
  };
}
