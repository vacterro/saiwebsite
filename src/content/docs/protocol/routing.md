---
title: Deterministic routing
description: How a bare continue decides what to do — six priorities, first match wins, and a mechanical rule for which ticket is next.
section: protocol
order: 2
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: 111-determinism-invariants, label: CORE.md §1.11 Determinism invariants }
  - { path: saipen/CORE.md, anchor: protocol-state-repair-contract-normative, label: CORE.md — Protocol-state repair contract }
---

Two different agents given the same project files must choose the same next
step. SAIPEN makes that choice mechanical.

## The continuation pipeline

`cc`, a bare `saipen` and `saipen continue` all run one implementation:

```text
resolve install -> resolve project -> recover journal -> reconcile metadata -> validate -> route
```

A dry run plans the same steps against the projected post-recovery state,
writes nothing, and must surface the same refusal the real run would.

## Action priority

Routing walks a fixed list; the first match wins.

1. **RECOVER** — interrupted operations and deterministic state drift.
2. **OBEY** — the current user command or objective. It supersedes the
   persisted `next_action`, and every segment of a compound message gets a
   disposition; a deferred segment is persisted, never dropped into chat.
3. **UNBLOCK** — only from fresh evidence or explicit authority.
4. **FINISH** — the one DOING ticket, whoever claimed it after legal adoption.
   Never abandoned to start something more attractive.
5. **START** — the topmost workable TODO ticket.
6. **MAINTAIN** — only when no real Work remains and the active intent
   authorizes maintenance.

## Which ticket is "topmost workable"

A ticket is workable when it is in TODO, every `needs:` dependency is DONE,
it has no blocker and no foreign live claim, and no operator gate precedes it.
The pick is the topmost workable line in board order — board order is
priority. A release ticket whose required tickets are blocked is never chosen
while independent workable Work exists.

## Invariants that keep routing honest

- **Read to the end.** A truncated observation of a file, list or command
  output proves neither emptiness nor closure.
- **Do not guess.** A next step that requires "presumably" stops at the exact
  missing fact.
- **Missing authority is a WAIT; operational choices are not.** Product
  intent, destructive authority, secrets and external choices are real human
  boundaries. Ordering, repair and stale evidence are agent work.
- **Same fingerprint twice is a stall.** The same actionable result twice
  without a qualifying state change is reported as stalled, not silently
  polled.
- **Thinking is not progress.** Every session that acts leaves durable
  evidence; a read-only session names what it inspected and what it did not
  write.
