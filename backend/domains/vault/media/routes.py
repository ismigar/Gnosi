"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")
_VALID_MEDIA_ROOTS = {"images", "assets", "library", "vault"}


def _validate_root(root: str) -> str:
    if root not in _VALID_MEDIA_ROOTS:
        raise _legacy.HTTPException(status_code=400, detail=f"Root invàlid: {root!r}")
    return root


@_legacy.router.get("/media/roots", response_model=None)
async def get_media_roots() -> _LegacyAny:
    """Returns the roots available for media search (Images, Assets,
    Library, Vault). Each element indicates `available` based on whether the folder
    currently exists on disk."""
    return _legacy.media_service.get_roots()


@_legacy.router.get("/media", response_model=None)
async def get_all_media(
    album: str | None = _legacy.Query(None),
    limit: int = _legacy.Query(50, ge=1, le=500),
    offset: int = _legacy.Query(0, ge=0),
    root: str = _legacy.Query("images"),
    kinds: str | None = _legacy.Query(None, description="csv: image,video,audio,pdf,other"),
    extensions: str | None = _legacy.Query(None, description="csv sense punt: jpg,png,..."),
    q: str | None = _legacy.Query(None, description="substring sobre filename"),
    desc_contains: str | None = _legacy.Query(None, description="substring sobre descripció"),
    tags_any: str | None = _legacy.Query(None, description="csv de tags (OR)"),
    tags_all: str | None = _legacy.Query(None, description="csv de tags (AND)"),
    tags_none: str | None = _legacy.Query(None, description="csv de tags (NOT)"),
    size_min: int | None = _legacy.Query(None, ge=0, description="KB"),
    size_max: int | None = _legacy.Query(None, ge=0, description="KB"),
    mtime_from: str | None = _legacy.Query(None, description="ISO date"),
    mtime_to: str | None = _legacy.Query(None, description="ISO date"),
    sort: str = _legacy.Query("mtime", description="mtime|filename|size|kind"),
    dir: str = _legacy.Query("desc", description="asc|desc"),
) -> _LegacyAny:
    """Lists media, optionally filtered by album and root folder.
    The default root is `images` for back-compat with the historical gallery.

    EXIF filters (date_taken, has_gps) are NOT available in this phase
    (F1). They're left for F2 with a persisted EXIF index. Sorting by `date_taken`
    isn't viable yet either — `sort=mtime` is the reasonable fallback.

    """
    _validate_root(root)
    if sort not in {"mtime", "filename", "size", "kind"}:
        raise _legacy.HTTPException(status_code=400, detail=f"sort invàlid: {sort!r}")
    if dir not in {"asc", "desc"}:
        raise _legacy.HTTPException(status_code=400, detail=f"dir invàlid: {dir!r}")
    return _legacy.media_service.get_all_media(
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


@_legacy.router.get("/media/albums", response_model=None)
async def get_albums() -> _LegacyAny:
    """Returns the list of top-level albums. Compat: the new frontend
    uses /media/tree for hierarchical navigation."""
    return _legacy.media_service.get_albums()


@_legacy.router.get("/media/tree", response_model=None)
async def get_media_tree(
    path: str | None = _legacy.Query(None), root: str = _legacy.Query("images")
) -> _LegacyAny:
    """Returns the immediate subfolders of `<root>/path` (lazy). Each node
    includes `has_children` so the UI can draw the chevron without having to
    load the whole tree (the archive has ~33k directories).
    For root="vault" it excludes system folders (.git, BD, .gnosi, etc.).

    """
    _validate_root(root)
    return _legacy.media_service.get_tree_node(path, root=root)


@_legacy.router.post(
    "/media/upload",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def upload_media(
    file: _legacy.UploadFile = _legacy.File(...),
    album: str = _legacy.Query("General"),
    background_tasks: _legacy.BackgroundTasks = _legacy.BackgroundTasks(),
) -> _LegacyAny:
    """Uploads a media file to an album."""
    result = _legacy.media_service.upload_media(file, album)
    return result


@_legacy.router.patch(
    "/media/metadata",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def update_media_metadata(
    metadata: dict[str, _LegacyAny] = _legacy.Body(
        ..., description="{tags?: string[], description?: string}"
    ),
    path_in_root: str | None = _legacy.Body(
        None, description="Path relative to the root (preferred)"
    ),
    root: str = _legacy.Body("images"),
    filename: str | None = _legacy.Body(None),
    album: str | None = _legacy.Body(None),
) -> _LegacyAny:
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
            raise _legacy.HTTPException(
                status_code=400, detail="`path_in_root` or `filename` is required"
            )
        resolved = f"{album}/{filename}" if album else filename
    success = _legacy.media_service.update_metadata(resolved, metadata, root=root)
    if not success:
        raise _legacy.HTTPException(status_code=500, detail="Persistence error")
    return {"status": "ok"}


@_legacy.router.get("/media/views", response_model=None)
async def list_media_views() -> _LegacyAny:
    """Returns the user's saved views (JSON sidecar in the vault)."""
    return _legacy.media_service.list_views()


@_legacy.router.post(
    "/media/views",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def create_media_view(payload: dict[str, _LegacyAny] = _legacy.Body(...)) -> _LegacyAny:
    """Creates a new view. Payload: {label, scope, filters, sort}."""
    try:
        return _legacy.media_service.create_view(payload)
    except ValueError as e:
        raise _legacy.HTTPException(status_code=400, detail=str(e))


@_legacy.router.patch(
    "/media/views/{view_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def update_media_view(
    view_id: str, payload: dict[str, _LegacyAny] = _legacy.Body(...)
) -> _LegacyAny:
    """Updates an existing view."""
    updated = _legacy.media_service.update_view(view_id, payload)
    if updated is None:
        raise _legacy.HTTPException(status_code=404, detail="Vista no trobada")
    return updated


@_legacy.router.delete(
    "/media/views/{view_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def delete_media_view(view_id: str) -> _LegacyAny:
    """Deletes a view."""
    if not _legacy.media_service.delete_view(view_id):
        raise _legacy.HTTPException(status_code=404, detail="Vista no trobada")
    return {"status": "ok"}


_VAULT_IMAGE_SEMAPHORE = _legacy.file_serving_state.semaphore
_NO_STORE_HEADERS = {"Cache-Control": "no-store, must-revalidate"}


def _image_error(status: int, detail: str, retry_after: int | None = None) -> _legacy.HTTPException:
    return _legacy.file_serving.image_error(status, detail, retry_after)


def _onedrive_read_failure_hint(err: OSError) -> str:
    return _strict_cast(str, _legacy.file_serving.read_failure_hint(err))


_legacy.assets_api.register_image_route(_legacy.router)
serve_vault_image = _legacy.assets_api.serve_vault_image


async def _serve_file_with_containment(
    root_dir: _legacy.Path, rel_path: str
) -> _legacy.FileResponse:
    return await _legacy.files_api._serve_file_with_containment(root_dir, rel_path)


_legacy.files_api.register_serving_routes(
    _legacy.router, editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))]
)
serve_library_file = _legacy.files_api.serve_library_file
serve_vault_raw_file = _legacy.files_api.serve_vault_raw_file
serve_thumb = _legacy.files_api.serve_thumb
register_local_file = _legacy.files_api.register_local_file
serve_local_file = _legacy.files_api.serve_local_file
_THUMB_DAEMON_URL = _legacy.default_thumb_daemon_url()
_THUMB_DAEMON_TIMEOUT = float(_legacy.os.environ.get("THUMB_DAEMON_TIMEOUT", "45"))
_THUMB_ROOTS_MAP = _legacy.file_thumbnails.THUMB_ROOTS_MAP


def _resolve_thumb_source(rel_url: str) -> _legacy.Path:
    return _legacy.files_api._resolve_thumb_source(rel_url)


def _container_to_host_path(container_path: _legacy.Path) -> str | None:
    return _strict_cast(str | None, _legacy.files_api._container_to_host_path(container_path))


def _thumb_no_store(status_code: int, detail: str) -> _LegacyAny:
    return _legacy.files_api._thumb_no_store(status_code, detail)


_LOCAL_LINKS_LOCK = _legacy._LOCAL_LINK_STORE.lock


def _local_links_file() -> _legacy.Path:
    return _legacy.files_api._local_links_file()


def _load_local_links() -> dict[str, str]:
    return _strict_cast(dict[str, str], _legacy.files_api._load_local_links())


def _save_local_links(mapping: dict[str, str]) -> None:
    _legacy.files_api._save_local_links(mapping)


_legacy.assets_api.register_custom_icon_routes(
    _legacy.router, editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))]
)
get_custom_icons = _legacy.assets_api.get_custom_icons
save_custom_icons = _legacy.assets_api.save_custom_icons
_STORAGE_FOLDER_ALIASES = _legacy.property_file_service.STORAGE_FOLDER_ALIASES


def _normalize_storage_folder(storage_folder: str) -> str:
    return _strict_cast(str, _legacy.files_api._normalize_storage_folder(storage_folder))


def _effective_storage_folder(configured_storage: str, requested_storage: str) -> str:
    return _strict_cast(
        str, _legacy.files_api._effective_storage_folder(configured_storage, requested_storage)
    )


def _resolve_storage_dir(
    storage_folder: str,
    table: _LegacyAny,
    database: _LegacyAny,
    property_name: str,
    dest_folder: str = "",
) -> tuple[_legacy.Path, str]:
    return _strict_cast(
        tuple[_legacy.Path, str],
        _legacy.files_api._resolve_storage_dir(
            storage_folder, table, database, property_name, dest_folder
        ),
    )


def _file_response_payload(
    dest_path: _legacy.Path, url_prefix_type: str
) -> dict[_LegacyAny, _LegacyAny]:
    return _strict_cast(
        dict[_LegacyAny, _LegacyAny],
        _legacy.property_file_service.file_response_payload(
            dest_path, url_prefix_type, _legacy._PROPERTY_FILE_DEPENDENCIES
        ),
    )


_legacy.files_api.register_property_routes(
    _legacy.router, editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))]
)
upload_property_file = _legacy.files_api.upload_property_file
link_existing_file = _legacy.files_api.link_existing_file
delete_physical_file = _legacy.files_api.delete_physical_file


def _numbered_candidate(directory: _legacy.Path, stem: str, ext: str, index: int) -> _legacy.Path:
    return _legacy.files_api._numbered_candidate(directory, stem, ext, index)


_MAX_NUMBERED_ATTEMPTS = _legacy.property_file_service.MAX_NUMBERED_ATTEMPTS


def _save_uploaded_file_to_dir(
    upload: _legacy.UploadFile, target_dir: _legacy.Path, target_name: str = ""
) -> _legacy.Path:
    return _legacy.files_api._save_uploaded_file_to_dir(upload, target_dir, target_name)


def _run_osascript_picker(script: str) -> str:
    """Sync helper for use with asyncio.to_thread."""
    import subprocess

    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=60)
    return result.stdout.strip()


@_legacy.router.post(
    "/pick-folder",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def pick_folder() -> _LegacyAny:
    """Open a native macOS folder-picker dialog and return the chosen path."""
    import asyncio as _asyncio
    import subprocess

    script = 'tell application "System Events"\n  activate\nend tell\nset chosen to choose folder with prompt "Selecciona la carpeta de destinació"\nreturn POSIX path of chosen'
    try:
        chosen = await _asyncio.to_thread(_run_osascript_picker, script)
        if not chosen:
            raise _legacy.HTTPException(status_code=204, detail="No folder selected")
        return {"path": chosen}
    except subprocess.TimeoutExpired:
        raise _legacy.HTTPException(status_code=408, detail="Folder picker timed out")
    except _legacy.HTTPException:
        raise
    except Exception as e:
        raise _legacy.HTTPException(
            status_code=500, detail=_legacy.safe_error_detail(e, "POST /pick-folder")
        )


@_legacy.router.post(
    "/pick-file",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def pick_file() -> _LegacyAny:
    """Open a native macOS file-picker dialog and return the chosen file path."""
    import asyncio as _asyncio
    import subprocess

    script = 'tell application "System Events"\n  activate\nend tell\nset chosen to choose file with prompt "Select the file to link"\nreturn POSIX path of chosen'
    try:
        chosen = await _asyncio.to_thread(_run_osascript_picker, script)
        if not chosen:
            raise _legacy.HTTPException(status_code=204, detail="No file selected")
        p = _legacy.Path(chosen)
        return {"path": chosen, "name": p.name, "size": p.stat().st_size if p.exists() else 0}
    except subprocess.TimeoutExpired:
        raise _legacy.HTTPException(status_code=408, detail="File picker timed out")
    except _legacy.HTTPException:
        raise
    except Exception as e:
        raise _legacy.HTTPException(
            status_code=500, detail=_legacy.safe_error_detail(e, "POST /pick-file")
        )


@_legacy.router.get("/unsplash/search", response_model=None)
async def unsplash_search(
    query: str = _legacy.Query(...), page: int = _legacy.Query(1)
) -> _LegacyAny:
    """Searches images on Unsplash acting as a proxy."""
    unsplash_key = _legacy.os.getenv("UNSPLASH_ACCESS_KEY")
    if not unsplash_key:
        raise _legacy.HTTPException(
            status_code=500,
            detail="Unsplash API Key is not configured in .env (UNSPLASH_ACCESS_KEY)",
        )
    url = "https://api.unsplash.com/search/photos"
    headers = {"Authorization": f"Client-ID {unsplash_key}"}
    params = {"query": query, "page": page, "per_page": 21, "orientation": "landscape"}
    try:
        resp = await _legacy.asyncio.to_thread(
            _legacy.requests.get, url, headers=headers, params=params, timeout=10
        )
        resp.raise_for_status()
        data = resp.json()
        results = []
        for img in data.get("results", []):
            results.append(
                {
                    "id": img["id"],
                    "url": img["urls"]["regular"],
                    "thumb": img["urls"]["small"],
                    "author": img["user"]["name"],
                    "author_url": img["user"]["links"]["html"],
                }
            )
        return {"results": results, "total_pages": data.get("total_pages", 1)}
    except Exception as e:
        _legacy.log.error(f"Error fetching from Unsplash: {e}")
        raise _legacy.HTTPException(status_code=502, detail="Error fetching from Unsplash API")


_legacy.page_duplicate_api.configure(
    _legacy.page_duplicate_api.DuplicatePageDependencies(
        find_page=lambda page_id: _legacy.find_page_path(page_id),
        is_dashboard=lambda path: _legacy._is_dashboard_file_path(path),
        read_dashboard=lambda path: _legacy._read_dashboard_file(path),
        parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
        new_id=lambda: str(_legacy.uuid.uuid4()),
        write_dashboard=lambda path, page_id, title, metadata, content: (
            _legacy._write_dashboard_file(
                file_path=path,
                page_id=page_id,
                title=title,
                metadata=metadata,
                content=content,
                parent_id=metadata.get("parent_id"),
                is_database=bool(metadata.get("is_database")),
            )
        ),
        ensure_citation_key=lambda metadata: _legacy._ensure_recursos_citation_key(
            metadata, regenerate=True
        ),
        save_page=lambda path, metadata, content: _legacy.save_page_md(path, metadata, content),
        add_page_index=lambda path: _legacy._add_page_to_index_cache(path),
        update_link_index=lambda: _legacy.update_link_index_for_page,
    )
)
_legacy.page_duplicate_api.register_routes(
    _legacy.router, editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))]
)
duplicate_page = _legacy.page_duplicate_api.duplicate_page
