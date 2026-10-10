# Script extension contract

The shipped proportional pixel faces cover the ET/RU pilot. The composite
SAI Pixel Mono 12 remains the code face; its primary Spleen and approved
DejaVu supplement, source hashes, licence notices and negative controls stay
unchanged. `font-coverage.json` describes actual assets, not intended support.

`locale-expansion.proposed.json` is a proposal, not an approved production
selection. `npm run i18n:scale` measures its samples and script requirements.
An uncovered sample is BLOCKED_FOR_FONT. A covered sample still requires
complete translated-string coverage and the browser glyph control.

Optional modules use the existing font build/manifest/coverage pipeline. Each
module must provide the following reviewable inputs before a locale can use it:

1. Immutable upstream source URL, version, SHA-256, licence text and embedding
   permission; retain the font copyright and any reserved-name conditions.
2. Script, Unicode ranges, direction, required combining characters and a
   corpus of the actual translated strings. A font family name is not proof.
3. A deterministic build recipe producing original bitmap strikes at every
   required typography size/weight. Browser scaling of a 16px strike to 12px
   does not satisfy the native-size contract. Export reproducible WOFF2 with
   the existing no-grayscale policy, cmap and manifest hashes.
4. Explicit per-face and aggregate payload budgets. The existing per-face
   20kB and aggregate 200kB gates remain authoritative. Large scripts require
   a reviewed budget/module contract and deterministic Unicode subsets;
   there is no automatic exemption. Load only the declared script module,
   once per page; shared assets are not copied per language.
5. Static cmap/coverage controls, missing-glyph rejection, native-size pairing
   and palette-closure screenshots in Chromium and WebKit, with the existing
   negative controls. Approved modules extend the coverage data; they do not
   remove or replace the gate.

GNU Unifont is an investigation candidate for Greek/CJK bitmap sources. Its
[official documentation](https://unifoundry.com/unifont/index.html) describes
8/16 by 16 pixel glyphs and OFL/GPL licensing choices. It also documents complex
Arabic/Indic shaping limitations. It is not shipped, approved, or claimed to
satisfy this site's size, shaping or visual requirements. Hebrew, Arabic,
Devanagari and Thai need a suitable reviewed shaping/bitmap pipeline; CJK and
Hangul need measured subset budgets. Latin and Cyrillic extensions also need
new glyphs for some proposed languages (see the generated matrix).

RTL is a reading-direction policy, not a transform. The document uses the
locale's `dir`; navigation follows logical reading order, table/button labels
align to `start`, and code, commands, URLs and digests remain isolated LTR.
Bevel lighting and brand artwork are not mirrored. RTL layout controls use a
private Latin fixture until a real script module exists; this does not prove
Arabic/Hebrew production readiness.

Rollout: approve the production language set; complete and independently review
the ET/RU pilot; add only font-covered languages in bounded cohorts; review
font modules for the selected remaining scripts; publish a locale only after
unit, metadata, discovery, glyph, layout and pixel gates pass. Deprecation
disables routes and retains translation work for deliberate cleanup.
