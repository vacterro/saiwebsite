SAI_WEBSITE

# FUTURE GATES

Status: DEFERRED CAPABILITIES
Purpose: prevent premature scope expansion while preserving clear long-term paths.

A Future Gate is not an active task.
It becomes active only when prerequisites are met and the previous core website remains stable.

---

# FG-001 — PUBLIC DOMAIN / HOSTING

Trigger:

- local build stable
- homepage coherent
- docs shell real
- canonical content paths decided

Then:

- acquire/attach domain
- configure DNS
- configure HTTPS
- static deployment
- redirects/404
- deployment CI

Non-goal before trigger:

Do not make local development depend on Cloudflare/Vercel/Netlify.

---

# FG-002 — STRICT PIXEL TEXT

Trigger:

- Wintage DOM typography stable
- clear list of UI surfaces that materially benefit from literal bitmap glyphs

Possible implementation:

- bitmap glyph atlas
- Canvas 2D
- integer coordinates
- smoothing disabled
- semantic accessibility mirror

Non-goal:

Never rasterize long documentation.

---

# FG-003 — REAL SERVICE STATUS

Trigger:

At least one real hosted SAIPEN service exists.

Then:

- uptime source
- incident state
- service components
- history
- degraded status

Before trigger:

`/status/` remains an honest placeholder or static project/build status surface.

---

# FG-004 — LIVE PUBLIC METRICS

Trigger:

A defined benchmark or telemetry source exists.

Then publish only measured values with methodology.

Potential metrics:

- recovery success
- continuation success
- verification success
- intervention rate
- evidence completeness
- mean recovery time

Never fabricate vanity counters.

---

# FG-005 — DETERMINISTIC PLAYGROUND

This is an early-safe future feature and may activate relatively soon.

Trigger:

- protocol states are documented enough to simulate correctly

Implementation:

client-only scripted scenarios.

No accounts, models, secrets, or backend.

---

# FG-006 — REAL AGENT PLAYGROUND

Trigger:

- deterministic playground proven useful
- safe sandbox architecture exists
- cost controls exist
- abuse controls exist
- isolation reviewed

Then consider real agent/model execution.

Required design areas:

- quotas
- authentication
- secret handling
- sandboxing
- timeouts
- artifact retention
- abuse response
- billing exposure

---

# FG-007 — SAIPEN CLOUD

Trigger:

There is a real external need for managed infrastructure beyond local/self-host usage.

Possible capabilities:

- persistent project state
- hosted relay
- hosted evidence retention
- remote workers
- observability
- shared team state

Must remain optional.
The open/local protocol path must not be artificially broken to force cloud adoption.

---

# FG-008 — AUTHENTICATION

Trigger:

A feature exists that truly needs identity.

Do not add auth solely because SaaS sites usually have a Sign In button.

When required:

- define identity provider strategy
- session model
- account deletion
- recovery
- security logging
- privacy model

---

# FG-009 — BILLING / PRICING

Trigger:

- paid service actually exists
- cost drivers understood
- entitlement model defined

Then:

- plans
- invoices
- tax handling
- cancellation
- entitlement downgrade behavior
- payment provider

Before trigger:

Pricing page remains descriptive/planned, not fictional commerce.

---

# FG-010 — ORGANIZATIONS / TEAMS

Trigger:

Multi-user hosted usage exists.

Then define:

- organization
- membership
- roles
- project ownership
- evidence visibility
- audit access
- invitation lifecycle
- deletion/transfer

---

# FG-011 — ENTERPRISE CONTROLS

Trigger:

Real enterprise demand.

Potential:

- SSO
- SCIM
- policy controls
- retention policy
- audit export
- data residency
- SLA

Do not implement enterprise theatre early.

---

# FG-012 — REMOTE EXECUTION

Trigger:

Hosted execution is economically and technically justified.

Required:

- worker isolation
- network policy
- filesystem policy
- time/resource limits
- secret injection
- cleanup guarantees
- artifact extraction
- kill switch
- abuse handling

This is a separate security product, not a tiny backend endpoint.

---

# FG-013 — USER UPLOADS

Trigger:

A concrete workflow needs them.

Required:

- size limits
- type rules
- malware/abuse handling
- retention
- privacy
- deletion
- access control

Do not add arbitrary file upload to the public site casually.

---

# FG-014 — CONTACT / FORMS

Trigger:

A real support/contact process exists.

Prefer simple links initially.
If forms appear, define spam handling and data retention.

---

# FG-015 — ANALYTICS

Trigger:

Public traffic exists and product questions justify measurement.

Default preference:

low-intrusion, privacy-conscious analytics.

Do not install a tracker merely because every site has one.

---

# FG-016 — ADVANCED SEARCH

Trigger:

Static/local search stops being sufficient.

Potential:

- hosted index
- semantic search
- version-aware search
- API search

Must preserve technical result quality over marketing content.

---

# FG-017 — MCP DOC ACCESS

Trigger:

Canonical docs structure is stable enough for machine consumption.

Then expose documentation to agents through a stable machine-oriented interface if useful.

---

# FG-018 — OPENAPI / HOSTED API DOCS

Trigger:

A real hosted HTTP API exists.

No API documentation should be invented before an API exists.

---

# FG-019 — INTERNATIONALIZATION

Trigger:

Canonical English technical content is stable enough to translate without constant churn.

Required:

- translation status
- canonical terminology
- outdated translation warning
- stable locale routing

---

# FG-020 — BLOG / RESEARCH PIPELINE

Trigger:

There is a repeatable publishing workflow.

Separate:

- release notes
- design notes
- research
- tutorials
- case studies

---

# FG-021 — COMMUNITY SURFACE

Trigger:

A real community channel and moderation ownership exist.

Potential links:

- GitHub Discussions
- Discord
- contribution guide
- roadmap feedback

Avoid building a custom forum inside SAI_WEBSITE.

---

# FG-022 — PUBLIC CONFORMANCE SUITE

Trigger:

Protocol compatibility requirements are stable enough to test independently.

Potential outputs:

- conformance badge
- test matrix
- version
- evidence bundle

A badge must be evidence-backed.

---

# FG-023 — RELEASE / DOWNLOAD CATALOG

Trigger:

Enough public software artifacts exist to justify a unified catalog.

Required fields:

- canonical project
- version
- platform
- release date
- checksum
- signature status
- source/release link

---

# FG-024 — SECURITY DISCLOSURE PROGRAM

Trigger:

Public hosted attack surface or material external adoption exists.

Potential:

- security contact
- disclosure policy
- supported versions
- response expectations

Bug bounty only if actually funded and operated.

---

# FG-025 — PWA / OFFLINE DOCS

Trigger:

Offline documentation has demonstrated value.

Do not add a service worker early if it risks stale docs/cache confusion.

---

# FG-026 — DESKTOP-MODE PRESENTATION

Trigger:

Core site usability is already proven.

Optional stronger retro mode may include:

- desktop background
- application window metaphor
- folder-like navigation
- classic dialogs

Must preserve URLs, browser navigation, accessibility, search, and content semantics.

---

# FG-027 — THEME SYNC WITH WINTAGE

Trigger:

SAI_WEBSITE and Wintage both evolve enough that manual copying becomes drift-prone.

Possible solution:

- shared schema package
- generated theme pack
- validation pipeline
- versioned snapshot import

Do not create a tight runtime dependency between unrelated applications merely to avoid copying 16 JSON files.

---

# FG-028 — LIVE GITHUB PROJECT DATA

Trigger:

Public ecosystem page needs release/status automation.

Potential generated fields:

- latest release
- latest tag
- repository link
- release date

Do not let GitHub API availability block static rendering.
Prefer build-time generation with safe fallback.

---

# FG-029 — CASE STUDIES

Trigger:

Real, permissioned deployments exist.

No fictional customers or fabricated quotes.

---

# FG-030 — MARKETPLACE / INTEGRATION DIRECTORY

Trigger:

There are enough independent integrations to justify curation.

Until then, a simple ecosystem page is superior.

---

# GATE ACTIVATION RULE

A Future Gate may activate only when:

1. its trigger is real;
2. prerequisites are satisfied;
3. the previous milestone remains healthy;
4. ownership and maintenance cost are understood;
5. the feature does not silently redefine protocol authority;
6. the feature has explicit acceptance and rollback behavior.
