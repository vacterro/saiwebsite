---
title: Commands and shortcuts
description: The everyday SAIPEN commands, the whole-message shortcut keys, and where the complete machine-generated list lives.
section: operation
order: 1
maturity: stable
authority: engineering
sources:
  - { path: README.md, anchor: common-commands, label: README — Common commands }
  - { path: saipen/REGISTRY.json, label: REGISTRY.json — commands, shortcuts }
  - { path: saipen/COMMANDS.md, label: COMMANDS.md }
---

SAIPEN commands are typed to the agent as chat messages, or run through the
installed launcher in a terminal. `COMMANDS.md` owns what each command means;
`REGISTRY.json` owns the closed vocabulary, which the engine resolves before
any conversational interpretation.

## Everyday commands

| Command | Does |
|---|---|
| `saipen set` | Adopt a project: create `.saipen/` state. |
| `saipen continue` | Resume from persisted state — no rebriefing. |
| `saipen plan [text]` | Turn a request or raw backlog into tickets. |
| `saipen goal <text>` | Set an objective and run it autonomously across tickets. |
| `saipen status` | Read-only report: phase, tickets, waits, blockers, unverified claims, staleness. |
| `saipen validate` | Run the conformance checks. |
| `saipen stop` | Checkpoint and halt. |

More: `saipen hunt` forces a defect sweep, `saipen markhunt` runs a dry audit
that fixes nothing, `saipen test` runs the declared tests and only reports,
`saipen clean` scrubs the board, `saipen prepare` / `saipen collect` package
and integrate handoff work, `saipen ship` runs release gates, and
`saipen brief` prints a cold-handoff summary.

## Shortcut keys

A shortcut is **the whole message**, never a prefix. `cc` continues, `sss`
reports status, `st` stops. Repeated letters are not a pattern: a key means
something only if the registry declares it, and an unknown token stays
unknown.

The complete key map, the full command vocabulary and the Cyrillic twins are
generated from the registry on the [commands reference page](/spec/v8/commands/).

> [!NOTE]
> Since SAIPEN 8.0.0 the stop shortcut is `st`. The old `ss` was retired
> because `ss` and `sss` (status) were too easy for agents to confuse; it now
> performs no action.

## Compound messages

A message containing several commands is split before interpretation. Quoted
text is opaque payload; malformed quoting refuses the whole message. Every
recognised segment gets a recorded outcome, and the default chain policy is to
stop on the first failure.

## User requests are captured first

A new, actionable request is persisted — as an intake receipt and a board
ticket — before any unrelated completion work, so a request is never lost
because the agent was busy finishing something else. Questions,
explanations and stop requests create no ticket.
