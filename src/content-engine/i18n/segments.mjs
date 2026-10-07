/**
 * Stable documentation segments (pre-scale foundation hardening).
 *
 * A documentation page used to be one indivisible translation unit: any one
 * paragraph edit changed the whole `documentHash`, marked the whole page STALE
 * and handed every locale the whole document again. That is a maintenance
 * multiplier proportional to the number of locales, and it must not survive
 * into a 33-language site.
 *
 * A canonical document is now split into stable segments, each introduced by
 * an explicit directive on its own line:
 *
 *   <!-- i18n:docs.getting-started.introduction.intro -->
 *
 * The directive carries the segment's permanent identity. Identity is never
 * derived from the English heading text, a line number or a paragraph ordinal,
 * so reordering sections or rewording a heading leaves every ID — and every
 * translation attached to it — untouched.
 *
 * Two segments always exist without a directive: the front-matter `title` and
 * `description` (`docs.<slug>.title`, `docs.<slug>.description`).
 *
 * Granularity is semantic, not maximal: a directive opens at a section or a
 * paragraph boundary and the segment holds that coherent block — a lead
 * paragraph, a `##` section with its prose, a single glossary term — never a
 * lone sentence. Code fences stay inside their segment and are preserved
 * byte for byte by the existing Markdown signature check.
 *
 * Pure (node:crypto only), so `astro build` and the Node gates share it.
 */
import { createHash } from 'node:crypto';
import { parseFrontmatter } from '@astrojs/markdown-remark';
import { normalizeText } from '../blocks/blocks.mjs';

/** A segment ID: dotted lowercase, at least three parts (same shape as a block ID). */
const SEGMENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*){2,}$/;

/** One directive line: `<!-- i18n:<segment id> -->`, alone on its line. */
const DIRECTIVE_LINE = /^[ \t]*<!--[ \t]*i18n:([A-Za-z0-9._-]+)[ \t]*-->[ \t]*$/;

/** The same directive anywhere in the body, plus the line break that follows it. */
const STRIP = /^[ \t]*<!--[ \t]*i18n:[A-Za-z0-9._-]+[ \t]*-->[ \t]*\r?\n?/gm;

export function isSegmentId(id) {
  return SEGMENT_ID.test(String(id));
}

/** The ID prefix every segment of a document shares: `docs.<section>.<name>`. */
export function documentSegmentPrefix(slug) {
  return `docs.${String(slug).split('/').join('.')}`;
}

/**
 * Remove every segment directive from Markdown, leaving the prose exactly as
 * written. The canonical English renderer, the raw `.md` twin, the search
 * index and `llms-full.txt` all read the stripped body, so a directive is
 * invisible outside the content engine.
 */
export function stripSegmentDirectives(md) {
  return String(md).replace(STRIP, '');
}

/**
 * Canonical hash of one segment: kind + normalized text. Line wrapping,
 * indentation and trailing spaces do not change it; anything a reader could
 * see does. The kind is part of the hash so a `text` and a `markdown` segment
 * with the same characters can never collide.
 */
export function segmentHash(kind, text) {
  return createHash('sha256').update(`${kind}\0${normalizeText(text)}`).digest('hex').slice(0, 16);
}

/** Segment of a heading, so a name can be suggested for a new section. */
export function slugifySegmentName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[`'"’]/g, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'section';
}

/**
 * Parse one canonical document into its stable segments.
 *
 * @param {{ raw: string, slug: string }} o
 * @returns {{ slug: string, frontmatter: object, body: string,
 *             segments: {id: string, name: string, kind: 'text'|'markdown', text: string, hash: string}[],
 *             problems: string[] }}
 */
export function parseDocument({ raw, slug }) {
  const text = String(raw).replace(/\r\n/g, '\n');
  const { frontmatter, content } = parseFrontmatter(text);
  // `body` keeps the file's own line endings so canonical output stays byte-faithful.
  const rawContent = String(raw).replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const prefix = documentSegmentPrefix(slug);
  const problems = [];
  const segments = [];
  const seen = new Set();

  const push = (id, name, kind, value) => {
    if (seen.has(id)) problems.push(`[duplicate-segment] ${id}: declared twice in ${slug}`);
    seen.add(id);
    const body = String(value).trim();
    if (kind === 'markdown' && !normalizeText(body)) problems.push(`[empty-segment] ${id}: the segment has no content`);
    segments.push({ id, name, kind, text: body, hash: segmentHash(kind, body) });
  };

  push(`${prefix}.title`, 'title', 'text', String(frontmatter.title ?? ''));
  push(`${prefix}.description`, 'description', 'text', String(frontmatter.description ?? ''));

  const lines = content.split('\n');
  let current = null;
  const unmarked = [];
  const flush = () => {
    if (!current) return;
    if (!current.lines.some((l) => l.trim())) problems.push(`[empty-segment] ${current.id}: the segment has no content`);
    else push(current.id, current.name, 'markdown', current.lines.join('\n'));
    current = null;
  };

  for (const line of lines) {
    const m = DIRECTIVE_LINE.exec(line);
    if (m) {
      flush();
      const id = m[1];
      if (!isSegmentId(id)) problems.push(`[bad-segment-id] ${slug}: "${id}" is not a dotted lowercase segment ID`);
      else if (!id.startsWith(`${prefix}.`)) problems.push(`[bad-segment-id] ${slug}: "${id}" must start with "${prefix}."`);
      current = { id, name: id.slice(prefix.length + 1), lines: [] };
    } else if (current) {
      current.lines.push(line);
    } else if (line.trim()) {
      unmarked.push(line);
    }
  }
  flush();

  if (!segments.some((s) => s.kind === 'markdown')) {
    problems.push(`[unmarked-document] ${slug}: no segment directives — every documentation page must be segmented`);
  } else if (unmarked.length) {
    problems.push(`[unmarked-content] ${slug}: ${unmarked.length} line(s) before the first directive are outside every segment (first: "${unmarked[0].trim().slice(0, 60)}")`);
  }

  return { slug, frontmatter, body: stripSegmentDirectives(rawContent).trim(), segments, problems };
}

/**
 * Which segment IDs a document declares, in order. Used by the content lock
 * and the impact graph.
 */
export function segmentIds(parsed) {
  return parsed.segments.map((s) => s.id);
}
