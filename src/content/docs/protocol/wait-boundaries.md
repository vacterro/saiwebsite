---
title: WAIT boundaries
description: The seven reasons an agent may stop and ask a human — and why "I would rather not look at that file" is not one of them.
section: protocol
order: 5
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: statemd, label: CORE.md §1.2 — next_action WAIT form }
  - { path: GUIDE.md, anchor: when-agent-cant-do-something, label: GUIDE.md — When agent can't do something }
---

<!-- i18n:docs.protocol.wait-boundaries.intro -->
An agent following SAIPEN must not guess — but it also must not stop out of
convenience. Stopping is a protocol action with a fixed shape:

```text
WAIT: <category> -- <one concrete sentence>
```

The category is one of seven, and it tells the human what kind of answer
unblocks the work:

| Category | Used when |
|---|---|
| `manual-verify` | A check needs a person to run it and report PASS or FAIL. |
| `destructive-op` | The next step is destructive and not pre-authorized. |
| `first-publish` | The project would be published somewhere for the first time. |
| `user brake` | The user asked the agent to stop. |
| `blocked` | A concrete hard boundary: a missing fact, credential or external resource. |
| `safety valve` | An autonomous run reached its cap and needs re-authorization. |
| `init` | The project has no SAIPEN memory yet and needs a first goal. |

Answer the question and the agent continues.

<!-- i18n:docs.protocol.wait-boundaries.what-is-not-a-wait -->
## What is not a WAIT

- Queued work. It goes on the board.
- Ordering, repair or stale evidence. That is the agent's job.
- A note for the human. It goes in the digest.
- "Presumably" — a guess dressed up as a question. The agent names the exact
  missing fact, why the repository cannot supply it, and what depends on it.

At DONE with no workable ticket left, only the fixed `user brake`,
`safety valve` and `first-publish` waits are legal: a finished board resumes
its persisted intent rather than asking for an invented objective.
