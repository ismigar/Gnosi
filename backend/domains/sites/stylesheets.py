"""Website-specific stylesheet layers; originals remain the packaged defaults."""
from pathlib import Path
from typing import Literal

from .models import SiteTheme
from .paths import extension_root
from .validation import validate_css

STYLESHEETS: dict[Literal["base", "template", "layout"], str] = {'base': 'styles.css', 'template': 'temenos.css', 'layout': 'page-layout.css'}


def website_stylesheet(theme: SiteTheme, directory: Path | None = None) -> str:
    directory = directory or extension_root() / 'renderer/src/lib'
    layers = ['@layer base,theme,components,page,advanced;']
    for key, filename in STYLESHEETS.items():
        # An explicitly empty override removes that stylesheet; absence restores it.
        css = theme.stylesheet_overrides[key] if key in theme.stylesheet_overrides else (directory / filename).read_text(encoding='utf-8')
        validate_css(css)
        layers.append(css)
    return '\n'.join(layers)
