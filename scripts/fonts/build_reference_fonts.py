"""
Build local-only canonical reference pixel webfonts directly from VERDANA_M1.TTF.

IMPORTANT LICENSING BOUNDARY:
----------------------------
This script is for LOCAL / PRIVATE verification only (dual-mode option B).
The outputs from this script MUST NOT be placed in `public/` or `dist/`,
and MUST NOT be committed to public git. They are strictly ignored by .gitignore.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont, newTable

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference import DEFAULT_REF_DIR, resolve_canonical  # noqa: E402

UNITS = 128
UI_SIZES = (10, 11, 12, 14, 16)
ITALIC_SIZES = (12,)
LINE_BOX = {10: (8, 2), 11: (9, 2), 12: (10, 2), 14: (11, 3), 16: (13, 3)}

ROOT = Path(__file__).resolve().parents[2]


class Glyph:
    __slots__ = ("rows", "bx", "by", "adv")

    def __init__(self, rows: list[str], bx: int, by: int, adv: int):
        self.rows = rows
        self.bx = bx
        self.by = by
        self.adv = adv

    @property
    def width(self) -> int:
        return len(self.rows[0]) if self.rows else 0


def extract_ebdt_strike(font: TTFont, ppem: int) -> dict[int, Glyph]:
    eblc = font["EBLC"]
    ebdt = font["EBDT"]
    cmap = font.getBestCmap()
    rev_cmap: dict[str, list[int]] = {}
    for cp, name in cmap.items():
        rev_cmap.setdefault(name, []).append(cp)

    strike_idx = None
    strike = None
    for i, s in enumerate(eblc.strikes):
        if s.bitmapSizeTable.ppemY == ppem:
            strike_idx = i
            strike = s
            break
    if strike_idx is None:
        return {}

    data = ebdt.strikeData[strike_idx]
    glyphs: dict[int, Glyph] = {}

    for sub in strike.indexSubTables:
        for gname in sub.names:
            cps = rev_cmap.get(gname, [])
            if not cps:
                continue
            adv = bx = by = w = h = None
            rows = []
            if gname in data:
                g = data[gname]
                if hasattr(g, "metrics"):
                    m = g.metrics
                    adv = getattr(m, "Advance", getattr(m, "horiAdvance", None))
                    bx = getattr(m, "BearingX", getattr(m, "horiBearingX", None))
                    by = getattr(m, "BearingY", getattr(m, "horiBearingY", None))
                    w = m.width
                    h = m.height
                if hasattr(g, "imageData") and w and h:
                    bits = "".join(format(b, "08b") for b in g.imageData)
                    for r in range(h):
                        rows.append("".join("#" if c == "1" else "." for c in bits[r * w : (r + 1) * w]))

            if adv is None and hasattr(sub, "metrics"):
                m = sub.metrics
                adv = getattr(m, "Advance", getattr(m, "horiAdvance", None))
                bx = getattr(m, "BearingX", getattr(m, "horiBearingX", None))
                by = getattr(m, "BearingY", getattr(m, "horiBearingY", None))

            if adv is not None and bx is not None:
                for cp in cps:
                    glyphs[cp] = Glyph(rows, bx, by if by is not None else 0, adv)

    if 32 not in glyphs:
        sp_adv = 4 if ppem == 10 else (5 if ppem in (11, 12) else (6 if ppem == 14 else 7))
        glyphs[32] = Glyph([], 0, 0, sp_adv)
    if 160 not in glyphs:
        glyphs[160] = Glyph([], 0, 0, glyphs[32].adv)

    return glyphs


def rectangles(g: Glyph) -> list[tuple[int, int, int, int]]:
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
        pen.moveTo((x0 * UNITS, y0 * UNITS))
        pen.lineTo((x0 * UNITS, y1 * UNITS))
        pen.lineTo((x1 * UNITS, y1 * UNITS))
        pen.lineTo((x1 * UNITS, y0 * UNITS))
        pen.closePath()
    return pen.glyph()


def build_font(glyphs: dict[int, Glyph], ppem: int, asc: int, desc: int, family: str, style: str, weight: int) -> TTFont:
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

    glyf = fb.font["glyf"]
    hmtx = {}
    for name in order:
        g = glyf[name]
        lsb = g.xMin if g.numberOfContours else 0
        hmtx[name] = (metrics[name][0], lsb)
    fb.setupHorizontalMetrics(hmtx)
    fb.setupHorizontalHeader(ascent=asc * UNITS, descent=-desc * UNITS, lineGap=0)

    full = f"{family} {style}".strip()
    fb.setupNameTable({
        "copyright": "Local reference font for private visual calibration only.",
        "familyName": family,
        "styleName": style,
        "fullName": full,
        "psName": full.replace(" ", "-"),
        "version": "Version 1.000",
    })
    fb.setupOS2(
        sTypoAscender=asc * UNITS,
        sTypoDescender=-desc * UNITS,
        sTypoLineGap=0,
        usWinAscent=asc * UNITS,
        usWinDescent=desc * UNITS,
        usWeightClass=weight,
        fsType=0,
    )
    fb.font["OS/2"].version = 4
    fb.setupPost(isFixedPitch=0)
    fb.setupMaxp()

    gasp = newTable("gasp")
    gasp.version = 1
    gasp.gaspRange = {0xFFFF: 0x0001}
    fb.font["gasp"] = gasp

    return fb.font


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref-dir", type=Path, default=DEFAULT_REF_DIR)
    ap.add_argument("--out", type=Path, default=Path("_local_ref/fonts"))
    args = ap.parse_args()

    ref_dir: Path = args.ref_dir
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)

    reg_src = resolve_canonical("regular", ref_dir)
    bold_src = resolve_canonical("bold", ref_dir)
    it_src = resolve_canonical("italic", ref_dir)

    if reg_src is None:
        print("Error: canonical Verdana_m1 regular reference not found.", file=sys.stderr)
        sys.exit(1)

    reg_tt = TTFont(reg_src)
    bold_tt = TTFont(bold_src) if bold_src else None
    it_tt = TTFont(it_src) if it_src else None

    print(f"Building local reference fonts into {out}...")

    for ppem in UI_SIZES:
        asc, desc = LINE_BOX[ppem]
        family = f"Reference Pixel {ppem}"

        reg_glyphs = extract_ebdt_strike(reg_tt, ppem)
        f_reg = build_font(reg_glyphs, ppem, asc, desc, family, "Regular", 400)
        f_reg.flavor = "woff2"
        f_reg.save(out / f"ref-pixel-{ppem}-regular.woff2")
        print(f"  Saved ref-pixel-{ppem}-regular.woff2 ({len(reg_glyphs)} glyphs)")

        if bold_tt:
            bold_glyphs = extract_ebdt_strike(bold_tt, ppem)
            f_bold = build_font(bold_glyphs, ppem, asc, desc, family, "Bold", 700)
            f_bold.flavor = "woff2"
            f_bold.save(out / f"ref-pixel-{ppem}-bold.woff2")
            print(f"  Saved ref-pixel-{ppem}-bold.woff2 ({len(bold_glyphs)} glyphs)")

        if ppem in ITALIC_SIZES and it_tt:
            it_glyphs = extract_ebdt_strike(it_tt, ppem)
            f_it = build_font(it_glyphs, ppem, asc, desc, family, "Italic", 400)
            f_it.flavor = "woff2"
            f_it.save(out / f"ref-pixel-{ppem}-italic.woff2")
            print(f"  Saved ref-pixel-{ppem}-italic.woff2 ({len(it_glyphs)} glyphs)")

    print("DONE: Local reference fonts built cleanly for private calibration.")


if __name__ == "__main__":
    main()
