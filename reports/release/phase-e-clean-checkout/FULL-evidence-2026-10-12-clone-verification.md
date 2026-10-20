# Current independent verification — contract-8 release factory (2026-10-12)

Historical record `FULL-evidence-clean-checkout.json` (contract 8, PASS,
FULL_RELEASE_READY, COMMITTED) is bound to dirty identity
`b1fad545…` and is **not** re-used as proof here. This report records a
fresh, independently executed verification and distinguishes it from that
history.

## Source under test

- Tracked revision: `92946d5b58e521a8a47512c85659ee5d2173283b`
  (branch `t31-reproducible-source-authority`)
- Plus a documented 10-file patch = the live worktree's T-32/T-33
  implementation exactly (no `.saipen/`, no reports, no locales):
  `scripts/release-candidate.mjs`, `scripts/site.mjs`,
  `scripts/validate-licenses.mjs`, `scripts/validate-content.mjs`,
  `scripts/validate-registry.mjs`, `scripts/audit-build.mjs`,
  `src/content-engine/engine.mjs`,
  `scripts/tests/release-transaction.test.mjs`, `README.md`, `.gitignore`
- Method: disposable clone of the tracked revision in os tmp
  (`sai-clean-repro-1`, outside the shared tree), patch applied via
  `git apply`, `npm ci`, **no `dist/` before the factory**
  (`ls dist` → absent), no prior `npm run build`.
- Recorded source identity of the verified run:
  rev `92946d5…`, dirty 10 files, dirtyIdentity
  `ea87a0ef2a26feee7040537ae0e0b8883e081a34f696731448fab218cd3c8efa`,
  provenance `head+dirty-manifest`.
- Honest scope: this is a clean checkout of the tracked revision **plus the
  uncommitted implementation patch**, not a clean-HEAD PASS. Clean HEAD is
  contract 6 and cannot mint a contract-8 receipt. Committing the patch is
  the owner's (saipen/operator) decision; nothing was committed here.

## FULL factory result (fresh run, `--profile=full`)

- Command (POSIX shell):
  `SAI_SITE_ORIGIN=https://saipenprotocol.com SAI_RELEASE_BUILD=1
  SAI_RELEASE_ORIGIN_ACK=https://saipenprotocol.com
  npm run release:candidate -- --profile=full`
- Exit `0`: `release-candidate: PASS`, readiness `FULL_RELEASE_READY`.
- Gate contract `8`. All 18 mandatory gates `ok`: site:doctor,
  lint-styles, validate-themes, validate-canonical, validate-baselines,
  validate-licenses:source, validate:media, i18n, test:engine, check,
  astro-build, validate-content, validate-registry,
  validate-licenses:artifact, audit-build, test:engine-build,
  test:browser-matrix, release:dual-origin.
- Candidate: generation `g-4970a6c04bfdc0a4`, 137 files,
  SHA-256 `4970a6c04bfdc0a4f082a8aa865fd64c35e34095e820982b5b44016aa856a781`
  — recomputed from generation bytes: MATCH; compat view: MATCH.
  (Same bytes as the historical receipt: deterministic rebuild confirmed.
  `dist/` holds 157 files; the 137-file candidate is the projected public
  tree — expected difference.)
- `release:doctor`: HEALTHY, lock absent.
- `release:package`: PASS, ZIP
  `saipenprotocol-com-6dc40565e4-4970a6c04bfd.zip`,
  SHA-256 `1e3ed88a533f006a9b51a0300b0ce284e3d6ef567b2b237e3f5efb60182f2ae1`,
  14834650 bytes, extraction PASS + LOCAL_STATIC_HOST_PASS,
  readiness FULL_RELEASE_READY (bound generation FULL receipt).
- Handoff checklist: `FULL_READY_FOR_OPERATOR_HANDOFF`, identities
  consistent (origin, generation, candidate/package digests).
- `publicationAuthorized: false` on every receipt (no remote action).

## Regression tests (live worktree, before the clone run)

- 181 pass: release-transaction, release-candidate,
  release-browser-accounting, release-skip-accounting,
  release-provenance, release-package-attestation.
- 48 pass: release-checklist. 154 pass: release-checklist-cli,
  release-doctor-views, release-hardening, release-origin,
  release-public, release-smoke.
- Total: **383 pass, 0 fail** (includes the new contract-7 artifact-gate
  failure test and the `SAI_RELEASE_ARTIFACT_DIR` seam test).

## Negative controls

- A (missing dist): the verified factory run above started with no `dist/`,
  built it under its lock, and proceeded. PASS.
- B (missing required source): live in clone — `sources.json` hidden →
  exit 1, `FAIL at source-health … refusing to build on drift`, NOT_READY;
  file restored, doctor HEALTHY after. PASS.
- C (corrupted artifact): unit `artifact-gate failure after the build
  commits nothing` (pointer unmoved, NOT_READY). PASS.
- D (wrong/missing origin ack): live in clone — wrong ack → exit **3**,
  `BLOCKED at env-contract`, NOT_READY. PASS.
- E (stale/foreign browser artifact): unit `browser accounting naming a
  foreign artifact refuses FULL, pointer unmoved`. PASS.
- F (missing licence half): live against the fresh receipt — baseline FULL;
  dropping `validate-licenses:artifact` **or** `:source` →
  `CANDIDATE_ONLY` (`receipt lacks passing mandatory gates (…)`). PASS.
- G (injected transaction failure): unit NOT_COMMITTED / pointer-unmoved /
  bytes-intact tests. PASS.
- H (stale prior receipt): live — contract-6 receipt under contract 8 →
  `CANDIDATE_ONLY` (`receipt gate contract 6 != current 8`); unit X6/H
  rollback tests. PASS.
- I (missing/unregistered mandatory test): unit strict skip/zero-test
  accounting tests. PASS.
- J (postcommit view failure): unit POSTCOMMIT_DEGRADED tests. PASS.

## Lifecycle / blockers

- T-31 stays VERIFY (owner: saipen). No RUN/DECLARE/REVIEW/FINISH events
  fabricated here; no supported SAIPEN runtime operation was available in
  this context to advance it.
- T-32/T-33 stay TODO (unclaimed). Engineering verification above is
  complete and recorded; lifecycle admission/closure belongs to the
  protocol owner.
- Commit blocker (owner: operator/saipen): the contract-8 implementation
  remains uncommitted in the shared working tree (37 changed files, plus
  unrelated operator work such as MACHINE_DRAFT locale entries). A genuine
  clean-HEAD contract-8 PASS is impossible until the owned patch is
  committed through the authorized workflow.
- No push, no deployment, no DNS changes, no publication. No shared-tree
  files were modified by this run; no `.saipen/` history touched; no other
  actor's processes, locks, or evidence disturbed.
