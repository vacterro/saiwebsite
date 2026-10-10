#!/usr/bin/env python3
"""Integrity contract for the curated Cosmos homepage artwork.

Checks public/media/MANIFEST.json records for saipen-cosmos.gif /
saipen-cosmos-still.png against the checked-in bytes:

  missing file | changed bytes | wrong magic/format | wrong dimensions |
  manifest hash mismatch | still not pixel-identical to the GIF first frame |
  GIF frame-count / duration / loop drift | external (V:) source dependency

Usage:
  npm run validate:media
  python scripts/media/check_media.py --media-dir <dir> --manifest <file>  (fixture-local negative controls)

Exit 0 when the contract holds, 1 with one line per violation otherwise.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

GIF = "saipen-cosmos.gif"
STILL = "saipen-cosmos-still.png"
WEBP = "saipen-cosmos.webp"
WIDTH, HEIGHT = 480, 270
FRAMES = 128
# 128 frames at ~62.5 ms each ~= 8 s; per-frame GIF delays are centisecond
# integers, so accept +-0.5 s of packing rounding.
DURATION_S = 8.0
DURATION_TOL_S = 0.5

EXPECTED = {
    GIF: {"media_type": "image/gif", "magic": (b"GIF87a", b"GIF89a")},
    STILL: {"media_type": "image/png", "magic": (b"\x89PNG\r\n\x1a\n",)},
    WEBP: {"media_type": "image/webp", "magic": (b"RIFF",)},
}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--media-dir", default=str(ROOT / "public/media"))
    ap.add_argument("--manifest", default=str(ROOT / "public/media/MANIFEST.json"))
    args = ap.parse_args()
    media = Path(args.media_dir)
    problems: list[str] = []

    try:
        manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        return f"manifest unreadable: {args.manifest}: {e}"

    by_file = {a.get("file"): a for a in manifest.get("assets", []) if isinstance(a, dict)}
    for name in (GIF, STILL, WEBP):
        rec = by_file.get(name)
        if rec is None:
            problems.append(f"[manifest] {name} has no record in {args.manifest}")
            continue
        exp = EXPECTED[name]
        if rec.get("media_type") != exp["media_type"]:
            problems.append(f"[manifest] {name}: media_type {rec.get('media_type')!r} != {exp['media_type']!r}")
        if rec.get("width") != WIDTH or rec.get("height") != HEIGHT:
            problems.append(f"[manifest] {name}: recorded dims {rec.get('width')}x{rec.get('height')} != {WIDTH}x{HEIGHT}")
        if not isinstance(rec.get("sha256"), str) or len(rec.get("sha256", "")) != 64:
            problems.append(f"[manifest] {name}: no 64-hex recorded sha256")
        for key, value in (rec.items() if isinstance(rec, dict) else []):
            if isinstance(value, str) and ("V:/" in value or "V:\\" in value or value.startswith("V:")):
                problems.append(f"[manifest] {name}: external local path dependency in field {key!r}")

    # Animated <-> still relationship must be declared both ways.
    gif_rec, still_rec = by_file.get(GIF), by_file.get(STILL)
    if gif_rec and gif_rec.get("still_frame") != STILL:
        problems.append(f"[manifest] {GIF}: missing still_frame link to {STILL}")
    webp_rec = by_file.get(WEBP)
    if webp_rec is None:
        problems.append(f"[manifest] {WEBP} has no record in {args.manifest}")
    elif webp_rec.get("derived_from") != GIF:
        problems.append(f"[manifest] {WEBP}: missing derived_from link to {GIF}")
    if still_rec and still_rec.get("still_of") != GIF:
        problems.append(f"[manifest] {GIF}: {STILL} missing still_of link to {GIF}")

    try:
        import PIL
        from PIL import Image, ImageChops
    except ImportError:
        problems.append("[tooling] Pillow is not installed; cannot decode artwork")
        print("\n".join(problems))
        return 1

    def check_file(name: str) -> "Image.Image | None":
        rec = by_file.get(name)
        path = media / name
        if not path.exists():
            problems.append(f"[missing] {name} does not exist in {media}")
            return None
        magic = path.read_bytes()[:8]
        if not magic.startswith(EXPECTED[name]["magic"]):
            problems.append(f"[format] {name}: magic {magic[:6]!r} is not {EXPECTED[name]['media_type']}")
            return None
        try:
            im = Image.open(path)
            im.load()
        except Exception as e:  # corrupted / undecodable
            problems.append(f"[decode] {name}: undecodable ({e})")
            return None
        want_format = {GIF: "GIF", STILL: "PNG", WEBP: "WEBP"}[name]
        if im.format != want_format or im.size != (WIDTH, HEIGHT):
            problems.append(f"[dims] {name}: decoded as {im.format} {im.size[0]}x{im.size[1]}, expected "
                            f"{want_format} {WIDTH}x{HEIGHT}")
        if name == WEBP and path.read_bytes()[8:12] != b"WEBP":
            problems.append(f"[format] {name}: RIFF container is not WEBP")
        if rec and rec.get("sha256") and sha(path) != rec["sha256"]:
            problems.append(f"[drift] {name} does not match its recorded SHA-256 (hand-edited, or regenerate with npm run media:build)")
        return im

    gif_im = check_file(GIF)
    still_im = check_file(STILL)
    webp_im = check_file(WEBP)

    # Derivation proof: re-derive the expected WebP from the fixture's own
    # GIF into a disposable directory and byte-compare against the
    # checked-in file. A structurally valid but unrelated animation with a
    # matching manifest hash fails here, because only the GIF's actual
    # deterministic derivation reproduces the approved bytes. Runs once,
    # only when every structural check above already passed (~8 s under
    # the pinned toolchain); never touches canonical media files.
    if not problems and webp_im is not None and gif_im is not None:
        try:
            from cosmos_derive import WEBP_DERIVED, derive_webp
        except ImportError as e:
            problems.append(f"[tooling] derivation contract unavailable: {e}")
        else:
            webp_name, webp_source, webp_q, webp_method = WEBP_DERIVED
            if webp_rec.get("derived_from") == GIF and webp_rec.get("quality", webp_q) == webp_q \
                    and webp_rec.get("method", webp_method) == webp_method:
                try:
                    with tempfile.TemporaryDirectory(prefix="cosmos-derive-") as tmp:
                        # Re-derive from THIS fixture's GIF, not the repo's:
                        import shutil
                        shutil.copy(media / GIF, Path(tmp) / GIF)
                        probe = derive_webp(Path(tmp), webp_name, webp_source, webp_q, webp_method)
                        if sha(Path(probe)) != sha(media / WEBP):
                            problems.append(
                                f"[derivation] {WEBP} is not the deterministic q{webp_q}/m{webp_method} "
                                f"derivation of {GIF} (re-derivation digest differs; unrelated or "
                                f"differently encoded animation, or toolchain outside requirements-media.txt)")
                        else:
                            print(f"  derivation: re-derived {WEBP} from {GIF} byte-identical "
                                  f"(q{webp_q}/m{webp_method}, Pillow {PIL.__version__})")
                except SystemExit as e:
                    problems.append(f"[derivation] re-derivation failed: {e}")
                except Exception as e:
                    problems.append(f"[derivation] re-derivation failed: {e}")
            else:
                problems.append(
                    f"[derivation] {WEBP} manifest does not declare the supported derivation "
                    f"(derived_from={webp_rec.get('derived_from')!r}, quality={webp_rec.get('quality')!r}, "
                    f"method={webp_rec.get('method')!r}; expected {GIF}, {webp_q}, {webp_method})")

    if gif_im is not None:
        n_frames = getattr(gif_im, "n_frames", 1)
        if n_frames != FRAMES:
            problems.append(f"[animation] {GIF}: {n_frames} frames, expected {FRAMES}")
        if gif_im.info.get("loop", 1) != 0:
            problems.append(f"[animation] {GIF}: loop={gif_im.info.get('loop')!r}, expected 0 (infinite)")
        total_ms = 0
        try:
            for i in range(n_frames):
                gif_im.seek(i)
                total_ms += gif_im.info.get("duration", 0)
        except EOFError:
            problems.append(f"[animation] {GIF}: frame walk ended early at {i}")
        total_s = total_ms / 1000
        if abs(total_s - DURATION_S) > DURATION_TOL_S:
            problems.append(f"[animation] {GIF}: duration {total_s:.2f}s, expected ~{DURATION_S:.0f}s")

    if webp_im is not None:
        n_frames = getattr(webp_im, "n_frames", 1)
        if n_frames != FRAMES:
            problems.append(f"[animation] {WEBP}: {n_frames} frames, expected {FRAMES}")
        if webp_im.info.get("loop", 1) != 0:
            problems.append(f"[animation] {WEBP}: loop={webp_im.info.get('loop')!r}, expected 0 (infinite)")
        # Per-frame durations live in the ANMF chunks (Pillow does not report
        # them on WebP readback): 96x60 ms + 32x70 ms = 8000 ms like the GIF.
        raw = (media / WEBP).read_bytes()
        durs, pos = [], 12  # skip the 12-byte RIFF header
        while True:
            at = raw.find(b"ANMF", pos)
            if at < 0:
                break
            size = int.from_bytes(raw[at + 4:at + 8], "little")
            durs.append(int.from_bytes(raw[at + 8 + 12:at + 8 + 15], "little"))
            pos = at + 8 + size + (size & 1)
        if len(durs) != FRAMES:
            problems.append(f"[animation] {WEBP}: {len(durs)} ANMF timing chunks, expected {FRAMES}")
        elif abs(sum(durs) - DURATION_S * 1000) > DURATION_TOL_S * 1000:
            problems.append(f"[animation] {WEBP}: ANMF durations total {sum(durs)}ms, expected ~8000ms")
        gif_path, webp_path = media / GIF, media / WEBP
        if not gif_path.exists():
            problems.append(f"[missing] {GIF} does not exist in {media}")
        elif webp_path.stat().st_size >= gif_path.stat().st_size:
            problems.append(f"[animation] {WEBP}: {webp_path.stat().st_size} bytes is no smaller than {GIF} ({gif_path.stat().st_size} bytes)")
        else:
            _gif_bytes, _webp_bytes = gif_path.stat().st_size, webp_path.stat().st_size
            print(f"  webp transfer: {_webp_bytes} bytes vs gif {_gif_bytes} bytes "
                  f"(-{100 * (_gif_bytes - _webp_bytes) // _gif_bytes}%)")

    if gif_im is not None and still_im is not None:
        try:
            gif_im.seek(0)
            first = gif_im.convert("RGB")
            still = still_im.convert("RGB")
            if ImageChops.difference(first, still).getbbox() is not None:
                problems.append(f"[still] {STILL} is not pixel-identical to the first decoded frame of {GIF}")
        except Exception as e:
            problems.append(f"[still] frame comparison failed: {e}")

    if problems:
        print("\n".join(problems))
        return 1
    gif_kb = (media / GIF).stat().st_size // 1024
    still_kb = (media / STILL).stat().st_size // 1024
    print(f"OK: {GIF} ({WIDTH}x{HEIGHT}, {FRAMES} frames, ~{DURATION_S:.0f}s, infinite loop, {gif_kb} KiB) "
          f"+ {STILL} ({still_kb} KiB, first-frame-identical), manifest hashes match")
    return 0


if __name__ == "__main__":
    sys.exit(main())
