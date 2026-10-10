/**
 * Public origin authority (Node-compatible, no runtime or browser dependency).
 *
 * Two facts are kept apart on purpose:
 *   planned permanent domain  editorial information (PLANNED_DOMAIN). It may
 *                             appear in prose; it never controls emitted URLs.
 *   effective origin          the origin this build emits: canonical links,
 *                             hreflang, Open Graph, sitemap, robots.txt,
 *                             llms.txt and the Markdown twins. Only this value
 *                             is used for URL emission.
 *
 * The effective origin comes from SAI_SITE_ORIGIN. Without it, a dev or CI
 * build deterministically uses the planned permanent origin (source "default").
 * A release build (SAI_RELEASE_BUILD=1) must name its origin explicitly and
 * acknowledge it by repeating the same value in SAI_RELEASE_ORIGIN_ACK, so no
 * release is ever stamped with a hostname nobody chose for it.
 *
 * An origin is a bare scheme://host[:port] with no path, query, fragment or
 * credentials. Path-based deployment is not supported. Public origins must be
 * HTTPS; plain HTTP is accepted only for loopback development.
 */

export const PLANNED_DOMAIN = 'saipenprotocol.com';
export const PLANNED_ORIGIN = `https://${PLANNED_DOMAIN}`;
export const ORIGIN_ENV = 'SAI_SITE_ORIGIN';
export const RELEASE_ENV = 'SAI_RELEASE_BUILD';
export const ACK_ENV = 'SAI_RELEASE_ORIGIN_ACK';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate and normalise one origin string.
 * @returns {{ origin: string | null, problems: string[] }}
 */
export function normalizeOrigin(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { origin: null, problems: [`${ORIGIN_ENV} is empty`] };
  }
  const text = raw.trim();
  if (/[?#]/.test(text)) {
    return { origin: null, problems: [`${ORIGIN_ENV} must not contain a query string or fragment: ${text}`] };
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    return { origin: null, problems: [`${ORIGIN_ENV} is not an absolute URL: ${text}`] };
  }
  const problems = [];
  if (url.username || url.password) problems.push(`${ORIGIN_ENV} must not carry credentials`);
  if (url.pathname !== '/') {
    problems.push(`${ORIGIN_ENV} must be a bare origin; path-based deployment (${url.pathname}) is not supported`);
  }
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    problems.push(`${ORIGIN_ENV} uses unsupported protocol ${url.protocol} (public origins must be https)`);
  }
  if (url.port && !loopback) problems.push(`${ORIGIN_ENV} must not set an explicit port for a public host`);
  if (!loopback) {
    const labels = url.hostname.split('.');
    if (labels.length < 2) problems.push(`${ORIGIN_ENV} hostname must be a fully qualified domain: ${url.hostname}`);
    else if (labels.some((label) => !HOST_LABEL.test(label))) {
      problems.push(`${ORIGIN_ENV} hostname is invalid: ${url.hostname}`);
    } else if (labels.every((label) => /^[0-9]+$/.test(label))) {
      problems.push(`${ORIGIN_ENV} must use a domain name, not an IP literal`);
    }
  }
  if (problems.length) return { origin: null, problems };
  return { origin: `${url.protocol}//${url.host}`, problems: [] };
}

/**
 * Resolve the effective deployment for one build.
 * Throws a single Error listing every problem, so a bad configuration can never
 * produce a partly valid artifact.
 */
export function resolveDeployment(env = process.env, { release } = {}) {
  const isRelease = release ?? env[RELEASE_ENV] === '1';
  const raw = env[ORIGIN_ENV];
  const explicit = raw !== undefined && String(raw).trim() !== '';
  const problems = [];
  let origin = PLANNED_ORIGIN;
  let source = 'default';

  if (explicit) {
    const result = normalizeOrigin(String(raw));
    problems.push(...result.problems);
    if (result.origin) {
      origin = result.origin;
      source = 'env';
    }
  } else if (isRelease) {
    problems.push(`${ORIGIN_ENV} is required for a release build; a release never assumes the planned origin`);
  }

  if (isRelease && !problems.length) {
    if (LOOPBACK_HOSTS.has(new URL(origin).hostname)) {
      problems.push(`${ORIGIN_ENV} is loopback; a release build needs its public origin`);
    }
    const ack = env[ACK_ENV] === undefined ? '' : String(env[ACK_ENV]).trim().replace(/\/$/, '');
    if (ack !== origin) {
      problems.push(`${ACK_ENV} must repeat the release origin exactly (${origin}) to acknowledge it`);
    }
  }

  if (problems.length) throw new Error(`invalid deployment configuration:\n  ${problems.join('\n  ')}`);

  return Object.freeze({
    origin,
    host: new URL(origin).host,
    source,
    release: isRelease,
    planned: PLANNED_ORIGIN,
    plannedDomain: PLANNED_DOMAIN,
    isPlanned: origin === PLANNED_ORIGIN,
  });
}
