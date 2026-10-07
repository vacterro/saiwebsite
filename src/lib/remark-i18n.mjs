/**
 * Remark plugin: drop documentation segment directives before rendering.
 *
 * A canonical document carries one `<!-- i18n:<segment id> -->` line before
 * each translatable segment (see src/content-engine/i18n/segments.mjs). The
 * comment is content-engine metadata, not content: it must never reach the
 * built HTML, so it is removed at the mdast stage — before remark-rehype turns
 * anything into markup. Removing the node leaves the surrounding blocks exactly
 * as they were, so canonical English output is byte-for-byte what it was before
 * segmentation.
 *
 * The same plugin runs on the canonical content collection and on the
 * localized renderer, so both render the same prose.
 */

const DIRECTIVE = /^\s*<!--\s*i18n:[A-Za-z0-9._-]+\s*-->\s*$/;

export default function remarkI18n() {
  return (tree) => {
    const walk = (node) => {
      if (!Array.isArray(node.children)) return;
      node.children = node.children.filter((child) => !(child.type === 'html' && DIRECTIVE.test(child.value)));
      for (const child of node.children) walk(child);
    };
    walk(tree);
  };
}
