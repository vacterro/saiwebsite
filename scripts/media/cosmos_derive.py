"""Shared Cosmos GIF-to-WebP derivation (single owner of the encoding contract).

Both scripts/media/build_media.py (writes the intentional generated WebP)
and scripts/media/check_media.py (re-derives the expected WebP into a
disposable location and byte-compares) import from here, so the verifier
can never drift from the generator's parameters.

Supported boundary: byte-identical re-derivation holds under the pinned
toolchain in requirements-media.txt (Pillow==12.3.0). Outside that pin the
bytes may differ while decoding to near-identical pixels; the verifier
reports that as a truthful derivation failure, never a silent pass.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

WIDTH, HEIGHT = 480, 270
FRAMES = 128

# (output name, GIF source name, lossy quality, slowest compression).
# Chosen as the smallest configuration accepted at 1x/2x review:
# 8.18 MB -> ~3.84 MB (-53%).
WEBP_DERIVED = ("saipen-cosmos.webp", "saipen-cosmos.gif", 60, 6)


def derive_webp(media_dir: Path | str, name: str, source: str, quality: int, method: int) -> Path:
    """Re-encode the GIF as animated WebP inside media_dir; return its path.

    Raises SystemExit on unexpected source or failed verification, so both
    the builder and the verifier fail loudly rather than shipping bytes
    that are not the GIF's deterministic derivation.
    """
    media = Path(media_dir)
    src_path, out_path = media / source, media / name
    with Image.open(src_path) as src:
        src.load()
        if src.format != "GIF" or src.size != (WIDTH, HEIGHT):
            raise SystemExit(f"cosmos source unexpected: {src.format} {src.size}")
        frames, durations = [], []
        try:
            i = 0
            while True:
                src.seek(i)
                frames.append(src.convert("RGB"))
                durations.append(src.info.get("duration", 62))
                i += 1
        except EOFError:
            pass
    if len(frames) != FRAMES:
        raise SystemExit(f"cosmos source has {len(frames)} frames, expected {FRAMES}")
    frames[0].save(out_path, save_all=True, append_images=frames[1:],
                    duration=durations, loop=0, quality=quality, method=method)
    with Image.open(out_path) as check:
        check.load()
        if check.format != "WEBP" or check.size != (WIDTH, HEIGHT) or check.n_frames != FRAMES:
            raise SystemExit(f"webp derivation failed verification: {check.format} {check.size} {check.n_frames}f")
        if check.info.get("loop", 1) != 0:
            raise SystemExit("webp derivation lost its infinite loop")
    return out_path
