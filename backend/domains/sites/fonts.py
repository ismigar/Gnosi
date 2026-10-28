"""Read only explicitly configured local website fonts for editor samples."""
from __future__ import annotations
from pathlib import Path
from urllib.parse import urlsplit
from .models import SiteConfig
from .storage import SiteStore
from .theme_assets import read_asset, validate_font


def preview_font(store: SiteStore, site: SiteConfig, source: str) -> tuple[bytes, str]:
    raw = read_asset(store, site, source)
    return raw, validate_font(raw, Path(urlsplit(source).path).suffix.lower())
