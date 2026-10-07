---
title: Mental model
description: Four files, one pointer and a state machine. How to picture a SAIPEN project before reading the rules.
section: getting-started
order: 3
maturity: stable
authority: explanation
sources:
  - { path: README.md, label: SAIPEN README }
  - { path: saipen/CORE.md, anchor: 12-file-model, label: CORE.md §1.2 File Model }
---

<!-- i18n:docs.getting-started.mental-model.intro -->
Picture a workshop where the workers change every shift and nobody may rely on
being told anything by the previous worker. The workshop survives because the
job sheet on the bench says exactly what is going on and what to do next.
SAIPEN is that job sheet, kept in the project.

```text
Project
  |
  +-- .saipen/STATE.md ------ what is happening right now
  +-- .saipen/BOARD.md ------ what work exists
  +-- .saipen/LOG.md -------- why the project reached this state
  +-- .saipen/KNOWLEDGE/ ---- what durable facts must survive sessions
          |
          v
   saipen continue
          |
          v
      cold agent
          |
          v
     next_action -> work -> checkpoint -> next ticket
```

<!-- i18n:docs.getting-started.mental-model.three-ideas-carry-everything -->
## Three ideas carry everything

**1. Files outrank memory.** What is on disk is authoritative. If `STATE.md`
names another agent, or is newer than the acting agent's last write,
everything the agent remembers about the project is stale and must be re-read.

**2. One exact next step.** `next_action` is the pre-computed answer to "what
do I do right this second?". It always has one of a few machine-recognisable
forms — `PHASE BUILD T-12`, `RUN: <command>`, `saipen <command>`,
`RESUME: T-12 VERIFY`, or a `WAIT:` that names why a human is needed. An agent
does not re-plan the project every session; it executes the next step.

**3. Progress is evidence, not narration.** A phase advances only through a
checkpoint, and a ticket closes only through VERIFY, REVIEW and SHIP with
evidence recorded in the log. "Done" without evidence weighs nothing.

<!-- i18n:docs.getting-started.mental-model.how-a-session-looks -->
## How a session looks

1. A cold agent runs `saipen continue`.
2. SAIPEN binds the project, recovers any interrupted operation, reconciles
   derived metadata, validates and routes.
3. The agent executes the returned action: finish the ticket in progress,
   start the topmost workable ticket, or stop at a real human boundary.
4. Each step ends in a checkpoint: `LOG`, then `BOARD`, then `STATE`.
5. The session may end at any moment. The next agent starts again at step 1.

<!-- i18n:docs.getting-started.mental-model.three-layers -->
## Three layers

```text
CORE            continuation / state / checkpoint / validation   required
  └─ MAINTENANCE   autonomous HUNT / ADD / CLEAN evolution        optional
       └─ GOAL MODE / SUBAGENTS   throughput                      opt-in
```

Core never depends on the layers above it: with autonomous evolution switched
off, SAIPEN is still a complete continuation protocol and a cold agent still
resumes correctly.
