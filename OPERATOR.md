# Website maintenance

Run these commands in the repository root. Install reproducibly with `npm ci`.
On Windows use **`npm.cmd`** in place of `npm` when forwarding `--` arguments;
PowerShell's npm.ps1 wrapper can consume the separator. All examples below
use actual commands. No command here deploys or pushes the website.

Normally edit `src/content-engine/blocks/<domain>.json` for English paragraphs,
`src/content-engine/compositions/<page>.json` for sections, and
`src/content/docs/<section>/<page>.md` for documentation. Page identity,
navigation and dependencies belong to `registry/pages.json` / `sources.json`.
Canonical snapshots, translation files and generated manifests use their tools.

## One ordinary edit

```sh
npm run site:content -- block edit home.hero.lead --text "Your revised paragraph" --dry-run
npm run site:content -- block edit home.hero.lead --text "Your revised paragraph"
npm run site:impact -- home.hero.lead
npm run site:prepare
npm run site:affected
```

The dry run lists exact files and units becoming STALE. Stable IDs survive
rewording and reordering. `site:prepare` prints every check/build/refresh/gate
it runs and stops on failure. Use `--test` for the full browser suite. Review
the Git diff before committing; the wrapper is not publication approval.

## Sections and pages

Create `i18n-work/section.json` containing an existing supported block type:

```json
{"type":"paragraph","text":"home.operator-note"}
```

```sh
npm run site:content -- block add home.operator-note --text "A new section paragraph"
npm run site:content -- section add home operator-note --file i18n-work/section.json --dry-run
npm run site:content -- section add home operator-note --file i18n-work/section.json
npm run site:content -- section move home operator-note --before next
npm run site:content -- section hide home operator-note
npm run site:content -- section show home operator-note
npm run site:content -- section remove home operator-note
npm run site:content -- block remove home.operator-note
```

Heading, paragraph, list and cards are reusable types; their exact schema is
`compositions/types.ts`. Home, About and Pricing expose native section slots
for ordering/removal; required introduction slots are protected. Native slots
retain interactive/generated markup. Other registered pages accept ordinary
append sections through the common layout. New content needs no Astro component
when one of those types suffices. Sections carry owner, stable ID, order,
visibility, maturity, dependencies, localization policy and validation gates.

Removing a referenced block is refused. Removing an unreferenced canonical
block retains its translations as ORPHANED; `i18n:cleanup -- --locale et
--dry-run` previews their deliberate removal. Section removal alone preserves
the block and all translation work. Repeated identical operations do not add
duplicates. For rollback, restore only your editorial files from your own
checkpoint, then run `site:prepare`; never blanket-reset someone else's work.

```sh
npm run site:content -- page create notes --route /notes/ --title Notes --description "Project notes"
npm run site:content -- page nav notes --nav secondary --label Notes
npm run site:content -- page move notes --route /project-notes/
npm run site:content -- page deprecate notes
npm run site:content -- page remove notes --replacement community --dry-run
npm run site:content -- dependency add notes saipen.reference.readme
npm run site:content -- dependency remove notes saipen.reference.readme
```

Creation supplies the registry, English metadata blocks and composition. Moves
retain the content ID and add an unindexed static redirect. Removal requires
a valid replacement and retains redirects, blocks and translations. Use
`--section <id>` or `--block <id>` on dependency commands for narrower ownership.
Validate and preview with `site:prepare`, then `npm run preview`.

## Protocol, ecosystem and drift

```sh
npm run site:sync -- --source saipen.protocol.meta --dry-run
npm run site:sync -- --source saipen.protocol.meta
npm run site:doctor -- --json --allow-stale
npm run site:impact -- saipen.reference.readme
```

Sync stages the complete pinned snapshot, validates it and commits it only
after success. The three machine files remain byte exact. Referenced upstream
documents are tracked by per-file hashes in `canonical/documentation.json`;
documentation frontmatter derives their consumers. A prose-source change
requires editorial review; the tool does not invent replacement protocol text.
Edit the affected English segment only when the source warrants it, then only
that translated segment becomes STALE. A new upstream reference also needs a
source registry entry; the doctor names the missing ID.

Review snapshot diffs and source impact before trusting a new upstream identity.
Doctor JSON supplies an exact `reviewToken`; pass it explicitly:

```sh
npm run site:prepare -- --accept-source SOURCE_ID@FULL_SHA256
```

That last example is a syntax template: substitute the exact pending token,
not a guessed hash. Wrong, obsolete or omitted acknowledgements are refused.
`site:refresh -- --dry-run` previews legitimate manifest changes; refresh does
not fetch, translate or approve source prose. Timestamp-only churn makes no
source delta or drift ticket. A provenance-only commit is reported separately.

For ecosystem/release facts use `site:sync -- --source github.vacterro.releases`
(preview with `--dry-run`). Curate relevance in `src/data/ecosystem.ts`; do not
import every GitHub repository. Public optional support stays in
`src/data/support.ts` and is checked by `npm run test:support`.

```sh
npm run site:drift -- --json
npm run site:drift -- --intake --dry-run
npm run site:drift -- --intake
npm run saipen -- doctor
```

Intake writes a stable structured report and uses the genuine `ticket add`
operation only when available. A matching board marker prevents duplicates.
Unavailable hosts return SAIPEN_CLI_UNAVAILABLE and preserve the report; no
lifecycle file is imitated. Resolution uses an explicit SAIPEN_LAUNCHER,
SAIPEN_HOME or the project's bound home. Install/rebind through SAIPEN's own
adapter on a host that cannot access that home; do not copy a runtime here.
The wrapper allows five minutes for a lifecycle command by default;
`SAIPEN_EXEC_TIMEOUT_MS` sets an explicit transport limit for longer work.
SAIPEN's own `work reverify --timeout` remains the per-verification limit.

Failed sync retains the last snapshot and reports failure/freshness. Repair
network access or the upstream schema, rerun the dry run, review and retry.
An operation lock reports its owner PID; inspect it before removing a lock
left by a terminated process. Never clear another live operation's lock.

## Languages and stale work

```sh
npm run i18n:add -- de --name German --native Deutsch --script Latn --dir ltr
npm run i18n:export -- --locale et --status stale --limit 40 --out i18n-work/et.stale.json
npm run i18n:import -- i18n-work/et.stale.json --status MACHINE_DRAFT --author TRANSLATOR
npm run i18n:validate
npm run i18n:review -- --locale et
```

Export also supports `--domain`, `--document`, `--id` and `--offset`. Fill only
translation/review metadata; preserve IDs, hashes, placeholders, links, code
and Markdown. See `i18n/TRANSLATING.md`. A real independent reviewer must check
the work before importing CURRENT/REVIEWED with distinct author/reviewer
metadata. The CLI checks provenance fields; it cannot fabricate or certify a
human review. Exact translation memory applies only MACHINE_DRAFT suggestions.

`i18n:enable -- et --dry-run` checks public eligibility; `--preview` enables
an internal, noindex draft preview after full render/glyph coverage. Keep it
out of a production build. Deprecate with `i18n:deprecate -- et`; translations
remain. Disabled or internal locales never enter public hreflang/sitemaps.

```sh
npm run i18n:scale
npm run i18n:scale -- --build --report reports/convergence/ten-locale-build.json
npm run i18n:scale -- --pilot --out _local_ref/new-pilot-preview
node scripts/preview-fixture.mjs _local_ref/new-pilot-preview 4322
```

These use disposable copies; the live registry is unchanged. The 33-language
proposal is not the operator's production decision and there is no 33-locale
ceiling. Font blockers and rollout policy are in `i18n/FONT_MODULES.md`.

## Verification and release preparation

`site:doctor -- --json` lists identities, manifests, page maturity, renderable
versus approved locale coverage, font blockers, impact and next actions.
`site:affected -- --base main --json` selects affected gates; unknown,
deleted or infrastructure files require the full suite. `site:affected -- --run`
first prepares the build and reviewed manifests, then runs the selected tests.
Run the listed gates,
`npm run test:engine`, then `site:prepare -- --test` for release preparation.
Before publication run every gate listed in package.json's validation/browser
scripts, inspect the build/diff, and retain the previous static artifact.

Production hosting, domain/DNS, monitoring, analytics, external publication
authorization and ET/RU independent review remain explicit external decisions.
The configured canonical origin is release metadata, not proof of live DNS.
Deploy only the verified PUBLIC candidate (or its independently verified
deployment ZIP) through the operator's chosen static host — never the raw
`dist/` development artifact, which still contains diagnostic pages and
non-public locales that the public projection intentionally strips. Roll back
by restoring the previously verified candidate generation (see
`npm run release:doctor` and the ZIP workflow below). Do not upload project
memory, reports, source files, credentials, test work or node_modules.

## Autonomous maintenance corridor

Ordinary source/content work follows one path. Every step is an existing
command and none of them publishes anything:

```sh
npm run site:doctor -- --json   # 1. structured health (exit 0 healthy, 1 broken, 2 stale)
npm run site:drift -- --json    # 2. upstream / editorial / generated / translation drift
npm run site:affected           # 3. affected pages and the exact gate list for this change
```

Classify the work before touching it. Safe to repair autonomously (no extra
authority): generated artifacts reproducible from unchanged approved sources,
deterministic derived indexes, broken local references with one unambiguous
target, build-script defects with a demonstrated reproduction,
verification-infrastructure regressions, purely mechanical documentation
inconsistencies, and idempotent fixes that already have source authority.
Requires explicit operator authority: a changed canonical protocol snapshot,
a new upstream source-hash acknowledgement (`site:prepare --
--accept-source SOURCE_ID@SHA256`), new public support/payment information,
publication or release decisions, new language approvals, independent
reviewer approvals, and changes to public policy or factual protocol claims.
When an approval-dependent item appears, record its exact identity and
impact, leave it unchanged, and continue with independent safe work.

Bound repair attempts: at most three per distinct root cause; re-evaluate the
failure after each attempt, stop once the evidence is unchanged, and never
rebuild an unchanged failing state. Revalidate only the affected gates while
iterating (`site:affected -- --run`), then run the full release validation
before creating a candidate.

## Public release candidate (one command)

`npm run release:candidate` prepares a public candidate without any remote
publication: source health (source-only, never inspects an inherited dist/)
-> source-only static gates (incl. the licence/provenance source checks) ->
release build for the explicitly selected origin -> dist-reading artifact
gates (validate-content, validate-registry, the licence gate's built-artifact
checks, audit-build) against THAT build -> release verification ->
isolated public projection -> candidate verification -> local static-host
smoke -> deterministic SHA-256 -> immutable snapshot -> machine-readable
evidence. It is self-contained on a clean checkout: no manual `npm run build`
is required beforehand, because every artifact-reading gate runs inside the
factory lock against the build this run just produced, never an inherited
dist/.

The environment contract is never defaulted:

```powershell
$env:SAI_SITE_ORIGIN = 'https://your-real-host.example'          # explicit target
$env:SAI_RELEASE_BUILD = '1'
$env:SAI_RELEASE_ORIGIN_ACK = 'https://your-real-host.example'   # must repeat it exactly
npm.cmd run release:candidate
```

Exit codes: `0 = PASS`, `1 = FAIL`, `3 = BLOCKED` (missing origin or
acknowledgement, a loopback origin, or the `sai-temp.example.org` test
fixture — a test double, never a publishing destination),
`4 = ATTESTATION_GAP` (full-profile execution passed every gate but strict
FULL attestation was withheld — limited provenance, uncertain commit,
failed receipt persistence, or a strict-field rejection; the structured
report names the exact reason, committed generations stay intact, and the
nonzero status never lets a process exit imply FULL). One factory run at
a time: a second concurrent run is refused by the factory lock instead of
overlapping (`factory-lock` FAIL; a lock left by a dead process is recovered
conservatively with its record preserved — never delete a live owner's lock).

Committed candidates live in
`.site-work/release/candidates/<store-id>/`, where `<store-id>` is a
readable host prefix plus a short hash of the full origin, so distinct
origins can never share a store. Inside: immutable content-addressed
generations (`generations/g-<sha16>/`), a `current.json` pointer selecting
the authoritative generation, a preserved `previous.json`, and `current/` +
`previous/` convenience views. Promotion commits the verified generation
FIRST and moves only the small pointer; a failed copy or an interrupted run
can never delete the last verified generation. The evidence manifest (git
revision, dirty status, package and protocol identity, effective origin,
gate results, file count, artifact SHA-256, publication authorization
status, external blockers) is written outside the publishable directory to
`reports/release/candidates/<store-id>.json`. Repeated runs with unchanged
inputs produce identical bytes and digest.

Verification profiles: the default `candidate` profile runs every required
static, security and candidate-integration gate and is enough for a local
candidate — but it is NOT full release readiness. Append `--profile=full`
for the complete type check, the full browser matrix (all dist suites on
Chromium, pixel-perfect on Chromium + WebKit, candidate-host against the
exact staged artifact with digest attestation) and dual-origin proof; only
a full-profile PASS may be described as release-ready.

Readiness levels (never interchangeable): BUILT (a build exists) →
VERIFIED (local verification passed) → FULL-gated (every mandatory
full-readiness gate passed) → COMMITTED (pointer selects the generation) →
RECOVERABLE (generation + views verify) → DEPLOYED (proven on the actual
host — only ever an operator observation, never a tool claim). The evidence
`readiness` field says exactly one of `FULL_RELEASE_READY`,
`CANDIDATE_ONLY`, or `NOT_READY`; a failed or incomplete full attempt is
`NOT_READY` even when files exist on disk.

Every terminal run that names a committed generation also writes an
immutable generation receipt binding origin, generation, candidate
SHA-256, source identity (HEAD plus a deterministic dirty-tree manifest
when the tree is dirty — HEAD alone never identifies a dirty tree), gate
contract version, gate results, and test accounting. Records live in
`reports/release/candidates/<store-id>/` as per-contract run slots
(`g-<sha16>.c<contract>.<runid>.json`: generation → contract → run
identity) plus the `g-<sha16>.json` legacy pointer mirroring the newest
verified record. The mutable per-origin report is a latest-attempt summary
only; the versioned receipts are the authority. A passing record is never
destroyed by a later attempt — a subsequent failure keeps history and a
newer contract gets its own slot — so re-verification can supersede without
erasing. A FULL receipt is valid only under the gate contract that
produced it (`gateContract` in the receipt must match the factory's
`GATE_CONTRACT_VERSION`).

Supporting commands: `npm run release:doctor` inspects store health
read-only (active/previous generation, digest validity, compatibility-view
content hashes compared against their pointers, pending or interrupted
promotions, orphaned generations, lock state) and prints the explicit
recovery choices — it never changes the selected release. A stale or
corrupt `current/` view is reported as a degraded store (`STORE_DEGRADED`,
`VIEW_STALE` / `VIEW_CORRUPT`) without invalidating the intact immutable
generation behind it. Repair is always explicit:
`npm run release:doctor -- --repair [--store <store-id>]` re-syncs views
from digest-verified generations only — never the reverse, never across
origins, never under a live lock. A degraded view is recovered by repair,
not by rebuilding or by copying the view back into the generation; if the
generation itself is corrupt, no view copy may restore it.
`npm run release:public -- --src dist --dest <dir>` projects one candidate
by hand; unsafe destinations (the source itself, its parent, the repo root,
protected paths, the candidate store, or directories with unrelated files)
are refused before anything is deleted.
`npm run release:smoke -- --dir <candidate> --origin <origin>` reruns the
loopback static-host probe (`LOCAL_STATIC_HOST_PASS`);
`npm run test:candidate` adds desktop and mobile browser probes over the
projected candidate. A local pass is labelled LOCAL_STATIC_HOST_PASS only —
compatibility with any real hosting provider stays BLOCKED until the
selected actual host is tested.

## Offline deployment package (no hosting integration)

`npm run release:package` exports the committed candidate as a reproducible
ZIP plus a separate verification receipt — the transferable artifact for
any generic static host. It requires a committed, digest-verified
generation, re-verifies the effective origin and the public contract,
builds the ZIP deterministically (sorted entries, fixed timestamps,
reproducible bytes), extracts it into a disposable directory, and runs the
same public verification plus the static-host smoke against the extracted
content. The receipt (`reports/release/packages/<origin-slug>.json`)
records the candidate digest and the package digest separately, plus a
readiness classification that preserves — never upgrades — the
candidate's proven level: `FULL_RELEASE_READY` only with a bound
generation FULL receipt (same origin, generation, bytes, gate contract,
complete gates, positive internally-consistent test totals, zero unknown
skips, strong source provenance); otherwise explicitly
`CANDIDATE_ONLY`. One shared decision (`scripts/release-readiness.mjs`)
serves factory evidence, doctor reporting, and packaging alike. The
checklist command (`node scripts/release-checklist.mjs --receipt <package
receipt> --factory <factory report> --origin <exact origin> [--out <file>]`)
re-verifies the exact cross-artifact handoff identity — factory generation
== package generation, digests, gate contract, origin, and protocol
snapshot must all agree, and the package file plus generation bytes are
re-hashed from disk — before writing an origin-specific go-live
checklist. `--factory` is mandatory for a current-release handoff:
omitting it exits 2 and writes nothing, so a bare package receipt can
never print an approved-looking sheet. Only a fully verified handoff
produces checked LOCAL READY claims; anything else renders an
explicitly diagnostic sheet and the
CLI exits nonzero (1), so a failed admission never looks like an
approval — the requested `--out` path is overwritten with the
diagnostic, never left showing a stale approval. Four identities must not be confused: a *verified generation*
is bytes plus a bound FULL receipt; the *authoritative current
generation* is whichever generation the store's `current.json` pointer
selects (the only current-release authority — report filenames are
never consulted); a *historical rollback generation* is any older
verified generation, usable only through an explicit
`--rollback-generation` + `--rollback-sha256` selection *together with*
`--factory`, and then
labelled HISTORICAL_ROLLBACK, never presented as current; and a
*current-release handoff approval* (HANDOFF_VERIFIED) requires all three
at once — a PASS/FULL_RELEASE_READY/COMMITTED factory record, the
`current.json` pointer naming the same generation/digest/origin with
verifiable bytes, and a package receipt that independently re-verifies.
A FAIL, NOT_READY, or NOT_COMMITTED factory, a missing or divergent
pointer, or corrupted generation bytes all refuse the handoff, even
when every string in the two reports matches. A package receipt alone
does not select `current.json`: selection lives only in the store's
pointer file, and a historical verified ZIP never becomes current
without the explicit rollback invocation above. A package integrity PASS proves bytes were packaged and
locally verified; it is not a readiness upgrade and not a deployment.

Three CLI modes, three exit contracts:

```powershell
# 1. Normal current-release handoff (exit 0 approves, exit 1 refuses with a diagnostic sheet).
node scripts/release-checklist.mjs --receipt <package receipt> --factory <factory report> --origin <exact origin> --out <file>
# 2. Package-only integrity inspection (exit 0; sheet stays diagnostic,
#    labelled PACKAGE_INTEGRITY_VERIFIED — never a current-release approval).
node scripts/release-checklist.mjs --receipt <package receipt> --origin <exact origin> --inspect-package [--out <file>]
# 3. Explicit historical rollback (exit 0; sheet labelled HISTORICAL_ROLLBACK).
node scripts/release-checklist.mjs --receipt <package receipt> --factory <factory report> --origin <exact origin> --rollback-generation <gen> --rollback-sha256 <sha> [--out <file>]
# Exit 2 = unusable invocation (missing --factory, missing --origin,
# half-supplied rollback flags, or --inspect-package mixed with handoff flags).
```

```powershell
$env:SAI_SITE_ORIGIN = 'https://your-real-host.example'
npm.cmd run release:package
# unpack on any host and re-prove it before serving:
#   Expand-Archive candidate.zip C:\host\wwwroot   (then serve + check
#   canonical/sitemap/robots/content-types there — DNS, TLS, redirects and
#   indexing remain external operator checks)
```

The ZIP holds exactly the verified public tree — no source, no reports, no
credentials, no internal evidence. Packaging never uploads or deploys;
there is deliberately no deploy step. A local PASS is local readiness, not
proof of remote deployment — and a local FULL_RELEASE_READY is still not
proof of hosting, DNS, TLS, redirects, or search-engine indexing. Those
remain external operator checks on the actual served origin.

Platform note: Linux CI cannot prove Windows filesystem semantics
(atomic rename of files vs directories, junctions, PID-lock liveness).
The factory's commit path uses file renames only (never directory
overwrites) precisely so the guarantee holds on both; junction and lock
behavior must still be verified on a Windows host before trusting a
Windows-produced FULL claim, and vice versa. Rebuilding for a new public hostname restamps
every origin surface; old SEO canonical references must not survive
migration — verify the new origin's package from scratch.

## Release workflow (temporary hosting, later migration)

Every public release is stamped with one effective origin. The origin comes
from `SAI_SITE_ORIGIN`; a release build (`SAI_RELEASE_BUILD=1`) must repeat
it exactly in `SAI_RELEASE_ORIGIN_ACK`, otherwise the build and the
verification refuse. The origin strings shown below are placeholders:
`https://sai-temp.example.org` is a test fixture that `release:candidate`
blocks outright, and neither example is a publishing destination — substitute
the origin actually selected for hosting. The planned permanent domain
(`https://saipenprotocol.com`) is editorial information only and never
controls emitted URLs. Windows PowerShell examples below use `npm.cmd`
(the `npm.ps1` wrapper can consume the `--` separator).

```powershell
# 1. Reproducible dependencies.
npm.cmd ci

# 2-3. Name the target public origin and acknowledge it.
$env:SAI_SITE_ORIGIN = 'https://sai-temp.example.org'
$env:SAI_RELEASE_BUILD = '1'
$env:SAI_RELEASE_ORIGIN_ACK = 'https://sai-temp.example.org'

# 4. Build the production artifact.
npm.cmd run build

# 5. Verify the artifact that was just built (same origin variables set).
npm.cmd run release:verify -- --release --out reports/release/temp-origin.json
```

6. Read the verdict. `release:verify` prints a JSON report and exits
   `0 = PASS`, `1 = FAIL`, `3 = BLOCKED`. PASS means the locally provable
   contract holds (origin, canonical/Open Graph/sitemap/robots.txt/llms.txt,
   Markdown twins, noindex rules, artifact cleanliness, package and protocol
   identity). BLOCKED means an operator decision or external check is
   outstanding — typically a missing release acknowledgement, or the
   DNS/HTTPS/hosting/redirect/indexing entries, which are listed but never
   claimed offline. FAIL names the demonstrated defect; fix the cause,
   rebuild, and re-verify. A FAIL is never a BLOCKED: unavailable external
   services do not convert a real defect into a waiting state.

```powershell
# 7. Preserve the verified candidate before it can be superseded.
# Never archive raw dist/ (it still carries diagnostics + non-public locales).
# The factory already keeps the last verified generation; export the portable
# proof for the shelf as well:
npm.cmd run release:package
# -> .site-work/release/packages/<store-id>/<store-id>-<sha12>.zip
# -> reports/release/packages/<origin-slug>.json  (candidate + package digests)

# 8-9. Rebuild for a different domain, then prove the old origin is gone.
$env:SAI_SITE_ORIGIN = 'https://saipenprotocol.com'
$env:SAI_RELEASE_ORIGIN_ACK = 'https://saipenprotocol.com'
npm.cmd run build
npm.cmd run release:verify -- --release --out reports/release/planned-origin.json
npm.cmd run release:dual-origin   # both origins + stale-mutation control
```

```powershell
# 10. Roll back: re-host the previously verified GENERATION, then re-verify it.
npm.cmd run release:doctor   # shows active vs previous generation + digests
# Copy the previous generation's tree (verbatim) into a serving directory,
# or unpack the shelf ZIP from step 7, then re-verify that exact content:
npm.cmd run release:verify -- --release --public --dist <restored-tree>
# Never roll back by copying raw dist/ leftovers: only a digest-verified
# public candidate (or its verified ZIP) is publishable.
```

What the gates mean:

- Build success is not release success. `astro build` can succeed while
  stamping the wrong origin; only `release:verify` PASS proves the
  artifact matches its claimed origin.
- Offline validation is not live verification. PASS proves the files are
  correct; it does not prove DNS resolves, TLS serves, the host serves
  `dist/` with clean URLs and correct content types, redirects work, or
  search engines index as intended. Those need the operator on the real host.
- The domain must equal the actual hosting URL. Canonical links, sitemap,
  robots.txt and llms endpoints all name it; a mismatch fails verification
  and misleads crawlers and AI consumers.
- A future migration to the permanent domain needs an externally verified
  redirect plan on the host (temporary origin to permanent). The verifier
  cannot create or check redirects.
- Upload the verified public candidate (or its verified ZIP) only — never
  the repository root and never raw `dist/`, which still contains `/debug/`
  diagnostics and non-public locales. The artifact boundary
  (`artifact.clean`) rejects version-control metadata, SSH keys,
  credentials, environment files, project memory (`.saipen/`), reports,
  source and test trees, build configuration, executables, packaging
  leftovers, hidden files and symlinks; only pages, bundles, images, fonts
  with licence notices, intended JSON manifests and approved Markdown twins
  may ship.
- Diagnostics are crawl-hint only. `/debug/` pages carry noindex and stay
  out of the sitemap, and `robots.txt` adds `Disallow: /debug/` — but that
  hint may hide the noindex directive from compliant crawlers, so exclusion
  from search results is never guaranteed. `robots.txt` is not access
  control. Review `/debug/` before every release; any sensitive diagnostic
  content blocks publication.
- Operator-only checks: DNS, HTTPS/TLS, hosting behaviour, redirects,
  actual search indexing, publication authorization, ET/RU independent
  review, and the release-origin acknowledgement itself. An autonomous
  coding agent must never perform, approve or claim these.
