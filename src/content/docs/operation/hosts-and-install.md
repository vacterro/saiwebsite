---
title: Hosts and installation
description: Which agent hosts the installer configures, what it writes, and why enforcement strength differs from host to host.
section: operation
order: 2
maturity: stable
authority: engineering
sources:
  - { path: README.md, anchor: quick-start, label: README — Quick start }
  - { path: extensions/adapters/registry.json, label: Adapter registry }
  - { path: SECURITY.md, label: SECURITY.md — Scope }
---

SAIPEN is plain files plus instructions; a host is the agent program that
reads them. The installer (`bootstrap/inject.ps1` or `inject.sh`) teaches each
supported host about SAIPEN once per machine.

## What the installer writes

- **A marked instruction block** (`SAIPEN:BEGIN` / `END`) in each supported
  host's instruction file, such as `CLAUDE.md`, `AGENTS.md` or `GEMINI.md`. The
  original is backed up to `<file>.bak` before the first change.
- **A copy of the runtime** in each host's skill folder. These copies are
  SAIPEN-owned; hand edits inside them are lost on the next install or
  uninstall.
- **Guard hooks** for hosts that support them, keeping unrelated settings.

The README lists Claude Code, Codex, Gemini, OpenCode, Aider, Antigravity and
generic `~/.agents/skills` readers; per-platform notes for other hosts live in
`extensions/adapters/`.

## Enforcement is declared per host

Hosts differ in what they let a protocol enforce. The adapter registry is the
single declarative list of hosts, and it separates several claims for each:

- **Declared strength** — `BLOCKING` (a hook can refuse an action),
  `ADVISORY` (the rules reach the model as instructions) or
  `ENFORCEMENT_GAP` (the host offers no usable interception).
- **Response enforcement** — whether the final-response contract can be
  checked mechanically, only advised, or not at all.

These are claims about a healthy, current install. Effective enforcement is
computed at runtime and is never stronger than the installed state proves.
The [compatibility matrix](/compatibility/) renders every host and claim
straight from the registry.

## Removal

`bootstrap/uninstall.ps1` or `uninstall.sh` strips the marked blocks and hook
entries and removes unchanged installed files, writing `<file>.uninstalled.bak`
first. Your other settings, hooks, skills, later edits and every project's
`.saipen/` memory are preserved.
