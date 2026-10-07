---
title: Guarantees and non-claims
description: What SAIPEN guarantees, what it bounds, and what it explicitly does not promise — stated at the strength the implementation supports.
section: evidence
order: 2
maturity: stable
authority: reference
sources:
  - { path: SPEC.md, anchor: guarantees-bounds-and-non-claims, label: SPEC.md — Guarantees, bounds and non-claims }
---

The specification states its promises in three groups. This page restates
them; the linked section of `SPEC.md` is authoritative.

## Guaranteed — implemented and validated

- **Project-local persistent state.** Work, objective, last attempt, stop
  reason, known evidence and next action can be reconstructed from `.saipen/`
  alone, by a cold agent.
- **Validated state transitions.** Every canonical mutation passes a
  transactional fast gate; the release validator re-checks the full contract
  and fails closed.
- **Bounded single-writer semantics on a shared filesystem.** Claim
  serialization, one open attempt, and the LOG → BOARD → STATE transaction
  order.

## Bounded — designed for, environment-dependent

- **Filesystem assumptions.** Atomicity is temp-file-plus-rename ordering, not
  an fsync durability guarantee.
- **Supported versions.** Older states read as legacy and upgrade at the next
  checkpoint; newer-than-running states are refused, fail-closed.

## Not guaranteed

- Distributed consensus across disconnected machines.
- Correctness of arbitrary model output — only that fabricated completions
  cannot reach the board green unchallenged.
- Provider availability, model quality, or uninterrupted execution.
- Durability beyond what the host filesystem itself promises.

## Maturity vocabulary

Claims about the protocol use one ladder:

```text
DESIGNED -> IMPLEMENTED -> TESTED -> VERIFIED -> RELEASED
```

A claim is written at the strongest level it has actually reached, never
higher. This website follows the same rule with its own labels: every page and
every ecosystem project shows a maturity, and nothing is labelled supported
without evidence.
