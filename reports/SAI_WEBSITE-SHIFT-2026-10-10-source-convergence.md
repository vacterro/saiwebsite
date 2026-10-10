# SAI_WEBSITE — Source Convergence & Clean-Checkout Release Readiness (2026-10-10)

Supersedes `SAI_WEBSITE-SHIFT-2026-10-10.md` (preserved as historical record).

## STATUS
- Engineering: **DONE** — committed source reproduces the FULL release pipeline from a clean checkout.
- SAIPEN lifecycle: **T-31, phase VERIFY, last event E-355 — UNCHANGED** (no manual state edits; no T-32 created).
- Publication: **NOT_PERFORMED** (`publicationAuthorized: false`; no push, no deploy, no DNS).

## FINAL IDENTITY
- Verification HEAD: `74320af9dc48049c7fe634da787a9550847bf17b` (all clean-checkout evidence in this report is bound to this revision)
- This report is the branch HEAD commit; no source file changed after 74320af.
- Branch: `t31-reproducible-source-authority` (6 source commits on main: 461e511, 21aa264, d376f6c, 4e97918, 43d5282, 74320af)
- Tracked files: **866** (was 720 at mission start)
- Remote: `github.com/vacterro/saiwebsite.git` — **no push performed**

## SOURCE CLOSURE (STAGE 1)
All required paths tracked and committed:
`package.json`, `package-lock.json`, `astro.config.mjs`, `playwright.config.mjs`,
`.github/workflows/ci.yml`, `tests/baselines/`, `scripts/fonts/src/`, `src/content-engine/`,
`public/media/`, plus the full release pipeline (`scripts/release-*.mjs`, `scripts/tests/release-*.test.mjs`).

## DIRTY / UNTRACKED INVENTORY (final)
| Category | Count | Disposition |
|---|---|---|
| `.saipen/` protocol files | 395 untracked + 22 modified | Protocol-managed; preserved |
| `%TEMP%/sai-clean-repro-*` (AUDAPACK) | 1426 + 14 quoted | Archive boundary; **not touched** |
| `reports/` (old shift + convergence) | 43 untracked | Historical; preserved |
| `OPERATOR.md`, `requirements-media.txt` | 2 untracked | Operator-owned; preserved |
| Release receipts (`reports/release/**`) | tracked | Factory-written; committed |

Total untracked: **1880** (matches mission snapshot; no new residue introduced).

## CLEAN-CHECKOUT GATE RESULTS

### N6 — host-default clone (autocrlf=true)
- `npm ci` → 0; `check` → 0 (0 warnings, 33 hints); `lint` → 0; `build` → 0 (85 pages)
- `test:engine` → **427/427 pass**; `release-public` → 0; transaction suite → 0
- Browser matrix → **715 passed / 0 failed / 80 skipped**; candidate-host → 3/3
- `site:doctor` → HEALTHY (0 broken, 0 stale)

### N6-lf — clone with `-c core.autocrlf=false`
- Identical checkout bytes (font sources `-text`, docs LF, `start.cmd` CRLF)
- All 4 approved font SHA-256 hashes **MATCH** under both configs
- Engine 427/427; browser 715/0/80 — **byte-identical results**

### N7 — tracked-only git worktree (no pre-build) — **FAIL (expected)**
- `npm ci` → 0; gates → 0; **FULL factory → FAIL at static-gates**
- Root cause: `validate-content.mjs` exits 2 ("no dist/ — run `npm run build` first") —
  the factory's static gates (validate-content, validate-registry, audit-build) read `dist/`
  before the factory's own build stage (documented order: static gates → build).
- Provenance captured correctly: `{"rev":"4e97918…","dirty":false,"dirtyFiles":0,"provenance":"head"}`
- **Fix**: documented the prerequisite in `README.md` + `scripts/release-candidate.mjs` header
  (commit 43d5282). No gate weakening, no ordering change.

### N8 — tracked-only git worktree (supported sequence: build → factory) — **PASS**
- HEAD `74320af`, dirty=0, untracked=0 before work
- `npm ci` → 0; gates → 0; release-mode build → 0 (85 pages, 4.72s)
- **FULL factory → PASS** (see below)
- Package → PASS; checklist → FULL_READY_FOR_OPERATOR_HANDOFF
- Provenance: `{"rev":"74320af…","dirty":false,"dirtyFiles":0,"provenance":"head"}`
- Receipts preserved in `V:/_TEMP_/n8-receipts/`

## WINDOWS LINE-ENDING VERIFICATION (STAGE 3)
- `.gitattributes`: `* text=auto eol=lf`, `*.cmd text eol=crlf`, `scripts/fonts/src/** -text`,
  `.saipen/… -text` evidence rules
- Clone with `core.autocrlf=true` → font bytes LF, `start.cmd` CRLF, docs LF
- Clone with `core.autocrlf=false` → **identical bytes**
- All 4 approved font sources match their exact SHA-256 under both configs
- `font-controls.test.mjs` byte-guard: **PASS**

## ENGINE / BROWSER TOTALS (N8 clean worktree)
| Suite | Tests | Pass | Fail | Skip |
|---|---|---|---|---|
| `test:engine` | 421 | 421 | 0 | 0 |
| `test:engine-build` | 11 | 11 | 0 | 0 |
| `test:browser-matrix` | 800 | 720 | 0 | 80 |
| **Total** | **1232** | **1152** | **0** | **80** |

## FULL FACTORY RESULT (N8)
- Command: `SAI_SITE_ORIGIN=https://saipenprotocol.com SAI_RELEASE_BUILD=1 SAI_RELEASE_ORIGIN_ACK=https://saipenprotocol.com node scripts/release-candidate.mjs --profile=full`
- Verdict: **PASS**; readiness: **FULL_RELEASE_READY**; gateContract: **6**
- All **17/17 gates** exit 0 (site:doctor, lint-styles, validate-themes, validate-canonical,
  validate-content, validate-registry, validate-baselines, validate-licenses, validate:media,
  audit-build, i18n, test:engine, check, astro-build, test:engine-build, test:browser-matrix,
  release:dual-origin)
- `stagedDigest == candidate sha256` ✓
- `commitState: COMMITTED`; `publicationAuthorized: false`

## SOURCE PROVENANCE
- Factory records: `{"rev":"74320af…","dirty":false,"dirtyFiles":0,"provenance":"head"}`
- The clean-commit source is **not** mislabeled as the previous dirty-tree identity.
- Previous FULL receipt (g-f0b12a4c683ea764, bound to 9f5c020) **preserved untouched**.

## CANDIDATE GENERATION
- Generation: `g-4970a6c04bfdc0a4`
- SHA-256: `4970a6c04bfdc0a4f082a8aa865fd64c35e34095e820982b5b44016aa856a781`
- Files: 137
- Determinism: identical candidate + package digests in N5, N6, and N8 (despite source test-file changes)

## PACKAGE
- File: `saipenprotocol-com-6dc40565e4-4970a6c04bfd.zip`
- SHA-256: `1e3ed88a533f006a9b51a0300b0ce284e3d6ef567b2b237e3f5efb60182f2ae1`
- Bytes: 14,834,650
- Extraction: **PASS**; static-host smoke: **LOCAL_STATIC_HOST_PASS**
- Receipt: `reports/release/packages/saipenprotocol-com.json`
- `publicationAuthorized: false` (no upload or deployment performed)

## CHECKLIST
- `release-checklist.mjs` → **FULL_READY_FOR_OPERATOR_HANDOFF** for `https://saipenprotocol.com`
- All identities converge: origin, generation, candidate SHA-256, gate contract, package version,
  source revision, FULL readiness, publication prohibition.

## SAIPEN LIFECYCLE
- T-31 claimed (VERIFY phase); T-32 top workable; last event E-355.
- No manual edits to `.saipen/STATE.md`, `.saipen/BOARD.md`, `.saipen/LOG.md`.
- No T-31/T-32 closure via unsupported operations.
- All changes labelled **locally verified only** (upstream admission blocker persists).

## REMAINING LIMITATIONS
1. `%TEMP%/sai-clean-repro-*` (1440 files) — AUDAPACK classification; not cleaned (archive boundary).
2. `reports/release/**` — tracked but factory-written; new receipts accumulate on each run.
3. ET/RU translations: 3 STALE + 1 MISSING per locale, 0% approved — publication flags remain disabled.
4. Branch `t31-reproducible-source-authority` — **not pushed** (no remote action).
5. Factory prerequisite: a release-mode build must precede `release:candidate` on a clean checkout
   (documented in README + factory header; not a code defect).
6. 5 orphaned `astro preview` servers from pre-fix runs remain (shared checkout; not killed).

## ACCEPTANCE CHAIN
```
COMMITTED SOURCE → CLEAN BUILD → VERIFIED CANDIDATE → VERIFIED PACKAGE
```
No inherited PASS. No fabricated provenance. No unauthorized publication.
