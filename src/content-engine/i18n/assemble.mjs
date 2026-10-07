/**
 * Localized documentation assembly (pure).
 *
 * Compatibility: this is the one place that decides which language a
 * documentation segment is shown in. `astro build` (catalog.ts) and the Node
 * gates both call it, so the built page and the test cannot disagree about
 * fallback.
 *
 * A segment renders in the locale only when its unit exists, is current for
 * the canonical segment hash, and carries a status the locale's renderStatuses
 * accepts. Otherwise the English text is used and the rendered HTML is wrapped
 * so the reader knows that fragment is English (T-17's contract): one stale
 * paragraph falls back to English, the rest of the page stays translated.
 */
import { unitStatus } from './i18n.mjs';

/**
 * @param {object} o
 * @param {{id: string, kind: string, text: string, hash: string}} o.segment
 * @param {string} o.locale
 * @param {string} o.canonical       the canonical locale id (usually 'en')
 * @param {string} o.stage           the locale's stage ('pseudo' generates text)
 * @param {Record<string, object>} [o.units]  segment ID -> stored unit
 * @param {string[]} [o.renderStatuses]
 * @param {(text: string, kind: string) => string} [o.localize]  pseudo-localizer
 * @returns {{id: string, kind: string, text: string, lang: string}}
 */
export function resolveSegment({ segment, locale, canonical, stage, units, renderStatuses = [], localize }) {
  if (stage === 'pseudo' && localize) return { id: segment.id, kind: segment.kind, text: localize(segment.text, segment.kind), lang: locale };
  const unit = units?.[segment.id];
  if (unit && renderStatuses.includes(unitStatus(unit, segment.hash))) return { id: segment.id, kind: segment.kind, text: String(unit.text), lang: locale };
  return { id: segment.id, kind: segment.kind, text: segment.text, lang: canonical };
}

/** Wrap rendered HTML that is shown in a language other than the page's own. */
export function markFallback(html, lang) {
  return `<div lang="${lang}" data-i18n-fallback>${html}</div>`;
}

/** The ordered body plan of a document for one locale. */
export function planSegments({ segments, ...rest }) {
  return segments.map((segment) => resolveSegment({ segment, ...rest }));
}
