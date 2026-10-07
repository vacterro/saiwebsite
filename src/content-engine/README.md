# Content engine

The content engine is the machine-readable layer that lets the site reason
about itself: which addresses exist, what each one is, who owns its words and
which facts it depends on. It is being built in stages (see
`roadmap/SAI_WEBSITE — MASTER_CONTENT_SYSTEM_ROADMAP_*.md`); this directory
currently holds milestone M31, the page registry.

Nothing here runs in the browser and nothing here touches the network.

## Ownership direction

`registry/pages.json` is the single owner of every address the site serves.
Everything else derives from it:

```text
registry/pages.json ──► src/data/site.ts        navigation shell (ROUTES, MENU_ROUTES, …)
                    ──► scripts/route-registry.mjs  Node gates (audit:build, test:shell)
                    ──► inventory/pages.inventory.json  generated, committed
```

`src/data/site.ts` keeps the site identity (`SITE`) and projects the shell
entries (`nav` = `primary | secondary | debug`) of the registry. It validates
the registry on import, so an invalid registry fails `astro build`. Do not add
a route anywhere else.

## Files

| File | Role |
|------|------|
| `registry/pages.json` | Static pages, route families, and the declared source IDs they depend on |
| `registry/schema.mjs` | Pure validator and inventory builder, shared by the build and the gates |
| `inventory/pages.inventory.json` | Generated: every built route with its page ID, flags and sources |

### Static pages and families

A static page has one fixed `route`. A family covers a set of generated
routes with a `routePattern` (for example `/docs/{slug}/`), a regex per
parameter and an `idTemplate` that turns each member into a stable ID
(`docs.recovery.overview`; a `/` inside a value becomes `.`). A built route
must match exactly one static page or family.

### Fields

| Field | Values |
|-------|--------|
| `id` | Dotted lowercase, stable across URL changes: `home`, `docs.index`, `spec.v8.lifecycle` |
| `kind` | `landing`, `index`, `article`, `reference`, `tool`, `alias`, `debug`, `system`, `machine` |
| `owner` | `editorial`, `generated`, `mixed`, `interactive` |
| `maturity` | `placeholder`, `draft`, `experimental`, `preview`, `stable`, `deprecated` (families may say `per-entry`) |
| `audience` | `public`, `internal` (debug benches) |
| `nav` | `primary` (menu strip), `secondary` (More panel), `debug`, `none` |
| `localizable`, `searchable`, `llmVisible` | Booleans |
| `sourceIds` | Source IDs declared in `sources` (seed for M32) |

`searchable`, `llmVisible` and sitemap membership are checked against the
built `search-index.json`, `llms.txt` and `sitemap.xml` in both directions,
so a flag cannot claim something the site does not do.

## Commands

```bash
npm run build
npm run validate:registry     # schema, sources, built routes, flags, inventory, 14 red controls
npm run registry:inventory    # regenerate inventory/pages.inventory.json after a route change
```

## Adding a page

1. Add the Astro page.
2. Add a static entry to `registry/pages.json` (or rely on an existing family).
3. `npm run build && npm run registry:inventory && npm run validate:registry`.

A new docs page, blog post, scenario or spec topic needs only step 3: its
family already covers it.
