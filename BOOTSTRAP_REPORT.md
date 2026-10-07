# SAI_WEBSITE — Bootstrap Corridor Report (T-1)

Phase: DONE. Ticket T-1 closed `own_patch` after VERIFY/REVIEW green.
Publish skipped: no git repository, no remote; hosting is deferred by `FUTURE_GATES` FG-001.

## 1. Implementation summary

A local, static, backend-free Astro 5 + TypeScript project that renders SAI_WEBSITE in
the canonical Wintage visual language. Colour and structure both come from the supplied
Wintage source, never from screenshots or approximation:

- All 16 theme packs copied byte-for-byte from `_src_unpack/wintage/themes/*.json`
  (verified with `diff -q`; 16/16 identical).
- The 21-token contract, display order and pack identity rules are owned by
  `src/themes/schema.ts` and re-implemented from `wintage/tools/theme-schema.js`
  (slug regex, filename == slug, unique label, no apostrophe, 6-digit hex, no unknown
  tokens, order then slug).
- Golden Default is the default theme by slug, not by preference: the `:root` block in
  every built page carries its 21 values, which match `goldendefault.json` exactly, and
  `<html>` carries `data-theme="goldendefault"` plus the pack's background/text colour
  inline, so the first paint is already Wintage with no JavaScript and no flash.
- Structural law lives once in `src/styles/wintage.css`: zero radius, no shadow, no text
  shadow, no backdrop blur, instant interaction, hard-edged focus, the 10/11/12/14/16px
  ladder. Depth is only ever the two 2px bevel patterns (raised / sunken), built from
  `bevelLight` and `borderDark`.
- `src/styles/tokens.css` holds zero hex literals. Semantic aliases are declared on `*`
  rather than `:root` on purpose: a `var()` inside a custom property is substituted where
  the property is *declared*, so root-scoped aliases would freeze Golden Default's colours
  and break the nested `[data-theme]` scopes the theme bench needs.

## 2. Project root

`V:\___VAC\__K\__CODE\_HTML\_SAI_WEBSITE`

## 3. Important files created

| Path | Role |
|---|---|
| `package.json`, `astro.config.mjs`, `tsconfig.json` | project; `output: 'static'`, `build.format: 'directory'` |
| `src/themes/schema.ts` | the 21-token contract + pack validator (owner) |
| `src/themes/index.ts` | registry: load, validate, order, emit `:root` + 16 `[data-theme]` blocks |
| `src/themes/packs/*.json` | 16 canonical packs, verbatim |
| `src/styles/tokens.css` | structural law + semantic aliases (no hex literals) |
| `src/styles/wintage.css` | global laws: radius, shadow, blur, motion, typography, focus |
| `src/styles/site.css` | primitives: bevels, window, buttons, fields, badges, table, docs grid |
| `src/components/*.astro` | WintageWindow, WintagePanel, WintageButton, WintageMenuBar, WintageStatusBar, MaturityBadge, PlaceholderPage |
| `src/layouts/SiteLayout.astro` | the shell + inline palette CSS in `<head>` |
| `src/layouts/DocsLayout.astro` | contents tree + reading column |
| `src/data/site.ts` | route registry with per-route intent and maturity |
| `src/pages/**` | the 8 routes |
| `scripts/validate-themes.mjs` | theme gate (`npm run validate:themes`) |
| `scripts/audit-build.mjs` | structural audit of `dist/` (`npm run audit:build`) |
| `public/favicon.svg`, `public/robots.txt` | 16×16 crisp-edge mark, minimal robots |
| `README.md` | commands, layout, visual laws, canonical palette, deviations, limitations |

## 4. Validation commands and results

| Command | Result |
|---|---|
| `npm install` | 355 packages, exit 0 (three postinstall scripts blocked by policy, non-fatal) |
| `npm run dev` | serves all 8 routes HTTP 200 |
| `npm run build` | exit 0, `8 page(s) built`, fully static `dist/` |
| `npm run preview` | serves all 8 routes HTTP 200 |
| `npm run check` | 0 errors, 0 warnings, 0 hints (24 files) |
| `npm run validate:themes` | exit 0, 16 packs in canonical order `golden=1 … goldendefault=22 … custom=99` |
| `npm run audit:build` | exit 0, `OK: 8 pages, no structural problems` |
| internal link audit | 10 distinct internal hrefs, 0 dead |
| pack drift | 16/16 byte-identical to the Wintage source archive |
| token drift | built `:root` = `goldendefault.json`, 21/21 exact; 16 blocks × 21 tokens |
| browser check (Chromium 1280×720, live preview) | `.w-raised` = 2px `#75663D`/`#100E08`, `.w-sunken` inverted, radius 0, shadow none, text-shadow none, transition 0s; 374-element scan = 0 radius / 0 shadow / 0 text-shadow / 0 gradient violations; both resources 200; 16 theme cards resolve their own tokens, 0 cross-theme leaks |

Instrument controls (VERIFY-ORACLE-01) for the two new gates:

- `audit:build` red control: reverted `PlaceholderPage` `h1` → `h2`, rebuilt, gate exit 1
  with `expected exactly 1 h1, found 0`; restored, green again.
- theme gates red control: added a pack missing the `link` token;
  `validate:themes` exit 1 (`zzzbad.json: missing token link`) **and** `npm run build`
  exit 1 on the same pack; removed, green again.

Not verifiable in this environment: the keyboard `:focus-visible` ring could not be
triggered (synthetic key events are not trusted by the renderer), so it was verified by
inspecting the rule (`outline: 2px solid var(--ui-accent); outline-offset: 1px`) instead.
No screenshot was judged visually — the session model cannot read images.

## 5. Deviations from the supplied roadmap, and why

1. **No Starlight, no content collections.** A component library would bring its own
   visual defaults to fight; the contract needs the opposite. Markdown/MDX stays open for
   the documentation milestone.
2. **Monospace for code blocks** (contract §18) overrides the userscript's
   Verdana-everywhere rule, which cannot express a code block.
3. **Theme switching is not implemented.** §6's requirements (persistence, pre-paint
   restore, safe fallback) are milestone M3; the bootstrap satisfies "Golden Default, no
   flash" without destabilising the slice. All 16 packs are loaded, validated and rendered
   on `/debug/themes`, so M3 has only the switcher to add.
4. **`Verdana_m1` is referenced by name only.** No font file is copied — distribution
   rights are unverified. The site renders correctly without it.
5. **No `VERSION` / `CHANGELOG` files.** `package.json` is the single version source and
   the shell status strip renders it. Release metadata belongs to the publication gate.
6. **Three defects fixed after the first green build** (found by the new audit, not by a
   failing framework check): five routes had no `h1`; the homepage `<title>` repeated the
   project name; maturity badges rendered lowercase instead of the roadmap's
   `PLACEHOLDER` / `DRAFT` / `PLANNED` vocabulary.
7. **No continuation archive was produced.** The project is already the deliverable on
   disk and the two supplied source archives are still present, so a 44 MB zip would be a
   duplicate that goes stale on the first edit. `npm install` reproduces the tree from
   `package.json` + `package-lock.json`.

## 6. Known limitations

- No-AA is best-effort CSS hints only (contract §8), never a guarantee; no bitmap text
  renderer was introduced.
- `/debug/rendering` does not exist yet (contract §25 lists it; M3/M4 material).
- No 404 page, sitemap, `llms.txt`, OG image or canonical URLs — those depend on the
  domain decision (FG-001).
- No visual-regression baselines (contract §26); no style-lint gate (§27).
- Mobile navigation is a wrapped menu strip, not a disclosure; the docs contents tree
  collapses below 820px.
- The docs contents tree is inert text on purpose: those pages do not exist, and a dead
  link would misrepresent what is published.

## 7. Recommended next narrow target

**M3 — the full 16-theme system** (ticket `T-2`): switcher over the 16 validated packs,
local persistence without login, theme applied before visible content, unknown or removed
slug falling back to Golden Default, no white flash, and theme regression gates — then
`/debug/rendering` and the first visual baselines. `T-2` is on the board as TODO and is the
top workable ticket; it was deliberately not started in this run.
