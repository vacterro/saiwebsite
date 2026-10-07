# Third-party notices

Assets and code that the built website redistributes, with their licences.
Development-only tools (Playwright, TypeScript, fontTools, Pillow, the Astro
compiler) are not shipped in `dist/` and are covered by their own package
metadata.

`npm run validate:licenses` checks the font and social-card entries below
against the shipped files.

## Fonts

| Shipped file(s) | Derived from | Licence | Notice shipped as |
|---|---|---|---|
| `fonts/sai-pixel-{10,11,12,14,16}-{regular,bold}.woff2`, `fonts/sai-pixel-12-italic.woff2` | DejaVu Sans 2.37 Regular and Bold (Bitstream Vera derivative), rasterized to 1-bit pixel outlines by `scripts/fonts/build_pixel_fonts.py` | Bitstream Vera / DejaVu font licence — modification and redistribution permitted; derivatives must not use the names Bitstream, Vera or DejaVu (the faces are named "SAI Pixel") | `fonts/LICENSE-dejavu.txt` |
| `fonts/sai-pixel-mono-12-regular.woff2` | Spleen 6x12 2.2.0 by Frederic Cambus (primary design; every glyph it draws wins) plus DejaVu Sans Mono 2.37 (Bitstream Vera derivative) for the code points Spleen does not map, rasterized onto the same 6x12 grid by `scripts/fonts/build_pixel_fonts.py` | BSD 2-Clause for the primary; Bitstream Vera / DejaVu font licence for the supplement | `fonts/LICENSE-spleen.txt`, `fonts/LICENSE-dejavu.txt` |

Source files: `scripts/fonts/src/` (pinned by SHA-256 in `scripts/fonts/sources.json`).

## Images

| Shipped file | Made with | Licence |
|---|---|---|
| `social/card.png` | `scripts/social/make_card.py`, DejaVu Sans 2.37 (see above); provenance in `social/MANIFEST.json` | Same as this website; font licence as above |

## Data and design

| Material | Source | Licence |
|---|---|---|
| `src/data/canonical/*.json`, served as `spec/v8/*.json` | SAIPEN repository, github.com/vacterro/saipen | MIT, © vacterro |
| 16 palettes in `src/themes/packs/` | Wintage, github.com/vacterro/Wintage | MIT, © vacterro |

## Framework

| Component | Licence |
|---|---|
| Astro 5 (static site generator; build output only) | MIT, © Fred K. Schott and contributors |
