---
title: Concurrency boundaries
description: SAIPEN is a state protocol with single-writer semantics on a shared filesystem. It is deliberately not distributed consensus.
section: protocol
order: 7
maturity: stable
authority: engineering
sources:
  - { path: SPEC.md, anchor: concurrency--distribution-boundaries, label: SPEC.md — Concurrency & distribution boundaries }
  - { path: README.md, anchor: what-saipen-is-not, label: README — What SAIPEN is not }
---

<!-- i18n:docs.protocol.concurrency.intro -->
SAIPEN keeps state consistent with file-based claims (`owner`,
`claim_time`), a sequential event graph, a project-scoped writer lock for its
journaled state operations, and a recovery journal.

<!-- i18n:docs.protocol.concurrency.what-that-covers -->
## What that covers

- **One machine, or a shared filesystem.** Claim serialization, one open
  attempt per Work, and the fixed LOG → BOARD → STATE transaction order give
  bounded single-writer semantics. Conflicts resolve by atomic filesystem
  writes: first commit wins.
- **Producers in parallel.** Isolated producers (translation, documentation,
  audit sensors) may work concurrently in their own kitchen space and hand
  over complete, verified packages. Only Core integrates them; producers cannot
  mutate Core state, forge readiness or ship.

<!-- i18n:docs.protocol.concurrency.what-it-does-not-cover -->
## What it does not cover

Ordinary edits to project files, and writers on disconnected machines, are
outside the lock. If agents work on different machines without real-time file
syncing, claims on `BOARD.md` can race. That needs external coordination.

> [!AUTHORITY]
> SAIPEN is a state protocol, not a distributed consensus algorithm. Turning it
> into one is explicitly out of scope for the project.
