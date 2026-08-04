#!/usr/bin/env python3
"""Generate the macOS DMG installer background (clean light, Gnosi logo only).

Produces ``build/dmg-background.png`` at Retina size (1058x716). The layout is
intentionally minimal — just the centered mark on a soft light background, in
the style of Notion/Slack installers. electron-builder positions the app and
Applications icons over this on mount.

Run locally with the project venv (cairosvg + fonttools + Pillow)::

    python electron/scripts/generate-dmg-background.py
"""

from pathlib import Path

from PIL import Image

ELECTRON_DIR = Path(__file__).resolve().parents[1]
BUILD_DIR = ELECTRON_DIR / "build"
ICON_PNG = BUILD_DIR / "icon.png"

WIDTH, HEIGHT = 1058, 716
LOGO_SIZE = 256


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    if not ICON_PNG.is_file():
        raise FileNotFoundError(
            f"Run generate-icons.py first — {ICON_PNG} not found"
        )

    # Soft light background, slightly cooler than pure white to match the mark.
    background = Image.new("RGB", (WIDTH, HEIGHT), (248, 250, 252))

    with Image.open(ICON_PNG) as icon:
        icon = icon.convert("RGBA")
        icon = icon.resize((LOGO_SIZE, LOGO_SIZE), Image.Resampling.LANCZOS)
        x = (WIDTH - LOGO_SIZE) // 2
        y = (HEIGHT - LOGO_SIZE) // 2
        background.paste(icon, (x, y), icon)

    background.save(BUILD_DIR / "dmg-background.png", format="PNG")


if __name__ == "__main__":
    main()
