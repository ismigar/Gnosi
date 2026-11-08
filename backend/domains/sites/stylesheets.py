"""Website-specific stylesheet layers; originals remain the packaged defaults."""
import json
from pathlib import Path
from typing import Literal

import tinycss2
from fastapi import HTTPException

from .models import SiteTheme
from .paths import extension_root
from .validation import validate_css

STYLESHEETS: dict[Literal["base", "template", "layout"], str] = {'base': 'styles.css', 'template': 'temenos.css', 'layout': 'page-layout.css'}


def layered_stylesheet(css: str) -> str:
    """Keep legacy unlayered rules below explicit appearance and page settings."""
    output = []
    for node in tinycss2.parse_stylesheet(css):
        if node.type == 'error':
            raise HTTPException(422, 'Invalid website stylesheet')
        text = node.serialize()
        layered = node.type in ('comment', 'whitespace') or (node.type == 'at-rule' and node.lower_at_keyword == 'layer')
        output.append(text if layered else '@layer components{' + text + '}')
    return ''.join(output)


def website_stylesheet(theme: SiteTheme, directory: Path | None = None) -> str:
    directory = directory or extension_root() / 'renderer/src/lib'
    layers = ['@layer base,theme,components,appearance,page,advanced;']
    catalogue = json.loads((extension_root() / 'renderer/src/lib/color-tokens.json').read_text())
    regional_keys = [token['key'] for group in catalogue for token in group['tokens'] if token.get('selectors')]
    regional_colors = any(theme.tokens.get(key, '').strip() for key in regional_keys)
    for key, filename in STYLESHEETS.items():
        # An explicitly empty override removes that stylesheet; absence restores it.
        css = theme.stylesheet_overrides[key] if key in theme.stylesheet_overrides else (directory / filename).read_text(encoding='utf-8')
        validate_css(css)
        layers.append(layered_stylesheet(css) if regional_colors else css)
    return '\n'.join(layers)
