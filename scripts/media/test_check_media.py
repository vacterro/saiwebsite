#!/usr/bin/env python3
"""Semantic negative controls for scripts/media/check_media.py.

Every case invokes the FINAL admission path (check_media.py as a
subprocess against a disposable fixture) and asserts its exit status --
never just a low-level helper. Fixtures are temp dirs copied from the
real approved media; canonical public/media is never written (case 15
proves it with before/after hashes).

Run:  py scripts/media/test_check_media.py
  (npm run media:test; CI runs it right after validate:media)
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REAL_MEDIA = ROOT / "public/media"
CHECK = ROOT / "scripts/media/check_media.py"
NAMES = ["saipen-cosmos.gif", "saipen-cosmos-still.png", "saipen-cosmos.webp"]


def sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def run_check(media: Path, manifest: Path, extra_env: dict | None = None):
    env = dict(extra_env) if extra_env else None
    r = subprocess.run([sys.executable, str(CHECK), "--media-dir", str(media),
                        "--manifest", str(manifest)],
                       capture_output=True, text=True, env=env, timeout=600)
    return r.returncode, (r.stdout + r.stderr)


class Fixture:
    """Disposable copy of the approved media + manifest."""

    def __init__(self, test: unittest.TestCase):
        self._tmp = tempfile.TemporaryDirectory(prefix="media-neg-")
        test.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        self.media = self.dir / "m"
        self.media.mkdir()
        for f in REAL_MEDIA.iterdir():
            if f.is_file():
                shutil.copy(f, self.media / f.name)
        self.manifest = self.dir / "MANIFEST.json"
        shutil.copy(REAL_MEDIA / "MANIFEST.json", self.manifest)

    def doc(self) -> dict:
        return json.loads(self.manifest.read_text(encoding="utf-8"))

    def write_doc(self, doc: dict) -> None:
        self.manifest.write_text(json.dumps(doc), encoding="utf-8")

    def rehash(self, name: str) -> None:
        doc = self.doc()
        for a in doc["assets"]:
            if a["file"] == name:
                a["sha256"] = sha(self.media / name)
        self.write_doc(doc)

    def check(self, extra_env: dict | None = None):
        code, out = run_check(self.media, self.manifest, extra_env)
        return code, out


def webp_frames(path: Path):
    from PIL import Image
    im = Image.open(path)
    im.load()
    frames, durs = [], []
    try:
        i = 0
        while True:
            im.seek(i)
            frames.append(im.convert("RGB"))
            durs.append(im.info.get("duration", 62))
            i += 1
    except EOFError:
        pass
    return frames, durs


def save_webp(path: Path, frames, durs, quality=60, method=6, loop=0):
    frames[0].save(path, save_all=True, append_images=frames[1:],
                    duration=durs, loop=loop, quality=quality, method=method)


class SemanticControls(unittest.TestCase):
    def test_01_approved_assets_pass(self):
        fx = Fixture(self)
        code, out = fx.check()
        self.assertEqual(code, 0, out[-1500:])

    def test_02_unrelated_webp_with_matching_hash_fails(self):
        from PIL import Image, ImageDraw
        fx = Fixture(self)
        frames = []
        for i in range(128):
            im = Image.new("RGB", (480, 270), (10 + i % 40, 20, 60))
            ImageDraw.Draw(im).rectangle([i * 3 % 400, 50, i * 3 % 400 + 80, 220],
                                         fill=(200, 150, 50))
            frames.append(im)
        save_webp(fx.media / "saipen-cosmos.webp", frames, [60] * 96 + [70] * 32)
        fx.rehash("saipen-cosmos.webp")
        code, out = fx.check()
        self.assertNotEqual(code, 0)
        self.assertIn("[derivation]", out)

    def test_03_altered_gif_with_unchanged_webp_fails(self):
        from PIL import Image
        fx = Fixture(self)
        p = fx.media / "saipen-cosmos.gif"
        with Image.open(p) as src:
            im = src.convert("RGB")
        px = im.load()
        for y in range(100, 160):
            for x in range(200, 260):
                px[x, y] = (255, 0, 0)
        im.save(p)
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])

    def test_04_reordered_frames_fail(self):
        fx = Fixture(self)
        frames, durs = webp_frames(fx.media / "saipen-cosmos.webp")
        frames = frames[::-1]
        durs = durs[::-1]
        save_webp(fx.media / "saipen-cosmos.webp", frames, durs)
        fx.rehash("saipen-cosmos.webp")
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])
        self.assertIn("[derivation]", out)

    def test_05_altered_content_with_valid_timing_fails(self):
        fx = Fixture(self)
        frames, durs = webp_frames(fx.media / "saipen-cosmos.webp")
        from PIL import ImageDraw
        ImageDraw.Draw(frames[64]).rectangle([0, 0, 480, 270], fill=(1, 2, 3))
        save_webp(fx.media / "saipen-cosmos.webp", frames, durs)
        fx.rehash("saipen-cosmos.webp")
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])
        self.assertIn("[derivation]", out)

    def test_06_fresh_rederivation_is_accepted(self):
        # The verifier must accept its own deterministic output: re-derive
        # from the approved GIF and use that as the fixture WebP.
        fx = Fixture(self)
        sys.path.insert(0, str(ROOT / "scripts/media"))
        try:
            import tempfile as tf
            from cosmos_derive import WEBP_DERIVED, derive_webp
            name, src, q, m = WEBP_DERIVED
            with tf.TemporaryDirectory(prefix="media-rederive-") as tmp:
                shutil.copy(fx.media / src, Path(tmp) / src)
                probe = derive_webp(Path(tmp), name, src, q, m)
                shutil.copy(probe, fx.media / name)
        finally:
            sys.path.remove(str(ROOT / "scripts/media"))
        fx.rehash("saipen-cosmos.webp")
        code, out = fx.check()
        self.assertEqual(code, 0, out[-1500:])

    def test_07_still_not_first_frame_fails(self):
        from PIL import Image
        fx = Fixture(self)
        Image.new("RGB", (480, 270), (9, 9, 9)).save(fx.media / "saipen-cosmos-still.png")
        fx.rehash("saipen-cosmos-still.png")
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])
        self.assertIn("[still]", out)

    def test_08_wrong_loop_fails(self):
        fx = Fixture(self)
        frames, durs = webp_frames(fx.media / "saipen-cosmos.webp")
        save_webp(fx.media / "saipen-cosmos.webp", frames, durs, loop=3)
        fx.rehash("saipen-cosmos.webp")
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])

    def test_09_wrong_frame_count_fails(self):
        fx = Fixture(self)
        frames, durs = webp_frames(fx.media / "saipen-cosmos.webp")
        save_webp(fx.media / "saipen-cosmos.webp", frames[:100], durs[:100])
        fx.rehash("saipen-cosmos.webp")
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])

    def test_10_wrong_duration_fails(self):
        fx = Fixture(self)
        frames, durs = webp_frames(fx.media / "saipen-cosmos.webp")
        save_webp(fx.media / "saipen-cosmos.webp", frames, [30] * 128)
        fx.rehash("saipen-cosmos.webp")
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])

    def test_11_corrupt_container_fails(self):
        fx = Fixture(self)
        p = fx.media / "saipen-cosmos.webp"
        p.write_bytes(p.read_bytes()[:2000])
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])

    def test_12_missing_gif_fails(self):
        fx = Fixture(self)
        (fx.media / "saipen-cosmos.gif").unlink()
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])
        self.assertIn("[missing]", out)

    def test_13_missing_pillow_is_diagnostic_failure(self):
        import os
        fx = Fixture(self)
        stub = fx.dir / "nopil"
        (stub / "PIL").mkdir(parents=True)
        (stub / "PIL" / "__init__.py").write_text(
            "raise ImportError('simulated missing Pillow')\n", encoding="utf-8")
        env = dict(os.environ)
        env["PYTHONPATH"] = str(stub) + os.pathsep + env.get("PYTHONPATH", "")
        code, out = fx.check(extra_env=env)
        self.assertNotEqual(code, 0, out[-800:])
        self.assertIn("Pillow", out)

    def test_14_valid_bytes_wrong_manifest_hash_fails(self):
        fx = Fixture(self)
        doc = fx.doc()
        for a in doc["assets"]:
            if a["file"] == "saipen-cosmos.webp":
                a["sha256"] = "0" * 64
        fx.write_doc(doc)
        code, out = fx.check()
        self.assertNotEqual(code, 0, out[-800:])
        self.assertIn("[drift]", out)

    def test_15_canonical_media_left_unchanged(self):
        before = {f.name: sha(f) for f in REAL_MEDIA.iterdir() if f.is_file()}
        fx = Fixture(self)
        fx.check()
        after = {f.name: sha(f) for f in REAL_MEDIA.iterdir() if f.is_file()}
        self.assertEqual(before, after)


if __name__ == "__main__":
    unittest.main(verbosity=2)
