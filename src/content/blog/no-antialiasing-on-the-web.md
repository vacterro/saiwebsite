---
title: No anti-aliasing on the web, and how we prove it
description: CSS cannot switch font smoothing off. This site renders crisp 1-bit text anyway, and a test counts every pixel to keep it that way.
date: 2026-10-07
kind: design-note
---

SAIPEN's UI guidelines have a blunt first law: Verdana, non-antialiased,
everywhere. Every glyph pixel is either the text colour or the background
colour — no grey fringe, no ClearType rainbow, no half-pixel edge. Desktop
toolkits make that a one-line setting. Browsers do not.

## Why the CSS hints are not enough

`-webkit-font-smoothing: none` only does anything on macOS, and modern macOS
ignores most of it. `font-smooth: never` is not implemented anywhere that
matters. On Windows, Chromium decides how text is rasterised from the system
setting and the font itself, not from the stylesheet. So a page that only sets
the hints still ships anti-aliased text to most visitors — it just looks right
on the author's machine.

## Pixel-grid faces

The route that does work is the one SAIPEN's UI.md names: a pixel-grid web
font, used at its native size.

Wintage, the theme this site is built in, names a font called `Verdana_m1`
first in its stack. Inside it are hand-tuned 1-bit bitmap strikes — the
Verdana bitmaps Windows draws when smoothing is off — for every size from 3
to 30 pixels. A build script reads the strikes for the five sizes the site
uses (10, 11, 12, 14 and 16 px) and turns every lit pixel into a square in a
TrueType outline, with the units-per-em chosen so one square is exactly one
CSS pixel at that size. Each face also carries the same bitmaps as an embedded
strike, which is what puts DirectWrite on its aliased bitmap path.

A rasterizer that smooths edges has nothing to smooth when every edge lies on
a pixel boundary. Coverage is either 0 or 1.

Bold is the classic bitmap emboldening — the glyph OR-ed with itself one
pixel to the right — and italic is a whole-pixel shear, because a synthesised
slant would smear the grid. Code uses Spleen, a real bitmap monospace font
under the BSD licence.

## Keeping every edge on the grid

The faces are half of it. The other half is layout:

- **Integer line heights with even leading.** `line-height: 1.2` at 12 px is
  14.4 px, which puts every second baseline between two pixels. Each size has
  a whole-pixel line height whose leading is an even number.
- **No miter corners.** A two-colour 2 px border meets its neighbour on a
  45-degree diagonal, and the rasterizer smooths that diagonal. The bevels
  here are six solid rectangles painted in the border area instead, which
  gives Windows 95's stepped corners and no blended pixel.
- **No browser glyphs.** List bullets and the disclosure triangle are drawn by
  the browser as smoothed shapes at fractional positions; they are replaced by
  whole-pixel squares and arrow masks.
- **No decoration lines.** Link underlines are 1 px borders, which snap to
  the grid; a text-decoration line is drawn at the text run's sub-pixel
  origin.

## The proof is pixels

UI.md is explicit that a flag check proves nothing: the evidence is rendered
pixels. So the site has a test that renders every page in Chromium and in
WebKit, takes a full-page screenshot and checks every single pixel against the
closed set of 21 palette colours. A smoothed glyph edge, a blended corner, a
transparent overlay or a stray browser default produces a colour outside the
set and fails the page with the coordinates of the first offender.

A gate that cannot fail is not a gate, so before the result counts the same
counter must detect two deliberately bad inputs: an anti-aliased circle, and a
line of text shifted by a fraction of a pixel.

The first run of that test failed every page on the site. The failures were
exactly the four causes listed above.

## The honest limits

- The faces are generated from Microsoft's Verdana bitmaps. Their
  redistribution rights are not verified, so the build marks them for local
  and preview use, and publishing the site waits on that question.
- Browser zoom and fractional display scaling resample everything. The site
  is crisp at 100 % and integer scale factors; at 125 % no web page is.
- Long-form text stays real text — selectable, searchable and readable by
  screen readers. Nothing was turned into an image to make it sharp.
