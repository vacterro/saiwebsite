---
title: Why a gate must prove it can fail
description: A green check that could never have turned red is not evidence. SAIPEN makes every gate show a red control first — and so does this website.
date: 2026-10-07
kind: design-note
---

Most test suites are trusted because they are green. That is backwards. A
check is worth exactly as much as the bad input it would have rejected, and a
check nobody has ever seen fail might not be able to.

## How gates go dead

They do not announce it. A few ordinary ways:

- the test runner collects zero tests and exits 0;
- a target path moved, so the check inspects nothing;
- a CI step has `continue-on-error` or a trailing `|| true`;
- the check catches its own failure and reports success;
- a fixture was "fixed" until the test passed, so the test no longer tests the
  behaviour it was written for.

Each of these produces a green run. An agent that reads green as done will
close the ticket, the next agent will trust the closure, and the defect walks
straight through the process with everyone's approval.

## The rule

SAIPEN's VERIFY phase states it bluntly: a gate that cannot fail is not a gate.
Before relying on a new or inherited check, give it a known-bad input and show
it go red. Without both the real run and the red control in the log, high
confidence is not allowed.

For a bug fix, the known-bad input is the bug itself: restore the pre-fix code,
change nothing about the test, and watch it fail; then apply the fix and watch
the same test pass. The only variable between red and green is the
implementation — never the definition of success.

The rule also runs the other way. Before reporting "everything is broken",
run a known-good control. A gate stuck red lies as loudly as one stuck green.

## What it looked like here

Every quality gate of this website was broken on purpose before it was
believed:

- the pixel gate had to detect an anti-aliased circle and a line of text
  shifted by a fraction of a pixel;
- the content validator had to catch a broken link, a missing anchor and a
  duplicate id planted in a built page;
- the style lint had to reject a rounded corner, an opacity and a font size
  without its pixel face — and the first attempt at that control exposed a bug
  in the lint itself;
- the build audit had to reject a playground step that made an illegal phase
  move;
- the snapshot check had to notice a one-byte edit to the protocol registry.

The most useful result came first: when the pixel gate was switched on, it
failed every page of the site. A gate that passes on day one has told you very
little. One that fails on day one, for reasons you then fix and understand, has
earned its green.
