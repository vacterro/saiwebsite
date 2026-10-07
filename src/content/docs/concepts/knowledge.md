---
title: KNOWLEDGE
description: Durable, verified project truth — decision records and optional knowledge cards — kept apart from the transient event log.
section: concepts
order: 5
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: other-durable-paths, label: CORE.md §1.2 — Other durable paths }
  - { path: SPEC.md, anchor: architecture-decision-records-adr, label: SPEC.md — ADRs }
---

`KNOWLEDGE/` answers **what is the durable truth of this project?** It holds
facts that must survive sessions and are worth a future agent's attention:
architecture decisions, constraints, conventions.

The event log is not a good place for that. It is long, transient and
chronological; a decision buried at event 1,400 is a decision nobody will find.
SAIPEN therefore asks that structural decisions are persisted as architecture
decision records, for example `KNOWLEDGE/ADR-001-use-sqlite.md`.

## What belongs here, and what does not

Belongs: verified, reusable facts and decisions.

Does not belong: tasks (they go on the board), logs, guesses, protocol rules
(they live in the protocol), and never credentials.

## Knowledge cards

Optional `KNOWLEDGE/cards/*.md` lessons are promoted only when a lesson is
verified, reusable, decision-bearing, not cheaply derivable, not a duplicate,
not transient, and safe. The default is zero cards per piece of work and
normally at most one. A superseded card stays for forensics with a link to its
single active replacement.

## The index

`KNOWLEDGE/INDEX.md` is generated and deletable. A cold agent reads it and
loads only the relevant active cards instead of the whole folder;
`saipen knowledge index` rebuilds it. Reading knowledge logs nothing, but a
decision influenced by a card cites the card.
