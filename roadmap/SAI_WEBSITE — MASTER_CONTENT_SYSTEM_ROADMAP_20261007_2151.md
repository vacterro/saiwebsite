# SAI_WEBSITE — Master Content System Roadmap

## Mission

Evolve SAI_WEBSITE from a high-quality static site into a **self-maintaining documentation/content product** where changes to SAIPEN, Wintage, ecosystem projects, support data, releases, documentation, or translations have a deterministic and inspectable propagation path.

The desired future workflow is:

```text
canonical source changes
        ↓
source snapshot / sync
        ↓
normalized content model
        ↓
impact graph
        ↓
regenerate derived content
        ↓
mark translations stale
        ↓
agent updates only affected units
        ↓
validate / build / test
        ↓
publish
```

The operator should not need to remember which pages are affected by a change.

The agent should not need to rediscover the entire website structure on every update.

---

## Core engineering laws

1. **Single-source facts.** A volatile fact must have one canonical local owner.
2. **Generated vs editorial is explicit.** Generated facts are never silently hand-edited.
3. **Stable IDs beat file paths.** Content blocks and translation units have stable IDs that survive page moves.
4. **Every generated artifact has provenance.** Source, source version/hash, generator and generated-at information are inspectable.
5. **No runtime dependency on external APIs.** Sync happens at build/operator time. The published website remains static.
6. **Fail stale, not false.** When source data changes, derived content becomes STALE rather than pretending to remain current.
7. **Fallback is explicit.** Missing translations may fall back to canonical English without breaking the site.
8. **No big-bang migration.** Existing working pages remain valid while modules are migrated one domain at a time.
9. **Human-readable state.** JSON/Markdown manifests remain inspectable and diffable.
10. **Agent-friendly commands.** Common maintenance tasks are first-class commands, not tribal knowledge.
11. **Impact before mutation.** `site:doctor` reports blast radius before `site:sync` changes files.
12. **Reversible generated output.** Generated files can always be recreated from source snapshots + generators.
13. **Translation work is incremental.** Only MISSING or STALE units need work.
14. **No locale-specific code branches.** Languages are data, not `if (lang === ...)` logic.
15. **Current site behavior stays authoritative until migrated.** Future architecture must not degrade today's working site.

---

# Milestones

## M31 — Content Registry Foundation

Goal: establish one machine-readable registry for public routes, content identity, source ownership, localization status and generation mode.

Deliverables:

- `src/content-engine/registry/`
- canonical page IDs independent of URL
- page metadata schema
- content ownership enum: `editorial | generated | mixed`
- localization flag
- search/LLM visibility flags
- maturity/status field
- source dependencies field
- route registry adapter to current `src/data/site.ts`
- no page rewrite yet

Example conceptual entry:

```text
id: docs.recovery
route: /docs/recovery/
owner: editorial
localizable: true
searchable: true
llmVisible: true
maturity: stable
sources:
  - saipen.protocol.registry
```

Acceptance:

- all public pages have stable IDs
- all current routes remain unchanged
- registry validation rejects duplicate IDs/routes
- generated/editorial ownership is explicit
- no runtime network calls

---

## M32 — Canonical Source Registry

Goal: describe every external/internal authority the site depends on.

Initial source classes:

- SAIPEN protocol registry/schema
- SAIPEN documentation/public protocol source
- SAIPEN HQ project map
- Wintage palettes/design contracts
- public support details
- GitHub releases/download metadata
- compatibility/adapter registry
- site-local editorial content
- site version/changelog

Each source gets:

- stable source ID
- authority type
- canonical location
- local snapshot path
- refresh method
- validator
- source version/hash
- consumers
- network requirement
- failure policy

Acceptance:

- no source is identified only by prose in a README
- source freshness can be inspected programmatically
- source registry does not fetch at runtime

---

## M33 — Source Lock + Snapshot Contract

Goal: make synchronized facts reproducible.

Introduce a lock manifest, e.g.:

```text
src/content-engine/manifests/source-lock.json
```

For each synchronized source record:

- source ID
- source URL/repository
- commit/tag/version if available
- SHA-256 of local snapshot
- synchronized timestamp
- sync tool/version
- schema version

Acceptance:

- build can explain exactly which upstream state it represents
- source lock drift is detectable
- malformed or unverifiable snapshots fail closed

---

## M34 — Impact Graph

Goal: answer automatically: “what becomes stale when X changes?”

Model dependencies:

```text
source → normalized model → content blocks/pages → locale units → indexes/feeds
```

Examples:

```text
saipen.protocol.registry
  → protocol.model
  → spec.state-machine
  → /spec/
  → /docs/protocol/
  → search index
  → llms-full.txt

support.public
  → support.model
  → pricing.support
  → /pricing/

wintage.palettes
  → theme.model
  → theme runtime
  → /debug/themes/
  → theme documentation
  → visual tests
```

Commands:

```text
npm run site:doctor
npm run site:impact -- <source-or-page-id>
```

Acceptance:

- known source mutation produces deterministic impacted IDs
- unaffected pages are not marked stale
- graph cycles fail validation

---

## M35 — Normalized Content Models

Goal: keep UI/pages ignorant of raw upstream formats.

Create domain models, for example:

```text
src/content-engine/models/
  protocol/
  ecosystem/
  compatibility/
  downloads/
  support/
  versions/
```

Rules:

- page templates consume normalized models
- GitHub API payloads never leak directly into Astro components
- raw upstream schemas remain snapshots, not UI contracts
- model schema changes are versioned

Acceptance:

- at least SAIPEN protocol + ecosystem + support use normalized models
- components no longer parse upstream-specific fields directly

---

## M36 — Generated Content Contract

Goal: define generated blocks/pages as reproducible outputs.

Generated output header/metadata includes:

- `generated: true`
- generator ID/version
- source IDs
- source lock hashes
- generated-at
- content schema version

Examples suitable for generation:

- protocol states
- protocol error/reference tables
- JSON schemas/spec payloads
- compatibility matrices
- ecosystem releases
- download hashes
- version tables
- machine-readable indexes

Generated output must not be hand-edited.

Acceptance:

- modifying generated output manually is caught by validation or regeneration
- regeneration is deterministic

---

## M37 — Stable Block System

Goal: stop treating whole pages as the smallest unit of maintenance.

Introduce stable block IDs such as:

```text
home.hero.title
home.problem.body
about.workflow.title
docs.recovery.intro.body
docs.recovery.failure.example
pricing.support.bank.title
```

Each block records:

- stable ID
- owner
- source dependencies
- canonical English hash
- localizable boolean
- interpolation variables
- optional structured type

Recommended block types:

- text
- markdown
- callout
- table
- list
- code-example
- generated-reference
- media-caption

Acceptance:

- page composition references block IDs
- block moves between pages do not invalidate translations unnecessarily
- duplicate block IDs fail validation

---

## M38 — Page Composition Manifests

Goal: make page structure editable without cloning full Astro pages.

A page manifest can conceptually specify:

```text
page: docs.recovery
layout: docs
blocks:
  - docs.recovery.intro
  - docs.recovery.failure-types
  - docs.recovery.example
  - docs.recovery.next-steps
```

Do not turn every custom interactive page into generic JSON.

Use manifest composition for content-heavy pages. Keep bespoke Astro for interactive/spec/playground/debug pages where code is the clearer owner.

Acceptance:

- removing/reordering a normal content block does not require editing localized page copies
- bespoke pages remain possible

---

## M39 — Site Doctor

Goal: provide one health command for the operator/agent.

Command:

```text
npm run site:doctor
```

Output categories:

```text
SOURCES
CURRENT / STALE / FAILED / UNKNOWN

CONTENT
CURRENT / STALE / MISSING / INVALID

TRANSLATIONS
CURRENT / STALE / MISSING / FALLBACK

DERIVED OUTPUTS
CURRENT / STALE

BROKEN CONTRACTS
links / blocks / sources / versions / locale variables
```

Exit behavior:

- 0: healthy
- nonzero: broken invariant
- optionally distinguish stale-but-buildable from invalid

Acceptance:

- one command gives a reliable maintenance picture
- output has machine-readable JSON mode for agents

---

## M40 — Site Sync Engine

Goal: one controlled command updates upstream-backed content.

Commands:

```text
npm run site:sync
npm run site:sync -- --source saipen.protocol.registry
npm run site:sync -- --dry-run
```

Sync pipeline:

1. resolve source registry
2. fetch allowed upstream source
3. verify expected identity/schema
4. write/update raw snapshot atomically
5. update source lock
6. rebuild normalized model
7. compute impact graph
8. regenerate affected generated content
9. mark affected editorial/translation units stale
10. update derived indexes
11. validate
12. print impact report

Never silently overwrite editorial text.

Acceptance:

- interrupted sync cannot leave half-updated snapshots
- dry-run shows changes without mutation
- unchanged upstream produces no file churn

---

## M41 — Content Hashing + Staleness

Goal: make stale state objective.

Canonical block hash must be based on normalized source text/structure, not volatile metadata.

Translation unit records:

- canonical block ID
- source hash last translated
- translation hash
- status
- reviewed state

When canonical source hash changes:

```text
CURRENT → STALE
```

When block is deleted:

```text
translation → ORPHANED
```

When new block appears:

```text
translation → MISSING
```

Acceptance:

- one-character canonical content change marks only dependent units stale
- formatting-only noise does not cause mass staleness if normalization says it is semantically irrelevant

---

## M42 — i18n Kernel

Goal: support arbitrary locales without page duplication.

Introduce locale registry with fields such as:

- locale ID
- display name
- native name
- enabled/planned
- fallback locale
- direction (`ltr`/`rtl`)
- completion policy
- search indexing enabled
- llms output enabled
- date/number formatting metadata

Canonical language:

```text
en
```

Initial proof locales:

```text
en
et
ru
```

Do not implement 33 translations yet.

Acceptance:

- language list is data-driven
- adding a new planned locale requires no core code branch
- fallback is deterministic
- locale route generation is registry-driven

---

## M43 — Translation Unit Store

Goal: translate blocks, not cloned pages.

Possible structure:

```text
src/locales/
  registry.json
  et/
    ui.json
    docs.json
  ru/
    ui.json
    docs.json
```

or sharded by domain if files become too large.

Each translation entry records or can derive:

- block ID
- translated content
- source hash
- status
- optional reviewer

Statuses:

```text
MISSING
MACHINE_DRAFT
REVIEWED
CURRENT
STALE
FALLBACK
ORPHANED
```

Acceptance:

- whole page translation is not required for a one-block update
- unknown IDs fail validation

---

## M44 — Translation Memory

Goal: reuse previous approved translations.

Store stable translation memory entries based on:

- canonical normalized source
- locale
- context/domain
- approved translated text

The system may offer exact/reliable prior matches to agents.

Do not auto-apply fuzzy translations without marking them for review.

Acceptance:

- repeated strings reuse reviewed translations
- translation memory does not silently overwrite explicit locale content

---

## M45 — Terminology / Glossary Contract

Goal: stop technical terminology from drifting between pages/languages.

Maintain glossary for terms such as:

- SAIPEN
- SAIPEN Protocol
- agent
- cold agent
- recovery
- continuation
- evidence
- source authority
- ticket
- gate
- verification
- state
- provider

Per locale record:

- preferred term
- forbidden variants if necessary
- translate/do-not-translate flag
- notes/context

Validation can warn/fail on known prohibited terminology.

Acceptance:

- core names never get translated accidentally
- glossary is available to translation agents programmatically

---

## M46 — Translation CLI

Goal: make agent maintenance cheap.

Commands:

```text
npm run i18n:status
npm run i18n:status -- --locale et
npm run i18n:add -- fi
npm run i18n:export -- --locale de --status stale,missing
npm run i18n:validate
```

Optional future controlled agent workflow:

```text
npm run i18n:prepare -- --locale fi
```

which produces a work package containing only missing/stale units + glossary + context.

Acceptance:

- agents do not need to search the whole repository to translate updates
- status output is machine-readable

---

## M47 — First Multilingual Proof: EN / ET / RU

Goal: validate architecture before scale.

Scope:

- shell UI
- home
- about
- pricing
- one docs section
- language selector
- localized metadata
- localized 404
- localized search entries

Do not translate all docs in the first proof.

Acceptance:

- locale routing works
- fallback works
- stale detection works
- Wintage layouts survive longer text
- no page-level horizontal overflow

---

## M48 — i18n Visual/Pixel QA

Goal: prevent translations from destroying the Wintage UI.

Validate:

- 320/390/1280 widths
- menu labels
- buttons
- breadcrumbs
- tables
- code examples
- title bars
- status fields
- long German-like labels
- Cyrillic
- diacritics
- RTL readiness even before enabling an RTL locale

Pixel-font coverage must be checked separately from text correctness.

Acceptance:

- unsupported glyphs are detected before publish
- clipping/overflow has deterministic tests

---

## M49 — Search + LLM Localization

Goal: derived discovery outputs follow locale state.

For enabled locales:

- localized search index
- localized page metadata
- optional localized `llms.txt`
- canonical/alternate language links
- hreflang where appropriate

Do not generate localized LLM outputs from stale translations without marking/fallback policy.

---

## M50 — 10-Language Scale Test

Goal: prove maintenance cost stays controlled before 33 locales.

Enable 10 representative locales chosen by operator.

Measure:

- build time
- output page count
- translation unit count
- stale propagation time
- search index size
- CI duration
- visual regression cost
- agent work package size

Acceptance:

- no architecture change required to add the 10th locale
- adding a locale is primarily data/content work

---

## M51 — Full 33-Language Expansion

Goal: expand to the operator-selected 33 locales.

Prerequisites:

- M42–M50 green
- stable glossary
- translation work packages
- fallback policy
- font/glyph coverage strategy
- CI sharding if needed

Do not freeze the exact 33-language list until the operator chooses it.

Acceptance:

- all 33 are registry entries
- each locale exposes completion/current/stale statistics
- missing translations never silently masquerade as translated content

---

## M52 — Content Health Dashboard

Goal: human/agent-visible maintenance dashboard.

Possible route:

```text
/debug/content/
```

Display:

```text
Sources             8/8 current
Generated models    12/12 current
Pages               94 current / 3 stale
Blocks               1430 current / 22 stale
Translations
  EN 100%
  ET 98.4% — 12 stale
  RU 100%
  DE 87.2% — 42 missing
Derived outputs     current
```

This page is diagnostic, not public marketing evidence unless explicitly published.

---

## M53 — Automated Maintenance Ticket Bridge

Goal: optionally let detected website drift become structured SAIPEN work.

Example:

```text
T-44 Website source drift

Detected:
SAIPEN canonical 8.1.0 → 8.2.0

Impact:
6 pages
14 canonical blocks
32 locale translation sets
search + llms indexes
```

Do not auto-create noisy tickets for every harmless upstream timestamp change.

Acceptance:

- only meaningful drift creates/updates work
- ticket contains exact source + impact report

---

## M54 — Partial Rebuild / Cache Optimization

Only after correctness is proven.

Goal: avoid rebuilding everything when only one domain changed.

Potential targets:

- generated model caching by source hash
- translation compilation caching
- search index per locale
- visual tests limited to impacted pages + mandatory smoke set

Never allow optimization to hide stale outputs.

---

# Final target experience

A future operator change should look like this:

```text
npm run site:doctor

STALE SOURCE
saipen.protocol.registry
local 8.1.0
upstream 8.2.0
impact: 6 pages / 14 blocks / 32 locales

npm run site:sync -- --source saipen.protocol.registry

updated snapshot
updated source lock
regenerated spec model
6 pages regenerated
14 canonical blocks changed
ET: 4 stale
RU: 6 stale
DE: 14 stale
search indexes marked stale

npm run i18n:export -- --status stale

...agent edits only affected units...

npm run i18n:validate
npm run build
npm test
```

That is the desired maintenance model.
