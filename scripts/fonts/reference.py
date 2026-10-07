"""
Canonical Verdana_m1 reference resolution for local font verification.

The reference is identified by content, not by location. Several machine-local
copies named Verdana_m1 exist and they are not all the same font: the regular
face in the personal font folder differs from the face Wintage ships. Picking
the first readable path therefore made `fonts:compare` measure against
whichever copy the current environment happened to reach.

Only a candidate whose SHA-256 matches the canonical Wintage family below is
accepted. A candidate that exists but carries different bytes is reported and
skipped, never silently used.

LICENSING BOUNDARY: the reference fonts themselves are private and are never
committed or published; only their identities are recorded here.
"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DEFAULT_REF_DIR = Path(r"V:\___VAC\__K\__CUSTOMIZATION\_FONT")

# Canonical Wintage Verdana_m1 family (Version 5.33), as shipped by the Wintage
# repository (regular) and the Wintage Freebuff font patch (bold, italic).
CANONICAL_SHA256 = {
    "regular": "f212eac11a43f99c76aa857abb060d8fc10fdb04ebd3d1ddb2908ec9e6726ad0",
    "bold": "cfae74c10920f80f243013a50a27ab16e1fb475af8e3e205b4d8e91603a7d120",
    "italic": "91da40aafb06febbb7049510d8bc832b70617ad7f84eac5e3b720a620e9c209c",
}

_FILE_NAMES = {
    "regular": ("VERDANA_M1.TTF", "Verdana_m1.ttf"),
    "bold": ("VERDANA_M1-BOLD.TTF", "Verdana_m1-Bold.ttf"),
    "italic": ("VERDANA_M1-ITALIC.TTF", "Verdana_m1-Italic.ttf"),
}

_hash_cache: dict[Path, str | None] = {}
_reported: set[str] = set()


def _sha256(path: Path) -> str | None:
    if path not in _hash_cache:
        try:
            _hash_cache[path] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            _hash_cache[path] = None
    return _hash_cache[path]


def candidate_dirs(ref_dir: Path | None = None) -> list[Path]:
    dirs = [ref_dir or DEFAULT_REF_DIR, ROOT / "_src_unpack" / "wintage"]
    return list(dict.fromkeys(dirs))


def resolve_canonical(style: str, ref_dir: Path | None = None) -> Path | None:
    """Return the first reachable file whose bytes are the canonical `style` face."""
    expected = CANONICAL_SHA256[style]
    for directory in candidate_dirs(ref_dir):
        for name in _FILE_NAMES[style]:
            path = directory / name
            digest = _sha256(path)
            if digest is None:
                continue
            if digest == expected:
                return path
            if digest in _reported:
                continue
            _reported.add(digest)
            print(
                f"note: skipping non-canonical {style} reference {path} "
                f"(sha256 {digest[:12]}, expected {expected[:12]})",
                file=sys.stderr,
            )
    return None
