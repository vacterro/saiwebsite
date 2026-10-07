---
title: Why project memory lives beside the project
description: Plain files in the repository instead of chat history, a vendor's memory feature or a database — and what that buys when agents keep changing.
date: 2026-10-07
kind: design-note
---

Every AI coding tool now offers some kind of memory: long chat histories,
"memories" a vendor keeps for you, retrieval over past sessions. SAIPEN keeps
its memory somewhere much more boring: Markdown files in a `.saipen/` folder,
next to the code, committed with it.

## The arrangement it replaces

The usual chain is `Project -> Memory -> LLM`: the project's working knowledge
lives in whatever the current tool remembers. Change the tool, the model or
the account, and the chain breaks. SAIPEN's specification turns it around:
`Project -> SAIPEN State -> LLM`. The memory belongs to the project, and any
agent is just a reader of it.

## What boring files buy

- **Portability.** Any agent that can read files can continue. No export, no
  integration, no vendor's permission.
- **Inspection.** You can open the state in a text editor and see exactly what
  the next agent will see. If something went wrong, you can read why.
- **History.** Git already versions files. Every checkpoint is diffable, and a
  bad decision can be found in the log instead of being lost in a closed
  session.
- **Review.** State changes arrive in the same pull request as the code they
  describe.
- **Survival.** The project outlives the tool. A memory feature that is
  discontinued, rate-limited or reset takes nothing with it.
- **Checkability.** Because the format is fixed, a validator can check it:
  STATE shape, legal transitions, the ticket graph, the event chain.

## What it costs

Files are not a database. SAIPEN is explicit that it provides single-writer
semantics on a shared filesystem, not distributed consensus; agents on
disconnected machines need external coordination. Atomic writes are
temp-file-plus-rename, not more durable than the disk under them. And files
grow, which is why the log seals old segments and a cold agent reads bounded
slices rather than everything.

Those limits are stated in the specification rather than hidden, and for the
problem SAIPEN solves — the next agent knowing exactly where the work stands —
they are the right trade.

## The test

If every chat window you have ever opened were deleted tonight, could a new
agent continue your project tomorrow morning without asking you anything? With
memory beside the project, the answer is yes.
