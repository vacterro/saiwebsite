---
title: FAQ
description: Direct answers to the predictable questions — agent framework, models, cloud, local use, crashes, retries, evidence and openness.
section: reference
order: 2
maturity: stable
authority: explanation
sources:
  - { path: README.md, anchor: what-saipen-is-not, label: README — What SAIPEN is not }
  - { path: SPEC.md, label: SPEC.md }
  - { path: LICENSE, label: LICENSE (MIT) }
---

## Is SAIPEN an agent framework?

No. It is a protocol that agents follow. It does not run models, call tools or
host agents; the agent you already use reads the `.saipen/` files and the
protocol documents and behaves accordingly.

## Does it require a specific model?

No. It is vendor-neutral by design: the point is that one model can stop and a
different model, in a different host, can continue from the same files.

## Does it require cloud infrastructure?

No. Install, state, checks and uninstall are all local. There is no server,
daemon, database or account, and the scripts transmit no data.

## Can it run entirely locally?

Yes — that is the only way it runs today. State is plain files in your
project; the validator and tooling use only Python's standard library.

## What happens when an agent crashes?

Nothing is lost that was checkpointed. The next agent runs `saipen continue`,
recovery closes the interrupted attempt, and routing finishes the ticket that
was in progress before starting anything new. See
[interrupted work](/docs/recovery/interrupted-work/).

## What happens when a provider is unavailable?

The same thing, from SAIPEN's point of view: the agent stopped. Switch to
another model or host, run `saipen continue`, and work resumes from the last
checkpoint. SAIPEN does not promise provider availability; it makes losing a
provider survivable.

## How is recovery different from retry?

A retry repeats an action. SAIPEN forbids repeating a failed action unless
something changed — input, evidence, environment or hypothesis — and the
change is logged. Recovery rebuilds a consistent state from evidence and then
routes to the next correct step, which may well be a different action.

## What is evidence?

A recorded command and its result, a durable artifact, a board change justified
by them — something the next agent can check. An agent saying "done" is a
claim, not evidence. See [evidence](/docs/evidence/overview/).

## Is the protocol open?

Yes. The SAIPEN repository is MIT-licensed, and the specification, the phase
documents, the registry and the validator are all in it.

## Is SAIPEN Cloud required?

No. There is no hosted SAIPEN service today; see [pricing](/pricing/) for the
plain statement. Any future hosted service would be optional by design, and
the open, local path would not be weakened to push anyone towards it.

## Does it replace Git?

No. Git still owns version history. Commit `.saipen/` like any other part of
the project.
