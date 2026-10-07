/**
 * Build-time catalogue for Astro pages (roadmap M37, M42, M43, M47).
 *
 * Loads every canonical block catalogue, the page registry labels, every
 * translation unit file and every document SEGMENT translation with
 * import.meta.glob, validates them, and hands out translators and the variant
 * plan. The Node gates load the same files through store.mjs and feed the
 * same pure functions, so a page and a gate cannot disagree.
 */
import { createMarkdownProcessor, markdownConfigDefaults } from '@astrojs/markdown-remark';
import localesDoc from './locales.json';
import glossary from './glossary.json';
import registry from '../registry/pages.json';
import sources from '../registry/sources.json';
import rehypeWintage from '../../lib/rehype-wintage.mjs';
import remarkI18n from '../../lib/remark-i18n.mjs';
import { validateCatalog } from '../blocks/blocks.mjs';
import { sourceIdsOf } from '../registry/sources.mjs';
import { localePrefix, pseudoLocalize, publicLocales, validateLocales, variantPlan, variantRoute } from './i18n.mjs';
import { markFallback, resolveSegment } from './assemble.mjs';
import { documentSegmentPrefix, parseDocument } from './segments.mjs';
import { createTranslator } from './translator.mjs';
import { mergeCatalogs, pageLabelBlocks, unitsByLocale } from './units.mjs';

type Doc = Record<string, any>;

const catalogFiles = import.meta.glob<Doc>('../blocks/*.json', { eager: true, import: 'default' });
const unitFiles = import.meta.glob<Doc>('../../locales/*/*.json', { eager: true, import: 'default' });
const canonicalDocRaw = import.meta.glob<string>('../../content/docs/**/*.md', { eager: true, query: '?raw', import: 'default' });
const docUnitRaw = import.meta.glob<Doc>('../../locales/*/docs/**/*.json', { eager: true, import: 'default' });

const problems = [
  ...validateLocales(localesDoc),
  ...Object.entries(catalogFiles).flatMap(([file, doc]) => validateCatalog(doc, file, sourceIdsOf(sources))),
];
if (problems.length) throw new Error(`i18n catalogue is invalid:\n  ${problems.join('\n  ')}`);

export const BLOCKS: Record<string, any> = mergeCatalogs([...Object.values(catalogFiles), ...pageLabelBlocks(registry)]);
export const UNITS = unitsByLocale(Object.values(unitFiles)) as Record<string, Record<string, any>>;
export const LOCALES = localesDoc;
export const CANONICAL_LOCALE: string = localesDoc.canonical;
/** Locales a visitor can choose (canonical included, pseudo excluded). */
export const PUBLIC_LOCALES = publicLocales(localesDoc);
export { localePrefix };

export type Segment = { id: string; name: string; kind: 'text' | 'markdown'; text: string; hash: string };
const DOCS: Record<string, { prefix: string; section: string; title: string; description: string; segments: Segment[]; segmentsById: Record<string, Segment> }> = {};
for (const [file, raw] of Object.entries(canonicalDocRaw)) {
  const slug = file.replace(/^.*\/content\/docs\//, '').replace(/\.md$/, '');
  const parsed = parseDocument({ raw, slug }) as { frontmatter: Doc; segments: Segment[] };
  DOCS[slug] = {
    prefix: documentSegmentPrefix(slug),
    section: parsed.frontmatter.section,
    title: String(parsed.frontmatter.title ?? ''),
    description: String(parsed.frontmatter.description ?? ''),
    segments: parsed.segments,
    segmentsById: Object.fromEntries(parsed.segments.map((s) => [s.id, s])),
  };
}
/** locale -> document slug -> `{units: {segment id: unit}}` (src/locales/<locale>/docs/<section>/<name>.json). */
const DOC_UNITS: Record<string, Record<string, { units: Record<string, any> }>> = {};
for (const [file, doc] of Object.entries(docUnitRaw)) {
  const m = /\/locales\/([^/]+)\/docs\/(.+)\.json$/.exec(file);
  if (!m) continue;
  ((DOC_UNITS[m[1]] ??= {})[m[2]] = doc as { units: Record<string, any> });
}

/** Which localized routes exist; identical to the plan the registry gate computes. */
export const PLAN = variantPlan({ localesDoc, registry, docs: DOCS, docUnits: DOC_UNITS });
/** Locales that build their own routes (pseudo included). */
export const ROUTED_LOCALES = PLAN.map((p) => p.locale);

export type Translator = ReturnType<typeof createTranslator> & { href: (route: string) => string };

export function localeOf(id: string) {
  const l = localesDoc.locales.find((x) => x.id === id);
  if (!l) throw new Error(`unknown locale ${id}`);
  return l;
}

/** Canonical routes that have a variant in `locale`. */
function variantSet(locale: string): Set<string> {
  const p = PLAN.find((x) => x.locale === locale);
  if (!p) return new Set();
  return new Set([...p.pages.map((x) => x.route), ...p.docs.map((d) => `/docs/${d.slug}/`)]);
}

/**
 * A translator for one page render. `href` maps a canonical internal route to
 * its variant in this locale when one exists, and leaves it canonical
 * otherwise, so a translated page never links to a route that was not built.
 */
export function translator(locale: string = CANONICAL_LOCALE): Translator {
  const base = createTranslator({ locale, localesDoc, blocks: BLOCKS, units: UNITS, glossary });
  const variants = variantSet(locale);
  const href = (route: string) => {
    if (locale === CANONICAL_LOCALE || !route.startsWith('/')) return route;
    const [path, hash] = route.split('#');
    return variants.has(path) ? `${variantRoute(path, locale, CANONICAL_LOCALE)}${hash ? `#${hash}` : ''}` : route;
  };
  return {
    ...base,
    href,
    html: (id: string, vars: Doc = {}, htmlVars: Doc = {}) => base.html(id, vars, htmlVars).replace(/href="(\/[^"]*)"/g, (_m: string, r: string) => `href="${href(r)}"`),
  };
}

/** For a canonical route: every locale that has a variant, with its path (canonical first). */
export function alternatesOf(route: string): { locale: string; path: string; public: boolean }[] {
  const out = [{ locale: CANONICAL_LOCALE, path: route, public: true }];
  for (const p of PLAN) {
    if (variantSet(p.locale).has(route)) out.push({ locale: p.locale, path: variantRoute(route, p.locale, CANONICAL_LOCALE), public: p.stage !== 'pseudo' });
  }
  return out;
}

/** Split a built path into its locale and canonical route. */
export function splitPath(pathname: string): { locale: string; route: string } {
  for (const p of PLAN) {
    const prefix = `/${p.prefix}/`;
    if (pathname === prefix.slice(0, -1) || pathname.startsWith(prefix)) {
      const rest = `/${pathname.slice(prefix.length)}`;
      return { locale: p.locale, route: rest === '/404/' ? '/404.html' : rest };
    }
  }
  return { locale: CANONICAL_LOCALE, route: pathname };
}

let processor: Awaited<ReturnType<typeof createMarkdownProcessor>> | null = null;
async function markdown() {
  processor ??= await createMarkdownProcessor({ ...markdownConfigDefaults, syntaxHighlight: false, smartypants: false, remarkPlugins: [remarkI18n], rehypePlugins: [rehypeWintage] });
  return processor;
}

/** The documents a locale renders, in canonical order. */
export function localizedDocSlugs(locale: string): string[] {
  return PLAN.find((p) => p.locale === locale)?.docs.map((d) => d.slug) ?? [];
}

/**
 * One segment as a locale shows it. A segment renders in the locale only when
 * its unit exists, is current and carries a status the locale accepts;
 * otherwise the English text is used and marked with its real language, so a
 * page is never all-English just because one paragraph is stale.
 */
function segmentOf(segment: Segment, l: Doc, units: Record<string, any>, locale: string) {
  return resolveSegment({
    segment,
    locale,
    canonical: CANONICAL_LOCALE,
    stage: l.stage,
    units,
    renderStatuses: l.renderStatuses,
    localize: (text: string, kind: string) => pseudoLocalize(text, glossary, kind),
  });
}

/** Title and description of a doc as a locale shows it (per-segment English fallback). */
export function docMeta(slug: string, locale: string): { title: string; description: string; lang: string; fallbacks: string[] } {
  const doc = DOCS[slug];
  const titleId = `${doc.prefix}.title`;
  const descriptionId = `${doc.prefix}.description`;
  if (locale === CANONICAL_LOCALE || !localizedDocSlugs(locale).includes(slug)) {
    return { title: doc.title, description: doc.description, lang: CANONICAL_LOCALE, fallbacks: [] };
  }
  const l = localeOf(locale);
  const units = DOC_UNITS[locale]?.[slug]?.units ?? {};
  const title = segmentOf(doc.segmentsById[titleId], l, units, locale);
  const description = segmentOf(doc.segmentsById[descriptionId], l, units, locale);
  const fallbacks = [title, description].map((r, i) => (r.lang === locale ? null : [titleId, descriptionId][i])).filter(Boolean) as string[];
  return { title: title.text, description: description.text, lang: title.lang === locale ? locale : CANONICAL_LOCALE, fallbacks };
}

/**
 * Render a localized document segment by segment. Each segment is rendered on
 * its own and a fallback segment is wrapped in `lang="en"`, so the reader (and
 * the tests) can see exactly which parts are still English. Only call for
 * slugs in localizedDocSlugs(locale).
 */
export async function renderLocalizedDoc(slug: string, locale: string) {
  const l = localeOf(locale);
  const doc = DOCS[slug];
  const units = DOC_UNITS[locale]?.[slug]?.units ?? {};
  const md = await markdown();
  const html: string[] = [];
  const body: string[] = [];
  const headings: any[] = [];
  const fallbacks: string[] = [];
  // Heading anchors are made unique per SEGMENT by the rehype plugin, so two
  // segments whose headings slugify the same (or to nothing) would collide.
  // Dedupe across the document here, rewriting the id and its anchor link.
  const usedIds = new Set<string>();
  for (const segment of doc.segments.filter((s) => s.kind === 'markdown')) {
    const r = segmentOf(segment, l, units, locale);
    body.push(r.text);
    if (r.lang !== locale) fallbacks.push(segment.id);
    const result = await md.render(r.text);
    let code = result.code;
    for (const h of (result.metadata.headings ?? []) as any[]) {
      let slug = String(h.slug);
      if (usedIds.has(slug)) {
        let n = 1;
        while (usedIds.has(`${slug}-${n}`)) n++;
        const next = `${slug}-${n}`;
        code = code.split(`id="${slug}"`).join(`id="${next}"`).split(`href="#${slug}"`).join(`href="#${next}"`);
        h.slug = next;
        slug = next;
      }
      usedIds.add(slug);
      headings.push(h);
    }
    html.push(r.lang === locale ? code : markFallback(code, r.lang));
  }
  return { html: html.join('\n'), headings, body: body.join('\n\n'), ...docMeta(slug, locale), fallbacks };
}
