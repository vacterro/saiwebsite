// @ts-check
import { defineConfig } from 'astro/config';
import rehypeWintage from './src/lib/rehype-wintage.mjs';

// Static output only: no adapter, no server, no runtime service
// (BOOTSTRAP_CORRIDOR §2, MASTER_ROADMAP M25).
export default defineConfig({
  output: 'static',
  // The canonical public origin (FUTURE_GATES FG-001 decides when it serves).
  // Used for canonical URLs, the sitemap and llms.txt; every internal link is
  // root-relative, so the build also works from any static host or preview.
  site: 'https://saipenprotocol.com',
  trailingSlash: 'always',
  build: { format: 'directory' },
  markdown: {
    // No highlighter: it would emit inline colours outside the 21-token palette.
    syntaxHighlight: false,
    smartypants: false,
    rehypePlugins: [rehypeWintage],
  },
});
