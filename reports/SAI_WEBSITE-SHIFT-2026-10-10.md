# SAI_WEBSITE autonomous shift — FINAL REPORT (2026-10-10)

## STATUS
- Engineering: **DONE** (all eligible stages completed; every acceptance item met or its exact blocker stated)
- SAIPEN lifecycle: **T-31, phase VERIFY, last event E-354 — UNCHANGED** (upstream admission blocker persists; no history edited)
- Publication: **NOT_PERFORMED** (`publicationAuthorized: false`; no push, no release, no deploy, no DNS)

## P1 ROOT CAUSE

### Original contract-6 failure
The last exported FULL run failed with
`FAIL at browser-matrix: exit 1: browser matrix runner failed (exit 1): mandatory browser suite missing: tests/candidate-host.spec.mjs (absent)`.
That message was **misleading**. The recorded accounting for that run shows the real failure:
`matrix.totals = { tests: 794, passed: 713, failed: 1, skipped: 80, flaky: 0 }`.

### Defect 1 — failure accounting (scripts/release-candidate.mjs)
- Symbols: `runBrowserMatrix()`, `accountPlaywrightJson()`, `refuseBrowserReport()`.
- Cause: the success path accounted with the matrix-only expectation, but the **error path** called
  `accountPlaywrightJson(partial)` with the default `expected = BROWSER_SUITES`, which includes
  `tests/candidate-host.spec.mjs`. The suite cannot exist in a dist-only matrix, so
  `missingSuites` was populated and `refuseBrowserReport()` returns on `missingSuites`
  **before** it reports `totals.failed` — masking the single real failure.
- Repair:
  - new exported registries `BROWSER_MATRIX_EXPECTED` and `CANDIDATE_HOST_EXPECTED`;
    both the success and error paths of `runBrowserMatrix()` now use them.
  - `accountPlaywrightJson()` now also returns `failedTests` (`{file, project, title}`).
  - `refuseBrowserReport()` names the failing tests in its message.
  - new exported `describeRunnerFailure()`: preserves the real exit status; a nonzero exit
    with an otherwise clean account is reported as an **infrastructure failure**, never a pass.

### Defect 2 — the actual failing test (stale visual baseline)
- Test: `visual-baseline.spec.mjs › /security/` — `3630 pixels (ratio 0.01) are different`.
- Location of the difference: 1280×720 viewport, rows **683–719 only** (bottom band).
- Cause: `src/pages/security/index.astro` was editorially corrected from
  *"Two small scripts: the pre-paint theme restore and the theme menu…"* to
  *"Three small inline scripts: the pre-paint theme restore, the theme menu wiring, and the Ctrl+K search shortcut…"*,
  but `tests/baselines/security.png` had not been regenerated. The claim is **correct and source-backed**:
  the built `dist/security/index.html` contains exactly **3 inline `<script>` tags and 0 external scripts**
  (pre-paint theme restore, theme-menu wiring, Ctrl+K shortcut).
- Repair: refreshed the stale baseline through the supported reviewed-refresh path
  (`playwright test tests/visual-baseline.spec.mjs --project=chromium -g "/security/" --update-snapshots`
  then `node scripts/validate-baselines.mjs --write`).
- Byte-level proof: hashes of all 34 files under `tests/baselines/` were captured before and after —
  **only `tests/baselines/security.png` changed** (3948932f… → d54270fa…); all 32 other baselines unchanged.
  The 33 remaining visual checks passed unchanged.

### Defect 3 — leaked preview process (owned-process hygiene)
- Evidence: after a clean `FACTORY_EXIT:0` run, an `astro preview` server was still
  `LISTENING` on `127.0.0.1:3593`.
- Cause: `spawn(..., { shell: true })` makes the real server a grandchild
  (cmd.exe → npx → astro); `preview.kill()` only killed the wrapper.
- Repair: `stopPreview()` now terminates the whole spawned tree
  (Windows `taskkill /pid <pid> /T /F`, elsewhere the child's own process group, with `detached` on POSIX),
  falling back to the direct kill. Only the spawned pid's tree is targeted.
- Verification: the factory was re-run on the final code (`FACTORY_EXIT:0`); the `astro preview`
  process set afterwards was **identical to the pre-run set — no new leaked server.**

### Negative regression evidence
`scripts/tests/release-browser-accounting.test.mjs` — 13 new controls over the real functions:
matrix-only JSON passes; candidate-host absent from the matrix is not an error (and the old default
expectation is shown to mis-diagnose the same report); a missing mandatory matrix suite fails; a missing
required Chromium project fails; a missing required WebKit media project fails; a nonzero exit with a clean
account is an infrastructure failure (not a pass); a real test failure is named and never mentions
candidate-host; a nonzero exit with no partial JSON names the exit and the stderr; truncated/unparsable JSON
is surfaced; failing-test identities are preserved; candidate-host absent from its own dedicated run fails;
candidate-host on chromium passes; candidate-host failure is reported.
Result: **40/40 pass**. Neighbours `release-checklist` + `release-transaction`: **123/123 pass**.

## USER-FACING IMPROVEMENTS
- Pages inspected: compatibility, status, downloads, benchmarks, security, ecosystem, blog, changelog.
- Confirmed defects: **one** — the `/security/` "Two → Three inline scripts" inaccuracy (verified against the
  built HTML; baseline refreshed). No other demonstrable inaccuracy was found, so no other page was edited.
- Compatibility: the rendered table is **verbatim-faithful** to the canonical
  `src/data/canonical/adapters.json` — independently re-parsed: **15/15 rows, 0 cell mismatches**, same order.
  The page already distinguishes declared vs effective enforcement and "not listed ⇒ no declared adapter".
- Status: no fake uptime; states there is no hosted service. Counts verified against its own table:
  **47 delivered / 8 deferred** — matches the claim exactly.
- Benchmarks: methodology-only, explicitly "no benchmark results are published"; the only figures are
  quoted protocol *verification* counts attributed to a release + source, not recovery benchmarks.
- Downloads: digests labelled "(GitHub)"; signature column says "not recorded"; the page states
  "records asset digests, not code signatures" — no authenticity inferred from SHA-256. The approved
  asset-list filter is preserved. Multi-asset projects are handled (continuation rows carry no
  Project/Version/Date cells).
- Ecosystem: all project facts come from the reviewed snapshot; no integration is asserted to work reliably.
- Navigation/accessibility results: the reader chain now follows real visitor-visible links at every step;
  blog coverage is mandatory; 320px containment, external-link marking, landmarks and back/forward all green.

## CONTENT
- Claims reviewed: compatibility (verbatim vs canonical), status (milestone counts, no-uptime),
  benchmarks (no invented numbers), downloads (provenance wording), security (inline-script count),
  ecosystem (snapshot attribution), blog/changelog (ordering, anchors).
- Source-backed corrections: `/security/` inline-script claim (source: built page HTML).
- Unverified runtime claims: none introduced. The pages correctly avoid asserting upstream runtime health.
- Content Engine health: `validate:content`, `validate:canonical`, `validate:registry`, `site:doctor`,
  `i18n:validate` all exit 0; source/translation locks valid; no hand-edited lock values.
- Translation state: ET/RU remain **publication-disabled** (`i18n:enable` not run); locales unchanged.

## WORKSPACE AUDIT
- Directories inspected: `.site-work/`, `test-results/`, `.astro/`, `dist/`, `reports/`,
  `tests/baselines/`, `public/media/`, `src/content-engine/manifests/`, `.saipen/`, `i18n-work/`,
  `_local_ref/`, `_src_unpack/` (no `.audapack/`, no `playwright-report/` present).
- Owned files cleaned: **6 scratch files from this run** (debug crops, `dbg-footer.html`,
  before/after baseline hash lists) — **≈40 KB reclaimed**.
- Evidence preserved: `.site-work/matrix-run1.log`, `factory-c4..c6.log`, `factory-c7.log`, `factory-c8.log`,
  all release staging, all baselines, all receipts, all `.saipen/` history.
- Unknown/uncertain ownership — **intentionally preserved**:
  - `.site-work/release/*` (191 MB) — generation store, rollback ZIPs, `packages/`, `candidates/` and the
    dual-origin build fixtures (`planned-origin`, `temp-origin`, `mutated-temp`, `public-*`). These are
    rollback/recovery material and the deliberate `--skip-build` cache; a failed process does not make its
    output garbage.
  - `.site-work/release/factory.lock.abandoned-1791526573754` — the factory's own quarantine record of a
    dead run (pid 12960, 2026-10-09).
  - `test-results/` — Playwright-managed, gitignored, reproducible.
  - **5 orphaned `astro preview` servers** (`127.0.0.1:10187, :15654, :30467, :3593, :48478`) from pre-fix
    runs. Ownership verified (this repo's `dist`), no run active, but **not killed** — shared checkout,
    unowned-process safety. The leak itself is now fixed.
- New packaging/workspace-isolation issues: `scripts/release-*.mjs`, `scripts/tests/*` and
  `tests/*.spec.mjs` are **untracked in git**, so the contract-6 PASS currently has no git identity.
- Nothing was deleted by force; no broad destructive command was used; no unowned process was killed.

## VALIDATION
- Static (all exit 0): `check`, `lint`, `build`, `validate:themes`, `validate:canonical`, `validate:content`,
  `validate:registry`, `validate:baselines`, `validate:licenses`, `validate:media`, `audit:build`,
  `site:doctor`, `i18n:validate`, `test:engine` — **14/14 PASS**.
- Browser: `npm run test:matrix` → **715 passed / 0 failed / 80 skipped** (the 80 are the two
  policy-covered pixel-perfect engine-conditional skips), exit 0. Chromium + WebKit covered
  (pixel-perfect and media-delivery on both engines; candidate-host verified separately, 3/3).
- Release: `scripts/tests/release-browser-accounting.test.mjs` + neighbours **123/123 PASS**.
- Contract-6 FULL factory (`SAI_SITE_ORIGIN=https://saipenprotocol.com SAI_RELEASE_BUILD=1
  SAI_RELEASE_ORIGIN_ACK=https://saipenprotocol.com npm run release:candidate -- --profile=full`):
  - `verdict: PASS`, `profile: full`, `gateContract: 6`, `readiness: FULL_RELEASE_READY`,
    `commitState: COMMITTED`, `publicationAuthorized: false`
  - all **17/17 gates `exit 0`**, including `test:browser-matrix` and `release:dual-origin`
  - `matrix totals {tests:795, passed:715, failed:0, skipped:80, flaky:0}`, `missingSuites: []`,
    `unknownSkips: 0`; `candidateHost {tests:3, passed:3}`
  - candidate `g-0a6cda39c9dcfc08`, `sha256 0a6cda39c9dcfc089504af21ac6f2fb09d2ffb500114b32835273b993280b36d`,
    `previousPreserved: true`
  - receipt `reports/release/candidates/saipenprotocol-com-6dc40565e4.json` (run c7); c8 re-ran after the
    leak fix with the same generation digest → the PASS covers the final code.
- Remaining limitations: the previously exported c6 **FAIL receipt text is superseded** (the factory writes
  one mutable candidate-receipt path); its rollback generation artifacts and `.site-work/factory-c6.log`
  survive. The 5 orphan preview processes remain. Untracked release/test infrastructure.

## SAIPEN
- Actual ticket/phase: **T-31, VERIFY**; last event **E-354**; `blocker: none` in STATE.
- Event range: E-335 … E-354 (all pre-existing; this session wrote nothing).
- Upstream admission blocker (owner: SAIPEN agent, per LOG E-345/E-346/E-352): `run` and `declare` verbs are
  unknown in runtime 8.1.0 and `reverify run` refuses active tickets, so no supported machine-recording path
  exists for the regression FAIL/PASS pair. Not retried; `STATE.md`/`BOARD.md`/`LOG.md` were read only and
  left byte-identical; no T-32 was created.
- Therefore every change in this shift is labelled **locally verified only**, not lifecycle-admitted.

## NEXT
- Highest-priority genuinely unfinished task: **reconcile the 5 orphaned `astro preview` servers and decide
  whether to commit the currently-untracked release/verification infrastructure**, so the contract-6
  `FULL_RELEASE_READY` PASS acquires a git identity under T-31's VERIFY phase.
