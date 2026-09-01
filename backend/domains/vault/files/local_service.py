"""Services for local-file tokens, portable links, and physical deletion."""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import os
import re
import urllib.parse
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

from fastapi import HTTPException
from fastapi.responses import FileResponse

from backend.domains.vault.files.property_service import (
    MAX_NUMBERED_ATTEMPTS,
    numbered_candidate,
)
from backend.domains.vault.files.serving import probe_readable
from backend.domains.vault.files.state import LocalLinkStore
from backend.platform.files.base import FilesProvider

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class LocalFileDependencies:
    """Narrow ports used by token registration and streaming."""

    store: LocalLinkStore
    resolve_target: Callable[[str], Path | None]
    materialize: Callable[[Path, str], Awaitable[None]]
    classify_kind: Callable[[str], str]
    get_path: Callable[[str], Path]
    provider: Callable[[], FilesProvider]


@dataclass(frozen=True)
class LinkFileDependencies:
    """Narrow ports used by portable existing-file links."""

    resolve_target: Callable[[str], Path | None]
    materialize: Callable[[Path, str], Awaitable[None]]
    sanitize_filename: Callable[[str], str]
    library_roots: Callable[[Path | None], Sequence[Path]]
    active_vault_path: Callable[[], Path | None]
    get_path: Callable[[str], Path]
    host_home_path: Callable[[], Path]


@dataclass(frozen=True)
class DeleteFileDependencies:
    """Narrow ports used by physical deletion."""

    store: LocalLinkStore
    get_path: Callable[[str], Path]
    expand_host_tilde: Callable[[str], str]
    reroot_attachment: Callable[[str], Path | None]
    move_to_trash: Callable[[str], tuple[bool, str]]


async def register_local_file(
    body: dict[str, object],
    dependencies: LocalFileDependencies,
) -> dict[str, object]:
    """Register one explicitly selected local path and return a stable token."""
    file_path = str(body.get("file_path", "")).strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path is mandatory")
    path = dependencies.resolve_target(file_path)
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    await dependencies.materialize(path, "local-file/register")

    absolute_path = str(path.resolve())
    token = dependencies.store.token_for(absolute_path)
    extension = path.suffix.lower()
    return {
        "token": token,
        "url": (f"/api/vault/local-file/{token}/{urllib.parse.quote(path.name, safe='')}"),
        "name": path.name,
        "size": path.stat().st_size,
        "kind": dependencies.classify_kind(extension),
        "extension": extension,
        "path": absolute_path,
    }


async def serve_local_file(
    token: str,
    filename: str | None,
    dependencies: LocalFileDependencies,
) -> FileResponse:
    """Serve one previously registered local file after containment checks."""
    del filename
    absolute_path = dependencies.store.get(token)
    if not absolute_path:
        raise HTTPException(status_code=404, detail="Local file token not found")
    path = Path(absolute_path)
    if not path.exists() or not path.is_file():
        raise HTTPException(
            status_code=410,
            detail=f"Local file no longer available: {path.name}",
        )

    resolved = path.resolve()
    allowed_roots = [Path(os.environ.get("HOME_HOST_PATH") or str(Path.home())).resolve()]
    try:
        allowed_roots.append(dependencies.get_path("VAULT").resolve())
    except Exception:
        pass
    if not any(resolved.is_relative_to(root) for root in allowed_roots):
        log.warning("Blocked local-file access outside allowed roots: %s", resolved)
        raise HTTPException(status_code=403, detail="File is outside the allowed roots")

    try:
        provider = dependencies.provider()
        stat_result = path.stat()
        if provider.is_online_only(path, stat_result):
            await provider.materialize(path)
            try:
                stat_result = path.stat()
            except OSError as exc:
                log.warning("stat() failed after warmup for %s: %s", path, exc)
                raise HTTPException(
                    status_code=503,
                    detail="Local file temporarily unavailable",
                    headers={"Cache-Control": "no-store, must-revalidate"},
                ) from exc
            if provider.is_online_only(path, stat_result):
                log.warning("☁️ Local file is still online-only after warmup: %s", path)
                raise HTTPException(
                    status_code=503,
                    detail="Local file warmup pending; try again",
                    headers={"Cache-Control": "no-store, must-revalidate"},
                )
    except HTTPException:
        raise
    except Exception as exc:
        log.debug("Proactive warmup failed for %s: %s", path, exc)

    last_error = await probe_readable(path)
    if last_error is not None:
        log.warning("☁️ Local file is unreadable after warmup: %s (%s)", path, last_error)
        raise HTTPException(
            status_code=503,
            detail="Local file temporarily unavailable; try again",
            headers={"Cache-Control": "no-store, must-revalidate"},
        )
    media_type, _ = mimetypes.guess_type(str(path))
    return FileResponse(path=str(path), media_type=media_type)


def _rename_existing_file(
    path: Path,
    target_name: str,
    sanitize_filename: Callable[[str], str],
) -> tuple[Path, bool]:
    """Apply the historical numbered in-place rename when requested."""
    if not target_name:
        return path, False
    new_stem = sanitize_filename(target_name)
    extension = path.suffix
    desired = numbered_candidate(path.parent, new_stem, extension, 1)
    if desired == path:
        return path, False
    if desired.exists():
        desired = path.parent / f"{new_stem}-{uuid.uuid4().hex[:8]}{extension}"
        for index in range(2, MAX_NUMBERED_ATTEMPTS + 1):
            candidate = numbered_candidate(path.parent, new_stem, extension, index)
            if not candidate.exists():
                desired = candidate
                break
    try:
        path.rename(desired)
        return desired, True
    except OSError as exc:
        log.warning(
            "link-existing-file: could not rename %s → %s (%s); linking with the original name.",
            path,
            desired,
            exc,
        )
        return path, False


def _portable_file_url(path: Path, dependencies: LinkFileDependencies) -> str | None:
    """Express one existing file using the first portable legacy form."""
    for root in dependencies.library_roots(dependencies.active_vault_path()):
        try:
            relative = path.relative_to(root)
            return f"/api/vault/library/{str(relative).replace(os.sep, '/')}"
        except Exception:
            continue

    vault_roots = [dependencies.get_path("VAULT")]
    vault_host_path = (os.environ.get("VAULT_HOST_PATH") or "").strip()
    if vault_host_path:
        vault_roots.append(Path(vault_host_path))
    for root in vault_roots:
        try:
            relative = path.relative_to(root)
            return f"/api/vault/raw/{str(relative).replace(os.sep, '/')}"
        except ValueError:
            continue
    try:
        relative = path.relative_to(dependencies.host_home_path())
        return f"~/{str(relative).replace(os.sep, '/')}"
    except ValueError:
        return None


async def link_existing_file(
    body: dict[str, object],
    dependencies: LinkFileDependencies,
) -> dict[str, object]:
    """Link and optionally rename one existing local file."""
    file_path = str(body.get("file_path", "")).strip()
    if not file_path:
        raise HTTPException(status_code=400, detail="file_path is mandatory")
    path = dependencies.resolve_target(file_path)
    if path is None:
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    if not path.is_file():
        raise HTTPException(status_code=400, detail="Path is not a file")
    await dependencies.materialize(path, "link-existing-file")
    path, renamed = _rename_existing_file(
        path,
        str(body.get("target_name", "")).strip(),
        dependencies.sanitize_filename,
    )
    return {
        "path": str(path),
        "url": _portable_file_url(path, dependencies),
        "storage": "absolute",
        "name": path.name,
        "size": path.stat().st_size,
        "renamed": renamed,
    }


@dataclass(frozen=True)
class _DeleteTarget:
    host_path: Path | None = None
    vault_path: Path | None = None
    token_to_clear: str | None = None


def _resolve_delete_target(
    target: str,
    dependencies: DeleteFileDependencies,
) -> _DeleteTarget:
    """Resolve one stored target into either the host or vault namespace."""
    token_match = re.match(r"^/api/vault/local-file/([^/]+)", target)
    if token_match:
        token = token_match.group(1)
        absolute_path = dependencies.store.get(token)
        if not absolute_path:
            raise HTTPException(status_code=404, detail="Local file token not found")
        return _DeleteTarget(host_path=Path(absolute_path), token_to_clear=token)
    if target.lower().startswith("file://"):
        return _DeleteTarget(host_path=Path(urllib.parse.unquote(target[7:])))
    if target.startswith("/api/vault/assets/"):
        vault_path = (
            dependencies.get_path("VAULT").resolve()
            / "Assets"
            / target[len("/api/vault/assets/") :]
        )
        return _DeleteTarget(vault_path=vault_path)
    if target.startswith("Assets/"):
        return _DeleteTarget(vault_path=dependencies.get_path("VAULT").resolve() / target)
    if target.startswith("/api/vault/library/"):
        return _DeleteTarget(
            host_path=dependencies.get_path("LIBRARY")
            / urllib.parse.unquote(target[len("/api/vault/library/") :])
        )
    if target == "~" or target.startswith("~/"):
        return _DeleteTarget(host_path=Path(dependencies.expand_host_tilde(target)))
    if target.startswith("/"):
        return _DeleteTarget(host_path=Path(target))
    return _DeleteTarget(vault_path=dependencies.get_path("VAULT").resolve() / target)


def _reroot_host_target(
    host_path: Path,
    dependencies: DeleteFileDependencies,
) -> Path:
    """Apply the historical cross-machine fallback before containment."""
    try:
        if not host_path.exists():
            rerooted = dependencies.reroot_attachment(str(host_path))
            if rerooted is not None:
                return rerooted
    except OSError:
        pass
    return host_path


def _delete_host_target(
    target: _DeleteTarget,
    dependencies: DeleteFileDependencies,
) -> dict[str, str]:
    """Move one HOME-contained host file to the recoverable Trash."""
    if target.host_path is None:
        raise HTTPException(status_code=400, detail="Invalid path")
    host_path = _reroot_host_target(target.host_path, dependencies)
    try:
        resolved = host_path.expanduser().resolve()
    except OSError as exc:
        raise HTTPException(status_code=400, detail="Invalid path") from exc
    home = Path(os.environ.get("HOME_HOST_PATH") or str(Path.home())).resolve()
    try:
        resolved.relative_to(home)
    except ValueError as exc:
        raise HTTPException(
            status_code=403,
            detail="Refusing to delete a path outside HOME",
        ) from exc
    if not resolved.exists():
        raise HTTPException(
            status_code=404,
            detail=f"File not found: {resolved.name}",
        )
    ok, detail = dependencies.move_to_trash(str(resolved))
    if not ok:
        raise HTTPException(
            status_code=502,
            detail=f"Could not move the file to Trash: {detail}",
        )
    if target.token_to_clear:
        dependencies.store.remove(target.token_to_clear)
    return {"status": "trashed", "method": "macos_trash", "target": str(resolved)}


def _delete_vault_target(
    target: _DeleteTarget,
    dependencies: DeleteFileDependencies,
) -> dict[str, str]:
    """Permanently delete one file strictly contained below Assets."""
    assets_root = (dependencies.get_path("VAULT").resolve() / "Assets").resolve()
    try:
        if target.vault_path is None:
            raise AttributeError("Missing vault path")
        resolved = target.vault_path.resolve()
        resolved.relative_to(assets_root)
    except (ValueError, AttributeError, OSError) as exc:
        raise HTTPException(
            status_code=400,
            detail="Path no és sota Assets ni sota HOME",
        ) from exc
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        resolved.unlink()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not delete: {exc}") from exc
    return {"status": "deleted", "method": "vault_unlink", "target": str(resolved)}


async def delete_physical_file(
    body: dict[str, object],
    dependencies: DeleteFileDependencies,
) -> dict[str, str]:
    """Delete one HOME or Assets-contained file by its stored target value."""
    target_value = str(body.get("target", "")).strip()
    if not target_value:
        raise HTTPException(status_code=400, detail="target is mandatory")
    target = _resolve_delete_target(target_value, dependencies)
    if target.host_path is not None:
        return _delete_host_target(target, dependencies)
    return _delete_vault_target(target, dependencies)


__all__ = [
    "DeleteFileDependencies",
    "LinkFileDependencies",
    "LocalFileDependencies",
    "delete_physical_file",
    "link_existing_file",
    "register_local_file",
    "serve_local_file",
]
