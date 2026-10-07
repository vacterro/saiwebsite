---
title: Recovery overview
description: Recovery is a routine first step of every continue — preserve, derive from evidence, reconcile, validate, route. Idempotent by rule.
section: recovery
order: 1
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: recovery, label: CORE.md §1.5 — Recovery }
  - { path: saipen/CORE.md, anchor: protocol-state-repair-contract-normative, label: CORE.md — Protocol-state repair contract }
---

SAIPEN assumes every agent may vanish mid-word. It does not try to prevent
that; it makes it survivable. Recovery is therefore not an emergency
procedure but the first stage of every `saipen continue`.

## The procedure

Recovery is read-only in `read-only` mode. Otherwise:

1. **Preserve.** A corrupt or stale `STATE.md` is copied to
   `.saipen/recovery/<timestamp>-STATE.md` before anything else.
2. **Recover journals first.** Conflicting or ownership-unsafe evidence is
   refused, not merged.
3. **Find the Work.** A DOING ticket on the board outranks the log. Otherwise
   the newest open ticket event wins; with none, the state rebuilds to DONE.
4. **Derive phase, task and next action** from BOARD and LOG. File times only
   help distinguish interrupted writes, and never as the sole proof.
5. **Derive counters from the full event chain** — schema, style marker,
   `last_event` — including sealed log segments. No invented legacy evidence.
6. **Reconcile** board checkboxes and STATE counters, validate, and route.

## Idempotent by rule

A second recovery run over unchanged evidence writes nothing. Deterministic
drift is repaired; contradictory authority returns a precise CORRUPT or
BLOCKED result, never a guessed state.

## Three outcomes

| Class | Meaning | Result |
|---|---|---|
| Deterministic drift | A checkbox, counter, schema or style marker out of step with the evidence | REPAIRED, with a warning |
| Structural corruption | Dead or incompatible identity, contradictory records | CORRUPT — refused until resolved |
| Irreducible ambiguity | Two readings of the evidence that the files cannot decide | BLOCKED, naming the record and the decision needed |

The validator's output is a sensor, never authority to falsify state. Repair
proceeds in a fixed order: preserve truth, preserve valid evidence, refresh
stale evidence, reconstruct traceability, normalise representation,
revalidate.

Continue with [interrupted work](/docs/recovery/interrupted-work/) for the
common case: an agent that stopped halfway.
