---
title: Modes and capabilities
description: Two-way capability negotiation — the project states what it requires, the agent states what it has, and the result is an explicit operating mode.
section: concepts
order: 7
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: 13-capability-negotiation-two-way-handshake, label: CORE.md §1.3 Capability negotiation }
  - { path: SPEC.md, anchor: two-way-capability-negotiation, label: SPEC.md — Two-way capability negotiation }
---

Agents run in very different hosts: some have a shell and Git, some can only
read files, some cannot publish. SAIPEN does not let an agent quietly pretend
it can do what it cannot.

## The handshake

The project declares what it needs, for example
`requires: [filesystem, git, shell, python]` in `STATE.md`. Before any work,
the agent compares that list with its actual runtime capabilities. A missing
required capability **changes the mode**; it is never silently ignored, and
an unknown `requires` entry counts as unmet.

## The four modes

| Mode | What it permits |
|---|---|
| `full` | Authorized filesystem, process, network and Git effects. |
| `no-publish` | Local work, but no external publish. |
| `manual-verify` | VERIFY waits for a human to run the check and report the result. |
| `read-only` | No canonical write at all — not even writing the mode itself. |

In `read-only` mode the agent inspects and reports the exact repair it would
need; it does not claim the repair was applied. Phases that produce files —
INIT, PLAN, SCOUT, BUILD, SHIP, ADD, CLEAN, TRANSLATE, PREPARE — are
unavailable; VALIDATE, MARKHUNT, status and focus may run only when their
implementation stays read-only.

## Why it matters

When a host cannot run a command, SAIPEN says so and hands over the exact
command instead of inventing a result. `manual-verify` exists for the same
reason: a check that a person has to perform is recorded as a request first,
and the verdict is a separate event written only from what the person reports.
