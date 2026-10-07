# Translating SAI_WEBSITE

This is the complete brief for whoever translates the site — a person or an
AI agent arriving with no context. Read it once, then work only through the
commands below. You never need to search the repository: every unit you have
to translate comes to you in one work package with its context, and every
mistake a translation can make is caught before it is written.

## What exists already

The site is built in canonical English. Everything a translation can touch is
split into stable units:

| Unit | Where the English lives | Where its translation goes |
|------|-------------------------|----------------------------|
| Block (UI string, paragraph, label) | `src/content-engine/blocks/<domain>.json` | `src/locales/<locale>/<domain>.json` |
| Navigation label | `src/content-engine/registry/pages.json` (`label`) | `src/locales/<locale>/pages.json` |
| Documentation **segment** | `src/content/docs/<section>/<name>.md`, one `<!-- i18n:<segment id> -->` line before each segment | `src/locales/<locale>/docs/<section>/<name>.json`, one entry per segment ID |

A documentation page is **not** one unit. Its title, its description and every
section are separate, stable segments, each with its own hash and its own
entry, so editing one paragraph marks one segment stale — not the whole page,
and not the same paragraph in thirty-three languages at once. The segment ID
(`docs.getting-started.introduction.what-persists`) is permanent: it does not
change when the heading is reworded, when a section is reordered, or when the
text is edited. You never invent an ID; `i18n:export` hands you the ones that
exist.

You do not create or edit these files by hand. `i18n:export` gives you the
units, `i18n:import` writes them. The English files are not yours to change.

Locales are data in `src/content-engine/i18n/locales.json`. Estonian (`et`) and
Russian (`ru`) are registered as `pilot` and **disabled**: their pages are not
built until they are translated and enabled. `qps-ploc` is a generated
pseudo-locale used by the tests; ignore it.

The pilot scope — what a locale must cover before it can be enabled — is the
site shell, the home, about, pricing, search and 404 pages, the navigation
labels, the documentation chrome, and the four pages of the *Getting started*
docs section.

The exact current unit count is authoritative from
`npm run i18n:status -- --locale <id>` (add `--json` for a machine-readable
form) and from each `i18n:export` work package. Do not trust a number written
down in prose — a hand-kept total is exactly the drift this content engine
exists to prevent.

## The workflow

```bash
npm install                                   # once
npm run build                                 # the gates read the built site

npm run i18n:status                           # where every locale stands
npm run i18n:export -- --locale et            # writes i18n-work/et.work.json
#   ... fill every "translation" field in that file ...
npm run i18n:import -- i18n-work/et.work.json # validates, then writes src/locales/et/
npm run i18n:validate                         # every rule, with red controls
npm run i18n:status -- --locale et            # what is left
```

Repeat export → fill → import until `i18n:status` shows 100 %. Then:

```bash
npm run i18n:enable -- et                     # refused unless complete and drawable
npm run build
npm run site:refresh                          # regenerate inventory and locks
npm run site:doctor                           # must end HEALTHY
npm run audit:build && npm run validate:content && npm run validate:registry
npm run test:i18n && npm run test:pixel       # layout, overflow, pixel closure
```

`i18n-work/` is scratch space and is not committed. Commit `src/locales/`,
`src/content-engine/i18n/locales.json` (after `i18n:enable`) and the
regenerated manifests.

## The work package

`i18n:export` writes one JSON file. You fill exactly two kinds of field and
touch nothing else:

```jsonc
{
  "locale": "et",
  "glossary": { "doNotTranslate": [...], "terms": [...] },
  "units": [
    {
      "id": "home.hero.licence",          // stable ID, do not change
      "kind": "block",                    // block | segment
      "type": "text",                     // text | inline (block), text | markdown (segment)
      "source": "MIT-licensed. Protocol {version}; this site describes commit {commit}.",
      "sourceHash": "3f0c…",              // ties your text to this exact English
      "note": null,                       // context, when the English alone is ambiguous
      "usedBy": ["page:home"],            // where it appears
      "placeholders": ["commit", "version"],
      "keepMarkup": null,                 // for inline units: the markup you must keep
      "previous": null,                   // your old text, when the English changed (STALE)
      "memory": [],                       // an approved identical string to reuse
      "translation": ""                   // <- fill this
    },
    {
      "id": "docs.getting-started.introduction.what-persists",  // stable segment ID
      "kind": "segment",
      "type": "markdown",                 // text (title/description) | markdown (a section)
      "document": "getting-started/introduction",
      "section": "getting-started",
      "source": "## What persists\n\nA cold agent answers five questions…",
      "sourceHash": "88b0…",
      "keepMarkdown": { "fences": [], "code": ["STATE.md"], "links": [], "headings": [2] },
      "context": { "before": "…the previous segment…", "after": "…the next segment…" },
      "previous": null,
      "memory": [],
      "translation": ""                   // <- fill this
    }
  ]
}
```

Leave a `translation` empty to skip that unit for now; import writes only
filled units. Never edit `sourceHash`: import refuses a unit whose English
changed after export, and that is the point. A segment's `context` is the
neighbouring segments for orientation only — never translate it, and never
send back a whole document.

## Rules a translation must keep

Import checks every one of these and refuses the unit that breaks it, with
the reason. `i18n:validate` checks them again over everything stored.

1. **Placeholders** — every `{name}` in the English appears in the translation,
   spelled exactly, and no new one appears. Move them where the grammar needs
   them; the page fills them in (`{version}` → `8.1.0`).
2. **Inline markup** (`type: "inline"`) — the same `` `code spans` `` with
   identical content, the same link targets `[label](/same/target/)` in the
   same nesting, the same `**strong**` structure. Translate the label text,
   never the code or the target. Only these three markups exist; do not add
   others.
3. **Plain text** (`type: "text"`) carries no markup at all.
4. **Documentation segments** — a `markdown` segment keeps every fenced code
   block byte for byte, every inline code span, every link target, and the same
   headings at the same levels in the same order as its own English. A `text`
   segment (a document title or description) carries no markup at all.
   Translate prose, headings, list items and table text. Code, commands, file
   names and URLs stay exactly as the English has them.
5. **Do-not-translate terms** — every term in `glossary.doNotTranslate` that
   occurs in the English must occur verbatim in the translation: `SAIPEN`,
   `SAIPEN Protocol`, `Wintage`, `Golden Default`, `.saipen/`, `STATE.md`,
   `BOARD.md`, `LOG.md`, `KNOWLEDGE/`, `next_action`, `saipen continue`, the
   upper-case phase names (`VERIFY`, `REVIEW`, `SHIP`, `BLOCKED`), `WAIT`,
   `GitHub`, `Discord`. Never decline, transliterate or quote them differently
   Inflect only by a suffix that leaves the term intact (Estonian `SAIPEN-i`);
   in Russian keep it undeclined (`SAIPEN`, never `САЙПЕН`).
6. **Glossary terms** — `glossary.terms` lists the domain words (agent, cold
   agent, recovery, ticket, gate, evidence…) with their meaning. Use one
   rendering per term across the whole locale. Record your choice in
   `src/content-engine/i18n/glossary.json` under `locales.<locale>.<term id>`:
   `{ "preferred": "agent", "forbidden": ["agendid"], "notes": "…" }`.
   From then on a forbidden variant fails validation.
7. **Characters** — the site draws text with pixel fonts that cover Basic
   Latin, Latin-1, Latin Extended-A (all Estonian letters: õ ä ö ü š ž), the
   Russian Cyrillic block U+0400–U+045F, general punctuation (– — ‘ ’ “ ” « » …),
   arrows and box drawing. A character outside that set (for example `ґ`,
   emoji, CJK) is refused on import, because the browser would draw it in a
   blurred fallback font. Use `«…»` or `„…“` quotes as your language prefers;
   both are drawable.

## Style

- This is technical documentation and a tool interface. Translate meaning,
  not words; keep sentences short; keep the dry, exact register of the
  English. No marketing tone, no added claims, no softening of "never" or
  "must".
- UI labels (menu items, buttons, column headings, badges) must stay short.
  The Wintage interface does not grow to fit long words; the tests fail a page
  that overflows a 320 px screen. Prefer the shortest correct term.
- Notes in the package (`note`) explain context; read them. Lower-case list
  items in English (the "What breaks without it" list) complete a heading —
  keep them grammatical continuations in your language.
- Plurals: units such as `search.status.many` give one plural form with
  `{count}`. If your language needs several forms, choose the form that reads
  correctly for most counts and keep `{count}`; a plural-rule extension is a
  separate future change.
- Protocol vocabulary that appears as data (phase names, error codes, project
  roles, ticket titles, support details) is not in the packages; it stays
  canonical and is marked `lang="en"` on translated pages. That is intended.

## Statuses

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| `MACHINE_DRAFT` | Translated, not yet reviewed (default of `i18n:import`) | import |
| `REVIEWED` | A second reader checked it against the English | `i18n:import -- FILE --status REVIEWED --reviewer <who>` |
| `CURRENT` | Reviewed and approved for publication | `--status CURRENT --reviewer <who>` |
| `MISSING` | No translation yet | computed |
| `STALE` | The English changed after the translation was made | computed from `sourceHash` |
| `ORPHANED` | The English unit no longer exists; the translation can be removed | computed |

Pilot locales render `CURRENT`, `REVIEWED` and `MACHINE_DRAFT`. A `STALE` or
`MISSING` unit is never shown: that unit shows the English text in its place,
marked with `lang="en"`, and `site:doctor` lists it as translation work. This
is per segment, so one stale paragraph falls back to English inside an
otherwise translated page; the rest of the page stays translated. An English
edit therefore never breaks the build; it only creates work for you — and only
for the segments it actually touched.

## Authoring a new section (canonical English)

A documentation page is segmented with one directive on its own line, before
each translatable segment:

```markdown
<!-- i18n:docs.getting-started.introduction.what-persists -->
## What persists

A cold agent answers five questions from the files alone:
…
```

Give the new segment a stable ID: `docs.<section>.<name>.<segment>`, lower-case
and dotted, matching the page's path. Then run `npm run site:refresh`. The new
segment appears to every translator as one `MISSING` unit; no locale file is
touched by hand and no translated segment is disturbed. Renaming or reordering
sections leaves every ID — and every translation attached to one — alone.

## When the English changes

```bash
npm run i18n:status -- --locale et            # STALE and MISSING units are listed
npm run i18n:export -- --locale et --status stale,missing
```

Stale units carry `previous` (your old text) next to the new `source`; update
only what changed. `npm run i18n:memory -- --locale et` lists English strings
identical to ones you already reviewed; `--apply` copies those translations in
as `MACHINE_DRAFT` for you to check.

## Adding another language

```bash
npm run i18n:add -- de --name German --native Deutsch --script Latn
npm run i18n:export -- --locale de
```

The new locale is `planned` and disabled. If `i18n:add` reports a FONT GAP,
the pixel fonts cannot draw that script yet (Greek, Arabic, Hebrew, CJK,
Devanagari, Thai): the locale stays planned until a separate font milestone
adds the glyphs. Do not try to work around it.

## Definition of done for a locale

- `npm run i18n:status` shows the locale at 100 % with no `STALE` units.
- `npm run i18n:enable -- <locale>` succeeded.
- `npm run build`, `npm run site:refresh`, then `npm run site:doctor` ends
  `HEALTHY`, and `npm run check`, `npm run lint`, `npm run validate:content`,
  `npm run validate:registry`, `npm run audit:build`, `npm run i18n:validate`,
  `npm run test:i18n`, `npm run test:shell` and `npm run test:pixel` pass.
- The language selector appears on the translated pages and on their English
  originals, `sitemap.xml` lists the translated pages, and each page carries
  `hreflang` alternates.

## Do not

- edit English catalogues, `pages.json` labels or `src/content/docs/` to make a
  translation fit;
- edit `sourceHash`, `status` or `reviewer` by hand, or write unit files
  without `i18n:import`;
- edit generated files (`src/content-engine/manifests/*`,
  `src/content-engine/inventory/*`, `src/content-engine/i18n/font-coverage.json`);
- enable a locale by editing `locales.json` instead of `i18n:enable`;
- translate the pseudo-locale, protocol data, code, commands, file names or URLs.
