SAI_WEBSITE

# WINTAGE WEB CONTRACT

Status: MANDATORY VISUAL AUTHORITY
Reference inspected: Wintage_07.10.26-T03-09-39.zip

---

# 1. DESIGN POSITION

SAI_WEBSITE is not a modern website wearing a retro skin.
It is a native Wintage web interface.

The desired visual language is late-1990s Windows desktop software discipline combined with modern documentation architecture.

Avoid the generic contemporary AI/SaaS visual vocabulary:

- rounded cards
- pill buttons
- glassmorphism
- backdrop blur
- ambient shadows
- floating translucent navigation
- gradient blobs
- large soft geometric headings
- spring animation
- decorative perpetual motion
- scale-on-hover controls

The retro language is the canonical product identity, not an optional nostalgia mode.

---

# 2. CANONICAL DEFAULT PALETTE

Default slug: `goldendefault`
Display label: `Golden Default`

The supplied Wintage source declares Golden Default as its default theme.
SAI_WEBSITE must preserve that unless the user explicitly selects another palette.

Canonical Golden Default tokens from the supplied theme pack:

```text
background       #1A1810
backgroundSoft   #232018
surface          #332E22
surfaceRaised    #3D372A
surfaceAlt       #453D30
borderDark       #100E08
borderHighlight  #F0D060
bevelLight       #75663D
borderMuted      #5A5040
textPrimary      #D4C89A
textSecondary    #9C9371
textMuted        #6E674E
accentTeal       #008080
accentTealDeep   #004C4C
success          #4A7A20
warning          #7A7A20
danger           #7A2020
dangerText       #D66464
selection        #3D372A
compareBack      #14120C
link             #F0D060
```

Do not manually brighten or soften these values per component.
Use semantic aliases that reference canonical tokens.

---

# 3. COMPLETE PALETTE SET

The supplied Wintage snapshot contains 16 theme packs:

1. `golden` — Dark Golden (Win95)
2. `claudecode` — Claude Code
3. `antigravity` — Antigravity
4. `klite` — K-Lite (MPC-HC)
5. `freebuff` — FreeBuff
6. `codenomad` — CodeNomad
7. `fpdefault` — Default
8. `goldenvintage` — Golden Vintage
9. `goldendefault` — Golden Default
10. `vintagedark` — Vintage Dark
11. `vintageclassic` — Vintage Classic
12. `oled` — Dark 2 (OLED)
13. `dracula` — Dracula
14. `nord` — Nord
15. `solarized` — Solarized Dark
16. `custom` — Custom

Golden Default remains first-run/canonical SAIPEN identity.
The others are user-selectable alternatives.

---

# 4. THEME SCHEMA

Every theme must implement exactly these 21 tokens:

```text
background
backgroundSoft
surface
surfaceRaised
surfaceAlt
borderDark
borderHighlight
bevelLight
borderMuted
textPrimary
textSecondary
textMuted
accentTeal
accentTealDeep
success
warning
danger
dangerText
selection
compareBack
link
```

Theme validation must reject:

- missing tokens
- unknown tokens
- invalid color formats
- duplicate slugs
- duplicate labels where ambiguity would result

Website-only semantic aliases should point to these values rather than duplicate hex literals.

---

# 5. THEME STORAGE

Preferred shape:

```text
src/themes/
  schema.ts
  index.ts
  packs/
    golden.json
    claudecode.json
    antigravity.json
    klite.json
    freebuff.json
    codenomad.json
    fpdefault.json
    goldenvintage.json
    goldendefault.json
    vintagedark.json
    vintageclassic.json
    oled.json
    dracula.json
    nord.json
    solarized.json
    custom.json
```

Long-term preference is generation or synchronization from canonical Wintage sources where practical, not permanent manual divergence.

---

# 6. FIRST PAINT / THEME PERSISTENCE

Requirements:

- Golden Default if no preference exists
- local persistence without login
- unknown/removed theme safely falls back to Golden Default
- no white flash
- no generic framework flash
- theme applied before visible content when practical

Do not let OS light/dark preference silently override Golden Default.
System preference may become an explicit option later.

---

# 7. PIXEL LAW

Target identity:

PIXEL / HARD EDGE / INTEGER / NO DECORATIVE AA

Prefer:

- integer pixel sizes
- integer border widths
- integer translations
- pixel-aligned separators
- native-size or integer-scaled raster assets
- hard rectangular geometry

Avoid where controllable:

- 0.5px borders
- fractional transforms
- fractional raster scaling
- soft masks
- blur
- decorative gradients
- opacity-based fake depth

Responsive layout may create fractional browser geometry internally.
The project should avoid introducing fractional transforms or raster scaling deliberately.

---

# 8. NO-AA REALITY CONTRACT

Absolute zero anti-aliasing for normal DOM text cannot be guaranteed across browser engines, DirectWrite/CoreText, GPU pipelines, devicePixelRatio, browser zoom, and OS scaling.

Best-effort CSS hints may include:

```text
-webkit-font-smoothing: none
-moz-osx-font-smoothing: unset
font-smooth: never
text-rendering: optimizeSpeed
```

These hints are not proof of literal 1-bit glyph rendering.

SAI_WEBSITE therefore defines two rendering classes.

## Class A — Hard Pixel

Fully controlled artwork:

- logos
- icons
- arrows
- separators
- protocol-state symbols
- decorative labels
- toolbar graphics
- hero artwork
- bitmap counters

Rules:

- nearest-neighbor scaling
- no interpolation
- no fractional scale
- no blur
- hard alpha edges where intended

## Class B — Semantic Document Text

Used for:

- docs
- long prose
- navigation
- form labels
- code explanations
- accessibility content

Rules:

- semantic DOM text
- Wintage font stack
- fixed pixel size ladder
- no transform scaling
- no text shadow
- no opacity tricks
- best-effort smoothing suppression only

Never convert long technical documentation into Canvas solely to force pixel glyph edges.

---

# 9. OPTIONAL STRICT BITMAP TEXT ENGINE

Future Gate: `STRICT_PIXEL_TEXT`.

Potential use:

- SAIPEN hero wordmark
- compact status displays
- protocol visualizer labels
- decorative terminal panels
- benchmark counters

Potential implementation:

- bitmap glyph atlas
- Canvas 2D
- `imageSmoothingEnabled = false`
- integer destination coordinates
- integer scale

or pre-rendered bitmap sprites with semantic accessible text preserved.

Do not use it for long-form docs.

---

# 10. TYPOGRAPHY

Wintage source uses a Verdana-first stack:

```text
Verdana_m1, Verdana, Tahoma, "MS Sans Serif", sans-serif
```

SAI_WEBSITE may reference locally installed `Verdana_m1` by name, but must not redistribute a bundled font file unless distribution rights are explicitly verified.

The website must render correctly without Verdana_m1.

Recommended core size ladder aligned with Wintage behavior:

- 10px auxiliary metadata
- 11px compact controls
- 12px normal body/UI
- 14px section heading
- 16px major page title

Avoid defaulting to 48–96px marketing headlines.
Hierarchy should come from framing, borders, spacing, title bars, and layout.

Primary weights:

- 400
- 700

---

# 11. ZERO RADIUS

Global law:

```text
border-radius: 0
```

Applies to:

- buttons
- cards
- dialogs
- inputs
- menus
- code blocks
- tooltips
- badges
- pricing panels
- search
- mobile navigation
- tables

No pills.
No fashionable rounded rectangles.

---

# 12. ZERO SHADOW / ZERO BLUR

Forbidden as a visual depth mechanism:

- box-shadow
- text-shadow
- drop-shadow
- backdrop blur
- glass effects
- glow
- soft elevation

Depth is expressed through palette surfaces and 2px bevel borders.

---

# 13. 2PX BEVEL LAW

The inspected Wintage source explicitly encodes 2px pure-border bevels.

Raised control:

```text
top    = bevelLight
right  = borderDark
bottom = borderDark
left   = bevelLight
```

Sunken control:

```text
top    = borderDark
right  = bevelLight
bottom = bevelLight
left   = borderDark
```

Important distinction:

`bevelLight` is the structural bright edge.
`borderHighlight` is not a universal replacement for it.

Do not fake a second bevel row using inset box-shadow.

---

# 14. MOTION

Default interaction behavior is instant.

Do not animate ordinary:

- button hover
- card hover
- navigation hover
- theme switching
- focus
- panel elevation
- borders
- icons

Where JavaScript lifecycle behavior requires a transition-end event, use the smallest safe technical duration rather than decorative easing.
The Wintage source uses a near-zero transition duration for compatibility cases.

Intentional demos may animate because the animation is content, not decoration.
Respect reduced-motion preference.

---

# 15. CONTROLS

## Buttons

Normal:

- raised bevel
- `surfaceRaised`
- `textPrimary`

Hover:

- `surfaceAlt`
- no scale
- no glow

Active:

- sunken bevel
- optional integer 1px content translation

Disabled:

- geometry remains clear
- text uses muted role
- no opacity-only disappearance

## Inputs

Use sunken panel language.
Caret and selection remain visible.
Focus must use hard outline/border, not shadow.

## Checkboxes / radios

Prefer custom pixel-consistent controls only if accessibility semantics remain intact.
Native inputs with Wintage wrappers are acceptable during early milestones.

---

# 16. WINDOW / PANEL LANGUAGE

The site may use classic application-window grammar:

- title bar
- menu bar
- toolbar
- content pane
- status bar

Do not create decorative fake controls that look functional but do nothing.

The website must remain ordinary web navigation underneath:

- real URLs
- Back/Forward
- deep links
- open in new tab
- copy link
- browser find

---

# 17. DOCS LAYOUT

Desktop docs may resemble a classic technical application:

```text
+----------------------+-------------------------------------------+
| CONTENTS             | SAIPEN / Recovery / Provider Failure     |
|----------------------|-------------------------------------------|
| Getting Started      |                                           |
| Concepts             |  Provider Failure                         |
| Protocol             |                                           |
| Recovery             |  Technical documentation...               |
| Evidence             |                                           |
| CLI                  |  [ sunken code block ]                    |
| Reference            |                                           |
+----------------------+-------------------------------------------+
| READY                | v1 | Golden Default                       |
+------------------------------------------------------------------+
```

Do not make it a literal fake OS if that harms mobile or accessibility.

---

# 18. CODE BLOCKS

Appearance:

- 0 radius
- 2px sunken bevel
- hard background
- monospace font
- crisp syntax colors
- selection visible
- normal Wintage copy button

No floating translucent copy bubble.

---

# 19. LINKS

Golden Default link token is `#F0D060`.

Prose links should be unmistakably links.
Use underline or an equally clear classic treatment.
Hover and focus should not depend solely on hue changes.

---

# 20. FOCUS / KEYBOARD

Focus indication is mandatory.

Use:

- hard outline
- pixel-aligned border
- high contrast

Never remove focus simply to preserve visual minimalism.
No shadow focus rings are required.

---

# 21. ICON SYSTEM

Preferred native icon grids:

- 16x16
- 24x24
- 32x32

Potential future icons:

- home
- docs
- spec
- protocol
- agent
- recovery
- evidence
- verify
- warning
- error
- success
- GitHub
- download
- cloud
- terminal
- theme
- search

Avoid generic modern outline-icon libraries as the visual identity.
Temporary icons are acceptable during bootstrap if clearly replaceable.

---

# 22. LOGO ASSETS

Plan separate native assets:

- SAIPEN wordmark
- compact icon
- 16x16 favicon
- 32x32 favicon
- 48x48 or 64x64 desktop-style icon
- social preview mark

No glow.
No gradient dependency.
No resampling a tiny favicon into a large logo.

---

# 23. RASTER SCALING

For deliberate pixel art:

- use nearest-neighbor
- prefer integer scaling 1x, 2x, 3x, 4x
- preserve original source asset
- avoid repeated PNG resizes
- avoid CSS transform scale

`image-rendering: pixelated` may be used where appropriate.

---

# 24. RESPONSIVE DESIGN

Responsive behavior changes structure, not identity.

Desktop:

- multi-pane layouts where useful

Tablet:

- fewer simultaneous panes

Mobile:

- stacked panels
- compact menu

All retain:

- square geometry
- 2px bevels
- Wintage palette
- typography
- hard focus
- pixel icons
- instant interaction

---

# 25. DEBUG SURFACES

## `/debug/components`

Render every UI primitive in one place.

## `/debug/themes`

Render the same primitives across all palettes or allow rapid theme switching.

## `/debug/rendering`

Potential diagnostics:

- CSS viewport
- devicePixelRatio
- active theme
- browser zoom hints where available
- integer grid sample
- bevel sample
- raster scale sample
- font rendering sample

Do not block normal users based on zoom or DPI.

---

# 26. VISUAL REGRESSION

Canonical first baseline:

- Chromium-family browser
- 100% browser zoom reference
- Golden Default

Capture:

- homepage
- docs
- spec
- ecosystem
- pricing placeholder
- component lab
- theme lab

Then add reduced cross-theme coverage.

Do not claim device-pixel identity across every OS scaling mode.

---

# 27. STYLE LINT FUTURE GATE

Later enforce obvious violations automatically.

Candidates:

- non-zero border-radius
- non-none box-shadow
- non-none text-shadow
- backdrop-filter
- blur filters
- decorative long transitions
- accidental transform scaling on pixel assets

Exceptions must be explicit and documented.

Do not build an overly complex CSS parser during bootstrap.

---

# 28. FINAL DESIGN LAW

When there is a choice between generic modern prettiness and Wintage consistency, choose Wintage.

When there is a choice between retro-looking decoration and actual pixel discipline, choose pixel discipline.

When pixel theatre would break accessibility, copy/paste, browser semantics, or technical documentation usability, preserve usability and document the limitation.

The site should look like it came from the late 1990s.
It should be engineered like a serious modern technical product.
