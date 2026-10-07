"""
Render the social preview card (MASTER_ROADMAP M18; WINTAGE_WEB_CONTRACT §22-23).

The card is Class A pixel artwork: drawn at 400x210 with 1-bit text (Pillow's
fontmode "1", i.e. no anti-aliasing) and Golden Default colours only, then
scaled 3x with nearest-neighbour to the 1200x630 Open Graph size. Integer
scaling of a native-size raster keeps every edge hard.

The only font it may use is the approved open UI source in
scripts/fonts/sources.json (DejaVu Sans), checked by SHA-256 before use. The
card's provenance is written next to it in public/social/MANIFEST.json and
verified by `npm run validate:licenses`.

Usage: npm run social:build   (python scripts/social/make_card.py --out public/social/card.png)
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
PACK = json.loads((ROOT / "src/themes/packs/goldendefault.json").read_text(encoding="utf-8-sig"))["tokens"]
C = {k: tuple(int(v[i : i + 2], 16) for i in (1, 3, 5)) for k, v in PACK.items()}

W, H, SCALE = 400, 210, 3


def bevel(d: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, raised: bool = True) -> None:
    """2px Win95 bevel with stepped corners, as on the site."""
    light, dark = (C["bevelLight"], C["borderDark"]) if raised else (C["borderDark"], C["bevelLight"])
    for i in range(2):
        d.line([(x0 + i, y1 - i), (x1 - i, y1 - i)], fill=dark)  # bottom
        d.line([(x1 - i, y0 + i), (x1 - i, y1 - i)], fill=dark)  # right
        d.line([(x0 + i, y0 + i), (x1 - 1 - i, y0 + i)], fill=light)  # top
        d.line([(x0 + i, y0 + i), (x0 + i, y1 - 1 - i)], fill=light)  # left


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    args = ap.parse_args()

    sources = json.loads((ROOT / "scripts/fonts/sources.json").read_text(encoding="utf-8"))
    src = sources["ui"]["regular"]
    font_path = ROOT / src["file"]
    if hashlib.sha256(font_path.read_bytes()).hexdigest() != src["sha256"]:
        raise SystemExit(f"{src['file']} does not match the approved SHA-256 in sources.json")
    f12 = ImageFont.truetype(str(font_path), 12)
    f16 = ImageFont.truetype(str(font_path), 16)
    img = Image.new("RGB", (W, H), C["background"])
    d = ImageDraw.Draw(img)
    d.fontmode = "1"  # 1-bit glyphs: no anti-aliasing

    # Window
    d.rectangle([12, 12, W - 13, H - 13], fill=C["backgroundSoft"])
    bevel(d, 12, 12, W - 13, H - 13)
    # Title bar
    d.rectangle([14, 14, W - 15, 33], fill=C["surface"])
    d.line([(14, 34), (W - 15, 34)], fill=C["borderDark"])
    d.line([(14, 35), (W - 15, 35)], fill=C["borderDark"])
    d.text((20, 18), "SAIPEN Protocol", font=f12, fill=C["textPrimary"])

    # Body
    d.text((26, 50), "SAIPEN", font=f16, fill=C["textPrimary"])
    d.text((26, 74), "Continuation protocol for AI coding agents.", font=f12, fill=C["borderHighlight"])
    d.text((26, 92), "The agent forgets. The project remembers.", font=f12, fill=C["textSecondary"])

    # Emblem: the 64px 1-bit mask built by scripts/media/build_media.py.
    emblem = Image.open(ROOT / "public/media/saipen-emblem-64.png").getchannel("A")
    img.paste(Image.new("RGB", emblem.size, C["borderHighlight"]), (W - 26 - 64, 48), emblem)

    # Command well
    d.rectangle([26, 118, 230, 142], fill=C["compareBack"])
    bevel(d, 26, 118, 230, 142, raised=False)
    d.text((34, 124), "> saipen continue", font=f12, fill=C["textPrimary"])

    # Lifecycle chips
    x = 26
    for phase in ["SCOUT", "BUILD", "VERIFY", "REVIEW", "SHIP"]:
        w = int(d.textlength(phase, font=f12)) + 12
        d.rectangle([x, 156, x + w, 176], fill=C["surfaceRaised"])
        bevel(d, x, 156, x + w, 176)
        d.text((x + 6, 160), phase, font=f12, fill=C["textPrimary"])
        x += w + 8

    big = img.resize((W * SCALE, H * SCALE), Image.NEAREST)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    big.save(args.out, optimize=True)
    colours = len(big.getcolors(1 << 16) or [])
    manifest = {
        "note": "Provenance of the social preview card. Regenerate with npm run social:build; checked by npm run validate:licenses.",
        "generator": "scripts/social/make_card.py",
        "font": {"name": src["name"], "version": src["version"], "sha256": src["sha256"], "licence": sources["ui"]["licence"]},
        "image": {"file": args.out.name, "width": big.size[0], "height": big.size[1], "colours": colours,
                  "sha256": hashlib.sha256(args.out.read_bytes()).hexdigest()},
        # AUDAPACK manifest closure: keep the card with its provenance.
        "emblem": {"file": "media/saipen-emblem-64.png", "sha256": hashlib.sha256((ROOT / "public/media/saipen-emblem-64.png").read_bytes()).hexdigest()},
        "required": [args.out.name],
    }
    (args.out.parent / "MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"{args.out} {big.size[0]}x{big.size[1]}, {colours} colours, font {src['name']}")


if __name__ == "__main__":
    main()
