---
title: Goal mode and maintenance
description: How SAIPEN runs an objective across many tickets without asking "continue?", and what it does when the board runs empty.
section: protocol
order: 6
maturity: stable
authority: engineering
sources:
  - { path: saipen/MAINTENANCE.md, label: MAINTENANCE.md — Part 2 }
  - { path: README.md, anchor: architecture, label: README — Architecture }
---

The Maintenance layer sits on top of Core. Core never depends on it: switch
autonomous evolution off and SAIPEN is still a complete continuation
protocol.

## Goal-driven execution

Any actionable objective enters goal-driven execution by default;
`saipen goal <text>` sets a new objective explicitly. On entry:

- a DOING ticket in flight is checkpointed and left in TODO with a decision
  naming the pivot — never abandoned mid-edit;
- existing TODO tickets are demoted below the new objective, never deleted;
- PLAN inserts the new tickets at the top, and that PLAN is wave 1.

While the goal is active the agent advances
`SCOUT → BUILD → VERIFY → REVIEW → SHIP → DONE` across tickets without
stopping. The persisted counters `goal_waves` and `goal_tickets` carry a run
across a crash or a fresh session.

**The safety valve.** A run has caps — the README states them as 3 waves or
20 tickets. At the cap the run checkpoints and reports with a
`WAIT: safety valve`. A resume resets the counters only when the valve
actually tripped, and the reset is logged with the real pre-reset counts.

## When the board runs empty

A **halt** means no workable TODO ticket and no DOING ticket. From a halt the
idle ladder falls through in a fixed order:

```text
operator input > DOING / recovery > workable TODO > actionable audit
  > eligible future gate > HUNT > ADD
```

- **HUNT** scans for real defects: contradictions, broken checks, dead code,
  drift, unguarded rules, documentation that disagrees with behaviour.
- **ADD** proposes the next natural feature that continues the existing
  architecture — evolutionary, not creative.

Two exceptions are absolute: a session sitting at BLOCKED never auto-hunts,
and `read-only` mode runs HUNT report-only and never enters ADD.

## Complete before you extend

When a user asks for one step of a well-known workflow, the agent evaluates
whether the rest of the workflow is expected — asked for "Apply", it considers
"Save" and "Cancel", not "Save As". It implements the smallest coherent set,
and finishes the requested workflow before proposing anything else.
