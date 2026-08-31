"""Typed Vault domain extracted from the historical route facade."""

import asyncio
import logging
import os
from pathlib import Path

import requests
from fastapi import BackgroundTasks, Body, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from backend.api.vault_routes import router as router
from backend.config.env_config import default_thumb_daemon_url as _default_thumb_daemon_url
from backend.domains.vault.api import pages_duplicate as _page_duplicate_api
from backend.domains.vault.assets import api as _assets_api
from backend.domains.vault.files import api as _files_api
from backend.domains.vault.files import property_service as _property_file_service
from backend.domains.vault.files import serving as _file_serving
from backend.domains.vault.files import thumbnails as _file_thumbnails
from backend.domains.vault.files.state import file_serving_state as _file_serving_state
from backend.domains.vault.media.composition import (
    duplicate_dependencies as _duplicate_dependencies,
)
from backend.domains.vault.media.composition import media_service as _media_service
from backend.domains.vault.media.composition import vault as _vault
from backend.domains.vault.media.contracts import (
    MediaMutation,
    PickedFile,
    PickedFolder,
    UnsplashSearch,
)
from backend.domains.vault.media.schemas import (
    MediaItemResponse,
    MediaMutationResponse,
    MediaPageResponse,
    MediaRootResponse,
    MediaTreeNodeResponse,
    MediaViewInput,
    MediaViewResponse,
)
from backend.domains.vault.media.unsplash_payload import search_payload as _search_payload
from backend.services.workspace_service import require_role as _require_role
from backend.utils.errors import safe_error_detail as _safe_error_detail

_log = logging.getLogger("backend.api.vault_routes")
_VALID_MEDIA_ROOTS = {"images", "assets", "library", "vault"}


class UnsplashPhotoResponse(BaseModel):
    id: str
    url: str
    thumb: str
    author: str
    author_url: str


class UnsplashSearchResponse(BaseModel):
    results: list[UnsplashPhotoResponse]
    total_pages: int


def _validate_root(root: str) -> str:
    if root not in _VALID_MEDIA_ROOTS:
        raise HTTPException(status_code=400, detail=f"Root invàlid: {root!r}")
    return root


@router.get("/media/roots", response_model=list[MediaRootResponse])
async def get_media_roots() -> list[dict[str, object]]:
    """Returns the roots available for media search (Images, Assets,
    Library, Vault). Each element indicates `available` based on whether the folder
    currently exists on disk."""
    return _media_service().get_roots()


@router.get("/media", response_model=MediaPageResponse)
async def get_all_media(
    album: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    root: str = Query("images"),
    kinds: str | None = Query(None, description="csv: image,video,audio,pdf,other"),
    extensions: str | None = Query(None, description="csv sense punt: jpg,png,..."),
    q: str | None = Query(None, description="substring sobre filename"),
    desc_contains: str | None = Query(None, description="substring sobre descripció"),
    tags_any: str | None = Query(None, description="csv de tags (OR)"),
    tags_all: str | None = Query(None, description="csv de tags (AND)"),
    tags_none: str | None = Query(None, description="csv de tags (NOT)"),
    size_min: int | None = Query(None, ge=0, description="KB"),
    size_max: int | None = Query(None, ge=0, description="KB"),
    mtime_from: str | None = Query(None, description="ISO date"),
    mtime_to: str | None = Query(None, description="ISO date"),
    sort: str = Query("mtime", description="mtime|filename|size|kind"),
    dir: str = Query("desc", description="asc|desc"),
) -> dict[str, object]:
    """Lists media, optionally filtered by album and root folder.
    The default root is `images` for back-compat with the historical gallery.

    EXIF filters (date_taken, has_gps) are NOT available in this phase
    (F1). They're left for F2 with a persisted EXIF index. Sorting by `date_taken`
    isn't viable yet either — `sort=mtime` is the reasonable fallback.

    """
    _validate_root(root)
    if sort not in {"mtime", "filename", "size", "kind"}:
        raise HTTPException(status_code=400, detail=f"sort invàlid: {sort!r}")
    if dir not in {"asc", "desc"}:
        raise HTTPException(status_code=400, detail=f"dir invàlid: {dir!r}")
    return _media_service().get_all_media(
        album,
        limit=limit,
        offset=offset,
        root=root,
        kinds=kinds,
        extensions=extensions,
        q=q,
        desc_contains=desc_contains,
        tags_any=tags_any,
        tags_all=tags_all,
        tags_none=tags_none,
        size_min=size_min,
        size_max=size_max,
        mtime_from=mtime_from,
        mtime_to=mtime_to,
        sort=sort,
        dir_=dir,
    )


@router.get("/media/albums", response_model=None)
async def get_albums() -> list[str]:
    """Returns the list of top-level albums. Compat: the new frontend
    uses /media/tree for hierarchical navigation."""
    return _media_service().get_albums()


@router.get("/media/tree", response_model=list[MediaTreeNodeResponse])
async def get_media_tree(
    path: str | None = Query(None), root: str = Query("images")
) -> list[dict[str, object]]:
    """Returns the immediate subfolders of `<root>/path` (lazy). Each node
    includes `has_children` so the UI can draw the chevron without having to
    load the whole tree (the archive has ~33k directories).
    For root="vault" it excludes system folders (.git, BD, .gnosi, etc.).

    """
    _validate_root(root)
    return _media_service().get_tree_node(path, root=root)


@router.post(
    "/media/upload",
    dependencies=[Depends(_require_role("editor"))],
    response_model=MediaItemResponse,
)
async def upload_media(
    file: UploadFile = File(...),
    album: str = Query("General"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> dict[str, object]:
    """Uploads a media file to an album."""
    result = _media_service().upload_media(file, album)
    return result


@router.patch(
    "/media/metadata",
    dependencies=[Depends(_require_role("editor"))],
    response_model=MediaMutationResponse,
)
async def update_media_metadata(
    metadata: dict[str, object] = Body(..., description="{tags?: string[], description?: string}"),
    path_in_root: str | None = Body(None, description="Path relative to the root (preferred)"),
    root: str = Body("images"),
    filename: str | None = Body(None),
    album: str | None = Body(None),
) -> MediaMutation:
    """Updates tags and/or description of a MediaCenter file.

    The preferred payload is `{root, path_in_root, metadata}`. The old
    form `{filename, album, metadata}` is kept for compatibility with clients that
    don't yet send `path_in_root`; in this case the path is reconstructed
    as `{album}/{filename}`.

    """
    _validate_root(root)
    resolved = path_in_root
    if not resolved:
        if not filename:
            raise HTTPException(status_code=400, detail="`path_in_root` or `filename` is required")
        resolved = f"{album}/{filename}" if album else filename
    success = _media_service().update_metadata(resolved, metadata, root=root)
    if not success:
        raise HTTPException(status_code=500, detail="Persistence error")
    return {"status": "ok"}


@router.get("/media/views", response_model=list[MediaViewResponse])
async def list_media_views() -> list[dict[str, object]]:
    """Returns the user's saved views (JSON sidecar in the vault)."""
    return _media_service().list_views()


@router.post(
    "/media/views",
    dependencies=[Depends(_require_role("editor"))],
    response_model=MediaViewResponse,
)
async def create_media_view(payload: MediaViewInput) -> dict[str, object]:
    """Creates a new view. Payload: {label, scope, filters, sort}."""
    try:
        return _media_service().create_view(payload.model_dump())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch(
    "/media/views/{view_id}",
    dependencies=[Depends(_require_role("editor"))],
    response_model=MediaViewResponse,
)
async def update_media_view(view_id: str, payload: MediaViewInput) -> dict[str, object]:
    """Updates an existing view."""
    updated = _media_service().update_view(view_id, payload.model_dump())
    if updated is None:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    return updated


@router.delete(
    "/media/views/{view_id}",
    dependencies=[Depends(_require_role("editor"))],
    response_model=MediaMutationResponse,
)
async def delete_media_view(view_id: str) -> MediaMutation:
    """Deletes a view."""
    if not _media_service().delete_view(view_id):
        raise HTTPException(status_code=404, detail="Vista no trobada")
    return {"status": "ok"}


_VAULT_IMAGE_SEMAPHORE = _file_serving_state.semaphore
_NO_STORE_HEADERS = {"Cache-Control": "no-store, must-revalidate"}


def _image_error(status: int, detail: str, retry_after: int | None = None) -> HTTPException:
    return _file_serving.image_error(status, detail, retry_after)


def _onedrive_read_failure_hint(err: OSError) -> str:
    return _file_serving.read_failure_hint(err)


_assets_api.register_image_route(router)
serve_vault_image = _assets_api.serve_vault_image


async def _serve_file_with_containment(root_dir: Path, rel_path: str) -> FileResponse:
    return await _files_api._serve_file_with_containment(root_dir, rel_path)


_files_api.register_serving_routes(router, editor_dependencies=[Depends(_require_role("editor"))])
serve_library_file = _files_api.serve_library_file
serve_vault_raw_file = _files_api.serve_vault_raw_file
serve_thumb = _files_api.serve_thumb
register_local_file = _files_api.register_local_file
serve_local_file = _files_api.serve_local_file
_THUMB_DAEMON_URL = _default_thumb_daemon_url()
_THUMB_DAEMON_TIMEOUT = float(os.environ.get("THUMB_DAEMON_TIMEOUT", "45"))
_THUMB_ROOTS_MAP = _file_thumbnails.THUMB_ROOTS_MAP


def _resolve_thumb_source(rel_url: str) -> Path:
    return _files_api._resolve_thumb_source(rel_url)


def _container_to_host_path(container_path: Path) -> str | None:
    return _files_api._container_to_host_path(container_path)


def _thumb_no_store(status_code: int, detail: str) -> Response:
    return _files_api._thumb_no_store(status_code, detail)


_LOCAL_LINKS_LOCK = _vault._LOCAL_LINK_STORE.lock


def _local_links_file() -> Path:
    return _files_api._local_links_file()


def _load_local_links() -> dict[str, str]:
    return _files_api._load_local_links()


def _save_local_links(mapping: dict[str, str]) -> None:
    _files_api._save_local_links(mapping)


_assets_api.register_custom_icon_routes(
    router, editor_dependencies=[Depends(_require_role("editor"))]
)
get_custom_icons = _assets_api.get_custom_icons
save_custom_icons = _assets_api.save_custom_icons
_STORAGE_FOLDER_ALIASES = _property_file_service.STORAGE_FOLDER_ALIASES


def _normalize_storage_folder(storage_folder: str) -> str:
    return _files_api._normalize_storage_folder(storage_folder)


def _effective_storage_folder(configured_storage: str, requested_storage: str) -> str:
    return _files_api._effective_storage_folder(configured_storage, requested_storage)


def _resolve_storage_dir(
    storage_folder: str,
    table: dict[str, object] | None,
    database: dict[str, object] | None,
    property_name: str,
    dest_folder: str = "",
) -> tuple[Path, str]:
    return _files_api._resolve_storage_dir(
        storage_folder, table, database, property_name, dest_folder
    )


def _file_response_payload(dest_path: Path, url_prefix_type: str) -> dict[str, object]:
    return _property_file_service.file_response_payload(
        dest_path, url_prefix_type, _vault._PROPERTY_FILE_DEPENDENCIES
    )


_files_api.register_property_routes(router, editor_dependencies=[Depends(_require_role("editor"))])
upload_property_file = _files_api.upload_property_file
link_existing_file = _files_api.link_existing_file
delete_physical_file = _files_api.delete_physical_file


def _numbered_candidate(directory: Path, stem: str, ext: str, index: int) -> Path:
    return _files_api._numbered_candidate(directory, stem, ext, index)


_MAX_NUMBERED_ATTEMPTS = _property_file_service.MAX_NUMBERED_ATTEMPTS


def _save_uploaded_file_to_dir(upload: UploadFile, target_dir: Path, target_name: str = "") -> Path:
    return _files_api._save_uploaded_file_to_dir(upload, target_dir, target_name)


def _run_osascript_picker(script: str) -> str:
    """Sync helper for use with asyncio.to_thread."""
    import subprocess

    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=60)
    return result.stdout.strip()


@router.post(
    "/pick-folder",
    dependencies=[Depends(_require_role("editor"))],
    response_model=None,
)
async def pick_folder() -> PickedFolder:
    """Open a native macOS folder-picker dialog and return the chosen path."""
    import asyncio as _asyncio
    import subprocess

    script = (
        'tell application "System Events"\n  activate\nend tell\n'
        'set chosen to choose folder with prompt "Selecciona la carpeta de destinació"\n'
        "return POSIX path of chosen"
    )
    try:
        chosen = await _asyncio.to_thread(_run_osascript_picker, script)
        if not chosen:
            raise HTTPException(status_code=204, detail="No folder selected")
        return {"path": chosen}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Folder picker timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error_detail(e, "POST /pick-folder"))


@router.post(
    "/pick-file",
    dependencies=[Depends(_require_role("editor"))],
    response_model=None,
)
async def pick_file() -> PickedFile:
    """Open a native macOS file-picker dialog and return the chosen file path."""
    import asyncio as _asyncio
    import subprocess

    script = (
        'tell application "System Events"\n  activate\nend tell\n'
        'set chosen to choose file with prompt "Select the file to link"\n'
        "return POSIX path of chosen"
    )
    try:
        chosen = await _asyncio.to_thread(_run_osascript_picker, script)
        if not chosen:
            raise HTTPException(status_code=204, detail="No file selected")
        p = Path(chosen)
        return {"path": chosen, "name": p.name, "size": p.stat().st_size if p.exists() else 0}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="File picker timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=_safe_error_detail(e, "POST /pick-file"))


@router.get("/unsplash/search", response_model=UnsplashSearchResponse)
async def unsplash_search(query: str = Query(...), page: int = Query(1)) -> UnsplashSearch:
    """Searches images on Unsplash acting as a proxy."""
    unsplash_key = os.getenv("UNSPLASH_ACCESS_KEY")
    if not unsplash_key:
        raise HTTPException(
            status_code=500,
            detail="Unsplash API Key is not configured in .env (UNSPLASH_ACCESS_KEY)",
        )
    url = "https://api.unsplash.com/search/photos"
    headers = {"Authorization": f"Client-ID {unsplash_key}"}
    params: dict[str, str | int] = {
        "query": query,
        "page": page,
        "per_page": 21,
        "orientation": "landscape",
    }
    try:
        resp = await asyncio.to_thread(
            requests.get, url, headers=headers, params=params, timeout=10
        )
        resp.raise_for_status()
        data: object = resp.json()
        return _search_payload(data)
    except Exception as e:
        _log.error(f"Error fetching from Unsplash: {e}")
        raise HTTPException(status_code=502, detail="Error fetching from Unsplash API")


_page_duplicate_api.configure(_duplicate_dependencies())
_page_duplicate_api.register_routes(router, editor_dependencies=[Depends(_require_role("editor"))])
duplicate_page = _page_duplicate_api.duplicate_page
