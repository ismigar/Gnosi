#!/usr/bin/env python3
"""Generate deterministic desktop icons from the canonical Gnosi artwork."""

from pathlib import Path

from PIL import Image


ELECTRON_DIR = Path(__file__).resolve().parents[1]
SOURCE = ELECTRON_DIR.parent / "frontend" / "public" / "app-icon-512.png"
BUILD_DIR = ELECTRON_DIR / "build"
def main() -> None:
    """Create the ICNS, ICO, and PNG files consumed by electron-builder."""
    if not SOURCE.is_file():
        raise FileNotFoundError(f"Canonical icon not found: {SOURCE}")

    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    with Image.open(SOURCE) as source_image:
        image = source_image.convert("RGBA")
        image.save(BUILD_DIR / "icon.png", format="PNG")
        image.save(
            BUILD_DIR / "icon.ico",
            format="ICO",
            sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )
        image.resize((1024, 1024), Image.Resampling.LANCZOS).save(
            BUILD_DIR / "icon.icns",
            format="ICNS",
        )

if __name__ == "__main__":
    main()
