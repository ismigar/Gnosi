"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
import operator
from pathlib import Path
from typing import TYPE_CHECKING

from pydantic import BaseModel

from backend.domains.vault.links.state import LinkIndexView
from backend.domains.vault.pages.disk_cache import prepare_page_index
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.utils.open_values import contains_value

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
    from backend.services.rule_engine import RuleEngine
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")


def _active_vault_path() -> Path:
    """Return the active Vault for filesystem-bound legacy operations."""
    from backend.services.context_vars import get_active_vault_path

    path = get_active_vault_path()
    if path is None:
        raise RuntimeError("No active vault is configured")
    return path


def get_p(key: str) -> Path:
    base = _active_vault_path()
    if key == "LIBRARY":
        return Path(_legacy._resolve_library(base))
    local_data = Path(_legacy.resolve_data_dir())
    mapping: dict[str, Path] = {
        "VAULT": base,
        "ASSETS": base / "Assets",
        "DATABASES": base / "BD",
        "REGISTRY": base / "BD" / "vault_db_registry.json",
        "CALENDAR": base / "Calendar",
        "MAIL": base / "Mail",
        "PLANTILLES": base / "Templates",
        "DIBUIXOS": base / "Drawings",
        "WIKI": base / "Wiki",
        "DAILY": base / "Daily Notes",
        "DASHBOARDS": base / ".Dashboards",
        "NEWSLETTERS": base / "Newsletters",
        "GNOSI_CONFIG": base / ".gnosi",
        "CUSTOM_ICONS": base / ".gnosi" / "vault_custom_icons.json",
        "LOCAL_DATA": local_data,
        "LOCAL_CACHE": local_data / "cache",
        "PAGE_INDEX_CACHE": local_data / "cache" / "vault_page_index.json",
        "LINK_INDEX_CACHE": local_data / "cache" / "vault_link_index.json",
        "INDEX_STATUS": local_data / "cache" / "indexer_status.json",
    }
    return mapping.get(key, base / key.lower())


def __getattr__(name: str) -> object:
    path_keys = {
        "VAULT_PATH": "VAULT",
        "ASSETS_PATH": "ASSETS",
        "BD_PATH": "DATABASES",
        "REGISTRY_PATH": "REGISTRY",
        "CALENDAR_PATH": "CALENDAR",
        "MAIL_PATH": "MAIL",
        "PLANTILLES_PATH": "PLANTILLES",
        "DIBUIXOS_PATH": "DIBUIXOS",
        "WIKI_PATH": "WIKI",
        "DAILY_PATH": "DAILY",
        "DASHBOARDS_PATH": "DASHBOARDS",
        "NEWSLETTERS_PATH": "NEWSLETTERS",
        "GNOSI_CONFIG_PATH": "GNOSI_CONFIG",
    }
    if name in path_keys:
        return _legacy.get_p(path_keys[name])
    if name == "_last_vault_sync_time":
        return _legacy.page_state.last_vault_sync_time
    if name == "_page_write_locks_guard":
        return _legacy.page_state.write_locks_guard
    link_state_names = {
        "_outlinks_by_source": "outlinks_by_source",
        "_outlink_kinds_by_source": "outlink_kinds_by_source",
        "_backlinks_by_target": "backlinks_by_target",
        "_backlinks_by_target_title": "backlinks_by_target_title",
        "_tokens_by_source": "tokens_by_source",
        "_page_meta_by_id": "page_meta_by_id",
        "_link_index_lock": "lock",
        "_link_index_built": "built",
        "_link_index_build_ts": "build_ts",
        "_link_index_source_count": "source_count",
        "_link_index_persist_pending": "persist_pending",
        "_link_index_persist_lock": "persist_lock",
        "_link_index_rebuild_in_progress": "rebuild_in_progress",
        "_link_index_rebuild_state_lock": "rebuild_state_lock",
    }
    if name in link_state_names:
        return getattr(_legacy.link_index_state, link_state_names[name])
    citation_state_names = {
        "_cite_key_index": "indexes",
        "_cite_key_index_size_at_build": "sizes_at_build",
        "_cite_key_index_lock": "lock",
    }
    if name in citation_state_names:
        return getattr(_legacy.citation_index_state, citation_state_names[name])
    raise AttributeError(f"module {__name__} has no attribute {name}")


def _link_index_view() -> LinkIndexView:
    if TYPE_CHECKING:
        from backend.api import vault_routes as module
    else:
        module = _legacy
    return _legacy.LinkIndexView(
        outlinks_by_source=module._outlinks_by_source,
        outlink_kinds_by_source=module._outlink_kinds_by_source,
        backlinks_by_target=module._backlinks_by_target,
        backlinks_by_target_title=module._backlinks_by_target_title,
        tokens_by_source=module._tokens_by_source,
        page_meta_by_id=module._page_meta_by_id,
        lock=module._link_index_lock,
        built=module._link_index_built,
        build_ts=module._link_index_build_ts,
        source_count=module._link_index_source_count,
        rebuild_in_progress=module._link_index_rebuild_in_progress,
        rebuild_state_lock=module._link_index_rebuild_state_lock,
    )


def _clear_page_index_cache() -> None:
    """Clears the internal page index cache and unmarks initialization so the
    next access rebuilds it.

    Without resetting the `_page_index_initialized` flag, callers (`list_pages`,
    `find_page_path`) believed the cache was populated and wouldn't trigger any
    rescan. Symptom: a newly created page appeared on disk but returned
    404 at `GET /api/vault/pages/{id}` until another `force_refresh`
    repopulated the cache.

    """
    with _page_index_lock:
        affected_vaults = list(_page_index_entries.keys())
        _page_index_entries.clear()
        for v_str in affected_vaults:
            _legacy._bump_page_index_version(v_str)
        _page_id_to_path.clear()
        _page_index_initialized.clear()
        _legacy.page_state.last_vault_sync_time = 0.0
        _legacy.log.info("♻️ Page index cache cleared (forcing a rebuild on the next access).")
        _page_index_initialized.clear()
        _legacy.log.info("♻️ Page index cache cleared.")


def purge_vault_caches(v_str: str) -> None:
    """Drops every per-vault cache (memory + disk) of ONE vault.

    Called on vault DELETION. `_clear_page_index_cache` wipes ALL vaults and
    leaves the disk files behind; here we surgically remove just the deleted
    vault's state so nothing survives under `local_data/cache/`.
    """
    if not v_str:
        return
    with _page_index_lock:
        _page_index_entries.pop(v_str, None)
        _page_index_initialized.pop(v_str, None)
        _page_id_to_path.pop(v_str, None)
        _legacy._bump_page_index_version(v_str)
    with _legacy._id_title_lock:
        _legacy._id_title_cache.pop(v_str, None)
    for path_fn in (
        _legacy.get_page_index_cache_path,
        _legacy._get_id_title_cache_path,
    ):
        try:
            p = path_fn(v_str)
            if p:
                _legacy.Path(p).unlink(missing_ok=True)
        except Exception:
            pass
    _legacy.log.info(f"♻️ Per-vault caches purged for deleted vault: {v_str}")


def sync_to_google_calendar_if_needed(
    metadata: PageMetadata, background_tasks: _legacy.BackgroundTasks
) -> None:
    source = metadata.get("source", "")
    if contains_value(source, "Google Calendar") and metadata.get("uid"):
        # The string pattern defines the match type; re validates the raw input.
        match = _legacy.re.search("\\((.*?)\\)", source)  # type: ignore[call-overload]
        if match:
            email = match.group(1)
            event_uid = metadata.get("uid")
            patch_data = {"summary": metadata.get("title")}
            if metadata.get("date"):
                patch_data["start"] = metadata.get("date")
            if metadata.get("end_date"):
                patch_data["end"] = metadata.get("end_date")
            from backend.services.google_calendar_service import update_google_event

            background_tasks.add_task(update_google_event, email, event_uid, patch_data)


class DrawingSaveRequest(BaseModel):
    __module__ = "backend.api.vault_routes"
    title: str
    data: dict[object, object]
    metadata: PageMetadata = {}


class DailyNoteRequest(BaseModel):
    __module__ = "backend.api.vault_routes"
    date: str


class OpenResourceRequest(BaseModel):
    __module__ = "backend.api.vault_routes"
    zotero_uri: str | None = None
    file_path: str | None = None
    attachments: object | None = None


_rule_engines: dict[str, "RuleEngine"] = {}
_rule_engine_lock = _legacy.threading.Lock()


def get_rule_engine() -> "RuleEngine":
    from backend.services.rule_engine import RuleEngine

    v_path = _active_vault_path()
    v_str = str(v_path)
    with _rule_engine_lock:
        if v_str not in _rule_engines:
            _legacy.log.info(f"Initializing RuleEngine for vault: {v_str}")
            _rule_engines[v_str] = RuleEngine(v_path)
        return _rule_engines[v_str]


def get_custom_icons_path() -> Path:
    return _legacy.assets_api.get_custom_icons_path()


_table_recalc_lock = _legacy.threading.Lock()
_table_recalc_state: dict[str, _legacy.formula_recalculation.RecalculationState] = {}
_TABLE_RECALC_COOLDOWN_SECONDS = 0.5
_page_index_lock = _legacy.page_state.index_lock
_page_index_entries = _legacy.page_state.index_entries
_page_index_initialized = _legacy.page_state.index_initialized
_page_id_to_path = _legacy.page_state.id_to_path
_VAULT_SYNC_COOLDOWN_SECONDS = 600
_page_index_version = _legacy.page_state.index_version
_pages_resp_cache_lock = _legacy.page_state.response_cache_lock
_pages_resp_cache = _legacy.page_state.response_cache
_page_write_locks = _legacy.page_state.write_locks


def _vault_cache_key() -> str:
    """Cache prefix tied to the ACTIVE VAULT: the page response cache must be per-vault
    (without this, in multi-vault setups one vault would serve another one's cached pages)."""
    from backend.services.context_vars import get_active_vault_path

    try:
        return str(get_active_vault_path() or "")
    except Exception:
        return ""


_GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS = 300


def get_page_index_cache_path(v_str: str | None = None) -> Path:
    p = _legacy.get_p("PAGE_INDEX_CACHE")
    if not p:
        p = _legacy.resolve_data_dir() / "cache" / "vault_page_index.json"
    if v_str:
        digest = _legacy.hashlib.sha256(v_str.encode("utf-8")).hexdigest()[:16]
        return p.with_name(f"{p.stem}_{digest}{p.suffix}")
    if p:
        return p
    return _legacy.resolve_data_dir() / "cache" / "vault_page_index.json"


_indexer_status_lock = _legacy.page_state.indexer_status_lock
_indexer_status_by_vault = _legacy.page_state.indexer_status_by_vault
_preview_cache_lock = _legacy.page_state.preview_cache_lock
_preview_cache = _legacy.page_state.preview_cache
_PREVIEW_WARM_PER_ITEM_TIMEOUT_S = 30.0
_PREVIEW_WARM_CONCURRENCY = 8
_preview_inflight = _legacy.page_state.preview_inflight
_preview_inflight_lock = _legacy.page_state.preview_inflight_lock


def _index_warmup_enabled(v_path: _legacy.Path) -> bool:
    """Whether the startup index warmup should run, auto-detected by runtime.

    Env override: `GNOSI_INDEX_WARMUP` = 1/true/on to force it on, 0/false/off
    to force it off.

    The warmup walks and stats the whole vault. On a macOS File-Provider mount
    (`~/Library/CloudStorage/…` — OneDrive et al.) that walk returned EDEADLK en
    masse and wedged the indexer, which is why the call used to be commented out
    entirely. But that is a macOS/cloud-mount problem: under Docker or a Linux
    self-host the vault is a plain bind mount, the walk is cheap, and the warmup
    is still worth running. Hard-disabling it punished those deployments for a
    fault they cannot hit.

    Skipping on the cloud mount costs little today: the page index, id→title
    index, link index and body/parsed-doc caches are all preloaded from
    `lifespan` startup, and the periodic background sync
    (`_VAULT_SYNC_COOLDOWN_SECONDS`) still picks up external changes.
    """
    override = _legacy.os.environ.get("GNOSI_INDEX_WARMUP", "").strip().lower()
    if override in {"1", "true", "on", "yes"}:
        return True
    if override in {"0", "false", "off", "no"}:
        return False
    if _legacy.sys.platform == "darwin" and "/Library/CloudStorage/" in str(v_path):
        return False
    return True


def kickoff_index_warmup(v_path: _legacy.Path) -> None:
    """Launch a background thread to populate the page index.

    Safe to call on startup or on settings change. Idempotent: if the indexer
    is already running for this vault, this call is a no-op.

    Why a thread (not asyncio.create_task): the underlying scan is filesystem-
    heavy and cloud-mount-bound — running it in a thread keeps the asyncio
    event loop responsive even if FUSE blocks for tens of seconds.
    """
    if not v_path or not v_path.exists():
        return
    v_str = str(v_path)
    if not _index_warmup_enabled(v_path):
        _legacy.log.info(
            "⏭️ Index warmup skipped for this runtime (macOS File-Provider mount; override with GNOSI_INDEX_WARMUP=1)"
        )
        return
    _legacy.page_state.last_vault_sync_time = _legacy.time.monotonic()
    try:
        _legacy._load_body_cache_from_disk()
    except Exception as e:
        _legacy.log.warning(f"body-cache load skipped: {e}")
    with _indexer_status_lock:
        cur = _indexer_status_by_vault.get(v_str, {})
        if cur.get("state") == "running":
            return
        _indexer_status_by_vault[v_str] = {
            "state": "running",
            "started_at": _legacy.time.time(),
            "finished_at": None,
            "files_indexed": 0,
            "error": None,
        }

    def _run() -> None:
        try:
            _legacy._load_id_title_from_disk(v_str)
            _legacy._refresh_id_title_index(v_str)
        except Exception as e:
            _legacy.log.warning(f"id-title warmup skipped: {e}")
        try:
            loaded = _load_page_index_from_disk(v_str)
            if loaded:
                with _page_index_lock:
                    n = len(_page_index_entries.get(v_str, {}))
                _legacy._set_indexer_status(
                    v_str, state="ready", finished_at=_legacy.time.time(), files_indexed=n
                )
                _legacy.kickoff_link_index_rebuild()
                try:
                    _legacy._get_cached_page_entries(force_refresh=True)
                    with _page_index_lock:
                        n = len(_page_index_entries.get(v_str, {}))
                    _legacy._set_indexer_status(v_str, files_indexed=n)
                except Exception as e:
                    _legacy.log.warning(f"Background index refresh failed: {e}")
                return
            _legacy._get_cached_page_entries(force_refresh=True)
            with _page_index_lock:
                n = len(_page_index_entries.get(v_str, {}))
            _legacy._set_indexer_status(
                v_str, state="ready", finished_at=_legacy.time.time(), files_indexed=n
            )
            _legacy.kickoff_link_index_rebuild()
        except Exception as e:
            _legacy.log.error(f"Indexer warmup failed for {v_str}: {e}")
            _legacy._set_indexer_status(
                v_str, state="error", finished_at=_legacy.time.time(), error=str(e)
            )

    t = _legacy.threading.Thread(target=_run, daemon=True, name=f"indexer-warmup-{v_str}")
    t.start()


def _save_page_index_to_disk(v_str: str) -> None:
    """Persists the in-memory cache for a specific vault to disk."""
    try:
        cache_path = get_page_index_cache_path(v_str)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with _page_index_lock:
            data = dict(_page_index_entries.get(v_str, {}))
        if data:
            _legacy.safe_write_json(cache_path, data, indent=2, ensure_ascii=False)
            _legacy.log.info(f"💾 Page index cache saved to disk for {v_str}")
    except Exception as e:
        _legacy.log.error(f"❌ Error saving page index cache for {v_str}: {e}")


def _load_page_index_from_disk(v_str: str) -> bool:
    """Loads the persistent cache for a specific vault into memory."""
    try:
        cache_path = get_page_index_cache_path(v_str)
        if not cache_path.exists():
            legacy_path = get_page_index_cache_path()
            if legacy_path.exists() and legacy_path != cache_path:
                _legacy.log.info(
                    f"📂 Using legacy page index cache (no per-vault file yet): {legacy_path}"
                )
                cache_path = legacy_path
        if cache_path.exists():
            data, id_map, files_ordered = prepare_page_index(
                _legacy.json.loads(cache_path.read_text(encoding="utf-8")), _legacy.Path
            )
            with _page_index_lock:
                _page_index_entries[v_str] = data
                _page_index_initialized[v_str] = True
                _legacy._bump_page_index_version(v_str)
                _page_id_to_path[v_str] = id_map
                try:
                    _legacy.path_resolver.update_index(_legacy.Path(v_str), id_map, files_ordered)
                except Exception as e:
                    _legacy.log.warning(f"PathResolver update from disk cache failed: {e}")
            _legacy.log.info(
                f"📂 Page index cache loaded from disk for {v_str} ({len(data)} entries)"
            )
            return True
    except Exception as e:
        _legacy.log.error(f"❌ Error loading page index cache for {v_str}: {e}")
    return False


def preload_page_index_from_disk(v_path: _legacy.Path) -> bool:
    """Public startup-safe wrapper to preload one vault's page index cache."""
    if not v_path:
        return False
    return _load_page_index_from_disk(str(v_path))


_normalize_custom_icons = _legacy.normalize_custom_icons


def _load_custom_icons() -> list[str]:
    return _legacy.assets_api._load_custom_icons()


def _save_custom_icons(values: list[str]) -> list[str]:
    return _legacy.assets_api._save_custom_icons(values)


def _is_image_upload(file: _legacy.UploadFile) -> bool:
    return _legacy.assets_api._is_image_upload(file)


def _upload_image_to_assets_subdir(file: _legacy.UploadFile, subdir: str) -> dict[str, str]:
    return _legacy.assets_api._upload_image_to_assets_subdir(file, subdir)


def _normalize_icon_extension(filename: str, content_type: str) -> str:
    return _legacy.assets_api._normalize_icon_extension(filename, content_type)


def _store_icon_bytes(payload: bytes, source_name: str, content_type: str) -> dict[str, str | None]:
    return _legacy.assets_api._store_icon_bytes(payload, source_name, content_type)


def _maybe_create_icon_thumbnail(icon_path: _legacy.Path, digest: str) -> str | None:
    return _legacy.assets_api._maybe_create_icon_thumbnail(icon_path, digest)


def _normalize_resource_title(value: str) -> str:
    return _legacy.table_rows._normalize_resource_title(value)


def _resource_visible_record(page: _legacy.PageInfo) -> bool:
    return _legacy.table_rows._resource_visible_record(page)


def _canonical_visible_table_pages(
    table_id: str, pages: list[_legacy.PageInfo]
) -> list[_legacy.PageInfo]:
    return _legacy.table_rows.canonical_visible_table_pages(table_id, pages)


def is_calendar_entry(metadata: PageMetadata | None) -> bool:
    """Decides if a page should be saved as a calendar appointment."""
    if not metadata:
        return False
    if str(metadata.get("note_type") or "").strip().lower() == "daily":
        return False
    stripped: object = operator.methodcaller("strip")(metadata.get("source") or "")
    source: object = operator.methodcaller("lower")(stripped)
    has_date = bool(metadata.get("date"))
    has_table = bool(_legacy.get_table_id(metadata))
    return has_date and (source in {"gnosi", "gnosi vault"} or not has_table)


def init_vault() -> None:
    """Initializes the basic environment."""
    if not _legacy.get_p("VAULT"):
        _legacy.log.info("⚠️ Bunker in 'pending' mode: Starting without structural Vault path.")
        return
    paths_to_create = [
        _legacy.get_p("VAULT"),
        _legacy.get_p("ASSETS"),
        _legacy.get_p("CALENDAR"),
        _legacy.get_p("DIBUIXOS"),
        _legacy.get_p("DATABASES"),
        _legacy.get_p("DEFAULT_DB"),
        _legacy.get_p("DEFAULT_TABLE"),
        _legacy.get_p("WIKI"),
        _legacy.get_p("DASHBOARDS"),
    ]
    for p in paths_to_create:
        if p:
            try:
                p.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                _legacy.log.error(f"Error initializing structural directory {p}: {e}")


def ensure_default_registry_structure() -> None:
    """Ensures the existence of the default DB and an initial table."""
    _legacy.registry_defaults.ensure_default_registry_structure(
        _legacy.default_registry_dependencies
    )


def _ensure_default_registry_structure_locked() -> None:
    """Compatibility adapter for callers already holding the registry lock."""
    _legacy.registry_defaults.ensure_default_registry_structure(
        _legacy.default_registry_dependencies
    )
