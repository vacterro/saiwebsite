---
title: BOARD and tickets
description: BOARD.md is the Work authority — four sections, one line per ticket, a verification contract on every ticket and an acyclic dependency graph.
section: concepts
order: 3
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: boardmd, label: CORE.md §1.2 — BOARD.md }
  - { path: saipen/REGISTRY.json, label: REGISTRY.json — ticket_states }
---

<!-- i18n:docs.concepts.board-and-tickets.intro -->
`BOARD.md` answers **what work exists, and what am I picking up?** It always
has the four sections `## DOING`, `## TODO`, `## DONE` and `## BLOCKED`, even
when they are empty.

```text
## DOING
- [/] T-12 [P1] Fix stale cache on reload | verify: npm test | owner: seat-a | claim_time: 2026-10-07T09:14:03Z

## TODO
- [ ] T-13 [P2] Add export command | verify: cli export round-trips a sample | needs: T-12

## DONE
- [x] T-11 [P1] Reproduce stale cache | verify: failing test exists | closure_mode: own_patch

## BLOCKED
- [ ] T-9 [P3] Publish package | verify: release exists | blocker: first-publish needs owner confirmation
```

<!-- i18n:docs.concepts.board-and-tickets.rules-that-keep-the-board-honest -->
## Rules that keep the board honest

- **Section is lifecycle truth.** The checkbox must match the section
  (`[ ]` TODO and BLOCKED, `[/]` DOING, `[x]` DONE). A status change moves the
  line; a ticket appears in exactly one section.
- **Every ticket has an id, a priority, a bounded title and a `verify:`
  contract** — the minimum proof that will close it.
- **`needs:` forms an acyclic graph.** A missing dependency or a cycle moves
  the affected ticket to BLOCKED with the exact reason, instead of leaving it
  in TODO as apparently workable ballast.
- **`blocker:` is non-empty exactly in BLOCKED,** and unblocking requires the
  decision or evidence that removed it.
- **DOING holds the one active Core Work,** with its owner and real claim
  time. Core has one writer and at most one DOING ticket.
- **DONE requires non-empty verification evidence** that agrees with the log.
  A checkbox alone proves nothing.
- **Bounded records.** A newly written live ticket line is at most 1,200
  characters; larger material is externalised to source or evidence files,
  never silently truncated.

Unknown ticket fields are rejected; the closed field set is owned by the
registry. The sections, checkboxes and required fields are rendered on the
[BOARD reference page](/spec/v8/board/).

<!-- i18n:docs.concepts.board-and-tickets.three-terminal-verdicts -->
## Three terminal verdicts

DONE and BLOCKED are joined by **RETIRED**, for Work that was minted into the
wrong project. A retired ticket leaves scheduling and its request bytes move
to forensic storage; no completion is fabricated for it. Legitimate old Work
that a later ticket implemented and verified closes as `superseded_verified`,
with explicit evidence and authority.

<!-- i18n:docs.concepts.board-and-tickets.which-ticket-is-next -->
## Which ticket is next

The next ticket is chosen mechanically: the topmost **workable** TODO line —
TODO, every dependency DONE, no blocker and no foreign live claim. Board order
is priority. See [deterministic routing](/docs/protocol/routing/).
