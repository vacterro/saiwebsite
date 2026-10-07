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
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

const problems = [];
const fail = (kind, msg) => problems.push(`[${kind}] ${msg}`);
const sha = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

const SOURCES = json('scripts/fonts/sources.json');
const FORBIDDEN = SOURCES.forbidden;
const APPROVED = new Map(
  [SOURCES.ui.regular, SOURCES.ui.bold, SOURCES.code].map((s) => [s.sha256, s.name]),
);
const UI_APPROVED = new Set([SOURCES.ui.regular.sha256, SOURCES.ui.bold.sha256]);

// ── 1. approved sources ────────────────────────────────────────────────────
for (const src of [SOURCES.ui.regular, SOURCES.ui.bold, SOURCES.code]) {
  if (!existsSync(src.file)) fail('source', `${src.file} is missing`);
  else if (sha(src.file) !== src.sha256) fail('source', `${src.file} does not match its approved SHA-256`);
}
for (const lic of [SOURCES.ui.licenceFile, SOURCES.code.licenceFile]) {
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

// ── 7. the built site ships exactly these assets ──────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
let distNote = 'dist/ not built — run after npm run build to include it';
if (existsSync('dist')) {
  const files = walk('dist');
  for (const f of files) {
    if (FORBIDDEN.some((w) => f.toLowerCase().includes(w.toLowerCase()))) fail('lineage', `dist ships ${f}`);
  }
  for (const file of readdirSync(FONT_DIR)) {
    const shipped = join('dist/fonts', file);
    if (!existsSync(shipped)) fail('dist', `${shipped} is missing from the build`);
    else if (sha(shipped) !== sha(join(FONT_DIR, file))) fail('dist', `${shipped} differs from ${FONT_DIR}/${file}`);
  }
  for (const f of walk('dist/fonts')) {
    if (!existsSync(join(FONT_DIR, f.slice('dist/fonts/'.length)))) fail('dist', `${f} is in the build but not in ${FONT_DIR}`);
  }
  if (existsSync(CARD) && (!existsSync('dist/social/card.png') || sha('dist/social/card.png') !== sha(CARD))) {
    fail('dist', 'dist/social/card.png is missing or differs from public/social/card.png');
  }
  distNote = `dist/ checked (${files.length} files)`;
}

// ── 8. third-party notices ────────────────────────────────────────────────
if (!existsSync('THIRD_PARTY_NOTICES.md')) fail('notices', 'THIRD_PARTY_NOTICES.md is missing');
else {
  const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8');
  for (const word of ['DejaVu', 'Spleen', 'Astro']) if (!notices.includes(word)) fail('notices', `THIRD_PARTY_NOTICES.md does not mention ${word}`);
}

if (problems.length) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log(`\nFAILED: ${problems.length} licence/provenance problem(s)`);
  process.exit(1);
}
console.log(
  `OK: ${REQUIRED_FACES.length} faces from approved sources (DejaVu Sans 2.37, Spleen 6x12 2.2.0), notices shipped, social card provenance intact, no forbidden lineage; ${distNote}`,
);
