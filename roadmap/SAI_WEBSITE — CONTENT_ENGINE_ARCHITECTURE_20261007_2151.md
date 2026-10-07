# SAI_WEBSITE — Content Engine Architecture Contract

## Purpose

Define clean ownership boundaries so SAI_WEBSITE can grow without every new feature becoming another hard-coded page-specific maintenance path.

## Proposed module boundary

```text
src/content-engine/
  registry/
    pages.*
    blocks.*
    locales.*
    sources.*
  schemas/
    page.*
    block.*
    locale.*
    source.*
    translation.*
  sources/
    adapters/
    snapshots/
  models/
    protocol/
    ecosystem/
    compatibility/
    downloads/
    support/
    versions/
  graph/
    dependencies.*
    impact.*
  generators/
    spec.*
    indexes.*
    llms.*
  i18n/
    glossary.*
    memory.*
    stale.*
    compiler.*
  manifests/
    source-lock.json
    content-lock.json
```

Exact filenames should follow the existing TypeScript/ESM conventions in the real tree. This is a responsibility map, not a mandate to create unnecessary files.

## Four content classes

### 1. Canonical synchronized facts

Examples:

- SAIPEN protocol state names
- protocol version
- canonical schema fields
- project/release metadata
- download checksums
- adapter compatibility facts

Rules:

- sourced from registered authority
- snapshotted locally
- validated
- normalized before UI use
- never edited inside page components

### 2. Generated content

Examples:

- spec tables
- compatibility tables
- machine indexes
- derived links
- release tables

Rules:

- reproducible
- provenance attached
- hand-edit rejected or overwritten deterministically

### 3. Editorial content

Examples:

- explanations
- tutorials
- blog posts
- About/origin story
- examples and interpretation

Rules:

- written by human/agent
- may depend on canonical sources
- dependency change can mark editorial block STALE, but sync must not overwrite it

### 4. Translation content

Rules:

- derived from canonical editorial/generated surface
- stable block IDs
- source hash tracked
- explicit state machine

## Separation between data and presentation

Bad future pattern:

```text
Astro page fetches GitHub → parses API response → displays release data
```

Target:

```text
sync adapter → raw snapshot → normalized release model → page component
```

The page should not know GitHub JSON field names.

## Stable IDs

Page ID must survive URL changes.

Block ID must survive page reordering.

Locale ID must be BCP 47-compatible where practical.

Source ID must be semantic, for example:

```text
saipen.protocol.registry
saipen.hq.project-map
wintage.theme-packs
vacterro.support.public
github.releases.saituls
```

## Content state vocabulary

Canonical content:

```text
CURRENT
STALE
MISSING
INVALID
DEPRECATED
```

Translations:

```text
MISSING
MACHINE_DRAFT
REVIEWED
CURRENT
STALE
FALLBACK
ORPHANED
```

Do not overload one status field with unrelated meanings such as release maturity and translation freshness.

## No hidden state

Every automatic decision should be explainable through persisted or reproducible data:

- why a page is stale
- which source changed
- which hash differs
- why a translation is stale
- why a generated artifact rebuilt

## Runtime constraints

The production website remains static.

No database is required for this content system.

No runtime GitHub API call is required.

No translation service is required at page request time.

All maintenance work happens before static build.
