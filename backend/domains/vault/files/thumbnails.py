"""QuickLook thumbnail resolution and streaming."""

from __future__ import annotations

import logging
import os
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import httpx
from fastapi import HTTPException
from fastapi.responses import FileResponse, JSONResponse, Response

from backend.platform.files.base import FilesProvider

log = logging.getLogger(__name__)

THUMB_ROOTS_MAP: dict[str, tuple[str, str | None]] = {
    "images": ("IMAGES", "Images"),
    "raw": ("VAULT", None),
    "assets": ("ASSETS", "Assets"),
}


@dataclass(frozen=True)
class ThumbnailDependencies:
    """Path and provider ports used by the QuickLook adapter."""

    get_path: Callable[[str], Path]
    provider: Callable[[], FilesProvider]
    daemon_url: Callable[[], str]
    daemon_timeout: Callable[[], float]


def resolve_thumb_source(rel_url: str, dependencies: ThumbnailDependencies) -> Path:
    """Resolve and contain one thumbnail source URL."""
    parts = rel_url.split("/", 1)
    if len(parts) != 2 or not parts[1]:
        raise HTTPException(status_code=400, detail="Invalid thumb URL")
    root_key, rel_path = parts
    config = THUMB_ROOTS_MAP.get(root_key)
    if not config:
        raise HTTPException(status_code=400, detail=f"Unknown root '{root_key}'")
    paths_key, vault_subdir = config

    if paths_key in {"IMAGES", "ASSETS"}:
        vault = dependencies.get_path("VAULT")
        if not vault:
            raise HTTPException(status_code=500, detail="VAULT not configured")
        root_dir = vault / str(vault_subdir)
    else:
        root_dir = dependencies.get_path(paths_key)
        if not root_dir:
            raise HTTPException(status_code=500, detail=f"{paths_key} not configured")

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
        raise HTTPException(status_code=404, detail="Source file not found")
    return requested


def container_to_host_path(container_path: Path) -> str | None:
    """Translate a container vault path to the equivalent host path."""
    vault_host = os.environ.get("VAULT_HOST_PATH")
    if not vault_host:
        return None
    try:
        relative = container_path.relative_to("/vault")
    except ValueError:
        vaults_root_host = os.environ.get("VAULTS_ROOT_HOST_PATH")
        if vaults_root_host:
            try:
                relative = container_path.relative_to("/vaults")
                return str(Path(vaults_root_host) / relative)
            except ValueError:
                pass
        resolved = container_path.resolve()
        root = os.environ.get("HOME_HOST_PATH")
        if root and root.rstrip("/"):
            if str(resolved).startswith(str(Path(root).resolve()) + os.sep):
                return str(resolved)
        return None
    return str(Path(vault_host) / relative)


def thumb_no_store(status_code: int, detail: str) -> JSONResponse:
    """Return a thumbnail error that browsers must not cache."""
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers={"Cache-Control": "no-store"},
    )


def _response_body(response: httpx.Response) -> dict[str, object]:
    """Normalize a dynamic daemon response at the adapter boundary."""
    try:
        raw: object = response.json()
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    return {str(key): value for key, value in raw.items()}


async def serve_thumb(
    rel_url: str,
    size: int,
    version: str | None,
    dependencies: ThumbnailDependencies,
) -> Response:
    """Fetch and serve one host-generated QuickLook thumbnail."""
    requested = resolve_thumb_source(rel_url, dependencies)
    try:
        stat_result = requested.stat()
    except OSError as exc:
        log.warning("stat() failed for %s: %s", requested, exc)
        return thumb_no_store(503, "File temporarily unavailable")

    provider = dependencies.provider()
    if provider.is_online_only(requested, stat_result):
        provider.schedule_warmup(requested)
        log.info("☁️ Thumb: warmup en segon pla engegat per %s (503 pending)", requested)
        return thumb_no_store(503, "Thumbnail warming up; retry shortly")

    host_path = container_to_host_path(requested)
    if not host_path:
        raise HTTPException(
            status_code=500,
            detail="VAULT_HOST_PATH not configured or file outside /vault",
        )
    try:
        async with httpx.AsyncClient(timeout=dependencies.daemon_timeout()) as client:
            response = await client.get(
                dependencies.daemon_url(),
                params={"path": host_path, "size": size},
            )
    except Exception as exc:
        log.warning("Thumb daemon inaccessible for %s: %r", requested, exc)
        return thumb_no_store(503, "Thumb daemon unavailable")

    body = _response_body(response)
    if response.status_code != 200:
        log.warning(
            "Thumb daemon HTTP %s for %s: %s",
            response.status_code,
            requested,
            body,
        )
        return thumb_no_store(response.status_code, str(body) or "Thumb daemon error")
    if body.get("status") != "ok":
        return thumb_no_store(500, str(body) or "Thumb daemon error")

    host_thumb_path = body.get("thumb_path")
    if not isinstance(host_thumb_path, str) or not Path(host_thumb_path).is_file():
        return thumb_no_store(500, "Thumb path missing or not readable")

    has_version = version is not None and version != ""
    cache_header = (
        "public, max-age=86400, immutable"
        if has_version
        else "public, max-age=300, must-revalidate"
    )
    return FileResponse(
        path=host_thumb_path,
        media_type="image/png",
        headers={
            "Cache-Control": cache_header,
            "ETag": f'W/"{int(stat_result.st_mtime)}-{size}"',
        },
    )


__all__ = [
    "ThumbnailDependencies",
    "container_to_host_path",
    "resolve_thumb_source",
    "serve_thumb",
    "thumb_no_store",
]
