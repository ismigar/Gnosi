"""Application services for vault assets and icons."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import mimetypes
import urllib.parse
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import requests
from fastapi import BackgroundTasks, HTTPException, UploadFile

Metadata = dict[str, Any]
TableResolver = Callable[
    [str, Metadata],
    tuple[Metadata | None, Metadata | None],
]

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class AssetDependencies:
    """Narrow legacy ports used by asset workflows."""

    get_path: Callable[[str], Path]
    save_uploaded_asset: Callable[[UploadFile, Path, str], str]
    load_registry: Callable[[], Metadata]
    resolve_table: TableResolver
    table_assets_dir: Callable[[Metadata, Metadata | None], Path]
    safe_write_bytes: Callable[[Path, bytes], None]
    validate_external_url: Callable[[str], tuple[bool, str]]


def is_image_upload(file: UploadFile) -> bool:
    """Return whether upload metadata identifies an image."""
    content_type = str(file.content_type or "").strip().lower()
    if content_type.startswith("image/"):
        return True
    guessed_type, _ = mimetypes.guess_type(file.filename or "")
    return bool(guessed_type and guessed_type.startswith("image/"))


def normalize_icon_extension(filename: str, content_type: str) -> str:
    """Resolve the stable extension used for icon assets."""
    ext = (Path(filename or "").suffix or "").strip().lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".svg"}:
        return ".jpg" if ext == ".jpeg" else ext

    ctype = str(content_type or "").split(";")[0].strip().lower()
    mapped = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
    }.get(ctype)
    return mapped or ".png"


def upload_image_to_assets_subdir(
    file: UploadFile,
    subdir: str,
    dependencies: AssetDependencies,
) -> dict[str, str]:
    """Persist an uploaded image below one fixed Assets subdirectory."""
    if not is_image_upload(file):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    target_path = dependencies.get_path("ASSETS") / subdir
    target_path.mkdir(parents=True, exist_ok=True)
    try:
        relative_path = dependencies.save_uploaded_asset(file, target_path, "")
    except Exception as exc:
        log.error("Error uploading image to %s: %s", subdir, exc)
        raise HTTPException(status_code=500, detail="Could not save image") from exc
    url = f"/api/vault/assets/{relative_path[len('Assets/') :]}"
    return {"url": url, "path": relative_path}


def store_icon_bytes(
    payload: bytes,
    source_name: str,
    content_type: str,
    dependencies: AssetDependencies,
) -> dict[str, str | None]:
    """Store content-addressed icon bytes and build the legacy payload."""
    if not payload:
        raise HTTPException(status_code=400, detail="Empty icon payload")

    icons_dir = dependencies.get_path("ASSETS") / "Icons"
    icons_dir.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256(payload).hexdigest()[:12]
    ext = normalize_icon_extension(source_name, content_type)
    icon_path = icons_dir / f"icon-{digest}{ext}"
    if not icon_path.exists():
        dependencies.safe_write_bytes(icon_path, payload)

    icon_rel = str(icon_path.relative_to(dependencies.get_path("VAULT"))).replace(
        "\\",
        "/",
    )
    return {
        "url": f"/api/vault/assets/{icon_rel[len('Assets/') :]}",
        "path": icon_rel,
        "thumbnail_url": None,
        "thumbnail_path": None,
    }


def maybe_create_icon_thumbnail(
    icon_path: Path,
    digest: str,
    dependencies: AssetDependencies,
) -> str | None:
    """Create the historical square icon thumbnail when Pillow supports it."""
    try:
        from PIL import Image
    except Exception:
        return None
    if icon_path.suffix.lower() == ".svg":
        return None
    try:
        with Image.open(icon_path) as img:
            width, height = img.size
            if max(width, height) <= 256:
                return None
            side = min(width, height)
            left = (width - side) // 2
            top = (height - side) // 2
            cropped = img.crop((left, top, left + side, top + side))
            thumb = cropped.resize((128, 128), Image.Resampling.LANCZOS)
            thumbs_dir = dependencies.get_path("ASSETS") / "Icons" / "Thumbnails"
            thumbs_dir.mkdir(parents=True, exist_ok=True)
            thumb_path = thumbs_dir / f"icon-{digest}-thumb.png"
            thumb.save(thumb_path, format="PNG")
            return str(thumb_path.relative_to(dependencies.get_path("VAULT"))).replace("\\", "/")
    except Exception:
        return None


async def upload_cover(
    file: UploadFile,
    dependencies: AssetDependencies,
) -> dict[str, str]:
    """Upload one cover image without blocking the event loop."""
    return await asyncio.to_thread(
        upload_image_to_assets_subdir,
        file,
        "Covers",
        dependencies,
    )


async def upload_icon(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    dependencies: AssetDependencies,
    thumbnail_callback: Callable[[Path, str], str | None],
) -> dict[str, str | None]:
    """Upload one content-addressed icon and queue its thumbnail."""
    if not is_image_upload(file):
        raise HTTPException(status_code=400, detail="Uploaded file must be an image")

    log.debug("upload_icon: START %s (%s)", file.filename, file.content_type)
    try:
        payload = await file.read()
        log.debug("upload_icon: READ %s bytes", len(payload))
        if len(payload) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Icon is too large (max 10MB)")

        icons_dir = dependencies.get_path("ASSETS") / "Icons"
        icons_dir.mkdir(parents=True, exist_ok=True)
        digest = hashlib.sha256(payload).hexdigest()[:12]
        ext = normalize_icon_extension(file.filename or "", file.content_type or "")
        icon_path = icons_dir / f"icon-{digest}{ext}"
        if not icon_path.exists():
            dependencies.safe_write_bytes(icon_path, payload)
            log.debug("upload_icon: SAVED %s", icon_path)
        else:
            log.debug("upload_icon: EXISTS %s", icon_path)

        background_tasks.add_task(thumbnail_callback, icon_path, digest)
        icon_rel = str(icon_path.relative_to(dependencies.get_path("VAULT"))).replace("\\", "/")
        result: dict[str, str | None] = {
            "url": f"/api/vault/assets/{icon_rel[len('Assets/') :]}",
            "path": icon_rel,
            "thumbnail_url": None,
            "thumbnail_path": None,
        }
        log.debug("upload_icon: FINISH URL %s", result.get("url"))
        return result
    except Exception as exc:
        log.error("upload_icon: FATAL %s", exc)
        raise


async def import_icon_from_url(
    url: str,
    dependencies: AssetDependencies,
) -> dict[str, str | None]:
    """Download and store one externally hosted icon."""
    url = str(url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required")
    if not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="URL must be http(s)")

    ok, reason = dependencies.validate_external_url(url)
    if not ok:
        raise HTTPException(status_code=400, detail=f"Refusing to fetch URL: {reason}")
    try:
        response = await asyncio.to_thread(
            requests.get,
            url,
            timeout=12,
            stream=True,
        )
        response.raise_for_status()
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not fetch icon URL: {exc}") from exc

    content_type = str(response.headers.get("Content-Type") or "").split(";")[0].lower()
    if not content_type.startswith("image/"):
        response.close()
        raise HTTPException(status_code=400, detail="URL does not point to an image")

    chunks: list[bytes] = []
    total = 0
    try:
        for raw_chunk in response.iter_content(chunk_size=64 * 1024):
            chunk = cast(bytes, raw_chunk)
            if not chunk:
                continue
            total += len(chunk)
            if total > 10 * 1024 * 1024:
                raise HTTPException(status_code=413, detail="Icon is too large (max 10MB)")
            chunks.append(chunk)
    finally:
        response.close()

    source_name = Path(urllib.parse.urlparse(url).path).name or "remote-icon"
    return store_icon_bytes(
        b"".join(chunks),
        source_name,
        content_type,
        dependencies,
    )


async def upload_asset(
    file: UploadFile,
    table_id: str | None,
    target_name: str | None,
    dependencies: AssetDependencies,
) -> dict[str, object]:
    """Persist one generic inline or file asset."""
    is_image = is_image_upload(file)
    subdir = "Inline" if is_image else "Files"
    if table_id:
        registry = dependencies.load_registry()
        table, database = dependencies.resolve_table(table_id, registry)
        target_dir = (
            dependencies.table_assets_dir(table, database) / subdir
            if table
            else dependencies.get_path("ASSETS") / subdir
        )
    else:
        target_dir = dependencies.get_path("ASSETS") / subdir

    try:
        relative_path = await asyncio.to_thread(
            dependencies.save_uploaded_asset,
            file,
            target_dir,
            target_name or "",
        )
    except Exception as exc:
        log.error("Error uploading asset: %s", exc)
        raise HTTPException(status_code=500, detail="Could not save file") from exc
    return {
        "url": f"/api/vault/assets/{relative_path[len('Assets/') :]}",
        "path": relative_path,
        "is_image": is_image,
    }


__all__ = [
    "AssetDependencies",
    "import_icon_from_url",
    "is_image_upload",
    "maybe_create_icon_thumbnail",
    "normalize_icon_extension",
    "store_icon_bytes",
    "upload_asset",
    "upload_cover",
    "upload_icon",
    "upload_image_to_assets_subdir",
]
