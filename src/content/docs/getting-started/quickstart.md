---
title: Quickstart
description: Install SAIPEN once per machine, adopt a project, resume it from a cold agent, validate, and remove it cleanly.
section: getting-started
order: 4
maturity: stable
authority: engineering
sources:
  - { path: README.md, anchor: quick-start, label: README — Quick start }
  - { path: GUIDE.md, label: GUIDE.md }
---

Requirements: **Git, Python 3.11 or newer**, and a coding agent. No `pip`
install, account, server or daemon. Keep the clone until you uninstall: the
installed agent instructions and update checks refer to its location.

## 1. Clone once

```bash
git clone https://github.com/vacterro/saipen
cd saipen
```

## 2. Install once per machine

Windows (PowerShell):

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap\inject.ps1
```

macOS, Linux or Git Bash:

```bash
bash bootstrap/inject.sh
```

The installer adds a marked SAIPEN block to supported agent instruction files
(backing up the originals first), copies the runtime into skill folders and
installs the matching guard hooks, keeping your unrelated settings. Restart an
agent that was already running. Which hosts are supported, and how strongly
each one can enforce the protocol, is on the
[compatibility page](/compatibility/).

## 3. Adopt a project

Open your own project in the agent and type these as chat commands:

```text
saipen set
saipen continue
saipen validate
```

`set` creates the project's `.saipen/` memory. In a new, empty project
`continue` asks for the first goal or backlog; give the agent your task. In
later sessions — tomorrow, with another model, after a crash — the same
`saipen continue` resumes. `validate` must report PASS.

## 4. Commit the memory once

```bash
git add .saipen && git commit -m "saipen: init project memory"
```

Until you do, `validate` refuses with `.saipen/IDENTITY.md exists but is not
tracked by git`: the identity carrier is what lets a fresh clone recover the
same project identity. After that, ordinary commits keep the memory.

> [!NOTE]
> The same checks run from a terminal without the agent. The launcher is
> installed with the skill, for example
> `"$HOME/.agents/skills/saipen/bin/saipen" continue` on macOS and Linux, or
> `& "$env:USERPROFILE\.agents\skills\saipen\bin\saipen.cmd" continue` in
> PowerShell. No PATH change is required.

## Uninstall

From the clone, Windows:

```text
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap\uninstall.ps1
```

macOS, Linux or Git Bash:

```bash
bash bootstrap/uninstall.sh
```

Removal strips the marked instruction block and SAIPEN hook entries and
removes unchanged installed files. It preserves your other settings, hooks and
skills, your later edits, backups, and every project's `.saipen/` memory.

## Try it without installing

Tell your agent to read `<clone>/saipen/BOOT.md` and follow its cold-start
router.
