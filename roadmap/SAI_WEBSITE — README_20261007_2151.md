# SAI_WEBSITE — Future Content System Roadmap Package

Status: FUTURE GATE / architecture package
Purpose: make SAI_WEBSITE cheap to maintain as SAIPEN, the ecosystem, documentation, support data, releases, and translations grow.

This package does **not** request a big-bang rewrite. It defines a staged migration from the current working Astro site toward a manifest-driven content system with canonical-source synchronization, impact analysis, stale-content detection, translation memory, and scalable multilingual publishing.

Primary design law:

> Change source facts once. Let the system identify, regenerate, invalidate, translate, verify, and rebuild everything affected.

The website remains static-first, local-first, Git-readable, deterministic, and usable without a backend.

Files in this package:

- `SAI_WEBSITE — MASTER_CONTENT_SYSTEM_ROADMAP_20261007_2151.md`
- `SAI_WEBSITE — CONTENT_ENGINE_ARCHITECTURE_20261007_2151.md`
- `SAI_WEBSITE — SOURCE_GRAPH_SYNC_CONTRACT_20261007_2151.md`
- `SAI_WEBSITE — I18N_33_LANGUAGE_PLAN_20261007_2151.md`
- `SAI_WEBSITE — MIGRATION_SEQUENCE_20261007_2151.md`
- `SAI_WEBSITE — M31_BOOTSTRAP_CORRIDOR_20261007_2151.md`

The exact final set of 33 languages is intentionally **not frozen here**. The system must support an arbitrary locale registry so languages can be added, disabled, deprecated, or reordered without code branching.
