# SAI_WEBSITE — Source Graph & Sync Contract

## Objective

Make source drift detectable and updates bounded.

## Source descriptor

Each source should have a descriptor equivalent to:

```text
id
kind
canonicalLocation
snapshotPath
adapter
authority
schemaVersion
refreshPolicy
validationPolicy
failurePolicy
consumers
```

## Initial dependency graph

```text
SAIPEN protocol registry
  → protocol normalized model
  → spec pages
  → protocol docs reference blocks
  → state machine visualizer
  → compatibility assumptions where explicitly sourced
  → search
  → llms outputs

SAIPEN HQ project map
  → ecosystem curated model
  → /ecosystem/
  → related project links
  → selected download/catalog entries

GitHub releases
  → release snapshots
  → downloads model
  → /downloads/

Wintage palette packs
  → theme normalized model
  → runtime theme system
  → debug theme pages
  → visual/pixel gates

Public support authority
  → support model
  → /pricing/ optional support section

site package/changelog
  → version model
  → status/about/readme/version surfaces
```

## Commands

### `site:doctor`

Read-only.

Checks:

- source lock freshness
- snapshot schema
- normalized model integrity
- generated output hashes
- stale editorial dependencies
- translation freshness
- orphan blocks/translations
- route/index consistency

Must support JSON output for agents.

### `site:impact`

Read-only.

Input can be source ID, page ID or block ID.

Output:

- direct dependencies
- transitive impacted outputs
- locales affected
- tests recommended

### `site:sync`

Mutating.

Must support dry-run.

Atomic behavior:

1. fetch to temporary location
2. validate
3. normalize
4. compute diff
5. compute impact
6. write snapshot + source lock atomically
7. regenerate derived outputs
8. mark dependent editorial/translation units stale
9. validate final tree

On failure before commit step, leave previous valid state intact.

## Drift categories

```text
NO_CHANGE
SOURCE_CHANGED_COMPATIBLE
SOURCE_CHANGED_SCHEMA
SOURCE_UNAVAILABLE
SNAPSHOT_INVALID
GENERATED_DRIFT
EDITORIAL_DEPENDENCY_STALE
TRANSLATION_STALE
```

## Anti-churn rule

Sync must not rewrite files solely because timestamps or key ordering changed.

Normalized serialization should be stable.

## Network policy

`site:doctor` should work offline against local locks/snapshots.

`site:sync` may use network when explicitly invoked.

Static build must use local valid snapshots by default, not require live upstream availability.

## Source update safety

If upstream schema changes unexpectedly:

- do not silently normalize unknown shape
- report SCHEMA_CHANGED
- keep old valid snapshot
- create actionable impact output
