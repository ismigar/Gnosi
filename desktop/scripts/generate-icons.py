#!/usr/bin/env python3
"""Rasterize the checked-in vector mark to every desktop and PWA icon.

The canonical favicon contains paths, not system-font text. No glyph rebuilding
or platform font selection is allowed here. Outputs go to the assets directory
consumed by electron-builder.
"""

from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image

DESKTOP_DIR = Path(__file__).resolve().parents[1]
PUBLIC_DIR = DESKTOP_DIR.parent / "frontend" / "public"
ASSETS_DIR = DESKTOP_DIR / "assets"


def main() -> None:
    svg = (PUBLIC_DIR / "favicon.svg").read_bytes()
    if b"<text" in svg:
        raise ValueError("The canonical logo must contain paths, not font-dependent text")
    rendered = cairosvg.svg2png(bytestring=svg, output_width=1024, output_height=1024)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)
    with Image.open(BytesIO(rendered)) as source:
        image = source.convert("RGBA")
        for size in (192, 512):
            image.resize((size, size), Image.Resampling.LANCZOS).save(
                PUBLIC_DIR / f"app-icon-{size}.png", format="PNG"
            )
        image.save(ASSETS_DIR / "icon.png", format="PNG")
        image.save(ASSETS_DIR / "icon.icns", format="ICNS")
        sizes = [(size, size) for size in (16, 32, 48, 64, 128, 256)]
        image.save(ASSETS_DIR / "icon.ico", format="ICO", sizes=sizes)
        image.save(PUBLIC_DIR / "favicon.ico", format="ICO", sizes=sizes)


if __name__ == "__main__":
    main()
