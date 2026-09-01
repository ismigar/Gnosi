"""HTTP adapters and route registration for vault file workflows."""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, Query, UploadFile
from fastapi.params import Depends as DependsParameter
from fastapi.responses import FileResponse, Response

from backend.domains.vault.files import host_trash, local_service, property_service
from backend.domains.vault.files.serving import serve_file_with_containment
from backend.domains.vault.files.state import FileServingState, LocalLinkStore
from backend.domains.vault.files.thumbnails import (
    ThumbnailDependencies,
    container_to_host_path,
    resolve_thumb_source,
    serve_thumb as serve_thumb_service,
    thumb_no_store,
)
from backend.platform.files.base import FilesProvider

Metadata = dict[str, Any]


@dataclass(frozen=True)
class FileApiDependencies:
    """File services composed by the legacy vault router."""

    get_path: Callable[[str], Path]
    active_vault_path: Callable[[], Path]
    library_roots: Callable[[Path], Sequence[Path]]
    provider: Callable[[], FilesProvider]
    serving_state: FileServingState
    local_files: local_service.LocalFileDependencies
    link_files: local_service.LinkFileDependencies
    delete_files: local_service.DeleteFileDependencies
    property_files: property_service.PropertyFileDependencies
    thumbnails: ThumbnailDependencies


_dependencies: FileApiDependencies | None = None


def configure(dependencies: FileApiDependencies) -> None:
    """Configure the file adapter once from the composition facade."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Vault file API is already configured")
    _dependencies = dependencies


def _deps() -> FileApiDependencies:
    if _dependencies is None:
        raise RuntimeError("Vault file API has not been configured")
    return _dependencies


async def _serve_file_with_containment(root_dir: Path, rel_path: str) -> FileResponse:
    """Compatibility adapter for contained file streaming."""
    return await serve_file_with_containment(
        root_dir,
        rel_path,
        state=_deps().serving_state,
        provider=_deps().provider(),
    )


def _resolve_thumb_source(rel_url: str) -> Path:
    """Compatibility adapter for thumbnail source resolution."""
    return resolve_thumb_source(rel_url, _deps().thumbnails)


def _container_to_host_path(container_path: Path) -> str | None:
    """Compatibility adapter for host path translation."""
    return container_to_host_path(container_path)


def _thumb_no_store(status_code: int, detail: str) -> Response:
    """Compatibility adapter for non-cacheable thumbnail errors."""
    return thumb_no_store(status_code, detail)


def _local_links_file() -> Path:
    """Return the canonical local-link mapping path."""
    return _deps().local_files.store.path()


def _load_local_links() -> dict[str, str]:
    """Return a synchronized local-link snapshot."""
    return _deps().local_files.store.snapshot()


def _save_local_links(mapping: Mapping[str, str]) -> None:
    """Persist a complete local-link mapping."""
    _deps().local_files.store.replace(mapping)


def _normalize_storage_folder(storage_folder: str) -> str:
    return property_service.normalize_storage_folder(storage_folder)


def _effective_storage_folder(configured_storage: str, requested_storage: str) -> str:
    return property_service.effective_storage_folder(
        configured_storage,
        requested_storage,
    )


def _resolve_storage_dir(
    storage_folder: str,
    table: Metadata | None,
    database: Metadata | None,
    property_name: str,
    dest_folder: str = "",
) -> tuple[Path, str]:
    return property_service.resolve_storage_dir(
        storage_folder,
        table,
        database,
        property_name,
        dest_folder,
        _deps().property_files,
    )


def _numbered_candidate(directory: Path, stem: str, ext: str, index: int) -> Path:
    return property_service.numbered_candidate(directory, stem, ext, index)


def _save_uploaded_file_to_dir(
    upload: UploadFile,
    target_dir: Path,
    target_name: str = "",
) -> Path:
    return property_service.save_uploaded_file_to_dir(
        upload,
        target_dir,
        target_name,
        _deps().property_files,
    )


async def serve_library_file(rel_path: str) -> FileResponse:
    """Serves Library with vault-first resolution and fallback to the legacy (sibling) one:
    old `/api/vault/library/<rel>` links keep working even if the
    vault has its own Library, and vice versa."""
    roots = _deps().library_roots(_deps().active_vault_path())
    for root in roots[:-1]:
        try:
            if (root / rel_path).exists():
                return await _serve_file_with_containment(root, rel_path)
        except OSError:
            continue
    return await _serve_file_with_containment(roots[-1], rel_path)


async def serve_vault_raw_file(rel_path: str) -> FileResponse:
    """Serves any file under VAULT/ with containment check.

    Used by the multi-root media picker when `root=vault`. The frontend may
    receive URLs like `/api/vault/raw/Assets/Inline/foo.png` or
    `/api/vault/raw/Wiki/notes/img.jpg`. Containment is checked against
    VAULT, so paths cannot escape the vault.
    """
    return await _serve_file_with_containment(_deps().get_path("VAULT"), rel_path)


async def serve_thumb(
    rel_url: str,
    size: int = 256,
    v: str | None = None,
) -> Response:
    """Serves a PNG thumbnail generated by QuickLook (macOS) for
    non-image files (video, PDF, audio...).

    The `rel_url` URL follows the same scheme as the file endpoints
    for roots that live inside /vault: `raw/...`,
    `images/...`, `assets/...`. Size clamped to [64, 1024] in the daemon.

    Query param `v` (version, typically mtime): if the frontend passes it,
    we cache with `immutable` since the URL will change when the source
    file changes. Without `v`, we use a short cache + must-revalidate so the
    browser doesn't keep a stale thumb until the next day.

    """
    return await serve_thumb_service(rel_url, size, v, _deps().thumbnails)


async def register_local_file(body: dict[str, object]) -> dict[str, object]:
    """Registers an absolute path and returns a token + servable URL.

    Body: { "file_path": "/abs/path/to/file" }
    Response: { "token": "...", "url": "/api/vault/local-file/<token>",
                "name": "...", "size": N, "kind": "image|video|pdf|..." }

    If the same path is already registered, we reuse the token: this way if
    the user registers the same file twice we don't accumulate entries.

    """
    return await local_service.register_local_file(body, _deps().local_files)


async def serve_local_file(
    token: str,
    filename: str | None = None,
) -> FileResponse:
    """Serves a file registered via /local-file/register.

    The optional `{filename}` segment is decorative (the lookup is by `token`):
    it allows the saved URL to carry a real name + extension so the frontend
    can show the name and detect the type. Both forms are accepted for
    compatibility with old URLs without a name.

    If the token doesn't exist → 404. If the path is no longer accessible (the user
    has moved/deleted the file) → 410 Gone so the UI can distinguish it
    from a never-registered token.

    If the file is online-only on OneDrive (typical for documents linked
    from `~/Library/CloudStorage/...`), we ask the provider to
    materialize it before doing the `FileResponse`. Without this, FastAPI sends
    the headers (200 OK) and when it tries to stream the content it crashes with
    Errno 35 (Resource deadlock avoided) mid-stream → the UI receives a
    truncated response and the browser doesn't open the file.

    """
    return await local_service.serve_local_file(
        token,
        filename,
        _deps().local_files,
    )


async def upload_property_file(
    table_id: str = Query(...),
    property_name: str = Query(...),
    storage_folder: str = Query(default="assets"),
    target_name: str = Query(default=""),
    file: UploadFile = File(...),
    dest_folder: str = Form(default=""),
) -> dict[str, object]:
    """Upload a file for a property. Routes to Assets/, Library/ or a free path
    depending on the storage_folder parameter (assets | library | free).

    `target_name` (optional): base name already interpolated from the field's pattern
    (e.g. "Authors - Year - Title"). If provided, the file is saved with
    this name (sanitized) + the original extension.

    `dest_folder` (only for storage_folder='free'): absolute host directory the
    user picked for THIS attachment."""
    return await property_service.upload_property_file(
        table_id=table_id,
        property_name=property_name,
        storage_folder=storage_folder,
        target_name=target_name,
        file=file,
        dest_folder=dest_folder,
        dependencies=_deps().property_files,
    )


async def link_existing_file(body: dict[str, object]) -> dict[str, object]:
    """Variant B: register an existing local file path without copying it.

    Body: { "file_path": "/absolute/path/to/file.pdf", "target_name": "..." }
    Returns the path and a display name.

    If `target_name` (an already-interpolated name pattern) is provided, the file is
    RENAMED on disk within the same folder (Zotero-style), preserving
    the extension and avoiding collisions. Warning: if the file is a linked
    attachment from Zotero, renaming it will break the link to Zotero.

    """
    return await local_service.link_existing_file(body, _deps().link_files)


async def delete_physical_file(body: dict[str, object]) -> dict[str, str]:
    """Deletes the physical file referenced by `target` (does not touch any page).

    `target` is the value saved in the `files` field: `file://…`,
    `/api/vault/local-file/<token>[/nom]`, `/api/vault/assets/<rel>` or `Assets/<rel>`.

    - Files under HOME (OneDrive/Library, via file:// or token): delegated to the
      host_open_helper, which moves them to the Mac's TRASH (recoverable). The HOME
      mount in the container is read-only, so the backend cannot delete them.
    - Files under Assets (inside the vault, rw): deleted in the container (permanent).

    Containment: only under the host's HOME or under the vault's Assets. Never outside.

    """
    return await local_service.delete_physical_file(body, _deps().delete_files)


def register_serving_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
) -> None:
    """Register library, raw, thumbnail, and local-file routes in legacy order."""
    protected = list(editor_dependencies)
    router.add_api_route(
        "/library/{rel_path:path}",
        serve_library_file,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/raw/{rel_path:path}",
        serve_vault_raw_file,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/thumb/{rel_url:path}",
        serve_thumb,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/local-file/register",
        register_local_file,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )
    # Decorators were historically applied bottom-up: named route first.
    router.add_api_route(
        "/local-file/{token}/{filename:path}",
        serve_local_file,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/local-file/{token}",
        serve_local_file,
        methods=["GET"],
        response_model=None,
    )


def register_property_routes(
    router: APIRouter,
    *,
    editor_dependencies: Sequence[DependsParameter],
) -> None:
    """Register upload, existing-link, and physical-delete routes."""
    protected = list(editor_dependencies)
    router.add_api_route(
        "/upload-property-file",
        upload_property_file,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )
    router.add_api_route(
        "/link-existing-file",
        link_existing_file,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )
    router.add_api_route(
        "/delete-physical-file",
        delete_physical_file,
        methods=["POST"],
        dependencies=protected,
        response_model=None,
    )


__all__ = [
    "FileApiDependencies",
    "_container_to_host_path",
    "_effective_storage_folder",
    "_load_local_links",
    "_local_links_file",
    "_normalize_storage_folder",
    "_numbered_candidate",
    "_resolve_storage_dir",
    "_resolve_thumb_source",
    "_save_local_links",
    "_save_uploaded_file_to_dir",
    "_serve_file_with_containment",
    "_thumb_no_store",
    "configure",
    "delete_physical_file",
    "link_existing_file",
    "register_local_file",
    "register_property_routes",
    "register_serving_routes",
    "serve_library_file",
    "serve_local_file",
    "serve_thumb",
    "serve_vault_raw_file",
    "upload_property_file",
]
