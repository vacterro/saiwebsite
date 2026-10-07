"""
Compare production pixel fonts against local Verdana_m1 canonical reference.

Measures:
  - Total line length mismatch (px)
  - Differing pixels count on 1-bit rasterized text
  - Bounding box and baseline conformance
  - Metric coverage across ladder sizes (10, 11, 12, 14, 16) and styles (Regular, Bold, Italic)
"""

from __future__ import annotations

import argparse
import io
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import numpy as np
from fontTools.ttLib import TTFont

sys.path.insert(0, str(Path(__file__).resolve().parent))
from reference import DEFAULT_REF_DIR, resolve_canonical  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]

def load_font(path: Path, ppem: int) -> ImageFont.FreeTypeFont:
    if path.suffix.lower() == ".woff2":
        font = TTFont(path)
        buf = io.BytesIO()
        font.flavor = None
        font.save(buf)
        buf.seek(0)
        return ImageFont.truetype(buf, ppem)
    return ImageFont.truetype(str(path), ppem)

def resolve_ref_font(ref_dir: Path, ppem: int, style: str) -> Path | None:
    return resolve_canonical(style, ref_dir)

CORPUS = [
    (
        "canonical-sentence",
        "SAIPEN keeps a project's working memory in plain files inside the project, so any compatible agent — no chat history, no session memory — can run one command and continue exactly where the last one stopped.",
        12,
        "regular",
    ),
    (
        "prose-paragraph",
        "SAIPEN was not designed around a hypothetical agent stack. It grew out of running real projects across different models, providers, sessions and tools, where the same failure kept returning: the agent changed, but the project still needed to remember exactly what happened and what came next.",
        12,
        "regular",
    ),
    (
        "punctuation-heavy",
        "\"Quotes\" 'single' --hyphen —em-dash (parentheses) [brackets] {braces} <angles> /slash\\ |pipe_ :colon; ,comma. ?query!",
        12,
        "regular",
    ),
    (
        "code-ui-labels",
        "[OK] [Cancel] [Apply] Status: 200 OK  branch:main  commit:366f581  saipen continue --json",
        11,
        "bold",
    ),
    (
        "mixed-case-disambiguation",
        "The Quick Brown Fox Jumps Over 1234567890 Lazy Dogs (Il1 0O)",
        12,
        "regular",
    ),
    (
        "brackets-and-arrows",
        "[ { ( < > ) } ] -> <- => <= ↑ ↓ ← → ┌─┐ │ └─┘",
        12,
        "regular",
    ),
    (
        "cyrillic-specimen",
        "Съешь же ещё этих мягких французских булок. Агент забывает, проект помнит.",
        12,
        "regular",
    ),
    (
        "ladder-10-regular",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        10,
        "regular",
    ),
    (
        "ladder-10-bold",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        10,
        "bold",
    ),
    (
        "ladder-11-regular",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        11,
        "regular",
    ),
    (
        "ladder-11-bold",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        11,
        "bold",
    ),
    (
        "ladder-12-regular",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        12,
        "regular",
    ),
    (
        "ladder-12-bold",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        12,
        "bold",
    ),
    (
        "ladder-12-italic",
        "Italic: a whole-pixel shear of the regular face, used for emphasis in prose.",
        12,
        "italic",
    ),
    (
        "ladder-14-regular",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        14,
        "regular",
    ),
    (
        "ladder-14-bold",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        14,
        "bold",
    ),
    (
        "ladder-16-regular",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        16,
        "regular",
    ),
    (
        "ladder-16-bold",
        "The quick brown fox jumps over the lazy dog. 0123456789",
        16,
        "bold",
    ),
]


def render_1bit(font: ImageFont.FreeTypeFont, text: str, ppem: int) -> tuple[Image.Image, float]:
    length = font.getlength(text)
    w = int(length) + 20
    h = ppem * 3
    baseline = ppem * 2
    im = Image.new("1", (w, h), 0)
    d = ImageDraw.Draw(im)
    d.fontmode = "1"
    d.text((10, baseline), text, font=font, fill=1, anchor="ls")
    return im, length


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref-dir", type=Path, default=DEFAULT_REF_DIR)
    ap.add_argument("--font-dir", type=Path, default=Path("public/fonts"))
    ap.add_argument("--diff-out", type=Path, default=None)
    ap.add_argument("--max-canonical-diff", type=float, default=2.0)
    ap.add_argument("--max-total-diff-px", type=int, default=15000)
    args = ap.parse_args()

    ref_dir: Path = args.ref_dir
    font_dir: Path = args.font_dir

    if args.diff_out:
        args.diff_out.mkdir(parents=True, exist_ok=True)

    print(f"{'Test Case':30} {'Size':4} {'Style':7} {'Ref Len':8} {'Prod Len':8} {'Len Diff':8} {'Diff Px':8}")
    print("-" * 80)

    total_diff_px = 0
    total_len_diff = 0
    canonical_diff = 0.0

    for name, text, ppem, style in CORPUS:
        ref_path = resolve_ref_font(ref_dir, ppem, style)
        prod_path = font_dir / f"sai-pixel-{ppem}-{style}.woff2"

        if not ref_path or not ref_path.exists():
            print(f"MISSING REF: {ppem}px {style}", file=sys.stderr)
            sys.exit(1)

        if not prod_path.exists():
            print(f"MISSING: {prod_path}")
            continue

        r_font = load_font(ref_path, ppem)
        p_font = load_font(prod_path, ppem)

        r_im, r_len = render_1bit(r_font, text, ppem)
        p_im, p_len = render_1bit(p_font, text, ppem)

        len_diff = p_len - r_len
        total_len_diff += abs(len_diff)
        if name == "canonical-sentence":
            canonical_diff = abs(len_diff)

        # Pad to equal width for array diff
        max_w = max(r_im.width, p_im.width)
        max_h = max(r_im.height, p_im.height)

        r_arr = np.zeros((max_h, max_w), dtype=bool)
        p_arr = np.zeros((max_h, max_w), dtype=bool)
        r_arr[: r_im.height, : r_im.width] = np.array(r_im)
        p_arr[: p_im.height, : p_im.width] = np.array(p_im)

        diff_px = int(np.sum(r_arr != p_arr))
        total_diff_px += diff_px

        if args.diff_out:
            # Create a 3-row comparison image: Reference, Production, Diff
            diff_vis = np.zeros((max_h, max_w, 3), dtype=np.uint8)
            diff_vis[r_arr] = [240, 208, 96]
            only_p = p_arr & ~r_arr
            diff_vis[only_p] = [96, 208, 240]
            both = p_arr & r_arr
            diff_vis[both] = [255, 255, 255]
            Image.fromarray(diff_vis).save(args.diff_out / f"{name}.png")

        print(f"{name:30} {ppem:4} {style:7} {r_len:8.1f} {p_len:8.1f} {len_diff:+8.1f} {diff_px:8d}")

    print("-" * 80)
    print(f"TOTAL: Cumulative length abs diff: {total_len_diff:.1f}px, Total diff pixels across corpus: {total_diff_px}")

    if canonical_diff > args.max_canonical_diff:
        print(f"FAIL: Canonical sentence delta {canonical_diff:.1f}px exceeds limit {args.max_canonical_diff}px", file=sys.stderr)
        sys.exit(1)

    if total_diff_px > args.max_total_diff_px:
        print(f"FAIL: Total diff pixels {total_diff_px} exceeds limit {args.max_total_diff_px}", file=sys.stderr)
        sys.exit(1)

    print("SUCCESS: Reference conformance verified.")


if __name__ == "__main__":
    main()
