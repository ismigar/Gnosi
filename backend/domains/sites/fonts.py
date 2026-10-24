"""Read only explicitly configured local website fonts for editor samples."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException

from .exporter import bounded_read
from .models import SiteConfig
from .storage import SiteStore


def preview_font(store: SiteStore, site: SiteConfig, source: str) -> tuple[bytes, str]:
    if source not in {font.src for font in site.theme.fonts}:
        raise HTTPException(404, "Select and save the website font before previewing it")
    parsed = urlsplit(source)
    suffix = Path(parsed.path).suffix.lower()
    if parsed.scheme or parsed.netloc or suffix not in {".woff", ".woff2"}:
        raise HTTPException(404, "Only configured local web fonts can be previewed")
    raw: bytes | None = None
    imported = store.site_dir(site.id) / "imported"
    if site.legacy_pilot and (imported / "baseline.json").is_file():
        payload = json.loads((imported / "baseline.json").read_text())
        asset = next((asset for asset in payload.get("assets", []) if asset.get("path") == unquote(parsed.path)), None)
        if asset:
            path = Path(asset["private_source"])
            raw = bounded_read(path, imported / "assets", 4_000_000)
            if hashlib.sha256(raw).hexdigest() != asset["sha256"]:
                raise HTTPException(409, "The imported font changed; review its source")
    if raw is None:
        relative = unquote(parsed.path).lstrip("/")
        candidates = [store.vault / relative, store.vault / "Attachments" / relative]
        local_path = next((path for path in candidates if path.is_file()), None)
        if local_path is None:
            raise HTTPException(404, "The configured font is unavailable")
        raw = bounded_read(local_path, store.vault, 4_000_000)
    if not raw.startswith(b"wOF2" if suffix == ".woff2" else b"wOFF"):
        raise HTTPException(422, "A valid WOFF or WOFF2 font is required")
    return raw, "font/woff2" if suffix == ".woff2" else "font/woff"
