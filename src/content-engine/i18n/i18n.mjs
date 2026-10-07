/**
 * i18n kernel (content-system roadmap M42-M45). Pure: no disk.
 *
 * Locales are data (locales.json). Canonical English lives in the block
 * catalogues and the docs collection; a translation is a unit keyed by the
 * same ID that records the canonical hash it was made from. Status is never
 * guessed:
 *
 *   stored by the translator   MACHINE_DRAFT -> REVIEWED -> CURRENT
 *   computed by the kernel     MISSING   no unit for a canonical ID
 *                              STALE     unit.sourceHash != current canonical hash
 *                              ORPHANED  unit for an ID that no longer exists
 *   render state               FALLBACK  the page shows the fallback chain's text
 *
 * Resolution walks requested locale -> its fallback -> ... -> canonical English
 * and only accepts a unit whose status the requesting locale's renderStatuses
 * allows and whose hash is current. A raw key is never shown.
 */
import { markupSignature, normalizeText, placeholders } from '../blocks/blocks.mjs';

export const STAGES = ['canonical', 'pseudo', 'pilot', 'active', 'planned', 'deprecated'];
export const STORED_STATUSES = ['MACHINE_DRAFT', 'REVIEWED', 'CURRENT'];
export const ALL_STATUSES = ['MISSING', 'MACHINE_DRAFT', 'REVIEWED', 'CURRENT', 'STALE', 'FALLBACK', 'ORPHANED'];
const LOCALE_FIELDS = ['id', 'displayName', 'nativeName', 'stage', 'enabled', 'fallback', 'direction', 'scripts', 'searchEnabled', 'llmsEnabled', 'renderStatuses', 'scope'];
/** BCP 47 shaped: language, optional script/region/variant subtags, or the qps-ploc pseudo-locale. */
const BCP47 = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|[0-9]{3}))?(?:-[a-z0-9]{4,8})*$/;
export const SCRIPTS = ['Latn', 'Cyrl', 'Grek', 'Arab', 'Hebr', 'Hani', 'Jpan', 'Kore', 'Deva', 'Thai'];

/** URL segment for a locale: lowercase, so /pt-br/ and /qps-ploc/ stay valid registry routes. */
export const localePrefix = (id) => id.toLowerCase();

export function validateLocales(doc) {
  const problems = [];
  if (!doc || !Array.isArray(doc.locales)) return ['[malformed] locales.json: expected { canonical, locales: [] }'];
  const ids = new Set(doc.locales.map((l) => l?.id));
  if (!ids.has(doc.canonical)) problems.push(`[malformed] locales.json: canonical "${doc.canonical}" is not a declared locale`);
  const seen = new Set();
  for (const l of doc.locales) {
    const where = `locale ${l?.id}`;
    for (const f of LOCALE_FIELDS) if (!(f in (l ?? {}))) problems.push(`[missing-field] ${where}: no "${f}"`);
    for (const f of Object.keys(l ?? {})) if (!LOCALE_FIELDS.includes(f)) problems.push(`[unknown-field] ${where}: "${f}"`);
    if (!BCP47.test(l.id)) problems.push(`[bad-id] ${where}: not a BCP 47 tag`);
    if (seen.has(localePrefix(l.id))) problems.push(`[duplicate-id] ${where}: declared twice (case-insensitive)`);
    seen.add(localePrefix(l.id));
    if (!STAGES.includes(l.stage)) problems.push(`[bad-enum] ${where}: stage "${l.stage}"`);
    if (!['ltr', 'rtl'].includes(l.direction)) problems.push(`[bad-enum] ${where}: direction "${l.direction}"`);
    for (const s of l.scripts ?? []) if (!SCRIPTS.includes(s)) problems.push(`[bad-enum] ${where}: script "${s}"`);
    for (const s of l.renderStatuses ?? []) if (!STORED_STATUSES.includes(s)) problems.push(`[bad-enum] ${where}: renderStatuses "${s}"`);
    if (l.scope !== 'all' && !(l.scope in (doc.scopes ?? {}))) problems.push(`[malformed] ${where}: scope "${l.scope}" is not declared in scopes`);
    if (l.id === doc.canonical) {
      if (l.stage !== 'canonical' || l.fallback !== null || !l.enabled) problems.push(`[contract] ${where}: the canonical locale is stage canonical, enabled, with no fallback`);
    } else {
      if (l.stage === 'canonical') problems.push(`[contract] ${where}: only ${doc.canonical} is canonical`);
      if (!ids.has(l.fallback)) problems.push(`[contract] ${where}: fallback "${l.fallback}" is not a declared locale`);
      if (l.enabled && ['planned', 'deprecated'].includes(l.stage)) problems.push(`[contract] ${where}: a ${l.stage} locale cannot be enabled`);
    }
  }
  // Fallback chains must end at the canonical locale.
  for (const l of doc.locales) {
    const seenChain = new Set();
    let cur = l;
    while (cur && cur.id !== doc.canonical) {
      if (seenChain.has(cur.id)) {
        problems.push(`[cycle] locale ${l.id}: fallback chain loops at ${cur.id}`);
        break;
      }
      seenChain.add(cur.id);
      cur = doc.locales.find((x) => x.id === cur.fallback);
    }
  }
  return problems;
}

export const enabledLocales = (doc) => doc.locales.filter((l) => l.enabled && l.id !== doc.canonical);
/** Locales visitors can reach: enabled, not the pseudo-locale. */
export const publicLocales = (doc) => doc.locales.filter((l) => l.enabled && l.stage !== 'pseudo');

/** The kernel's verdict on one unit against the current canonical hash. */
export function unitStatus(unit, canonicalHash) {
  if (!unit) return 'MISSING';
  if (canonicalHash === undefined) return 'ORPHANED';
  if (unit.sourceHash !== canonicalHash) return 'STALE';
  return unit.status;
}

/**
 * Check a translated text against its canonical English: same placeholders,
 * same markup (code spans, link targets, emphasis structure), and every
 * do-not-translate glossary term kept verbatim. Returns problem strings.
 */
export function checkTranslation({ id, type, en, text, glossary, locale }) {
  const problems = [];
  if (typeof text !== 'string' || !normalizeText(text)) return [`[empty] ${locale} ${id}: translation is empty`];
  const a = placeholders(en).join(',');
  const b = placeholders(text).join(',');
  if (a !== b) problems.push(`[placeholder] ${locale} ${id}: expected {${a}}, found {${b}}`);
  if (type === 'inline' || type === 'markdown') {
    try {
      const sigEn = type === 'inline' ? markupSignature(en) : markdownSignature(en);
      const sigTr = type === 'inline' ? markupSignature(text) : markdownSignature(text);
      if (sigEn !== sigTr) problems.push(`[markup] ${locale} ${id}: code spans, link targets and emphasis must match the English (${sigEn || 'none'})`);
    } catch (error) {
      problems.push(`[markup] ${locale} ${id}: ${error.message}`);
    }
  } else if (/`|\*\*|\]\(/.test(text)) {
    problems.push(`[markup] ${locale} ${id}: plain text unit carries markup`);
  }
  for (const term of glossary?.terms ?? []) {
    if (term.translate) continue;
    if (en.includes(term.en) && !text.includes(term.en)) problems.push(`[glossary] ${locale} ${id}: "${term.en}" must stay verbatim (${term.notes})`);
  }
  for (const [termId, rule] of Object.entries(glossary?.locales?.[locale] ?? {})) {
    for (const bad of rule.forbidden ?? []) if (text.includes(bad)) problems.push(`[glossary] ${locale} ${id}: "${bad}" is a forbidden variant of ${termId}; use "${rule.preferred}"`);
  }
  return problems;
}

/**
 * Structure of a Markdown document a translation must keep: fenced code
 * blocks verbatim, the same inline code spans, the same link targets and the
 * same heading levels in the same order. Prose is free.
 */
export function markdownSignature(md) {
  const src = String(md).replace(/\r\n/g, '\n');
  const fences = [...src.matchAll(/^```[^\n]*\n[\s\S]*?^```/gm)].map((m) => m[0]);
  const rest = src.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '');
  const code = [...rest.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]);
  const links = [...rest.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]);
  const headings = [...rest.matchAll(/^(#{1,6}) /gm)].map((m) => m[1].length);
  return JSON.stringify({ fences, code: code.sort(), links: links.sort(), headings });
}

// ---------------------------------------------------------------------------
// Pseudo-localization (qps-ploc): accented, ~35% longer, «guillemeted» text that
// keeps markup, placeholders, code and URLs intact. It proves routing,
// fallback, glyph coverage and layout stretch without a real translation.
// ---------------------------------------------------------------------------
const ACCENT = {
  a: 'å', b: 'ƀ', c: 'ç', d: 'ð', e: 'é', f: 'ƒ', g: 'ĝ', h: 'ĥ', i: 'î', j: 'ĵ', k: 'ķ', l: 'ļ', m: 'm', n: 'ñ', o: 'ö', p: 'þ', q: 'q', r: 'ŕ', s: 'š', t: 'ţ', u: 'û', v: 'v', w: 'ŵ', x: 'x', y: 'ý', z: 'ž',
  A: 'Å', B: 'Ɓ', C: 'Ç', D: 'Ð', E: 'É', F: 'F', G: 'Ĝ', H: 'Ĥ', I: 'Î', J: 'Ĵ', K: 'Ķ', L: 'Ļ', M: 'M', N: 'Ñ', O: 'Ö', P: 'Þ', Q: 'Q', R: 'Ŕ', S: 'Š', T: 'Ţ', U: 'Û', V: 'V', W: 'Ŵ', X: 'X', Y: 'Ý', Z: 'Ž',
};
const VOWEL = /[aeiouAEIOU]/;

function pseudoWords(text, keep) {
  return text.replace(/[A-Za-z]+/g, (word) => {
    if (keep.some((k) => k === word)) return word;
    let out = '';
    for (const ch of word) out += VOWEL.test(ch) && word.length > 3 ? ACCENT[ch] + ACCENT[ch] : ACCENT[ch] ?? ch;
    return out;
  });
}

/** Protected spans: placeholders, `code`, link targets, URLs, and do-not-translate terms. */
export function pseudoLocalize(text, glossary, type = 'inline') {
  const keep = (glossary?.terms ?? []).filter((t) => !t.translate).flatMap((t) => t.en.split(/[^A-Za-z]+/)).filter(Boolean);
  const pattern = type === 'markdown'
    ? /(^```[\s\S]*?^```$|`[^`\n]+`|\]\([^)]*\)|\{[a-zA-Z0-9]+\}|https?:\/\/\S+|<[^>]+>|^#{1,6} |^\s*[-*] |^\s*\d+\. |\*\*|\[)/gm
    : /(`[^`]+`|\]\([^)]*\)|\{[a-zA-Z0-9]+\}|https?:\/\/\S+|\*\*|\[)/g;
  const parts = String(text).split(pattern);
  const body = parts.map((part, i) => (i % 2 === 1 ? part : pseudoWords(part, keep))).join('');
  return type === 'markdown' ? body : `«${body}»`;
}

// ---------------------------------------------------------------------------
// Variant plan: which localized routes exist. One pure function shared by the
// Astro pages (catalog.ts) and the Node gates (store.mjs), so the built site
// and the registry inventory cannot disagree about locale routes.
// ---------------------------------------------------------------------------

/** '/about/' -> '/et/about/'; the 404 file becomes a directory page in a locale. */
export function variantRoute(route, locale, canonical = 'en') {
  if (locale === canonical) return route;
  const base = route === '/404.html' ? '/404/' : route;
  return `/${localePrefix(locale)}${base}`;
}

/**
 * Status of a document-level unit (a docs page translation).
 * @param {{frontmatter: object} | undefined} translation
 */
export function docStatus(translation, canonicalHash) {
  if (!translation) return 'MISSING';
  return unitStatus({ sourceHash: translation.frontmatter.sourceHash, status: translation.frontmatter.status }, canonicalHash);
}

/**
 * @param {object} o
 * @param {object} o.localesDoc
 * @param {object} o.registry          pages.json
 * @param {Record<string, {hash: string, section: string}>} o.docs  canonical docs by slug
 * @param {Record<string, Record<string, {frontmatter: object, body: string}>>} o.docTranslations  locale -> slug -> parsed file
 * @returns {{locale: string, prefix: string, stage: string, pages: {pageId: string, route: string, variant: string}[], docs: {slug: string, status: string, variant: string}[]}[]}
 */
export function variantPlan({ localesDoc, registry, docs, docTranslations }) {
  const plan = [];
  for (const l of enabledLocales(localesDoc)) {
    const scope = l.scope === 'all' ? null : localesDoc.scopes[l.scope];
    const pageIds = scope ? scope.pages : registry.pages.filter((p) => p.localizable).map((p) => p.id);
    const pages = pageIds.map((pageId) => {
      const page = registry.pages.find((p) => p.id === pageId);
      if (!page) throw new Error(`locale scope names unknown page ${pageId}`);
      return { pageId, route: page.route, variant: variantRoute(page.route, l.id, localesDoc.canonical) };
    });
    const docList = [];
    for (const [slug, doc] of Object.entries(docs).sort(([a], [b]) => a.localeCompare(b))) {
      let status;
      if (l.stage === 'pseudo') status = scope && !scope.docSections.includes(doc.section) ? 'MISSING' : 'CURRENT';
      else status = docStatus(docTranslations?.[l.id]?.[slug], doc.hash);
      if (l.stage === 'pseudo' ? status === 'CURRENT' : l.renderStatuses.includes(status)) {
        docList.push({ slug, status, variant: variantRoute(`/docs/${slug}/`, l.id, localesDoc.canonical) });
      }
    }
    plan.push({ locale: l.id, prefix: localePrefix(l.id), stage: l.stage, pages, docs: docList });
  }
  return plan;
}
