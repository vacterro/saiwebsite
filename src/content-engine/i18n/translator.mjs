/**
 * Build-time translator (roadmap M42, M43). Pure.
 *
 * createTranslator() answers "what text does locale L show for block X?" by
 * walking L's fallback chain and accepting only a unit whose stored status L
 * allows and whose sourceHash matches the current canonical hash. A STALE
 * unit is never shown; its fallback is, and the page records that it did.
 * An unknown block ID throws, so a raw key can never reach a page.
 */
import { blockHash, escapeHtml, renderInline, renderText } from '../blocks/blocks.mjs';
import { pseudoLocalize, unitStatus } from './i18n.mjs';

/**
 * @param {object} o
 * @param {string} o.locale
 * @param {object} o.localesDoc   parsed locales.json
 * @param {Record<string, {type: string, text: string}>} o.blocks   canonical blocks by ID
 * @param {Record<string, Record<string, object>>} o.units  locale -> block ID -> unit
 * @param {object} [o.glossary]
 */
export function createTranslator({ locale, localesDoc, blocks, units, glossary }) {
  const byId = new Map(localesDoc.locales.map((l) => [l.id, l]));
  const requested = byId.get(locale);
  if (!requested) throw new Error(`unknown locale ${locale}`);
  const canonical = localesDoc.canonical;
  const chain = [];
  for (let cur = requested; cur; cur = cur.fallback ? byId.get(cur.fallback) : null) chain.push(cur);
  const fallbacks = new Set();

  function resolve(id) {
    const block = blocks[id];
    if (!block) throw new Error(`no canonical block "${id}" — add it to a catalogue in src/content-engine/blocks/`);
    const hash = blockHash(block);
    for (const l of chain) {
      if (l.id === canonical) return { text: block.text, lang: canonical, type: block.type };
      if (l.stage === 'pseudo') return { text: pseudoLocalize(block.text, glossary, block.type), lang: l.id, type: block.type };
      const unit = units?.[l.id]?.[id];
      const status = unitStatus(unit, hash);
      if (requested.renderStatuses.includes(status)) return { text: unit.text, lang: l.id, type: block.type };
    }
    return { text: block.text, lang: canonical, type: block.type };
  }

  const note = (id, r) => {
    if (r.lang !== locale) fallbacks.add(id);
    return r;
  };

  return {
    locale,
    lang: locale,
    dir: requested.direction,
    canonical: locale === canonical,
    /** Plain string for attributes, titles and text nodes. */
    text(id, vars = {}) {
      return renderText(note(id, resolve(id)).text, vars);
    },
    /** HTML for set:html. Fallback text in a translated page is marked with its real language. */
    html(id, vars = {}, htmlVars = {}) {
      const r = note(id, resolve(id));
      const body = r.type === 'inline' ? renderInline(r.text, vars, htmlVars) : escapeHtml(renderText(r.text, vars));
      return r.lang !== locale ? `<span lang="${r.lang}" data-i18n-fallback>${body}</span>` : body;
    },
    /** Block IDs this page showed in a fallback language (diagnostics, M52). */
    fallbacks: () => [...fallbacks].sort(),
  };
}
