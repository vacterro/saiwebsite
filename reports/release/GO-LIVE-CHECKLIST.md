# Go-live checklist (generated, origin-specific)

Handoff state: FULL_READY_FOR_OPERATOR_HANDOFF — every invariant below was re-verified against live bytes and receipts.

Derived from the verified package receipt below. Do not hand-edit the
metadata lines; regenerate with `node scripts/release-checklist.mjs`.
No hosting account action has been taken. Nothing here deploys anything.

- Origin (exact): https://saipenprotocol.com
- Generation: g-f0b12a4c683ea764
- Candidate files: 137
- Candidate SHA-256: f0b12a4c683ea76413a34b5d32c2c57cf964d2d90e632eb6dddf6566435f126e
- Package file: .site-work/release/packages/saipenprotocol-com-6dc40565e4/saipenprotocol-com-6dc40565e4-f0b12a4c683e.zip
- Package SHA-256: 6777e831799aa44a20bdc51328cbbc5da8e40d9bd45f17ba174a9b9e7090e41c
- Package bytes: 14838262
- Readiness: FULL_READY_FOR_OPERATOR_HANDOFF (bound generation receipt, package bytes re-verified)
- Extraction: PASS + LOCAL_STATIC_HOST_PASS
- Publication authorized: false (operator decision; no remote action performed)

## LOCAL READY 

[x] Package holds the verified public tree for THIS origin only.
[x] Homepage, docs, spec, sitemap, robots, llms.txt, 404 verified for THIS origin.
[x] No backend required; no credentials, reports, or project state in the ZIP.
[x] Rollback: previous verified generation or shelf ZIP (see `npm run release:doctor`).

## EXTERNAL BLOCKED (never claimed offline)

- [ ] DNS for the hostname above.
- [ ] HTTPS/TLS on the host.
- [ ] Host static behavior: clean directory URLs, content types, 404 handling.
- [ ] Live redirects and permanent-domain migration policy.
- [ ] Live search-indexing behavior.
- [ ] Publication authorization by the operator.

## OPERATOR ACTION REQUIRED

1. Upload ONLY the package file above (never the repo root, never raw `dist/`).
2. Serve it and check canonical/sitemap/robots/content-types ON THE REAL ORIGIN.
3. Keep the previous verified generation/ZIP as the rollback artifact.
4. ET/RU publication stays disabled pending independent review.
