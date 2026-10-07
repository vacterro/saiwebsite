---
title: STATE and next_action
description: STATE.md is the commit pointer of the latest checkpoint; next_action is the one executable step a cold agent takes first.
section: concepts
order: 2
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: statemd, label: CORE.md §1.2 — STATE.md }
  - { path: saipen/REGISTRY.json, label: REGISTRY.json — state, next_action_forms }
  - { path: extensions/schemas/state.schema.json, label: state.schema.json }
---

`STATE.md` answers one question: **what do I do right now?** It is YAML
frontmatter, and it is the last file written in every checkpoint — the commit
pointer that makes the rest of the checkpoint count.

## Fields

`phase`, `task`, `next_action`, `blocker`, `agent`, `saipen_version`, `mode`
and `updated` are always required; `transition_from` is required except on a
fresh INIT. Unknown fields are refused. The complete machine-owned field set,
with types and enums, is rendered from the registry on the
[STATE reference page](/spec/v8/state/).

A few rules carry most of the weight:

- `updated` and every claim time are real UTC ISO-8601 timestamps, read from
  the clock — never estimated.
- `last_event` equals the highest real `E-` id across sealed and active log
  history. Lower is stale; higher is corrupt.
- `style_contract` must equal the marker in the installed `STYLE.md`, which
  proves the agent actually loaded the communication contract.
- `saipen_version` is the installed protocol's major version. A state written
  by a newer major is refused read-only rather than guessed at.

## next_action

`next_action` is the heart of SAIPEN: the exact action the next agent executes,
with no prose interpretation. It must match one of the registry's forms:

| Form | Meaning |
|---|---|
| `PHASE <PHASE> [T-###]` | Enter or continue a phase; the ticket is required exactly for ticket-bearing phases. |
| `RUN: <command>` | Run a concrete shell or tool command. |
| `RESUME: T-### <PHASE>` | Resume a named ticket at a named phase. |
| `saipen <command>` | Run a registry- or extension-declared SAIPEN command. |
| `WAIT: <category> -- <sentence>` | Stop at a real human, manual or safety boundary. |

`WAIT:` carries one of seven registry categories and exactly one concrete
sentence; see [WAIT boundaries](/docs/protocol/wait-boundaries/). It is legal
only for an actual boundary — queued work belongs on the board, not in a wait.

> [!EXAMPLE]
> `next_action: "PHASE VERIFY T-42"` tells a cold agent to load the VERIFY
> phase rules and verify ticket T-42. It does not need to read the chat, ask
> what was going on, or decide what to do.

## Persisted intent

Alongside `next_action`, STATE records the run's intent: `execution_intent`
is `normal`, `goal` or `converge`, with goal counters (`goal_waves`,
`goal_tickets`) or a `converge_target` (`done`, `ship`, `crew`). A bare
continue resumes the persisted intent; it never invents an objective.
