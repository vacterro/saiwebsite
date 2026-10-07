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

**Agent** — a stable acting seat that works on a project. Not the name of a
model or provider; host session ids and process ids are never agents.

**Attempt** (`A-###`) — one bounded execution episode of one agent on one
ticket. It can fail or vanish without affecting the Work.

**BLOCKED** — the honest stop: a phase every phase can exit to, and a board
section for tickets that cannot progress, each with an exact `blocker:`.

**BOARD** — `BOARD.md`, the Work authority: tickets in DOING, TODO, DONE and
BLOCKED.

**Checkpoint** — the fixed write of LOG, then BOARD, then STATE, each read
back. Happens at every transition, ticket and stop.

**Claim** — moving a ticket to DOING with an owner and a real claim time.
Also: an unproven assertion, as opposed to evidence.

**Cold agent** — an agent with no chat history and no session memory of the
project. SAIPEN's design target.

**Continuation** — resuming work from persisted state with `saipen continue`
(`cc`).

**Core** — the required layer: continuation, state, checkpoint and validation.

**DONE** — a ticket closed with recorded verification evidence, after VERIFY,
REVIEW and any required SHIP.

**Evidence** — commands, results and artifacts recorded where the next agent
can check them. Distinct from a claim.

**Goal mode** — autonomous execution of an objective across tickets, capped by
a safety valve.

**HUNT / ADD** — the maintenance loop: find real defects, then propose the
next natural feature.

**Intake** — `.saipen/intake/`: an exact copy of a substantial request or
specification, with a contract and coverage.

**Kitchen** — `.saipen/kitchen/`: transient scratch space. Never canonical.

**KNOWLEDGE** — `.saipen/KNOWLEDGE/`: verified, reusable project truth,
including decision records.

**LOG** — `LOG.md`, the append-only event graph.

**Maintenance** — the optional layer above Core: HUNT, ADD, CLEAN and goal
mode.

**Mode** — the operating mode from capability negotiation: `full`,
`no-publish`, `manual-verify` or `read-only`.

**next_action** — the one executable action a cold agent takes first.

**Phase** — a state of the state machine, from INIT to DONE, plus the
maintenance and infrastructure phases.

**Producer** — an isolated worker (translation, documentation, audit) that
delivers a verified package for Core to integrate.

**Red control** — a deliberately bad input that proves a check can fail.

**RETIRED** — the terminal verdict for Work created in the wrong project.

**STATE** — `STATE.md`, the commit pointer of the latest checkpoint.

**Ticket** — one unit of Work on the board, with a priority, a title and a
`verify:` contract.

**WAIT** — a `next_action` that stops at a real human, manual or safety
boundary, in one of seven categories.

**Work** — the durable objective a ticket represents.

**Workable** — a TODO ticket whose dependencies are all DONE, with no blocker
and no foreign live claim.
