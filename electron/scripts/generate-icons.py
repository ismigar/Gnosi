#!/usr/bin/env python3
"""Generate deterministic desktop icons from the canonical Gnosi logo.

The canonical mark is ``frontend/public/favicon.svg`` — a white bold ``G`` on a
blue gradient rounded square. Because the favicon uses ``font-family: system-ui``
for the letter, rasterizing it verbatim would depend on the system font and
produce a different ``G`` on each OS. To stay deterministic we rebuild the glyph
as vector paths from the system Helvetica Bold face and rasterize the result to
a 1024 master, from which the ICNS/ICO/PNG outputs are derived.

Run locally with the project venv (cairosvg + fonttools + Pillow)::

    python electron/scripts/generate-icons.py
"""

import sys
from pathlib import Path

import cairosvg
from PIL import Image
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ELECTRON_DIR = Path(__file__).resolve().parents[1]
PUBLIC_DIR = ELECTRON_DIR.parent / "frontend" / "public"
BUILD_DIR = ELECTRON_DIR / "build"

FAVICON_SVG = PUBLIC_DIR / "favicon.svg"
APP_ICON_PNG = PUBLIC_DIR / "app-icon-512.png"

# Helvetica Bold is the closest system font to ``font-weight: 800`` on macOS and
# ships with the OS. The collection index of the bold face varies by file.
FONT_CANDIDATES = [
    "/System/Library/Fonts/HelveticaNeue.ttc",
    "/System/Library/Fonts/Helvetica.ttc",
]


def _load_bold_font() -> TTFont:
    for candidate in FONT_CANDIDATES:
        if not Path(candidate).exists():
            continue
        for index in range(8):
            try:
                font = TTFont(candidate, fontNumber=index)
            except Exception:
                break
            name = font["name"].getDebugName(6) or ""
            if "Bold" in name:
                return font
        # Fall back to the first face if no bold variant is found.
        return TTFont(candidate, fontNumber=0)
    raise FileNotFoundError("No Helvetica system font found")


def _glyph_path(font: TTFont, ch: str) -> str:
    cmap = font.getBestCmap()
    glyph_set = font.getGlyphSet()
    pen = SVGPathPen(glyph_set)
    glyph_set[cmap[ord(ch)]].draw(pen)
    return pen.getCommands()


def _build_logo_svg() -> str:
    """Rebuild the favicon as a 1024 SVG with the G converted to paths."""
    font = _load_bold_font()
    g_path = _glyph_path(font, "G")
    # Keep a generous blue margin around the centered glyph, matching the
    # canonical Gnosi mark rather than filling the whole rounded square.
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0066ff"/>
      <stop offset="100%" stop-color="#00d4ff"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#g)"/>
  <g transform="translate(512 512) scale(0.50) translate(-351 -360)">
    <path d="{g_path}" fill="white"/>
  </g>
</svg>"""


def main() -> None:
    if not FAVICON_SVG.is_file():
        raise FileNotFoundError(f"Canonical logo not found: {FAVICON_SVG}")

    BUILD_DIR.mkdir(parents=True, exist_ok=True)

    # Render the deterministic logo SVG to a 1024 master PNG.
    svg = _build_logo_svg()
    master_png = BUILD_DIR / "_logo-1024.png"
    cairosvg.svg2png(bytestring=svg.encode("utf-8"), write_to=str(master_png), output_width=1024, output_height=1024)

    with Image.open(master_png) as source_image:
        image = source_image.convert("RGBA")
        # Keep the web app's source PNGs in sync with the new mark.
        image.resize((512, 512), Image.Resampling.LANCZOS).save(APP_ICON_PNG, format="PNG")
        image.resize((192, 192), Image.Resampling.LANCZOS).save(
            PUBLIC_DIR / "app-icon-192.png", format="PNG"
        )
        image.save(BUILD_DIR / "icon.png", format="PNG")
        image.save(
            BUILD_DIR / "icon.ico",
            format="ICO",
            sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
        )
        image.save(BUILD_DIR / "icon.icns", format="ICNS")

    master_png.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
