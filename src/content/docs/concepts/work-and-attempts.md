---
title: Work and attempts
description: A ticket is durable Work; an attempt is one bounded try at it. Attempts may fail or vanish — Work identity never does.
section: concepts
order: 6
maturity: stable
authority: engineering
sources:
  - { path: SPEC.md, anchor: work-attempts-and-completion-authority, label: SPEC.md — Work, attempts and completion authority }
  - { path: saipen/CORE.md, anchor: 16-core-state-machine--ticket-dag, label: CORE.md §1.6 }
---

<!-- i18n:docs.concepts.work-and-attempts.intro -->
SAIPEN separates **what must be done** from **one agent's try at doing it**.

- **Work** is the BOARD ticket. It is durable: it survives crashes, model
  changes and any number of failed tries.
- **An attempt** (`A-###`) is one bounded execution episode of one agent on
  that Work, recorded as machine-owned `DEC` events in `LOG.md`, plus at most
  one optional `STATE.attempt` pointer. It is deliberately not a storage
  subsystem: no database, no daemon, no second writer.

<!-- i18n:docs.concepts.work-and-attempts.how-an-attempt-ends -->
## How an attempt ends

An attempt ends `candidate`, `failed`, `interrupted`, `yielded` or
`superseded`, with an independent stop reason such as `context_limit`,
`process_crash` or `deliberate_handoff`.

**Attempt failure never touches Work identity.** The successor closes the
dangling episode honestly and claims the same ticket again. Repeating a failed
action requires a logged difference — a changed input, evidence, environment
or hypothesis. With no change, a retry is forbidden and the Work blocks rather
than looping.

<!-- i18n:docs.concepts.work-and-attempts.completion-authority-is-not-transferable -->
## Completion authority is not transferable

A candidate attempt's run lines and its own assertions are **claims**. Only
verification evidence recorded after the claim, plus the independent
VERIFY → REVIEW → SHIP gates, admit a transition to DONE. A producer cannot
close its own Work, and retroactive self-admission fails validation.

<!-- i18n:docs.concepts.work-and-attempts.a-cold-handoff-in-one-command -->
## A cold handoff in one command

`saipen brief` builds a handoff projection: the Work, its objective, the
current or last attempt, why it stopped, blockers, known unknowns and the
exact next action. It writes nothing and runs nothing — it is a view that can
always be rebuilt from canonical state.

Information honesty is structural here: an `unknown:` clause records what is
genuinely unknown, missing information is never promoted to fact, and
uncertainty never substitutes for verification evidence.
