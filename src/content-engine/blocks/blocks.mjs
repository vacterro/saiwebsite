/**
 * Stable content blocks (content-system roadmap M37, M41).
 *
 * A block is the smallest unit of maintenance and translation: a stable ID,
 * canonical English text, a type, and the sources it depends on. Pages ask for
 * blocks by ID, so a block can move between pages without invalidating its
 * translations, and a one-character change marks exactly one unit stale.
 *
 * Catalogue files: src/content-engine/blocks/<domain>.json
 *   { "schemaVersion": 1, "domain": "home",
 *     "blocks": { "<id>": { "type": "text|inline", "text": "...",
 *                           "note"?: "context for translators",
 *                           "sourceIds"?: ["..."] } } }
 *
 * Types
 *   text    plain text; `{name}` placeholders only
 *   inline  one paragraph of inline markup: `code`, **strong**, [label](href),
 *           and `{name}` placeholders in text or href
 *
 * Pure apart from node:crypto, so the same functions run in `astro build` and
 * in the Node gates.
 */
import { createHash } from 'node:crypto';

export const BLOCK_TYPES = ['text', 'inline'];
export const CATALOG_SCHEMA_VERSION = 1;
const BLOCK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)+$/;
const PLACEHOLDER = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g;

/** Unicode NFC, one space for every whitespace run, trimmed. */
export function normalizeText(text) {
  return String(text).normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Canonical hash of a block (M41): type + normalized text. Formatting-only
 * noise (line wrapping, indentation, trailing spaces) does not change it; any
 * change a reader could see does.
 */
export function blockHash(block) {
  return createHash('sha256').update(`${block.type}\0${normalizeText(block.text)}`).digest('hex').slice(0, 16);
}

export function placeholders(text) {
  return [...String(text).matchAll(PLACEHOLDER)].map((m) => m[1]).sort();
}

/**
 * Tokenize inline markup. Grammar, deliberately tiny:
 *   `code`  **strong**  [label](href)
 * Labels may contain `code` and placeholders; strong may contain links.
 * Unbalanced markers are an error, so a translation cannot silently break markup.
 */
export function tokenize(src) {
  const tokens = [];
  let i = 0;
  let text = '';
  const flush = () => {
    if (text) tokens.push({ t: 'text', v: text });
    text = '';
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '`') {
      const end = src.indexOf('`', i + 1);
      if (end < 0) throw new Error('unclosed `code` span');
      flush();
      tokens.push({ t: 'code', v: src.slice(i + 1, end) });
      i = end + 1;
    } else if (src.startsWith('**', i)) {
      const end = src.indexOf('**', i + 2);
      if (end < 0) throw new Error('unclosed **strong**');
      flush();
      tokens.push({ t: 'strong', v: tokenize(src.slice(i + 2, end)) });
      i = end + 2;
    } else if (c === '[') {
      const close = src.indexOf('](', i);
      const end = close < 0 ? -1 : src.indexOf(')', close + 2);
      if (close < 0 || end < 0) throw new Error('malformed [label](href) link');
      flush();
      tokens.push({ t: 'link', v: tokenize(src.slice(i + 1, close)), href: src.slice(close + 2, end) });
      i = end + 1;
    } else if (c === ']' || (c === '*' && src[i + 1] === '*')) {
      throw new Error(`stray "${c}" in inline markup`);
    } else {
      text += c;
      i++;
    }
  }
  flush();
  return tokens;
}

/** Shape of the markup independent of wording: what a translation must keep. */
export function markupSignature(src) {
  const walk = (tokens) =>
    tokens
      .filter((t) => t.t !== 'text')
      .map((t) => (t.t === 'code' ? `code(${t.v})` : t.t === 'link' ? `link(${t.href})[${walk(t.v)}]` : `strong[${walk(t.v)}]`))
      .join(',');
  return walk(tokenize(src));
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c]);

function fill(text, vars, html = {}) {
  return text.replace(PLACEHOLDER, (whole, name) => {
    if (name in html) return html[name];
    if (!(name in vars)) throw new Error(`placeholder {${name}} has no value`);
    return escapeHtml(vars[name]);
  });
}

/** Escape literal text, then substitute placeholders (escaped values, or trusted HTML for htmlVars). */
function textHtml(text, vars, htmlVars) {
  const parts = text.split(PLACEHOLDER);
  let out = '';
  for (let k = 0; k < parts.length; k++) {
    if (k % 2 === 0) out += escapeHtml(parts[k]);
    else out += fill(`{${parts[k]}}`, vars, htmlVars);
  }
  return out;
}

/** Render a block template to HTML. External links get rel="noopener" data-external, as everywhere on the site. */
export function renderInline(src, vars = {}, htmlVars = {}) {
  const walk = (tokens) =>
    tokens
      .map((t) => {
        if (t.t === 'text') return textHtml(t.v, vars, htmlVars);
        if (t.t === 'code') return `<code>${textHtml(t.v, vars, htmlVars)}</code>`;
        if (t.t === 'strong') return `<strong>${walk(t.v)}</strong>`;
        const href = fill(t.href, vars);
        const external = /^https?:\/\//.test(href) ? ' rel="noopener" data-external' : '';
        return `<a href="${href}"${external}>${walk(t.v)}</a>`;
      })
      .join('');
  return walk(tokenize(src));
}

/** Render a plain text block: placeholders substituted, no markup, not escaped (Astro escapes on output). */
export function renderText(src, vars = {}) {
  return String(src).replace(PLACEHOLDER, (whole, name) => {
    if (!(name in vars)) throw new Error(`placeholder {${name}} has no value`);
    return String(vars[name]);
  });
}

/** Validate one catalogue file. Returns problem strings. */
export function validateCatalog(doc, file, sourceIds = []) {
  const problems = [];
  if (!doc || typeof doc !== 'object' || typeof doc.blocks !== 'object') return [`[malformed] ${file}: expected { schemaVersion, domain, blocks }`];
  if (doc.schemaVersion !== CATALOG_SCHEMA_VERSION) problems.push(`[schema-version] ${file}: schemaVersion ${doc.schemaVersion}`);
  if (!/^[a-z0-9-]+$/.test(doc.domain ?? '')) problems.push(`[malformed] ${file}: domain "${doc.domain}"`);
  for (const [id, block] of Object.entries(doc.blocks)) {
    const where = `${file} ${id}`;
    if (!BLOCK_ID.test(id)) problems.push(`[bad-id] ${where}: block IDs are dotted lowercase with at least two segments`);
    else if (!id.startsWith(`${doc.domain}.`)) problems.push(`[bad-id] ${where}: block IDs in this file start with "${doc.domain}."`);
    for (const key of Object.keys(block)) if (!['type', 'text', 'note', 'sourceIds'].includes(key)) problems.push(`[unknown-field] ${where}: "${key}"`);
    if (!BLOCK_TYPES.includes(block.type)) problems.push(`[bad-enum] ${where}: type "${block.type}" is not ${BLOCK_TYPES.join(' | ')}`);
    if (typeof block.text !== 'string' || !normalizeText(block.text)) problems.push(`[malformed] ${where}: text must be a non-empty string`);
    else if (block.type === 'inline') {
      try {
        tokenize(block.text);
      } catch (error) {
        problems.push(`[bad-markup] ${where}: ${error.message}`);
      }
    } else if (/`|\*\*|\]\(/.test(block.text)) {
      problems.push(`[bad-markup] ${where}: a text block carries inline markup; make it type inline`);
    }
    for (const s of block.sourceIds ?? []) if (!sourceIds.includes(s)) problems.push(`[unknown-source] ${where}: "${s}" is not declared in sources.json`);
  }
  return problems;
}

/**
 * Canonical hash of a whole Markdown document (front matter included), for
 * document-level translation units. Whitespace-only edits do not change it.
 */
export function documentHash(raw) {
  return createHash('sha256').update(`markdown\0${normalizeText(String(raw).replace(/\r\n/g, '\n'))}`).digest('hex').slice(0, 16);
}
