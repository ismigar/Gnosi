"""Contained and cloud-aware vault file streaming."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
import stat
import urllib.parse
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse
from starlette.types import Receive, Scope, Send

from backend.domains.vault.files.state import FileServingState
from backend.platform.files.base import FilesProvider
from backend.platform.files.snapshots import revision
from backend.utils.metadata_io import VaultFileSnapshot, is_native_vault_file, vault_file_snapshot_async

log = logging.getLogger(__name__)

_NO_STORE_HEADERS = {"Cache-Control": "no-store, must-revalidate"}


class _SnapshotFileResponse(FileResponse):
    """Keep the coordinated copy alive until Starlette finishes sending the body."""

    def __init__(
        self, snapshot: VaultFileSnapshot, media_type: str, headers: dict[str, str] | None
    ) -> None:
        super().__init__(
            path=str(snapshot.path), stat_result=snapshot.stat_result, media_type=media_type,
            headers=headers,
        )
        self.snapshot = snapshot

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            # A server accepting pathsend can open the path after send() returns.
            # Stream this private copy here so its lifetime covers every read.
            extensions = scope.get("extensions", {})
            if "http.response.pathsend" in extensions:
                scope = dict(scope, extensions={
                    key: value for key, value in extensions.items() if key != "http.response.pathsend"
                })
            await super().__call__(scope, receive, send)
        finally:
            self.snapshot.close()


async def serve_snapshot(
    path: Path, root: Path, *, headers: dict[str, str] | None = None,
    expected_stat: os.stat_result | None = None,
) -> FileResponse:
    """Serve the selected source's MIME type and validators from one coordinated read."""
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    snapshot = await vault_file_snapshot_async(path, root=root)
    try:
        if expected_stat is not None and (not snapshot.is_private or revision(expected_stat) != revision(snapshot.stat_result)):
            raise HTTPException(status_code=404, detail="Requested file revision is unavailable")
        return _SnapshotFileResponse(snapshot, media_type, headers)
    except BaseException:
        snapshot.close()
        raise


def image_error(
    status: int,
    detail: str,
    retry_after: int | None = None,
    availability: str | None = None,
) -> HTTPException:
    """Create a non-cacheable image error response."""
    headers = _NO_STORE_HEADERS
    if retry_after is not None:
        headers = {**_NO_STORE_HEADERS, "Retry-After": str(retry_after)}
    if availability is not None:
        headers = {**headers, "X-Gnosi-File-Availability": availability}
    return HTTPException(status_code=status, detail=detail, headers=headers)


def schedule_image_download(provider: FilesProvider, path: Path) -> HTTPException:
    """Report queued downloads separately from a completed, failed attempt."""
    if provider.warmup_status(path) == "failed":
        return image_error(
            503, "Image download failed; try again", retry_after=30, availability="failed"
        )
    provider.schedule_warmup(path)
    return image_error(
        503, "Image warming up; retry shortly", retry_after=3, availability="pending"
    )


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
    def read_one_byte() -> None:
        with path.open("rb") as file_handle:
            file_handle.read(1)

    last_error: OSError | None = None
    for attempt in range(5):
        try:
            await asyncio.to_thread(read_one_byte)
            return None
        except OSError as exc:
            last_error = exc
            if exc.errno == 35 and attempt < 4:
                await asyncio.sleep(0.2 * (2**attempt))
                continue
            break
    return last_error


def _inspect_contained_file(root_dir: Path, rel_path: str) -> tuple[Path, Path, os.stat_result]:
    """Resolve the selected root and inspect a regular file off the event loop."""
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

    try:
        stat_result = requested.stat()
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail="File not found") from exc
    except OSError as exc:
        log.warning("stat() failed for %s: %s", requested, exc)
        raise HTTPException(status_code=503, detail="File temporarily unavailable") from exc
    if not stat.S_ISREG(stat_result.st_mode):
        raise HTTPException(status_code=404, detail="File not found")
    return root_resolved, requested, stat_result


async def serve_file_with_containment(
    root_dir: Path,
    rel_path: str,
    *,
    state: FileServingState,
    provider: FilesProvider,
) -> FileResponse:
    """Serve one path contained below an explicitly selected root."""
    root_resolved, requested, stat_result = await asyncio.to_thread(_inspect_contained_file, root_dir, rel_path)
    if is_native_vault_file(requested, stat_result, provider=provider):
        async with state.semaphore:
            return await serve_snapshot(
                requested, root_resolved, headers={"Cache-Control": "public, max-age=300"}
            )
    if stat_result.st_size == 0:
        raise HTTPException(
            status_code=404,
            detail="File is an empty placeholder (OneDrive)",
        )

    media_type, _ = mimetypes.guess_type(str(requested))
    if provider.is_online_only(requested, stat_result):
        if media_type and media_type.startswith("image/"):
            raise schedule_image_download(provider, requested)
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
            if (
                last_error.errno in (11, 35)
                and provider.name != "local"
                and media_type
                and media_type.startswith("image/")
            ):
                raise schedule_image_download(provider, requested)
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


def _inspect_vault_image(
    vault_path: Path,
    image_path: str,
    provider: FilesProvider,
) -> tuple[Path, os.stat_result, bool, bool]:
    """Contain and inspect one image in a worker, including provider metadata."""
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
        if not str(requested).startswith(str(image_root) + os.sep):
            log.warning("⛔ Fallback startswith: access denied for %s", requested)
            raise image_error(403, "Access denied")

    try:
        stat_result = requested.stat()
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise image_error(404, "Image not found") from exc
    except OSError as exc:
        log.warning("stat() failed for %s: %s", requested, exc)
        raise image_error(503, "Image temporarily unavailable") from exc
    if not stat.S_ISREG(stat_result.st_mode):
        raise image_error(404, "Image not found")
    native = is_native_vault_file(requested, stat_result, provider=provider)
    if stat_result.st_size == 0 and not native:
        log.warning(
            "☁️ Placeholder file detected (0 bytes): %s. Download it from OneDrive.", requested
        )
        raise image_error(404, "Image is an empty placeholder (OneDrive)")

    return requested, stat_result, native, not native and provider.is_online_only(requested, stat_result)


async def serve_vault_image(
    vault_path: Path,
    image_path: str,
    *,
    state: FileServingState,
    provider: FilesProvider,
) -> FileResponse:
    """Serve an image without blocking other routes on FileProvider metadata."""
    async with state.semaphore:
        requested, stat_result, native, online_only = await asyncio.to_thread(
            _inspect_vault_image, vault_path, image_path, provider
        )
        if native:
            return await serve_snapshot(
                requested, vault_path / "Images", headers={"Cache-Control": "public, max-age=300"}
            )
        if online_only:
            raise schedule_image_download(provider, requested)
        last_error = await probe_readable(requested)
        if last_error is not None:
            if last_error.errno in (11, 35) and provider.name != "local":
                raise schedule_image_download(provider, requested)
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
            stat_result=stat_result,
            headers={"Cache-Control": "public, max-age=300"},
        )


__all__ = [
    "image_error",
    "probe_readable",
    "read_failure_hint",
    "serve_file_with_containment",
    "serve_vault_image",
]
