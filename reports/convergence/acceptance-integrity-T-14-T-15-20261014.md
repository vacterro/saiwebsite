# Acceptance-integrity reconciliation — T-14 and T-15

- Date: 2026-10-14
- Ticket: T-40 (source receipt SRC-019)
- Scope: restore truthful completion accounting for T-14 (M47 EN/ET/RU pilot)
  and T-15 (M50/M51 locale rollout) without rewriting history, reopening
  terminal tickets, or enabling any locale.
- Publication: none. No push, deploy, or public locale enablement was performed.

## Why this exists

T-14 and T-15 are recorded on the BOARD as `DONE` with
`closure_mode: finding_invalidated`. That mode asserts the ticket's PREMISE was
disproven by a recorded event, so no delta is owed. The recorded
`invalidation_evidence` events do not do that:

| Ticket | `invalidation_evidence` | What the event actually is |
|--------|-------------------------|----------------------------|
| T-14   | E-180                   | Sealed LOG-001: "SRC-012 reassigns implementation ... complete ET/RU pilot MACHINE_DRAFT translations now prepared and validated." The very next event, E-181, BLOCKS T-14: "genuine independent review and production publication approval are required before public i18n:enable." |
| T-15   | E-519                   | T-15's own BUILD checkpoint: "no implementation delta owed: i18n:scale infrastructure exists ...; operator locale selection is a release gate." |

E-180 documents translation *preparation* and is immediately followed by the
block that names the real remaining gates. E-519 is a scope-narrowing note in
the ticket's own chain, not a disproof of the premise. In both cases the
original acceptance contract was replaced by a narrower one at closure time.
The historical LOG and the DONE rows are left untouched here; this document and
the follow-up Work below carry the reconciliation instead.

## Live measurements (read-only, 2026-10-14)

- `npm run i18n:status` — `et` and `ru`: pilot, **disabled**, 99% renderable,
  **0% approved**; `REVIEWED 293 / MACHINE_DRAFT 4 / STALE 3` per locale
  (`requiredUnits 300`, `renderedUnits 297`, `approvedUnits 0`,
  `publicationCompletion 0`, `productionReady false`).
- `npm run i18n:validate` — OK: 19 red controls fired, every translation valid;
  both locales reported `disabled`.
- `npm run i18n:review -- --locale et` — `TRANSLATION_INCOMPLETE,
  INDEPENDENT_REVIEW_REQUIRED; 300 unit(s) need review or translation`.
- `npm run i18n:enable -- et --dry-run` (and `ru`) — **REFUSED**:
  `3 required unit(s) are not renderable (STALE)` and
  `requires independent review and CURRENT approval for 300 unit(s)`.
- `npm run i18n:scale` (offline capacity) — PASS, but self-declared
  `purpose: PROPOSED_NOT_OPERATOR_APPROVED`, `productionRegistryChanged: false`,
  `stressFixture.purpose: ENGINEERING_FIXTURE_NOT_PRODUCTION_LANGUAGE_SELECTION`,
  and `operatorDecisions` naming the unselected production sets.

Non-`REVIEWED` units per locale (authoritative from `i18n:status --json`):

- MACHINE_DRAFT (4): `about.principles.independence.line`,
  `about.dogfooding.body`, `about.dogfooding.closed`,
  `pricing.support.copy-failed`.
- STALE (3): `home.description`, `home.hero.lead`,
  `docs.getting-started.introduction.intro`.

`pricing.support.copy-failed` is a working-tree draft (`author: saipen-agent`,
uncommitted) and is therefore a fourth MACHINE_DRAFT unit beyond the three named
in `reports/convergence/review/six-unit-handoff.json`.

## Tests run (2026-10-14, current tree, locales unchanged)

- `npm run build` — completed; `dist/` contains `en` and the `qps-ploc`
  pseudo-locale only. There is **no `dist/et` and no `dist/ru`** directory,
  because both locales are disabled.
- `npm run test:i18n` — **63 passed**, 0 failed, 0 skipped. Every localized route
  exercised is the `qps-ploc` pseudo-locale; no ET/RU route exists to test.
- `npm run test:pixel` — **276 passed, 80 skipped**, 0 failed. Every skip is a
  WebKit `test.skip(browserName !== 'chromium', 'computed-style check; one
  engine is enough')` declaration, not a failure.
- `npm run site:refresh` (rc 0) and `npm run site:doctor` — `HEALTHY: 0 broken,
  0 stale`; the doctor's TRANSLATION WORK section lists all six STALE units
  (3 per locale) as `TODO [translation-stale]`.

These runs prove the monolingual site (plus the synthetic pseudo-locale) is
healthy. They do **not** prove the M47 multilingual acceptance — localized ET/RU
routing, longer-text Wintage layout, Cyrillic/diacritic pixel closure — because
no ET/RU page is built. That is the difference between E-509's PASS and T-14's
original contract.

## T-14 — original verification contract vs reality

Original `verify:` — "npm run i18n:status shows et and ru 100% with no STALE;
i18n:enable succeeds; build, site:refresh, site:doctor HEALTHY; test:i18n and
test:pixel pass".

| Clause | Status | Evidence |
|--------|--------|----------|
| et and ru 100%, no STALE | **NOT FULFILLED** | 99%; 4 MACHINE_DRAFT + 3 STALE per locale (`i18n:status`) |
| `i18n:enable` succeeds | **NOT FULFILLED** | refused by dry-run; `approvedUnits 0`; blockers `TRANSLATION_INCOMPLETE`, `INDEPENDENT_REVIEW_REQUIRED` |
| build / `site:refresh` / `site:doctor` HEALTHY | **NOT PROVEN AS SPECIFIED** | E-509 and a fresh run (2026-10-14) prove these only with et/ru DISABLED, i.e. a monolingual site; never with the pilot locales built (`dist/` has no `et`/`ru`) |
| `test:i18n` and `test:pixel` pass | **NOT PROVEN AS SPECIFIED** | fresh run: test:i18n 63 passed / test:pixel 276 passed + 80 WebKit-declared skips — but every localized route exercised is `qps-ploc`, so no ET/RU layout, overflow or glyph closure is covered |
| Locale enablement | **DEFERRED (operator/reviewer gate)** | `locales.json` keeps `et` and `ru` `enabled: false`, `publication: public` |
| Publication authorization | **EXTERNAL GATE** | `reports/release/GO-LIVE-CHECKLIST.md`: "Publication authorized: false"; "ET/RU publication stays disabled pending independent review" |

Distinguishing the layers the ticket conflated:

- Translation **drafting**: done (293 REVIEWED + 4 MACHINE_DRAFT per locale).
- **Independent review** (CURRENT/approved units): NOT done — `approvedUnits 0`;
  the six-unit handoff still awaits "a genuinely different reviewer".
- **STALE source revisions**: 3 units per locale where the English source moved;
  each renders the English fallback until re-translated.
- **Locale enablement**: not done, and currently refused.
- **Publication authorization**: an operator decision, not yet made.

## T-15 — original verification contract vs reality

Original `verify:` — "locales.json lists the operator-selected locales;
i18n:status reports each; build time, page count and index sizes recorded for 10
locales".

| Clause | Status | Evidence |
|--------|--------|----------|
| `locales.json` lists the operator-selected locales | **NOT FULFILLED** | registry holds only `en`, `qps-ploc`, `et`, `ru`; no operator-selected set exists |
| `i18n:status` reports each selected locale | **NOT FULFILLED** | only the four registered locales are reported |
| build time / page count / index sizes for 10 locales | **NOT FULFILLED for real locales** | the only 10-locale run is a disposable synthetic fixture (`reports/convergence/ten-locale-build.json`, `productionRegistryChanged: false`); no production registry was changed |

The infrastructure is genuinely complete and stays credited: `i18n:scale`,
`i18n:add` and the font-readiness analysis work and pass. What they demonstrate
is **scale-test capability**, not an operator-selected M50/M51 rollout. The
tooling itself states the operator has not chosen the sets.

## Work G — AUDAPACK / nested Wintage protocol tree (read-only)

- Exporter: `audapack 0.3.1` (`runtime_entrypoint: AUDAPACK.pyw`, `runtime_mode:
  gui`), per `_src_unpack/wintage/.audapack/manifest.json`
  (`kind: audapack_source_inventory`, `schema_version: 1`, `created_utc
  2026-10-07T00:09:53Z`, `git_head c62d89df...`, `git_dirty true`).
- Inventory: 1544 included files (28.6 MB), of which **1187 are `.saipen/**`
  paths** — the nested Wintage protocol memory tree: `STATE.md`, `BOARD.md`,
  `LOG.md`, `recovery/log-detail` (402), `archive/source` (240),
  `intake/contracts` (78), `intake/active` (60), `intake/tombstones` (37),
  `saitranslate/kitchen` (35+32), `kitchen` (64).
- The nested tree is a **foreign SAIPEN instance**: its
  `IDENTITY.md` lineage is `lineage-30ee844c69d34eb68605a4563cfdb8ff`, not this
  project's `lineage-a39aeeaeb2fb4e29a827bfee6f7974f7`. It is not this
  project's memory.
- Classification: **exporter-inclusion defect owned by AUDAPACK.** SAIPEN's own
  audit manifest (`MANIFEST.json`) declares `.saipen/` a non-exportable segment
  and `locks/`, `recovery/`, `quarantine/`, `LOCAL_STATE.json` non-exportable;
  AUDAPACK's inventory policy applies none of that, and `.gitignore` does not
  control AUDAPACK inclusion. This is a distribution-hygiene finding against
  AUDAPACK, not against this project.
- No source reference was deleted and no AUDAPACK internal was modified. The fix
  belongs to an AUDAPACK-owned task under its own authority (tracked as T-46).

## Remaining obligations and how they are tracked

Follow-up Work carries each unfinished obligation, links back to T-14/T-15 and
the evidence above, and keeps gate-blocked items BLOCKED rather than DONE:

- **T-41** — ET/RU STALE re-translation (agent drafting). TODO.
- **T-42** — ET/RU independent review + enable + M47 acceptance chain. BLOCKED
  (needs a reviewer distinct from the author); `needs: T-41`.
- **T-43** — ET/RU publication authorization. BLOCKED (operator decision).
- **T-44** — M50: operator selects the 10 production locales; add + measure.
  BLOCKED (operator selection).
- **T-45** — M51: operator selects the 33-locale list; registry entries +
  statistics. BLOCKED (operator selection); `needs: T-44`.
- **T-46** — AUDAPACK nested protocol-tree inclusion. BLOCKED (external owner).

## What was NOT done

- No historical LOG line, BOARD DONE row, or review record was rewritten.
- T-14 and T-15 were not reopened.
- No locale was enabled; `locales.json` is unchanged.
- No push, deploy, hosting, or publication action.
- No source reference or AUDAPACK internal was deleted or modified.
