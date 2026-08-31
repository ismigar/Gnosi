"""Typed Vault domain extracted from the historical route facade."""

from __future__ import annotations

import importlib as _legacy_importlib
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
    from backend.domains.vault.trash.purge import PurgeResult
    from backend.domains.vault.trash.repository import TrashMetadata
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")

TRASH_RETENTION_DAYS = 90


def _trash_root() -> Path:
    """Root of the Vault trash. Call it only from worker threads
    (it touches the filesystem). Creates the directory if it doesn't exist."""
    return _legacy.TrashRepository(
        _legacy.get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=_legacy.parse_frontmatter,
        write_json=_legacy.safe_write_json,
    ).root()


def _trash_entry_dir(page_id: str) -> Path:
    return _legacy.TrashRepository(
        _legacy.get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=_legacy.parse_frontmatter,
        write_json=_legacy.safe_write_json,
    ).entry_dir(page_id)


def _move_page_to_trash(page_id: str, file_path: Path) -> TrashMetadata:
    """Moves a .md file to `.trash/{page_id}/page.md` and writes the sidecar.

    Returns the trash metadata (id, deleted_at, original_path, ...).
    Does not invoke any async helper: it is meant to run inside
    `asyncio.to_thread` from the HTTP handler.

    """
    return _legacy.TrashRepository(
        _legacy.get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=_legacy.parse_frontmatter,
        write_json=_legacy.safe_write_json,
    ).move_page(page_id, file_path)


def _restore_page_from_trash(page_id: str) -> TrashMetadata:
    """Inverse of `_move_page_to_trash`. Restores the file to `original_path`.

    Raises `FileNotFoundError` if the trash doesn't contain the entry,
    `FileExistsError` if there's already a file at the destination, and `PermissionError`
    if the sidecar path escapes the Vault (anti-path-traversal defense).

    """
    return _legacy.TrashRepository(
        _legacy.get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=_legacy.parse_frontmatter,
        write_json=_legacy.safe_write_json,
    ).restore_page(page_id)


def _read_trash_entries() -> list[TrashMetadata]:
    """Reads all `.trash/*/_trash.json` sidecars. Tolerates entries without
    a sidecar (they are returned with `deleted_at=None` and a fallback title)."""
    return _legacy.TrashRepository(
        _legacy.get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=_legacy.parse_frontmatter,
        write_json=_legacy.safe_write_json,
    ).list_entries()


async def _materialize_trash_sidecar(page_id: str) -> None:
    """Materializes ONLY the `_trash.json` of an entry before reading it in the
    sync thread (restore/purge). Without this, a dataless OneDrive sidecar
    crashes with [Errno 35] EDEADLK. The path calculation —which touches the FS via
    `_trash_root()` (mkdir)— goes to a worker thread so as not to block the event
    loop; only the async materialization happens here. `page.md` is not downloaded
    (unnecessary: the restore move is a rename and the purge only does unlink)."""

    def _existing_sidecar() -> Path | None:
        sidecar = _trash_entry_dir(page_id) / "_trash.json"
        return sidecar if sidecar.exists() else None

    try:
        sidecar = await _legacy.asyncio.to_thread(_existing_sidecar)
    except OSError:
        return
    if sidecar is not None:
        await _legacy._materialize_if_online_only(sidecar, f"trash/{page_id}")


async def _materialize_all_trash_sidecars() -> None:
    """Warmup of all `_trash.json` files before listing the trash. The scan
    of `.trash` (mkdir/iterdir, cf. the note in `_trash_root`) goes to a worker
    thread; only the async materialization happens on the event loop. Without this, the
    dataless sidecars crash with EDEADLK and the entries show up as "(corrupt)"."""

    def _scan_sidecars() -> list[Path]:
        root = _trash_root()
        if not root.exists():
            return []
        return [d / "_trash.json" for d in root.iterdir() if d.is_dir()]

    try:
        sidecars = await _legacy.asyncio.to_thread(_scan_sidecars)
    except OSError:
        return
    for sidecar in sidecars:
        await _legacy._materialize_if_online_only(sidecar, f"trash/{sidecar.parent.name}")


_TRASH_PURGE_DEPENDENCIES = _legacy.trash_purge.PurgeDependencies(
    entry_directory=lambda page_id: _trash_entry_dir(page_id),
    parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
    remove_tree=lambda path: _legacy.shutil.rmtree(path),
    propagate_relation_inverse=lambda page_id, table_id, old, new: (
        _legacy._propagate_relation_inverse(page_id, table_id, old, new)
    ),
    vault_root=lambda: _legacy.get_p("VAULT"),
    delete_metadata_sidecar=lambda vault_root, page_id: _legacy.delete_sidecar_for_page(
        vault_root, page_id
    ),
    validate_page_id=lambda page_id: _legacy._validate_safe_page_id(page_id),
    load_comments=lambda: _legacy._load_comments(),
    save_comments=lambda data: _legacy._save_comments(data),
    inline_comments_path=lambda page_id: _legacy._inline_comments_path(page_id),
    logger=_legacy.log,
)


def _purge_trash_entry(page_id: str) -> PurgeResult:
    """Permanently deletes an entry from the trash."""
    return _legacy.trash_purge.purge_trash_entry(page_id, _TRASH_PURGE_DEPENDENCIES)


def _force_index_rescan() -> None:
    """Invalidates the index cache to force a rescan on the next listing."""
    _legacy.page_state.last_vault_sync_time = 0.0
    _legacy._clear_page_index_cache()


def _remove_page_from_index_cache(
    page_id: str, old_path: Path | None = None
) -> None:
    """Removes ONE entry from the index cache without clearing it entirely.

    A surgical alternative to `_force_index_rescan()` for operations that
    only affect a single page (delete/soft-delete). The global wipe caused
    `/pages/by-table/{id}` to return [] until the next rescan and
    left the table flickering empty after deleting a record.

    """
    from backend.services.context_vars import get_active_vault_path

    v_path = get_active_vault_path()
    if not v_path:
        return
    v_str = str(v_path)
    with _legacy._page_index_lock:
        id_map = _legacy._page_id_to_path.get(v_str, {})
        entries = _legacy._page_index_entries.get(v_str, {})
        path_str = id_map.pop(page_id, None)
        if path_str:
            entries.pop(path_str, None)
        if old_path:
            entries.pop(str(old_path), None)
    _legacy.path_resolver.remove_file(
        v_path, page_id, old_path or (_legacy.Path(path_str) if path_str else None)
    )
    removed_paths = {str(old_path)} if old_path else set()
    if path_str:
        removed_paths.add(path_str)
    with _legacy._iter_docs_lock:
        _dc_entry = _legacy._iter_docs_cache.get(v_str)
        docs = _dc_entry.get("docs") if _dc_entry else None
        if docs is not None and removed_paths and _dc_entry is not None:
            _dc_entry["docs"] = [d for d in docs if str(d[0]) not in removed_paths]
    with _legacy._id_title_lock:
        _it_entry = _legacy._id_title_cache.get(v_str)
        if _it_entry:
            _it_entry.get("index", {}).pop(page_id, None)
    _legacy._pages_cache_invalidate_all()


def _add_page_to_index_cache(file_path: Path) -> None:
    """Inserts ONE entry into the index cache without rescanning the whole vault.

    Symmetric to `_remove_page_from_index_cache`. Useful when we've just created
    or restored a file and want it to already appear on the next GET without
    having to clear and rebuild the whole index (the wipe + repopulate caused
    the table to flicker empty after a restore from the Undo toast).

    """
    from backend.services.context_vars import get_active_vault_path

    v_path = get_active_vault_path()
    if not v_path:
        return
    v_str = str(v_path)
    try:
        stat_result = file_path.stat()
        new_entry = _legacy._build_page_cache_entry(file_path, stat_result)
    except Exception as e:
        _legacy.log.warning(f"_add_page_to_index_cache failed for {file_path}: {e}")
        return
    with _legacy._page_index_lock:
        _legacy._page_index_entries.setdefault(v_str, {})[str(file_path)] = new_entry
        new_id = new_entry.get("id")
        if new_id:
            _legacy._page_id_to_path.setdefault(v_str, {})[new_id] = str(file_path)
    _legacy.path_resolver.add_file(v_path, new_id, file_path)
    try:
        raw_content = file_path.read_text(encoding="utf-8", errors="ignore")
        metadata, body = _legacy.parse_frontmatter(raw_content, file_path)
        path_str = str(file_path)
        with _legacy._iter_docs_lock:
            _dc_entry = _legacy._iter_docs_cache.get(v_str)
            docs = _dc_entry.get("docs") if _dc_entry else None
            if docs is not None:
                new_doc = (file_path, metadata, body, _legacy._is_dashboard_file_path(file_path))
                for i, doc in enumerate(docs):
                    if str(doc[0]) == path_str:
                        docs[i] = new_doc
                        break
                else:
                    docs.append(new_doc)
        if new_id:
            with _legacy._id_title_lock:
                _it_entry = _legacy._id_title_cache.get(v_str)
                if _it_entry:
                    _it_entry.get("index", {})[str(new_id)] = str(
                        metadata.get("title") or file_path.stem
                    )
    except Exception as e:
        _legacy.log.debug(f"Derived-cache update after add failed for {file_path}: {e}")
    _legacy._pages_cache_invalidate_all()


def _emit_page_deleted_event(page_id: str) -> None:
    try:
        from backend.services import plugin_events

        plugin_events.emit("page:deleted", {"page_id": page_id})
    except Exception:
        pass


_legacy.trash_api.configure(
    _legacy.trash_api.TrashDependencies(
        retention_days=TRASH_RETENTION_DAYS,
        validate_page_id=_legacy._validate_safe_page_id,
        get_page_write_lock=lambda page_id: _legacy._get_page_write_lock(page_id),
        find_page=lambda page_id: _legacy.find_page_path(page_id),
        move_page=lambda page_id, file_path: _legacy._move_page_to_trash(page_id, file_path),
        remove_link_index=lambda page_id: _legacy.remove_from_link_index(page_id),
        remove_page_index=lambda page_id, path: _remove_page_from_index_cache(page_id, path),
        emit_page_deleted=_emit_page_deleted_event,
        materialize_sidecar=lambda page_id: _materialize_trash_sidecar(page_id),
        materialize_all_sidecars=lambda: _materialize_all_trash_sidecars(),
        restore_page=lambda page_id: _restore_page_from_trash(page_id),
        add_page_index=lambda path: _add_page_to_index_cache(path),
        vault_root=lambda: _legacy.get_p("VAULT"),
        read_entries=lambda: _read_trash_entries(),
        trash_root=lambda: _trash_root(),
        purge_entry=lambda page_id: _legacy._purge_trash_entry(page_id),
        safe_error_detail=_legacy.safe_error_detail,
    )
)
_legacy.trash_api.register_routes(
    _legacy.router,
    editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    admin_dependencies=[_legacy.Depends(_legacy.require_role("admin"))],
)
delete_page = _legacy.trash_api.delete_page
restore_page = _legacy.trash_api.restore_page
list_trash = _legacy.trash_api.list_trash
empty_trash = _legacy.trash_api.empty_trash
purge_trash_entry = _legacy.trash_api.purge_trash_entry
purge_expired_trash = _legacy.trash_api.purge_expired_trash
_LOCAL_LINK_STORE = _legacy.LocalLinkStore(_legacy.resolve_data_dir)
_PROPERTY_FILE_DEPENDENCIES = _legacy.property_file_service.PropertyFileDependencies(
    get_path=lambda key: _legacy.get_p(key),
    load_registry=lambda: _legacy.load_registry(),
    resolve_table=lambda table_id, registry: _legacy._resolve_table_and_database_for_assets(
        table_id, registry
    ),
    find_property=lambda table, name: _legacy._find_table_property(table, name),
    property_config_value=lambda prop, key: _legacy._property_config_value(prop, key),
    property_assets_dir=lambda table, database, name: _legacy._property_assets_dir(
        table, database, name
    ),
    sanitize_filename=lambda value: _legacy._sanitize_filename_base(value),
    sanitize_segment=lambda value, fallback: _legacy._sanitize_asset_segment(value, fallback),
    active_vault_path=lambda: _legacy.get_active_vault_path(),
    library_roots=lambda vault: _legacy._library_roots(vault),
)
_LOCAL_FILE_DEPENDENCIES = _legacy.file_local_service.LocalFileDependencies(
    store=_LOCAL_LINK_STORE,
    resolve_target=lambda raw: _legacy._resolve_stored_file_target(raw),
    materialize=lambda path, label: _legacy._ensure_materialized_or_503(path, label),
    classify_kind=lambda extension: _legacy.media_service.classify_kind(extension),
    get_path=lambda key: _legacy.get_p(key),
    provider=_legacy.get_files_provider,
)
_LINK_FILE_DEPENDENCIES = _legacy.file_local_service.LinkFileDependencies(
    resolve_target=lambda raw: _legacy._resolve_stored_file_target(raw),
    materialize=lambda path, label: _legacy._ensure_materialized_or_503(path, label),
    sanitize_filename=lambda value: _legacy._sanitize_filename_base(value),
    library_roots=lambda vault: _legacy._library_roots(vault),
    active_vault_path=lambda: _legacy.get_active_vault_path(),
    get_path=lambda key: _legacy.get_p(key),
    host_home_path=lambda: _legacy._host_home_path(),
)
_DELETE_FILE_DEPENDENCIES = _legacy.file_local_service.DeleteFileDependencies(
    store=_LOCAL_LINK_STORE,
    get_path=lambda key: _legacy.get_p(key),
    expand_host_tilde=lambda value: _legacy._expand_host_tilde(value),
    reroot_attachment=lambda value: _legacy._reroot_attachment_under_current_host(value),
    move_to_trash=lambda target: _legacy.file_host_trash.try_host_trash_helper(
        target, helper_url=_legacy._HOST_TRASH_HELPER_URL
    ),
)
_THUMBNAIL_DEPENDENCIES = _legacy.ThumbnailDependencies(
    get_path=lambda key: _legacy.get_p(key),
    provider=_legacy.get_files_provider,
    daemon_url=lambda: _legacy._THUMB_DAEMON_URL,
    daemon_timeout=lambda: _legacy._THUMB_DAEMON_TIMEOUT,
)
_legacy.files_api.configure(
    _legacy.files_api.FileApiDependencies(
        get_path=lambda key: _legacy.get_p(key),
        active_vault_path=lambda: _legacy.get_active_vault_path(),
        library_roots=lambda vault: _legacy._library_roots(vault),
        provider=_legacy.get_files_provider,
        serving_state=_legacy.file_serving_state,
        local_files=_LOCAL_FILE_DEPENDENCIES,
        link_files=_LINK_FILE_DEPENDENCIES,
        delete_files=_DELETE_FILE_DEPENDENCIES,
        property_files=_PROPERTY_FILE_DEPENDENCIES,
        thumbnails=_THUMBNAIL_DEPENDENCIES,
    )
)
_CUSTOM_ICON_STORE = _legacy.CustomIconStore(
    path_provider=lambda: _legacy.get_p("CUSTOM_ICONS"),
    json_writer=lambda path, value: _legacy.safe_write_json(
        path, value, indent=2, ensure_ascii=False
    ),
)
_ASSET_SERVICE_DEPENDENCIES = _legacy.assets_service.AssetDependencies(
    get_path=lambda key: _legacy.get_p(key),
    save_uploaded_asset=lambda upload, target, name: _legacy._save_uploaded_file_to_assets(
        upload, target, name
    ),
    load_registry=lambda: _legacy.load_registry(),
    resolve_table=lambda table_id, registry: _legacy._resolve_table_and_database_for_assets(
        table_id, registry
    ),
    table_assets_dir=lambda table, database: _legacy._table_assets_dir(table, database),
    safe_write_bytes=lambda path, payload: _legacy.safe_write_bytes(path, payload),
    validate_external_url=lambda url: _is_safe_external_url(url),
)
_legacy.assets_api.configure(
    _legacy.assets_api.AssetApiDependencies(
        service=_ASSET_SERVICE_DEPENDENCIES,
        custom_icons=_CUSTOM_ICON_STORE,
        materialize=lambda path, label: _legacy._materialize_if_online_only(path, label),
        serve_contained=lambda root, rel: _legacy.files_api._serve_file_with_containment(root, rel),
        serve_image=lambda vault, rel: _legacy.file_serving.serve_vault_image(
            vault, rel, state=_legacy.file_serving_state, provider=_legacy.get_files_provider()
        ),
    )
)
_legacy.assets_api.register_primary_routes(
    _legacy.router, editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))]
)
upload_cover = _legacy.assets_api.upload_cover
upload_icon = _legacy.assets_api.upload_icon
import_icon_from_url = _legacy.assets_api.import_icon_from_url
upload_asset = _legacy.assets_api.upload_asset
get_asset = _legacy.assets_api.get_asset
_custom_icons_lock = _CUSTOM_ICON_STORE.lock
_LOCAL_LINKS_LOCK = _LOCAL_LINK_STORE.lock
_VAULT_IMAGE_SEMAPHORE = _legacy.file_serving_state.semaphore


def _is_safe_external_url(url: str) -> tuple[bool, str]:
    """Reject URLs that would let the server fetch internal resources (SSRF).

    Blocks: loopback, private IP ranges (RFC1918), link-local (169.254/16,
    cloud metadata), multicast, reserved. Resolves the hostname to verify
    — a hostname like "metadata.google.internal" maps to 169.254.169.254.
    """
    import ipaddress
    import socket
    from urllib.parse import urlparse

    try:
        parsed = urlparse(url)
    except Exception:
        return (False, "Invalid URL")
    if parsed.scheme.lower() not in ("http", "https"):
        return (False, "URL must be http(s)")
    host = parsed.hostname
    if not host:
        return (False, "URL has no host")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return (False, "Could not resolve host")
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            return (False, f"Host resolves to a non-public address ({ip})")
    return (True, "")
