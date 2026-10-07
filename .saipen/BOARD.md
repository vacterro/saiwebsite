# Board

<!-- Ticket shape is RFC § 1.2's, exactly: a checkbox, the T-### id, a
     description, then only the fields that apply, space-pipe separated.
     Shown here WITHOUT its leading "- " on purpose (see below):

       [ ] T-001 short description | verify: pytest -q

     Other legal fields (RFC § 1.2): the dependency one, taking a
     comma-separated list of T-### this ticket waits on; owner and
     claim_time for claims (§ 1.4); blocker for facts + dead ends; verify as
     shown above. Named rather than shown here on purpose -- see below.

     A real line starts with "- ". Checkbox: [ ] open, [/] in progress
     (## DOING), [x] done (## DONE). A status change MOVES the line between
     sections -- cut and paste, never copy, or the same id ends up under two
     headings. All four headings below are required, even while empty.

     Why the example is de-fanged: neither validator skips HTML comments, so
     anything ticket-shaped in here is read as a real ticket on a brand-new,
     untouched board. Two separate traps, both hit for real while writing
     this very file: a full checkbox line parses as a live ticket, and the
     dependency field followed by an id is flagged as a dangling reference
     even without a leading dash -- tests/validate.sh scans for that field
     across the whole file, not only ticket lines, making it stricter here
     than tools/validate.py. So: no leading dash on any example, and never
     write that field name next to a concrete id anywhere in this file. -->

## DOING
- [/] T-8 [P2] Release-readiness convergence: open-licence production pixel fonts + social card, validate:licenses gate, bench as production verification, stale copy, singl... | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-007 | owner: saipen | claim_time: 2026-10-07T05:37:41Z

## TODO
- [ ] T-9 [P2] Tint the images in src/media/ to the site palette and place them where they fit; the SAIPEN wordmark image is the hero/header for now | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-008


## DONE
- [x] T-7 [P2] Apply review: author/operator identity on About (created+maintained by vacterro via multi-agent workflows, why-built origin, builder principles, beyond SAIPE... | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-006 | owner: saipen | claim_time: 2026-10-07T05:21:42Z | closure_mode: own_patch
- [x] T-4 [P2] Continue fully building the site to completion, roadmap as guide | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-003 | owner: saipen | claim_time: 2026-10-07T05:00:08Z | closure_mode: own_patch
- [x] T-5 [P2] Design must be exactly Wintage + SAIPEN UI.md: no anti-aliasing, pixel perfect (proof by rendered pixels) | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-004 | owner: saipen | claim_time: 2026-10-07T04:15:08Z | closure_mode: own_patch
- [x] T-3 [P2] T-3 M4 SITE SHELL CONVERGENCE: reserve the eight missing roadmap routes (/status/ /playground/ /benchmarks/ /downloads/ /security/ /community/ /blog/ /change... | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-002 | owner: saipen | claim_time: 2026-10-07T03:52:37Z | closure_mode: own_patch
- [x] T-2 [P2] M3 FULL 16-THEME SYSTEM: theme switcher over all 16 validated packs, local persistence without login, pre-paint theme application (no FOUC / no white flash), safe fallback to Golden Default when a stored slug is unknown or removed, and theme regression gates — plus /debug/rendering and visual regression baselines from WINTAGE_WEB_CONTRACT 25-26 | verify: npm run build && npm run check && npm run validate:themes && npm run audit:build all exit 0; a stored unknown slug resolves to Golden Default; first paint carries the stored palette with no flash and no framework default | owner: saipen | claim_time: 2026-10-07T02:29:39Z | closure_mode: own_patch
- [x] T-1 [P2] SAI_WEBSITE bootstrap: Astro+TS static site, Wintage Golden Default token foundation, core visual primitives, initial routes, debug/components acceptance bench | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-001 | owner: saipen | claim_time: 2026-10-07T01:37:32Z | closure_mode: own_patch

## BLOCKED
- [ ] T-6 [P2] Survey github.com/vacterro and integrate the relevant SAIPEN ecosystem projects harmoniously (no 40-repo dump), plus own improvements without harming the site | verify: the requested change is present and demonstrated against the user own description of it | request_witness: model_supplied | source_receipts: SRC-005 | owner: saipen | claim_time: 2026-10-07T05:00:27Z | blocker: implemented and verified inside T-4 (E-64); no separate diff to ship | blocker_scope: ticket
