---
title: Checkpointing
description: LOG, then BOARD, then STATE — written in a fixed order and read back, so an interruption at any point leaves recoverable state.
section: protocol
order: 3
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: checkpoint, label: CORE.md §1.5 — Checkpoint }
  - { path: saipen/REGISTRY.json, label: REGISTRY.json — checkpoint_order }
---

<!-- i18n:docs.protocol.checkpointing.intro -->
A checkpoint happens after each phase transition, after each ticket, and
before stopping. Its write order is fixed by the registry:

```text
1. LOG.md    append one event, re-read the tail
2. BOARD.md  atomic write, re-read the affected Work
3. STATE.md  atomic write last, validate and re-read every required field
```

<!-- i18n:docs.protocol.checkpointing.why-this-order -->
## Why this order

Each step makes the next one derivable. The log line is the evidence; the
board reflects the Work change the log describes; STATE is written last and
acts as the **commit pointer**. If the agent dies after step 1 or 2, recovery
finds a log event (and perhaps a board change) newer than STATE and derives
the correct state from them. If it dies after step 3, the checkpoint is
complete.

STATE records the current schema, the actual highest event id, the style
marker, the real UTC time, the current phase and task, and the deterministic
next action.

<!-- i18n:docs.protocol.checkpointing.readback-is-the-evidence -->
## Readback is the evidence

A success message from a writer is not evidence. Each file is re-read after it
is written, and STATE is validated field by field. "I saved it" is a claim;
the readback is the proof.

<!-- i18n:docs.protocol.checkpointing.atomic-writes-honestly-bounded -->
## Atomic writes, honestly bounded

Canonical files are replaced with temp-file-plus-rename ordering. That gives
atomic replacement on a local or shared filesystem; it is not an fsync
durability guarantee beyond what the host filesystem itself promises. The
[guarantees page](/docs/evidence/guarantees/) states this boundary plainly.
