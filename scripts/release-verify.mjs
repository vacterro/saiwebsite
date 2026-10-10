#!/usr/bin/env node
/**
 * Release preflight (npm run release:verify).
 *
 * Verifies the ALREADY BUILT artifact and the effective origin it was built
 * for. It is not a content-health check (that is site:doctor) and it proves
 * only what can be checked offline:
 *
 *   PASS     the locally provable artifact contract holds
 *   FAIL     a demonstrated output or configuration defect
 *   BLOCKED  an operator decision or external verification is unavailable
 *            (a release build without explicit acknowledgement; DNS, HTTPS,
 *            hosting, redirects and search indexing are never claimed here)
 *
 * Usage:
 *   npm run build                                   # development/canonical build
 *   npm run release:verify                          # verify dist/ contract
 *   SAI_SITE_ORIGIN=https://x.example SAI_RELEASE_BUILD=1 \
 *     SAI_RELEASE_ORIGIN_ACK=https://x.example npm run build
 *   SAI_SITE_ORIGIN=https://x.example SAI_RELEASE_ORIGIN_ACK=https://x.example \
 *     npm run release:verify -- --release
 *   options: --dist <dir> (default dist), --out <file.json> (also write the result),
 *     --public (public-candidate contract: no /debug/, no non-public locales) 
 *
 * Exit status: 0 PASS, 1 FAIL, 3 BLOCKED.
 */
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ACK_ENV, ORIGIN_ENV, PLANNED_DOMAIN, PLANNED_ORIGIN, RELEASE_ENV, normalizeOrigin } from '../src/lib/deployment.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Hosts an SEO or AI surface may reference without being the effective origin: upstream projects only. */
const UPSTREAM_HOSTS = new Set(['github.com', 'discord.gg', 'paypal.me', 'buymeacoffee.com', 'boosty.to', 'www.sitemaps.org']);

/**
 * Publishable-output boundary (STAGE 1).
 *
 * Two layers, evaluated in this order for every relative artifact path:
 *   1. FORBIDDEN — never publishable: version-control metadata, SSH keys and
 *      identities, credential/token files, environment files, private config,
 *      project memory and agent state, internal reports and evidence, source
 *      and test trees, package-manager and build-config leaks, unexpected
 *      executables and scripts, temporary packaging artifacts, unapproved
 *      hidden files, and Windows-sensitive filename variants (matched
 *      case-insensitively; trailing dots/spaces are also rejected because
 *      Windows strips them).
 *   2. ALLOWLIST — the only publishable categories: generated pages and
 *      static endpoints, JS/CSS bundles, public images and icons, web fonts
 *      and licence notices, intended public JSON manifests, and explicitly
 *      approved public documentation (Markdown twins, llms.txt).
 *
 * Anything matching FORBIDDEN fails, and anything not matching the ALLOWLIST
 * fails as "unapproved artifact path". Error reports carry the unsafe path
 * and its classification only — never file contents or credential material.
 */
const FORBIDDEN = [
  [/(^|\/)\.git(\/|$)/, 'version-control metadata'],
  [/(^|\/)\.svn(\/|$)/, 'version-control metadata'],
  [/(^|\/)\.hg(\/|$)/, 'version-control metadata'],
  [/(^|\/)\.github(\/|$)/, 'repository configuration'],
  [/(^|\/)(\.vscode|\.idea|\.vs)(\/|$)/, 'editor configuration'],
  [/(^|\/)\.ssh(\/|$)/, 'SSH identities'],
  [/(^|\/)private(\/|$)/, 'private directory'],
  [/(^|\/)(id_rsa|id_ed25519|id_ecdsa|identity|authorized_keys|known_hosts)([^\/]*)?$/, 'SSH key or identity'],
  [/\.(pem|key|p12|pfx|jks|keystore|asc|gpg|pgp)$/, 'credential material'],
  [/(^|\/)(credential|credentials|secret|secrets|token|tokens|passwd|shadow)[^\/]*$/, 'credential or token file'],
  [/(^|\/)\.?npmrc$/, 'package-manager configuration'],
  [/(^|\/)(\.yarnrc|\.pypirc|\.netrc)$/, 'package-manager configuration'],
  [/(^|\/)\.env(\.|$)/, 'environment file'],
  [/(^|\/)[^\/]*\.env(\.[^\/]*)?$/, 'environment file variant'],
  [/(^|\/)\.saipen(\/|$)/, 'project memory'],
  [/(^|\/)(state|board|log)\.md$/, 'project memory file'],
  [/\.original\.md$/, 'working backup'],
  [/^(evidence|reports|test-results|playwright-report|kitchen|coverage|node_modules|dist)\//, 'evidence, reports or build output at the artifact root'],
  [/(^|\/)(scripts|tests|test|src|i18n-work|_src_unpack|_local_ref|_packs_tmp|roadmap|\.astro)(\/|$)/, 'source, test or work tree inside the artifact'],
  [/(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|tsconfig(\.[^\/]*)?\.json|astro\.config\.[^\/]+|vite\.config\.[^\/]+|playwright\.config\.[^\/]+|tailwind\.config\.[^\/]+|postcss\.config\.[^\/]+|dockerfile|docker-compose[^\/]*|makefile|gemfile|requirements([^\/]*)\.txt|pyproject\.toml|setup\.cfg|\.nvmrc)$/, 'package-manager or build configuration leak'],
  [/\.(exe|dll|so|dylib|sh|bat|cmd|ps1|vbs|jar|bin|run|msi|apk|dmg|iso)$/, 'unexpected executable or script'],
  [/\.(tmp|temp|bak|orig|rej|swp|swo|swo|log)$/, 'temporary packaging artifact'],
  [/(^|\/)(thumbs\.db|desktop\.ini|\.ds_store)$/, 'OS metadata file'],
  [/\.map$/, 'source map'],
];

/**
 * The only publishable output categories. Keep in sync with the real Astro
 * output: pages and static endpoints, bundles, images, fonts, licences,
 * intended JSON manifests, and approved documentation twins.
 */
const ALLOWLIST = [
  [/\.html$/, 'generated page'],
  [/^sitemap\.xml$/, 'sitemap endpoint'],
  [/^robots\.txt$/, 'robots endpoint'],
  [/^(llms(-full)?\.txt|qps-ploc\/llms\.txt)$/, 'public AI surface'],
  [/\.md$/, 'approved Markdown twin'],
  [/^(release\.json|search-index\.json)$/, 'public release manifest'],
  [/^(fonts|media|social)\/manifest\.json$/, 'public asset manifest'],
  [/^spec\/v8\/[^\/]+\.json$/, 'public spec manifest'],
  [/^qps-ploc\/search-index\.json$/, 'public search manifest'],
  [/^_astro\/[^\/]+\.(js|mjs|css)$/, 'asset bundle'],
  [/\.(woff2?|ttf|otf)$/, 'web font'],
  [/^fonts\/licen[sc]e[^\/]*\.txt$/, 'font licence notice'],
  [/\.(png|jpe?g|gif|svg|webp|avif|ico)$/, 'public image or icon'],
];

const RESULT = { PASS: 'PASS', FAIL: 'FAIL', BLOCKED: 'BLOCKED' };

/**
 * Inventory an artifact directory without following links.
 * Uses lstatSync so a symlink (including Windows junctions/reparse points
 * surfaced as symlinks) is reported as a link instead of being followed
 * before its eligibility is checked. Returns deterministically sorted lists.
 */
function inventoryArtifact(dir) {
  const files = [];
  const symlinks = [];
  (function walk(current) {
    let entries;
    entries = readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const entry of entries) {
      const full = join(current, entry.name);
      const rel = relative(dir, full).split(sep).join('/');
      let st;
      try {
        st = lstatSync(full);
      } catch {
        files.push(rel);
        continue;
      }
      if (st.isSymbolicLink()) {
        symlinks.push(rel);
        continue;
      }
      if (st.isDirectory()) walk(full);
      else files.push(rel);
    }
  })(dir);
  files.sort();
  symlinks.sort();
  return { files, symlinks };
}

/** Classify one relative artifact path. Returns null when publishable. */
function classifyArtifactPath(rel) {
  const lower = rel.toLowerCase();
  const base = lower.split('/').pop() ?? lower;
  if (base.endsWith('.') || base.endsWith(' ')) return 'windows-stripped trailing name';
  for (const [re, why] of FORBIDDEN) if (re.test(lower)) return why;
  // Unapproved hidden files or folders (any dot-segment), except the
  // explicitly published well-known surface.
  const segments = lower.split('/');
  if (segments.some((s) => s.startsWith('.') && s !== '.well-known' && s !== '.nojekyll')) {
    if (!(segments[0] === '.well-known')) return 'unapproved hidden file or folder';
  }
  for (const [re] of ALLOWLIST) if (re.test(lower)) return null;
  return 'unapproved artifact path';
}

/** Attribute maps of every <tag ...> in an HTML fragment. */
export function tagsOf(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map((m) => {
    const attrs = {};
    for (const a of m[0].matchAll(/([a-zA-Z:-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
    return attrs;
  });
}

/** The canonical route an artifact HTML file answers for: index.html -> directory route. */
export function routeOf(rel) {
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

/** Artifact file that serves a route. */
function fileOf(dist, route) {
  return route.endsWith('/') ? join(dist, route, 'index.html') : join(dist, route);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Resolve the origin the verifier EXPECTS, from the same environment the build
 * used. No origin set means the planned origin, exactly as a default build.
 */
function expectedOrigin(env) {
  const raw = env[ORIGIN_ENV];
  if (raw === undefined || String(raw).trim() === '') return { origin: PLANNED_ORIGIN, source: 'default', problems: [] };
  const { origin, problems } = normalizeOrigin(String(raw));
  return { origin, source: 'env', problems };
}

/** Run fn with the origin-related variables taken from env, then restore the process environment. */
async function withEnv(env, fn) {
  const keys = [ORIGIN_ENV, RELEASE_ENV, ACK_ENV];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = String(env[k]);
  }
  try {
    return await fn();
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

/**
 * Non-public locale prefixes from the registry (pseudo, disabled, internal).
 * Shared by the development contract and the public-candidate contract.
 */
function loadNonPublicPrefixes(root) {
  const localesDoc = JSON.parse(readFileSync(join(root, 'src/content-engine/i18n/locales.json'), 'utf8'));
  return new Set(localesDoc.locales
    .filter((l) => l.id !== localesDoc.canonical && (!l.enabled || l.stage === 'pseudo' || l.publication === 'internal'))
    .map((l) => String(l.id).toLowerCase()));
}

/** True when an artifact-relative path belongs to a physically excluded surface. */
function isExcludedPublicPath(rel, prefixes) {
  const lower = rel.toLowerCase();
  if (lower === 'debug' || lower.startsWith('debug/')) return true;
  return prefixes.has(lower.split('/')[0]);
}

/**
 * Verify a built artifact directory.
 * @param {{ dist?: string, env?: Record<string, string|undefined>, release?: boolean, root?: string, public?: boolean }} options
 */
export async function verifyRelease({ dist = join(ROOT, 'dist'), env = process.env, release = false, root = ROOT, public: isPublic = false } = {}) {
  const checks = [];
  const check = (id, status, detail) => checks.push({ id, status, detail });
  const result = {
    schemaVersion: 1,
    verdict: RESULT.PASS,
    mode: isPublic ? 'public' : release ? 'release' : 'contract',
    origin: null,
    package: null,
    protocol: null,
    artifact: null,
    checks,
    external: [],
  };

  // ---- artifact presence and release metadata -------------------------------
  if (!existsSync(join(dist, 'index.html'))) {
    check('artifact.present', RESULT.FAIL, `no built site at ${dist}; run npm run build first`);
    return finish(result);
  }
  const releasePath = join(dist, 'release.json');
  if (!existsSync(releasePath)) {
    check('artifact.release-metadata', RESULT.FAIL, 'dist/release.json is missing; the artifact was not produced by astro build with this configuration');
    return finish(result);
  }
  let meta = null;
  let pkg = null;
  let protocolBytes = null;
  let protocolMeta = null;
  try {
    meta = JSON.parse(readFileSync(releasePath, 'utf8'));
  } catch {
    check('artifact.release-metadata', RESULT.FAIL, 'dist/release.json is invalid; the artifact was not produced by astro build with this configuration');
    return finish(result);
  }
  try {
    pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    protocolBytes = readFileSync(join(root, 'src/data/canonical/meta.json'));
    protocolMeta = JSON.parse(protocolBytes.toString('utf8'));
  } catch {
    check('artifact.release-metadata', RESULT.FAIL, 'repository identity sources are missing or invalid; cannot verify the artifact');
    return finish(result);
  }

  const artifactOrigin = normalizeOrigin(String(meta.origin ?? ''));
  const expected = expectedOrigin(env);
  const origin = artifactOrigin.origin ?? String(meta.origin);
  const host = origin.replace(/^https?:\/\//, '');

  result.origin = {
    effective: origin,
    expected: expected.origin,
    source: meta.originSource,
    planned: PLANNED_ORIGIN,
    plannedDomain: PLANNED_DOMAIN,
    release: meta.release === true,
    acknowledged: null,
  };
  result.package = { name: meta.package?.name ?? null, version: meta.package?.version ?? null };
  result.protocol = { version: meta.protocol?.version ?? null, commit: meta.protocol?.commit ?? null, metaSha256: meta.protocol?.metaSha256 ?? null };

  // ---- origin --------------------------------------------------------------
  if (artifactOrigin.problems.length || expected.problems.length) {
    check('origin.valid', RESULT.FAIL, [...artifactOrigin.problems, ...expected.problems].join('; '));
  } else {
    check('origin.valid', RESULT.PASS, `${origin} is a valid bare origin`);
  }
  if (expected.origin !== origin) {
    check('origin.expected-match', RESULT.FAIL, `artifact was built for ${origin} but the verifier expects ${expected.origin} (${expected.source}); rebuild or pass the same ${ORIGIN_ENV}`);
  } else {
    check('origin.expected-match', RESULT.PASS, `artifact origin ${origin} equals the expected origin (${expected.source})`);
  }
  if (release) {
    const ack = env[ACK_ENV] === undefined ? '' : String(env[ACK_ENV]).trim().replace(/\/$/, '');
    const loopback = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin);
    result.origin.acknowledged = ack === origin && meta.release === true && !loopback;
    if (meta.release !== true) {
      check('origin.release-acknowledged', RESULT.BLOCKED, 'artifact is a development/CI build (release: false); rebuild with SAI_RELEASE_BUILD=1 to produce a release artifact');
    } else if (ack !== origin) {
      check('origin.release-acknowledged', RESULT.BLOCKED, `${ACK_ENV} must repeat ${origin} to acknowledge the release origin (operator decision)`);
    } else if (loopback) {
      check('origin.release-acknowledged', RESULT.FAIL, 'a release artifact must not target a loopback origin');
    } else {
      check('origin.release-acknowledged', RESULT.PASS, `release origin ${origin} acknowledged by ${ACK_ENV}`);
    }
  } else {
    check('origin.release-acknowledged', RESULT.PASS, 'not requested (contract mode); pass --release for a release verdict');
  }

  // ---- configuration consistency (Astro origin) -----------------------------
  try {
    const { default: astroConfig } = await withEnv(env, () =>
      // A fresh module instance per call: the config reads the environment at import time.
      import(`${pathToFileURL(join(root, 'astro.config.mjs')).href}?verify=${Math.random().toString(36).slice(2)}`),
    );
    const site = astroConfig.site ? new URL(astroConfig.site).origin : null;
    if (site === origin) check('config.astro-site', RESULT.PASS, `astro.config.mjs site resolves to ${site}`);
    else check('config.astro-site', RESULT.FAIL, `astro.config.mjs site ${site} differs from the artifact origin ${origin}`);
  } catch (error) {
    const message = String(error?.message ?? error).split('\n').join(' ');
    const status = message.includes(ACK_ENV) || message.includes(ORIGIN_ENV) ? RESULT.BLOCKED : RESULT.FAIL;
    check('config.astro-site', status, `astro.config.mjs did not resolve for the verifier environment: ${message}`);
  }

  // ---- artifact identity and production eligibility -------------------------
  if (meta.build === 'production') check('artifact.production', RESULT.PASS, 'built by astro build (build: production)');
  else check('artifact.production', RESULT.FAIL, `artifact build mode is ${meta.build}; only production builds are deployable`);
  if (!existsSync(join(dist, '_astro'))) check('artifact.production', RESULT.FAIL, 'dist/_astro is missing');

  if (meta.package?.version === pkg.version) check('artifact.package-version', RESULT.PASS, `package ${pkg.version}`);
  else check('artifact.package-version', RESULT.FAIL, `artifact package ${meta.package?.version} != package.json ${pkg.version}`);

  const protocolSha = sha256(protocolBytes);
  if (meta.protocol?.metaSha256 === protocolSha && meta.protocol?.version === protocolMeta.version) {
    check('artifact.protocol-identity', RESULT.PASS, `SAIPEN ${protocolMeta.version} @ ${String(protocolMeta.commit).slice(0, 8)} matches the artifact`);
  } else {
    check('artifact.protocol-identity', RESULT.FAIL, 'artifact protocol snapshot differs from src/data/canonical/meta.json; rebuild');
  }

  // ---- publishable-output security boundary (fail-closed) -------------------
  // Runs before any route, SEO or metadata check, and the artifact can never
  // PASS when this gate fails. Reports path + classification only.
  let files = [];
  let symlinks = [];
  try {
    ({ files, symlinks } = inventoryArtifact(dist));
  } catch {
    check('artifact.clean', RESULT.FAIL, `artifact directory is missing or unreadable: ${relative(root, dist).split(sep).join('/') || '.'}`);
    return finish(result);
  }
  const violations = symlinks.map((rel) => `${rel} (symbolic link escapes the publishable boundary)`);
  for (const rel of files) {
    const why = classifyArtifactPath(rel);
    if (why) violations.push(`${rel} (${why})`);
  }
  if (violations.length) {
    const shown = violations.slice(0, 10).join(', ');
    const more = violations.length > 10 ? ` (+${violations.length - 10} more)` : '';
    check('artifact.clean', RESULT.FAIL, `publishable output contains ${violations.length} unsafe path(s): ${shown}${more}`);
  } else {
    check('artifact.clean', RESULT.PASS, `${files.length} files in publishable categories only; no links, secrets or source`);
  }

  const digest = createHash('sha256');
  const unreadable = [];
  for (const rel of files) {
    if (rel === 'release.json') continue;
    try {
      digest.update(`${rel} ${sha256(readFileSync(join(dist, rel)))}\n`);
    } catch {
      unreadable.push(rel);
    }
  }
  if (unreadable.length) {
    check('artifact.readable', RESULT.FAIL, `artifact files are missing or unreadable: ${unreadable.slice(0, 5).join(', ')}`);
  } else {
    check('artifact.readable', RESULT.PASS, `${files.length} files inventoried and hashed deterministically`);
  }
  result.artifact = { directory: relative(root, dist).split(sep).join('/') || '.', files: files.length, sha256: digest.digest('hex') };
  // ---- public-candidate contract (physical isolation, not just noindex) -----
  // A development build keeps diagnostics; a public candidate must contain no
  // /debug/ file, no non-public locale file (pseudo, disabled, internal),
  // and no discovery-index reference to those routes. noindex alone is never
  // treated as privacy or access control.
  const publicViolations = [];
  if (isPublic) {
    let prefixes = null;
    try {
      prefixes = loadNonPublicPrefixes(root);
    } catch {
      publicViolations.push('public contract indeterminable (locales registry missing or invalid)');
    }
    if (prefixes) {
      for (const rel of files) {
        if (isExcludedPublicPath(rel, prefixes)) publicViolations.push(`${rel} (internal surface in a public candidate)`);
      }
      const indexProblems = [];
      const isInternalUrl = (url) => {
        let path = '';
        try {
          path = new URL(url, 'https://candidate.invalid').pathname.toLowerCase();
        } catch {
          return false;
        }
        if (path === '/debug/' || path.startsWith('/debug/')) return true;
        return prefixes.has(path.split('/').filter(Boolean)[0] ?? '');
      };
      try {
        if (existsSync(join(dist, 'search-index.json'))) {
          const entries = JSON.parse(readFileSync(join(dist, 'search-index.json'), 'utf8'));
          for (const e of entries) if (isInternalUrl(String(e.url ?? ''))) indexProblems.push(`search-index.json -> ${e.url}`);
        }
      } catch {
        indexProblems.push('search-index.json is unreadable');
      }
      for (const name of ['llms.txt', 'llms-full.txt']) {
        try {
          if (!existsSync(join(dist, name))) continue;
          const text = readFileSync(join(dist, name), 'utf8');
          for (const m of text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) {
            if (isInternalUrl(m[1])) indexProblems.push(`${name} -> ${m[1].slice(0, 80)}`);
          }
        } catch {
          indexProblems.push(`${name} is unreadable`);
        }
      }
      for (const p of indexProblems) publicViolations.push(`${p} (internal route indexed in a public candidate)`);
    }
    if (publicViolations.length) {
      const shown = publicViolations.slice(0, 10).join(', ');
      const more = publicViolations.length > 10 ? ` (+${publicViolations.length - 10} more)` : '';
      check('artifact.public', RESULT.FAIL, `public candidate contains ${publicViolations.length} internal reference(s): ${shown}${more}`);
    } else {
      check('artifact.public', RESULT.PASS, `${files.length} files: no diagnostics, no non-public locales, no internal index references`);
    }
  } else {
    check('artifact.public', RESULT.PASS, 'not requested (development contract keeps diagnostics); pass --public for a public-candidate verdict');
  }
  if (violations.length || unreadable.length || publicViolations.length) {
    // Skip content checks that would read untrusted files; keep the verdict FAIL.
    // Still record the mandatory external blockers below before finishing.
    result.external = [
      { id: 'dns', status: RESULT.BLOCKED, reason: 'the origin hostname resolves to the deployment host; not checked offline' },
      { id: 'https', status: RESULT.BLOCKED, reason: 'TLS certificate and HTTPS reachability of the origin; not checked offline' },
      { id: 'hosting', status: RESULT.BLOCKED, reason: 'the static host serves dist/ with clean URLs, trailing slashes, 404 and content types; operator verification' },
      { id: 'redirects', status: RESULT.BLOCKED, reason: 'temporary-to-permanent redirect strategy, where the host supports it; operator verification' },
      { id: 'search-indexing', status: RESULT.BLOCKED, reason: 'actual search engine discovery and indexing; not claimed by any offline check. robots.txt Disallow is not access control and may hide the noindex directive from crawlers, so diagnostic exclusion is never guaranteed' },
    ];
    return finish(result);
  }

  // ---- routes, sitemap and robots -------------------------------------------
  // Missing or unreadable page metadata is a FAIL, never a silent pass.
  const htmlFiles = files.filter((rel) => rel.endsWith('.html'));
  const pageReadFailures = [];
  const pages = [];
  for (const rel of htmlFiles) {
    let html;
    try {
      html = readFileSync(join(dist, rel), 'utf8');
    } catch {
      pageReadFailures.push(rel);
      continue;
    }
    const headEnd = html.indexOf('</head>');
    const head = headEnd < 0 ? html : html.slice(0, headEnd);
    const body = headEnd < 0 ? '' : html.slice(headEnd);
    const headTags = [...tagsOf(head, 'link').map((a) => ({ tag: 'link', ...a })), ...tagsOf(head, 'meta').map((a) => ({ tag: 'meta', ...a }))];
    pages.push({
      rel,
      route: routeOf(rel),
      noindex: tagsOf(head, 'meta').some((a) => a.name === 'robots' && /noindex/.test(a.content ?? '')),
      canonical: tagsOf(head, 'link').filter((a) => a.rel === 'canonical').map((a) => a.href),
      hreflang: tagsOf(head, 'link').filter((a) => a.hreflang).map((a) => ({ lang: a.hreflang, href: a.href })),
      og: tagsOf(head, 'meta').filter((a) => a.property?.startsWith('og:url') || a.property === 'og:image').map((a) => a.content),
      headTags,
      anchors: tagsOf(body, 'a').map((a) => a.href).filter((h) => typeof h === 'string'),
    });
  }
  if (pageReadFailures.length) {
    check('seo.metadata-present', RESULT.FAIL, `required HTML metadata is missing or unreadable: ${pageReadFailures.slice(0, 5).join(', ')}`);
  } else if (pages.length === 0) {
    check('seo.metadata-present', RESULT.FAIL, 'no HTML pages found in the artifact');
  } else {
    check('seo.metadata-present', RESULT.PASS, `${pages.length} pages carry readable HTML metadata`);
  }

  let localesDoc = null;
  try {
    localesDoc = JSON.parse(readFileSync(join(root, 'src/content-engine/i18n/locales.json'), 'utf8'));
  } catch {
    check('locales.registry', RESULT.FAIL, 'src/content-engine/i18n/locales.json is missing or invalid');
    return finish(result);
  }
  const canonicalLocale = localesDoc.canonical;
  const isPublicLocale = (l) => l.enabled && l.stage !== 'pseudo' && l.publication !== 'internal';
  const publicPrefixes = new Set(localesDoc.locales.filter((l) => l.id !== canonicalLocale && isPublicLocale(l)).map((l) => l.id.toLowerCase()));
  const nonPublicPrefixes = new Set(localesDoc.locales.filter((l) => l.id !== canonicalLocale && !isPublicLocale(l)).map((l) => l.id.toLowerCase()));
  const localeOfRoute = (route) => {
    const first = route.split('/')[1]?.toLowerCase();
    return nonPublicPrefixes.has(first) || publicPrefixes.has(first) ? first : canonicalLocale;
  };
  const isDebug = (route) => route.startsWith('/debug/');
  const routeSet = new Set(pages.map((p) => p.route));
  const existsRoute = (route) => existsSync(fileOf(dist, route));

  // sitemap (missing, unreadable or malformed sitemap is a structured FAIL)
  const sitemapPath = join(dist, 'sitemap.xml');
  let sitemapLocs = null;
  let sitemapMalformed = false;
  if (!existsSync(sitemapPath)) {
    sitemapLocs = null;
  } else {
    try {
      const raw = readFileSync(sitemapPath, 'utf8');
      if (!/<urlset[\s>]/.test(raw)) sitemapMalformed = true;
      sitemapLocs = [...raw.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].trim());
      if (sitemapLocs.some((loc) => { try { new URL(loc); return false; } catch { return true; } })) sitemapMalformed = true;
    } catch {
      sitemapLocs = null;
    }
  }
  if (sitemapLocs === null) {
    check('sitemap.origin', RESULT.FAIL, 'dist/sitemap.xml is missing or unreadable');
  } else {
    const foreign = sitemapLocs.filter((loc) => !loc.startsWith(`${origin}/`));
    if (foreign.length) check('sitemap.origin', RESULT.FAIL, `${foreign.length} sitemap entries are not on ${origin}, e.g. ${foreign[0]}`);
    else check('sitemap.origin', RESULT.PASS, `${sitemapLocs.length} entries, all on ${origin}`);

    const paths = [];
    for (const loc of sitemapLocs) {
      try {
        paths.push(new URL(loc).pathname);
      } catch {
        check('sitemap.origin', RESULT.FAIL, `sitemap entry is not a valid absolute URL: ${loc.slice(0, 80)}`);
        paths.push(null);
      }
    }
    const missingFile = paths.filter((route) => !existsRoute(route));
    if (missingFile.length) check('sitemap.routes-exist', RESULT.FAIL, `sitemap lists routes with no built output: ${missingFile.slice(0, 5).join(', ')}`);
    else check('sitemap.routes-exist', RESULT.PASS, 'every sitemap entry is a generated public route');

    const forbiddenEntries = paths.filter((route) => isDebug(route) || nonPublicPrefixes.has(route.split('/')[1]?.toLowerCase()));
    if (forbiddenEntries.length) check('sitemap.exclusions', RESULT.FAIL, `sitemap includes diagnostic or non-public routes: ${forbiddenEntries.join(', ')}`);
    else check('sitemap.exclusions', RESULT.PASS, 'no debug, pseudo-locale or unapproved locale route is listed');

    const indexable = pages.filter((p) => !p.noindex && p.rel !== '404.html').map((p) => p.route);
    const listed = new Set(paths);
    const notListed = indexable.filter((route) => !listed.has(route));
    const unindexedListed = [...listed].filter((route) => pages.some((p) => p.route === route && p.noindex));
    if (notListed.length || unindexedListed.length) {
      check('sitemap.indexable-equality', RESULT.FAIL, `indexable pages missing from sitemap: [${notListed.join(', ')}]; listed but noindex: [${unindexedListed.join(', ')}]`);
    } else {
      check('sitemap.indexable-equality', RESULT.PASS, `sitemap lists exactly the ${indexable.length} indexable pages`);
    }
  }

  if (sitemapMalformed) {
    check('sitemap.wellformed', RESULT.FAIL, 'dist/sitemap.xml is malformed');
  } else if (sitemapLocs !== null) {
    check('sitemap.wellformed', RESULT.PASS, 'dist/sitemap.xml is well-formed');
  }

  // robots.txt (missing or unreadable robots.txt is a structured FAIL)
  const robotsPath = join(dist, 'robots.txt');
  let robots = null;
  try {
    robots = existsSync(robotsPath) ? readFileSync(robotsPath, 'utf8') : null;
  } catch {
    robots = null;
  }
  if (robots === null) {
    check('robots.sitemap', RESULT.FAIL, 'dist/robots.txt is missing or unreadable');
  } else {
    const sitemapLines = robots.split('\n').filter((line) => /^Sitemap:/i.test(line.trim())).map((line) => line.trim().slice('Sitemap:'.length).trim());
    const wanted = `${origin}/sitemap.xml`;
    if (sitemapLines.length === 1 && sitemapLines[0] === wanted) check('robots.sitemap', RESULT.PASS, `Sitemap: ${wanted}`);
    else check('robots.sitemap', RESULT.FAIL, `robots.txt Sitemap lines ${JSON.stringify(sitemapLines)} must be exactly ${wanted}`);
    // robots.txt is not access control: Disallow may hide the noindex directive
    // from compliant crawlers, so diagnostic exclusion is never guaranteed.
    if (robots.split('\n').some((line) => line.trim() === 'Disallow: /debug/')) check('robots.debug-disallow', RESULT.PASS, 'Disallow: /debug/ present (crawl hint only; noindex carries the indexing rule, exclusion never guaranteed)');
    else check('robots.debug-disallow', RESULT.FAIL, 'robots.txt does not disallow /debug/');
  }

  // ---- SEO metadata per page ------------------------------------------------
  const canonicalProblems = [];
  const hreflangProblems = [];
  const navigationProblems = [];
  for (const page of pages) {
    const notFound = /(^|\/)404(\.html|\/)$/.test(page.route);
    if (notFound) {
      // The not-found page answers for no route of its own, so it declares no canonical.
      if (page.canonical.length) canonicalProblems.push(`${page.rel}: not-found page declares a canonical link`);
    } else if (page.canonical.length !== 1) {
      canonicalProblems.push(`${page.rel}: ${page.canonical.length} canonical links`);
    } else {
      const [href] = page.canonical;
      if (!href.startsWith(`${origin}/`)) canonicalProblems.push(`${page.rel}: canonical ${href} is not on ${origin}`);
      else {
        let target = null;
        try {
          target = new URL(href).pathname;
        } catch {
          canonicalProblems.push(`${page.rel}: canonical URL is invalid`);
        }
        if (target !== null) {
          if (!page.noindex && target !== page.route) canonicalProblems.push(`${page.rel}: indexable page canonical ${target} != ${page.route}`);
          if (!existsRoute(target)) canonicalProblems.push(`${page.rel}: canonical ${target} resolves to no built page`);
        }
      }
    }
    for (const og of page.og) if (!og.startsWith(`${origin}/`)) canonicalProblems.push(`${page.rel}: Open Graph URL ${og} is not on ${origin}`);
    for (const alt of page.hreflang) {
      if (!alt.href.startsWith(`${origin}/`)) hreflangProblems.push(`${page.rel}: hreflang ${alt.lang} -> ${alt.href}`);
      else if (alt.lang !== 'x-default' && alt.lang !== canonicalLocale && !publicPrefixes.has(alt.lang.toLowerCase())) {
        hreflangProblems.push(`${page.rel}: hreflang advertises non-public locale ${alt.lang}`);
      }      else {
        let target = null;
        try {
          target = new URL(alt.href).pathname;
        } catch {
          hreflangProblems.push(`${page.rel}: hreflang ${alt.lang} target URL is invalid`);
        }
        if (target !== null && !existsRoute(target)) hreflangProblems.push(`${page.rel}: hreflang ${alt.lang} target has no built page`);
      }
    }
    if (page.hreflang.length && !page.hreflang.some((a) => a.lang === 'x-default')) hreflangProblems.push(`${page.rel}: hreflang set without x-default`);
    for (const href of page.anchors) {
      if (href.startsWith(`${origin}/`) || href.startsWith(`https://${host}/`)) navigationProblems.push(`${page.rel}: internal link is absolute: ${href}`);
    }
  }
  if (canonicalProblems.length) check('seo.canonical', RESULT.FAIL, canonicalProblems.slice(0, 6).join('; '));
  else check('seo.canonical', RESULT.PASS, `${pages.length} pages: canonical, Open Graph and route targets consistent on ${origin}`);
  if (hreflangProblems.length) check('seo.hreflang', RESULT.FAIL, hreflangProblems.slice(0, 6).join('; '));
  else check('seo.hreflang', RESULT.PASS, 'hreflang and x-default use the effective origin and public locales only');
  if (navigationProblems.length) check('navigation.root-relative', RESULT.FAIL, navigationProblems.slice(0, 6).join('; '));
  else check('navigation.root-relative', RESULT.PASS, 'internal navigation stays root-relative');

  // Foreign absolute URLs in machine-facing surfaces (head metadata, sitemap, robots, llms, Markdown twins).
  // Unreadable surfaces are a FAIL, never silently skipped.
  const surfaceRels = files.filter((rel) => /(^|\/)(llms(-full)?\.txt|sitemap\.xml|robots\.txt)$|\.md$/.test(rel));
  const surfaces = pages.map((p) => ({ rel: p.rel, text: p.headTags.map((t) => Object.values(t).join(' ')).join(' ') }));
  const unreadableSurfaces = [];
  for (const rel of surfaceRels) {
    try {
      surfaces.push({ rel, text: readFileSync(join(dist, rel), 'utf8') });
    } catch {
      unreadableSurfaces.push(rel);
    }
  }
  if (unreadableSurfaces.length) check('seo.surfaces-readable', RESULT.FAIL, `machine-facing surfaces are unreadable: ${unreadableSurfaces.slice(0, 5).join(', ')}`);
  else check('seo.surfaces-readable', RESULT.PASS, `${surfaces.length} machine-facing surfaces readable`);
  const foreign = [];
  let originHost = '';
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = '';
  }
  for (const surface of surfaces) {
    for (const m of surface.text.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)) {
      let h = '';
      try {
        h = new URL(m[0]).host;
      } catch {
        foreign.push(`${surface.rel} -> invalid URL`);
        continue;
      }
      if (h !== originHost && !UPSTREAM_HOSTS.has(h)) foreign.push(`${surface.rel} -> ${m[0]}`);
    }
  }
  if (foreign.length) check('seo.foreign-origin', RESULT.FAIL, `${foreign.length} machine-facing URLs point at another origin, e.g. ${foreign[0]}`);
  else check('seo.foreign-origin', RESULT.PASS, `machine-facing surfaces reference only ${origin} and upstream projects`);

  // ---- indexing exclusions ---------------------------------------------------
  const debugPages = pages.filter((p) => isDebug(p.route));
  const debugMissing = debugPages.filter((p) => !p.noindex).map((p) => p.rel);
  if (debugMissing.length) check('noindex.debug', RESULT.FAIL, `debug pages without noindex: ${debugMissing.join(', ')}`);
  else check('noindex.debug', RESULT.PASS, `${debugPages.length} debug pages carry noindex`);

  const nonPublicPages = pages.filter((p) => nonPublicPrefixes.has(localeOfRoute(p.route)));
  const nonPublicIndexed = nonPublicPages.filter((p) => !p.noindex).map((p) => p.rel);
  if (nonPublicIndexed.length) check('noindex.internal-locales', RESULT.FAIL, `pseudo-locale or unapproved locale pages without noindex: ${nonPublicIndexed.slice(0, 6).join(', ')}`);
  else check('noindex.internal-locales', RESULT.PASS, `${nonPublicPages.length} pages of non-public locales carry noindex`);

  const unapprovedAdvertised = pages.filter((p) => !isDebug(p.route) && !p.noindex && nonPublicPrefixes.has(localeOfRoute(p.route)));
  if (unapprovedAdvertised.length) check('locales.restricted', RESULT.FAIL, `non-public locale pages advertised as indexable: ${unapprovedAdvertised.map((p) => p.rel).join(', ')}`);
  else check('locales.restricted', RESULT.PASS, `non-public locales (${[...nonPublicPrefixes].join(', ') || 'none'}) are not advertised`);

  // ---- finish ----------------------------------------------------------------
  // External checks are always listed, never claimed.
  result.external = [
    { id: 'dns', status: RESULT.BLOCKED, reason: 'the origin hostname resolves to the deployment host; not checked offline' },
    { id: 'https', status: RESULT.BLOCKED, reason: 'TLS certificate and HTTPS reachability of the origin; not checked offline' },
    { id: 'hosting', status: RESULT.BLOCKED, reason: 'the static host serves dist/ with clean URLs, trailing slashes, 404 and content types; operator verification' },
    { id: 'redirects', status: RESULT.BLOCKED, reason: 'temporary-to-permanent redirect strategy, where the host supports it; operator verification' },
    { id: 'search-indexing', status: RESULT.BLOCKED, reason: 'actual search engine discovery and indexing; not claimed by any offline check. robots.txt Disallow is not access control and may hide the noindex directive from crawlers, so diagnostic exclusion is never guaranteed' },
  ];
  return finish(result);
}

/** Verdict: any FAIL fails; otherwise any BLOCKED blocks; otherwise PASS. External items never change it. */
function finish(result) {
  const statuses = result.checks.map((c) => c.status);
  result.verdict = statuses.includes(RESULT.FAIL) ? RESULT.FAIL : statuses.includes(RESULT.BLOCKED) ? RESULT.BLOCKED : RESULT.PASS;
  return result;
}

/** Process exit status for a verdict. */
export function exitCodeOf(verdict) {
  return { PASS: 0, FAIL: 1, BLOCKED: 3 }[verdict] ?? 1;
}

async function main(argv) {
  const args = { dist: join(ROOT, 'dist'), release: false, public: false, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--release') args.release = true;
    else if (a === '--public') args.public = true;
    else if (a === '--dist') args.dist = resolve(argv[++i]);
    else if (a === '--out') args.out = resolve(argv[++i]);
    else throw new Error(`unknown option ${a}`);
  }
  const result = await verifyRelease({ dist: args.dist, release: args.release, public: args.public, env: process.env });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, json);
  }
  process.stdout.write(json);
  return exitCodeOf(result.verdict);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (error) => {
    console.error(`release:verify error: ${error.message}`);
    process.exit(2);
  });
}
