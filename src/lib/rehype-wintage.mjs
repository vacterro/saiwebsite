/**
 * Rehype plugin: turns rendered Markdown into Wintage document markup.
 *
 *   headings     h2-h4 get a stable id (if missing) and a trailing "#" anchor
 *                link, so every section has a permanent, copyable deep link
 *                (MASTER_ROADMAP M5 "heading anchors", §12 "stable anchors").
 *   callouts     a blockquote whose first line is [!NOTE], [!WARNING],
 *                [!AUTHORITY] or [!EXAMPLE] becomes <aside class="callout ...">
 *                with a visible label word — the state is never carried by
 *                colour alone.
 *   tables       wrapped in .wide-scroll so a wide table scrolls itself and
 *                the page never scrolls sideways (UI.md iron law 4).
 *   code blocks  <pre> gets the sunken .w-code frame.
 *   links        external links are marked rel="noopener" and carry a
 *                data-external flag so CSS can label them.
 *
 * No syntax highlighter: colour comes only from the 21 palette tokens, and a
 * highlighter would emit its own colour system inline.
 */

const CALLOUTS = {
  NOTE: 'Note',
  WARNING: 'Warning',
  AUTHORITY: 'Authority',
  EXAMPLE: 'Example',
};

function text(node) {
  if (node.type === 'text') return node.value;
  return (node.children ?? []).map(text).join('');
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[`'"’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const child of node.children ?? []) walk(child, visit, node);
}

export default function rehypeWintage() {
  return (tree) => {
    const seen = new Map();

    walk(tree, (node, parent) => {
      if (node.type !== 'element') return;

      if (/^h[2-4]$/.test(node.tagName)) {
        let id = node.properties.id;
        if (!id) {
          const base = slugify(text(node)) || 'section';
          const n = seen.get(base) ?? 0;
          seen.set(base, n + 1);
          id = n ? `${base}-${n}` : base;
          node.properties.id = id;
        }
        node.children.push({ type: 'text', value: ' ' }, {
          type: 'element',
          tagName: 'a',
          properties: { className: ['anchor'], href: `#${id}`, ariaLabel: `Link to this section` },
          children: [{ type: 'text', value: '#' }],
        });
      }

      if (node.tagName === 'blockquote') {
        const first = node.children.find((c) => c.type === 'element');
        const lead = first && first.children?.[0];
        const match = lead?.type === 'text' && lead.value.match(/^\[!(NOTE|WARNING|AUTHORITY|EXAMPLE)\]\s*/);
        if (match) {
          lead.value = lead.value.slice(match[0].length);
          const kind = match[1].toLowerCase();
          node.tagName = 'aside';
          node.properties = { className: ['callout', `callout--${kind}`] };
          node.children.unshift({
            type: 'element',
            tagName: 'p',
            properties: { className: ['callout__label'] },
            children: [{ type: 'text', value: CALLOUTS[match[1]] }],
          });
        }
      }

      if (node.tagName === 'pre') {
        node.properties.className = [...(node.properties.className ?? []), 'w-code'];
      }

      if (node.tagName === 'table' && parent && !(parent.properties?.className ?? []).includes('wide-scroll')) {
        const clone = { ...node };
        node.tagName = 'div';
        node.properties = { className: ['wide-scroll'] };
        node.children = [{ ...clone, properties: { ...(clone.properties ?? {}), className: ['w-table'] } }];
      }

      if (node.tagName === 'a' && /^https?:\/\//.test(node.properties.href ?? '')) {
        node.properties.rel = ['noopener'];
        node.properties.dataExternal = '';
      }
    });
  };
}
