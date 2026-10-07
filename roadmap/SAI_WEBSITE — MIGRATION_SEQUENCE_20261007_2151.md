# SAI_WEBSITE — Migration Sequence

## Purpose

Migrate without breaking the current v1.3.x working site.

## Rule

No big-bang rewrite.

At every milestone, the production site must remain buildable and testable.

## Phase 1 — Inventory only

Map current owners:

- routes
- data modules
- generated data
- docs content
- support
- ecosystem
- compatibility
- downloads
- canonical protocol snapshot
- Wintage themes
- search
- llms outputs

Do not move files yet.

Output one machine-readable inventory.

## Phase 2 — Registry adapter

Create content-engine registry that can reference existing pages in place.

No URL changes.

No content rewrite.

Existing `src/data/site.ts` may remain the public route implementation while registry becomes the normalized authority or vice versa, but there must be one clear ownership direction.

## Phase 3 — Source descriptors

Register current canonical/snapshot sources.

Wrap existing sync scripts rather than replacing them if they already work:

- canonical protocol sync
- ecosystem sync
- font/theme sources
- support authority

## Phase 4 — Source lock

Record current known-good source identities/hashes.

Do not force network refresh during normal build.

## Phase 5 — Impact graph

Initially map only a few high-value domains:

- protocol/spec
- ecosystem/downloads
- support/pricing
- Wintage/themes

Prove graph correctness before covering every page.

## Phase 6 — Site doctor

Read-only first.

Do not implement mutation in the first pass.

## Phase 7 — Site sync

Wrap current sync commands into source-registry-aware flow.

Keep existing specific commands for compatibility until new flow is proven.

## Phase 8 — Block IDs for shell/UI

Start with small stable UI strings and one docs section.

Do not convert all long-form docs immediately.

## Phase 9 — i18n kernel

No translations yet beyond canonical English.

Prove locale routing/fallback using synthetic or tiny pilot content.

## Phase 10 — EN/ET/RU pilot

Translate bounded surfaces.

Measure actual maintenance burden.

## Phase 11 — Expand generated/static integration

Search, llms, sitemap and metadata become locale/source-aware.

## Phase 12 — 10-language stress test

Only if prior phases are stable.

## Phase 13 — 33-language expansion

Only after build/test/agent workflows remain manageable.

## Regression risks to watch

- duplicate route authorities
- hidden content strings inside Astro components
- generated files accidentally becoming editable authorities
- source sync requiring network for build
- translation stale state ignored at publish time
- fallback content being indexed as if truly translated
- giant locale files causing merge conflicts
- locale-specific conditional code proliferation
- theme/pixel tests exploding combinatorially
- CI duration growing 33× unnecessarily

## CI strategy

Do not immediately run every visual page in every locale/theme combination.

Use layered gates:

1. structural checks across all locales
2. glyph/overflow representative matrix
3. full canonical theme baseline
4. sampled additional themes/locales
5. impacted-page visual tests based on graph later

Correctness first, combinatorial restraint second.
