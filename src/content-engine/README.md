# Content engine

The content engine is the machine-readable layer that lets the site reason
about itself: which addresses exist, what each one is made of, which
authorities it depends on, what becomes stale when one of them changes, and
which words exist in which language. It is built in the stages of
`roadmap/SAI_WEBSITE — MASTER_CONTENT_SYSTEM_ROADMAP_*.md`.

Nothing here runs in the browser and nothing here touches the network during
a build. One rule holds throughout: **change a fact once; the engine finds
everything it affects.**

## Map

```text
registry/
  pages.json        every address: stable ID, kind, owner, maturity, nav, flags, sources   (M31)
  sources.json      every authority: kind, canonical location, snapshot paths, refresh     (M32)
  generated.json    every generated artifact: generator, inputs, integrity proof           (M36)
  tests.json        which gate covers which pages and sources                             (M34)
  schema.mjs        page registry validator + inventory builder
  sources.mjs       source registry validator
sources/lock.mjs    source identities (hashes, upstream version/revision)                 (M33)
models/             normalized protocol, ecosystem, support and version models            (M35)
graph/graph.mjs     dependency graph and impact analysis                                  (M34)
generated/          integrity checks of generated artifacts                               (M36)
blocks/             canonical English content blocks, one catalogue per domain            (M37, M41)
i18n/               locales, glossary, translator, store, pseudo-locale, translator guide (M42-M49)
inventory/          the built site as the registry sees it; generated inventory           (M31)
manifests/          generated locks: source-lock.json, content-lock.json                  (M33, M41)
engine.mjs          one loader for every command above
```

## Ownership

`registry/pages.json` is the single owner of every address. `src/data/site.ts`
derives the navigation shell from it and validates it on import, so an invalid
registry fails `astro build`. `scripts/route-registry.mjs` gives the Node gates
the same projection. Pages read protocol, ecosystem, support and version facts
only through `models/`; upstream snapshots and GitHub field names never reach
a component.

Words on the pilot pages (home, about, pricing, search, 404, the shell and the
docs chrome) live in `blocks/*.json` and are rendered through a translator, so
one view renders every locale. Docs pages are translated as whole documents.

## Commands

| Command | Does | Mutates |
|---------|------|---------|
| `npm run site:doctor` | Health of sources, content, translations, derived outputs, contracts; exit 0 healthy, 1 broken, 2 stale; `--json` for agents | no |
| `npm run site:impact -- <id>` | Pages, locales, units and gates affected by a source, page, family or block | no |
| `npm run site:refresh` | Rewrite the inventory, source lock and content lock from the tree | manifests only |
| `npm run site:sync -- [--source <id>] [--dry-run]` | Refresh upstream snapshots through their sync tools, then report impact | snapshots + manifests |
| `npm run site:drift` | Meaningful source and translation drift as a ready-to-file SAIPEN ticket | no |
| `npm run validate:registry` | Registry schema, built routes, discovery flags, inventory; 14 red controls | no |
| `npm run i18n:status` / `i18n:export` / `i18n:import` / `i18n:validate` / `i18n:memory` / `i18n:add` / `i18n:enable` | Translation workflow, see `i18n/TRANSLATING.md` | `src/locales/`, `locales.json` |
| `npm run fonts:coverage` | Regenerate the glyph coverage of the pixel faces | `i18n/font-coverage.json` |

## After you change something

```bash
npm run build
npm run site:refresh     # regenerate manifests; review `git diff` of them
npm run site:doctor      # must end HEALTHY
```

- **New page**: add the Astro page, then a static entry in `registry/pages.json`
  unless a family already covers it (docs, blog, playground, spec).
- **New text on a pilot page**: add a block to the domain's catalogue in
  `blocks/` and render it with `tx.text(id)` or `tx.html(id)`. Translations of
  it become MISSING in every locale — that is translation work, not a failure.
- **Changed English text**: nothing else to do. Units translated from the old
  text become STALE and fall back to English until a translator updates them.
- **New source**: describe it in `registry/sources.json` and reference it from
  the pages that use it; `site:impact` then knows its blast radius.

## Locales

Locales are data in `i18n/locales.json`: `en` canonical; `qps-ploc` an
internal pseudo-locale that proves routing, fallback, glyph coverage and
layout stretch on every build; `et` and `ru` registered as pilot locales,
disabled until translated. Locale routes are `/<locale>/…`. A locale page
exists only for pilot pages and for documents translated to a status the
locale renders, so a translated page never links to one that was not built.
The translation workflow is documented for translators in
[`i18n/TRANSLATING.md`](i18n/TRANSLATING.md).
