---
title: Introduction
description: What SAIPEN is, what it keeps, and the one command that lets a different agent continue your project without a briefing.
section: getting-started
order: 1
maturity: stable
authority: explanation
sources:
  - { path: README.md, label: SAIPEN README }
  - { path: SPEC.md, anchor: abstract, label: SPEC.md — Abstract }
---

SAIPEN is a **continuation protocol for AI coding agents**. It keeps a
project's working memory in plain Markdown files inside the project, in a
folder called `.saipen/`, so that any compatible agent — one with no chat
history and no session memory — can open the project, run one command and
carry on from exactly where the last agent stopped.

```text
saipen continue
```

or, as a whole message, just `cc`.

## The problem it solves

A coding agent remembers nothing once its session ends. It may have spent
twenty minutes learning the architecture, ruled out three hypotheses and
half-finished a fix; close the window, hit a usage limit or switch models, and
all of that is gone. The next agent starts from zero and the human explains
the project again.

SAIPEN moves that memory out of the conversation and into the project:

> The agent forgets. The project remembers.

## What persists

A cold agent answers five questions from the files alone:

| File / field | Answers |
|---|---|
| `STATE.md` | What is happening right now? Phase, active ticket, mode, blocker. |
| `BOARD.md` | What work exists? Tickets in DOING, TODO, DONE and BLOCKED. |
| `LOG.md` | Why did the project reach this state? An append-only event graph. |
| `KNOWLEDGE/` | Which durable facts must survive sessions? |
| `next_action` | Which exact action should the next agent execute? |

`STATE` is now, `BOARD` is work, `LOG` is history, `KNOWLEDGE` is reusable
truth. `next_action`, a field inside `STATE.md`, is the heart of the protocol:
it is never prose to interpret, always one immediately executable action.

## What makes it a protocol, not a habit

- **Fixed checkpoint order.** Every phase transition and every stop writes
  `LOG`, then `BOARD`, then `STATE`, and reads each back. `STATE` is the commit
  pointer of the checkpoint.
- **A strict state machine.** Work moves `INIT → PLAN → SCOUT → BUILD →
  VERIFY → REVIEW → SHIP → DONE`, with `BLOCKED` as the honest exit. A ticket
  cannot be called done after its first green test.
- **A validator.** A stdlib-only Python validator checks the files against
  the machine-readable contract: STATE shape, legal transitions, the ticket
  dependency graph, the event graph and recovery state.

## What it is not

SAIPEN is not a model, not an IDE, not a hosted memory database and not a
replacement for Git. It does not make an agent's engineering decisions
correct; it makes the state of the work explicit, checkable and resumable, so
that agents become replaceable.

Next: [Why SAIPEN](/docs/getting-started/why-saipen/) compares it with chat
history, instruction files and issue trackers, and the
[Quickstart](/docs/getting-started/quickstart/) installs it.
