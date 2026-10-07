---
title: Project memory
description: The .saipen/ folder, file by file — which parts are canonical state, which are scratch space, and which are evidence.
section: concepts
order: 1
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: 12-file-model, label: CORE.md §1.2 File Model }
  - { path: GUIDE.md, label: GUIDE.md — Memory, not just rules }
---

All SAIPEN state for a project lives in one folder at the project root:
`.saipen/`. Every unqualified path in the protocol means
`<project_root>/.saipen/<name>`, and changing the working directory never
changes that binding. Nothing is stored in a hosted database, and nothing is
lost when a session ends.

## Canonical state

These three files are the checkpoint. They are written in a fixed order and
validated together.

| Path | Role |
|---|---|
| `STATE.md` | YAML frontmatter: the current phase, task, mode, blocker and `next_action`. The commit pointer of the latest checkpoint. |
| `BOARD.md` | The Work authority: every ticket in exactly one of `## DOING`, `## TODO`, `## DONE`, `## BLOCKED`. |
| `LOG.md` | The append-only event graph: one bounded line per event, each with a unique `E-` id. |

## Durable knowledge

| Path | Role |
|---|---|
| `KNOWLEDGE/` | Verified, reusable project facts and architecture decision records. Not tasks, not logs, not guesses, never credentials. |
| `KNOWLEDGE/INDEX.md` | A generated, deletable projection that tells a cold agent which knowledge cards are relevant. |
| `IDENTITY.md` | The project identity carrier. Committed to Git once, so a fresh clone recovers the same identity. |

## Working and evidence areas

| Path | Role |
|---|---|
| `kitchen/` | Scratch space: transient plans, digests, generated packages, rollback material. Never canonical; if an agent dies, the next one can pick up half-finished work here. |
| `intake/` | Captured source material — a substantial request, audit or specification — stored exactly, with a contract and coverage, so a ticket summary never replaces the original. |
| `recovery/` | Operation journals and preserved corrupt checkpoints. Never deleted to make validation green. |
| `logs/` | Sealed `LOG-NNN.md` segments, once the active log crosses its size cap. Cold history, read only for audits and counter rebuilds. |

## Plain files on purpose

Because everything is Markdown, the state is human-readable, diffable and
reviewable in Git. You can open the project root as an Obsidian vault:
`KNOWLEDGE/` shows up in the graph and `[[wikilinks]]` work. If something goes
wrong, you can open the files in a text editor and see what happened.

> [!WARNING]
> Never write API keys, tokens or passwords into any of these files. The
> recovery and log-sealing machinery copies content verbatim by design, so a
> secret that reaches `STATE.md` or `LOG.md` is archived with it. If one does,
> rotate it.
