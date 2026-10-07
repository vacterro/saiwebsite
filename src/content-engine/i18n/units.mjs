/**
 * Shared shaping of catalogues and translation unit files. Pure.
 */

/** Merge catalogue documents into one ID -> block map; a duplicate ID throws. */
export function mergeCatalogs(docs) {
  const out = {};
  for (const doc of docs) {
    for (const [id, block] of Object.entries(doc.blocks)) {
      if (id in out) throw new Error(`block ${id} is defined twice`);
      out[id] = { ...block, domain: doc.domain, usedBy: doc.usedBy ?? [] };
    }
  }
  return out;
}

/**
 * Navigation labels are owned by the page registry. They become translatable
 * blocks `pages.<page id>.label` without being copied into a catalogue. Labels
 * of internal debug benches go to their own domain, outside every locale's
 * translation scope.
 */
export function pageLabelBlocks(registry) {
  const pub = {};
  const internal = {};
  for (const page of registry.pages) {
    if (page.nav === 'none') continue;
    (page.audience === 'internal' ? internal : pub)[`pages.${page.id}.label`] = { type: 'text', text: page.label, note: `Navigation label of ${page.route}` };
  }
  return [
    { schemaVersion: 1, domain: 'pages', usedBy: ['all-html'], blocks: pub },
    { schemaVersion: 1, domain: 'pages-internal', usedBy: ['page:debug.*'], blocks: internal },
  ];
}

/** Unit files ({ locale, domain, units }) -> locale -> block ID -> unit. */
export function unitsByLocale(docs) {
  const out = {};
  for (const doc of docs) {
    out[doc.locale] ??= {};
    for (const [id, unit] of Object.entries(doc.units ?? {})) out[doc.locale][id] = { ...unit, domain: doc.domain };
  }
  return out;
}
