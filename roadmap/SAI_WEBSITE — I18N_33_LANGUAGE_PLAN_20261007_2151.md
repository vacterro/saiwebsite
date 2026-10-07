# SAI_WEBSITE — i18n Architecture for a Future 33-Language Site

## Goal

Support 33 or more locales without creating 33 independent copies of every page.

Exact locale selection is an operator decision and should remain data-driven.

## Canonical language

English (`en`) remains canonical source language for public content unless a particular source is inherently generated/non-linguistic.

## Locale registry

Conceptual fields:

```text
id
displayName
nativeName
enabled
stage
fallback
direction
searchEnabled
llmsEnabled
translationPolicy
fontCoverageProfile
```

Example stages:

```text
canonical
pilot
active
planned
deprecated
```

Adding a locale should require adding/updating registry data and locale content, not application logic.

## Routing

Recommended future model:

```text
/                  canonical English
/et/...
/ru/...
/de/...
/ja/...
```

Whether `/en/` aliases canonical English is a separate SEO/product decision. Do not duplicate canonical content unnecessarily.

## Translation unit granularity

Translate stable content blocks, not whole page source files by default.

Example:

```text
docs.recovery.intro.title
docs.recovery.intro.body
docs.recovery.failures.table.caption
```

Long editorial Markdown documents may use document-level translation where block fragmentation would harm authoring. The system should support both patterns.

## Translation state machine

```text
MISSING
  ↓
MACHINE_DRAFT
  ↓
REVIEWED
  ↓
CURRENT

CURRENT + canonical source hash changes
  ↓
STALE

canonical block deleted
  ↓
ORPHANED
```

`FALLBACK` is a render state rather than pretending a translation exists.

## Source-hash contract

Every translated unit stores the canonical source hash it corresponds to.

When canonical English changes, only affected units become stale.

Do not mark all 33 locales stale because a different page changed.

## Fallback policy

Recommended:

```text
requested locale
  → locale-specific translation if CURRENT/REVIEWED as policy allows
  → configured fallback locale
  → canonical English
```

The UI may optionally show a subtle diagnostic marker in debug mode for fallback content.

Public site should never display raw translation keys.

## Glossary

Maintain technical glossary per locale.

Fields:

```text
termId
canonicalEnglish
translate: true/false
preferred
forbiddenVariants
notes
```

Names such as SAIPEN should default to `translate: false`.

## Translation memory

Store reviewed exact translations for repeated normalized segments.

Use exact-match reuse automatically only when context is compatible.

Fuzzy suggestions are suggestions, not authoritative translations.

## Agent translation work package

Future command:

```text
npm run i18n:export -- --locale et --status missing,stale
```

Produces a bounded package with:

- block IDs
- canonical text
- previous translation if stale
- glossary subset
- page/context information
- variables/placeholders
- source hashes

This saves agent context and prevents full-repository wandering.

## Variables/placeholders

Translations must preserve typed variables such as:

```text
{version}
{projectName}
{command}
```

Validator must detect:

- missing variable
- extra variable
- malformed placeholder

## Markdown / links

Translation validator must preserve:

- internal link targets unless locale-aware rewrite is intended
- code spans
- commands
- URLs
- schema/property names
- fenced code unchanged unless explicitly localizable

## UI length strategy

Do not make Wintage controls rely on English text length.

Test representative stress cases:

- German-like long labels
- Finnish/Estonian compound words
- Russian/Cyrillic
- Japanese compact text
- accented Latin

## Font coverage

Before enabling a locale, verify SAI Pixel coverage for its required scripts.

A locale may be `planned` while font coverage is incomplete.

Do not silently claim pixel-perfect rendering for unsupported scripts.

Potential future script expansion must be a separate font milestone.

## Search

Search indexes should be locale-aware.

Do not mix all languages into one ranking pool unless explicitly designed.

## LLM outputs

Canonical English `llms.txt` remains primary.

Localized LLM outputs may be generated only from CURRENT translations or explicit fallback policy.

## SEO

When stable hosting exists:

- canonical URLs
- `hreflang`
- localized metadata
- localized sitemap entries

Do not implement domain-dependent SEO behavior before stable domain configuration.

## Rollout strategy

### Stage A

Kernel only, no public language routes.

### Stage B

EN + ET + RU pilot.

### Stage C

10-language stress test.

### Stage D

Operator-selected 33 languages.

This staged approach is mandatory. The architecture must prove itself before mass translation.
