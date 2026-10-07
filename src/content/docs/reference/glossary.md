---
title: Glossary
description: The SAIPEN vocabulary in one place — every term used across these docs, defined in one or two sentences.
section: reference
order: 1
maturity: stable
authority: reference
sources:
  - { path: saipen/CORE.md, label: CORE.md }
  - { path: SPEC.md, label: SPEC.md }
---

<!-- i18n:docs.reference.glossary.agent -->
**Agent** — a stable acting seat that works on a project. Not the name of a
model or provider; host session ids and process ids are never agents.

<!-- i18n:docs.reference.glossary.attempt -->
**Attempt** (`A-###`) — one bounded execution episode of one agent on one
ticket. It can fail or vanish without affecting the Work.

<!-- i18n:docs.reference.glossary.blocked -->
**BLOCKED** — the honest stop: a phase every phase can exit to, and a board
section for tickets that cannot progress, each with an exact `blocker:`.

<!-- i18n:docs.reference.glossary.board -->
**BOARD** — `BOARD.md`, the Work authority: tickets in DOING, TODO, DONE and
BLOCKED.

<!-- i18n:docs.reference.glossary.checkpoint -->
**Checkpoint** — the fixed write of LOG, then BOARD, then STATE, each read
back. Happens at every transition, ticket and stop.

<!-- i18n:docs.reference.glossary.claim -->
**Claim** — moving a ticket to DOING with an owner and a real claim time.
Also: an unproven assertion, as opposed to evidence.

<!-- i18n:docs.reference.glossary.cold-agent -->
**Cold agent** — an agent with no chat history and no session memory of the
project. SAIPEN's design target.

<!-- i18n:docs.reference.glossary.continuation -->
**Continuation** — resuming work from persisted state with `saipen continue`
(`cc`).

<!-- i18n:docs.reference.glossary.core -->
**Core** — the required layer: continuation, state, checkpoint and validation.

<!-- i18n:docs.reference.glossary.done -->
**DONE** — a ticket closed with recorded verification evidence, after VERIFY,
REVIEW and any required SHIP.

<!-- i18n:docs.reference.glossary.evidence -->
**Evidence** — commands, results and artifacts recorded where the next agent
can check them. Distinct from a claim.

<!-- i18n:docs.reference.glossary.goal-mode -->
**Goal mode** — autonomous execution of an objective across tickets, capped by
a safety valve.

<!-- i18n:docs.reference.glossary.hunt-add -->
**HUNT / ADD** — the maintenance loop: find real defects, then propose the
next natural feature.

<!-- i18n:docs.reference.glossary.intake -->
**Intake** — `.saipen/intake/`: an exact copy of a substantial request or
specification, with a contract and coverage.

<!-- i18n:docs.reference.glossary.kitchen -->
**Kitchen** — `.saipen/kitchen/`: transient scratch space. Never canonical.

<!-- i18n:docs.reference.glossary.knowledge -->
**KNOWLEDGE** — `.saipen/KNOWLEDGE/`: verified, reusable project truth,
including decision records.

<!-- i18n:docs.reference.glossary.log -->
**LOG** — `LOG.md`, the append-only event graph.

<!-- i18n:docs.reference.glossary.maintenance -->
**Maintenance** — the optional layer above Core: HUNT, ADD, CLEAN and goal
mode.

<!-- i18n:docs.reference.glossary.mode -->
**Mode** — the operating mode from capability negotiation: `full`,
`no-publish`, `manual-verify` or `read-only`.

<!-- i18n:docs.reference.glossary.next-action -->
**next_action** — the one executable action a cold agent takes first.

<!-- i18n:docs.reference.glossary.phase -->
**Phase** — a state of the state machine, from INIT to DONE, plus the
maintenance and infrastructure phases.

<!-- i18n:docs.reference.glossary.producer -->
**Producer** — an isolated worker (translation, documentation, audit) that
delivers a verified package for Core to integrate.

<!-- i18n:docs.reference.glossary.red-control -->
**Red control** — a deliberately bad input that proves a check can fail.

<!-- i18n:docs.reference.glossary.retired -->
**RETIRED** — the terminal verdict for Work created in the wrong project.

<!-- i18n:docs.reference.glossary.state -->
**STATE** — `STATE.md`, the commit pointer of the latest checkpoint.

<!-- i18n:docs.reference.glossary.ticket -->
**Ticket** — one unit of Work on the board, with a priority, a title and a
`verify:` contract.

<!-- i18n:docs.reference.glossary.wait -->
**WAIT** — a `next_action` that stops at a real human, manual or safety
boundary, in one of seven categories.

<!-- i18n:docs.reference.glossary.work -->
**Work** — the durable objective a ticket represents.

<!-- i18n:docs.reference.glossary.workable -->
**Workable** — a TODO ticket whose dependencies are all DONE, with no blocker
and no foreign live claim.
