---
title: Corrupt and stale state
description: What counts as stale versus corrupt, how recovery preserves the damaged file, and why validation never goes green by deleting evidence.
section: recovery
order: 3
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: authority-and-binding, label: CORE.md §1.1 — Authority and binding }
  - { path: saipen/CORE.md, anchor: recovery, label: CORE.md §1.5 — Recovery }
---

<!-- i18n:docs.recovery.corrupt-state.stale -->
## Stale

State is **stale** when it is behind the evidence: `last_event` lower than the
highest real event id, a style marker from an older `STYLE.md`, a board
checkbox that disagrees with its section, or a checkpoint written by another
agent after the current one last looked. Stale state is repaired
deterministically from the evidence, and any facts the agent remembered are
discarded and re-read.

<!-- i18n:docs.recovery.corrupt-state.corrupt -->
## Corrupt

State is **corrupt** when it contradicts itself or the evidence in a way that
cannot be derived away: a `last_event` higher than any real event, a STATE
written by a newer incompatible schema, a dead project identity, two records
that both claim authority. Corrupt state is refused with an exact reason. A
newer-than-supported state is read-only, never down-converted by guesswork.

<!-- i18n:docs.recovery.corrupt-state.preserved-never-deleted -->
## Preserved, never deleted

The damaged STATE is copied into `.saipen/recovery/` before repair, and
unresolved recovery evidence is never deleted to make validation pass. Legacy
readable states are upgraded at the next canonical checkpoint, not rewritten
on read.

<!-- i18n:docs.recovery.corrupt-state.future-timestamps -->
## Future timestamps

A log event stamped in the future cannot simply be waited out or edited. It is
repaired by a declared decision event naming the original and replacement
stamps, so the append-only log stays append-only.
