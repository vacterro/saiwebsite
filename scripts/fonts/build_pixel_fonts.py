"""
Build the pixel-grid webfonts that let SAI_WEBSITE render text with no
anti-aliasing (SAIPEN UI.md, iron law 1 and "Non-antialiased text").

Why this exists
---------------
CSS cannot switch anti-aliasing off on Windows: `-webkit-font-smoothing` and
`font-smooth` are hints that Chromium ignores there. UI.md names the only web
route that works: a pixel-grid webfont used at its native size. Every glyph in
these faces is a union of whole 1x1-pixel squares, and the font's units-per-em
is chosen so that one square is exactly one CSS pixel at the face's single
intended size. A rasterizer then has nothing to smooth: every pixel edge of
every glyph lies on a pixel boundary, so the coverage of each pixel is either
0 or 1 and the rendered text contains only the text colour and the background
colour. `tests/pixel-text.spec.mjs` proves that on real rendered pixels.

Inputs (only the approved, redistributable sources in scripts/fonts/sources.json)
------
* UI faces: DejaVu Sans 2.37 Regular and Bold (Bitstream Vera / DejaVu font
  licence), rasterized per size with FreeType hinting in 1-bit mode, then
  re-spaced so letters and digits sit evenly in whole-pixel advances. One face
  per ladder size: 10, 11, 12, 14, 16 px, regular and bold; italic (12 px, for
  prose emphasis) is a whole-pixel shear of the regular, one pixel per four
  rows. The family name "SAI Pixel" carries none of the reserved names
  (Bitstream, Vera, DejaVu), as the licence requires for derivatives.
* Code face: Spleen 6x12 (BSD 2-Clause, Frederic Cambus), a true bitmap
  monospace, read from its BDF source.

Every input is checked against the SHA-256 recorded in sources.json before it
is used, and the output manifest records the source, version, licence and hash
of every face, so scripts/validate-licenses.mjs can prove what ships.

Usage
-----
    python scripts/fonts/build_pixel_fonts.py --out public/fonts

Requires fontTools, brotli and Pillow. The generated files are committed, so
`npm run build` never needs Python.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

# One pixel = UNITS font units. upem = ppem * UNITS keeps it exact.
UNITS = 128

UI_SIZES = (10, 11, 12, 14, 16)
ITALIC_SIZES = (12,)

# Latin, Latin-1, Latin Extended-A, Cyrillic, general punctuation, currency,
# letterlike symbols, box drawing. The site is English; Cyrillic covers the
# Russian-language project names and quotes that appear in sources.
UNICODE_RANGES = (
    (0x0020, 0x007E),
    (0x00A0, 0x00FF),
    (0x0100, 0x017F),
    (0x0400, 0x045F),
    (0x2010, 0x2027),
    (0x2030, 0x203A),
    (0x20AC, 0x20AC),
    (0x2116, 0x2122),
    (0x2190, 0x2199),
    (0x2500, 0x257F),
)


def wanted(cp: int) -> bool:
    return any(lo <= cp <= hi for lo, hi in UNICODE_RANGES)


class Glyph:
    """A 1-bit glyph: rows top to bottom, '#' = ink, plus pixel metrics."""

    __slots__ = ("rows", "bx", "by", "adv")

    def __init__(self, rows: list[str], bx: int, by: int, adv: int):
        self.rows = rows  # each row a string of '#'/'.' of equal width
        self.bx = bx  # left bearing, px
        self.by = by  # top of the bitmap above the baseline, px
        self.adv = adv  # advance width, px

    @property
    def width(self) -> int:
        return len(self.rows[0]) if self.rows else 0


# --------------------------------------------------------------------------
# Sources
# --------------------------------------------------------------------------


def bdf_font(path: Path) -> tuple[dict[int, Glyph], int, int, str]:
    """Parse a BDF bitmap font. Returns (codepoint -> Glyph, ascent, descent, copyright)."""
    glyphs: dict[int, Glyph] = {}
    ascent = descent = None
    copyright_lines = []
    lines = path.read_text(encoding="utf-8").splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if line.startswith("COMMENT") and "Copyright" in line:
            copyright_lines.append(line.split("*", 1)[-1].strip())
        elif line.startswith("FONT_ASCENT"):
            ascent = int(line.split()[1])
        elif line.startswith("FONT_DESCENT"):
            descent = int(line.split()[1])
        elif line.startswith("STARTCHAR"):
            cp = adv = None
            bbx = None
            while not lines[i].startswith("BITMAP"):
                parts = lines[i].split()
                if parts[0] == "ENCODING":
                    cp = int(parts[1])
                elif parts[0] == "DWIDTH":
                    adv = int(parts[1])
                elif parts[0] == "BBX":
                    bbx = tuple(int(v) for v in parts[1:5])
                i += 1
            i += 1
            w, h, ox, oy = bbx
            rows = []
            for _ in range(h):
                value = int(lines[i], 16)
                nbits = len(lines[i]) * 4
                bits = format(value, f"0{nbits}b")[:w]
                rows.append(bits.replace("0", ".").replace("1", "#"))
                i += 1
            if cp is not None and cp >= 0 and wanted(cp):
                glyphs[cp] = Glyph(rows, ox, oy + h, adv)
        i += 1
    if ascent is None or descent is None:
        raise SystemExit(f"{path}: missing FONT_ASCENT/FONT_DESCENT")
    return glyphs, ascent, descent, "; ".join(copyright_lines)


# Line box per size: ascent + descent == size, so the even-leading integer
# line heights in tokens.css put every baseline on a whole pixel.
LINE_BOX = {10: (8, 2), 11: (9, 2), 12: (10, 2), 14: (11, 3), 16: (13, 3)}


def serif_capital_i(ppem: int, weight: int) -> tuple[list[str], int, int, int]:
    """Distinctive serifed capital I for screen disambiguation (Il1)."""
    if weight >= 700:
        if ppem == 10:
            return (["####", ".##.", ".##.", ".##.", ".##.", ".##.", "####"], 1, 7, 6)
        elif ppem == 11:
            return (["####", ".##.", ".##.", ".##.", ".##.", ".##.", ".##.", "####"], 1, 8, 7)
        elif ppem == 12:
            return (["####", ".##.", ".##.", ".##.", ".##.", ".##.", ".##.", ".##.", "####"], 1, 9, 7)
        elif ppem == 14:
            return (["######"] + ["..##.."] * 8 + ["######"], 1, 10, 8)
        else:
            return (["######"] + ["..##.."] * 10 + ["######"], 1, 12, 10)
    else:
        if ppem == 10:
            return (["###", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], 1, 7, 5)
        elif ppem == 11:
            return (["###", ".#.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], 1, 8, 5)
        elif ppem == 12:
            return (["###", ".#.", ".#.", ".#.", ".#.", ".#.", ".#.", ".#.", "###"], 1, 9, 5)
        elif ppem == 14:
            return (["###"] + [".#."] * 8 + ["###"], 1, 10, 6)
        else:
            return (["#####"] + ["..#.."] * 10 + ["#####"], 1, 12, 7)


def open_raster(path: Path, ppem: int, style: str = "regular", calibration: dict | None = None) -> dict[int, Glyph]:
    """Rasterize an openly licensed outline font (DejaVu Sans) to 1-bit glyphs.

    FreeType renders each glyph with its hinting in monochrome mode (Pillow's
    fontmode "1"). Metrics are tuned against canonical screen bitmap rhythm:
    advance widths and bearings provide the disciplined letter spacing, natural
    line density, and distinct punctuation proportions of a handcrafted screen face.
    """
    from PIL import Image, ImageDraw, ImageFont

    font = ImageFont.truetype(str(path), ppem)
    cmap = TTFont(path).getBestCmap()
    glyphs: dict[int, Glyph] = {}
    
    style_key = style.lower()
    cal_table = calibration.get(style_key, {}).get(str(ppem), {}) if calibration else {}

    for cp in sorted(cmap):
        if not wanted(cp):
            continue
        ch = chr(cp)
        canvas = Image.new("1", (ppem * 4, ppem * 4), 0)
        draw = ImageDraw.Draw(canvas)
        draw.fontmode = "1"
        ox, oy = ppem, ppem * 3
        draw.text((ox, oy), ch, font=font, fill=1, anchor="ls")
        raw_adv = max(1, round(font.getlength(ch)))
        box = canvas.getbbox()
        
        cal_entry = cal_table.get(str(cp))
        if not box:
            adv = cal_entry[0] if cal_entry else raw_adv
            glyphs[cp] = Glyph([], 0, 0, adv)
            continue
            
        x0, y0, x1, y1 = box
        rows = ["".join("#" if canvas.getpixel((x, y)) else "." for x in range(x0, x1)) for y in range(y0, y1)]
        width = x1 - x0
        bx = x0 - ox
        by = oy - y0
        
        # Characteristic shape refinements for screen clarity:
        # 1. Capital 'I' with serifs to prevent 'Il1' ambiguity at screen sizes
        if cp == 0x0049:
            w_cls = 700 if "bold" in style_key else 400
            i_rows, i_bx, i_by, i_adv = serif_capital_i(ppem, w_cls)
            glyphs[cp] = Glyph(i_rows, i_bx, i_by, i_adv)
            continue
            
        # 2. Lowercase 'i' at 12px: raise dot to ascender height (by=10)
        if cp == 0x0069 and ppem == 12 and style_key == "regular" and by == 9 and len(rows) == 9:
            # Shift the top dot row up by 1 pixel
            stem = rows[2:] # 7 rows of stem
            rows = ["#", ".", "."] + stem
            by = 10
            
        if cal_entry:
            t_adv, t_bx = cal_entry
            bx = t_bx
            if width <= t_adv and width + max(0, bx) > t_adv:
                bx = max(0, t_adv - width)
            adv = max(t_adv, width + max(0, bx))
        else:
            bx = max(0, bx)
            adv = max(raw_adv, width + bx)

        glyphs[cp] = Glyph(rows, bx, by, adv)
    return glyphs


# --------------------------------------------------------------------------
# Bitmap styles
# --------------------------------------------------------------------------


def embolden(g: Glyph) -> Glyph:
    """Classic bitmap bold: OR with a one-pixel right shift, advance + 1."""
    if not g.rows or "#" not in "".join(g.rows):
        return Glyph(g.rows, g.bx, g.by, g.adv + 1)
    rows = []
    for row in g.rows:
        a = row + "."
        b = "." + row
        rows.append("".join("#" if x == "#" or y == "#" else "." for x, y in zip(a, b)))
    return Glyph(rows, g.bx, g.by, g.adv + 1)


def italicize(g: Glyph, descent: int, cp: int = 0, cal_it: dict | None = None) -> Glyph:
    """Whole-pixel shear: rows shift right one pixel per four rows above the descender."""
    if not g.rows or "#" not in "".join(g.rows):
        adv = g.adv
        bx = g.bx
        if cal_it and str(cp) in cal_it:
            adv = cal_it[str(cp)][0]
            bx = cal_it[str(cp)][1]
        return Glyph(g.rows, bx, g.by, adv)
    shifts = [max(0, (g.by - r - 1 + descent) // 4) for r in range(len(g.rows))]
    top = max(shifts)
    rows = ["." * s + row + "." * (top - s) for row, s in zip(g.rows, shifts)]
    adv = g.adv
    bx = g.bx
    if cal_it and str(cp) in cal_it:
        t_adv, t_bx = cal_it[str(cp)]
        w_sh = len(rows[0]) if rows else 0
        if w_sh <= t_adv and w_sh + max(0, t_bx) > t_adv:
            bx = max(0, t_adv - w_sh)
        else:
            bx = t_bx
        adv = max(t_adv, w_sh + max(0, bx))
    return Glyph(rows, bx, g.by, adv)


# --------------------------------------------------------------------------
# Outline construction
# --------------------------------------------------------------------------


def rectangles(g: Glyph) -> list[tuple[int, int, int, int]]:
    """Ink as rectangles in pixel space (x0, y0, x1, y1), y up, baseline 0.

    Horizontal runs are merged first, then identical runs in consecutive rows
    are merged vertically, so a stem is one contour instead of twelve."""
    open_runs: dict[tuple[int, int], list[int]] = {}
    done: list[tuple[int, int, int, int]] = []
    for r, row in enumerate(g.rows):
        y_top = g.by - r
        runs = []
        x = 0
        while x < len(row):
            if row[x] == "#":
                start = x
                while x < len(row) and row[x] == "#":
                    x += 1
                runs.append((g.bx + start, g.bx + x))
            else:
                x += 1
        current = set(runs)
        for key in list(open_runs):
            if key not in current:
                x0, x1 = key
                top, bottom = open_runs.pop(key)
                done.append((x0, bottom, x1, top))
        for key in runs:
            if key in open_runs:
                open_runs[key][1] = y_top - 1
            else:
                open_runs[key] = [y_top, y_top - 1]
    for (x0, x1), (top, bottom) in open_runs.items():
        done.append((x0, bottom, x1, top))
    return done


def draw(g: Glyph):
    pen = TTGlyphPen(None)
    for x0, y0, x1, y1 in rectangles(g):
        # Clockwise = filled in TrueType.
        pen.moveTo((x0 * UNITS, y0 * UNITS))
        pen.lineTo((x0 * UNITS, y1 * UNITS))
        pen.lineTo((x1 * UNITS, y1 * UNITS))
        pen.lineTo((x1 * UNITS, y0 * UNITS))
        pen.closePath()
    return pen.glyph()


def embed_strike(font: TTFont, order: list[str], bitmaps: dict[str, Glyph], ppem: int, ascent: int, descent: int) -> None:
    """Embed the same 1-bit glyphs as an EBDT/EBLC bitmap strike at `ppem`.

    The outlines alone are exact for grayscale rasterizers. A ClearType
    (LCD) rasterizer, however, filters across subpixels and would fringe even a
    perfectly aligned edge. DirectWrite, and Chromium's Skia backend on
    Windows, switch to GDI-classic / aliased bitmap rendering when a font
    carries an embedded strike at the requested size -- the mechanism that
    keeps MS Gothic and SimSun crisp -- so the strike is what makes the face
    render without anti-aliasing for visitors who have ClearType switched on."""
    from fontTools.ttLib.tables import E_B_D_T_ as ebdt_mod
    from fontTools.ttLib.tables import E_B_L_C_ as eblc_mod
    from fontTools.ttLib.tables.BitmapGlyphMetrics import SmallGlyphMetrics

    names = order[1:]  # every glyph except .notdef, contiguous glyph ids 1..N
    glyph_data = {}
    for name in names:
        g = bitmaps[name]
        rows = g.rows if g.rows and g.width else ["."]
        m = SmallGlyphMetrics()
        m.height = len(rows)
        m.width = len(rows[0])
        m.BearingX = g.bx
        m.BearingY = g.by if g.rows and g.width else 0
        m.Advance = g.adv
        bmp = ebdt_mod.ebdt_bitmap_format_2(None, font)
        bmp.metrics = m
        packed = []
        for row in rows:
            bits = row.replace("#", "1").replace(".", "0")
            bits += "0" * (-len(bits) % 8)
            packed.append(bytes(int(bits[i : i + 8], 2) for i in range(0, len(bits), 8)))
        bmp.setRows(packed, bitDepth=1, metrics=m)
        glyph_data[name] = bmp

    ebdt = newTable("EBDT")
    ebdt.version = 2.0
    ebdt.strikeData = [glyph_data]

    def line_metrics(asc: int, desc: int, width_max: int):
        lm = eblc_mod.SbitLineMetrics()
        lm.ascender, lm.descender, lm.widthMax = asc, -desc, width_max
        lm.caretSlopeNumerator, lm.caretSlopeDenominator, lm.caretOffset = 1, 0, 0
        lm.minOriginSB = lm.minAdvanceSB = 0
        lm.maxBeforeBL, lm.minAfterBL = asc, -desc
        lm.pad1 = lm.pad2 = 0
        return lm

    width_max = max(max((b.metrics.width for b in glyph_data.values()), default=1), 1)
    size = eblc_mod.BitmapSizeTable()
    size.colorRef = 0
    size.hori = line_metrics(ascent, descent, width_max)
    size.vert = line_metrics(ascent, descent, width_max)
    size.ppemX = size.ppemY = ppem
    size.bitDepth = 1
    size.flags = 1
    sub = eblc_mod.eblc_index_sub_table_1(None, font)
    sub.indexFormat = 1
    sub.imageFormat = 2
    sub.names = names
    strike = eblc_mod.Strike()
    strike.bitmapSizeTable = size
    strike.indexSubTables = [sub]
    eblc = newTable("EBLC")
    eblc.version = 2.0
    eblc.strikes = [strike]
    font["EBDT"] = ebdt
    font["EBLC"] = eblc


def build(
    glyphs: dict[int, Glyph],
    ppem: int,
    ascent: int,
    descent: int,
    family: str,
    style: str,
    weight: int,
    copyright: str,
    license_text: str,
) -> TTFont:
    upem = ppem * UNITS
    order = [".notdef"]
    cmap = {}
    outlines = {".notdef": TTGlyphPen(None).glyph()}
    metrics = {".notdef": (ppem // 2 * UNITS, 0)}
    for cp in sorted(glyphs):
        g = glyphs[cp]
        name = f"uni{cp:04X}"
        order.append(name)
        cmap[cp] = name
        outlines[name] = draw(g)
        metrics[name] = (g.adv * UNITS, g.bx * UNITS)

    fb = FontBuilder(upem, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(outlines)
    # Left side bearing must equal xMin for glyf fonts.
    glyf = fb.font["glyf"]
    hmtx = {}
    for name in order:
        g = glyf[name]
        lsb = g.xMin if g.numberOfContours else 0
        hmtx[name] = (metrics[name][0], lsb)
    fb.setupHorizontalMetrics(hmtx)
    fb.setupHorizontalHeader(ascent=ascent * UNITS, descent=-descent * UNITS, lineGap=0)
    full = f"{family} {style}".strip()
    fb.setupNameTable(
        {
            "copyright": copyright,
            "familyName": family,
            "styleName": style,
            "uniqueFontIdentifier": f"SAI_WEBSITE:{full}",
            "fullName": full,
            "psName": full.replace(" ", "-"),
            "version": "Version 1.000",
            "licenseDescription": license_text,
        }
    )
    fb.setupOS2(
        sTypoAscender=ascent * UNITS,
        sTypoDescender=-descent * UNITS,
        sTypoLineGap=0,
        usWinAscent=ascent * UNITS,
        usWinDescent=descent * UNITS,
        usWeightClass=weight,
        fsType=0,
        # bit 7 USE_TYPO_METRICS; bit 5 BOLD / bit 0 ITALIC / bit 6 REGULAR
        fsSelection=(1 << 7) | ((1 << 5) if weight >= 700 else 0) | (1 if "Italic" in style else 0) | (
            (1 << 6) if weight < 700 and "Italic" not in style else 0
        ),
        sxHeight=0,
        sCapHeight=0,
    )
    fb.font["OS/2"].version = 4
    fb.font["head"].macStyle = (1 if weight >= 700 else 0) | (2 if "Italic" in style else 0)
    fb.setupPost(isFixedPitch=1 if "Mono" in family else 0)
    fb.setupMaxp()
    # gasp: grid-fit, no grayscale, at every size. The glyphs are already on the
    # grid; this only tells rasterizers that honour gasp not to smooth them.
    gasp = newTable("gasp")
    gasp.version = 1
    gasp.gaspRange = {0xFFFF: 0x0001}
    fb.font["gasp"] = gasp
    embed_strike(fb.font, order, {cmap[cp]: glyphs[cp] for cp in glyphs}, ppem, ascent, descent)
    return fb.font


# Fixed head timestamps (2026-10-07T00:00:00Z, seconds since 1904-01-01) so
# the same sources always produce byte-identical files.
FIXED_TIMESTAMP = 3842726400


def save(font: TTFont, out: Path) -> dict:
    font["head"].created = FIXED_TIMESTAMP
    font["head"].modified = FIXED_TIMESTAMP
    font.recalcTimestamp = False
    font.flavor = "woff2"
    font.save(out)
    data = out.read_bytes()
    return {"file": out.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


ROOT = Path(__file__).resolve().parents[2]


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def approved(entry: dict) -> Path:
    """Resolve an approved source and refuse it if its bytes changed."""
    path = ROOT / entry["file"]
    actual = sha256_file(path)
    if actual != entry["sha256"]:
        raise SystemExit(f"{entry['file']}: sha256 {actual} is not the approved {entry['sha256']}")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    sources = json.loads((ROOT / "scripts/fonts/sources.json").read_text(encoding="utf-8"))
    ui, code = sources["ui"], sources["code"]
    regular_src = approved(ui["regular"])
    bold_src = approved(ui["bold"])
    spleen_src = approved(code)

    ui_copyright = "Glyphs rasterized from DejaVu Sans 2.37 (Bitstream Vera derivative) and converted to pixel outlines."
    ui_licence = f"{ui['licence']}; see {ui['shippedLicence']}."
    faces = []

    def emit(font: TTFont, filename: str, info: dict) -> None:
        saved = save(font, out / filename)
        saved.update(info)
        faces.append(saved)

    cal_path = ROOT / "scripts/fonts/calibration_metrics.json"
    calibration = json.loads(cal_path.read_text(encoding="utf-8")) if cal_path.exists() else None

    for ppem in UI_SIZES:
        asc, desc = LINE_BOX[ppem]
        family = f"SAI Pixel {ppem}"
        regular = open_raster(regular_src, ppem, style="regular", calibration=calibration)
        bold = open_raster(bold_src, ppem, style="bold", calibration=calibration)
        variants = [
            ("Regular", 400, regular, ui["regular"]),
            ("Bold", 700, bold, ui["bold"]),
        ]
        if ppem in ITALIC_SIZES:
            cal_it = calibration.get("italic", {}).get(str(ppem), {}) if calibration else None
            variants.append(("Italic", 400, {cp: italicize(g, desc, cp, cal_it) for cp, g in regular.items()}, ui["regular"]))
        for style, weight, glyphs, src in variants:
            font = build(glyphs, ppem, asc, desc, family, style, weight, ui_copyright, ui_licence)
            emit(font, f"sai-pixel-{ppem}-{style.lower()}.woff2", {
                "family": family, "style": style, "weight": weight, "size_px": ppem,
                "ascent_px": asc, "descent_px": desc, "glyphs": len(glyphs),
                "source": src["name"], "source_version": src["version"], "source_sha256": src["sha256"],
                "licence": ui["licence"],
            })

    glyphs, asc, desc, s_copyright = bdf_font(spleen_src)
    font = build(glyphs, 12, asc, desc, "SAI Pixel Mono 12", "Regular", 400,
                 s_copyright + " (Spleen 6x12, converted to pixel outlines)",
                 f"{code['licence']}; see {code['shippedLicence']}.")
    emit(font, "sai-pixel-mono-12-regular.woff2", {
        "family": "SAI Pixel Mono 12", "style": "Regular", "weight": 400, "size_px": 12,
        "ascent_px": asc, "descent_px": desc, "glyphs": len(glyphs),
        "source": code["name"], "source_version": code["version"], "source_sha256": code["sha256"],
        "licence": code["licence"],
    })

    for entry in (ui, code):
        (out / entry["shippedLicence"]).write_bytes((ROOT / entry["licenceFile"]).read_bytes())

    manifest = {
        "note": "Production pixel faces. Generated by scripts/fonts/build_pixel_fonts.py from scripts/fonts/sources.json; checked by npm run validate:licenses.",
        "generator": "scripts/fonts/build_pixel_fonts.py",
        "units_per_pixel": UNITS,
        "faces": faces,
        "licences": [ui["shippedLicence"], code["shippedLicence"]],
        # AUDAPACK manifest closure: these files are load-bearing evidence and
        # must be included in every audit or continuation archive.
        "required": [f["file"] for f in faces] + [ui["shippedLicence"], code["shippedLicence"]],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    for face in faces:
        print(f"{face['file']:36} {face['bytes']:>7} B  {face['glyphs']} glyphs  {face['source']}")


if __name__ == "__main__":
    main()
