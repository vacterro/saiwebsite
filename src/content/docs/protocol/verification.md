---
title: Verification
description: VERIFY runs real evidence with the strongest available harness, and every gate must first prove that it can fail.
section: protocol
order: 4
maturity: stable
authority: engineering
sources:
  - { path: saipen/phases/verify.md, label: phases/verify.md — VERIFY }
  - { path: saipen/CORE.md, anchor: 16-core-state-machine--ticket-dag, label: CORE.md §1.6 }
---

VERIFY proves the current ticket works before REVIEW. It uses the
repository's own harness, strongest available, cheapest first:

```text
parse -> import -> unit -> repro -> smoke
```

The first failed **mandatory** gate ends the PASS claim for this pass; later
green cannot repair it. A failure is advisory only when the repository or
ticket explicitly says so — unclassified gates are mandatory. The ticket's
`verify:` field is the minimum check, not the whole of it.

## A gate that cannot fail is not a gate

Before relying on a new or inherited check, the agent gives it a known-bad
input and proves it goes red. Zero collected tests, missing targets,
`continue-on-error`, `|| true` or a self-caught failure all count as
**unverified**. Without both the real run and a deliberate red control in the
log, high confidence is forbidden.

The converse holds too: before reporting a broad negative, the agent runs a
known-good control. If the instrument cannot recognise it, the result is a
broken verifier, not a failed subject.

## Fixing a bug requires a regression that failed first

The same test, fixture, oracle and configuration must be red against the
pre-fix code and green against the fix. The variable between red and green is
the implementation, never the definition of success. Weakening the fixture to
get green is exactly the failure this rule exists to stop. Tickets that owe
this comparison carry a machine-owned `regression: required` field.

## When a human has to check

If a check needs a person — a GUI, a device, an environment the agent cannot
reach — the agent logs `MANUAL-VERIFY STEPS + EXPECTED`. That is a request,
not a verdict. The verdict is a separate event beginning
`MANUAL-VERIFY RESULT: PASS` or `MANUAL-VERIFY RESULT: FAIL`, written only
from what the human reported.

## Confidence

A VERIFY result ends with `conf: high` for green tests (with controls),
`med` for smoke only, or `low` for manual evidence. New non-trivial logic
requires a repository-style test.

> [!EXAMPLE]
> This website follows the same rule: its pixel-perfect gate proves it can go
> red by rendering a deliberately anti-aliased circle and a sub-pixel-shifted
> text run before it is trusted to report that every page is clean.
