---
title: "How SAIPEN is built: one operator, many agents"
description: The working loop behind the protocol — narrow targets, interchangeable agents, verification first, independent audits, and handoffs that need no briefing.
date: 2026-10-07
kind: design-note
---

SAIPEN reads like a protocol specification, and it is one. But it was not
designed in the abstract and then tried out. It is the written-down form of a
way of working: one human operator, many projects, and a rotating cast of AI
coding agents from different vendors doing much of the implementation.

This note describes that loop, because it explains most of the protocol's
choices better than the rules themselves do.

## The loop

```text
idea -> narrow target -> agent -> VERIFY -> audit -> handoff -> another agent -> ...
```

**Idea.** Work starts from a problem met while running real projects — an
agent that keeps asking the same questions, a release that looked done and was
not, a quota that ran out mid-ticket. Not from a hypothetical agent stack.

**Narrow target.** The idea becomes a ticket with a `verify:` contract small
enough to prove. Big ambitions are split until each piece has a check that can
fail. This is why SAIPEN insists that batch input is parsed into separate
tickets before anything is built.

**Agent.** Whichever model and host is available and suited takes the ticket:
a strong model for an architecture change, a cheaper one for a mechanical
sweep, a different vendor when one provider has a bad hour. The protocol makes
that a non-event, because the agent reads the project, not a chat.

**VERIFY.** The agent proves the change with the strongest check the
repository has — and first proves that the check can go red. A green run from
a gate that cannot fail counts for nothing.

**Audit.** An independent review follows, often by a different model that did
not write the code and has no stake in it being right. Its findings come back
as evidence and new tickets, not as a conversation to remember.

**Handoff.** The session ends — by design, by limit or by accident. The state
is already on disk: the last checkpoint, the evidence, the exact next action.

**Another agent.** Tomorrow, or in ten minutes, a different agent runs
`saipen continue`. It does not need a briefing. The human's job is direction
and decisions, not retelling.

## The human's role

The operator does not write most of the code and does not babysit every
continuation. The operator:

- chooses what is worth building and in what order;
- answers the real questions — the seven WAIT categories exist so that those
  questions arrive precisely and nothing else interrupts;
- authorizes what is destructive or public;
- reads audits and decides which findings matter.

That division is deliberate. Agents are good at doing and bad at remembering;
people are good at deciding and tired of repeating themselves.

## The tools that grew out of it

Running this loop across many projects produced its own tooling, which is now
part of the [ecosystem](/ecosystem/):

- **ZAICODE** — an operator workbench that starts, continues and schedules
  agents across many SAIPEN projects from one window.
- **AUDAPACK** — clean project archives and multi-wave audit handoff, with
  captured audits enqueued into a project through the SAIPEN CLI.
- **SAIPAL** — a forensic observer that compares what an agent did against the
  protocol version that governed the session, and reports drift as evidence.
- **SAICONT** — a watcher that sends the continue shortcut to a stalled
  terminal agent, only after a verified failure.
- **LIMISAW** — a tray monitor for quota windows across vendors and accounts,
  because limits are the most common reason a session ends.

Each of them answers a moment in the loop where the human used to be the glue.

## The site itself

This website was built the same way: tickets on its own SAIPEN board, agents
taking them one at a time, every gate proven able to fail, an outside review
turned into the next ticket. The [About page](/about/#dogfooding) shows that
board, read from the repository at build time.

> Built by one human working with replaceable AI agents. The agents change.
> The project state survives.
