# SAI_WEBSITE

The public web surface of the SAIPEN protocol: documentation, a specification
reference generated from the canonical registry, the ecosystem catalogue, a
compatibility matrix, a deterministic playground and the trust pages.

Static, local-first, no backend, no accounts, no cookies, no third-party
requests. The visual identity is **Wintage / Golden Default** and SAIPEN's own
`UI.md`, rendered without anti-aliasing and proven pixel by pixel.

**Status: site v1.2.0, local build.** Milestones M0–M25 of the master roadmap
are delivered; M26–M30 (domain, hosting, monitoring, analytics, i18n, launch)
wait behind their future gates. The live list is the `/status/` page.
`BOOTSTRAP_REPORT.md` is the report of the first slice and is kept as history.

---

## Commands

```text
npm install
npm run dev                 # dev server
npm run build               # static production build -> dist/
npm run preview             # serve the production build on :4321

npm run check               # Astro + TypeScript
npm run lint                # style law (radius, shadow, blur, opacity, motion, hex, em units, size without face)
npm run validate:themes     # 16 packs x 21 tokens
npm run validate:canonical  # protocol snapshot hashes (+ drift vs SAIPEN_SRC checkout)
npm run validate:content    # internal links, anchors, duplicate ids, alt, meta   (after build)
npm run validate:baselines  # all 33 screenshot baselines present and matching tests/baselines/MANIFEST.json
npm run audit:build         # structure, theme contract, routes, budget, protocol data (after build)

npm run test:pixel          # every pixel of every page is a palette token — Chromium + WebKit
npm run test:shell          # routes, maturity badges, navigation, breadcrumbs, overflow, landmarks
npm run test:content        # docs chrome, spec visualizer + aliases, playground, search, agent files
npm run test:runtime        # theme persistence, pre-paint restore, fallback, nested scopes
npm run test:visual         # zero-tolerance screenshot baselines (33)
npm run test:visual:update  # refresh baselines after an intentional visual change
npm test                    # every browser suite

npm run canonical:sync      # SAIPEN_REF=main (GitHub) or SAIPEN_SRC=<checkout>: refresh the protocol snapshot
npm run fonts:build         # regenerate the pixel faces (Python + fontTools + brotli; needs _src_unpack/)
npm run fonts:build:open    # open-licence candidate faces from DejaVu Sans -> public/fonts-open/ (compare at /debug/fonts/)
```

Browser suites drive real browsers against `npm run preview`, so build first.
One-time setup: `npx playwright install chromium webkit`. Every gate was shown
able to fail on a deliberate bad input before it was trusted.

---

## Where the content comes from

The site never re-types protocol facts. Authority runs one way:
canonical SAIPEN source → generated reference → explanatory docs → summaries.

| Surface | Source |
|---|---|
| `/spec/v8/…`, `/compatibility/`, `/spec/v8/*.json` | `src/data/canonical/` — byte-exact snapshot of `saipen/REGISTRY.json`, `extensions/schemas/state.schema.json` and `extensions/adapters/registry.json` from GitHub `vacterro/saipen`, with commit and SHA-256 in `meta.json` |
| `/docs/…` | `src/content/docs/` — prose written against SPEC.md, CORE.md, MAINTENANCE.md, README, GUIDE, SECURITY; every page lists its sources, linked at the snapshot commit |
| `/ecosystem/`, `/downloads/` | `src/data/ecosystem.ts` — membership from the SAIPEN HQ project map, relations from each README, releases and SHA-256 digests from GitHub (snapshot 2026-10-07) |
| `/playground/…` | `src/data/scenarios.ts` — scripted states; every phase change is checked against `valid_transitions` by `audit:build` |
| `/status/` | `src/data/milestones.ts` — each "delivered" milestone must point at a page that exists |
| `/about/#dogfooding` | this repository's own `.saipen/BOARD.md`, `STATE.md` and `LOG.md`, read at build time; last full verification in `src/data/verification.ts` |
| `/about/` author text | the author's public GitHub profile, SAIPEN README and GUIDE — no biography or location beyond them |

## Layout

```text
src/
  content/docs/         26 documentation pages (7 sections), schema in content.config.ts
  content/blog/         design notes
  content/changelog/    website release records
  data/
    site.ts             route registry: label, intent, maturity, menu placement
    canonical/          protocol snapshot + meta.json (do not edit by hand)
    ecosystem.ts        SAIPEN ecosystem catalogue
    phases.ts           one sentence per phase (checked against the registry)
    scenarios.ts        playground scripts
    milestones.ts       roadmap status
  lib/
    canonical.ts        typed access to the snapshot, sourceUrl() pinned to the commit
    docs.ts             ordering, tree, previous/next
    spec.ts             spec topics
    rehype-wintage.mjs  heading anchors, callouts, table wrappers, code frames
  layouts/              SiteLayout (shell, meta, OG), DocsLayout, SpecLayout
  components/           Wintage primitives, DocsTree, ScenarioPlayer, AliasPage, ...
  pages/                routes; docs/[...slug] (+ .md twin), spec/[version]/*, playground/[scenario],
                        blog/[slug], search, llms.txt, llms-full.txt, sitemap.xml, search-index.json, 404
  styles/
    fonts.css           the pixel faces
    tokens.css          structural law, type roles, bevel layers, pixel glyph masks (no hex)
    wintage.css         global law: typography, focus, bullets, markers, scrollbars
    site.css            primitives and page layouts
  themes/               21-token contract, 16 canonical packs, runtime
scripts/
  fonts/build_pixel_fonts.py   Verdana_m1 strikes + Spleen BDF -> pixel-grid WOFF2
  social/make_card.py          1-bit social card, 3x nearest-neighbour
  sync-canonical.mjs / validate-canonical.mjs / validate-content.mjs / lint-styles.mjs
  audit-build.mjs / validate-themes.mjs / route-registry.mjs
tests/                         pixel-perfect, site-shell, content-features, theme-runtime, visual-baseline
public/fonts/                  generated faces + manifest.json + Spleen licence
```

---

## Visual law and how it is enforced

From `WINTAGE_WEB_CONTRACT` and SAIPEN `UI.md`:

- **No anti-aliasing.** CSS cannot turn smoothing off, so each ladder size
  (10/11/12/14/16 px) has its own pixel-grid face: the 1-bit Verdana bitmap for
  that size drawn as whole-pixel squares at units-per-em = 128 × size, plus the
  same bitmaps as an embedded EBDT strike and a no-smoothing `gasp` table. Bold
  is 1 px overstrike, italic a whole-pixel shear; `font-synthesis: none`. Code
  uses Spleen 6x12 (BSD-2). Size, face and an even-leading integer line height
  always travel together (`--size-*`, `--face-*`, `--lh-*`); the lint rejects a
  size without its face.
- **Every edge on the pixel grid.** Bevels are six solid background layers
  with Win95 stepped corners (a two-colour border miter is smoothed), bullets
  and disclosure markers are pixel squares and arrow masks, link underlines are
  1 px borders, tables use separate borders, coloured bars are background
  layers, layouts use fixed integer tracks where text starts.
- **Zero radius, shadow, blur, transparency, motion.** One sanctioned movement:
  `button:active`'s 1 px shift.
- **Colour only from the 21 tokens.** `src/styles/` holds no hex literal.
- **Proof is pixels.** `npm run test:pixel` screenshots every built page in
  Chromium and WebKit (1280 px, five pages at 390 px, all 16 palettes at
  640×540) and fails on any pixel outside the active palette. Controls: an
  anti-aliased circle and sub-pixel-shifted text must be detected.

---

## Deviations from the supplied roadmap

1. **No Starlight.** It would bring its own appearance; the docs shell is
   written directly (content collections, tree, TOC, anchors, previous/next,
   search are all native here).
2. **No syntax highlighter.** A highlighter emits inline colours outside the
   palette; code is token-coloured monospace in a sunken frame.
3. **Code font.** The contract asks for monospace code; UI.md asks for no AA.
   Both hold: Spleen 6x12 is a bitmap monospace face.
4. **Theme switching lives in one file** (`src/themes/runtime.ts`): a plain
   `<select>`, no framework, no-JS visitors stay on Golden Default.
5. **Disclosures instead of scripted menus** for More, compact navigation, the
   docs tree on narrow screens and the on-page TOC.
6. **Headings at weight 400**, as Wintage renders them; hierarchy comes from
   the size ladder and framing. Buttons and table headers use the bold face.
7. **`/search/`, `/compatibility/`** are added routes (M11, M13).

## Known limitations

- **Font licence — publication blocker.** The UI faces and the social card are
  derived from Microsoft Verdana embedded bitmaps (`Verdana_m1`). Redistribution
  rights are not verified. Before FG-001 (public hosting) one of three paths is
  needed: verify the licence; switch to the open candidate (`SAI Pixel Open`,
  DejaVu Sans rasterized, Bitstream Vera licence — compare at `/debug/fonts/`;
  switching is a `fonts.css` change); or draw a clean-room Wintage Pixel Sans.
  Spleen is BSD-2 and clear.
- **No-AA holds at 100 % zoom and integer device scales.** Fractional zoom and
  OS scaling resample everything; no web page can prevent that.
- Glyph coverage: Latin, Latin-1, Latin Extended-A, Cyrillic, common
  punctuation, arrows and box drawing. Other scripts fall back to Verdana.
- The local test host has system font smoothing off, so Chromium draws all
  text aliased there; WebKit always smooths and is the engine that proves the
  faces. ClearType behaviour on other machines rests on the embedded strike.
- Ecosystem and release facts are a dated snapshot (2026-10-07); refresh by
  hand. The protocol snapshot refreshes with `npm run canonical:sync`.
- Not deployed. No domain, no hosting, no analytics, no translations — each
  waits behind its future gate.
