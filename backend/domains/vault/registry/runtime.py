"""Typed Vault domain extracted from the historical route facade."""

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
from http.client import HTTPResponse
from fastapi import Body, Depends, HTTPException
from backend.config.env_config import default_host_helper_url
from backend.services.path_resolver import path_resolver
from backend.services.workspace_service import require_role
from collections.abc import Iterator
from pathlib import Path
from contextlib import contextmanager

from backend.domains.vault.registry.state import RegistryData
from backend.domains.vault.registry.records import is_record

from backend.domains.vault.registry.contracts import (
    LocalPathOpenRequest,
    LocalPathOpenResponse,
    RegistryMutationResponse,
    ResourceOpenResponse,
    VaultRegistryResponse,
    VaultRegistryUpdateRequest,
)

from backend.api import vault_routes as _legacy
from backend.domains.vault.pages.runtime import OpenResourceRequest
router = _legacy.router
_registry_cache = _legacy.registry_state.cache
_registry_cache_mtime = _legacy.registry_state.cache_mtime
_registry_cache_ts = _legacy.registry_state.cache_timestamp
_registry_cache_ttl_seconds = _legacy.registry_state.cache_ttl_seconds
_registry_ensured_tables = _legacy.registry_state.ensured_tables
_registry_seen_nondegenerate = _legacy.registry_state.seen_nondegenerate


def _registry_is_degenerate(data: object) -> bool:
    """True when the registry carries no database or table structure."""
    return _legacy.registry_repository.is_degenerate(data)


def _degenerate_overwrite_is_risky(reg_path: Path) -> bool:
    """Return whether an empty write could clobber an existing registry."""
    return _legacy.registry_repository.degenerate_overwrite_is_risky(reg_path)


_registry_mutation_lock = _legacy.registry_state.mutation_lock
_TABLE_VIEW_EMOJI_RE = re.compile(
    "[\\U0001F000-\\U0001FAFF\\U0001FC00-\\U0001FFFD\\u2122\\u2139\\u2300-\\u23FF\\u2600-\\u27BF\\u2B00-\\u2BFF\\u3030\\u303D\\u3297\\u3299]"
)
_TABLE_VIEW_KEYCAP_RE = re.compile("[0-9#*]\\uFE0F?\\u20E3")
_TABLE_VIEW_EMOJI_CONTROL_RE = re.compile("[\\u200D\\u20E3\\uFE0E\\uFE0F]")
_LEGACY_MAIN_VIEW_NAMES = frozenset(
    {"main table", "taula principal", "vista principal", "tableau principal"}
)


def _normalize_table_view_name(value: object, fallback: str) -> str:
    """Return a compact table/view label without decorative emoji."""
    return _legacy.registry_normalize_table_view_name(value, fallback)


def _table_name_from_registry(registry: RegistryData, table_id: object) -> str:
    """Return the normalized display name for a table ID."""
    return _legacy.registry_table_name(registry, table_id)


def _main_view_fields(registry: RegistryData, table_id: object) -> list[str]:
    """Return the canonical visible fields for a table's main view."""
    return _legacy.registry_main_view_fields(registry, table_id)


def _is_main_or_locked_view(view: RegistryData) -> bool:
    """Return whether a view is protected as a table's main view."""
    return _legacy.registry_is_main_or_locked_view(view)


def _normalize_main_view_configuration(
    registry: RegistryData, view: RegistryData
) -> bool:
    """Enforce the immutable configuration of a main or locked view."""
    return _legacy.registry_normalize_main_view_configuration(registry, view)


def _normalize_registry_table_view_names(registry: RegistryData) -> bool:
    """Normalize persisted table/view labels and canonicalize main view names."""
    return _legacy.registry_normalize_table_view_names(registry)


@contextmanager
def registry_mutation() -> Iterator[None]:
    """Wrap an entire load, modify and save registry cycle."""
    with _legacy.registry_repository.mutation():
        yield


def _update_registry_cache(reg_path: Path, data: RegistryData) -> None:
    """Synchronize the canonical per-vault registry cache after a write."""
    _legacy.registry_repository.update_cache(reg_path, data)


def load_registry() -> RegistryData:
    """Read the central registry through its canonical repository."""
    return _legacy.registry_repository.load()


def _enabled_vault_calendar_tables() -> list[str]:
    from backend.services.integration_manager import integration_manager

    integrations = integration_manager.get_all_safe()
    calendar_config = integrations.get("vault_calendar", {})
    values = calendar_config.get("enabled_tables", [])
    return [str(value) for value in values] if isinstance(values, list) else []


def _hidden_calendar_event_ids() -> set[str]:
    from backend.api.calendar_routes import _get_hidden_event_ids

    return {str(value) for value in _get_hidden_event_ids()}


def _sync_vault_calendars() -> object:
    from backend.services.vault_calendar_sync_service import calendar_sync_service

    return calendar_sync_service.sync_all_calendars()


def _get_last_vault_sync_time() -> float:
    return _legacy.page_state.last_vault_sync_time


def _set_last_vault_sync_time(value: float) -> None:
    _legacy.page_state.last_vault_sync_time = value


_legacy.page_index_entries.configure(
    _legacy.page_index_entries.PageIndexEntryDependencies(
        parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
        is_dashboard_file=lambda path: _legacy._is_dashboard_file_path(path),
        read_dashboard_file=lambda path: _legacy._read_dashboard_file(path),
        process_metadata_paths=lambda metadata: _legacy._process_metadata_paths(metadata),
        vault_root=lambda: _legacy.get_p("VAULT"),
        logger=_legacy.log,
    )
)
_legacy.page_index_service.configure(
    _legacy.page_index_service.PageIndexDependencies(
        active_vault_path=lambda: _legacy.get_active_vault_path(),
        get_path=lambda name: _legacy.get_p(name),
        load_from_disk=lambda vault_key: _legacy._load_page_index_from_disk(vault_key),
        save_to_disk=lambda vault_key: _legacy._save_page_index_to_disk(vault_key),
        build_entry=lambda path, stat_result: _legacy._build_page_cache_entry(path, stat_result),
        build_entry_from_memory=lambda path, stat_result, metadata, body: (
            _legacy._build_cache_entry_from_memory(path, stat_result, metadata, body)
        ),
        is_metadata_stub=lambda metadata: _legacy._is_metadata_stub(metadata),
        vault_cache_key=_legacy._vault_cache_key,
        cache_get=lambda key: _legacy._pages_cache_get(key),
        cache_set=lambda key, pages: _legacy._pages_cache_set(key, pages),
        load_registry=lambda: _legacy.load_registry(),
        table_vault_dir=lambda table, registry: _legacy._table_vault_dir(table, registry),
        build_table_folder_index=lambda registry: _legacy._build_table_folder_index(registry),
        resolve_table_id=lambda metadata, folder, index, sorted_folders: (
            _legacy._resolve_table_id_from_context(
                metadata, folder, index, sorted_folders=sorted_folders
            )
        ),
        enabled_calendar_tables=_enabled_vault_calendar_tables,
        hidden_event_ids=_hidden_calendar_event_ids,
        sync_calendars=_sync_vault_calendars,
        update_path_resolver=path_resolver.update_index,
        get_last_vault_sync=_get_last_vault_sync_time,
        set_last_vault_sync=_set_last_vault_sync_time,
        index_lock=_legacy._page_index_lock,
        index_entries=_legacy._page_index_entries,
        index_initialized=_legacy._page_index_initialized,
        id_to_path=_legacy._page_id_to_path,
        index_version=_legacy._page_index_version,
        body_cache_lock=_legacy._body_cache_lock,
        body_cache=_legacy._body_cache,
        last_stale_check=_legacy._last_stale_check,
        vault_sync_cooldown_seconds=_legacy._VAULT_SYNC_COOLDOWN_SECONDS,
        calendar_sync_cooldown_seconds=_legacy._GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS,
        stale_check_ttl=_legacy._STALE_CHECK_TTL,
        logger=_legacy.log,
    )
)
_legacy.page_resolver.configure(
    _legacy.page_resolver.PageResolverDependencies(
        active_vault_path=lambda: _legacy.get_active_vault_path(),
        get_path=lambda name: _legacy.get_p(name),
        path_factory=lambda value: Path(value),
        parse_frontmatter=lambda content, path: _legacy.parse_frontmatter(content, path),
        canonicalize_id=lambda value: _legacy._canonicalize_id(value),
        bump_index_version=lambda vault_key: _legacy._bump_page_index_version(vault_key),
        set_last_vault_sync=_set_last_vault_sync_time,
        monotonic=lambda: time.monotonic(),
        stale_check_ttl=_legacy._STALE_CHECK_TTL,
        last_stale_check=_legacy._last_stale_check,
        index_lock=_legacy._page_index_lock,
        index_entries=_legacy._page_index_entries,
        index_initialized=_legacy._page_index_initialized,
        id_to_path=_legacy._page_id_to_path,
        logger=_legacy.log,
    )
)
_legacy.tags_query.configure(
    _legacy.tags_query.TagQueryDependencies(
        page_snapshot=lambda: _legacy._get_pages_snapshot(),
        load_registry=lambda: _legacy.load_registry(),
        find_role_property=lambda table, role: _legacy.option_catalogs_service.find_role_prop(
            table, role
        ),
        tags_role=_legacy.option_catalogs_service.ROLE_TAGS,
        table_id=lambda metadata: _legacy.get_table_id(metadata),
    )
)


def _load_registry_from_disk(registry_path: Path, _ck: str, now: float) -> RegistryData:
    """Read and normalize a registry while holding the mutation lock."""
    return _legacy.registry_repository.load_from_disk(registry_path, _ck, now)


def save_registry(data: RegistryData) -> None:
    """Persist the registry through its canonical repository."""
    _legacy.registry_repository.save(data)


def _sort_key_name(item: RegistryData) -> tuple[int, str]:
    """Sort by explicit order, then accent-insensitive display name."""
    return _legacy.registry_sort_key_name(item)


_HOST_OPEN_HELPER_URL = os.environ.get(
    "GNOSI_HOST_OPEN_HELPER_URL"
) or default_host_helper_url("/open")
_HOST_TRASH_HELPER_URL = os.environ.get(
    "GNOSI_HOST_TRASH_HELPER_URL", _HOST_OPEN_HELPER_URL.rsplit("/", 1)[0] + "/trash"
)


def _try_host_trash_helper(target: str, timeout: float = 20.0) -> "tuple[bool, str]":
    return _legacy.file_host_trash.try_host_trash_helper(
            target, timeout, helper_url=_HOST_TRASH_HELPER_URL
        )


def _try_host_open_helper(target: str, timeout: float = 2.0) -> bool:
    """Delegates the opening to the helper running on the host (real Mac/Win/Linux).

    Gnosi's backend usually runs inside a Linux Docker container that does NOT
    have access to the host's graphical system (Finder/Explorer). The helper
    `host_open_helper` (see pipeline/skills/host_open_helper/) listens on
    127.0.0.1:5099 on the host; the backend reaches it on loopback (native) or
    via `host.docker.internal` (Docker) — see default_host_helper_url().
    If it's not available, we fall back to the
    local `subprocess` (which works if the backend runs directly on the
    host, not in Docker).

    """
    try:
        import urllib.error
        import urllib.request

        req = urllib.request.Request(
            _HOST_OPEN_HELPER_URL,
            data=json.dumps({"path": target}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        # urllib's HTTP transport is dynamically annotated; its native response
        # owns the integer status rather than the legacy facade namespace.
        response: HTTPResponse = urllib.request.urlopen(req, timeout=timeout)
        with response as resp:
            return 200 <= resp.status < 300
    except Exception:
        return False


def _safe_open_target(target: str) -> None:
    """Open URI/path with the system default app without shell interpolation.

    First tries the host helper (necessary when the backend runs inside
    Docker, because the container cannot call the Mac's Finder/Explorer).
    If the helper is not available, falls back to the local `subprocess` — useful when
    the backend runs directly on the host (debug/local mode).

    """
    if _try_host_open_helper(target):
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", target])
        return
    if os.name == "nt":
        os.startfile(target)
        return
    subprocess.Popen(["xdg-open", target])


def _extract_attachment_paths(attachments: object) -> list[str]:
    """Extract candidate file paths from heterogeneous attachment values."""
    if attachments is None:
        return []
    raw_values: list[str] = []
    if isinstance(attachments, list):
        raw_values = [str(v).strip() for v in attachments if str(v).strip()]
    elif isinstance(attachments, str):
        text = attachments.strip()
        if not text:
            return []
        parts = re.split("[\\n;,]", text)
        raw_values = [p.strip() for p in parts if p.strip()]
    candidates: list[str] = []
    for item in raw_values:
        match = re.search("\\(([^)]+)\\)", item)
        if match:
            item = match.group(1).strip()
        if item.startswith("file://"):
            item = urllib.parse.unquote(item[7:])
        expanded = str(Path(_expand_host_tilde(item)).expanduser())
        candidates.append(expanded)
    return candidates


def _pick_existing_path(file_path: str | None, attachments: object | None) -> str | None:
    candidates: list[str] = []
    if isinstance(file_path, str) and file_path.strip():
        fp = file_path.strip()
        if fp.lower().startswith("file://"):
            fp = urllib.parse.unquote(fp[7:])
        candidates.append(str(Path(_expand_host_tilde(fp)).expanduser()))
    candidates.extend(_extract_attachment_paths(attachments))
    for candidate in candidates:
        try:
            path = Path(candidate)
            if path.exists() and path.is_file():
                return str(path)
        except Exception:
            continue
    for candidate in candidates:
        rerooted = _reroot_attachment_under_current_host(candidate)
        if rerooted is not None and rerooted.is_file():
            return str(rerooted)
    return None


@router.get("/registry", response_model=VaultRegistryResponse)
async def get_registry() -> RegistryData:
    """Returns the full registry of databases, tables, and views (sorted alphabetically)."""
    return await _legacy.registry_api.get_registry(_legacy.registry_api_dependencies)


@router.post(
    "/registry",
    dependencies=[Depends(require_role("admin"))],
    response_model=RegistryMutationResponse,
)
async def update_registry(data: VaultRegistryUpdateRequest = Body(...)) -> RegistryData:
    """Updates the entire registry (use with care).

    Auth: admin-only. Overwrites the ENTIRE registry at once, so an
    error or an attacker with a lower role could destroy all
    databases/tables/views of a workspace in a single call.

    """
    if isinstance(data, VaultRegistryUpdateRequest):
        payload: object = data.model_dump()
        # Validate the actual Pydantic result without copying its dictionary.
        assert is_record(payload), "Registry model_dump must return a dictionary"
    else:
        # Retain direct legacy calls with their original mutable record.
        payload = data
    return await _legacy.registry_api.update_registry(payload, _legacy.registry_api_dependencies)


@router.post(
    "/open-resource",
    dependencies=[Depends(require_role("editor"))],
    response_model=ResourceOpenResponse,
)
async def open_resource(payload: OpenResourceRequest) -> dict[str, str]:
    """Open a Zotero URI or local attachment path with the OS default handler.

    Auth gate: same as /open-local-path. This endpoint ends up invoking
    `subprocess.Popen(["open", target])` (macOS) or equivalents — it's a
    command-execution surface that should not be available to
    `viewer` roles in organization mode.

    """
    zotero_uri = (payload.zotero_uri or "").strip()
    if zotero_uri:
        if not zotero_uri.startswith("zotero://"):
            raise HTTPException(status_code=400, detail="Invalid Zotero URI")
        try:
            _safe_open_target(zotero_uri)
            return {"status": "ok", "opened_with": "zotero_uri", "target": zotero_uri}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Could not open Zotero URI: {e}")
    existing_path = _pick_existing_path(payload.file_path, payload.attachments)
    if not existing_path:
        raise HTTPException(status_code=404, detail="No valid local attachment found")
    try:
        _safe_open_target(existing_path)
        return {"status": "ok", "opened_with": "file_path", "target": existing_path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open local file: {e}")


def _host_home_path() -> Path:
    """HOST's HOME (not the container's). Inside Docker the process's HOME is
    /root, so `Path.expanduser()` does NOT work to resolve `~/...` values.
    Order: HOME_HOST_PATH (docker-compose) → home derived from LIBRARY
    (/Users/<actual>/Library/...) → process home (local environment without Docker).

    """
    env_home = (os.environ.get("HOME_HOST_PATH") or "").strip()
    if env_home:
        return Path(env_home)
    try:
        b = _legacy.get_p("LIBRARY")
        if len(b.parts) >= 3 and b.parts[1] == "Users":
            return Path(b.parts[0]) / b.parts[1] / b.parts[2]
    except Exception:
        pass
    return Path.home()


def _expand_host_tilde(value: str) -> str:
    """Expands a `~`/`~/<rel>` value against the HOST's HOME (never the
    container's). Any other form is returned intact."""
    s = str(value or "").strip()
    if s == "~":
        return str(_host_home_path())
    if s.startswith("~/"):
        return str(_host_home_path() / s[2:])
    return s


def _library_route_attachment(value: str) -> tuple[bool, Path | None]:
    match = re.match("^/api/vault/library/(.+)$", value)
    if not match:
        return False, None
    try:
        from backend.services.context_vars import get_active_vault_path

        relative = urllib.parse.unquote(match.group(1))
        for library_root in _legacy._library_roots(get_active_vault_path()):
            candidate = library_root / relative
            if candidate.exists():
                return True, candidate
    except Exception:
        return True, None
    return True, None


def _decode_attachment_uri(value: str) -> str:
    if not value.lower().startswith("file://"):
        return value
    remainder = value[7:]
    encoded_path = remainder if remainder.startswith("/") else "//" + remainder
    return str(urllib.parse.unquote(encoded_path))


def _attachment_cloud_root() -> Path | None:
    try:
        vaults_root = (os.environ.get("VAULTS_ROOT_HOST_PATH") or "").strip()
        if vaults_root:
            return Path(vaults_root).parent
        vault_host = (os.environ.get("VAULT_HOST_PATH") or "").strip()
        if vault_host:
            return Path(vault_host).parent.parent
        from backend.services.context_vars import get_active_vault_path

        active_vault = get_active_vault_path()
        return active_vault.parent.parent if active_vault else None
    except Exception:
        return None


def _attachment_candidates(value: str, cloud_root: Path) -> list[Path]:
    candidates: list[Path] = []
    cloud_anchor = f"/{cloud_root.name}/"
    anchor_index = value.rfind(cloud_anchor)
    if anchor_index != -1:
        relative = value[anchor_index + len(cloud_anchor) :].lstrip("/")
        if relative:
            candidates.append(cloud_root / relative)
    home_match = re.match("^/Users/[^/]+/(.+)$", value)
    if home_match and len(cloud_root.parts) >= 3 and cloud_root.parts[1] == "Users":
        host_home = Path(cloud_root.parts[0]) / cloud_root.parts[1] / cloud_root.parts[2]
        candidates.append(host_home / home_match.group(1))
    return candidates


def _first_existing_attachment(candidates: list[Path]) -> Path | None:
    for candidate in candidates:
        try:
            if candidate.exists():
                return candidate
        except Exception:
            continue
    return None


def _reroot_attachment_under_current_host(raw: str) -> Path | None:
    """Re-roots an attachment path/URI under THIS machine's roots, so that
    links saved on another Mac (a different macOS user) keep
    resolving here.

    The user works from two Macs with different usernames; the
    `/Users/<user>/` prefix of `file://` links is specific to the machine where
    they were inserted. The later segment (Library/CloudStorage/<cloud>/<folder>/…) is
    stable across machines because the vault and its siblings are synced.

    Strategies, in order, returning the first candidate that EXISTS:
      1. Served form `/api/vault/library/<rel>` → Library root.
      2. Under the cloud root (vault's sibling): covers Library,
         Documents and any synced sibling folder.
      3. Swap of the macOS home `/Users/<someone>` for the current host home:
         covers files outside the cloud (Desktop, Downloads…).

    NOT destructive: only used as a fallback when the saved path doesn't exist
    as-is; never rewrites the .md. See `attachment_link_portability.md`.

    """
    value = (raw or "").strip()
    is_library_route, library_candidate = _library_route_attachment(value)
    if is_library_route:
        return library_candidate
    decoded_value = _decode_attachment_uri(value)
    if decoded_value == "~" or decoded_value.startswith("~/"):
        candidate = Path(_expand_host_tilde(decoded_value))
        return candidate if candidate.exists() else None
    cloud_root = _attachment_cloud_root()
    if cloud_root is None:
        return None
    return _first_existing_attachment(_attachment_candidates(decoded_value, cloud_root))


def _resolve_stored_file_target(raw: str) -> Path | None:
    """Resolves the SAVED VALUE of a files field to a local path on THIS
    machine, accepting all historical and new formats: `file://`
    (URL-encoded or not), `~/<rel>` (host HOME), absolute path (from this or
    the other Mac) and `/api/vault/library/<rel>`.

    If the value doesn't exist as-is, re-roots with
    `_reroot_attachment_under_current_host`. Returns None if no candidate
    exists. Never writes anything (runtime resolution, see
    `attachment_link_portability.md`).


    """
    s = str(raw or "").strip()
    if not s:
        return None
    direct = s
    if direct.lower().startswith("file://"):
        rest = direct[7:]
        direct = urllib.parse.unquote(rest if rest.startswith("/") else "//" + rest)
    direct = _expand_host_tilde(direct)
    if not direct.startswith("/api/"):
        try:
            p = Path(direct)
            if p.exists():
                return p
        except OSError:
            pass
    rerooted = _reroot_attachment_under_current_host(s)
    if rerooted is not None:
        try:
            if rerooted.exists():
                return rerooted
        except OSError:
            pass
    return None


@router.post(
    "/open-local-path",
    dependencies=[Depends(require_role("editor"))],
    response_model=LocalPathOpenResponse,
)
async def open_local_path(payload: LocalPathOpenRequest) -> dict[str, str]:
    """
        Opens a local path (file or folder) with the system's default app.
    Accepts an absolute path or file:// URL. Useful for file:// links inserted
    in the BlockEditor that modern browsers block for security reasons.

    """
    raw = payload.path or payload.url or ""
    raw = str(raw).strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Missing 'path'")
    if raw.lower().startswith("file://"):
        without_scheme = raw[7:]
        if without_scheme.startswith("/"):
            target = urllib.parse.unquote(without_scheme)
        else:
            target = "//" + urllib.parse.unquote(without_scheme)
    else:
        target = raw
    try:
        path = Path(_expand_host_tilde(target)).expanduser()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not path.exists():
        rerooted = _reroot_attachment_under_current_host(raw)
        if rerooted is not None:
            path = rerooted
        else:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")
    if path.is_file():
        await _legacy._materialize_if_online_only(path, "open-local-path")
    try:
        _safe_open_target(str(path))
        return {"status": "ok", "target": str(path), "kind": "dir" if path.is_dir() else "file"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open: {e}")


_legacy.table_routes.register_routes(router)
