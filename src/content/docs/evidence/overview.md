---
title: Evidence overview
description: In SAIPEN "done" is a claim until evidence is recorded — commands, results, witness surfaces and confidence, written where the next agent can check them.
section: evidence
order: 1
maturity: stable
authority: engineering
sources:
  - { path: saipen/CORE.md, anchor: logmd, label: CORE.md §1.2 — LOG.md and acceptance evidence }
  - { path: SPEC.md, anchor: work-attempts-and-completion-authority, label: SPEC.md — Completion authority }
  - { path: BROCHURE_EN.md, label: Brochure — Demand evidence }
---

SAIPEN is built against familiar model habits: claiming a file was read when
it was not, saying tests passed without running them, inventing a plausible
path, stopping after the first green result. The answer is a trail that
anyone can check.

## What counts as evidence

- **A log event with the exact command and its result.** Test and validation
  claims name the command, PASS or FAIL, and a confidence where required.
- **A durable detail artifact** for anything too long for one log line — full
  command output, matrices, transcripts — hashable and referenced from the log.
- **The board change** that the evidence justifies, and the STATE checkpoint
  that commits it.

What does not count: a summary, a promise, or an agent's own assertion that it
finished. Those are claims until verification evidence recorded *after* them
admits the transition.

## Witness surfaces

Acceptance evidence declares how close to reality it was gathered, from a
closed set:

| Witness | Meaning |
|---|---|
| `UNIT` | An isolated unit check. |
| `INTEGRATION` | Components exercised together. |
| `EFFECT_PATH` | The real effect path the user depends on. |
| `LIVE` | The live system. |
| `MANUAL` | A person checked and reported. |

A criterion can demand a minimum, for example `AC-01 [EFFECT_PATH] ...`. A
narrower PASS is reported as `EVIDENCE_SCOPE_TOO_WEAK`, not satisfied. If a
defect escapes later, an `AC-ESCAPED` record links it to the exact earlier PASS
without rewriting either event.

## Retention

Evidence is kept minimal and durable: proof is extracted from each run, and
throwaway execution environments — caches, synthetic home folders, copied
repositories, `node_modules` — are removed. Before any cleanup, historical
evidence is classified; only data proven reproducible or superseded is
collectable, and unknown data stays.
