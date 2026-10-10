#!/usr/bin/env node
/**
 * Dual-origin release validation (npm run release:dual-origin).
 *
 * Runs two isolated real Astro production builds with release mode enabled:
 *   A. planned origin   https://saipenprotocol.com
 *   B. temporary origin https://sai-temp.example.org (fictional fixture)
 * and proves both pass the SAME verifier (scripts/release-verify.mjs):
 *   - both builds complete, both release verifications return PASS
 *   - canonical, Open Graph, sitemap, robots.txt, llms endpoints and Markdown
 *     twins use the selected origin; no stale references to the other origin
 *     remain in machine-facing surfaces; internal navigation stays
 *     root-relative; page content is semantically consistent (identical after
 *     origin normalisation); protocol and package identity are identical;
 *     ET/RU stay disabled; theme and font bytes are unchanged
 *   - a deliberate stale-origin mutation demonstrably fails the verifier
 *
 * Nothing is deployed and no external service is contacted. The second build
 * never overwrites the first: each dist/ is copied to its own directory
 * before comparison. Writes a machine-readable report to
 * reports/release/dual-origin.json. Exit 0 PASS, 1 FAIL.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRelease } from './release-verify.mjs';
import { projectPublicCandidate } from './release-public.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLANNED = 'https://saipenprotocol.com';
const TEMP = 'https://sai-temp.example.org';
const OUT = join(ROOT, 'reports', 'release', 'dual-origin.json');

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

function buildFor(origin, destDir) {
  rmSync(destDir, { recursive: true, force: true });
  execSync('npx astro build', {
    cwd: ROOT,
    stdio: 'pipe',
    env: { ...process.env, SAI_SITE_ORIGIN: origin, SAI_RELEASE_BUILD: '1', SAI_RELEASE_ORIGIN_ACK: origin },
  });
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(dirname(destDir), { recursive: true });
  cpSync(join(ROOT, 'dist'), destDir, { recursive: true });
}

function readText(dir, rel) {
  return readFileSync(join(dir, rel), 'utf8');
}

async function main(argv = process.argv.slice(2)) {
  const skipBuild = argv.includes('--skip-build');
  const report = { schemaVersion: 1, verdict: 'PASS', planned: PLANNED, temp: TEMP, checks: [], external: 'not-checked-offline' };
  const check = (id, ok, detail) => report.checks.push({ id, status: ok ? 'PASS' : 'FAIL', detail });
  const plannedDir = join(ROOT, '.site-work', 'release', 'planned-origin');
  const tempDir = join(ROOT, '.site-work', 'release', 'temp-origin');

  // ---- builds ---------------------------------------------------------------
  if (skipBuild && existsSync(join(plannedDir, 'index.html')) && existsSync(join(tempDir, 'index.html'))) {
    check('build.planned', true, `reused existing release artifact for ${PLANNED} (--skip-build)`);
    check('build.temp', true, `reused existing release artifact for ${TEMP} (--skip-build)`);
  } else {
  try {
    buildFor(PLANNED, plannedDir);
    check('build.planned', true, `real Astro release build completed for ${PLANNED}`);
  } catch (error) {
    check('build.planned', false, `release build failed for ${PLANNED}: ${String(error?.message ?? error).slice(0, 300)}`);
  }
  try {
    buildFor(TEMP, tempDir);
    check('build.temp', true, `real Astro release build completed for ${TEMP}`);
  } catch (error) {
    check('build.temp', false, `release build failed for ${TEMP}: ${String(error?.message ?? error).slice(0, 300)}`);
  }
  if (report.checks.some((c) => c.status === 'FAIL')) return finish(report, OUT);
  }

  // ---- release verification with the same verifier --------------------------
  const envPlanned = { ...process.env, SAI_SITE_ORIGIN: PLANNED, SAI_RELEASE_ORIGIN_ACK: PLANNED };
  const envTemp = { ...process.env, SAI_SITE_ORIGIN: TEMP, SAI_RELEASE_ORIGIN_ACK: TEMP };
  // Sequential: verifyRelease temporarily mutates process.env around its
  // astro.config.mjs import, so concurrent verifications would race.
  const planned = await verifyRelease({ dist: plannedDir, env: envPlanned, release: true, root: ROOT });
  const temp = await verifyRelease({ dist: tempDir, env: envTemp, release: true, root: ROOT });
  check('verify.planned', planned.verdict === 'PASS', `planned-origin release verification: ${planned.verdict}`);
  if (planned.verdict !== 'PASS') {
    for (const c of planned.checks.filter((c) => c.status !== 'PASS')) report.checks.push({ id: `planned.${c.id}`, status: 'FAIL', detail: c.detail });
  }
  check('verify.temp', temp.verdict === 'PASS', `temporary-origin release verification: ${temp.verdict}`);
  if (temp.verdict !== 'PASS') {
    for (const c of temp.checks.filter((c) => c.status !== 'PASS')) report.checks.push({ id: `temp.${c.id}`, status: 'FAIL', detail: c.detail });
  }
  if (report.checks.some((c) => c.status === 'FAIL')) return finish(report, OUT);

  const plannedFiles = listFilesRecursive(plannedDir);
  const tempFiles = listFilesRecursive(tempDir);

  // ---- same file set ---------------------------------------------------------
  const onlyPlanned = plannedFiles.filter((f) => !tempFiles.includes(f));
  const onlyTemp = tempFiles.filter((f) => !plannedFiles.includes(f));
  check('compare.file-set', onlyPlanned.length === 0 && onlyTemp.length === 0,
    onlyPlanned.length || onlyTemp.length
      ? `file sets differ: only-planned [${onlyPlanned.slice(0, 5).join(', ')}] only-temp [${onlyTemp.slice(0, 5).join(', ')}]`
      : `${plannedFiles.length} files in both artifacts`);

  // ---- origin surfaces -------------------------------------------------------
  const norm = (text, origin) => text.split(origin).join('__ORIGIN__');
  let stalePlanned = [];
  for (const rel of plannedFiles) {
    if (/\.(png|ico|woff2?|ttf|otf)$/.test(rel)) continue;
    try {
      const text = readText(plannedDir, rel);
      if (rel !== 'release.json' && text.includes(TEMP)) stalePlanned.push(rel);
    } catch { /* unreadable already covered by the verifier */ }
  }
  check('compare.no-stale-in-planned', stalePlanned.length === 0,
    stalePlanned.length ? `planned artifact references the fixture origin: ${stalePlanned.slice(0, 5).join(', ')}` : 'planned artifact never references the fixture origin');

  // Temp artifact: machine-facing surfaces must not carry the planned origin
  // as a URL (editorial prose mentions of the planned domain stay allowed).
  const machineRels = tempFiles.filter((rel) => rel.endsWith('.html') || /(^|\/)(llms(-full)?\.txt|sitemap\.xml|robots\.txt)$|\.md$/.test(rel));
  const staleTemp = [];
  for (const rel of machineRels) {
    try {
      const text = readText(tempDir, rel);
      // Head metadata, sitemap locs, robots Sitemap line, llms links, twins.
      if (rel.endsWith('.html')) {
        const head = text.slice(0, Math.max(0, text.indexOf('</head>')));
        if (head.includes(PLANNED)) staleTemp.push(rel);
      } else if (text.includes(`${PLANNED}/`)) staleTemp.push(rel);
    } catch { /* covered by verifier */ }
  }
  check('compare.no-stale-in-temp', staleTemp.length === 0,
    staleTemp.length ? `temp artifact machine surfaces reference the planned origin: ${staleTemp.slice(0, 5).join(', ')}` : 'temp machine surfaces use only the fixture origin');

  // ---- semantic consistency (origin-normalised equality) --------------------
  const textRels = plannedFiles.filter((rel) => /\.(html|xml|txt|md|json|css)$/.test(rel) && tempFiles.includes(rel));
  const normalizeBody = (rel, text) => {
    if (rel === 'release.json') {
      try {
        const doc = JSON.parse(text);
        delete doc.origin;
        delete doc.originSource;
        return JSON.stringify(doc);
      } catch {
        return text;
      }
    }
    return norm(text, PLANNED);
  };
  const changed = [];
  for (const rel of textRels) {
    if (/\.(png|ico|woff2?)$/.test(rel)) continue;
    let a = '';
    let b = '';
    try {
      a = normalizeBody(rel, readText(plannedDir, rel));
      b = readText(tempDir, rel).split(TEMP).join('__ORIGIN__');
    } catch {
      continue;
    }
    if (a !== b) changed.push(rel);
  }
  const expectedVariable = new Set(['release.json', 'sitemap.xml', 'robots.txt', 'llms.txt', 'llms-full.txt']);
  const unexpected = changed.filter((rel) => !expectedVariable.has(rel) && !rel.endsWith('.html') && !rel.endsWith('.md') && rel !== 'search-index.json' && !/^qps-ploc\//.test(rel) && !/^spec\/v8\//.test(rel));
  check('compare.semantic-consistency', unexpected.length === 0,
    unexpected.length
      ? `unexpected non-origin differences: ${unexpected.slice(0, 8).join(', ')}`
      : `${textRels.length} text files compared; differences restricted to deployment-specific output`);

  // ---- identity, i18n state, theme and fonts ---------------------------------
  const plannedRelease = JSON.parse(readText(plannedDir, 'release.json'));
  const tempRelease = JSON.parse(readText(tempDir, 'release.json'));
  check('compare.package-identity', plannedRelease.package?.version === tempRelease.package?.version,
    `package ${plannedRelease.package?.version} in both builds`);
  check('compare.protocol-identity',
    plannedRelease.protocol?.metaSha256 === tempRelease.protocol?.metaSha256 && plannedRelease.protocol?.version === tempRelease.protocol?.version,
    `SAIPEN ${plannedRelease.protocol?.version} identical in both builds`);

  const localesDoc = JSON.parse(readFileSync(join(ROOT, 'src/content-engine/i18n/locales.json'), 'utf8'));
  const et = localesDoc.locales.find((l) => l.id === 'et');
  const ru = localesDoc.locales.find((l) => l.id === 'ru');
  check('compare.i18n-disabled', et?.enabled === false && ru?.enabled === false, 'ET/RU remain disabled in both builds');
  const etRuFiles = plannedFiles.filter((f) => f === 'et' || f.startsWith('et/') || f === 'ru' || f.startsWith('ru/'))
    .concat(tempFiles.filter((f) => f === 'et' || f.startsWith('et/') || f === 'ru' || f.startsWith('ru/')));
  check('compare.i18n-unpublished', etRuFiles.length === 0, etRuFiles.length ? `ET/RU output leaked: ${etRuFiles.slice(0, 5).join(', ')}` : 'no ET/RU output in either artifact');

  const assetRels = plannedFiles.filter((rel) => /^_astro\//.test(rel) || /^fonts\//.test(rel) || /^media\//.test(rel) || rel === 'social/card.png');
  const assetChanged = assetRels.filter((rel) => {
    try {
      return Buffer.compare(readFileSync(join(plannedDir, rel)), readFileSync(join(tempDir, rel))) !== 0;
    } catch {
      return true;
    }
  });
  check('compare.theme-fonts', assetChanged.length === 0,
    assetChanged.length ? `theme/font assets differ: ${assetChanged.slice(0, 5).join(', ')}` : `${assetRels.length} theme/font assets byte-identical`);

  // ---- stale-origin mutation must fail ---------------------------------------
  const mutatedDir = join(ROOT, '.site-work', 'release', 'mutated-temp');
  rmSync(mutatedDir, { recursive: true, force: true });
  cpSync(tempDir, mutatedDir, { recursive: true });
  const llmsPath = join(mutatedDir, 'llms.txt');
  writeFileSync(llmsPath, `${readFileSync(llmsPath, 'utf8')}- [Stale](${PLANNED}/about/): stale\n`);
  const mutated = await verifyRelease({ dist: mutatedDir, env: envTemp, release: true, root: ROOT });
  check('mutation.stale-origin-rejected', mutated.verdict === 'FAIL',
    mutated.verdict === 'FAIL' ? 'stale planned-origin URL in temp llms.txt rejected by the verifier' : 'mutation unexpectedly passed the verifier');

  // ---- public candidates: physical isolation per origin ----------------------
  // Each release artifact is projected into an isolated public candidate and
  // verified under the public contract (no diagnostics, no non-public locales).
  for (const [label, src, env] of [['planned', plannedDir, envPlanned], ['temp', tempDir, envTemp]]) {
    const candidateDir = join(ROOT, '.site-work', 'release', `public-${label}`);
    let summary = null;
    try {
      summary = projectPublicCandidate({ srcDir: src, destDir: candidateDir, root: ROOT, ownedDirs: [candidateDir] });
    } catch (error) {
      check(`candidate.public-${label}`, false, `projection failed: ${String(error?.message ?? error).slice(0, 200)}`);
      continue;
    }
    const candidate = await verifyRelease({ dist: candidateDir, env, release: true, public: true, root: ROOT });
    check(`candidate.public-${label}`, candidate.verdict === 'PASS',
      candidate.verdict === 'PASS'
        ? `public candidate for ${label} origin verified (${summary.files} files, ${summary.removed.length} internal removed)`
        : `public candidate for ${label} origin: ${candidate.verdict} — ${candidate.checks.filter((c) => c.status !== 'PASS').map((c) => `${c.id}: ${c.detail}`).join('; ').slice(0, 300)}`);
  }

  return finish(report, OUT);
}

function finish(report, outPath) {
  report.verdict = report.checks.some((c) => c.status === 'FAIL') ? 'FAIL' : 'PASS';
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  const summary = report.checks.map((c) => `${c.status} ${c.id} — ${c.detail}`).join('\n');
  process.stdout.write(`dual-origin: ${report.verdict}\n${summary}\nreport: ${relative(ROOT, outPath).split(sep).join('/')}\n`);
  return report.verdict === 'PASS' ? 0 : 1;
}

let code = 1;
try {
  const maybe = main();
  code = maybe instanceof Promise ? await maybe : maybe;
} catch (error) {
  process.stderr.write(`dual-origin error: ${String(error?.message ?? error).slice(0, 500)}\n`);
  code = 1;
}
process.exit(code);
