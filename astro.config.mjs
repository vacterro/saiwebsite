// @ts-check
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import rehypeWintage from './src/lib/rehype-wintage.mjs';
import remarkI18n from './src/lib/remark-i18n.mjs';
import { resolveDeployment } from './src/lib/deployment.mjs';

// One resolved authority for the whole build: Astro's `site`, the SSR constant
// `__SAI_SITE_ORIGIN__` read by src/data/site.ts, and dist/release.json all come
// from this value. An invalid SAI_SITE_ORIGIN fails the build right here.
const deployment = resolveDeployment(process.env);
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const protocolMetaPath = new URL('./src/data/canonical/meta.json', import.meta.url);
const protocolMetaBytes = readFileSync(protocolMetaPath);
const protocol = JSON.parse(protocolMetaBytes.toString('utf8'));

/**
 * Release metadata written at the end of `astro build`. Deliberately has no
 * timestamp, so identical inputs give byte-identical output.
 */
function releaseMetadata() {
  return {
    name: 'sai-release-metadata',
    hooks: {
      /** @param {{ dir: URL }} param */
      'astro:build:done': ({ dir }) => {
        const record = {
          schemaVersion: 1,
          build: 'production',
          release: deployment.release,
          origin: deployment.origin,
          originSource: deployment.source,
          plannedDomain: deployment.plannedDomain,
          package: { name: pkg.name, version: pkg.version },
          protocol: {
            version: protocol.version,
            commit: protocol.commit,
            metaSha256: createHash('sha256').update(protocolMetaBytes).digest('hex'),
          },
        };
        writeFileSync(fileURLToPath(new URL('release.json', dir)), `${JSON.stringify(record, null, 2)}\n`);
      },
    },
  };
}

// Static output only: no adapter, no server, no runtime service
// (BOOTSTRAP_CORRIDOR §2, MASTER_ROADMAP M25).
export default defineConfig({
  output: 'static',
  // The effective public origin (src/lib/deployment.mjs). Every absolute URL the
  // site emits is derived from it; every internal link stays root-relative, so
  // the same artifact works from any static host or preview.
  site: deployment.origin,
  trailingSlash: 'always',
  build: { format: 'directory' },
  vite: {
    define: {
      __SAI_SITE_ORIGIN__: JSON.stringify(deployment.origin),
    },
    // Vite's dependency cache belongs outside node_modules: a hermetic build
    // sandbox copies node_modules as measured read-only context, and a cache
    // write inside it would invalidate the very bytes under measurement.
    cacheDir: '.vite-cache',
  },
  integrations: [releaseMetadata()],
  markdown: {
    // No highlighter: it would emit inline colours outside the 21-token palette.
    syntaxHighlight: false,
    smartypants: false,
    // Segment directives are content-engine metadata; they never reach output.
    remarkPlugins: [remarkI18n],
    rehypePlugins: [rehypeWintage],
  },
});
