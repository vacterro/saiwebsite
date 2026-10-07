---
title: Lifecycle
description: The Core state machine from INIT to DONE, the maintenance phases around it, and why a ticket cannot skip VERIFY, REVIEW or SHIP.
section: protocol
order: 1
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: 16-core-state-machine--ticket-dag, label: CORE.md §1.6 Core state machine }
  - { path: saipen/REGISTRY.json, label: REGISTRY.json — phases }
---

<!-- i18n:docs.protocol.lifecycle.intro -->
Work in SAIPEN moves through a fixed state machine. The machine-readable
version — the phase enum, every legal edge, the phases enterable from
anywhere, and the ticket-bearing subset — lives in `REGISTRY.json` and is the
only thing the runtime and the validator consume. The
[interactive state machine](/spec/v8/lifecycle/) renders it directly.

<!-- i18n:docs.protocol.lifecycle.the-core-lifecycle -->
## The Core lifecycle

```text
INIT -> PLAN -> SCOUT -> BUILD -> VERIFY -> REVIEW -> SHIP -> DONE
```

| Phase | Purpose |
|---|---|
| INIT | Create `.saipen/` for a project that has none. |
| PLAN | Turn a request or backlog into tickets. |
| SCOUT | Read the code and the evidence before changing anything. |
| BUILD | Implement the smallest safe complete change. |
| VERIFY | Prove the ticket works with real evidence. |
| REVIEW | Independently re-check the result and the boundary it must respect. |
| SHIP | Release hygiene and publication, when permitted. |
| DONE | The ticket closed with recorded evidence; route to the next one. |

SCOUT, BUILD, VERIFY, REVIEW and SHIP are **ticket-bearing**: their
`next_action` must name the ticket.

<!-- i18n:docs.protocol.lifecycle.edges-that-matter -->
## Edges that matter

- **VERIFY can go back** to BUILD or SCOUT. A failed check loops through
  diagnosis and repair; it is never relabelled as success.
- **REVIEW can send work back** to BUILD or SCOUT.
- **SHIP's backward edge to BUILD** exists only for a fixable pre-publish
  preflight. Successful publication cannot return to editing.
- **Every phase can exit to BLOCKED**, the honest stop with an exact reason.
  BLOCKED returns to PLAN, SCOUT or DONE once the reason is removed.

<!-- i18n:docs.protocol.lifecycle.maintenance-and-infrastructure-phases -->
## Maintenance and infrastructure phases

Around the Core lifecycle sit HUNT and ADD (autonomous maintenance), MARKHUNT
(a dry audit that fixes nothing), CLEAN, TRANSLATE, PREPARE (packaging work for
a handoff) and VALIDATE. Several of them can be entered from any phase by an
explicit command — but command recognition never bypasses SHIP's requirement
of an approved REVIEW.

<!-- i18n:docs.protocol.lifecycle.phase-documents -->
## Phase documents

Each of the sixteen phases has its own short document, loaded only while that
phase is active. Each owns only its delta — entry, reads, actions, exit,
forbidden actions, evidence — and cites shared law instead of restating it.
This keeps a cold agent's reading small: the boot kernel, the index, and one
phase file.
