/**
 * Baseline completeness gate.
 *
 * The screenshot baselines in tests/baselines/ are the visual evidence of this
 * site. An archive or copy that silently drops some of them still "passes" a
 * visual run that cannot find them (Playwright writes a new baseline instead
 * of failing). MANIFEST.json records every baseline with its SHA-256, so a
 * missing, extra or altered file is a hard failure here.
 *
 *   node scripts/validate-baselines.mjs          check
 *   node scripts/validate-baselines.mjs --write  rewrite the manifest (after test:visual:update)
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'tests/baselines';
const MANIFEST = join(DIR, 'MANIFEST.json');
const hash = (f) => createHash('sha256').update(readFileSync(join(DIR, f))).digest('hex');
const pngs = readdirSync(DIR).filter((f) => f.endsWith('.png')).sort();

if (process.argv.includes('--write')) {
  const files = Object.fromEntries(pngs.map((f) => [f, hash(f)]));
  writeFileSync(MANIFEST, `${JSON.stringify({ note: 'Visual regression evidence. Regenerate with npm run test:visual:update.', count: pngs.length, files }, null, 2)}\n`);
  console.log(`wrote ${MANIFEST}: ${pngs.length} baselines`);
  process.exit(0);
}

if (!existsSync(MANIFEST)) {
  console.log(`  FAIL ${MANIFEST} is missing`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const problems = [];
for (const [file, sha] of Object.entries(manifest.files)) {
  if (!pngs.includes(file)) problems.push(`missing baseline ${file}`);
  else if (hash(file) !== sha) problems.push(`baseline ${file} differs from its recorded SHA-256`);
}
for (const file of pngs) if (!(file in manifest.files)) problems.push(`unrecorded baseline ${file} — run with --write if it is intentional`);
if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\nFAILED: ${problems.length} baseline problem(s); expected ${manifest.count}, found ${pngs.length}`);
  process.exit(1);
}
console.log(`OK: ${pngs.length} baselines present and matching ${MANIFEST}`);
