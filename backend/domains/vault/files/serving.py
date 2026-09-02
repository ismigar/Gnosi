"""Contained and cloud-aware vault file streaming."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
import urllib.parse
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from backend.domains.vault.files.state import FileServingState
from backend.platform.files.base import FilesProvider

log = logging.getLogger(__name__)

_NO_STORE_HEADERS = {"Cache-Control": "no-store, must-revalidate"}


def image_error(
    status: int,
    detail: str,
    retry_after: int | None = None,
) -> HTTPException:
    """Create a non-cacheable image error response."""
    headers = _NO_STORE_HEADERS
    if retry_after is not None:
        headers = {**_NO_STORE_HEADERS, "Retry-After": str(retry_after)}
    return HTTPException(status_code=status, detail=detail, headers=headers)


def read_failure_hint(error: OSError) -> str:
    """Return the historical Full Disk Access hint for errno 1."""
    if getattr(error, "errno", None) == 1:
        return (
            " — errno 1 = el procés NO té Full Disk Access; concedeix-lo al "
            "binari Python del venv del backend (Configuració del Sistema → "
            "Privadesa i seguretat → Accés total al disc) i reinicia el backend"
        )
    return ""


async def probe_readable(path: Path) -> OSError | None:
    """Probe one byte with the legacy cloud-mount retry schedule."""
    last_error: OSError | None = None
    for attempt in range(5):
        try:
            with path.open("rb") as file_handle:
                file_handle.read(1)
            return None
        except OSError as exc:
            last_error = exc
            if exc.errno == 35 and attempt < 4:
                await asyncio.sleep(0.2 * (2**attempt))
                continue
            break
    return last_error


async def serve_file_with_containment(
    root_dir: Path,
    rel_path: str,
    *,
    state: FileServingState,
    provider: FilesProvider,
) -> FileResponse:
    """Serve one path contained below an explicitly selected root."""
    if not root_dir or not root_dir.exists():
        raise HTTPException(status_code=404, detail="Root directory not available")
    try:
        root_resolved = root_dir.resolve()
        requested = (root_dir / rel_path).resolve()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid path") from exc

    try:
        if not requested.is_relative_to(root_resolved):
            raise HTTPException(status_code=403, detail="Access denied")
    except AttributeError:
        if (
            not str(requested).startswith(str(root_resolved) + os.sep)
            and requested != root_resolved
        ):
            raise HTTPException(status_code=403, detail="Access denied")

    if not requested.exists() or not requested.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        stat_result = requested.stat()
    except OSError as exc:
        log.warning("stat() failed for %s: %s", requested, exc)
        raise HTTPException(status_code=503, detail="File temporarily unavailable") from exc
    if stat_result.st_size == 0:
        raise HTTPException(
            status_code=404,
            detail="File is an empty placeholder (OneDrive)",
        )

    media_type, _ = mimetypes.guess_type(str(requested))
    if provider.is_online_only(requested, stat_result):
        if media_type and media_type.startswith("image/"):
            provider.schedule_warmup(requested)
            raise image_error(
                503,
                "Image warming up; retry shortly",
                retry_after=3,
            )
        await provider.materialize(requested)
        try:
            stat_result = requested.stat()
        except OSError as exc:
            log.warning("stat() failed after warmup for %s: %s", requested, exc)
            raise HTTPException(
                status_code=503,
                detail="File temporarily unavailable",
            ) from exc
        if provider.is_online_only(requested, stat_result):
            log.warning("☁️ Online-only file has not been downloaded yet: %s", requested)
            raise HTTPException(
                status_code=503,
                detail="File temporarily unavailable; warmup pending",
            )

    async with state.semaphore:
        last_error = await probe_readable(requested)
        if last_error is not None:
            log.warning(
                "☁️ Read failed after retries for %s: %s%s",
                requested,
                last_error,
                read_failure_hint(last_error),
            )
            raise HTTPException(status_code=503, detail="File temporarily unavailable")
        return FileResponse(
            path=str(requested),
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=300"},
        )


async def serve_vault_image(
    vault_path: Path,
    image_path: str,
    *,
    state: FileServingState,
    provider: FilesProvider,
) -> FileResponse:
    """Serve one image below the active vault's Images directory."""
    if not vault_path:
        raise image_error(500, "Vault not configured")
    image_root = (vault_path / "Images").resolve()
    requested = (image_root / urllib.parse.unquote(image_path)).resolve()
    try:
        if not requested.is_relative_to(image_root):
            log.warning(
                "⛔ Attempted access outside the media root: %s (root: %s)",
                requested,
                image_root,
            )
            raise image_error(403, "Access denied")
    except (ValueError, AttributeError):
        if not str(requested).startswith(str(image_root)):
            log.warning("⛔ Fallback startswith: access denied for %s", requested)
            raise image_error(403, "Access denied")

    if not requested.exists() or not requested.is_file():
        log.error("❌ Image not found on disk: %s", requested)
        raise image_error(404, "Image not found")
    try:
        stat_result = requested.stat()
    except OSError as exc:
        log.warning("stat() failed for %s: %s", requested, exc)
        raise image_error(503, "Image temporarily unavailable") from exc
    if stat_result.st_size == 0:
        log.warning(
            "☁️ Placeholder file detected (0 bytes): %s. Download it from OneDrive.", requested
        )
        raise image_error(404, "Image is an empty placeholder (OneDrive)")

    if provider.is_online_only(requested, stat_result):
        provider.schedule_warmup(requested)
        log.info("☁️ Background warmup started for %s (503 pending)", requested)
        raise image_error(503, "Image warming up; retry shortly", retry_after=3)

    async with state.semaphore:
        last_error = await probe_readable(requested)
        if last_error is not None:
            log.warning(
                "☁️ Read failed after retries for %s: %s%s",
                requested,
                last_error,
                read_failure_hint(last_error),
            )
            raise image_error(503, "Image temporarily unavailable")
        media_type, _ = mimetypes.guess_type(str(requested))
        if not media_type:
            media_type = {
                ".jpg": "image/jpeg",
                ".jpeg": "image/jpeg",
                ".png": "image/png",
                ".webp": "image/webp",
                ".gif": "image/gif",
                ".svg": "image/svg+xml",
            }.get(requested.suffix.lower(), "application/octet-stream")
        return FileResponse(
            path=str(requested),
            media_type=media_type,
            headers={"Cache-Control": "public, max-age=300"},
        )


__all__ = [
    "image_error",
    "probe_readable",
    "read_failure_hint",
    "serve_file_with_containment",
    "serve_vault_image",
]
