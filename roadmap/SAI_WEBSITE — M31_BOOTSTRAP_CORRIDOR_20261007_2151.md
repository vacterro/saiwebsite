# SAI_WEBSITE — M31 Bootstrap Corridor

## Role

Implementation agent for the first future content-system milestone.

## Target

Build **registry/inventory foundation only**.

Do not implement i18n, translation, source synchronization, or page rewrites yet.

## Purpose

Create the smallest safe foundation that lets later milestones reason about the current site mechanically.

## Required first action

Inspect the current real project tree and current SAIPEN authority.

Locate existing owners including at minimum:

- route registry / `src/data/site.ts`
- current content collections/docs
- canonical protocol snapshots and sync scripts
- ecosystem data/sync
- support data
- downloads/compatibility data
- theme registry
- search generation
- llms generation
- changelog/version ownership

Do not assume the roadmap's conceptual paths match the final repository exactly.

## Implement

Create a new bounded content-engine module, for example:

```text
src/content-engine/
  registry/
  schemas/
  inventory/
```

Exact shape should follow existing project conventions.

### Page registry schema

Minimum fields:

```text
id
route
kind
owner
localizable
searchable
llmVisible
maturity
sourceIds
```

Closed enums for `kind` and `owner`.

Suggested ownership enum:

```text
editorial
generated
mixed
interactive
```

### Stable IDs

Assign stable IDs to every current public route.

Examples:

```text
home
about
pricing
ecosystem
spec.index
docs.introduction
```

Do not derive permanent IDs solely from file paths if a more semantic stable ID is obvious.

### Inventory

Generate or maintain one inventory artifact that reports:

- total public routes
- current route → page ID mapping
- owner class
- localizable flag
- declared source dependencies
- debug/internal routes separated from public routes

### Adapter

Do NOT create a second competing navigation truth.

Either:

A. derive new registry from current route authority initially

or

B. make current route authority derive from the new registry

Choose one direction and document it.

There must be exactly one canonical route/maturity source after M31.

## Validation

Add a registry validator that fails on:

- duplicate page ID
- duplicate public route
- malformed route
- unknown owner/kind
- missing required field
- source ID syntax error

Also verify every built public route expected by current site appears in registry.

## Red controls

Demonstrate at least:

1. duplicate page ID fails
2. duplicate route fails
3. current public route missing from registry fails

Restore after each test.

## Non-goals

Do NOT implement yet:

- 33 languages
- locale routes
- translations
- translation memory
- source fetching
- source lock
- site:sync
- site:doctor beyond a trivial registry check
- content block migration
- docs rewrite
- page composition manifests
- hosting/deployment changes

## Acceptance

M31 is DONE when:

- every current public page has a stable page ID
- registry schema is validated
- ownership is explicit
- localizable/search/LLM flags are explicit
- source dependency placeholders can be represented
- there is no duplicate route authority
- current build/tests remain green
- no visible site behavior changes are required

## Next target

M32 — Canonical Source Registry.

STOP after M31.
