"""Bounded, site-scoped editorial assets; uploads never change configuration."""
from __future__ import annotations

import hashlib
import io
import json
import struct
from pathlib import Path
from urllib.parse import unquote, urlsplit

from fastapi import HTTPException
from PIL import Image, UnidentifiedImageError

from backend.utils.safe_io import safe_write_bytes
from .exporter import bounded_read
from .models import SiteConfig
from .storage import SiteStore

LIMIT = 4_000_000
IMAGE_TYPES = {".png": "PNG", ".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP", ".gif": "GIF", ".ico": "ICO"}
FONT_TYPES = {".woff": b"wOFF", ".woff2": b"wOF2", ".ttf": b"\x00\x01\x00\x00", ".otf": b"OTTO"}


def validate_font(raw: bytes, suffix: str) -> str:
    if suffix not in FONT_TYPES or len(raw) < 12 or not raw.startswith(FONT_TYPES[suffix]):
        raise HTTPException(422, "Choose a valid WOFF, WOFF2, TTF or OTF font")
    # Reject compressed fonts that expand beyond the editor's bounded preview budget.
    if suffix in {".woff", ".woff2"}:
        if len(raw) < (48 if suffix == ".woff2" else 44) or struct.unpack_from(">I", raw, 8)[0] != len(raw) or struct.unpack_from(">I", raw, 16)[0] > 24_000_000:
            raise HTTPException(422, "The web font is invalid or too large to preview")
    if suffix in {".ttf", ".otf"}:
        tables = struct.unpack_from(">H", raw, 4)[0]
        if not 1 <= tables <= 256 or len(raw) < 12 + tables * 16:
            raise HTTPException(422, "The font table directory is invalid")
        for index in range(tables):
            offset, length = struct.unpack_from(">II", raw, 12 + index * 16 + 8)
            if offset > len(raw) or length > len(raw) - offset:
                raise HTTPException(422, "The font contains an incomplete table")
    return {".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf"}[suffix]


def image_preview(raw: bytes, suffix: str) -> bytes:
    if suffix not in IMAGE_TYPES:
        raise HTTPException(422, "Choose a PNG, JPEG, WebP, GIF or ICO image")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.format != IMAGE_TYPES[suffix] or image.width * image.height > 16_000_000:
                raise HTTPException(422, "The image format or dimensions are not supported")
            image.thumbnail((320, 180))
            output = io.BytesIO()
            image.convert("RGBA").save(output, format="PNG")
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(422, "The image could not be read") from None


def asset_directory(store: SiteStore, site_id: str) -> Path:
    store.site_dir(site_id)
    root = store.config_root / "assets" / site_id
    if any(path.is_symlink() for path in (store.config_root, root.parent, root)) or not root.resolve().is_relative_to(store.vault):
        raise HTTPException(409, "Invalid website asset storage")
    root.mkdir(parents=True, exist_ok=True)
    return root


def upload(store: SiteStore, site: SiteConfig, filename: str, raw: bytes, kind: str) -> tuple[str, str]:
    if not raw or len(raw) > LIMIT:
        raise HTTPException(413, "Choose a nonempty file smaller than 4 MB")
    suffix = Path(filename).suffix.lower()
    media_type = validate_font(raw, suffix) if kind == "font" else "image/png"
    if kind != "font":
        image_preview(raw, suffix)
    target = asset_directory(store, site.id) / (hashlib.sha256(raw).hexdigest() + suffix)
    if target.is_symlink():
        raise HTTPException(409, "Invalid website asset file")
    if target.exists():
        if bounded_read(target, store.vault, LIMIT) != raw:
            raise HTTPException(409, "The existing website asset has changed")
    else:
        safe_write_bytes(target, raw)
    return "/" + target.relative_to(store.vault).as_posix(), media_type


def read_asset(store: SiteStore, site: SiteConfig, source: str) -> bytes:
    parsed = urlsplit(source)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise HTTPException(404, "Only local website assets can be previewed")
    path = unquote(parsed.path)
    uploaded = "/" + asset_directory(store, site.id).relative_to(store.vault).as_posix() + "/"
    configured = {site.theme.logo, site.theme.favicon} | {font.src for font in site.theme.fonts}
    if source not in configured and not (path.startswith(uploaded) and len(path[len(uploaded):].split("/")) == 1):
        raise HTTPException(404, "This asset is not selected for the website")
    imported = store.site_dir(site.id) / "imported"
    if source in configured and site.legacy_pilot and (imported / "baseline.json").is_file():
        payload = json.loads((imported / "baseline.json").read_text())
        entry = next((asset for asset in payload.get("assets", []) if asset.get("path") == path), None)
        if entry:
            raw = bounded_read(Path(entry["private_source"]), imported / "assets", LIMIT)
            if hashlib.sha256(raw).hexdigest() != entry["sha256"]:
                raise HTTPException(409, "The imported website asset has changed")
            return raw
    candidates = [store.vault / path.lstrip("/"), store.vault / "Attachments" / path.lstrip("/")]
    local = next((candidate for candidate in candidates if candidate.is_file()), None)
    if local is None:
        raise HTTPException(404, "The website asset is unavailable")
    if source not in configured and not local.resolve().is_relative_to(asset_directory(store, site.id)):
        raise HTTPException(404, "The asset is outside this website")
    return bounded_read(local, store.vault, LIMIT)
