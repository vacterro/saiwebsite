---
title: LOG and the event graph
description: LOG.md is append-only event authority — one bounded line per event, linked into a graph by unique ids and parent references.
section: concepts
order: 4
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: logmd, label: CORE.md §1.2 — LOG.md }
  - { path: SPEC.md, anchor: graph-based-event-logging, label: SPEC.md — Graph-based event logging }
---

<!-- i18n:docs.concepts.log-and-events.intro -->
`LOG.md` answers **why did the project reach this state?** Not "we are going
to check", not "probably fixed", but a concrete event, command and result,
linked to the decision before it.

<!-- i18n:docs.concepts.log-and-events.the-event-line -->
## The event line

```text
- DD.MM.YY HH:MM [E-NNN] [parent: E-NNN] [T-NNN] [agent: seat] [op: id] TAXONOMY: evidence
```

For example:

```text
- 07.10.26 09:31 [E-212] [parent: E-211] [T-12] [agent: seat-a] [op: checkpoint-9f2c] RUN: npm test -> PASS 48/48
```

- **E-ids are globally unique and strictly increasing** across sealed and
  active segments, and never reused. `parent:` must resolve to an earlier
  event. Together they form an acyclic graph rather than a flat list, which
  allows branching, agent handovers and precise audit trails.
- **Timestamps are real UTC** and may not be materially ahead of the clock.
- **Taxonomy is a closed vocabulary.** Test and validation claims include the
  exact command, PASS or FAIL, a confidence where required, and stable
  evidence.
- **Bounded lines.** A newly written event is at most 1,024 bytes. Full
  commands, matrices and transcripts go to a durable, hashable detail artifact
  that the line references; an oversized event is refused, never silently
  truncated.

<!-- i18n:docs.concepts.log-and-events.append-only-then-sealed -->
## Append-only, then sealed

The log is never rewritten. A wrong future timestamp is repaired by a
declared `DEC` event naming the original and replacement, not by editing the
old line. When the active log crosses its size cap, complete lines are sealed
into the next `.saipen/logs/LOG-NNN.md` through staging, fsync and atomic
replace. Sealed history is cold: it is read only for parent-chain checks,
counter rebuilds, audits or forensics.

<!-- i18n:docs.concepts.log-and-events.why-a-log-and-not-just-a-status-file -->
## Why a log and not just a status file

`STATE.md` tells an agent where it is; `LOG.md` lets anyone — another agent,
the validator, a human — check how it got there. Recovery derives counters,
style markers and the phase from the event chain, so the log is also what
makes a damaged `STATE.md` repairable. See [recovery](/docs/recovery/overview/).
