agent: saipen-01
role: core
model_or_runtime: unknown
project: vacterro-saiwebsite
saipen_version: 8.1.0
protocol_fingerprint: sha256:928936d6e80c7ac38dca1796e049d4177a2a70e9d1fd96ccdf0e1f44b6f80bb1
source_head: 92946d5b58e521a8a47512c85659ee5d2173283b
source_tree_fingerprint: git-delta-v1:0fca782c44e3591861f0f146226e5ff41db71dd743b5669e052e1a7b669041b5
discovery_model: git-delta-v1
context_scope: SAIPEN audit, phase DONE
context_available: partial
report_status: complete

## RUN 1

IMP-001 [P2] [PROJECT_VIOLATION] [reproduced] [ticket] -- two DONE own_patch host tickets assert installed-host behaviour the live host lacks, and the blocker they cite no longer holds

expected: a ticket closed `own_patch` whose `verify:` clause names installed-host behaviour has that behaviour present in the installed host at V:/___VAC/__K/__CODE/_AI_STUFF_AGENTIC/_SAIPEN, or the clause names the shipped patch artifact instead of the host. T-37 verify: "closing a no-delta ticket as own_patch without --paths is refused with the alternate modes named". T-38 verify: "continue --json reports cycle age and draft/no-RUN state for the assigned cycle". Both tickets, and T-36, cite the same blocker in their shipped README: "The SAIPEN host tree is under an external restorer that reverts every write within seconds".

actual: the live host carries neither fix. tools/saipen_engine/continue_fallback.py defines no `cycle_liveness` (grep -c returns 0), so `saipen continue --json` returns {"code":"CONTINUE_IMPROVE_IN_FLIGHT","cycle_id":"imp-vacterro-saiwebsite-20261014-1"} with no age, no draft/no-RUN state and no submit route. tools/saipen_engine/operations.py defines no `no_delta_build_events` (grep -c returns 0), so T-37's guard is absent from `_plan_finish_ticket`. The cited blocker is stale: T-39's patch from the same batch IS present and stable -- tools/saipen_engine/log.py carries `_CONTROL_FAIL_RE` (grep -c returns 2) with mtime 2026-10-14 04:47, newer than saipen.py (2026-10-13 22:38), operations.py (2026-10-13 23:14) and continue_fallback.py (2026-09-27 05:14). All three shipped patches still apply cleanly: `git -C <host> apply --check -p1` returns 0 for kitchen/T-36|T-37|T-38/host-patch/*.patch.

evidence: BOARD.md lines 43-46 -- T-36..T-39, all [P3] DONE closure_mode own_patch, with the verify clauses quoted above; `saipen checkpoint bogus` in this project returns REFUSE [VALIDATION_FAILED] "taxonomy 'bogus' outside ['DEC', 'RUN']" (T-36's refusal half holds, its --help half does not: the usage line still prints "checkpoint <TAXONOMY>"); `saipen continue --json` in this project prints the payload quoted above; the grep counts and mtimes above; host VERSION 8.1.0; canonical ticket T-50 (BLOCKED on the host owner).
