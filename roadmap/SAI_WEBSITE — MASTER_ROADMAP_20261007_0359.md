SAI_WEBSITE

# MASTER ROADMAP

Version: planning-v1
Generated: 2026-10-07
Project family: WEB
Status: PLANNED / READY FOR LOCAL BOOTSTRAP
Primary future domain target: `saipenprotocol.com`
Canonical visual identity: Wintage / Golden Default

---

# 0. PROJECT CHARTER

## Mission

Build the canonical public web surface for the SAIPEN ecosystem.

SAI_WEBSITE must explain SAIPEN to humans, expose reliable technical documentation to agents, publish a stable protocol/specification surface, index the ecosystem, provide demonstrations, and later become the entry point for optional hosted SAIPEN services.

The website is not the SAIPEN protocol implementation itself.
It is not the canonical execution engine.
It must not silently become a second source of protocol truth.

The first useful version must work completely locally with no domain, no backend, no database, no account, no payment system, and no third-party runtime dependency beyond ordinary package installation.

## Strategic intent

SAI_WEBSITE should achieve four things simultaneously:

1. Make SAIPEN understandable in under one minute for a new technical visitor.
2. Make deep protocol material easy to navigate for engineers and AI agents.
3. Give SAIPEN a visual identity that is unmistakable from a screenshot.
4. Create a stable foundation for future hosted services without forcing hosted-service complexity into the static website.

## Core principles

- Local-first.
- Static-first.
- Documentation-first.
- Protocol authority is explicit.
- Wintage visual identity is mandatory, not optional decoration.
- Golden Default is the canonical first-render theme.
- All 16 Wintage palettes are supported as user-selectable themes when the theme layer is implemented.
- Pixel discipline beats generic modern SaaS styling.
- Accessibility and browser semantics beat theatrical retro gimmicks when they conflict.
- No fake metrics, fake service status, fake compatibility, or invented stable commands.
- Build brick by brick.
- Every large future feature enters through a Future Gate rather than leaking into the early architecture.

---

# 1. PRODUCT SURFACES

## Initial local routes

The first shell should reserve these routes even when content is only a structured placeholder:

- `/`
- `/docs/`
- `/spec/`
- `/ecosystem/`
- `/pricing/`
- `/about/`
- `/status/`
- `/playground/`
- `/benchmarks/`
- `/downloads/`
- `/security/`
- `/community/`
- `/blog/`
- `/changelog/`

A placeholder must declare its maturity rather than pretending the feature exists.

Allowed page maturity values:

- `placeholder`
- `draft`
- `experimental`
- `preview`
- `stable`
- `deprecated`

## Future domain layout

Potential public surfaces:

- `saipenprotocol.com` — canonical public site
- `docs.saipenprotocol.com` — optional docs host if split later
- `status.saipenprotocol.com` — real operational status only when services exist
- `play.saipenprotocol.com` — interactive playground if separation becomes useful
- `app.saipenprotocol.com` — future hosted SAIPEN Cloud UI

Do not split into subdomains early unless there is a concrete operational reason.
One static application is easier to build, test, search, and maintain during the first stages.

---

# 2. RECOMMENDED INITIAL STACK

## Default choice

- Astro
- TypeScript
- Markdown / MDX
- Astro Starlight for documentation infrastructure if it does not fight the Wintage presentation layer excessively
- npm with committed lockfile
- static generation
- Playwright later for browser and screenshot regression

## Why this stack

Astro is well suited to a mostly static technical site with small islands of interactivity.
Starlight can provide documentation routing, content collections, search, table of contents, and accessibility primitives while allowing the visual layer to be replaced.

## Architectural rule

Framework behavior may be used.
Framework appearance is not authoritative.

No Starlight, Tailwind, component library, or browser default visual style may override the Wintage contract.

## Required commands

The repository should converge on ordinary commands such as:

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run preview`
- `npm run test`
- `npm run test:visual`
- `npm run lint`
- `npm run validate:content`

Only add scripts once they have real behavior.
Do not create ceremonial scripts that do nothing.

---

# 3. REPOSITORY SHAPE

Recommended initial shape:

```text
SAI_WEBSITE/
  README.md
  package.json
  package-lock.json
  astro.config.*
  tsconfig.json

  public/
    favicon/
    icons/
    images/
    social/
    downloads/
    robots.txt
    llms.txt

  src/
    assets/
    components/
      chrome/
      controls/
      docs/
      marketing/
      protocol/
    content/
      docs/
      spec/
      blog/
    data/
    layouts/
    pages/
    styles/
      tokens.css
      wintage.css
      docs.css
      utilities.css
    themes/
      schema.ts
      index.ts
      packs/
    utils/

  scripts/
    validate-themes.*
    validate-links.*
    validate-content.*
    generate-llms.*
    generate-metrics.*
    generate-sitemap.*

  tests/
    smoke/
    navigation/
    content/
    accessibility/
    visual/

  .github/
    workflows/

  .saipen/
    ...only when the project itself is placed under SAIPEN tracking
```

Do not force this exact tree if Astro/Starlight conventions make a small adjustment cleaner.
The design goal is clear ownership, not folder bureaucracy.

---

# 4. CONTENT AUTHORITY MODEL

## Required hierarchy

SAIPEN canonical protocol/spec sources
→ reviewed/generated website technical reference
→ explanatory docs
→ marketing summary

If any level conflicts with a higher level, the higher authority wins.

## Content types

### Canonical reference

Machine-checkable protocol details, schemas, state transitions, error semantics, required fields, stable version definitions.

### Engineering documentation

How the protocol works, examples, implementation guidance, recovery behavior, compatibility constraints.

### Product explanation

Human-friendly problem/solution material.

### Marketing copy

Concise positioning and calls to action.

Marketing copy must never redefine technical behavior.

## Drift prevention

Later add automated checks that compare generated website reference material to canonical SAIPEN sources where practical.

Potential future flow:

canonical spec → generator → website reference → CI verification

---

# 5. INFORMATION ARCHITECTURE

## Getting Started

- Introduction
- Why SAIPEN
- Mental model
- Quickstart
- First project
- First recoverable workflow
- Terminology

## Concepts

- Goal
- Project
- Agent
- Executor
- Runtime
- State
- Evidence
- Verification
- Recovery
- Continuation
- Fallback
- Admission
- Conflict
- Operator action
- Degraded operation

## Protocol

- Lifecycle
- State machine
- Execution contract
- Verification contract
- Recovery contract
- Evidence contract
- Continuation contract
- Fallback contract
- Error classification
- Fail-open behavior
- Fail-closed behavior
- Compatibility
- Conformance

## Recovery

- Recoverable failure
- Unrecoverable failure
- Interrupted execution
- Tool failure
- Provider failure
- Context loss
- State restoration
- Agent replacement
- Partial progress
- Conflict handling
- Recovery evidence

## Evidence

- What counts as evidence
- Artifact identity
- Hashing
- Logs
- Verification receipts
- Reproducibility
- Evidence lifecycle
- Evidence retention

## CLI

Document only commands that actually exist and are externally supported.
Possible future topics include initialization, status, verify, recover, and launch behavior, but the website must not invent a stable CLI API merely to fill a page.

## Integrations

Each integration page must expose a maturity/evidence state:

- supported
- experimental
- planned
- unavailable
- unknown

Never mark an integration as supported only because an adapter could theoretically be written.

## Specification

- protocol versions
- schema versions
- required fields
- optional fields
- state transitions
- error codes
- compatibility rules
- conformance rules
- deprecation rules
- permanent URLs

## Reference

- glossary
- files
- configuration
- schemas
- environment
- status values
- exit/error reference

## FAQ

Questions should answer the predictable confusion directly:

- Is SAIPEN an agent framework?
- Does SAIPEN require a specific model?
- Does SAIPEN require cloud infrastructure?
- Can SAIPEN run entirely locally?
- What happens when an agent crashes?
- What happens when a provider is unavailable?
- How does recovery differ from retry?
- What is evidence?
- Is the protocol open?
- Is SAIPEN Cloud required?

---

# 6. HOMEPAGE PLAN

## Goal

A technical visitor should understand the core idea in approximately 30–60 seconds.

## V1 layout

### Window chrome / top area

A Wintage application-window visual language with real web navigation.
Do not build a fake desktop that breaks browser expectations.

### Hero

Candidate positioning:

SAIPEN Protocol
Reliable autonomous work for AI agents.

Candidate supporting phrase:

Agents fail. Work shouldn't.

Primary actions:

- Get Started
- Read the Spec

Secondary actions:

- GitHub
- Ecosystem

### Problem panel

Agents can:

- crash
- lose context
- lose tools
- hit provider limits
- stop halfway
- return partial work
- disagree with recovered state

The work should remain inspectable and recoverable.

### Simple lifecycle diagram

GOAL
→ PLAN
→ EXECUTE
→ VERIFY
→ EVIDENCE
→ RECOVER / CONTINUE
→ DONE

Do not expose the entire internal state machine on the homepage.

### Principles panel

- Recoverable
- Auditable
- Model-independent
- Evidence-driven
- Local-first
- Degraded-operation aware

### Deterministic recovery story

A fictional visual sequence can demonstrate:

1. Agent A progresses to 43%.
2. Provider becomes unavailable.
3. State and evidence remain.
4. Agent B is admitted.
5. Work continues from the verified boundary.
6. Verification passes.
7. Task finishes.

No real model call is needed in early versions.

### Ecosystem panel

Show the SAIPEN family only with accurate maturity labels.
Potential cards may include projects such as SAITULS, ZAICODE, SAIMAIL, SAIRELAY, AUDAPACK, and others when their public descriptions are ready.

### Documentation call to action

Short path into Quickstart and Concepts.

### Open project call to action

GitHub / organization / repository links when canonical public targets are ready.

### Footer/status line

A Wintage status-bar presentation may show real static information such as:

- site build version
- active palette
- protocol docs version

Do not show live status without a real backend source.

---

# 7. WINTAGE DESIGN FOUNDATION

The detailed rendering contract lives in the companion WINTAGE document.
This roadmap treats it as mandatory.

Key laws:

- Golden Default is canonical and initial.
- All 16 Wintage palettes are eventual selectable themes.
- 21-token schema remains authoritative.
- 0px radius.
- no box shadows.
- no text shadows.
- no blur / backdrop blur.
- 2px bevel borders are the depth language.
- Verdana-first typography.
- hard pixel iconography.
- nearest-neighbor raster scaling.
- motion is normally instant.
- browser semantic text remains semantic, even though absolute no-AA cannot be guaranteed cross-platform.
- strict bitmap rendering is reserved for selected UI/branding surfaces, not long-form documentation.

---

# 8. MILESTONE SEQUENCE

## M0 — Repository bootstrap

Deliverables:

- repository initialized
- Astro + TypeScript running
- npm lockfile committed
- `npm run dev` works
- `npm run build` works
- minimal README
- no backend
- no external runtime service

Acceptance:

Fresh checkout can install and build without manual edits.

Non-goals:

No polished homepage, no all-theme implementation, no cloud.

## M1 — Wintage design kernel

Deliverables:

- Golden Default token pack
- CSS variables
- typography stack
- global zero-radius rule
- global zero-shadow rule
- global zero-blur rule
- 2px raised bevel primitive
- 2px sunken bevel primitive
- hard focus outline primitive
- basic button/input/panel/window/status-bar primitives

Acceptance:

A debug page visibly proves the design laws.
No generic framework card/button styling leaks through.

## M2 — Component Lab

Create `/debug/components`.

Display:

- typography ladder
- links
- buttons
- pressed buttons
- disabled controls
- inputs
- textarea
- select
- checkbox
- radio
- tabs
- menu bar
- toolbar
- tree view
- table
- raised panel
- sunken panel
- window chrome
- dialog
- code block
- callouts
- status bar
- focus states
- icons

Acceptance:

Every production component can be inspected independently of the homepage.

## M3 — Full 16-theme system

Deliverables:

- all 16 palette packs
- schema validation
- theme switcher
- local persistence
- pre-paint theme selection to prevent white/default flash
- safe fallback to Golden Default
- `/debug/themes`

Acceptance:

All palettes cover exactly the required 21 tokens and render the Component Lab without missing variables.

## M4 — Site shell

Deliverables:

- global header/menu
- desktop navigation
- compact mobile navigation
- footer/status area
- breadcrumbs
- route placeholders
- theme selector integration
- responsive layout

Acceptance:

All reserved routes are navigable and no placeholder pretends to be implemented.

## M5 — Documentation shell

Deliverables:

- docs sidebar/tree
- main content layout
- table of contents
- code blocks
- callouts
- previous/next navigation
- heading anchors
- search entry point
- content maturity badges

Acceptance:

A real sample documentation hierarchy is readable on desktop and mobile, keyboard navigable, and visually Wintage-consistent.

## M6 — Core explanatory content

Publish first serious docs:

- Introduction
- Why SAIPEN
- Mental model
- Terminology
- Lifecycle
- Recovery overview
- Evidence overview

Acceptance:

A reader unfamiliar with SAIPEN can explain the purpose without reading internal project history.

## M7 — Specification surface

Deliverables:

- `/spec/`
- stable version URLs
- latest alias behavior
- schema rendering
- state transition rendering
- error/status reference structure
- version/maturity metadata

Acceptance:

Stable specification links can be referenced externally without changing meaning silently.

## M8 — Homepage V1

Deliverables:

- hero
- problem
- lifecycle summary
- principle panels
- deterministic recovery story
- ecosystem preview
- docs/spec CTA
- public repo CTA when valid

Acceptance:

The page explains SAIPEN quickly without requiring a scroll through implementation trivia.

## M9 — Protocol Visualizer V1

Start static.

Deliverables:

- SVG or DOM state diagram
- clickable state nodes
- side detail panel
- state purpose
- allowed inputs/outputs
- transitions
- recovery paths

Do not start with Canvas/WebGL.

Acceptance:

Visualizer remains usable with JavaScript disabled at a basic static level when practical.

## M10 — Ecosystem catalog

Deliverables:

- `/ecosystem/`
- project cards
- category grouping
- maturity labels
- repository/docs links
- compatibility indicators only where evidenced

Acceptance:

The page explains relationships among projects rather than dumping repository names.

## M11 — Compatibility matrix

Deliverables:

- runtime matrix
- capabilities by dimension
- evidence/maturity markers
- test date or verification reference where available

Potential dimensions:

- launch
- continuation
- recovery
- evidence
- account isolation
- fallback
- remote execution

Acceptance:

Every positive support claim has an evidence source or explicit maturity status.

## M12 — Agent-readable documentation

Deliverables:

- `/llms.txt`
- later `/llms-full.txt`
- clear canonical links
- machine-readable schema links
- clean Markdown-oriented technical pages

Acceptance:

An AI agent can identify canonical docs and authority boundaries without scraping decorative UI.

## M13 — Search

Start with static/local docs search if the framework supports it cleanly.

Requirements:

- docs
- spec
- reference
- examples

Marketing/blog results should not overwhelm technical answers.

Keyboard shortcut may use Ctrl+K / Cmd+K.

Acceptance:

Search works without a paid hosted service.

## M14 — Accessibility hardening

Deliverables:

- keyboard navigation
- visible focus
- skip links
- meaningful landmarks
- semantic heading order
- form labels
- accessible theme selector
- reduced-motion support
- screen reader review

Acceptance:

Retro appearance does not recreate 1997 accessibility defects.

## M15 — Performance budget

Initial targets should be explicit and revised with measurements.

Principles:

- mostly static HTML
- small JavaScript islands
- compressed pixel assets
- no hero video
- no decorative WebGL
- no giant UI runtime
- no unnecessary client hydration

Add budget checks when the project has enough material to measure meaningfully.

Acceptance:

The site feels immediate on ordinary hardware and does not require SPA-scale JavaScript for static docs.

## M16 — Visual regression

Deliverables:

- Playwright or equivalent
- Golden Default screenshot baselines
- homepage
- docs
- spec
- ecosystem
- pricing placeholder
- component lab
- theme lab

Later add reduced coverage for all 16 themes.

Acceptance:

Visual changes become deliberate review events rather than unnoticed drift.

## M17 — Content validation / CI

Checks may include:

- broken internal links
- missing frontmatter
- duplicate slugs
- bad maturity values
- missing alt text where required
- theme schema drift
- build errors
- malformed spec references
- accessibility smoke

Acceptance:

Main branch cannot publish structurally broken docs unnoticed.

## M18 — SEO / discoverability foundation

Deliverables:

- titles
- descriptions
- canonical URLs
- Open Graph metadata
- social preview images
- sitemap
- robots
- structured semantic headings
- meaningful page URLs

Avoid SEO spam.
Write for engineers first.

## M19 — Downloads surface

Initially this can be a catalog linking to verified releases rather than hosting binaries directly.

Potential fields:

- project
- version
- platform
- release date
- checksum
- signature status
- repository release URL

Acceptance:

No stale download button can silently point to an obsolete or unknown binary.

## M20 — Security page

Document:

- responsible disclosure path
- supported versions when relevant
- checksum/signature guidance
- trust model
- hosted vs local security boundaries

Do not invent a bug bounty until one actually exists.

## M21 — Benchmarks / metrics foundation

Begin as methodology before numbers.

Potential metrics:

- recovery success rate
- mean recovery time
- manual intervention rate
- continuation success
- protocol overhead
- evidence completeness
- conformance pass rate

Only publish measurements generated from a defined method.
Never invent vanity numbers.

## M22 — Pricing placeholder

The pricing page may exist early as a transparent statement:

- protocol: open/free
- local/self-host path: free where applicable
- hosted services: not yet available / planned

Do not publish fabricated paid plans before the service and cost model exist.

The long-term pricing model should monetize managed infrastructure rather than access to the protocol specification itself.

## M23 — Deterministic playground

Before any real remote execution, build a purely client-side scenario simulator.

Scenarios may include:

- provider unavailable
- interrupted execution
- partial progress
- recovered continuation
- verification failure
- conflict requiring operator action

Acceptance:

No API key, account, backend, or model cost is required.

## M24 — Blog / changelog

Keep distinct:

- changelog = factual releases/changes
- blog = explanation, research, design notes, case studies

Support permanent article URLs.

## M25 — Deployment-ready static build

Before buying or attaching infrastructure, verify:

- static output
- base URL handling
- asset paths
- canonical URL config
- sitemap generation
- cache-safe filenames
- 404 behavior
- redirects strategy

Acceptance:

The exact same repository can be deployed without rewriting site internals.

## M26 — Domain / production hosting

Only after local site quality is sufficient.

Suggested simple path:

- domain registrar
- Cloudflare DNS
- Cloudflare Pages or equivalent static host
- HTTPS
- deployment from Git

The host must remain replaceable.

## M27 — Production monitoring

Once a public endpoint exists:

- uptime
- certificate expiry where needed
- build/deploy health
- broken-link scheduled checks

A public status page is only useful once there are real services to report.

## M28 — Analytics

Prefer low-intrusion analytics.

Collect only data that answers real product questions.
Avoid surveillance-style tracking by default.

Useful initial questions:

- which docs pages are used
- where visitors enter
- whether Quickstart is reached
- whether docs searches fail
- what outbound project links are used

## M29 — Internationalization gate

Do not internationalize every page before English canonical technical content stabilizes.

When enabled:

- canonical source language defined
- translation status visible
- outdated translations marked
- spec terminology glossary shared
- URLs stable

Potential initial languages can be decided based on actual audience rather than vanity coverage.

## M30 — Public launch readiness

Launch criteria should include:

- homepage coherent
- Quickstart real
- Concepts real
- spec authority clear
- ecosystem links valid
- no fake pricing
- no fake compatibility
- no broken theme states
- mobile usable
- keyboard path usable
- social preview sane
- sitemap/robots valid
- build reproducible
- visual identity stable

---

# 9. PRICING STRATEGY

## Principle

Do not sell the protocol specification itself as a paywall product.

Potential future monetization belongs around optional managed infrastructure:

- hosted execution
- persistent cloud state
- shared team state
- managed relay
- hosted evidence/artifact retention
- observability
- organization controls
- SSO / enterprise policy
- support / SLA
- remote worker compute

## Early pricing page behavior

Until a product actually exists, the page should be explicit rather than aspirational.

Example conceptual structure:

Community / Protocol
- open docs/spec
- local usage
- self-host path where supported

SAIPEN Cloud
- planned / preview / available depending on reality

Enterprise
- only when there is a real offering

Do not publish arbitrary monthly prices solely to make the site look complete.

---

# 10. PLAYGROUND STRATEGY

## Stage A — deterministic simulation

Client-side state machine with scripted events.

## Stage B — local playground

Optionally allow users to run examples against local tooling if a safe integration exists.

## Stage C — hosted sandbox

Future Gate only.
Requires:

- abuse controls
- cost controls
- isolation
- quotas
- observability
- retention rules
- security review

## Stage D — user-provided runtime integration

Future Gate only.
Do not accept raw secrets into a static front-end design casually.

---

# 11. METRICS AND TRUST

## Public metrics rules

Every metric must be one of:

- directly generated from public repository data
- generated from a documented benchmark pipeline
- generated from real hosted telemetry with privacy safeguards
- explicitly labeled as demonstration/sample data

Do not display fabricated counts such as agent runs, success percentages, or customers.

## Trust surfaces

Potential future pages:

- `/security/`
- `/conformance/`
- `/benchmarks/`
- `/compatibility/`
- `/changelog/`
- `/status/`

These pages should become more valuable than decorative marketing claims.

---

# 12. SEO / AGENT DISCOVERABILITY

## Human search

Use clear vocabulary:

- SAIPEN Protocol
- AI agent recovery
- agent continuity
- recoverable AI workflows
- AI agent evidence
- AI agent verification
- model-independent agent protocol

Do not keyword-stuff.

## Agent search

Provide:

- llms.txt
- clean Markdown
- canonical spec links
- explicit versioning
- schema files
- stable anchors
- machine-readable examples

Potential future additions:

- MCP documentation access
- OpenAPI for hosted services
- downloadable docs bundle
- canonical JSON index

---

# 13. ACCESSIBILITY VS PIXEL PURITY

The site aims for strong pixel/no-AA presentation, but accessibility remains a release requirement.

Never rasterize long-form documentation simply to force glyph edges.

Never break:

- text selection
- copy/paste
- browser find
- screen readers
- search indexing
- translation
- deep links

Use strict bitmap rendering only on surfaces where semantic text can remain available separately.

---

# 14. RESPONSIVE STRATEGY

Desktop can use a richer classic application layout.
Mobile must not become a generic Material/iOS redesign.

Preserve across breakpoints:

- square geometry
- bevel language
- palette
- typography
- status presentation
- pixel icons
- hard focus
- instant interactions

Reduce columns, not identity.

---

# 15. SECURITY / PRIVACY BASELINE

Early static site should have almost no attack surface.

Avoid adding:

- unnecessary forms
- user accounts
- arbitrary uploads
- server-side execution
- secret storage
- third-party trackers

If contact forms are added later, they enter through a dedicated reviewed gate.

If hosted services appear later, treat them as a separate security architecture rather than extending the static site casually.

---

# 16. RELEASE MODEL

Potential maturity:

- local-dev
- preview
- public-beta
- stable-public

Do not call the website stable merely because it renders.

Stable-public should mean:

- content authority defined
- docs navigation coherent
- links validated
- Wintage visual contract enforced
- basic accessibility passing
- public deployment reproducible
- no known critical broken routes

---

# 17. BACKLOG DISCIPLINE

New ideas should be captured without widening the active corridor automatically.

Use categories:

- NOW
- NEXT
- LATER
- FUTURE_GATE
- REJECTED

A new idea does not become active implementation simply because it is interesting.

This protects SAI_WEBSITE from becoming a half-finished browser OS, docs engine, SaaS, marketplace, community platform, analytics product, and remote execution service simultaneously.

---

# 18. DEFINITION OF EARLY SUCCESS

The first successful SAI_WEBSITE is not a commercial platform.

It is a local static website where:

- the project boots predictably
- Golden Default is unmistakable
- Wintage rules are enforced
- all core routes exist
- docs layout is real
- the first SAIPEN explanation is understandable
- protocol authority is clear
- future features have placeholders instead of fake implementations
- build/test structure exists

That is enough to begin accumulating quality brick by brick.

---

# 19. DEFINITION OF PUBLIC SUCCESS

A successful public version should make a visitor think:

1. I understand what SAIPEN is.
2. I can find the spec.
3. I can verify what is actually supported.
4. I can see how recovery works.
5. I know which repositories/projects matter.
6. This website is visually unmistakable.
7. I am not being tricked by fake SaaS marketing.

---

# 20. FIRST ACTIVE TARGET

The active target after creating the project should be deliberately small:

BOOTSTRAP + GOLDEN DEFAULT DESIGN KERNEL + COMPONENT LAB SEED.

Do not start real pricing, cloud, auth, real playground, telemetry, or full documentation yet.

The companion BOOTSTRAP_CORRIDOR file defines this first implementation slice precisely.
