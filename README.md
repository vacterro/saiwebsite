# SAI_WEBSITE

Official website and documentation portal for the [SAIPEN Protocol](https://github.com/saipenhq/.github).

A pixel-exact, Wintage-inspired static documentation site for recoverable, auditable, model-independent AI-agent workflows.

![SAIPEN Website — Golden Default](.github/assets/saiwebsite-home.png)

---

## 1. What This Is

`saiwebsite` is the public web surface for the SAIPEN protocol: comprehensive documentation, an interactive specification reference generated from the canonical registry, an ecosystem catalogue, a compatibility matrix, a deterministic scenario playground, and trust pages.

The site is:
- **Static and local-first:** Zero backend, zero tracking, zero cookies, no accounts, no external runtime requests.
- **Pixel-exact retro UI:** Rendered using the **Wintage / Golden Default** design language and SAIPEN's `UI.md` iron laws — sharp pixel-grid typography with zero anti-aliasing.
- **Dogfooded:** Built and maintained using the SAIPEN protocol itself; the build inspects its own `.saipen/` board and logs to verify integrity.

---

## 2. Why SAIPEN

AI coding agents are stateless by design: when contexts compact or sessions reset, models forget prior attempts, requirements, and decisions.

SAIPEN solves this by anchoring memory in the repository itself (`.saipen/`):
- **Phased state machine:** Clear phase transitions (INIT, PLAN, SCOUT, BUILD, VERIFY, REVIEW, SHIP).
- **Verifiable tickets:** Every task carries explicit completion criteria, witness levels, and verifiable receipts.
- **Durable audit log:** Sequential event log preserving attempt history and blockers.
- **Autonomous continuation:** Any agent can run `saipen continue` and immediately resume the work without hallucinating context.

---

## 3. Website Highlights

- **Documentation Portal:** Structured guides, conceptual deep dives, protocol specifications, operational commands, and recovery runbooks.
- **16 Wintage Palettes:** Instant client-side theme switching across all 16 canonical Wintage color packs (Golden Default, Classic, Vintage Dark, Claude Code, Antigravity, K-Lite, Dracula, Nord, Solarized, OLED, and more).
- **Deterministic Playground:** Step-by-step interactive simulation of provider outages, verification failures, destructive operations, and interrupted checkpoints.
- **Specification Visualizer & Live Aliases:** Interactive state-machine exploration generated directly from the protocol schema.
- **Fast Local Search:** Keyboard-first search (Ctrl+K) indexed statically at build time.
- **Agent-First Accessibility:** Includes complete `/llms.txt` and `/llms-full.txt` endpoints for LLM consumers.

---

## 4. Visual Themes

![SAIPEN Website — Theme System](.github/assets/saiwebsite-themes.png)

The site supports 16 theme packs derived from Wintage, each defined by exactly 21 color tokens. Theme selection persists in localStorage with zero layout shift or white flash (FOUC).

---

## 5. Visual Law and Pixel Font Pipeline

- **No Anti-Aliasing:** Font smoothing is disabled by design. Every text element uses custom 1-bit pixel-grid outlines (`SAI Pixel 10/11/12/14/16`, derived from DejaVu Sans; `SAI Pixel Mono 12`, derived from Spleen 6x12).
- **Stepped Win95 Bevels:** Depth is achieved via 2px stepped bevel layers — no CSS box-shadows, no rounded corners, no blur.
- **Proven by Rendered Pixels:** Automated Playwright pixel gates screenshot rendered pages in Chromium and WebKit, verifying that every single pixel belongs strictly to the 21 active palette tokens.

---

## 6. Local Development

### Requirements
- Node.js 22+
- npm 10+
- Python 3.10+ (for font and media generation tools)

```bash
git clone https://github.com/vacterro/saiwebsite.git
cd saiwebsite
npm install
npm run dev        # Local dev server at http://localhost:4321
npm run build      # Static production build -> dist/
npm run preview    # Preview static build at http://localhost:4321
```

Or run `start.cmd` on Windows to build and preview in your default browser.

---

## 7. Validation & Quality Gates

Every gate is verified before release:

```bash
npm run check               # Astro & TypeScript type check
npm run lint                # Style law lint (zero hex colors, no blur/shadow/smoothing)
npm run validate:themes     # Schema conformance across all 16 palettes
npm run validate:canonical  # Protocol snapshot integrity against upstream SHA-256
npm run validate:content    # Verifies all internal links, anchors, and metadata
npm run validate:baselines  # Checks 33 visual baselines against manifest
npm run validate:licenses   # Redistribution license check for fonts, card, notices
npm run audit:build         # HTML landmarks, headings, budgets, and theme contracts
npm test                    # Full Playwright test suite (runtime, shell, content, pixel, visual)
```

---

## 8. Project Structure

```text
saiwebsite/
├── public/                 # Static production assets (fonts, media, social card)
│   ├── fonts/              # SAI Pixel WOFF2 font files & licenses
│   ├── media/              # Brand marks, 1-bit masks, and golden favicon
│   └── social/             # OpenGraph preview card and provenance manifest
├── src/
│   ├── components/         # Wintage UI primitives (Window, Panel, Button, MenuBar)
│   ├── content/docs/       # Technical documentation pages
│   ├── data/canonical/     # Upstream SAIPEN registry & schema snapshots
│   ├── layouts/            # SiteLayout, DocsLayout, SpecLayout
│   ├── pages/              # Astro routes, spec generator, playground, search
│   ├── styles/             # Token foundations, Wintage global rules, site CSS
│   └── themes/             # 16 canonical palette JSON definitions & runtime
├── scripts/                # Verification, license validation, and asset generators
├── tests/                  # Playwright pixel, shell, content, and visual baselines
└── start.cmd               # Quick launcher for local preview
```

---

## 9. Current Publication Status

- **Source Code:** Public repository on GitHub (`vacterro/saiwebsite`).
- **Version:** `v1.2.0` (Production readiness convergence).
- **Public Deployment:** Planned (hosting and domain attachment deferred behind future gates).

---

## 10. License & Notices

- Third-party font, asset, and framework licenses are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Upstream protocol specifications and schemas are © vacterro (MIT License).
- See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

---

## 11. Links

- [SAIPEN HQ Organization](https://github.com/saipenhq/.github)
- [SAIPEN Protocol Repository](https://github.com/vacterro/saipen)
- [Wintage Repository](https://github.com/vacterro/Wintage)
