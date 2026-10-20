/**
 * Publication licence gate for the shipped font and media assets.
 *
 * Scope is deliberately narrow: the one publication blocker this project had
 * — font bytes and a social card derived from a proprietary font — must not
 * come back. It is not a general legal review of every dependency.
 *
 * Fails when:
 *   source      an approved source in scripts/fonts/sources.json is missing or
 *               its bytes changed
 *   face        a required production face is missing, its bytes differ from
 *               the manifest, or its recorded source is not an approved one
 *   supplement  the composite code face records a missing-glyph supplement
 *               that is not the approved, hash-pinned DejaVu Sans Mono, or
 *               describes its glyph split dishonestly
 *   lineage     a forbidden font name (Verdana, Microsoft, ...) appears in a
 *               font manifest, a decompressed WOFF2, the social-card provenance
 *               or a shipped file name
 *   notice      a licence file the redistribution terms require is not shipped,
 *               or differs from the source licence text
 *   css         fonts.css loads a face the manifest does not vouch for
 *   card        the social card's provenance is missing, names an unapproved
 *               font, or does not match the card bytes
 *   dist        the built site ships fonts or a card that differ from public/
 *   notices     THIRD_PARTY_NOTICES.md does not list the shipped third-party assets
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

// Phase selection (release factory contract 8). The licence gate has two
// halves with different prerequisites:
//   source   - approved font sources, manifests, fonts.css, social card and
//              THIRD_PARTY_NOTICES. None of this reads a built artifact, so it
//              runs before the build, on a clean checkout, without a dist/.
//   artifact - the built site ships exactly the vouched-for fonts and card.
//              This reads the build, so it runs AFTER the release build, under
//              the factory lock, against SAI_RELEASE_ARTIFACT_DIR.
// Both halves stay mandatory. With no --phase flag (standalone dev use) both
// run and a missing artifact is a note, preserving the original behaviour.
const PHASE = (process.argv.find((a) => a.startsWith('--phase=')) ?? '').slice('--phase='.length) || 'all';
if (!['all', 'source', 'artifact'].includes(PHASE)) {
  console.error(`unknown --phase=${PHASE} (expected source|artifact)`);
  process.exit(2);
}
const runSource = PHASE === 'all' || PHASE === 'source';
const runArtifact = PHASE === 'all' || PHASE === 'artifact';
// The built artifact under test: the directory the current release transaction
// built (SAI_RELEASE_ARTIFACT_DIR), or dist/ for standalone post-build use.
const ARTIFACT_DIR = process.env.SAI_RELEASE_ARTIFACT_DIR ? resolve(process.env.SAI_RELEASE_ARTIFACT_DIR) : 'dist';

const problems = [];
const fail = (kind, msg) => problems.push(`[${kind}] ${msg}`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

const SOURCES = json('scripts/fonts/sources.json');
const FORBIDDEN = SOURCES.forbidden;
// The code face is composite: Spleen 6x12 primary, DejaVu Sans Mono 2.37 for
// the code points Spleen does not map. Both are approved, hash-pinned sources.
const MONO_SUPPLEMENT = SOURCES.code.supplement;
const MONO_SUPPLEMENT_ROLE = MONO_SUPPLEMENT.role;
const APPROVED = new Map(
  [SOURCES.ui.regular, SOURCES.ui.bold, SOURCES.code, MONO_SUPPLEMENT].map((s) => [s.sha256, s.name]),
);
const UI_APPROVED = new Set([SOURCES.ui.regular.sha256, SOURCES.ui.bold.sha256]);

// ── 1. approved sources ────────────────────────────────────────────────────
for (const src of [SOURCES.ui.regular, SOURCES.ui.bold, SOURCES.code, MONO_SUPPLEMENT]) {
  if (!existsSync(src.file)) fail('source', `${src.file} is missing`);
  else if (sha(src.file) !== src.sha256) fail('source', `${src.file} does not match its approved SHA-256`);
}
for (const lic of [SOURCES.ui.licenceFile, SOURCES.code.licenceFile, MONO_SUPPLEMENT.licenceFile]) {
  if (!existsSync(lic)) fail('source', `licence text ${lic} is missing`);
}

// ── 2. WOFF2 decompression, to look inside the font tables ────────────────
function readBase128(buf, state) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[state.offset++];
    value = value * 128 + (byte & 0x7f);
    if (!(byte & 0x80)) return value;
  }
  throw new Error('bad UIntBase128');
}

function woff2Tables(path) {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 0, 4) !== 'wOF2') throw new Error('not a WOFF2 file');
  const numTables = buf.readUInt16BE(12);
  const compressed = buf.readUInt32BE(20);
  const state = { offset: 48 };
  for (let i = 0; i < numTables; i++) {
    const flags = buf[state.offset++];
    const tagIndex = flags & 0x3f;
    if (tagIndex === 63) state.offset += 4;
    readBase128(buf, state);
    const version = (flags >> 6) & 3;
    const glyfOrLoca = tagIndex === 10 || tagIndex === 11;
    if ((glyfOrLoca && version === 0) || (!glyfOrLoca && version !== 0)) readBase128(buf, state);
  }
  return brotliDecompressSync(buf.subarray(state.offset, state.offset + compressed));
}

function forbiddenIn(buffer) {
  const hits = [];
  for (const word of FORBIDDEN) {
    const ascii = Buffer.from(word, 'latin1');
    const utf16 = Buffer.from([...word].flatMap((c) => [0, c.charCodeAt(0)]));
    if (buffer.includes(ascii) || buffer.includes(utf16)) hits.push(word);
  }
  return hits;
}

// ── 3. production faces ───────────────────────────────────────────────────
const FONT_DIR = 'public/fonts';
const MANIFEST = join(FONT_DIR, 'manifest.json');
const REQUIRED_FACES = [
  ...[10, 11, 12, 14, 16].flatMap((s) => [`sai-pixel-${s}-regular.woff2`, `sai-pixel-${s}-bold.woff2`]),
  'sai-pixel-12-italic.woff2',
  'sai-pixel-mono-12-regular.woff2',
];

let manifest = { faces: [], required: [] };
if (!existsSync(MANIFEST)) fail('face', `${MANIFEST} is missing`);
else {
  manifest = json(MANIFEST);
  const text = readFileSync(MANIFEST, 'utf8');
  const lineage = FORBIDDEN.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  if (lineage.length) fail('lineage', `${MANIFEST} names ${lineage.join(', ')}`);
}
const byFile = new Map(manifest.faces.map((f) => [f.file, f]));
for (const file of REQUIRED_FACES) {
  const face = byFile.get(file);
  const path = join(FONT_DIR, file);
  if (!face) {
    fail('face', `${file} is required but not recorded in ${MANIFEST}`);
    continue;
  }
  if (!existsSync(path)) {
    fail('face', `${path} is missing`);
    continue;
  }
  if (sha(path) !== face.sha256) fail('face', `${path} differs from its manifest SHA-256`);
  if (!APPROVED.has(face.source_sha256)) fail('face', `${file} claims source "${face.source}" which is not an approved source`);
  if (file.startsWith('sai-pixel-mono') ? face.source_sha256 !== SOURCES.code.sha256 : !UI_APPROVED.has(face.source_sha256)) {
    fail('face', `${file} comes from the wrong approved source for its role`);
  }
  if (file.startsWith('sai-pixel-mono')) {
    // Composite provenance must be stated honestly: Spleen stays primary, the
    // supplement names the approved monospaced source, and the glyph counts
    // add up to the shipped cmap.
    const declared = Array.isArray(face.sources) ? face.sources : [];
    const primary = declared.find((s) => s.role === 'primary');
    const supplement = declared.find((s) => s.role === MONO_SUPPLEMENT_ROLE);
    if (!primary || !supplement) {
      fail('supplement', `${file}: a composite code face must record both its primary and its missing-glyph supplement source`);
    } else {
      if (primary.sha256 !== SOURCES.code.sha256) fail('supplement', `${file}: primary source is not the approved Spleen 6x12`);
      if (supplement.sha256 !== MONO_SUPPLEMENT.sha256) {
        fail('supplement', `${file}: supplement source "${supplement.name}" (${String(supplement.sha256).slice(0, 12)}…) is not the approved ${MONO_SUPPLEMENT.name} ${MONO_SUPPLEMENT.version} (${MONO_SUPPLEMENT.sha256.slice(0, 12)}…)`);
      }
    }
    const supplemented = face.supplemented ?? [];
    if (!supplemented.length) fail('supplement', `${file}: records no supplemented code points, so the composite face is not described by the manifest`);
    if ((face.primary_glyphs ?? 0) + supplemented.length !== (face.glyphs ?? -1)) {
      fail('supplement', `${file}: ${face.primary_glyphs ?? 0} primary + ${supplemented.length} supplement glyphs do not add up to ${face.glyphs ?? 'an unrecorded'} glyph count`);
    }
  }
  if (/bitstream|vera|dejavu/i.test(face.family)) fail('face', `${file}: family "${face.family}" uses a name the DejaVu licence reserves`);
  try {
    const hits = forbiddenIn(woff2Tables(path));
    if (hits.length) fail('lineage', `${path} contains ${hits.join(', ')} inside its font tables`);
  } catch (error) {
    fail('face', `${path} could not be decoded: ${error.message}`);
  }
}
for (const file of readdirSync(FONT_DIR)) {
  if (file.endsWith('.woff2') && !REQUIRED_FACES.includes(file)) fail('face', `${FONT_DIR}/${file} is shipped but not a recorded production face`);
}
for (const req of manifest.required ?? []) {
  if (!existsSync(join(FONT_DIR, req))) fail('face', `${MANIFEST} requires ${req}, which is missing`);
}

// ── 4. shipped licence notices ────────────────────────────────────────────
for (const [shipped, source] of [
  [SOURCES.ui.shippedLicence, SOURCES.ui.licenceFile],
  [SOURCES.code.shippedLicence, SOURCES.code.licenceFile],
]) {
  const path = join(FONT_DIR, shipped);
  if (!existsSync(path)) fail('notice', `${path} must ship with the fonts`);
  else if (existsSync(source) && sha(path) !== sha(source)) fail('notice', `${path} differs from ${source}`);
}

// ── 5. fonts.css only loads vouched-for faces ─────────────────────────────
const css = readFileSync('src/styles/fonts.css', 'utf8');
for (const m of css.matchAll(/url\("([^"]+)"\)/g)) {
  const url = m[1];
  const file = url.replace(/^\/fonts\//, '');
  if (!url.startsWith('/fonts/') || !byFile.has(file)) fail('css', `fonts.css loads ${url}, which the font manifest does not vouch for`);
}

// ── 6. social card provenance ─────────────────────────────────────────────
const CARD_MANIFEST = 'public/social/MANIFEST.json';
const CARD = 'public/social/card.png';
if (!existsSync(CARD_MANIFEST)) fail('card', `${CARD_MANIFEST} is missing`);
else {
  const card = json(CARD_MANIFEST);
  const text = readFileSync(CARD_MANIFEST, 'utf8');
  if (!card.generator || !card.font?.sha256 || !card.image?.sha256) fail('card', `${CARD_MANIFEST} lacks generator, font or image provenance`);
  if (card.font && !UI_APPROVED.has(card.font.sha256)) fail('card', `social card font "${card.font.name}" is not an approved UI source`);
  const lineage = FORBIDDEN.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  if (lineage.length) fail('lineage', `${CARD_MANIFEST} names ${lineage.join(', ')}`);
  if (!existsSync(CARD)) fail('card', `${CARD} is missing`);
  else if (card.image && sha(CARD) !== card.image.sha256) fail('card', `${CARD} does not match its recorded provenance`);
}

// ── 7. the built site ships exactly these assets (ARTIFACT phase) ─────────
// Reads the built site, so it is the post-build half of the gate: it runs
// against SAI_RELEASE_ARTIFACT_DIR (the current transaction's build) under the
// factory lock, never an inherited dist/.
const artifactProblems = [];
const failArtifact = (kind, msg) => artifactProblems.push(`[${kind}] ${msg}`);
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
let distNote = `${ARTIFACT_DIR}/ not built — run after npm run build to include it`;
// A missing artifact is a hard failure only when the build is REQUIRED: the
// release factory's `--phase=artifact` call (post-build, under the lock) or any
// run that explicitly names an artifact via SAI_RELEASE_ARTIFACT_DIR. Standalone
// dev use (`--phase=all`, no env) keeps the original behaviour — with no dist/
// the shipped-asset check is a note, not a failure — so a clean checkout can run
// the licence gate without a build.
const artifactRequired = PHASE === 'artifact' || Boolean(process.env.SAI_RELEASE_ARTIFACT_DIR);
if (runArtifact && (existsSync(ARTIFACT_DIR) || artifactRequired)) {
  const artFonts = join(ARTIFACT_DIR, 'fonts');
  if (!existsSync(ARTIFACT_DIR)) {
    failArtifact('dist', `no build artifact at ${ARTIFACT_DIR} — run \`npm run build\` first`);
  } else if (!existsSync(artFonts)) {
    failArtifact('dist', `${artFonts} is missing from the build`);
  } else {
    const files = walk(ARTIFACT_DIR);
    for (const f of files) {
      if (FORBIDDEN.some((w) => f.toLowerCase().includes(w.toLowerCase()))) failArtifact('lineage', `the build ships ${f}`);
    }
    for (const file of readdirSync(FONT_DIR)) {
      const shipped = join(artFonts, file);
      if (!existsSync(shipped)) failArtifact('dist', `${shipped} is missing from the build`);
      else if (sha(shipped) !== sha(join(FONT_DIR, file))) failArtifact('dist', `${shipped} differs from ${FONT_DIR}/${file}`);
    }
    for (const f of walk(artFonts)) {
      if (!existsSync(join(FONT_DIR, f.slice(artFonts.length + 1)))) failArtifact('dist', `${f} is in the build but not in ${FONT_DIR}`);
    }
    const builtCard = join(ARTIFACT_DIR, 'social', 'card.png');
    if (existsSync(CARD) && (!existsSync(builtCard) || sha(builtCard) !== sha(CARD))) {
      failArtifact('dist', `${builtCard} is missing or differs from ${CARD}`);
    }
    distNote = `${ARTIFACT_DIR}/ checked (${files.length} files)`;
  }
}

// ── 8. third-party notices ────────────────────────────────────────────────
if (!existsSync('THIRD_PARTY_NOTICES.md')) fail('notices', 'THIRD_PARTY_NOTICES.md is missing');
else {
  const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
  for (const word of ['DejaVu', 'Spleen', 'Astro']) if (!notices.includes(word)) fail('notices', `THIRD_PARTY_NOTICES.md does not mention ${word}`);
}

if (existsSync(join(FONT_DIR, MONO_SUPPLEMENT.shippedLicence))) {
  if (!existsSync(join(FONT_DIR, SOURCES.ui.shippedLicence)) || sha(join(FONT_DIR, MONO_SUPPLEMENT.shippedLicence)) !== sha(join(FONT_DIR, SOURCES.ui.shippedLicence))) {
    fail('notice', `${MONO_SUPPLEMENT.shippedLicence} must ship the same DejaVu licence text the composite code face is built under`);
  }
}

// Report only the problems the selected phase owns. The source half (1-6, 8)
// is computed above regardless, but a --phase=artifact run must not fail on,
// or take credit for, source-side checks — and vice versa. Both halves remain
// mandatory across the two phases the factory runs.
const reported = [
  ...(runSource ? problems : []),
  ...(runArtifact ? artifactProblems : []),
];
if (reported.length) {
  for (const p of reported) console.log(`  FAIL ${p}`);
  console.log(`\nFAILED: ${reported.length} licence/provenance problem(s)`);
  process.exit(1);
}
const scope = PHASE === 'source' ? 'source provenance' : PHASE === 'artifact' ? 'built artifact' : 'source + built artifact';
console.log(
  `OK [${scope}]: ${REQUIRED_FACES.length} faces from approved sources (DejaVu Sans 2.37 for the UI, Spleen 6x12 2.2.0 primary + DejaVu Sans Mono 2.37 supplement for the code face), notices shipped, social card provenance intact, no forbidden lineage; ${distNote}`,
);
