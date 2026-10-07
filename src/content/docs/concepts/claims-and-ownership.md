---
title: Claims and ownership
description: One writer, one active ticket, real claim times — and a hard rule that unattributed changes in your working tree are your data.
section: concepts
order: 8
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: 14-claim--ownership, label: CORE.md §1.4 Claim & ownership }
  - { path: saipen/CORE.md, anchor: 15-checkpointing--recovery, label: CORE.md §1.5 — dirty-tree continuation }
---

<!-- i18n:docs.concepts.claims-and-ownership.claiming-work -->
## Claiming work

An agent claims only the **topmost workable TODO ticket**. It moves the line
to DOING with an `owner` and a real UTC `claim_time`, then re-reads the board
before starting. `agent` in STATE is a stable acting seat, not the name of a
model or provider.

- A live claim belonging to someone else cannot be stolen.
- A stale claim may be adopted only after checking recent LOG, STATE and
  filesystem evidence, and the handover is recorded with both seats.
- Core has one writer and at most one DOING ticket. A second writer waits on
  the project writer lock; a lock timeout refuses rather than races.

When active Work A discovers that it needs new Work B first,
`ticket block-for` atomically moves A to BLOCKED, records `A needs B` and A's
resume phase. B becomes the only claimable continuation, and when B is done, A
is restored to exactly the phase it left.

<!-- i18n:docs.concepts.claims-and-ownership.a-dirty-working-tree-is-normal -->
## A dirty working tree is normal

Uncommitted changes are expected: SAIPEN commits at ship time, not at every
step. On continuation, every dirty file is attributed — against the DOING
ticket, the log, the kitchen and any cross-project patch receipts.

- **Attributable changes** are in-flight Work and continue.
- **Unattributed changes are user data.** SAIPEN never commits, reverts,
  stashes, deletes or overwrites them.
- The only reason to stop is an overlap: a file that authorized Work must
  change already carries someone else's unattributed edits.

> [!WARNING]
> Destructive effects — force-push, history rewrite, dropping a branch, schema
> or database, mass deletion, user-data deletion, irreversible migration —
> require explicit confirmation unless the active Work pre-authorizes that
> exact, reversible effect. A rollback note is not permission.
