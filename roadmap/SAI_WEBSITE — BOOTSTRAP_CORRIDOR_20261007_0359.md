SAI_WEBSITE

# BOOTSTRAP CORRIDOR

Target: establish a local project and visual DNA only.
Scope: narrow first implementation slice.

This corridor is intentionally smaller than the master roadmap.
The implementation agent should finish it completely before opening later milestones.

---

# 1. TARGET

Create a new local SAI_WEBSITE repository that:

- runs locally with Astro + TypeScript
- builds statically
- renders Golden Default from canonical Wintage values
- has no radius/shadow/blur leakage
- exposes raised/sunken 2px bevel primitives
- uses Verdana-first typography
- includes a minimal site shell
- includes `/debug/components`
- reserves future routes with honest placeholders

---

# 2. NON-GOALS

Do not implement:

- backend
- database
- auth
- payments
- SAIPEN Cloud
- real agent execution
- real pricing plans
- analytics
- hosted search
- account settings
- CMS
- user uploads
- remote GitHub API dependency
- all documentation content
- all 16 themes unless the bootstrap remains trivial after Golden Default is stable

The first wave should not become a website megaproject.

---

# 3. INITIAL FILES

Suggested first structure:

```text
SAI_WEBSITE/
  README.md
  package.json
  package-lock.json
  astro.config.mjs
  tsconfig.json

  public/
    favicon/
    icons/

  src/
    components/
      WintageWindow.astro
      WintageButton.astro
      WintagePanel.astro
      WintageStatusBar.astro
      ThemePlaceholder.astro

    layouts/
      SiteLayout.astro

    pages/
      index.astro
      docs/index.astro
      spec/index.astro
      ecosystem/index.astro
      pricing/index.astro
      about/index.astro
      debug/components.astro

    styles/
      tokens.css
      wintage.css
      site.css

    themes/
      schema.ts
      index.ts
      packs/goldendefault.json
```

Adapt naming to actual Astro conventions if needed.
Do not create layers that are not used.

---

# 4. GOLDEN DEFAULT TOKENS

Seed from the inspected Wintage source exactly:

```text
background       #1A1810
backgroundSoft   #232018
surface          #332E22
surfaceRaised    #3D372A
surfaceAlt       #453D30
borderDark       #100E08
borderHighlight  #F0D060
bevelLight       #75663D
borderMuted      #5A5040
textPrimary      #D4C89A
textSecondary    #9C9371
textMuted        #6E674E
accentTeal       #008080
accentTealDeep   #004C4C
success          #4A7A20
warning          #7A7A20
danger           #7A2020
dangerText       #D66464
selection        #3D372A
compareBack      #14120C
link             #F0D060
```

No hand-tuned replacements in bootstrap.

---

# 5. GLOBAL VISUAL RULES

Implement cleanly in the site's own CSS rather than mimicking the hostile override strategy required by a userscript.

Required:

- global square geometry
- no box shadow
- no text shadow
- no backdrop blur
- no decorative filter blur
- Verdana-first stack
- Golden Default body/background
- hard selection color
- clear classic links
- visible focus

Avoid universal `!important` unless there is a real framework-specific reason.
SAI_WEBSITE owns its own DOM and should not need to fight itself.

---

# 6. BEVEL PRIMITIVES

Create explicit reusable classes/components.

Raised:

```text
2px solid
border-color:
  top    bevelLight
  right  borderDark
  bottom borderDark
  left   bevelLight
```

Sunken:

```text
2px solid
border-color:
  top    borderDark
  right  bevelLight
  bottom bevelLight
  left   borderDark
```

No inset shadow.
No drop shadow.

---

# 7. TYPOGRAPHY

Use:

```text
Verdana_m1, Verdana, Tahoma, "MS Sans Serif", sans-serif
```

Do not copy `Verdana_m1.ttf` from the Wintage archive into the public website in this corridor.
Treat it as a locally available optional font name only until distribution rights are verified.

Use an initial disciplined scale:

- 10px metadata
- 11px compact control
- 12px default UI/body
- 14px section heading
- 16px page title

No giant hero font.

---

# 8. MINIMAL HOMEPAGE SHELL

Create a single classic application window with:

- title bar: `SAIPEN Protocol`
- menu/navigation row
- one hero panel
- one short protocol loop panel
- one placeholder ecosystem panel
- status bar

Copy can remain draft.
The point is layout and visual language, not marketing perfection.

Suggested navigation:

- Home
- Docs
- Spec
- Ecosystem
- Pricing
- GitHub placeholder only if the canonical URL is not yet wired

Do not create fake close/minimize controls unless they have clear semantics.

---

# 9. PLACEHOLDER ROUTES

Each unfinished route should render:

- route title
- maturity: `PLACEHOLDER`
- one sentence describing intended content
- link back to Home or relevant parent

Do not use Lorem Ipsum.

---

# 10. COMPONENT LAB

`/debug/components` must show at least:

- body text
- secondary text
- muted text
- heading sizes
- link
- raised button
- active/sunken button
- disabled button
- input
- textarea
- select
- raised panel
- sunken panel
- window chrome
- status bar
- code block
- success/warning/danger sample
- focus state sample

This page becomes the visual acceptance surface for later work.

---

# 11. PIXEL ASSET RULE

Bootstrap may use temporary CSS/ASCII/simple handcrafted assets.

If raster pixel assets are introduced:

- store native source dimensions
- render with nearest-neighbor
- no transform scale
- prefer integer scale

Do not spend the first corridor building a complete icon atlas.

---

# 12. BASIC RESPONSIVE BEHAVIOR

At minimum verify:

- desktop width
- narrow desktop/tablet
- mobile width

Mobile may stack panels.
It must retain the same Wintage visual language.

No separate rounded mobile design.

---

# 13. BASIC ACCESSIBILITY

Required in bootstrap:

- semantic landmarks
- logical heading order
- keyboard links/buttons
- visible focus
- labels for form samples
- no color-only status meaning

Do not postpone all accessibility until the end.

---

# 14. BUILD ACCEPTANCE

Required commands:

```text
npm install
npm run dev
npm run build
npm run preview
```

Acceptance:

- clean fresh install
- dev server opens
- build succeeds
- preview serves generated build
- no normal-navigation console errors
- all initial routes load

---

# 15. VISUAL ACCEPTANCE

Golden Default must be visually obvious.

Verify:

- background matches canonical token
- raised and sunken bevels are exactly 2px borders
- radius is zero
- no visible shadow
- no blur
- no modern rounded framework controls
- Verdana fallback works
- focus is visible
- homepage shell looks like one coherent Wintage application rather than independent styled cards

---

# 16. REGRESSION ACCEPTANCE

Before closing bootstrap, inspect source for accidental:

- `border-radius`
- `box-shadow`
- `text-shadow`
- `backdrop-filter`
- decorative gradients
- transform scaling
- long transitions

If framework defaults introduce them, neutralize them centrally.
Do not spray random per-component overrides.

---

# 17. BOOTSTRAP DONE CONDITION

Close the first corridor only when:

1. local project is reproducible;
2. Golden Default tokens are canonical;
3. global Wintage rules are centralized;
4. bevel primitives are reusable;
5. component lab exists;
6. homepage shell exists;
7. reserved routes exist;
8. build succeeds;
9. keyboard/focus basics work;
10. no backend/cloud/account/payment work has leaked in.

Then the next recommended milestone is:

M3 FULL 16-THEME SYSTEM

or, if theme import is trivial and low-risk, finish the remaining 15 palettes immediately after Golden Default acceptance before moving to docs.
