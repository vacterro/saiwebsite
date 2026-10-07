/**
 * Runtime theme owner — the single place that decides how a stored value becomes
 * a real palette and how the document learns which one is active.
 *
 * The static registry (./index.ts) is already complete and validated; what this
 * file adds is the missing runtime half: one canonical localStorage key, one
 * normalize rule, and the three tiny scripts that apply it. Nothing here fetches
 * theme data — the allowlist is serialized from the registry at build time, so a
 * pack that is removed from `packs/` also vanishes from the runtime and a stale
 * stored slug falls back to Golden Default instead of half-applying.
 *
 * Three consumers, three generated strings, one owner:
 *   themeBootstrapScript()     <head>, inline and synchronous, pre-paint
 *   themeWiringScript()        end of <body>, inline, syncs controls and status
 *   themeDiagnosticsScript()   debug routes, fills [data-theme-diag] fields
 *
 * Plain scripts, no module, no framework, no network. They run before paint and
 * before any hydration, which is the whole point: a restored theme must be on
 * <html> before the browser can show a Golden Default frame.
 */
import { DEFAULT_THEME_SLUG } from './schema';
import { themes } from './index';

/** THE canonical storage key. Never re-declare this string in a component. */
export const THEME_STORAGE_KEY = 'sai-website.theme';

/**
 * Generic notification, dispatched on `document` after the active palette is
 * applied. `detail` is `{ slug, label, persisted, source }`, where `source` is
 * one of `init` (page load), `selector` (user picked), `runtime` (programmatic).
 */
export const THEME_CHANGE_EVENT = 'sai-theme-change';

/** DOM hooks. The select attribute is on the element; the id is on the status field. */
export const THEME_SELECT_ID = 'theme-select';
export const THEME_SELECT_ATTR = 'data-theme-select';
export const PALETTE_STATUS_ID = 'status-palette';
export const THEME_DIAG_ATTR = 'data-theme-diag';

/** The registry projection the browser needs: identity and label, in canonical order. */
export const THEME_INDEX = themes.map((pack) => ({ slug: pack.slug, label: pack.label }));

/** Known slug stays; anything else — absent, unknown, garbage, non-string — is Golden Default. */
export function normalizeSlug(raw: unknown): string {
  return typeof raw === 'string' && themes.some((pack) => pack.slug === raw)
    ? raw
    : DEFAULT_THEME_SLUG;
}

/** JSON that is safe to embed inside a <script> element. */
function embed(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const SLUGS = themes.map((pack) => pack.slug);

/**
 * Pre-paint bootstrap. Inline in <head>, classic (not deferred, not a module),
 * no external resource, so it has run before the body is parsed.
 *
 * It also normalizes storage: whatever the key holds ends up being a real slug,
 * so an unknown value is repaired once instead of being reprocessed on every
 * later navigation.
 */
export function themeBootstrapScript(): string {
  return [
    '(function(){',
    `var K=${embed(THEME_STORAGE_KEY)},D=${embed(DEFAULT_THEME_SLUG)},A=${embed(SLUGS)},s=D;`,
    'try{var v=window.localStorage.getItem(K);',
    'if(v!==null&&A.indexOf(v)>-1)s=v;',
    'try{window.localStorage.setItem(K,s);}catch(e){}}catch(e){}',
    "document.documentElement.setAttribute('data-theme',s);",
    '})();',
  ].join('');
}

/**
 * Control wiring. Inline at the end of <body>, so the controls it syncs already
 * exist when it runs and no DOMContentLoaded listener is needed.
 */
export function themeWiringScript(): string {
  return [
    '(function(){',
    `var K=${embed(THEME_STORAGE_KEY)},D=${embed(DEFAULT_THEME_SLUG)},EV=${embed(THEME_CHANGE_EVENT)};`,
    `var SA=${embed(`[${THEME_SELECT_ATTR}]`)},SI=${embed(PALETTE_STATUS_ID)};`,
    `var IX=${embed(THEME_INDEX)},BY=Object.create(null);`,
    'for(var i=0;i<IX.length;i++){BY[IX[i].slug]=IX[i];}',
    'function stored(){try{return window.localStorage.getItem(K);}catch(e){return null;}}',
    'function norm(v){return (typeof v==="string"&&BY[v])?v:D;}',
    'function apply(value,persist,source){',
    'var pack=BY[norm(value)],next=pack.slug,root=document.documentElement;',
    "if(root.getAttribute('data-theme')!==next)root.setAttribute('data-theme',next);",
    'if(persist){try{window.localStorage.setItem(K,next);}catch(e){}}',
    "var sels=document.querySelectorAll(SA),j;",
    'for(j=0;j<sels.length;j++){if(sels[j].value!==next)sels[j].value=next;}',
    "var st=document.getElementById(SI);",
    "if(st)st.textContent='palette: '+pack.label;",
    'document.dispatchEvent(new CustomEvent(EV,{detail:{slug:next,label:pack.label,persisted:stored(),source:source||"runtime"}}));',
    '}',
    'var sels=document.querySelectorAll(SA);',
    "for(var n=0;n<sels.length;n++){sels[n].addEventListener('change',function(){apply(this.value,true,'selector');});}",
    "apply(norm(stored()),false,'init');",
    '})();',
  ].join('');
}

/**
 * Debug-route telemetry. Fills every `[data-theme-diag="<field>"]` element with
 * the live value of that field and refreshes on `sai-theme-change`. Fields:
 * slug, label, persisted, default, count.
 */
export function themeDiagnosticsScript(): string {
  return [
    '(function(){',
    `var K=${embed(THEME_STORAGE_KEY)},D=${embed(DEFAULT_THEME_SLUG)},EV=${embed(THEME_CHANGE_EVENT)},AT=${embed(THEME_DIAG_ATTR)};`,
    `var IX=${embed(THEME_INDEX)},BY=Object.create(null);`,
    'for(var i=0;i<IX.length;i++){BY[IX[i].slug]=IX[i];}',
    'function fill(){',
    "var slug=document.documentElement.getAttribute('data-theme')||D,pack=BY[slug]||BY[D],p;",
    'try{p=window.localStorage.getItem(K);}catch(e){p=null;}',
    'var V={slug:slug,label:pack.label,persisted:(p===null?"(absent)":p),default:D,count:String(IX.length)};',
    "var nodes=document.querySelectorAll('['+AT+']'),j;",
    'for(j=0;j<nodes.length;j++){var f=nodes[j].getAttribute(AT);',
    'if(V[f]!==undefined)nodes[j].textContent=V[f];}',
    '}',
    'fill();',
    'document.addEventListener(EV,fill);',
    '})();',
  ].join('');
}
