---
title: Why SAIPEN
description: Chat history, instruction files and issue trackers each carry part of a project's state. SAIPEN carries the part a cold agent needs to resume.
section: getting-started
order: 2
maturity: stable
authority: explanation
sources:
  - { path: README.md, anchor: why-not-just-chat-history, label: README — Why not just chat history? }
  - { path: SPEC.md, anchor: the-saipen-litmus-test, label: SPEC.md — Litmus test }
---

SAIPEN targets one specific failure: an AI coding agent that remembers nothing
once the session ends. Other tools and habits cover part of that problem.

| Approach | Good for | Does not carry |
|---|---|---|
| Chat history / model memory | Convenient, zero setup | It is session- and vendor-dependent and is not stored with the project, so a cold agent never sees it. |
| Static `AGENTS.md` / instruction file | Durable standing rules and conventions | Live task state, `next_action` or recovery history. |
| Issue / TODO tracker | Task and backlog management | Continuation semantics: what a cold agent must read and execute on resume. |
| **SAIPEN** | Live execution state, work queue, event history, durable knowledge and machine-checked continuation rules, in plain files next to the code | Nothing on this list; that combination is the contract. |

The difference is not any one file. It is that the resume step becomes
**machine-checkable**: a cold agent's first action after `saipen continue` is
dictated by the persisted `next_action` and verified by a validator, not
reconstructed from memory or from a long instruction file.

## Project state over model memory

The specification states the design goal directly: a cold agent with zero
chat history must be able to execute `/saipen continue` and resume productive
work within one minute, without asking the user to repeat context.

That shifts the arrangement from `Project → Memory → LLM` to
`Project → SAIPEN State → LLM`. The memory belongs to the project. One model
today, another tomorrow, a third the day after — they all operate against the
same state.

## The litmus test

Every proposed change to the protocol must answer three questions:

1. Does it make the transition between agents more reliable?
2. Does it make the behaviour of different models more uniform?
3. Does it reduce the probability of context loss?

If the answer is "no" to at least two, the idea is rejected. SAIPEN prefers
discipline, reproducibility and reliability over novelty — which is also why
this website describes only behaviour the protocol actually has.

## Who it is for

SAIPEN is useful when you work with several coding agents, keep hitting
session limits, switch models by price or availability, run projects longer
than one conversation, or want to see the difference between "done" and
"proven". It is built on plain files and plain Git, so it is equally useful
when you simply do not trust the memory of a chat.
