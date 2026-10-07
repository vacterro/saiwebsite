# Contributing to SAI_WEBSITE

Welcome! `saiwebsite` is the official public web surface for the [SAIPEN Protocol](https://github.com/saipenhq/.github). It is built as a static, local-first documentation portal and interactive reference using Astro, TypeScript, and the Wintage / Golden Default design system.

---

## 1. Local Bootstrap

Requirements:
- Node.js 22+
- npm 10+
- Python 3.10+ (for font and social card tools)

```bash
git clone https://github.com/vacterro/saiwebsite.git
cd saiwebsite
npm install
npm run dev      # Local development server at http://localhost:4321
npm run build    # Static build -> dist/
```

---

## 2. Visual Invariants (Wintage & SAIPEN UI Law)

This site adheres strictly to `WINTAGE_WEB_CONTRACT` and SAIPEN `UI.md`:

1. **No anti-aliasing on text.** Every face (`SAI Pixel 10/11/12/14/16`, `Spleen 6x12`) is rendered at its native integer pixel grid with zero smoothing.
2. **21-token color palette only.** No arbitrary hex codes, no gradients, no shadows, no blur, no opacity transitions.
3. **2px stepped bevels.** Raised and sunken states form the tactile geometry.
4. **All 16 Wintage themes supported.** Every layout and component must render flawlessly across all 16 palettes.
5. **No horizontal scroll.** The viewport target is 640×540 without horizontal overflow.

---

## 3. Generated Files (Do Not Edit by Hand)

Certain files are deterministically produced from canonical sources or scripts:

- `src/data/canonical/*.json` & `public/spec/v8/*.json`: Synchronized from canonical SAIPEN releases (`npm run canonical:sync`).
- `public/fonts/*`: Built from open sources (`DejaVu Sans 2.37`, `Spleen 6x12`) by `npm run fonts:build`.
- `public/social/card.png`: Rendered from open fonts and brand tokens by `npm run social:build`.
- `public/media/*`: Built from brand vectors by `npm run media:build`.
- `tests/baselines/MANIFEST.json`: Generated visual regression baseline hashes.

---

## 4. Verification and Quality Gates

Before opening a pull request, ensure all local verification gates pass:

```bash
npm run check               # Astro and TypeScript typecheck
npm run lint                # Wintage style-law lint (rejects hex literals, smoothing, unpaired fonts)
npm run validate:themes     # Validates all 16 theme packs against schema
npm run validate:canonical  # Validates canonical protocol snapshot hashes
npm run validate:content    # Verifies every internal link, anchor, and id
npm run validate:baselines  # Checks screenshot baselines against manifest
npm run validate:licenses   # Font provenance and redistribution license gate
npm run audit:build         # Checks HTML landmarks, headings, budgets, and themes in dist/
npm test                    # Full Playwright test suite (runtime, shell, content, pixel, visual)
```

---

## 5. Pull Requests

- Keep pull requests focused on a single change or fix.
- Do not check in build artifacts (`dist/`), temporary archives (`*.zip`), or editor noise.
- Ensure all quality gates exit 0.
- All contributions are governed by the project's license terms.
