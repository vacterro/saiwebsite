// Structural audit of the built site: heading order, landmarks, titles, maturity labels.
// Extended in T-2 with the runtime-theme invariants of the BUILT OUTPUT, which is the only
// place the no-FOUC contract can be checked for real: an inline palette stylesheet in <head>,
// a synchronous classic bootstrap script before <body>, the SSR Golden Default fallback, and
// every declared route present on disk.
// Extended in T-3 with the M4 shell invariants that are cheaper and more reliable here than in
// a browser: the roadmap's required initial routes are declared, every public top-level route
// carries a semantic breadcrumb, both navigation surfaces exist in the markup (CSS decides
// which one is visible), every public route is linked from every public page, and no navigation
// placeholder is a dead `href="#"`.
// Run after `npm run build`: node scripts/audit-build.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, posix } from 'node:path';
import { publicRoutes, readRoutes } from './route-registry.mjs';

/**
 * MASTER_ROADMAP §1: the initial shell must reserve exactly these public routes.
 * This list is the contract the registry is checked against, which is why it is
 * written here by hand instead of being derived from the file under test.
 */
const ROADMAP_PUBLIC_ROUTES = [
  '/',
  '/docs/',
  '/spec/',
  '/ecosystem/',
  '/pricing/',
  '/about/',
  '/status/',
  '/playground/',
  '/benchmarks/',
  '/downloads/',
  '/security/',
  '/community/',
  '/blog/',
  '/changelog/',
];

const dist = 'dist';
if (!existsSync(dist)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(2);
}

const pages = [];
(function walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.html')) pages.push(p);
  }
})(dist);
pages.sort();

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL ' + msg); };

// ---------------------------------------------------------------------------
// 1. Runtime-theme invariants, checked once on the homepage (every route is
//    rendered through the same SiteLayout, but each page is verified below).
// ---------------------------------------------------------------------------
const STORAGE_KEY = 'sai-website.theme';

/** The pre-paint bootstrap: inline, classic, no attributes that defer it. */
function findBootstrap(html) {
  const bodyStart = html.indexOf('<body');
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const [whole, attrs, code] = m;
    const offset = m.index;
    if (attrs.includes(' src=') || attrs.includes(' src="') || attrs.includes(" src='")) continue;
    if (!code.includes(`setAttribute('data-theme'`)) continue;
    return { whole, attrs, code, offset, bodyStart };
  }
  return null;
}

function auditThemeContract(file, h) {
  const label = file.split('\\').join('/');
  const htmlTag = /<html[^>]*>/.exec(h)?.[0] ?? '(no <html>)';
  const bodyStart = h.indexOf('<body');
  const head = h.slice(0, bodyStart > 0 ? bodyStart : 0);

  console.log('\nTHEME CONTRACT ' + label);

  if (/<html[^>]*\sstyle=/.test(h)) fail(label + ': <html> carries an inline style attribute — a stale root palette outranks every [data-theme] scope');
  if (!/<html lang="en" data-theme="goldendefault">/.test(h)) fail(label + ': SSR fallback is not lang="en" data-theme="goldendefault" (got ' + htmlTag + ')');

  // Palette CSS inline in <head>: the whole point is that first paint needs no request.
  const styles = [...head.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)];
  const paletteCss = styles.find((s) => s[2].includes(':root {') && s[2].includes('[data-theme="goldendefault"]'));
  if (!paletteCss) fail(label + ': no inline palette stylesheet in <head> carrying :root + [data-theme="goldendefault"]');
  if (paletteCss && paletteCss[1].includes('href=') ) fail(label + ': palette stylesheet is not inline');
  if (paletteCss && !paletteCss[2].includes('color-scheme:')) fail(label + ': palette stylesheet does not declare color-scheme per scope');
  if (paletteCss && !paletteCss[2].includes('--background')) fail(label + ': palette stylesheet does not declare --background');
  console.log('  inline palette CSS : ' + (paletteCss ? 'yes (' + paletteCss[2].length + ' bytes)' : 'MISSING'));

  // The root canvas rule: html paints itself from the ACTIVE scope's variables.
  const canvasRule = styles.find((s) => /html\s*\{[^}]*background-color:\s*var\(--background\)/.test(s[2]));
  if (!canvasRule) fail(label + ': no inline `html { background-color: var(--background) }` rule — root canvas would keep a hard-coded palette');
  else console.log('  root canvas from var: yes');
  if (canvasRule && !/html\s*\{[^}]*color:\s*var\(--textPrimary\)/.test(canvasRule[2])) fail(label + ': root canvas does not take text colour from --textPrimary');

  // Pre-paint bootstrap: exists, inline, classic, before <body>, self-contained.
  const boot = findBootstrap(h);
  if (!boot) {
    fail(label + ': no inline pre-paint theme bootstrap found');
    return;
  }
  const attrs = boot.attrs;
  if (attrs.includes('async')) fail(label + ': bootstrap is async — it may run after first paint');
  if (attrs.includes('defer')) fail(label + ': bootstrap is deferred — it may run after first paint');
  if (attrs.includes('type="module"') || attrs.includes("type='module'")) fail(label + ': bootstrap is a module — modules are deferred');
  if (attrs.includes('import(') || /import\s*\(/.test(boot.code)) fail(label + ': bootstrap contains a dynamic import — external dependency');
  if (boot.offset > boot.bodyStart) fail(label + ': bootstrap sits after <body>, so the body can paint first');
  if (boot.offset > h.indexOf('</head>')) fail(label + ': bootstrap sits after </head>');
  if (!boot.code.includes(STORAGE_KEY)) fail(label + ': bootstrap does not use the canonical storage key ' + STORAGE_KEY);
  if (!boot.code.includes('goldendefault')) fail(label + ': bootstrap does not mention the canonical default slug');
  // The control wiring lives in its own inline script at the end of <body>.
  if (!h.includes('data-theme-select')) fail(label + ': no wiring script / no data-theme-select hook on the page');
  if (!/<label[^>]*\sfor="theme-select"/.test(h)) fail(label + ': no <label for="theme-select"> association for the palette control');
  if (!/<select[^>]*\sid="theme-select"/.test(h)) fail(label + ': no #theme-select control');
  const isDiagRoute = /debug\/(themes|rendering)/.test(label);
  if (isDiagRoute && (h.match(/data-theme-diag=/g) || []).length === 0) fail(label + ': debug route exposes no [data-theme-diag] diagnostics');
  if (!/id="status-palette"/.test(h)) fail(label + ': status bar palette field has no #status-palette target');
  console.log('  bootstrap          : inline classic, offset ' + boot.offset + ' < body ' + boot.bodyStart + ', key ' + STORAGE_KEY);
}

// ---------------------------------------------------------------------------
// 2. Declared routes must exist. A route that is declared but not built is a
//    broken navigation target; one built but undeclared is an untracked page.
//    The registry is also checked against the roadmap's required route list:
//    the eight reserved routes are easy to declare and easy to lose again.
// ---------------------------------------------------------------------------
function auditRoutes() {
  console.log('\nROUTES');
  const routes = [...REGISTRY.values()];
  if (!routes.length) fail('the page registry declares no shell routes');
  const declared = new Set(routes.map((route) => route.href));

  for (const route of routes) {
    const rel =
      route.href === '/' ? 'index.html' : route.href.replace(/^\//, '').replace(/\/$/, '') + '/index.html';
    const file = join(dist, rel);
    const ok = existsSync(file);
    if (!ok) fail('declared route ' + route.href + ' has no built output at dist/' + posix.normalize(rel));
    console.log('  ' + (ok ? 'OK  ' : 'MISS') + ' ' + route.href + '  [' + route.maturity + ']');
  }

  console.log('\nROADMAP PUBLIC SHELL');
  for (const href of ROADMAP_PUBLIC_ROUTES) {
    const present = declared.has(href);
    if (!present) fail('roadmap-required public route ' + href + ' is not declared in the page registry');
  }
  console.log(
    '  ' +
      ROADMAP_PUBLIC_ROUTES.filter((href) => declared.has(href)).length +
      '/' +
      ROADMAP_PUBLIC_ROUTES.length +
      ' roadmap-required public routes declared',
  );
}

// ---------------------------------------------------------------------------
// 2b. M4 shell invariants of the built markup. Which navigation surface is
//     visible is a CSS decision and belongs to Playwright; that both surfaces
//     exist, that the trail is semantic and that every public route is linked
//     from every public page are static facts.
// ---------------------------------------------------------------------------
const PUBLIC_HREFS = publicRoutes().map((route) => route.href);

/** `dist/status/index.html` -> `/status/`; `dist/index.html` -> `/`. */
function pageHref(file) {
  const rel = file.split('\\').join('/').replace(/^dist\//, '').replace(/index\.html$/, '');
  return '/' + rel;
}

const REGISTRY = new Map(readRoutes().map((route) => [route.href, route]));

function auditShell(file, h) {
  const label = file.split('\\').join('/');
  const href = pageHref(file);
  const isHome = href === '/';
  const route = REGISTRY.get(href);

  console.log('\nSHELL CONTRACT ' + label);

  if (!/<nav class="w-menubar" aria-label="Main">/.test(h)) fail(label + ': no desktop primary nav landmark');
  if (!/<nav class="w-compactnav" aria-label="Site">/.test(h)) fail(label + ': no compact nav landmark');
  if (!/data-compact-nav/.test(h)) fail(label + ': compact nav has no [data-compact-nav] hook for the shell suite');
  if (/href="#"/.test(h)) fail(label + ': contains a dead href="#" navigation placeholder');

  // The canonical trail: semantic nav, one current item, and a real Home link
  // everywhere except the homepage itself (a self-referential "Home > Home"
  // would be noise, not depth).
  const crumbNav = /<nav class="w-crumbs" aria-label="Breadcrumb">([\s\S]*?)<\/nav>/.exec(h);
  if (isHome) {
    if (crumbNav) fail(label + ': homepage renders a breadcrumb trail');
  } else if (!crumbNav) {
    fail(label + ': no <nav aria-label="Breadcrumb"> trail');
  } else {
    if (!/<a href="\/">Home<\/a>/.test(crumbNav[1])) fail(label + ': breadcrumb has no real Home link');
    if (!/aria-current="page"/.test(crumbNav[1])) fail(label + ': breadcrumb does not mark the current page');
  }
  console.log('  breadcrumb : ' + (crumbNav ? 'semantic trail with Home + current' : 'none (homepage)'));

  // Discoverability: the reserved routes live behind the More panel on desktop
  // and inside the compact nav below the breakpoint, so every public route is
  // an ordinary anchor in the markup of every public page.
  const missing = PUBLIC_HREFS.filter((notHref) => !h.includes('href="' + notHref + '"'));
  if (missing.length) fail(label + ': no navigation anchor for ' + missing.join(', '));
  console.log('  public anchors: ' + (PUBLIC_HREFS.length - missing.length) + '/' + PUBLIC_HREFS.length);

  // Reserved feature routes must still declare a non-stable maturity.
  // A registry route must show the maturity it declares, so a page cannot
  // quietly look finished while the registry says draft (or the reverse).
  if (route && !route.href.startsWith('/debug/')) {
    if (!h.includes('>' + route.maturity.toUpperCase() + '<')) fail(label + ': registry declares ' + route.maturity + ' but the page shows no ' + route.maturity.toUpperCase() + ' badge');
    console.log('  maturity   : ' + route.maturity);
  }
}

// ---------------------------------------------------------------------------
// 3. Per-page structure.
// ---------------------------------------------------------------------------
for (const p of pages) {
  const h = readFileSync(p, 'utf8');
  const heads = [...h.matchAll(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/g)]
    .map((m) => ({ l: Number(m[1][1]), t: m[2].replace(/<[^>]*>/g, '').trim().slice(0, 40) }));
  const seq = heads.map((x) => x.l);
  const title = /<title>([^<]*)<\/title>/.exec(h)?.[1] ?? '(none)';
  const lang = /<html lang="([a-z-]+)"/.exec(h)?.[1];
  const counts = {
    h1: seq.filter((x) => x === 1).length,
    main: (h.match(/<main/g) || []).length,
    nav: (h.match(/<nav/g) || []).length,
    footer: (h.match(/<footer/g) || []).length,
  };
  const maturity = [...new Set(h.match(/PLACEHOLDER|DRAFT|PLANNED|EXPERIMENTAL|PREVIEW|STABLE|DEPRECATED/g) || [])];

  console.log(p.split('\\').join('/'));
  console.log('  title   :', title);
  console.log('  lang    :', lang, '| h1:', counts.h1, '| main:', counts.main, '| nav:', counts.nav, '| footer:', counts.footer);
  console.log('  headings:', seq.join(','));
  console.log('  maturity:', maturity.join(', ') || '(none)');
  console.log('  top     :', heads.slice(0, 5).map((x) => 'h' + x.l + ' "' + x.t + '"').join(' | '));

  if (lang !== 'en') fail('html lang is not en');
  if (counts.h1 !== 1) fail('expected exactly 1 h1, found ' + counts.h1);
  if (counts.main !== 1) fail('expected exactly 1 <main>, found ' + counts.main);
  if (counts.footer < 1) fail('no <footer> landmark');
  if (counts.nav < 1) fail('no <nav> landmark');
  for (let i = 1; i < seq.length; i++) if (seq[i] > seq[i - 1] + 1) fail(`heading level jump h${seq[i - 1]} -> h${seq[i]} at "${heads[i].t}"`);
  if (seq[0] !== 1) fail('first heading is not h1');
  if (/lorem ipsum/i.test(h)) fail('lorem ipsum found in output');
  auditThemeContract(p, h);
  auditShell(p, h);
}

auditRoutes();

// ---------------------------------------------------------------------------
// 4. Performance budget (MASTER_ROADMAP M15). Ceilings are deliberately close
//    to the measured build so growth is a decision, not drift. Scripts are only
//    allowed on the pages that need them.
// ---------------------------------------------------------------------------
const BUDGET = {
  pageHtml: 160 * 1024,
  totalBundledJs: 24 * 1024,
  totalFonts: 200 * 1024,
  singleFont: 20 * 1024,
  searchIndex: 160 * 1024,
};
const SCRIPT_PAGES = /^\/(playground\/[^/]+|search)\/$/;

function filesUnder(dir, ext) {
  if (!existsSync(dir)) return [];
  const out = [];
  (function walk(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p2 = join(d, e.name);
      if (e.isDirectory()) walk(p2);
      else if (e.name.endsWith(ext)) out.push(p2);
    }
  })(dir);
  return out;
}

function auditBudget() {
  console.log('\nBUDGET');
  const size = (f) => readFileSync(f).length;
  let largest = { f: '', n: 0 };
  for (const p2 of pages) {
    const n = size(p2);
    if (n > largest.n) largest = { f: p2, n };
    if (n > BUDGET.pageHtml) fail(`${p2}: ${n} bytes of HTML exceeds the ${BUDGET.pageHtml}-byte page budget`);
    const href = pageHref(p2);
    const external = [...readFileSync(p2, 'utf8').matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((m) => m[1]);
    if (external.length && !SCRIPT_PAGES.test(href)) fail(`${p2}: loads ${external.join(', ')} but is not a page that needs a script`);
    const thirdParty = external.filter((src) => /^https?:/.test(src));
    if (thirdParty.length) fail(`${p2}: loads a third-party script ${thirdParty.join(', ')}`);
  }
  const js = filesUnder(join(dist, '_astro'), '.js').reduce((n, f) => n + size(f), 0);
  const fonts = filesUnder(join(dist, 'fonts'), '.woff2');
  const fontTotal = fonts.reduce((n, f) => n + size(f), 0);
  for (const f of fonts) if (size(f) > BUDGET.singleFont) fail(`${f}: ${size(f)} bytes exceeds the single-font budget`);
  if (js > BUDGET.totalBundledJs) fail(`bundled JavaScript ${js} bytes exceeds ${BUDGET.totalBundledJs}`);
  if (fontTotal > BUDGET.totalFonts) fail(`fonts ${fontTotal} bytes exceed ${BUDGET.totalFonts}`);
  const index = join(dist, 'search-index.json');
  const indexSize = existsSync(index) ? size(index) : 0;
  if (!indexSize) fail('dist/search-index.json missing');
  if (indexSize > BUDGET.searchIndex) fail(`search index ${indexSize} bytes exceeds ${BUDGET.searchIndex}`);
  console.log(`  largest page ${largest.n} B (${largest.f.split('\\').join('/')}), bundled JS ${js} B, fonts ${fontTotal} B in ${fonts.length} files, search index ${indexSize} B`);
}

// ---------------------------------------------------------------------------
// 5. Protocol consistency of hand-written data against the canonical
//    registry: every phase has a purpose sentence, and every phase change the
//    playground shows is a legal edge in valid_transitions.
// ---------------------------------------------------------------------------
function auditProtocolData() {
  console.log('\nPROTOCOL DATA');
  const registry = JSON.parse(readFileSync('src/data/canonical/registry.json', 'utf8'));
  const phases = registry.phases.all;
  const edges = registry.phases.valid_transitions;
  const purposes = readFileSync('src/data/phases.ts', 'utf8');
  for (const phase of phases) if (!new RegExp(`\\b${phase}:\\s*'`).test(purposes)) fail(`src/data/phases.ts has no purpose for registry phase ${phase}`);
  let moves = 0;
  for (const file of filesUnder(join(dist, 'playground'), '.html')) {
    const html = readFileSync(file, 'utf8');
    const seq = [...html.matchAll(/phase: ([A-Z]+)/g)].map((m) => m[1]);
    for (let i = 1; i < seq.length; i++) {
      if (seq[i] === seq[i - 1]) continue;
      moves++;
      if (!(edges[seq[i - 1]] ?? []).includes(seq[i])) fail(`${file}: scenario moves ${seq[i - 1]} -> ${seq[i]}, which REGISTRY.json does not allow`);
    }
  }
  console.log(`  ${phases.length} phases have a purpose; ${moves} playground phase changes checked against valid_transitions`);

  const milestones = readFileSync('src/data/milestones.ts', 'utf8');
  for (const m of milestones.matchAll(/where: '([^']+)'/g)) {
    const path = m[1].split('#')[0];
    const file = path.endsWith('/') ? join(dist, path, 'index.html') : join(dist, path);
    if (!existsSync(file)) fail(`milestone page ${m[1]} is declared delivered but ${file} does not exist`);
  }
}

auditBudget();
auditProtocolData();

console.log(failures ? `\nFAILED: ${failures} structural problem(s)` : `\nOK: ${pages.length} pages, no structural problems`);
process.exit(failures ? 1 : 0);
