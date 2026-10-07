---
title: Interrupted work
description: An agent hit its limit halfway through a ticket. What the next agent reads, what it keeps, and what it must not touch.
section: recovery
order: 2
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: 15-checkpointing--recovery, label: CORE.md §1.5 Checkpointing & recovery }
  - { path: SPEC.md, anchor: work-attempts-and-completion-authority, label: SPEC.md — Work and attempts }
  - { path: BROCHURE_EN.md, label: Brochure — Survive interruptions }
---

The everyday failure is not a corrupted file. It is an agent that stopped:
the session hit its context or usage limit, the provider went down, the
process crashed, or the user closed the window.

## What survives

Whatever was checkpointed. The last complete checkpoint records the phase, the
active ticket, the verification results so far and the next step. Work in
progress that had not reached a checkpoint is still on disk — in the working
tree and in `.saipen/kitchen/` — it is just not yet canonical.

## What the next agent does

1. Runs `saipen continue`. Recovery closes the interrupted operation and
   derives the state from the evidence.
2. Finds the dangling attempt and closes it honestly — for example
   `interrupted` with stop reason `context_limit`. The Work itself is
   untouched.
3. **Finishes the DOING ticket.** Routing priority puts FINISH above START, so
   the half-done ticket is never abandoned for fresh work.
4. Attributes the dirty working tree: changes that belong to the DOING ticket,
   the log or the kitchen continue as in-flight Work; anything unattributed is
   treated as the user's data and left alone.
5. Re-verifies. A claim the previous agent made but did not prove is still
   only a claim.

## Across models

None of this depends on which model wrote the checkpoint. The next agent may be
a different model from a different vendor, in a different host; it reads the
same files and gets the same `next_action`.

> [!NOTE]
> Repeating a failed action needs a logged reason: a changed input, evidence,
> environment or hypothesis. "Try again" without a difference is forbidden,
> and the Work blocks instead of looping.
