/**
 * Build-time catalogue for Astro pages (roadmap M37, M42, M43, M47).
 *
 * Loads every canonical block catalogue, the page registry labels, every
 * translation unit file and every document translation with
 * import.meta.glob, validates them, and hands out translators and the variant
 * plan. The Node gates load the same files through store.mjs and feed the
 * same pure functions, so a page and a gate cannot disagree.
 */
import { createMarkdownProcessor, markdownConfigDefaults, parseFrontmatter } from '@astrojs/markdown-remark';
import localesDoc from './locales.json';
import glossary from './glossary.json';
import registry from '../registry/pages.json';
import sources from '../registry/sources.json';
import rehypeWintage from '../../lib/rehype-wintage.mjs';
import { documentHash, validateCatalog } from '../blocks/blocks.mjs';
import { sourceIdsOf } from '../registry/sources.mjs';
import { localePrefix, pseudoLocalize, publicLocales, validateLocales, variantPlan, variantRoute } from './i18n.mjs';
import { createTranslator } from './translator.mjs';
import { mergeCatalogs, pageLabelBlocks, unitsByLocale } from './units.mjs';

type Doc = Record<string, any>;

const catalogFiles = import.meta.glob<Doc>('../blocks/*.json', { eager: true, import: 'default' });
const unitFiles = import.meta.glob<Doc>('../../locales/*/*.json', { eager: true, import: 'default' });
const canonicalDocRaw = import.meta.glob<string>('../../content/docs/**/*.md', { eager: true, query: '?raw', import: 'default' });
const translatedDocRaw = import.meta.glob<string>('../../locales/*/docs/**/*.md', { eager: true, query: '?raw', import: 'default' });

const problems = [
  ...validateLocales(localesDoc),
  ...Object.entries(catalogFiles).flatMap(([file, doc]) => validateCatalog(doc, file, sourceIdsOf(sources))),
];
if (problems.length) throw new Error(`i18n catalogue is invalid:\n  ${problems.join('\n  ')}`);

const parse = (raw: string) => {
  const { frontmatter, content } = parseFrontmatter(raw.replace(/\r\n/g, '\n'));
  return { frontmatter: frontmatter as Doc, body: content };
};

export const BLOCKS: Record<string, any> = mergeCatalogs([...Object.values(catalogFiles), pageLabelBlocks(registry)]);
export const UNITS = unitsByLocale(Object.values(unitFiles)) as Record<string, Record<string, any>>;
export const LOCALES = localesDoc;
export const CANONICAL_LOCALE: string = localesDoc.canonical;
/** Locales a visitor can choose (canonical included, pseudo excluded). */
export const PUBLIC_LOCALES = publicLocales(localesDoc);
export { localePrefix };

const DOCS: Record<string, { hash: string; section: string; frontmatter: Doc; body: string }> = {};
for (const [file, raw] of Object.entries(canonicalDocRaw)) {
  const slug = file.replace(/^.*\/content\/docs\//, '').replace(/\.md$/, '');
  const { frontmatter, body } = parse(raw);
  DOCS[slug] = { hash: documentHash(raw), section: frontmatter.section, frontmatter, body };
}
const DOC_TRANSLATIONS: Record<string, Record<string, { frontmatter: Doc; body: string }>> = {};
for (const [file, raw] of Object.entries(translatedDocRaw)) {
  const m = /\/locales\/([^/]+)\/docs\/(.+)\.md$/.exec(file);
  if (!m) continue;
  (DOC_TRANSLATIONS[m[1]] ??= {})[m[2]] = parse(raw);
}

/** Which localized routes exist; identical to the plan the registry gate computes. */
export const PLAN = variantPlan({ localesDoc, registry, docs: DOCS, docTranslations: DOC_TRANSLATIONS });
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
  processor ??= await createMarkdownProcessor({ ...markdownConfigDefaults, syntaxHighlight: false, smartypants: false, rehypePlugins: [rehypeWintage] });
  return processor;
}

/** The documents a locale renders, in canonical order. */
export function localizedDocSlugs(locale: string): string[] {
  return PLAN.find((p) => p.locale === locale)?.docs.map((d) => d.slug) ?? [];
}

/** Title and description of a doc as a locale shows it (falls back to English). */
export function docMeta(slug: string, locale: string): { title: string; description: string; lang: string } {
  const doc = DOCS[slug];
  const l = localeOf(locale);
  if (locale !== CANONICAL_LOCALE && localizedDocSlugs(locale).includes(slug)) {
    if (l.stage === 'pseudo') {
      return { title: pseudoLocalize(doc.frontmatter.title, glossary, 'text'), description: pseudoLocalize(doc.frontmatter.description, glossary, 'text'), lang: locale };
    }
    const tr = DOC_TRANSLATIONS[locale][slug];
    return { title: String(tr.frontmatter.title), description: String(tr.frontmatter.description), lang: locale };
  }
  return { title: doc.frontmatter.title, description: doc.frontmatter.description, lang: CANONICAL_LOCALE };
}

/** Render a localized document. Only call for slugs in localizedDocSlugs(locale). */
export async function renderLocalizedDoc(slug: string, locale: string) {
  const l = localeOf(locale);
  const doc = DOCS[slug];
  const body = l.stage === 'pseudo' ? pseudoLocalize(doc.body, glossary, 'markdown') : DOC_TRANSLATIONS[locale][slug].body;
  const md = await markdown();
  const result = await md.render(body);
  return { html: result.code, headings: result.metadata.headings, body, ...docMeta(slug, locale) };
}
