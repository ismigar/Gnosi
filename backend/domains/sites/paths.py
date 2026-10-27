"""Locate the website runtime in a checkout or an immutable desktop package."""
from __future__ import annotations

import sys
from pathlib import Path


def extension_root() -> Path:
    source = Path(__file__).resolve().parents[3] / "extensions/web-publishing"
    packaged = Path(sys.executable).resolve().parent.parent / "extensions/web-publishing"
    if getattr(sys, "frozen", False) and packaged.is_dir():
        return packaged
    return source
