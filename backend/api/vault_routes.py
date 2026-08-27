import os
import time
import logging
import unicodedata
import shutil
from contextlib import contextmanager
from pathlib import Path
from fastapi import (
    APIRouter,
    HTTPException,
    Body,
    BackgroundTasks,
    File,
    Form,
    UploadFile,
    Query,
    Depends,
    Request,
)
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any, Tuple, Iterable
from datetime import datetime, timezone, timedelta
import logging
import urllib.parse
import mimetypes
import base64
import hashlib
import yaml
import re
import json
import requests
import uuid
import shutil
import threading
import time
import sys
import subprocess
try:
    from PIL import Image
except Exception:
    Image = None
from backend.config.app_config import load_params
from backend.config.data_dir import resolve_data_dir
from backend.config.env_config import default_host_helper_url, default_thumb_daemon_url
from backend.services.content_revision import path_collection_revision
from backend.services.rule_engine import RuleEngine
log = logging.getLogger(__name__)

from backend.services.path_resolver import path_resolver
from backend.services.frontmatter_fallback import parse_frontmatter_fallback
from backend.services.page_sidecar import (
    apply_sidecar_to,
    persist_sidecar_from,
    delete_sidecar as delete_sidecar_for_page,
    vault_root_for,
    split_metadata as split_sidecar_metadata,
)
from backend.utils.safe_io import (
    safe_write_text,
    safe_write_json,
    safe_write_bytes,
    file_etag,
    file_mtime_ns,
    sanitize_path_segment,
    sanitize_rel_folder,
    sanitize_vault_title,
)
from backend.utils.errors import safe_error_detail
import asyncio

from backend.services.workspace_service import get_workspace_context, require_role
from backend.services.plugin_access import require_plugins
from backend.services.vault_routing import canonical_vault_browser_path
router = APIRouter(dependencies=[Depends(get_workspace_context)])

from backend.services.context_vars import get_active_vault_path
from backend.services.relation_links import (
    RELATION_WIKILINK_RE,
    TITLE_ONLY_WIKILINK_RE,
    decorate_relation_wikilinks,
    relation_keys_from_table,
    strip_relation_wikilinks,
)
from backend.services.view_snapshot import (
    DEFAULT_MAX_ITEMS as _VIEW_SNAPSHOT_DEFAULT_LIMIT,
    apply_joins,
    compact_view_fences,
    inject_view_snapshots,
    rematerialize_md,
    resolve_row_ids,
    resolve_rows,
    restore_view_fences,
    strip_view_snapshots,
    render_view_snapshots,
    flatten_view_columns,
)
from backend.services.relation_links import _decorate_item as _decorate_relation_item
from backend.services.workspace_service import get_workspace_context, WorkspaceContext
from backend.services.media_service import media_service
from backend.platform.files import get_files_provider
from backend.api.virtual_fields import (
    inject_for_table as _vf_inject_for_table,
    inject_for_single_page as _vf_inject_for_single_page,
    list_virtual_field_specs as _vf_list_specs,
)
from backend.services.field_resolver import (
    to_response_names,
    to_storage_names,
)
from backend.services.translation_helpers import (
    find_translations_of,
    translatable_content_changed,
    detect_record_source_lang,
    detect_record_lang_raw,
    language_field_assignment,
    is_composite_image_value,
    is_image_field_name,
    translate_image_field,
)
from backend.services import translation_index
from backend.services import action_rules as action_rules_service
from backend.services import builtin_plugins
from backend.services import option_catalogs as option_catalogs_service
from backend.services.table_system_dates import (
    ensure_system_date_properties,
    stamp_system_dates,
)
from backend.domains.vault.schemas.pages import (
    PageInfo,
    PagePatchRequest,
    PageSaveRequest,
    SidebarPageInfo,
    TablePagesSnapshot,
    _BulkWarmPayload,
)
from backend.domains.vault.pages.state import page_state
from backend.domains.vault.pages import index_entries as page_index_entries
from backend.domains.vault.pages import index_service as page_index_service
from backend.domains.vault.pages import resolver as page_resolver
from backend.domains.vault.pages.index_entries import (
    build_cache_entry_from_memory as _build_cache_entry_from_memory,
    build_page_cache_entry as _build_page_cache_entry,
    humanize_relation_index_title as _humanize_relation_index_title,
    is_metadata_stub as _is_metadata_stub,
    read_frontmatter_partial as _read_frontmatter_partial,
)
from backend.domains.vault.pages.index_service import (
    bump_page_index_version as _bump_page_index_version,
    get_cached_page_entries as _get_cached_page_entries,
    get_pages_snapshot as _get_pages_snapshot,
    refresh_page_index_entry as _refresh_page_index_entry,
    refresh_table_pages_metadata as _refresh_table_pages_metadata,
)
from backend.domains.vault.pages.identifiers import (
    HISTORY_TIMESTAMP_RE as _HISTORY_TIMESTAMP_RE,
    PAGE_ID_RE as _PAGE_ID_RE,
    validate_history_timestamp as _validate_history_timestamp,
    validate_safe_page_id as _validate_safe_page_id,
)
from backend.domains.vault.pages.cache import (
    PAGES_RESPONSE_CACHE_TTL as _PAGES_RESP_CACHE_TTL,
    PREVIEW_CACHE_MAX as _PREVIEW_CACHE_MAX,
    get_cached_page_response as _pages_cache_get,
    get_cached_preview as _preview_cache_get,
    get_indexer_status,
    get_page_write_lock as _get_page_write_lock,
    invalidate_cached_preview as _preview_cache_invalidate,
    invalidate_page_responses as _pages_cache_invalidate_all,
    set_cached_page_response as _pages_cache_set,
    set_cached_preview as _preview_cache_set,
    set_indexer_status as _set_indexer_status,
)
from backend.domains.vault.history.repository import HistoryRepository
from backend.domains.vault.api import history as history_api
from backend.domains.vault.api import trash as trash_api
from backend.domains.vault.api import pages_queries as page_queries_api
from backend.domains.vault.pages import create_service as page_create_service
from backend.domains.vault.api import pages_duplicate as page_duplicate_api
from backend.domains.vault.pages import save_service as page_save_service
from backend.domains.vault.pages import patch_service as page_patch_service
from backend.domains.vault.api import pages_commands as page_commands_api
from backend.domains.vault.trash.repository import TrashRepository
from backend.domains.vault.registry import api as registry_api
from backend.domains.vault.registry import defaults as registry_defaults
from backend.domains.vault.registry.names import (
    is_main_or_locked_view as registry_is_main_or_locked_view,
    main_view_fields as registry_main_view_fields,
    normalize_main_view_configuration as registry_normalize_main_view_configuration,
    normalize_registry_table_view_names as registry_normalize_table_view_names,
    normalize_table_view_name as registry_normalize_table_view_name,
    sort_key_name as registry_sort_key_name,
    table_name_from_registry as registry_table_name,
)
from backend.domains.vault.registry.repository import (
    RegistryRepository,
    RegistryRepositoryDependencies,
)
from backend.domains.vault.registry.state import registry_state
from backend.domains.vault.tables import api as table_collection_api
from backend.domains.vault.tables import lifecycle as table_lifecycle
from backend.domains.vault.tables import options as table_options
from backend.domains.vault.tables import rows as table_rows
from backend.domains.vault.tables import schema as table_schema
from backend.domains.vault.views import api as vault_views
from backend.domains.vault.views import schema as vault_view_schema
from backend.domains.vault.views import snapshots as vault_view_snapshots


registry_repository = RegistryRepository(
    dependencies=RegistryRepositoryDependencies(
        registry_path=lambda: get_p("REGISTRY"),
        normalize_folder=lambda value: _normalize_rel_folder(value),
        ensure_table_folder=lambda table, registry: _ensure_table_vault_folder(
            table, registry
        ),
        ensure_status_catalog=lambda registry: _ensure_registry_status_catalog(
            registry
        ),
        write_json=safe_write_json,
    ),
    state=registry_state,
    logger=log,
)
registry_api_dependencies = registry_api.RegistryApiDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    sort_key=lambda item: _sort_key_name(item),
    safe_error_detail=safe_error_detail,
    logger=log,
)
default_registry_dependencies = registry_defaults.DefaultRegistryDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    registry_path=lambda: get_p("REGISTRY"),
    overwrite_is_risky=lambda path: _degenerate_overwrite_is_risky(path),
    state=registry_state,
    logger=log,
)
table_collection_dependencies = table_collection_api.TableCollectionDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    sort_key=lambda item: _sort_key_name(item),
)
table_property_dependencies = table_schema.PropertyDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    get_prop_options=option_catalogs_service.get_prop_options,
    set_prop_options=option_catalogs_service.set_prop_options,
    normalize_options=option_catalogs_service.normalize_options,
    option_types=frozenset(option_catalogs_service.OPTION_TYPES),
)
table_create_dependencies = table_lifecycle.CreateTableDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    configured_language=lambda: _configured_table_language(),
    ensure_system_dates=ensure_system_date_properties,
    normalize_folder=lambda value: _normalize_rel_folder(value),
    sanitize_folder=sanitize_rel_folder,
    is_asset_property=lambda prop: _is_asset_property(prop),
    delete_asset_property=lambda table, database, name: _delete_asset_property_dir(
        table, database, name
    ),
    ensure_asset_directories=lambda table, registry: _ensure_asset_dirs_for_table_entry(
        table, registry
    ),
    ensure_table_folder=lambda table, registry: _ensure_table_vault_folder(
        table, registry
    ),
    ensure_table_seeds=option_catalogs_service.ensure_table_seeds,
    ensure_global_status_catalog=option_catalogs_service.ensure_global_status_catalog,
    ensure_action_rules=action_rules_service.ensure_action_rules,
)
table_delete_dependencies = table_lifecycle.DeleteTableDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    vault_root=lambda: get_p("VAULT"),
    stable_revision=lambda value: _stable_value_revision(value),
    views_revision=lambda registry, table_id: _table_views_revision(
        registry, table_id
    ),
    quarantine_assets=lambda table, database: _quarantine_table_asset_dirs(
        table, database
    ),
    quarantined_revision=lambda table, database, moved: _quarantined_table_asset_revision(
        table, database, moved
    ),
    restore_quarantine=lambda quarantine, moved: _restore_quarantined_table_assets(
        quarantine, moved
    ),
    mark_quarantine_ready=lambda quarantine: _mark_table_asset_quarantine_ready(
        quarantine
    ),
    delete_quarantine=lambda quarantine, vault_root: _delete_table_asset_quarantine(
        quarantine, vault_root
    ),
    logger=log,
)
table_rename_dependencies = table_lifecycle.RenameTableDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    assets_root=lambda: get_p("ASSETS"),
    sanitize_title=sanitize_vault_title,
    sanitize_folder=sanitize_rel_folder,
    sanitize_asset_segment=lambda value, fallback: _sanitize_asset_segment(
        value, fallback
    ),
    asset_segments_collide=lambda first, second: _asset_segments_collide(
        first, second
    ),
    move_loose_files=lambda source, destination: _move_loose_files(
        source, destination
    ),
    table_vault_directory=lambda table, registry: _table_vault_dir(
        table, registry
    ),
    ensure_asset_directories=lambda table, registry: _ensure_asset_dirs_for_table_entry(
        table, registry
    ),
    ensure_table_folder=lambda table, registry: _ensure_table_vault_folder(
        table, registry
    ),
    rewrite_inline_asset_refs=lambda table_dir, old, new: _rewrite_inline_asset_refs(
        table_dir, old, new
    ),
    logger=log,
)
table_option_dependencies = table_options.OptionDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    pages_for_table=lambda table_id: _get_pages_for_table(table_id),
    find_page=lambda page_id, allow_full_scan=True: find_page_path(
        page_id,
        allow_full_scan=allow_full_scan,
    ),
    materialize=lambda path, reason: _materialize_if_online_only(path, reason),
    parse_frontmatter=lambda raw, path: parse_frontmatter(raw, path),
    save_page=lambda path, metadata, body: save_page_md(path, metadata, body),
    refresh_page_cache=lambda path, metadata, body, row: _refresh_option_rewrite_cache(
        path, metadata, body, row
    ),
    invalidate_page_responses=_pages_cache_invalidate_all,
    read_prop_value=action_rules_service.read_prop_value,
    get_prop_config=option_catalogs_service.get_prop_config,
    get_prop_options=lambda prop, catalogs=None: option_catalogs_service.get_prop_options(
        prop, catalogs
    ),
    set_prop_options=option_catalogs_service.set_prop_options,
    normalize_options=option_catalogs_service.normalize_options,
    auto_color=option_catalogs_service.auto_color,
    is_global_status_prop=option_catalogs_service.is_global_status_prop,
    status_catalog_ref=option_catalogs_service.STATUS_CATALOG_REF,
    logger=log,
)
vault_view_dependencies = vault_views.ViewDependencies(
    load_registry=lambda: load_registry(),
    save_registry=lambda data: save_registry(data),
    registry_mutation=lambda: registry_mutation(),
    sort_key=lambda item: _sort_key_name(item),
    pages_snapshot=lambda: _get_pages_snapshot(),
    logger=log,
)
vault_schema_dependencies = vault_view_schema.SchemaDependencies(
    vault_root=lambda: get_p("VAULT"),
    write_json=lambda path, data, indent: safe_write_json(
        path, data, indent=indent
    ),
    logger=log,
)
vault_view_snapshot_dependencies = vault_view_snapshots.SnapshotDependencies(
    pages_for_table=lambda table_id: _get_pages_for_table(table_id),
    table_by_id=lambda table_id: _table_by_id(table_id),
    inject_virtual_fields=_vf_inject_for_table,
    virtual_page_loader=lambda table_id: table_rows.virtual_page_loader(
        table_id, table_row_query_dependencies
    ),
    response_names=lambda metadata, table: to_response_names(metadata, table),
    load_registry=lambda: load_registry(),
    apply_joins=apply_joins,
    resolve_row_ids=resolve_row_ids,
    resolve_rows=resolve_rows,
    decorate_relation=lambda value: _decorate_relation_item(
        value, _link_index_title_for, None
    ),
    link_title=lambda page_id: _link_index_title_for(page_id),
    default_limit=_VIEW_SNAPSHOT_DEFAULT_LIMIT,
    documents=lambda: _iter_linkable_page_documents(),
    resolve_page_id=lambda metadata, path: _resolve_page_id_from_metadata(
        metadata, path
    ),
    rematerialize=rematerialize_md,
    write_text=lambda path, content: safe_write_text(path, content),
    logger=log,
)
table_row_query_dependencies = table_rows.TableRowQueryDependencies(
    vault_cache_key=lambda: _vault_cache_key(),
    cache_get=lambda key: _pages_cache_get(key),
    cache_set=lambda key, pages: _pages_cache_set(key, pages),
    cached_entries=lambda: _get_cached_page_entries(force_refresh=False),
    load_registry=lambda: load_registry(),
    hidden_event_ids=lambda: _hidden_calendar_event_ids(),
    humanize_title=lambda title, metadata: _humanize_relation_index_title(
        title, metadata
    ),
    table_by_id=lambda table_id: _table_by_id(table_id),
    refresh_metadata=lambda pages: _refresh_table_pages_metadata(pages),
    inject_virtual_fields=_vf_inject_for_table,
    response_names=lambda metadata, table: to_response_names(metadata, table),
    vault_root=lambda: get_p("VAULT"),
    logger=log,
)
table_metadata_dependencies = table_rows.TableMetadataDependencies(
    table_id=lambda metadata: get_table_id(metadata),
    table_by_id=lambda table_id: _table_by_id(table_id),
    storage_names=lambda metadata, table: to_storage_names(metadata, table),
    stamp_system_dates=stamp_system_dates,
    option_types=frozenset(option_catalogs_service.OPTION_TYPES),
    prop_config=option_catalogs_service.get_prop_config,
    read_prop_value=action_rules_service.read_prop_value,
    effect_write_key=action_rules_service.effect_write_key,
)

# Compatibility aliases. The mutable objects and lock are owned only by
# ``backend.domains.vault.registry.state``.
_registry_cache = registry_state.cache
_registry_cache_mtime = registry_state.cache_mtime
_registry_cache_ts = registry_state.cache_timestamp
_registry_cache_ttl_seconds = registry_state.cache_ttl_seconds
_registry_ensured_tables = registry_state.ensured_tables
_registry_seen_nondegenerate = registry_state.seen_nondegenerate
_registry_mutation_lock = registry_state.mutation_lock


def _ensure_registry_status_catalog(registry: dict) -> bool:
    """Run the optional legacy status-catalog migrator when it is available."""
    ensure_status_catalog = getattr(
        option_catalogs_service,
        "ensure_global_status_catalog",
        None,
    )
    return bool(
        ensure_status_catalog(registry) if callable(ensure_status_catalog) else False
    )


def _configured_table_language() -> str:
    try:
        return str(load_params(strict_env=False).settings.get("language") or "en")
    except Exception:
        return "en"


def _refresh_option_rewrite_cache(
    file_path: Path,
    metadata: dict,
    body: str,
    row: PageInfo,
) -> None:
    """Refresh the existing page-index owner after an option row rewrite."""
    vault_path = get_active_vault_path()
    if not vault_path:
        return
    vault_key = str(vault_path)
    stat_result = file_path.stat()
    entry = _build_cache_entry_from_memory(file_path, stat_result, metadata, body)
    with _page_index_lock:
        _page_index_entries.setdefault(vault_key, {})[str(file_path)] = entry
        _page_id_to_path.setdefault(vault_key, {})[
            str(metadata.get("id") or row.id)
        ] = str(file_path)
        _bump_page_index_version(vault_key)


def _hidden_calendar_event_ids() -> set[str]:
    from backend.api.calendar_routes import _get_hidden_event_ids

    return {str(value) for value in _get_hidden_event_ids()}


from backend.domains.vault.assets import api as assets_api
from backend.domains.vault.assets import service as assets_service
from backend.domains.vault.assets.schemas import CustomIconsRequest, IconUrlImportRequest
from backend.domains.vault.assets.state import CustomIconStore, normalize_custom_icons
from backend.domains.vault.files import api as files_api
from backend.domains.vault.files import host_trash as file_host_trash
from backend.domains.vault.files import local_service as file_local_service
from backend.domains.vault.files import property_service as property_file_service
from backend.domains.vault.files import serving as file_serving
from backend.domains.vault.files.state import LocalLinkStore, file_serving_state
from backend.domains.vault.files import thumbnails as file_thumbnails
from backend.domains.vault.files.thumbnails import ThumbnailDependencies


from backend.domains.vault.comments import api as comments_api
from backend.domains.vault.comments import repository as comments_repository
from backend.domains.vault.comments.schemas import (
    CommentCreateRequest,
    CommentUpdateRequest,
    InlineCommentPatch,
    InlineCommentRequest,
)
from backend.domains.vault.comments.state import (
    inline_comments_mutation_lock as _inline_comments_mutation_lock,
    page_comments_io_lock as _comments_lock,
    page_comments_mutation_lock as _comments_mutation_lock,
)
from backend.domains.vault.links.api import mentions as link_mentions_api
from backend.domains.vault.links.api import navigation as link_navigation_api
from backend.domains.vault.links.api import overview as link_overview_api
from backend.domains.vault.links.api import preview as link_preview_api
from backend.domains.vault.links.api.dependencies import LinkApiDependencies
from backend.domains.vault.links import index_service as link_index_service
from backend.domains.vault.links import parsing as link_parsing
from backend.domains.vault.links.schemas import LinkMentionsRequest
from backend.domains.vault.links.state import LinkIndexView, link_index_state
from backend.domains.vault.citations import authors as citation_authors
from backend.domains.vault.citations import formatting as citation_formatting
from backend.domains.vault.citations import io_api as citation_io_api
from backend.domains.vault.citations import keys as citation_keys
from backend.domains.vault.citations import keys_api as citation_keys_api
from backend.domains.vault.citations import references_api as citation_references_api
from backend.domains.vault.citations import search as citation_search
from backend.domains.vault.citations.references_api import (
    REFERENCE_SCHEMA as _REFERENCE_SCHEMA,
)
from backend.domains.vault.citations.state import citation_index_state


def _table_by_id(table_id: str) -> Optional[dict]:
    """Return one table through the canonical registry domain."""
    return registry_api.table_by_id(table_id, registry_api_dependencies)

# Library resolution (vault-first + legacy fallback): a single source of truth,
# shared with media_service and the Notion clone. See services/library_paths.py.
from backend.services.library_paths import (  # noqa: E402
    library_roots as _library_roots,
    resolve_library as _resolve_library,
)


# Helper function to get active paths
def get_p(key: str) -> Path:
    from backend.services.context_vars import get_active_vault_path
    base = get_active_vault_path()

    # LIBRARY is resolved separately (vault-first with legacy fallback) and BEFORE the dict:
    # putting it in the mapping would trigger a stat() on OneDrive on EVERY call to get_p for
    # any key (the whole dict gets evaluated); this way the cost is only paid when it's requested.
    if key == "LIBRARY":
        return _resolve_library(base)

    # Local-only data root (Docker volume, never on cloud-synced storage).
    # Resolved from env to match paths_config.py.
    local_data = resolve_data_dir()

    # Mapping of standard sub-folders
    mapping = {
        "VAULT": base,
        "ASSETS": base / "Assets",
        # (LIBRARY is resolved in get_p, BEFORE this dict: vault-first with
        # fallback to the sibling arrival — see _library_roots/_resolve_library.)
        "DATABASES": base / "BD",
        # The REGISTRY is now a file inside BD
        "REGISTRY": base / "BD" / "vault_db_registry.json",
        "CALENDAR": base / "Calendar",
        "MAIL": base / "Mail",
        "PLANTILLES": base / "Templates",
        "DIBUIXOS": base / "Drawings",
        "WIKI": base / "Wiki",
        "DAILY": base / "Daily Notes",
        "DASHBOARDS": base / ".Dashboards",
        "NEWSLETTERS": base / "Newsletters",
        # Vault-first synced configs live in `.gnosi/`. The folder
        # legacy `data/` in the vault is no longer used.
        "GNOSI_CONFIG": base / ".gnosi",
        "CUSTOM_ICONS": base / ".gnosi" / "vault_custom_icons.json",
        # Local-only paths — caches, indices, system DBs. Mirror paths_config.py
        "LOCAL_DATA": local_data,
        "LOCAL_CACHE": local_data / "cache",
        "PAGE_INDEX_CACHE": local_data / "cache" / "vault_page_index.json",
        "LINK_INDEX_CACHE": local_data / "cache" / "vault_link_index.json",
        "INDEX_STATUS": local_data / "cache" / "indexer_status.json",
    }
    return mapping.get(key, base / key.lower())

def __getattr__(name: str):
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
        return get_p(path_keys[name])
    if name == "_last_vault_sync_time":
        return page_state.last_vault_sync_time
    if name == "_page_write_locks_guard":
        return page_state.write_locks_guard
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
        return getattr(link_index_state, link_state_names[name])
    citation_state_names = {
        "_cite_key_index": "indexes",
        "_cite_key_index_size_at_build": "sizes_at_build",
        "_cite_key_index_lock": "lock",
    }
    if name in citation_state_names:
        return getattr(citation_index_state, citation_state_names[name])
    raise AttributeError(f"module {__name__} has no attribute {name}")


def _link_index_view() -> LinkIndexView:
    module = sys.modules[__name__]
    return LinkIndexView(
        outlinks_by_source=getattr(module, "_outlinks_by_source"),
        outlink_kinds_by_source=getattr(module, "_outlink_kinds_by_source"),
        backlinks_by_target=getattr(module, "_backlinks_by_target"),
        backlinks_by_target_title=getattr(module, "_backlinks_by_target_title"),
        tokens_by_source=getattr(module, "_tokens_by_source"),
        page_meta_by_id=getattr(module, "_page_meta_by_id"),
        lock=getattr(module, "_link_index_lock"),
        built=getattr(module, "_link_index_built"),
        build_ts=getattr(module, "_link_index_build_ts"),
        source_count=getattr(module, "_link_index_source_count"),
        rebuild_in_progress=getattr(module, "_link_index_rebuild_in_progress"),
        rebuild_state_lock=getattr(module, "_link_index_rebuild_state_lock"),
    )


def _clear_page_index_cache():
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
            _bump_page_index_version(v_str)
        _page_id_to_path.clear()
        _page_index_initialized.clear()
        page_state.last_vault_sync_time = 0.0
        log.info("♻️ Page index cache cleared (forcing a rebuild on the next access).")
        # Without this, `_page_index_initialized[v_str]` stays True and the next
        # call to `_get_cached_page_entries` would silently return []
        # (it entered the fast path with the empty dict). By resetting the flag, the
        # next get loads from the disk cache again — which is still
        # valid because we haven't touched it here.
        _page_index_initialized.clear()
        log.info("♻️ Page index cache cleared.")


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
        _bump_page_index_version(v_str)
    with _id_title_lock:
        _id_title_cache.pop(v_str, None)
    for path_fn in (get_page_index_cache_path, _get_id_title_cache_path):
        try:
            p = path_fn(v_str)
            if p:
                Path(p).unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
    log.info(f"♻️ Per-vault caches purged for deleted vault: {v_str}")


def sync_to_google_calendar_if_needed(
    metadata: dict, background_tasks: BackgroundTasks
):
    source = metadata.get("source", "")
    if "Google Calendar" in source and metadata.get("uid"):
        match = re.search(r"\((.*?)\)", source)
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


# Base folders and files are now created during workspace activation (WorkspaceService)
# or initialized on demand in each route via get_p().


class DrawingSaveRequest(BaseModel):
    title: str
    data: dict
    metadata: dict = {}


class DailyNoteRequest(BaseModel):
    # ISO date (YYYY-MM-DD). The client sends its LOCAL date so the "today"
    # note matches the user's day regardless of server timezone.
    date: str


class OpenResourceRequest(BaseModel):
    zotero_uri: Optional[str] = None
    file_path: Optional[str] = None
    attachments: Optional[object] = None


# RuleEngine becomes a dictionary to store an instance for each vault_path (cache)
_rule_engines = {}
_rule_engine_lock = threading.Lock()

def get_rule_engine():
    from backend.services.context_vars import get_active_vault_path
    from backend.services.rule_engine import RuleEngine
    v_path = get_active_vault_path()
    v_str = str(v_path)
    
    with _rule_engine_lock:
        if v_str not in _rule_engines:
            log.info(f"Initializing RuleEngine for vault: {v_str}")
            _rule_engines[v_str] = RuleEngine(v_path)
        return _rule_engines[v_str]

# Instead of a global constant, we use a function
def get_custom_icons_path():
    return assets_api.get_custom_icons_path()

_table_recalc_lock = threading.Lock()
_table_recalc_state = {}
_TABLE_RECALC_COOLDOWN_SECONDS = 0.5
_page_index_lock = page_state.index_lock
# Page index also partitioned per vault
_page_index_entries = page_state.index_entries
_page_index_initialized = page_state.index_initialized
_page_id_to_path = page_state.id_to_path  # Cache for fast ID -> Path lookups per vault
# Cooldown for the vault index cache's automatic rescan. Raised from
# 60s to 600s because every rescan does a stat() on ~4200 OneDrive files
# (5-10 ms each = 20-40s of total I/O) which saturates the File Provider and
# blocks other backend operations. Changes made via PATCH/PUT
# are applied directly to the in-memory cache; this rescan only
# would detect external changes (OneDrive sync from another device, edits
# outside the backend). 10 min is enough for this case and leaves the backend
# responsive the rest of the time.
_VAULT_SYNC_COOLDOWN_SECONDS = 600

# Version counter bumped at every mutation of `_page_index_entries[v_str]`
# (load-from-disk, full replace, partial update, stale prune, page
# create/delete/save). So that DERIVED caches can depend on it:
# snapshot of the number and lazy rebuild when it diverges. (The old
# `_table_index_cache`, superseded by `_get_pages_for_table`, was the only
# consumer; the counter is kept as a mechanism for future
# derived caches and as a cheap signal that "the index has changed".)
_page_index_version = page_state.index_version
# ── PageInfo micro-cache (TTL ~1.5s) ──────────────────────────────────
# The endpoints `/pages`, `/by-table`, `/sidebar/summary`, `/global-index`
# fire at the same time on every frontend navigation. Without this cache,
# each one builds its Pydantic PageInfo objects from scratch (~80-140ms the
# fast-path or ~600ms+ for the full snapshot). Caching the results
# for a few seconds turns a burst of 4-6 calls within the same second into
# a single one that pays the real cost; the others are ~O(1) hits.
#
# Invalidation: on any write (PATCH/PUT/DELETE/move) that touches an entry. The
# invalidation is total (not surgical) because a single edit can affect
# several tables (changes to title, table_id, etc.) and the cost of
# rebuilding is very cheap once the loop has a cache_hit on the bytes
# that follow.
_pages_resp_cache_lock = page_state.response_cache_lock
_pages_resp_cache = page_state.response_cache

# ── Per-page write serialization ─────────────────────────────────────
# Without mutual exclusion keyed by `page_id`, two overlapping PATCHes to
# the same page interleave badly: PATCH #1 renames `Old.md` → `New.md`
# (title edit) and updates the in-memory path cache, while PATCH #2 —
# already past its `find_page_path` call — tries `read_text`/`rename` on
# the now-stale `Old.md` and raises FileNotFoundError → HTTP 500 → the
# frontend shows "Error desant markdown". DELETE racing with PATCH can
# also resolve a stale path (404). An asyncio.Lock per page_id forces the
# second caller to wait until the first has finished its read + rename +
# cache update, so `find_page_path` always returns the current path.
_page_write_locks = page_state.write_locks


def _vault_cache_key() -> str:
    """Cache prefix tied to the ACTIVE VAULT: the page response cache must be per-vault
    (without this, in multi-vault setups one vault would serve another one's cached pages)."""
    from backend.services.context_vars import get_active_vault_path
    try:
        return str(get_active_vault_path() or "")
    except Exception:
        return ""

# Google Calendar sync cooldown (5 minutes)
_GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS = 300

def get_page_index_cache_path(v_str: Optional[str] = None):
    # Local-only: this cache is per-instance and contains absolute paths that
    # only make sense on the machine that built it. Never on cloud storage.
    p = get_p("PAGE_INDEX_CACHE")
    if not p:
        # Fallback if LOCAL_DATA isn't configured for some reason
        p = resolve_data_dir() / "cache" / "vault_page_index.json"
    if v_str:
        digest = hashlib.sha256(v_str.encode("utf-8")).hexdigest()[:16]
        return p.with_name(f"{p.stem}_{digest}{p.suffix}")
    if p:
        return p
    return resolve_data_dir() / "cache" / "vault_page_index.json"


# ── Indexer status (background warmup state) ──────────────────────────────
# When the backend boots, the first request that needs the page index would
# trigger a synchronous full scan of the vault — on cloud-mounted storage
# (OneDrive FUSE) this can take 10-60s and block the asyncio event loop.
# We track status in-memory so the UI can show "indexing…" and so the warmup
# only runs once per vault per process.
_indexer_status_lock = page_state.indexer_status_lock
_indexer_status_by_vault = page_state.indexer_status_by_vault


# ── Preview cache (in-memory) ───────────────────────────────────────────────
# `get_page_preview` is O(seconds) over OneDrive online-only files: each
# call retries with backoff (~4.55s in the worst case) while the File
# Provider materializes the file. A feed of 77 entries = 77 × ~4.5s = more
# of 5 minutes serial. In-memory cache per page_id, invalidated by the mtime of the
# file: the first call does the work and leaves the data warm; the following ones
# are instant until the .md is modified. Size limited so it doesn't grow
# unchecked in large vaults. Real LRU (OrderedDict.move_to_end on every
# access), not just insertion FIFO.
_preview_cache_lock = page_state.preview_cache_lock
_preview_cache = page_state.preview_cache  # page_id -> {mtime, short, full}
_PREVIEW_WARM_PER_ITEM_TIMEOUT_S = 30.0
_PREVIEW_WARM_CONCURRENCY = 8


# In-flight dedup: if two concurrent requests ask for the same preview and
# both fall into the miss, without this mapping they would do the work at the same time. To
# efficiency and to avoid stressing OneDrive with duplicate requests, they share
# the same Future.
_preview_inflight = page_state.preview_inflight
_preview_inflight_lock = page_state.preview_inflight_lock


def _index_warmup_enabled(v_path: Path) -> bool:
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
    override = os.environ.get("GNOSI_INDEX_WARMUP", "").strip().lower()
    if override in {"1", "true", "on", "yes"}:
        return True
    if override in {"0", "false", "off", "no"}:
        return False
    # macOS File-Provider mount → skip (the EDEADLK case).
    if sys.platform == "darwin" and "/Library/CloudStorage/" in str(v_path):
        return False
    return True


def kickoff_index_warmup(v_path: Path) -> None:
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
    # Gate checked HERE and not at the call site so every caller (startup,
    # settings change) is covered by one rule.
    if not _index_warmup_enabled(v_path):
        log.info(
            "⏭️ Index warmup skipped for this runtime "
            "(macOS File-Provider mount; override with GNOSI_INDEX_WARMUP=1)"
        )
        return
    # Initialize the background sync timestamp so that the next
    # call to `_get_pages_snapshot` doesn't trigger a full rescan
    # immediately (4243 OneDrive stats ≈ 20-40s competing with the PATCH
    # requests from the user). This function's warmup already takes care of populating
    # the cache; the periodic sync is only needed every `_VAULT_SYNC_COOLDOWN_SECONDS`.
    page_state.last_vault_sync_time = time.monotonic()
    # Load the body cache persisted to disk. Without this, the first
    # `_rebuild_link_index` post-restart had to read ~3500 files
    # from OneDrive (~80-140s observed). With the disk cache loaded, we only
    # read the files whose mtime changed since the last flush.
    try:
        _load_body_cache_from_disk()
    except Exception as e:
        log.warning(f"body-cache load skipped: {e}")
    # NOTE: this function does NOT run on a macOS File-Provider mount (see
    # `_index_warmup_enabled`), so it is not a reliable place for startup work.
    # The body-cache load above is kept because it is harmless when this does
    # run, but the authoritative load of the body and parsed-doc caches happens
    # in `lifespan` startup — where it runs on every runtime. Put new startup
    # hooks THERE, not here.
    with _indexer_status_lock:
        cur = _indexer_status_by_vault.get(v_str, {})
        if cur.get("state") == "running":
            return
        _indexer_status_by_vault[v_str] = {
            "state": "running",
            "started_at": time.time(),
            "finished_at": None,
            "files_indexed": 0,
            "error": None,
        }

    def _run():
        # Warm up the id→title index (used by /global-index on every
        # page load): loads from disk and refreshes in the background. Avoids
        # the ~15s cold start of the first /global-index after a restart.
        try:
            _load_id_title_from_disk(v_str)
            _refresh_id_title_index(v_str)
        except Exception as e:
            log.warning(f"id-title warmup skipped: {e}")
        try:
            # 1. Try to load from local disk cache first (fast path)
            loaded = _load_page_index_from_disk(v_str)
            if loaded:
                with _page_index_lock:
                    n = len(_page_index_entries.get(v_str, {}))
                _set_indexer_status(
                    v_str, state="ready", finished_at=time.time(),
                    files_indexed=n,
                )
                # We trigger the link-index rebuild BEFORE the force_refresh.
                # If we left it for the end, a slow OneDrive rescan (which can
                # take minutes with 4000 files) would block the construction
                # of the wikilink index and the automatic rewriting on
                # rename wouldn't apply until later. kickoff_link_index_rebuild
                # already hosts its own thread, it doesn't block this flow.
                kickoff_link_index_rebuild()
                # Schedule a refresh in the background so the cache stays
                # warm against external changes — non-blocking.
                try:
                    _get_cached_page_entries(force_refresh=True)
                    with _page_index_lock:
                        n = len(_page_index_entries.get(v_str, {}))
                    _set_indexer_status(v_str, files_indexed=n)
                except Exception as e:
                    log.warning(f"Background index refresh failed: {e}")
                return
            # 2. No cache — full scan
            _get_cached_page_entries(force_refresh=True)
            with _page_index_lock:
                n = len(_page_index_entries.get(v_str, {}))
            _set_indexer_status(
                v_str, state="ready", finished_at=time.time(),
                files_indexed=n,
            )
            kickoff_link_index_rebuild()
        except Exception as e:
            log.error(f"Indexer warmup failed for {v_str}: {e}")
            _set_indexer_status(
                v_str, state="error", finished_at=time.time(), error=str(e),
            )

    t = threading.Thread(target=_run, daemon=True, name=f"indexer-warmup-{v_str}")
    t.start()

def _save_page_index_to_disk(v_str: str):
    """Persists the in-memory cache for a specific vault to disk."""
    try:
        cache_path = get_page_index_cache_path(v_str)
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        # CRITICAL: snapshot under the lock. The indexer thread mutates
        # `_page_index_entries[v_str]` while it walks the vault; serializing
        # the live reference can raise `dictionary changed size during
        # iteration` or, worse, write a partially-mutated JSON to disk.
        with _page_index_lock:
            data = dict(_page_index_entries.get(v_str, {}))
        if data:
            # Local cache lives on a Docker volume — atomic write prevents
            # half-written JSON when the container is killed mid-flush.
            safe_write_json(cache_path, data, indent=2, ensure_ascii=False)
            log.info(f"💾 Page index cache saved to disk for {v_str}")
    except Exception as e:
        log.error(f"❌ Error saving page index cache for {v_str}: {e}")

def _load_page_index_from_disk(v_str: str):
    """Loads the persistent cache for a specific vault into memory."""
    try:
        cache_path = get_page_index_cache_path(v_str)
        # Fallback to the legacy format (without per-vault suffix): previously
        # `get_page_index_cache_path` didn't accept `v_str` and all the
        # vaults shared `vault_page_index.json`. Without this fallback,
        # a hot upgrade that changes the signature left the disk cache
        # invisible and forced a full rescan (~12k files with Errno 35
        # bulk on slow OneDrive, ~hour of delay and empty app).
        if not cache_path.exists():
            legacy_path = get_page_index_cache_path()
            if legacy_path.exists() and legacy_path != cache_path:
                log.info(
                    f"📂 Using legacy page index cache (no per-vault file yet): {legacy_path}"
                )
                cache_path = legacy_path
        if cache_path.exists():
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            with _page_index_lock:
                _page_index_entries[v_str] = data
                _page_index_initialized[v_str] = True
                _bump_page_index_version(v_str)
                # We rebuild `_page_id_to_path` and update the
                # `path_resolver` from the cache as well. Without this, the
                # first time someone calls `path_resolver.list_all_files()`
                # (in `_iter_linkable_page_documents`) it will fall back to rglob
                # slow on OneDrive — we would lose the entire benefit of the disk cache.
                id_map = {}
                files_ordered = []
                for p_str, entry in data.items():
                    files_ordered.append(Path(p_str))
                    pid = entry.get("id")
                    if pid:
                        id_map[pid] = p_str
                _page_id_to_path[v_str] = id_map
                try:
                    path_resolver.update_index(Path(v_str), id_map, files_ordered)
                except Exception as e:
                    log.warning(f"PathResolver update from disk cache failed: {e}")
            log.info(f"📂 Page index cache loaded from disk for {v_str} ({len(data)} entries)")
            return True
    except Exception as e:
        log.error(f"❌ Error loading page index cache for {v_str}: {e}")
    return False


def preload_page_index_from_disk(v_path: Path) -> bool:
    """Public startup-safe wrapper to preload one vault's page index cache."""
    if not v_path:
        return False
    return _load_page_index_from_disk(str(v_path))

_normalize_custom_icons = normalize_custom_icons

def _load_custom_icons() -> List[str]:
    return assets_api._load_custom_icons()


def _save_custom_icons(values: List[str]) -> List[str]:
    return assets_api._save_custom_icons(values)


def _is_image_upload(file: UploadFile) -> bool:
    return assets_api._is_image_upload(file)


def _upload_image_to_assets_subdir(file: UploadFile, subdir: str) -> Dict[str, str]:
    return assets_api._upload_image_to_assets_subdir(file, subdir)


def _normalize_icon_extension(filename: str, content_type: str) -> str:
    return assets_api._normalize_icon_extension(filename, content_type)


def _store_icon_bytes(
    payload: bytes, source_name: str, content_type: str
) -> Dict[str, Optional[str]]:
    return assets_api._store_icon_bytes(payload, source_name, content_type)


def _maybe_create_icon_thumbnail(icon_path: Path, digest: str) -> Optional[str]:
    return assets_api._maybe_create_icon_thumbnail(icon_path, digest)


def _normalize_resource_title(value: str) -> str:
    return table_rows._normalize_resource_title(value)


def _resource_visible_record(page: PageInfo) -> bool:
    return table_rows._resource_visible_record(page)


def _canonical_visible_table_pages(
    table_id: str, pages: List[PageInfo]
) -> List[PageInfo]:
    return table_rows.canonical_visible_table_pages(table_id, pages)


def is_calendar_entry(metadata: Optional[dict]) -> bool:
    """Decides if a page should be saved as a calendar appointment."""
    if not metadata:
        return False

    # Daily notes (Obsidian-style) carry a `date` but are NOT calendar
    # appointments — they live in their own folder and must not pollute the
    # calendar view.
    if str(metadata.get("note_type") or "").strip().lower() == "daily":
        return False

    source = (metadata.get("source") or "").strip().lower()
    has_date = bool(metadata.get("date"))
    has_table = bool(get_table_id(metadata))

    # An appointment must always have a date. With date: it's an appointment if it comes from Gnosi
    # (internal calendar) or if it doesn't belong to any DB table.
    return has_date and (source in {"gnosi", "gnosi vault"} or not has_table)


def init_vault():
    """Initializes the basic environment."""
    if not get_p("VAULT"):
        log.info("⚠️ Bunker in 'pending' mode: Starting without structural Vault path.")
        return
        
    paths_to_create = [
        get_p("VAULT"), get_p("ASSETS"), get_p("CALENDAR"), get_p("DIBUIXOS"), get_p("DATABASES"),
        get_p("DEFAULT_DB"), get_p("DEFAULT_TABLE"), get_p("WIKI"), get_p("DASHBOARDS")
    ]
    
    for p in paths_to_create:
        if p:
            try:
                p.mkdir(parents=True, exist_ok=True)
            except Exception as e:
                log.error(f"Error initializing structural directory {p}: {e}")


def ensure_default_registry_structure():
    """Ensures the existence of the default DB and an initial table."""
    registry_defaults.ensure_default_registry_structure(default_registry_dependencies)


def _ensure_default_registry_structure_locked():
    """Compatibility adapter for callers already holding the registry lock."""
    registry_defaults.ensure_default_registry_structure(default_registry_dependencies)


# init_vault() # Disabled: Now initialized dynamically per workspace via WorkspaceService


def _relation_keys_for_metadata(metadata: dict) -> Optional[set]:
    """`relation_keys` from the page's table schema, so that `strip` /
    `decorate` recognize relation fields by their current name. None if the
    table can't be resolved (→ `strip` strips by shape; `decorate` does nothing).
    Cheap: `_table_by_id` is cached."""
    try:
        tid = get_table_id(metadata)
        if tid:
            return relation_keys_from_table(_table_by_id(tid)) or None
    except Exception:
        return None
    return None


def parse_frontmatter(content: str, file_path: Optional[Path] = None, render_snapshots: bool = False):
    """Parses a markdown file to extract the YAML frontmatter and body.

    If `file_path` allows deriving a vault root and the page has an `id`, it also
    merges the corresponding JSON sidecar (`.gnosi/page_meta/<id>.json`).
    This way internal flags (`*_manual`, `is_template`) live outside the `.md`
    but still appear in the metadata dict as always.
    
    """
    # Regex to capture frontmatter between --- and --- at the start of the file
    match = re.match(r"^---\s*\n(.*?)\n---\s*\n", content, re.DOTALL)
    if match:
        yaml_content = match.group(1)
        body = content[match.end() :]
        if render_snapshots:
            # PREVIEW boundary: leaves the saved snapshot visible
            # (table/list from `:result`) and flattens the columns, instead of
            # of hiding it for the editor. For the preview pop-up and the feed.
            body = render_view_snapshots(body)
            body = flatten_view_columns(body)
        else:
            # READ boundary of the view snapshot: converts back the
            # the hidden definition (comment → fence, so the editor sees it as it
            # always does) and removes the derived results list/table. Similar to
            # strip_relation_wikilinks.
            body = restore_view_fences(body)
            body = strip_view_snapshots(body)
        try:
            metadata = yaml.safe_load(yaml_content) or {}
            metadata = apply_sidecar_to(metadata, file_path)
            metadata = strip_relation_wikilinks(
                metadata, _relation_keys_for_metadata(metadata)
            )
            return metadata, body
        except yaml.YAMLError as e:
            fallback_metadata = _parse_frontmatter_fallback(yaml_content)
            if fallback_metadata:
                location = f" in {file_path}" if file_path else ""
                log.warning(
                    f"Malformed YAML frontmatter{location}; applying rescue parsing"
                )
                fallback_metadata = apply_sidecar_to(fallback_metadata, file_path)
                fallback_metadata = strip_relation_wikilinks(
                    fallback_metadata, _relation_keys_for_metadata(fallback_metadata)
                )
                return fallback_metadata, body
            location = f" in {file_path}" if file_path else ""
            # malformed YAML is annoying but not fatal; debug instead of error
            log.debug(f"Error parsing YAML frontmatter{location}: {e}")
            return {}, content
    return {}, content


# SINGLE source of truth in `services/frontmatter_fallback.py`, shared with
# `graph_service.parse_frontmatter` (which previously had no recovery and left
# pages with malformed YAML empty in the graph, which were recovered here). Keeps
# the local name as an alias so as not to touch call sites.
_parse_frontmatter_fallback = parse_frontmatter_fallback


def generate_frontmatter(metadata: dict) -> str:
    """Generates YAML frontmatter string from a dictionary.

    Internal keys (`*_manual`, `is_template`, …) are filtered out here: they
    must never appear in the `.md`. They are persisted to the JSON sidecar via
    `save_page_md`. If someone calls `generate_frontmatter` without later writing
    the sidecar (not the recommended pattern), these flags would be lost — that's
    why the rule is **always use `save_page_md` to write pages**.
    
    """
    if not metadata:
        return "---\n---\n"
    fm_meta, _sidecar = split_sidecar_metadata(metadata)
    if not fm_meta:
        return "---\n---\n"
    yaml_str = yaml.dump(
        fm_meta, default_flow_style=False, sort_keys=False, allow_unicode=True,
        width=4096,
    )
    return f"---\n{yaml_str}---\n"


def _link_index_title_for(page_id: str) -> Optional[str]:
    return link_index_service.link_index_title_for(page_id, _link_index_view())


def _link_index_unique_id_for_title(title: str) -> Optional[str]:
    return link_index_service.link_index_unique_id_for_title(title, _link_index_view())


def _load_table_rows(table_id: str) -> List[dict]:
    """Load non-template rows with response-facing field names."""
    return vault_view_snapshots.load_table_rows(
        table_id,
        vault_view_snapshot_dependencies,
    )


def _resolve_view_and_candidates(view_id: str, host_page_id: Optional[str]):
    """Resolve one saved view and its candidate rows."""
    return vault_view_snapshots.resolve_view_and_candidates(
        view_id,
        host_page_id,
        vault_view_snapshot_dependencies,
    )


def _resolve_view_row_ids(view_id: str, host_page_id: Optional[str]) -> List[str]:
    """Return the ordered page IDs produced by one saved view."""
    return vault_view_snapshots.resolve_view_row_ids(
        view_id,
        host_page_id,
        vault_view_snapshot_dependencies,
    )


def _format_snapshot_cell(value: Any, ftype: Optional[str]) -> str:
    """Format one value for a materialized Markdown table cell."""
    return vault_view_snapshots.format_snapshot_cell(
        value,
        ftype,
        vault_view_snapshot_dependencies,
    )


def _normalize_visible_properties(vis: Any, base_table_id: Optional[str]) -> List[dict]:
    """Normalize visible property references for snapshot rendering."""
    return vault_view_snapshots.normalize_visible_properties(vis, base_table_id)


def _resolve_view_table(view_id: str, host_page_id: Optional[str]) -> Optional[dict]:
    """Resolve one table/list view into materialized headers and rows."""
    return vault_view_snapshots.resolve_view_table(
        view_id,
        host_page_id,
        vault_view_snapshot_dependencies,
    )


def _view_snapshot_config(view_id: str) -> dict:
    """Return persisted materialization settings for one view."""
    return vault_view_snapshots.view_snapshot_config(
        view_id,
        vault_view_snapshot_dependencies,
    )


def refresh_view_snapshots(dry_run: bool = False) -> Dict[str, Any]:
    """Materializes the snapshot of ALL pages with an embedded view."""
    return vault_view_snapshots.refresh_view_snapshots(
        dry_run,
        vault_view_snapshot_dependencies,
    )


def save_page_md(file_path: Path, metadata: dict, body: str) -> None:
    """Writes an .md page with frontmatter / sidecar separation.

    1. Persists internal keys (`*_manual`, `is_template`, …) to the JSON
       sidecar at `<vault>/.gnosi/page_meta/<id>.json`.
    2. Writes the `.md` with only "clean" frontmatter + body.

    This is the canonical wrapper for writing pages. Replaces the
    `generate_frontmatter(metadata) + safe_write_text` pattern.

    "no junk in the .md" GUARANTEE: before serializing, canonicalizes the
    keys to the column's **current name** (resolves `fld_*` and old names/aliases).
    This way no write path can leave `fld_*` in the frontmatter. See the
    `vault_persist_by_name.md` directive.
    
    """
    # ANTI-LOSS GUARD — "mutilated frontmatter" regression (see the red flag at
    # `wikilink_interactions.md`). A page without `id` in the frontmatter gets indexed
    # by file name (`metadata.get("id") or file_path.stem`), so that
    # and ALL wikilinks by UUID pointing to it start silently returning 404.
    # No legitimate caller reaches here without `id` (create_page always sets it;
    # PATCH/PUT preserve it from the read frontmatter). If it does get here —e.g. because
    # `parse_frontmatter` has returned `{}` when reading a truncated/online-only file
    # of OneDrive and the PATCH only added `parent_id`— we recover the `id` from the
    # file on disk (frontmatter, or via regex over the raw text if the YAML is
    # corrupted); if everything fails, we generate a new one. We NEVER write an `.md` without `id`.
    if not str((metadata or {}).get("id") or "").strip():
        recovered_id = None
        recovered_title = None
        try:
            if file_path.exists():
                existing_raw = file_path.read_text(encoding="utf-8")
                try:
                    if _is_dashboard_file_path(file_path):
                        existing_md, _ = _read_dashboard_file(file_path)
                    else:
                        existing_md, _ = parse_frontmatter(existing_raw, file_path)
                    recovered_id = str((existing_md or {}).get("id") or "").strip() or None
                    recovered_title = (existing_md or {}).get("title")
                except Exception:
                    pass
                if not recovered_id:
                    # Corrupted YAML: regex-based rescue from the raw text.
                    _m = re.search(
                        r"(?mi)^\s*id:\s*['\"]?"
                        r"([0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12})",
                        existing_raw,
                    )
                    if _m:
                        recovered_id = _m.group(1).strip()
        except Exception as e:
            log.warning(f"save_page_md: could not recover the id for {file_path}: {e}")
        metadata = dict(metadata or {})
        if recovered_id:
            metadata["id"] = recovered_id
            if not str(metadata.get("title") or "").strip():
                metadata["title"] = recovered_title or file_path.stem
            log.error(
                f"save_page_md: metadata WITHOUT an id for {file_path}; recovered from disk "
                f"({recovered_id}). A caller is dropping frontmatter; investigate "
                f"(the note was NOT corrupted)."
            )
        else:
            _new_id = str(uuid.uuid4())
            metadata["id"] = _new_id
            if not str(metadata.get("title") or "").strip():
                metadata["title"] = file_path.stem
            log.error(
                f"save_page_md: metadata WITHOUT 'id' for {file_path} and not recoverable from "
                f"disk; assigned new id {_new_id} to avoid corruption. Investigate the caller."
            )

    _table = None
    try:
        _tid = get_table_id(metadata)
        if _tid:
            _table = _table_by_id(_tid)
            if _table:
                metadata, _ = to_storage_names(metadata, _table)
                # We never persist a derived field (`type:'virtual'`): the value
                # it's injected on READ. If the frontend resends the injected value,
                # we discard it before writing to the .md.
                metadata = _strip_virtual_keys(metadata, _table)
    except Exception as e:  # defensive: a resolution failure must not block the write
        log.debug(f"to_storage_names ha fallat per {file_path}: {e}")
    try:
        _relation_keys = relation_keys_from_table(_table) or None
        metadata = decorate_relation_wikilinks(
            metadata,
            relation_keys=_relation_keys,
            id_to_title=_link_index_title_for,
            title_to_id=_link_index_unique_id_for_title,
        )
    except Exception as e:  # defensive: never block a save because of decoration
        log.debug(f"Relationship decoration failed for {file_path}: {e}")
    fm_meta = persist_sidecar_from(metadata, file_path)
    if not fm_meta:
        frontmatter = "---\n---\n"
    else:
        yaml_str = yaml.dump(
            fm_meta, default_flow_style=False, sort_keys=False, allow_unicode=True,
            width=4096,
        )
        frontmatter = f"---\n{yaml_str}---\n"
    # WRITE boundary of the view snapshot: after each fence
    # ```gnosi-view``` writes the [[Title|id]] list of the pages the view
    # returns (portability: Obsidian/Drupal/plain readers). Self-healing and
    # idempotent; defensive (never blocks a save). Mirrors the decoration of
    # relations, but in the body instead of the frontmatter.
    try:
        body = inject_view_snapshots(
            body,
            resolve_ids=_resolve_view_row_ids,
            id_to_title=_link_index_title_for,
            host_page_id=metadata.get("id"),
            config_for=_view_snapshot_config,
            resolve_table=_resolve_view_table,
        )
        # Hides the view definition: visible fence → HTML comment (Obsidian
        # and plain readers don't display it). After injecting the snapshot, which
        # still needs to find the fence.
        body = compact_view_fences(body)
    except Exception as e:  # defensive: never block a save because of the snapshot
        log.debug(f"View snapshot failed for {file_path}: {e}")
    safe_write_text(file_path, f"{frontmatter}\n{(body or '').lstrip()}")


def normalize_metadata_ids(metadata: dict) -> dict:
    """
    Normalizes identification fields in frontmatter.
    Policy: the canonical field is 'id'. If legacy identifier keys exist,
    they are renamed to 'id' and deleted. If 'id' already exists, it's preserved.
    """
    legacy_fields = ["source_id", "gnosi_id"]
    for key in list(metadata.keys()):
        normalized = re.sub(r"[^a-z0-9]", "", str(key).lower())
        if normalized in {"sourceid", "gnosiid"}:
            legacy_fields.append(key)

    for field in set(legacy_fields):
        if field in metadata:
            if "id" not in metadata:
                metadata["id"] = metadata[field]
            del metadata[field]
    return metadata


def normalize_table_context(metadata: dict) -> dict:
    """Keeps table context fields synchronized (canonical + legacy)."""
    return table_rows.normalize_table_context(metadata)


def ensure_correct_page_location(file_path: Path, metadata: dict) -> Path:
    """Moves notes between Wiki/Templates/Calendar/BD based on metadata."""
    is_template = metadata.get("is_template") is True
    is_calendar = is_calendar_entry(metadata)
    is_dashboard = metadata.get("is_dashboard") is True

    if is_template:
        target_dir = get_p("PLANTILLES")
    elif is_calendar:
        target_dir = get_p("CALENDAR")
    elif is_dashboard:
        target_dir = get_p("DASHBOARDS")
    else:
        table_folder = _resolve_table_folder_from_metadata(metadata)
        if table_folder:
            target_dir = table_folder
        else:
            target_dir = get_p("WIKI")

    # We don't move notes that are already in user subfolders, except
    # Templates/Calendar. We check FIRST whether a relocate is needed; only then
    # do we pay for the `mkdir(parents=True, exist_ok=True)` that stats every
    # level of the path on OneDrive (~30-100 ms × depth = 100-900 ms
    # observed on the idempotent PATCH where nothing gets moved).
    can_relocate = (
        file_path.parent == get_p("VAULT")
        or file_path.parent == get_p("PLANTILLES")
        or file_path.parent == get_p("CALENDAR")
        or file_path.parent == get_p("WIKI")
        or file_path.parent == get_p("DASHBOARDS")
    )

    if can_relocate and file_path.parent != target_dir:
        target_dir.mkdir(parents=True, exist_ok=True)
        # Never overwrite a different page that already lives at the destination
        # (a POSIX rename would atomically replace it, destroying its content).
        unique_base = _resolve_unique_filename(
            target_dir,
            file_path.stem,
            exclude_path=file_path,
            extension=file_path.suffix,
        )
        new_path = target_dir / f"{unique_base}{file_path.suffix}"
        if file_path.exists() and file_path.is_file():
            file_path.rename(new_path)
        return new_path

    return file_path


def _process_metadata_paths(metadata: dict):
    """
    Transforms relative paths starting with Assets/
    into paths accessible via API /api/vault/assets/.
    """
    if not metadata:
        return metadata

    for key in ["cover", "icon"]:
        val = metadata.get(key)
        if isinstance(val, str) and val.startswith("Assets/"):
            # Replace Assets/ with the API path
            metadata[key] = val.replace("Assets/", "/api/vault/assets/", 1)

    return metadata


def _normalize_schema_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


# Moved to backend/utils/safe_io.py (sanitize_path_segment) because
# media_service also needs it and can't import from the api layer
# without creating a cycle. Alias to keep the existing call sites.
_sanitize_asset_segment = sanitize_path_segment


def _sanitize_filename_base(title: str) -> str:
    """Sanitize a title into a filesystem-safe filename base (without extension)."""
    return sanitize_vault_title(title, fallback="Untitled", max_len=200)


def _resolve_unique_filename(
    target_dir: Path,
    base_name: str,
    exclude_path: Optional[Path] = None,
    extension: str = ".md",
) -> str:
    """Returns a unique filename base in target_dir, optionally ignoring exclude_path."""
    candidate = base_name
    counter = 2

    while True:
        candidate_path = target_dir / f"{candidate}{extension}"
        if not candidate_path.exists():
            return candidate

        if exclude_path is not None:
            try:
                if candidate_path.resolve() == exclude_path.resolve():
                    return candidate
            except Exception:
                if candidate_path == exclude_path:
                    return candidate

        candidate = f"{base_name} ({counter})"
        counter += 1


def _rename_page_file_to_match_title(file_path: Path, title: str) -> Path:
    """Renames page file so the filename matches title while preserving uniqueness."""
    target_dir = file_path.parent
    base_name = _sanitize_filename_base(title)
    extension = file_path.suffix or ".md"
    desired_name = _resolve_unique_filename(
        target_dir,
        base_name,
        exclude_path=file_path,
        extension=extension,
    )
    desired_path = target_dir / f"{desired_name}{extension}"

    if desired_path == file_path:
        return file_path

    file_path.rename(desired_path)
    return desired_path


def _safe_filename(title: str, target_dir: Path) -> str:
    """Generate a safe filename from a title, handling collisions.

    Returns the filename WITHOUT extension.
    """
    safe = _sanitize_filename_base(title)
    return _resolve_unique_filename(target_dir, safe)


def _is_dashboard_file_path(file_path: Path) -> bool:
    if not file_path or file_path.suffix.lower() != ".json" or not get_p("DASHBOARDS"):
        return False
    try:
        file_path.resolve().relative_to(get_p("DASHBOARDS").resolve())
        return True
    except Exception:
        return False


def _read_dashboard_file(file_path: Path) -> tuple[dict, str]:
    data = json.loads(file_path.read_text(encoding="utf-8"))
    metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
    metadata = dict(metadata)

    file_id = data.get("id") or metadata.get("id") or file_path.stem
    title = data.get("title") or metadata.get("title") or file_path.stem
    parent_id = data.get("parent_id")

    metadata["id"] = file_id
    metadata["title"] = title
    if parent_id is not None:
        metadata["parent_id"] = parent_id
    metadata["is_dashboard"] = True
    metadata.setdefault("content_format", "json")

    body = data.get("content")
    if body is None:
        body = "{}"
    elif not isinstance(body, str):
        body = json.dumps(body, ensure_ascii=False, indent=2)
    else:
        # No-op if the content is BlockNote JSON; reconverts the definition
        # and removes the snapshot if the dashboard is saved as markdown with fences.
        body = restore_view_fences(body)
        body = strip_view_snapshots(body)

    return metadata, body


def _write_dashboard_file(
    file_path: Path,
    page_id: str,
    title: str,
    metadata: dict,
    content: str,
    parent_id: Optional[str] = None,
    is_database: bool = False,
):
    payload = {
        "id": page_id,
        "title": title,
        "parent_id": parent_id,
        "is_database": is_database,
        "metadata": metadata,
        "content": content,
    }
    safe_write_json(file_path, payload, indent=2, ensure_ascii=False)


def _ensure_page_extension(file_path: Path, is_dashboard: bool) -> Path:
    desired_extension = ".json" if is_dashboard else ".md"
    if file_path.suffix.lower() == desired_extension:
        return file_path

    base_name = _sanitize_filename_base(file_path.stem)
    desired_name = _resolve_unique_filename(
        file_path.parent,
        base_name,
        exclude_path=file_path,
        extension=desired_extension,
    )
    desired_path = file_path.parent / f"{desired_name}{desired_extension}"
    file_path.rename(desired_path)
    return desired_path


_ASSET_NAME_RE = re.compile(
    r"(^|[\s_\-])(image|imatge|imagen|foto|cover|thumbnail|thumb)([\s_\-]|$)",
    re.IGNORECASE,
)


def _is_asset_property(prop: Dict[str, Any]) -> bool:
    p_type = str((prop or {}).get("type") or "").strip().lower()
    if p_type in {
        "files",
        "file",
        "image",
        "images",
        "attachment",
        "attachments",
        "media",
    }:
        return True

    # For fields of type `url`, we promote to asset if the name suggests an image.
    # Whole-word match to avoid false positives like
    # "Coverage" (contained "cover" as a substring) or generic names that
    # included the tokens inside other words.
    p_name = str((prop or {}).get("name") or "").strip().lower()
    return p_type == "url" and bool(_ASSET_NAME_RE.search(p_name))


def _resolve_table_and_database_for_assets(
    table_id: str, registry: dict
) -> tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    table = next(
        (t for t in registry.get("tables", []) if str(t.get("id")) == str(table_id)),
        None,
    )
    if not table:
        return None, None
    database_id = table.get("database_id")
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(database_id)
        ),
        None,
    )
    return table, database


def _property_assets_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]], property_name: str
) -> Path:
    db_segment = _sanitize_asset_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _sanitize_asset_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table", "Table"
    )
    prop_segment = _sanitize_asset_segment(property_name, "Property")
    return get_p("ASSETS") / db_segment / table_segment / prop_segment


def _find_table_property(
    table: Optional[Dict[str, Any]], property_name: str
) -> Optional[Dict[str, Any]]:
    """Returns a table's property by its name (or alias), or None."""
    name = str(property_name or "").strip()
    if not table or not name:
        return None
    for prop in table.get("properties", []) or []:
        if str(prop.get("name") or "").strip() == name:
            return prop
        if name in (prop.get("aliases") or []):
            return prop
    return None


def _property_config_value(prop: Optional[Dict[str, Any]], key: str):
    """Reads a config value from a property, whether flat or nested under `config`."""
    if not prop:
        return None
    if prop.get(key) is not None:
        return prop.get(key)
    cfg = prop.get("config")
    if isinstance(cfg, dict):
        return cfg.get(key)
    return None


def _ensure_asset_dirs_for_table_entry(table: Dict[str, Any], registry: dict):
    """Creates all the asset folders associated with a table:
      • `Assets/<TableName>/` — flat destination for generic files (drag&drop on
        notes not tied to any specific property).
      • `Assets/<DB>/<Table>/<Property>/` — a sub-dir for each property of
        asset type (files/file/image/...).

    Idempotent: `mkdir(parents=True, exist_ok=True)` doesn't fail if it already exists.
    
    """
    if not table:
        return
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(table.get("database_id"))
        ),
        None,
    )

    # 1) Flat folder Assets/<TableName>/ — always, for any table
    table_name = str(table.get("name") or "").strip()
    if table_name:
        try:
            flat_segment = _sanitize_asset_segment(table_name, "Table")
            (get_p("ASSETS") / flat_segment).mkdir(parents=True, exist_ok=True)
        except Exception as e:
            log.warning(f"Could not create Assets/{table_name}/: {e}")

    # 2) Sub-dirs for each asset-type property
    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue
        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue
        _property_assets_dir(table, database, prop_name).mkdir(
            parents=True, exist_ok=True
        )


def _ensure_table_vault_folder(table: Dict[str, Any], registry_data: Dict[str, Any]):
    """Creates the physical table folder inside BD/DBName/ (ex: Gnosi/BD/Gnosi/Articles/).
    Includes migration logic: if the folder is in root or BD/, it moves it to the DB folder.
    """
    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        log.warning(f"Table {table.get('id')} ({table.get('name')}) does not have a 'folder' property defined.")
        return

    # Seek the folder of the database the table belongs to
    db_id = table.get("database_id")
    db_folder = "BD" # Default if not found
    
    if registry_data and "databases" in registry_data:
        for db in registry_data["databases"]:
            if db.get("id") == db_id:
                db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
                break

    # Correct final path: Gnosi / BD / DB Name / folder_rel
    target_path = get_p("VAULT") / db_folder / folder_rel
    
    # Migration routes (where the folder might be right now)
    legacy_root_path = get_p("VAULT") / folder_rel
    legacy_bd_path = get_p("DATABASES") / folder_rel

    try:
        # 1. MIGRATION from root (Gnosi/Articles)
        if legacy_root_path.exists() and legacy_root_path.is_dir() and legacy_root_path != (get_p("VAULT") / db_folder):
            if not target_path.exists():
                log.info(f"📦 Migrating table folder from ROOT to {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_root_path), str(target_path))
        
        # 2. MIGRATION from BD/ (Gnosi/BD/Articles)
        if legacy_bd_path.exists() and legacy_bd_path.is_dir() and legacy_bd_path != target_path:
            if not target_path.exists():
                log.info(f"📦 Migrating table folder from BD to {db_folder}: {folder_rel}")
                target_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(legacy_bd_path), str(target_path))
            else:
                # If it already exists at destination but also in BD/, try to merge or delete the old one if empty
                log.warning(f"⚠️ Legacy folder in BD/ still exists for {folder_rel}. Considering cleanup.")
                if not any(legacy_bd_path.iterdir()):
                    legacy_bd_path.rmdir()

        # 3. CREATION (if not migrated or didn't exist)
        if not target_path.exists():
            target_path.mkdir(parents=True, exist_ok=True)
            log.info(f"✅ Table folder created at {db_folder}/: {target_path}")
        # else:
            # log.info(f"ℹ️ Table folder already exists correctly at {db_folder}/: {target_path}")
            
    except Exception as e:
        log.error(f"❌ Error managing folder for table {folder_rel} at {db_folder}: {e}")


def _table_assets_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]]
) -> Path:
    """Returns the Assets/[DB]/[Table] directory for a table."""
    db_segment = _sanitize_asset_segment(
        (database or {}).get("name") or (table or {}).get("database_id") or "General",
        "General",
    )
    table_segment = _sanitize_asset_segment(
        (table or {}).get("name") or (table or {}).get("id") or "Table", "Table"
    )
    return get_p("ASSETS") / db_segment / table_segment


def _table_asset_paths(
    table: Dict[str, Any],
    database: Optional[Dict[str, Any]],
) -> List[Path]:
    """Return every active asset tree removed with one table."""
    structured_path = _table_assets_dir(table, database)
    paths = [structured_path]
    table_name = str((table or {}).get("name") or "").strip()
    if table_name:
        table_segment = _sanitize_asset_segment(table_name, "Table")
        database_segment = _sanitize_asset_segment(
            (database or {}).get("name")
            or (table or {}).get("database_id")
            or "General",
            "General",
        )
        flat_path = get_p("ASSETS") / table_segment
        if _asset_segments_collide(table_segment, database_segment):
            # The flat folder is also the database root. Only loose entries
            # belong to this table; nested directories may belong to siblings.
            if flat_path.is_dir() and not flat_path.is_symlink():
                paths.extend(
                    entry
                    for entry in flat_path.iterdir()
                    if not entry.is_dir() or entry.is_symlink()
                )
        else:
            paths.append(flat_path)
    unique: List[Path] = []
    seen = set()
    assets_root = get_p("ASSETS").resolve()
    for candidate in paths:
        # Resolve parents to reject traversal through a symlink, but preserve
        # the final component itself so a table-owned symlink is hashed and
        # quarantined instead of following or silently ignoring its target.
        resolved = candidate.parent.resolve() / candidate.name
        try:
            resolved.relative_to(assets_root)
        except ValueError:
            log.warning("Unsafe table asset path ignored: %s", candidate)
            continue
        key = str(resolved)
        if key not in seen:
            seen.add(key)
            unique.append(resolved)
    # If a flat and structured path overlap, deleting the parent already
    # covers the child. Keeping both would hash the child twice and make the
    # quarantine revision differ after the first atomic move.
    minimal: List[Path] = []
    for candidate in sorted(unique, key=lambda path: len(path.parts)):
        if any(
            candidate == parent or parent in candidate.parents
            for parent in minimal
        ):
            continue
        minimal.append(candidate)
    return minimal


def _table_asset_revision(
    table: Dict[str, Any],
    database: Optional[Dict[str, Any]],
) -> str:
    assets_root = get_p("ASSETS").resolve()
    return path_collection_revision(
        (
            path.relative_to(assets_root).as_posix(),
            path,
        )
        for path in _table_asset_paths(table, database)
    )


def _stable_value_revision(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            value,
            ensure_ascii=True,
            sort_keys=True,
            separators=(",", ":"),
            default=str,
        ).encode("utf-8")
    ).hexdigest()


def _table_views_revision(registry: Dict[str, Any], table_id: str) -> str:
    views = sorted(
        (
            view
            for view in registry.get("views", [])
            if str(view.get("table_id") or "") == str(table_id)
        ),
        key=lambda view: str(view.get("id") or ""),
    )
    return _stable_value_revision(views)


def _delete_asset_files_for_page(
    page_metadata: dict, table: Dict[str, Any], registry: dict
):
    """Deletes asset files referenced in a record's metadata."""
    database = next(
        (
            d
            for d in registry.get("databases", [])
            if str(d.get("id")) == str(table.get("database_id"))
        ),
        None,
    )
    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue
        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue
        value = page_metadata.get(prop_name)
        if not value:
            continue
        # Normalize to list to treat single and multiple values identically
        paths = value if isinstance(value, list) else [value]
        vault_root = get_p("VAULT").resolve()
        assets_root = (vault_root / "Assets").resolve()
        for raw_path in paths:
            if not isinstance(raw_path, str):
                continue
            rel = raw_path.strip()
            if not rel.startswith("Assets/"):
                continue
            # Defense against path traversal: if a legitimate note contains
            # tampered frontmatter (`Assets/../../etc/passwd`), the
            # `startswith("Assets/")` passes but `resolve()` would point outside
            # of the Vault. `unlink()` would run as root in the container →
            # we could delete arbitrary files from the host filesystem.
            try:
                abs_path = (vault_root / rel).resolve()
                abs_path.relative_to(assets_root)  # raises ValueError if outside
            except (ValueError, OSError):
                log.warning(
                    f"Asset path traversal blocked: {rel!r} is not under Assets/"
                )
                continue
            if abs_path.is_file():
                try:
                    abs_path.unlink()
                    log.info(f"Asset deleted: {abs_path}")
                except Exception as exc:
                    log.warning(f"Could not delete {abs_path}: {exc}")


def _delete_asset_property_dir(
    table: Dict[str, Any], database: Optional[Dict[str, Any]], prop_name: str
):
    """Remove an empty property asset folder without deleting user files.

    Full-table schema updates can transiently omit properties when a client has
    not finished hydrating. Asset files are user data, so a missing property in
    one payload is never sufficient authorization to delete a non-empty folder.
    """
    prop_dir = _property_assets_dir(table, database, prop_name)
    if prop_dir.is_dir():
        try:
            if next(prop_dir.iterdir(), None) is not None:
                log.warning(
                    "Preserving non-empty property asset folder after schema removal: %s",
                    prop_dir,
                )
                return
            prop_dir.rmdir()
            log.info("Empty property folder deleted: %s", prop_dir)
        except Exception as exc:
            log.warning(f"Could not delete folder {prop_dir}: {exc}")


def _delete_asset_table_dir(table: Dict[str, Any], database: Optional[Dict[str, Any]]):
    """Recursively deletes the table's asset folders.

    Symmetric with `_ensure_asset_dirs_for_table_entry`, which creates two:
      • `Assets/<DB>/<Table>/`         (structured, per-property children)
      • `Assets/<TableName>/`          (flat, for generic drag&drop)

    Both are removed here. Empty-or-not, this is a destructive operation
    consistent with the existing rmtree behaviour. The caller (delete_table
    handler) is the only entry point and it requires admin role.
    """
    for table_dir in _table_asset_paths(table, database):
        if not table_dir.exists() and not table_dir.is_symlink():
            continue
        try:
            if table_dir.is_dir() and not table_dir.is_symlink():
                shutil.rmtree(table_dir)
            else:
                table_dir.unlink()
            log.info("Table asset entry deleted: %s", table_dir)
        except Exception as exc:
            log.warning("Could not delete table asset entry %s: %s", table_dir, exc)


def _table_asset_cleanup_root(vault_root: Path) -> Path:
    root = Path(vault_root).resolve()
    cleanup_root = (
        root / ".gnosi" / "pending-cleanup" / "table-assets"
    ).resolve()
    try:
        cleanup_root.relative_to(root)
    except ValueError as error:
        raise RuntimeError(
            "The table asset cleanup path escapes the active Vault."
        ) from error
    return cleanup_root


def _quarantine_table_asset_dirs(
    table: Dict[str, Any],
    database: Optional[Dict[str, Any]],
) -> tuple[Optional[Path], List[tuple[Path, Path]]]:
    """Atomically detach active asset trees before asynchronous deletion."""
    sources = [
        path
        for path in _table_asset_paths(table, database)
        if path.exists() or path.is_symlink()
    ]
    if not sources:
        return None, []
    vault_root = get_p("VAULT").resolve()
    quarantine = (
        _table_asset_cleanup_root(vault_root)
        / f"in-progress-{uuid.uuid4().hex}"
    )
    quarantine.mkdir(parents=True, exist_ok=False)
    destinations = [
        f"{index:02d}-{source.name}"
        for index, source in enumerate(sources)
    ]
    moved: List[tuple[Path, Path]] = []
    try:
        safe_write_json(
            quarantine / "_manifest.json",
            {
                "table_id": str((table or {}).get("id") or ""),
                "entries": [
                    {
                        "source": source.relative_to(vault_root).as_posix(),
                        "destination": destination,
                    }
                    for source, destination in zip(sources, destinations)
                ],
            },
            indent=2,
        )
        for source, destination_name in zip(sources, destinations):
            destination = quarantine / destination_name
            os.replace(source, destination)
            moved.append((source, destination))
    except Exception:
        for source, destination in reversed(moved):
            source.parent.mkdir(parents=True, exist_ok=True)
            os.replace(destination, source)
        shutil.rmtree(quarantine, ignore_errors=True)
        raise
    return quarantine, moved


def _mark_table_asset_quarantine_ready(quarantine: Path) -> Path:
    """Make a committed quarantine eligible for asynchronous cleanup."""
    source = Path(quarantine)
    if not source.name.startswith("in-progress-"):
        raise ValueError("The table asset quarantine is not in progress.")
    destination = source.with_name(
        f"ready-{source.name.removeprefix('in-progress-')}"
    )
    os.replace(source, destination)
    return destination


def _quarantined_table_asset_revision(
    table: Dict[str, Any],
    database: Optional[Dict[str, Any]],
    moved: List[tuple[Path, Path]],
) -> str:
    """Hash the sealed trees using their original logical asset labels."""
    assets_root = get_p("ASSETS").resolve()
    destinations = {str(source): destination for source, destination in moved}
    logical_paths = {
        str(path): path
        for path in (
            [source for source, _destination in moved]
            + _table_asset_paths(table, database)
        )
    }
    return path_collection_revision(
        (
            source.relative_to(assets_root).as_posix(),
            destinations.get(str(source), source),
        )
        for source in sorted(logical_paths.values(), key=lambda path: str(path))
    )


def _restore_quarantined_table_assets(
    quarantine: Optional[Path],
    moved: List[tuple[Path, Path]],
) -> None:
    for source, destination in reversed(moved):
        if not destination.exists():
            continue
        source.parent.mkdir(parents=True, exist_ok=True)
        os.replace(destination, source)
    if quarantine:
        shutil.rmtree(quarantine, ignore_errors=True)


def _delete_table_asset_quarantine(
    quarantine: Path,
    vault_root: Path,
) -> None:
    """Purge one server-created quarantine after the response is sent."""
    cleanup_root = _table_asset_cleanup_root(vault_root)
    target = Path(quarantine).resolve()
    try:
        target.relative_to(cleanup_root)
    except ValueError:
        log.error("Refusing to purge an unsafe table cleanup path: %s", target)
        return
    if not target.name.startswith("ready-"):
        log.error("Refusing to purge an uncommitted table quarantine: %s", target)
        return
    shutil.rmtree(target, ignore_errors=True)


def _restore_abandoned_table_asset_quarantine(
    quarantine: Path,
    vault_root: Path,
) -> bool:
    """Restore a pre-commit quarantine from its path-contained manifest."""
    manifest_path = quarantine / "_manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        log.error("Cannot recover table quarantine without a manifest: %s", quarantine)
        return False

    root = Path(vault_root).resolve()
    planned: List[tuple[Path, Path]] = []
    for entry in manifest.get("entries") or []:
        try:
            source = (root / str(entry["source"])).resolve()
            source.relative_to(root)
            destination = (quarantine / str(entry["destination"])).resolve()
            if source == root or destination.parent != quarantine.resolve():
                raise ValueError
        except (KeyError, OSError, TypeError, ValueError):
            log.error("Unsafe table quarantine manifest entry: %s", quarantine)
            return False
        if source.exists() and destination.exists():
            log.error(
                "Cannot restore table quarantine over an active path: %s",
                source,
            )
            return False
        planned.append((source, destination))

    for source, destination in reversed(planned):
        if not destination.exists():
            continue
        source.parent.mkdir(parents=True, exist_ok=True)
        os.replace(destination, source)
    shutil.rmtree(quarantine, ignore_errors=True)
    return not quarantine.exists()


def _cleanup_registry_table_ids(vault_root: Path) -> Optional[set[str]]:
    """Read durable table IDs, returning ``None`` when commit state is unknown."""
    root = Path(vault_root).resolve()
    try:
        registry_path = get_p("REGISTRY").resolve()
        registry_path.relative_to(root)
        registry = json.loads(registry_path.read_text(encoding="utf-8"))
        tables = registry["tables"]
        if not isinstance(tables, list):
            raise TypeError
    except (KeyError, OSError, TypeError, ValueError):
        log.error(
            "Cannot verify table deletion commit; leaving in-progress "
            "quarantines untouched in %s",
            root,
        )
        return None
    return {
        str(table.get("id") or "")
        for table in tables
        if isinstance(table, dict)
    }


def cleanup_pending_table_asset_quarantines(vault_root: Path) -> int:
    """Restore uncommitted quarantines and purge committed quarantines."""
    vault_root = Path(vault_root).resolve()
    cleanup_root = _table_asset_cleanup_root(vault_root)
    if not cleanup_root.exists():
        return 0
    handled = 0
    from backend.services.context_vars import active_vault_path

    token = active_vault_path.set(vault_root)
    try:
        with registry_mutation():
            active_table_ids: Optional[set[str]] = None
            for candidate in list(cleanup_root.iterdir()):
                if not candidate.is_dir() or candidate.is_symlink():
                    continue
                if candidate.name.startswith("in-progress-"):
                    manifest_path = candidate / "_manifest.json"
                    try:
                        manifest = json.loads(
                            manifest_path.read_text(encoding="utf-8")
                        )
                        table_id = str(manifest.get("table_id") or "")
                        if not table_id:
                            raise ValueError
                    except (OSError, ValueError, TypeError):
                        log.error(
                            "Leaving an unreadable table quarantine untouched: %s",
                            candidate,
                        )
                        continue
                    if active_table_ids is None:
                        active_table_ids = _cleanup_registry_table_ids(
                            vault_root
                        )
                    if active_table_ids is None:
                        continue
                    if table_id in active_table_ids:
                        if _restore_abandoned_table_asset_quarantine(
                            candidate,
                            vault_root,
                        ):
                            handled += 1
                        continue
                    shutil.rmtree(candidate, ignore_errors=True)
                    if not candidate.exists():
                        handled += 1
                    continue
                if candidate.name.startswith("ready-"):
                    shutil.rmtree(candidate, ignore_errors=True)
                    if not candidate.exists():
                        handled += 1
                    continue
                log.warning(
                    "Leaving an unknown table quarantine entry untouched: %s",
                    candidate,
                )
    finally:
        active_vault_path.reset(token)
    return handled


def _asset_segments_collide(a: str, b: str) -> bool:
    """True if two Assets segments resolve to the same physical directory.

    On macOS/APFS the filesystem is case-insensitive: "Cervell Digital" and
    "Cervell digital" are the SAME folder. We compare with casefold to
    detect this portably (see
    `docs/dev_memory/directives/table_rename_flat_folder_collision.md`).
    
    """
    return str(a or "").strip().casefold() == str(b or "").strip().casefold()


def _move_loose_files(src_dir: Path, dst_dir: Path) -> int:
    """Moves only loose FILES (not subdirectories) from src_dir to dst_dir.

    Used when the flat folder `Assets/<Table>/` physically coincides with
    the nesting root `Assets/<DB>/`: the subdirectories are structured
    `<Table>/<Property>/` trees from other tables and must NOT be moved.
    
    """
    moved = 0
    dst_dir.mkdir(parents=True, exist_ok=True)
    for entry in src_dir.iterdir():
        if not entry.is_file():
            continue
        dest = dst_dir / entry.name
        if dest.exists():
            log.warning(f"Loose asset move skipped, destination exists: {dest}")
            continue
        try:
            entry.rename(dest)
            moved += 1
        except Exception as e:
            log.warning(f"Could not move loose asset {entry} → {dest}: {e}")
    return moved


def _table_vault_dir(table: Dict[str, Any], registry: dict) -> Optional[Path]:
    """Returns the table's physical directory inside the Vault (BD/<DB>/<Table>/)."""
    folder_rel = _normalize_rel_folder(table.get("folder"))
    if not folder_rel:
        return None
    db_id = table.get("database_id")
    db_folder = "BD"
    for db in registry.get("databases", []) or []:
        if db.get("id") == db_id:
            db_folder = _normalize_rel_folder(db.get("folder")) or f"BD/{db.get('name', 'General')}"
            break
    return get_p("VAULT") / db_folder / folder_rel


def _rewrite_inline_asset_refs(pages_dir: Path, old_seg: str, new_seg: str) -> int:
    """Rewrites inline references to the renamed flat folder.

    Page bodies reference loose files via
    `/api/vault/assets/<seg>/file.png` (the segment is usually URL-encoded,
    e.g. `Cervell%20digital`). When the flat folder is renamed these URLs
    become broken; we rewrite them from <old_seg> to <new_seg>.

    Deliberately case-SENSITIVE: in a collision (see
    `docs/dev_memory/directives/table_rename_flat_folder_collision.md`) structured refs
    carry the DB segment with different capitalization and must NOT be
    touched. The new URL is always written URL-encoded.
    
    """
    if not pages_dir or not pages_dir.is_dir() or old_seg == new_seg:
        return 0
    new_url = f"/api/vault/assets/{urllib.parse.quote(new_seg)}/"
    old_urls = {
        f"/api/vault/assets/{old_seg}/",
        f"/api/vault/assets/{urllib.parse.quote(old_seg)}/",
    }
    old_urls = {u for u in old_urls if u != new_url}
    if not old_urls:
        return 0
    changed = 0
    for md in pages_dir.rglob("*.md"):
        try:
            text = md.read_text(encoding="utf-8")
        except Exception:
            continue
        new_text = text
        for old_url in old_urls:
            if old_url in new_text:
                new_text = new_text.replace(old_url, new_url)
        if new_text != text:
            try:
                safe_write_text(md, new_text)
                changed += 1
            except Exception as e:
                log.warning(f"Could not rewrite asset refs in {md}: {e}")
    return changed


def _copy_local_file_to_assets(local_path: Path, target_dir: Path) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = _sanitize_asset_segment(local_path.name, f"file-{uuid.uuid4().hex[:8]}")
    destination = target_dir / filename
    if destination.exists():
        stem = _sanitize_asset_segment(local_path.stem, "file")
        ext = local_path.suffix
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"
    shutil.copy2(local_path, destination)
    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


def _save_uploaded_file_to_assets(
    upload: UploadFile, target_dir: Path, target_name: str = ""
) -> str:
    target_dir.mkdir(parents=True, exist_ok=True)
    original_name = upload.filename or "upload.bin"
    ext = Path(original_name).suffix
    if target_name and target_name.strip():
        stem = _sanitize_filename_base(target_name.strip())
    else:
        stem = _sanitize_asset_segment(Path(original_name).stem, "upload")
    destination = target_dir / f"{stem}{ext}"
    if destination.exists():
        destination = target_dir / f"{stem}-{uuid.uuid4().hex[:8]}{ext}"

    with open(destination, "wb") as buffer:
        shutil.copyfileobj(upload.file, buffer)

    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


def _save_data_url_image_to_assets(value: str, target_dir: Path) -> Optional[str]:
    match = re.match(
        r"^data:(image/[^;]+);base64,(.+)$", value.strip(), re.IGNORECASE | re.DOTALL
    )
    if not match:
        return None

    mime_type = match.group(1).lower()
    payload = match.group(2)
    try:
        decoded = base64.b64decode(payload, validate=True)
    except Exception:
        return None

    ext = mimetypes.guess_extension(mime_type) or ".bin"
    if ext == ".jpe":
        ext = ".jpg"

    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"image-{uuid.uuid4().hex[:12]}{ext}"
    destination = target_dir / filename
    # safe_write_bytes (write to .tmp + atomic rename): if the process crashes
    # halfway through, the asset ends up complete or doesn't exist — never truncated.
    safe_write_bytes(destination, decoded)
    return str(destination.relative_to(get_p("VAULT"))).replace("\\", "/")


def _persist_asset_value(value: Any, target_dir: Path) -> Any:
    if value is None:
        return value

    if isinstance(value, list):
        return [_persist_asset_value(item, target_dir) for item in value]

    if isinstance(value, dict):
        updated = dict(value)
        for key in ["path", "file_path", "url", "src"]:
            if key in updated:
                updated[key] = _persist_asset_value(updated[key], target_dir)
        return updated

    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return value

    if text.startswith("/api/vault/assets/"):
        return "Assets/" + text[len("/api/vault/assets/") :]
    if text.startswith("Assets/"):
        return text
    if text.startswith("http://") or text.startswith("https://"):
        return text

    data_url_result = _save_data_url_image_to_assets(text, target_dir)
    if data_url_result:
        return data_url_result

    candidate = text
    if text.startswith("file://"):
        candidate = urllib.parse.unquote(text[7:])

    local_path = Path(candidate).expanduser()
    try:
        if local_path.exists() and local_path.is_file():
            return _copy_local_file_to_assets(local_path, target_dir)
    except Exception:
        return value

    return value


def _persist_metadata_assets(metadata: dict) -> dict:
    if not metadata:
        return metadata

    table_id = get_table_id(metadata)
    if not table_id:
        return metadata

    registry = load_registry()
    table, database = _resolve_table_and_database_for_assets(str(table_id), registry)
    if not table:
        return metadata

    for prop in table.get("properties", []) or []:
        if not _is_asset_property(prop):
            continue

        prop_name = str(prop.get("name") or "").strip()
        if not prop_name:
            continue

        # Fields with a destination outside Assets (storage_folder 'library' or 'free') do NOT
        # must be ingested into Assets: the file already lives in its place (e.g. the
        # Library) and the value is an absolute path that must be preserved as-is.
        # Without this guard, saving the page would copy the file to
        # Assets/<DB>/<Table>/<Property>/ and the value was being rewritten — nullifying the
        # the field's config (which is why a 'library' field always ended up in Assets).
        configured_storage = str(_property_config_value(prop, "storage_folder") or "").strip()
        if configured_storage and configured_storage != "assets":
            continue

        prop_key_norm = _normalize_schema_key(prop_name)
        metadata_key = next(
            (k for k in metadata.keys() if _normalize_schema_key(k) == prop_key_norm),
            None,
        )
        if not metadata_key:
            continue

        target_dir = _property_assets_dir(table, database, prop_name)
        target_dir.mkdir(parents=True, exist_ok=True)
        metadata[metadata_key] = _persist_asset_value(
            metadata.get(metadata_key), target_dir
        )

    return metadata


def _normalize_rel_folder(folder: Optional[str]) -> str:
    """Normalize a host/container folder to a vault-relative path."""
    return table_rows.normalize_relative_folder(folder)


def _build_table_folder_index(registry: dict) -> dict:
    """Map canonical table folders to immutable table IDs."""
    return table_rows.build_table_folder_index(registry)


def _resolve_table_id_from_context(
    metadata: dict, rel_folder: str, folder_to_table: dict, sorted_folders: Optional[List[str]] = None
) -> Optional[str]:
    return table_rows.resolve_table_id_from_context(
        metadata,
        rel_folder,
        folder_to_table,
        sorted_folders,
    )


def _resolve_table_folder_from_metadata(metadata: dict) -> Optional[Path]:
    return table_rows.resolve_table_folder_from_metadata(
        metadata,
        table_row_query_dependencies,
    )


def _resolve_page_context_from_path(
    metadata: dict, file_path: Path
) -> tuple[str, Optional[str]]:
    return table_rows.resolve_page_context_from_path(
        metadata,
        file_path,
        table_row_query_dependencies,
    )


def _recompute_cross_record_formulas_for_table(
    table_id: str, exclude_page_id: Optional[str] = None
):
    """Recomputes cross-record formulas for a table after changes in a row."""
    if not table_id:
        return

    with _table_recalc_lock:
        state = _table_recalc_state.setdefault(
            table_id, {"running": False, "pending": False, "last_run": 0.0}
        )
        now = time.monotonic()
        if state["running"]:
            state["pending"] = True
            return
        if now - state["last_run"] < _TABLE_RECALC_COOLDOWN_SECONDS:
            state["pending"] = True
            return
        state["running"] = True

    try:
        while True:
            with _table_recalc_lock:
                state = _table_recalc_state.setdefault(
                    table_id, {"running": True, "pending": False, "last_run": 0.0}
                )
                state["pending"] = False

            try:
                if not get_rule_engine().table_has_cross_record_formulas(table_id):
                    break
            except Exception as e:
                log.warning(
                    f"Could not validate cross-record formulas for table {table_id}: {e}"
                )
                break

            any_written = False
            for file_path in get_p("VAULT").rglob("*.md"):
                if any(part.startswith('.') for part in file_path.relative_to(get_p("VAULT")).parts):
                    continue

                try:
                    raw = file_path.read_text(encoding="utf-8")
                    metadata, body = parse_frontmatter(raw, file_path)
                except Exception:
                    continue

                page_id = str(metadata.get("id") or file_path.stem)
                if exclude_page_id and page_id == exclude_page_id:
                    continue
                if metadata.get("is_template") is True:
                    continue

                row_table_id = metadata.get("database_table_id") or metadata.get(
                    "table_id"
                )
                if row_table_id != table_id:
                    continue

                original = metadata.copy()
                try:
                    updated = get_rule_engine().process_updates(
                        page_id, original, original.copy()
                    )
                except Exception as e:
                    log.warning(
                        f"Error recomputing row {page_id} from table {table_id}: {e}"
                    )
                    continue

                if updated == original:
                    continue

                try:
                    save_page_md(file_path, updated, body)
                    # Index refresh with the recomputed rollup: without this,
                    # the new value wasn't visible in `/by-table`/`/pages` until the
                    # next rescan (same family as #732/#735/#758/PUT). We flag that
                    # the micro-cache needs to be invalidated at the end of the step.
                    _refresh_page_index_entry(file_path, updated, body)
                    any_written = True
                except Exception as e:
                    log.warning(f"Error saving recomputation for {page_id}: {e}")

            if any_written:
                _pages_cache_invalidate_all()

            with _table_recalc_lock:
                state = _table_recalc_state.setdefault(
                    table_id, {"running": True, "pending": False, "last_run": 0.0}
                )
                state["last_run"] = time.monotonic()
                rerun = state["pending"]

            if not rerun:
                break
    finally:
        with _table_recalc_lock:
            state = _table_recalc_state.setdefault(
                table_id, {"running": False, "pending": False, "last_run": 0.0}
            )
            state["running"] = False


def _vf_page_loader(table_id: str) -> List[PageInfo]:
    """Load canonical table rows for virtual-field computations."""
    return table_rows.virtual_page_loader(table_id, table_row_query_dependencies)


def _strip_virtual_keys(metadata: Dict[str, Any], table: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Removes field keys with `type:'virtual'` from the metadata (by name or id)
    so the derived value (injected on READ) is never persisted to the `.md`."""
    if not table or not isinstance(metadata, dict):
        return metadata
    props = table.get("properties") or []
    drop = {p.get("name") for p in props if p.get("type") == "virtual" and p.get("name")}
    drop |= {p.get("id") for p in props if p.get("type") == "virtual" and p.get("id")}
    if not drop:
        return metadata
    return {k: v for k, v in metadata.items() if k not in drop}


def _get_pages_for_table(table_id: str) -> List[PageInfo]:
    """Fast-path for pages belonging to one table."""
    return table_rows.get_pages_for_table(table_id, table_row_query_dependencies)


def _enrich_table_query_pages(table_id: str, pages: List[PageInfo]) -> None:
    table_rows.enrich_table_query_pages(
        table_id,
        pages,
        table_row_query_dependencies,
    )


def _enrich_single_query_page(
    metadata: Dict[str, Any],
    page_id: str,
    file_path: Path,
) -> Tuple[Dict[str, Any], str, Optional[str]]:
    folder, table_id = _resolve_page_context_from_path(metadata, file_path)
    table_obj = _table_by_id(table_id)
    _vf_inject_for_single_page(
        table_obj,
        str(metadata.get("id") or page_id),
        metadata,
        _vf_page_loader,
    )
    if table_obj:
        metadata = to_response_names(metadata, table_obj)
    return metadata, folder, table_id


def _cached_page_entry_count(vault_key: str) -> int:
    return page_index_service.cached_page_entry_count(vault_key)


page_queries_api.configure(
    page_queries_api.PageQueryDependencies(
        get_pages_snapshot=_get_pages_snapshot,
        page_index_cache_path=lambda: get_page_index_cache_path(),
        get_pages_for_table=lambda table_id: _get_pages_for_table(table_id),
        enrich_table_pages=_enrich_table_query_pages,
        visible_table_pages=_canonical_visible_table_pages,
        active_vault_path=get_active_vault_path,
        get_indexer_status=get_indexer_status,
        cached_entry_count=_cached_page_entry_count,
        find_page=lambda page_id, *, allow_full_scan=True: find_page_path(
            page_id,
            allow_full_scan=allow_full_scan,
        ),
        materialize_page=lambda path, label: _materialize_if_online_only(
            path,
            label,
        ),
        read_dashboard=lambda path: _read_dashboard_file(path),
        is_dashboard=lambda path: _is_dashboard_file_path(path),
        parse_frontmatter=parse_frontmatter,
        enrich_single_page=_enrich_single_query_page,
        file_etag=file_etag,
        fetch_preview=lambda path, page_id: _fetch_preview_with_cache(
            path,
            page_id,
        ),
        warm_preview=lambda page_id: _bulk_warm_one(page_id),
        preview_concurrency=_PREVIEW_WARM_CONCURRENCY,
        preview_timeout_seconds=_PREVIEW_WARM_PER_ITEM_TIMEOUT_S,
    )
)
page_queries_api.register_catalog_routes(router)
list_pages = page_queries_api.list_pages
list_pages_by_table = page_queries_api.list_pages_by_table
list_pages_by_table_snapshot = page_queries_api.list_pages_by_table_snapshot


@router.get("/virtual-fields")
async def list_virtual_fields():
    """Catalogue of virtual field computers available for the schema config UI."""
    return {"computers": _vf_list_specs()}


page_queries_api.register_status_routes(router)
get_indexer_status_endpoint = page_queries_api.get_indexer_status_endpoint
list_sidebar_summary = page_queries_api.list_sidebar_summary


def _get_unique_filepath(target_dir: Path, name: str, extension: str = ".md") -> Path:
    """Returns a unique filepath by appending (n) if it already exists."""
    safe_name = _safe_filename(str(name), target_dir)
    file_path = target_dir / f"{safe_name}{extension}"
    
    if not file_path.exists():
        return file_path
        
    # Collision! Append (n)
    counter = 1
    while True:
        candidate_name = f"{safe_name} ({counter})"
        file_path = target_dir / f"{candidate_name}{extension}"
        if not file_path.exists():
            return file_path
        counter += 1


_user_label_cache = page_state.user_label_cache


def _resolve_user_label(user_id: Optional[str]) -> str:
    """Display name of a user by their id (falls back to email or id). Cached in memory
    since names rarely change. Used for the Created/Edited by authorship."""
    if not user_id:
        return ""
    if user_id in _user_label_cache:
        return _user_label_cache[user_id]
    label = user_id
    try:
        from backend.data.management_db import get_mgmt_db
        from backend.models.management import User
        gen = get_mgmt_db()
        db = next(gen)
        try:
            u = db.query(User).filter(User.id == user_id).first()
            if u:
                label = (u.name or u.email or user_id)
        finally:
            try:
                next(gen)
            except StopIteration:
                pass
    except Exception:
        label = user_id
    _user_label_cache[user_id] = label
    return label


def _stamp_author(metadata: dict, user_id: Optional[str], is_create: bool) -> None:
    """Stamps authorship onto the frontmatter: `created_by`/`created_at` (only on
    creation, not overwritten if already present) and `last_edited_by`/`last_edited_at` (on
    every save). Lets the Created/Edited by fields show the REAL author per
    page (not just the derived owner), also useful in multi-user mode."""
    label = _resolve_user_label(user_id)
    if not label:
        return
    now = datetime.now(timezone.utc).isoformat()
    if is_create:
        metadata.setdefault("created_by", label)
        metadata.setdefault("created_at", now)
    metadata["last_edited_by"] = label
    metadata["last_edited_at"] = now


def _prepare_create_table_metadata(
    metadata: Dict[str, Any],
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    return table_rows.prepare_create_table_metadata(
        metadata,
        table_metadata_dependencies,
    )


def _index_created_page(page_id: str, file_path: Path) -> None:
    try:
        vault_path = get_active_vault_path()
        if not vault_path:
            return
        vault_key = str(vault_path)
        new_entry = _build_page_cache_entry(file_path, file_path.stat())
        with _page_index_lock:
            _page_index_entries.setdefault(vault_key, {})[str(file_path)] = new_entry
            _page_id_to_path.setdefault(vault_key, {})[page_id] = str(file_path)
            _bump_page_index_version(vault_key)
        path_resolver.add_file(vault_path, page_id, file_path)
    except Exception as exc:
        log.warning(
            "Could not insert new page into index cache, falling back to clear: %s",
            exc,
        )
        _clear_page_index_cache()


def _queue_planning_recalculation(background_tasks: BackgroundTasks) -> None:
    try:
        from backend.services.planning_scheduler import enqueue_recalculation

        background_tasks.add_task(
            enqueue_recalculation,
            Path(get_active_vault_path()),
        )
    except Exception as exc:
        log.debug("Could not queue planning recalculation: %s", exc)


def _emit_page_created(page_id: str, title: str) -> None:
    try:
        from backend.services import plugin_events

        plugin_events.emit("page:created", {"page_id": page_id, "title": title})
    except Exception:  # noqa: BLE001
        pass


_CREATE_PAGE_DEPENDENCIES = page_create_service.CreatePageDependencies(
    new_id=lambda: str(uuid.uuid4()),
    normalize_metadata=lambda metadata: normalize_table_context(
        normalize_metadata_ids(metadata)
    ),
    prepare_table_metadata=_prepare_create_table_metadata,
    process_updates=lambda page_id, old, new: get_rule_engine().process_updates(
        page_id,
        old,
        new,
    ),
    stamp_author=lambda metadata, user_id, is_create: _stamp_author(
        metadata,
        user_id,
        is_create,
    ),
    persist_assets=lambda metadata: _persist_metadata_assets(metadata),
    ensure_citation_key=lambda metadata, table: _ensure_recursos_citation_key(
        metadata,
        table,
    ),
    dedupe_citation_key=lambda metadata, page_id: _dedupe_citation_key(
        metadata,
        page_id,
    ),
    fill_authorship=lambda metadata, table: _fill_autoria_from_authors(
        metadata,
        table,
    ),
    path_for=lambda key: get_p(key),
    is_calendar_entry=lambda metadata: is_calendar_entry(metadata),
    table_folder=lambda metadata: _resolve_table_folder_from_metadata(metadata),
    canonicalize_id=lambda page_id: _canonicalize_id(page_id),
    parse_frontmatter=lambda content, path: parse_frontmatter(content, path),
    unique_file_path=lambda directory, name, extension: _get_unique_filepath(
        directory,
        name,
        extension,
    ),
    save_page=lambda path, metadata, content: save_page_md(path, metadata, content),
    get_table_id=lambda metadata: get_table_id(metadata),
    recompute_formulas=_recompute_cross_record_formulas_for_table,
    index_created_page=_index_created_page,
    invalidate_page_responses=lambda: _pages_cache_invalidate_all(),
    add_page_index=lambda path: _add_page_to_index_cache(path),
    update_link_index=lambda path: update_link_index_for_page(path),
    queue_planning=_queue_planning_recalculation,
    propagate_relations=lambda page_id, table_id, old, new: _propagate_relation_inverse(
        page_id,
        table_id,
        old,
        new,
    ),
    resolve_page_context=lambda metadata, path: _resolve_page_context_from_path(
        metadata,
        path,
    ),
    emit_created=_emit_page_created,
)


create_page = page_commands_api.register_create_route(
    router,
    editor_dependency=require_role("editor"),
    workspace_context_dependency=get_workspace_context,
    dependencies=_CREATE_PAGE_DEPENDENCIES,
)


_DAILY_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _load_daily_template_content() -> str:
    """Returns the body of the daily-note template, if one is configured.

    A template page (in the Templates folder) flagged with
    `metadata.is_daily_template: true` is used as the initial content for new
    daily notes — mirroring Obsidian's "Daily note template" setting. Returns
    an empty string when none exists.
    """
    try:
        templates_dir = get_p("PLANTILLES")
        if not templates_dir.exists():
            return ""
        for f in templates_dir.glob("*.md"):
            try:
                meta, body = parse_frontmatter(f.read_text(encoding="utf-8"), f)
            except Exception:
                continue
            if meta.get("is_daily_template") is True:
                return (body or "").strip()
    except Exception as e:
        log.warning(f"Could not load daily-note template: {e}")
    return ""


def _find_daily_note_id(date_str: str) -> Optional[str]:
    """Returns the page id of the daily note for `date_str`, or None.

    Daily notes are stored as `Daily Notes/{date}.md`, so the common case is an
    O(1) path check. Falls back to scanning the folder by frontmatter `date`
    for notes created with a non-ISO title.
    """
    daily_dir = get_p("DAILY")
    if not daily_dir.exists():
        return None
    direct = daily_dir / f"{date_str}.md"
    if direct.exists():
        try:
            meta, _ = parse_frontmatter(direct.read_text(encoding="utf-8"), direct)
            pid = meta.get("id")
            if pid:
                return str(pid)
        except Exception:
            pass
    for f in daily_dir.glob("*.md"):
        try:
            meta, _ = parse_frontmatter(f.read_text(encoding="utf-8"), f)
        except Exception:
            continue
        if str(meta.get("note_type") or "").lower() == "daily" and str(
            meta.get("date") or ""
        ) == date_str:
            pid = meta.get("id")
            if pid:
                return str(pid)
    return None


def _norm_date(value: Any) -> str:
    """Normalizes a frontmatter date to a bare `YYYY-MM-DD` for comparison.

    Date columns may store an ISO datetime (`2026-06-30T08:00:00`) or just the
    day; we only key daily notes by the day, so trim to the first 10 chars when
    they form a valid ISO date.
    """
    s = str(value or "").strip()
    return s[:10] if _DAILY_DATE_RE.match(s[:10]) else s


def _daily_source_config() -> Tuple[Optional[dict], Optional[dict]]:
    """Resolves the DB (table) configured as the backing store for daily notes.

    The daily-notes plugin can be pointed at a database table (e.g. "Bitàcora")
    via `plugins.json` → `settings["daily-notes"]`:
        {"source_table_id": "<table id>", "date_property": "<prop id or name>"}

    Returns `(table, date_prop)` when a valid table + date column resolve, else
    `(None, None)` — in which case the classic `Daily Notes/` folder is used.
    The date column is auto-detected (first `date`-typed property) when the
    stored `date_property` is missing or no longer matches.
    
    """
    try:
        state = _load_plugins_state()
        cfg = (state.get("settings") or {}).get("daily-notes") or {}
        table_id = str(cfg.get("source_table_id") or "").strip()
        if not table_id:
            return None, None
        table = _table_by_id(table_id)
        if not table:
            return None, None
        props = table.get("properties") or []
        date_ref = str(cfg.get("date_property") or "").strip()
        date_prop = None
        if date_ref:
            for p in props:
                if p.get("id") == date_ref or p.get("name") == date_ref:
                    date_prop = p
                    break
        if date_prop is None:
            for p in props:
                if p.get("type") == "date":
                    date_prop = p
                    break
        return (table, date_prop) if date_prop else (None, None)
    except Exception as e:
        log.warning(f"Could not resolve daily-notes source table: {e}")
        return None, None


def _find_daily_note_in_table(
    table: dict, date_prop: dict, date_str: str
) -> Optional[str]:
    """Returns the page id of the BD row whose date column equals `date_str`."""
    try:
        pages = _get_pages_for_table(table.get("id"))
    except Exception:
        return None
    for p in pages:
        md = p.metadata or {}
        if md.get("is_template"):
            continue
        if _norm_date(action_rules_service.read_prop_value(md, date_prop)) == date_str:
            pid = md.get("id") or getattr(p, "id", None)
            if pid:
                return str(pid)
    return None


@router.get("/daily")
async def list_daily_notes():
    """Lists existing daily notes (one per day), newest first.

    Used by the sidebar list and by prev/next navigation to jump to the
    nearest existing note without creating empty ones on every arrow press.

    When the plugin is configured to use a BD as its source, the list is built
    from that table's rows (keyed by the date column) instead of the
    `Daily Notes/` folder.
    """
    table, date_prop = await asyncio.to_thread(_daily_source_config)
    if table and date_prop:
        notes = []
        try:
            pages = await asyncio.to_thread(_get_pages_for_table, table.get("id"))
        except Exception:
            pages = []
        for p in pages:
            md = p.metadata or {}
            if md.get("is_template"):
                continue
            date_val = _norm_date(action_rules_service.read_prop_value(md, date_prop))
            if not _DAILY_DATE_RE.match(date_val):
                continue
            notes.append(
                {
                    "id": str(md.get("id") or getattr(p, "id", "") or ""),
                    "date": date_val,
                    "title": md.get("title") or date_val,
                }
            )
        notes.sort(key=lambda n: n["date"], reverse=True)
        return notes

    daily_dir = get_p("DAILY")
    notes = []
    if daily_dir.exists():
        for f in daily_dir.glob("*.md"):
            try:
                meta, _ = parse_frontmatter(f.read_text(encoding="utf-8"), f)
            except Exception:
                continue
            if str(meta.get("note_type") or "").lower() != "daily":
                continue
            date_val = str(meta.get("date") or f.stem)
            notes.append(
                {
                    "id": str(meta.get("id") or ""),
                    "date": date_val,
                    "title": meta.get("title") or date_val,
                }
            )
    notes.sort(key=lambda n: n["date"], reverse=True)
    return notes


# Serializes the get-or-create of the daily note: two SIMULTANEOUS requests for
# the same date both passed the "find" (no result) and TWO were created
# notes (reproduced with two concurrent POSTs: two rows in the DB for the same
# day; e.g. double-clicking "Daily Note" or two windows at once). A lock
# global is enough: creation is infrequent and the native backend runs in a
# single process (the Docker fallback is also a single worker).
_daily_note_lock = asyncio.Lock()


@router.post(
    "/daily",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("daily-notes"))],
)
async def get_or_create_daily_note(
    request: DailyNoteRequest, background_tasks: BackgroundTasks
):
    """Gets (or atomically creates) the daily note for a given date.

    The date arrives as an ISO `YYYY-MM-DD` string in the client's local time.
    If a note already exists it's returned as-is; otherwise a new one is
    created in the `Daily Notes` folder, seeded with the daily template (if
    configured). This single round-trip avoids the find→create race that two
    separate calls would expose, and `_daily_note_lock` serializes concurrent
    requests so two simultaneous POSTs can't both miss the find and create
    duplicates.
    """
    date_str = (request.date or "").strip()
    if not _DAILY_DATE_RE.match(date_str):
        raise HTTPException(
            status_code=422, detail="date must be in YYYY-MM-DD format"
        )

    async with _daily_note_lock:
        # BD-backed mode: when a source table is configured, the daily note IS a
        # row of that table (e.g. "Bitàcora"), found/created by its date column.
        # The `Daily Notes/` folder is bypassed entirely while this is configured.
        table, date_prop = await asyncio.to_thread(_daily_source_config)
        if table and date_prop:
            existing_id = await asyncio.to_thread(
                _find_daily_note_in_table, table, date_prop, date_str
            )
            if existing_id:
                return await get_page(existing_id)
            content = await asyncio.to_thread(_load_daily_template_content)
            write_key = (
                action_rules_service.effect_write_key({}, date_prop)
                or date_prop.get("name")
                or date_prop.get("id")
            )
            save_req = PageSaveRequest(
                title=date_str,
                content=content,
                metadata={
                    "database_table_id": table.get("id"),
                    write_key: date_str,
                },
            )
            return await create_page(save_req, background_tasks)

        existing_id = await asyncio.to_thread(_find_daily_note_id, date_str)
        if existing_id:
            return await get_page(existing_id)

        content = await asyncio.to_thread(_load_daily_template_content)
        save_req = PageSaveRequest(
            title=date_str,
            content=content,
            metadata={"note_type": "daily", "date": date_str},
        )
        return await create_page(save_req, background_tasks)


def _extract_tags(raw) -> list:
    """Normalizes a `tags` frontmatter value (list or CSV string) to a list."""
    if isinstance(raw, str):
        return [t.strip() for t in raw.split(",") if t.strip()]
    if isinstance(raw, list):
        return [str(t).strip() for t in raw if str(t).strip()]
    return []


@router.get("/tags")
async def list_vault_tags():
    """Aggregates all `tags` across the vault with their page counts.

    Powers the Obsidian-style Tags page: each tag lists the pages that carry
    it so the UI can navigate straight to them. Built from the in-memory page
    snapshot (same source the sidebar uses), so it's O(pages) and cache-warm.

    Two unified sources:
      * the `tags` field from the frontmatter (Obsidian style), and
      * the value of each table's semantic tags field — a `multi_select`
        with `config.role == "tags"` (or named tags/etiquetes/labels), an array
        of option names in the row's metadata.
    A page counts ONCE per tag even if it carries it on both
    sides (e.g. the same tag in the frontmatter and in the table column).
    
    """
    pages = await asyncio.to_thread(_get_pages_snapshot)

    # Tags field per table (id + property name), resolved once from
    # from the registry so the page loop stays O(pages). Only
    # tables with a property of role ROLE_TAGS take part.
    tag_fields: dict = {}
    try:
        registry = await asyncio.to_thread(load_registry)
        for t in registry.get("tables", []) or []:
            prop = option_catalogs_service.find_role_prop(
                t, option_catalogs_service.ROLE_TAGS
            )
            if prop:
                tag_fields[str(t.get("id"))] = (prop.get("id"), prop.get("name"))
    except Exception:
        # If the registry can't be read, we degrade to frontmatter only.
        tag_fields = {}

    # tag -> {page_id: title}, dedup by id so the same tag in frontmatter and
    # in the table column doesn't duplicate the page or inflate the count.
    tag_map: dict = {}

    def _add(tag: str, page) -> None:
        tag_map.setdefault(tag, {}).setdefault(page.id, page.title)

    for p in pages:
        meta = p.metadata or {}
        if meta.get("is_template"):
            continue
        for tag in _extract_tags(meta.get("tags")):
            _add(tag, p)
        field = tag_fields.get(get_table_id(meta) or "")
        if field:
            fid, fname = field
            raw = meta.get(fid) if fid else None
            if raw is None and fname:
                raw = meta.get(fname)
            for tag in _extract_tags(raw):
                _add(tag, p)

    result = [
        {
            "name": name,
            "count": len(pgs),
            "pages": [{"id": pid, "title": title} for pid, title in pgs.items()],
        }
        for name, pgs in tag_map.items()
    ]
    # Most-used first, then alphabetical for stability.
    result.sort(key=lambda x: (-x["count"], x["name"].lower()))
    return {"tags": result}


# ---------------------------------------------------------------------------
# Page comments (Notion-style discussion threads)
#
# Stored vault-first as a single JSON map under `.gnosi/page_comments.json`
# keyed by page id, so comments travel with the vault and survive sync. Low
# write frequency → a process lock + atomic write is plenty (same pattern as
# custom icons).
# ---------------------------------------------------------------------------
def _get_comments_path() -> Path:
    return comments_repository.comments_path(get_p)


def _load_comments() -> dict:
    return comments_repository.load_page_comments(_get_comments_path)


def _save_comments(data: dict) -> None:
    comments_repository.save_page_comments(_get_comments_path, safe_write_json, data)


_COMMENTS_DEPENDENCIES = comments_api.CommentDependencies(
    resolve_page_loader=lambda: globals()["_load_comments"],
    resolve_page_saver=lambda: globals()["_save_comments"],
    resolve_inline_loader=lambda: globals()["_load_inline_comments"],
    resolve_inline_path=lambda: globals()["_inline_comments_path"],
    resolve_json_writer=lambda: globals()["safe_write_json"],
)

(
    list_page_comments,
    add_page_comment,
    update_page_comment,
    delete_page_comment,
) = comments_api.register_page_comment_routes(
    router,
    get_dependencies=[Depends(require_plugins("page-comments"))],
    post_dependencies=[
        Depends(require_role("editor")),
        Depends(require_plugins("page-comments")),
    ],
    patch_dependencies=[
        Depends(require_role("editor")),
        Depends(require_plugins("page-comments")),
    ],
    delete_dependencies=[
        Depends(require_role("editor")),
        Depends(require_plugins("page-comments")),
    ],
    workspace_context_dependency=get_workspace_context,
    dependencies=_COMMENTS_DEPENDENCIES,
)


# ---------------------------------------------------------------------------
# Plugin registry — per-vault on/off state for optional features.
#
# v1 is an INTERNAL registry: the app declares built-in feature "plugins"
# (daily notes, tags page, comments, share, canvas cards…) and this endpoint
# persists which are disabled. Stored vault-first at `.gnosi/plugins.json`.
# Third-party/sandboxed plugins are an explicit non-goal of v1 (security).
# ---------------------------------------------------------------------------
_plugins_lock = threading.Lock()

# Serializes the WHOLE load→modify→save cycle of plugins.json (same pattern as
# _daily_note_lock and _comments_mutation_lock): `_plugins_lock` makes each
# load and each save atomic separately, but two concurrent mutations (e.g. granting
# permissions on a plugin while another tab saves settings) read the same
# snapshot and the last write would clobber the other. The handlers take this
# lock before their asyncio.to_thread; the slow parts (downloading or
# extracting a .zip) stay OUTSIDE the lock, only the state mutation goes inside.
_plugins_mutation_lock = asyncio.Lock()


class PluginsUpdateRequest(BaseModel):
    # List of plugin ids the user has turned OFF. Everything else is on.
    disabled: list = []
    # Per-plugin configuration, keyed by plugin id. Free-form so each plugin
    # owns its own schema (e.g. daily-notes → {"source_table_id", "date_property"}).
    settings: dict = {}


class PluginLifecycleRequest(BaseModel):
    """Explicit lifecycle request for a built-in or installed plugin."""

    enabled: bool
    confirm_dependencies: bool = False
    confirm_disable: bool = False


class LlmWikiLifecycleRequest(PluginLifecycleRequest):
    """Backward-compatible lifecycle request for LLM Wiki."""


def _get_plugins_path() -> Path:
    return get_p("GNOSI_CONFIG") / "plugins.json"


def _load_plugins_state() -> dict:
    with _plugins_lock:
        try:
            path = _get_plugins_path()
            raw = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
            data, changed = builtin_plugins.normalize_state(raw)
            if changed:
                path.parent.mkdir(parents=True, exist_ok=True)
                safe_write_json(path, data, indent=2, ensure_ascii=False)
            return data
        except Exception as exc:
            log.warning("Could not load plugin state; using core-only defaults: %s", exc)
            data, _ = builtin_plugins.normalize_state({})
            return data


@router.get("/plugins")
async def get_plugins_state():
    """Return versioned plugin state and the built-in capability registry."""
    state = await asyncio.to_thread(_load_plugins_state)
    return {**state, "builtins": builtin_plugins.public_registry()}


def _save_plugins_state(state: dict) -> dict:
    """Persist normalized plugin state without dropping compatibility fields."""
    payload, _ = builtin_plugins.normalize_state(state)
    with _plugins_lock:
        path = _get_plugins_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(path, payload, indent=2, ensure_ascii=False)
    return payload


def _llm_wiki_enabled(state: dict) -> bool:
    """Returns whether the built-in LLM Wiki feature is enabled in a state."""
    return builtin_plugins.is_enabled(state, "llm-wiki")


def _reconcile_plugin_ai_contributions() -> dict:
    """Refresh governed third-party skills, tools, and managed agents."""

    from backend.services.plugin_ai_contributions import (
        reconcile_plugin_ai_contributions,
    )

    return reconcile_plugin_ai_contributions()


@router.put("/plugins", dependencies=[Depends(require_role("admin"))])
async def set_plugins_state(request: PluginsUpdateRequest):
    """Persists which plugins are disabled and their per-plugin settings.

    Preserves `granted` (permissions granted to third-party plugins), which is
    managed by its own endpoint and doesn't travel in this payload.
    
    """
    def _write():
        current = _load_plugins_state()
        requested_disabled = {str(item) for item in (request.disabled or [])}
        requested_state = {
            **current,
            "enabled_builtin": sorted(
                builtin_plugins.BUILTIN_PLUGIN_IDS - requested_disabled
            ),
            "disabled": sorted(requested_disabled),
        }
        if _llm_wiki_enabled(current) != _llm_wiki_enabled(requested_state):
            raise HTTPException(
                status_code=409,
                detail="The LLM Wiki plugin must be changed through its confirmed lifecycle.",
            )
        current["disabled"] = sorted(requested_disabled)
        current["enabled_builtin"] = requested_state["enabled_builtin"]
        current["settings"] = request.settings if isinstance(request.settings, dict) else {}
        saved = _save_plugins_state(current)
        _reconcile_plugin_ai_contributions()
        return saved
    async with _plugins_mutation_lock:
        return await asyncio.to_thread(_write)


async def _change_plugin_lifecycle(
    plugin_id: str,
    payload: PluginLifecycleRequest,
    request: Request,
) -> dict:
    """Apply one dependency-aware plugin lifecycle mutation."""
    from backend.services.llm_wiki_agent import LlmWikiAgentError, transition_agent

    def _write() -> dict:
        state = _load_plugins_state()
        is_builtin = plugin_id in builtin_plugins.BUILTIN_PLUGIN_IDS
        if not is_builtin:
            from backend.services import plugin_system as ps

            ps.read_manifest(get_p("GNOSI_CONFIG"), plugin_id)

        enabled_builtin = set(state.get("enabled_builtin") or [])
        affected: list[str] = []
        if payload.enabled:
            missing = [
                requirement
                for requirement in builtin_plugins.required_plugins(plugin_id)
                if requirement not in enabled_builtin
            ]
            if missing and not payload.confirm_dependencies:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "plugin_dependency_confirmation_required",
                        "plugin_id": plugin_id,
                        "enable": missing,
                        "disable": [],
                    },
                )
            for requirement in missing:
                state = builtin_plugins.set_enabled(state, requirement, True)
                affected.append(requirement)
            state = builtin_plugins.set_enabled(state, plugin_id, True)
        else:
            dependents = list(
                builtin_plugins.dependent_plugins(plugin_id, enabled_builtin)
            )
            needs_confirmation = dependents or (plugin_id == "llm-wiki")
            if needs_confirmation and not (
                payload.confirm_dependencies or payload.confirm_disable
            ):
                raise HTTPException(
                    status_code=409,
                    detail={
                        "code": "plugin_dependency_confirmation_required",
                        "plugin_id": plugin_id,
                        "enable": [],
                        "disable": dependents,
                    },
                )
            for dependent in reversed(dependents):
                state = builtin_plugins.set_enabled(state, dependent, False)
                affected.append(dependent)
            state = builtin_plugins.set_enabled(state, plugin_id, False)

        affected.append(plugin_id)
        agent_result: dict[str, Any] = {}
        if "llm-wiki" in affected:
            try:
                agent_result = transition_agent(
                    builtin_plugins.is_enabled(state, "llm-wiki")
                )
            except LlmWikiAgentError:
                raise

        saved = _save_plugins_state(state)
        if "llm-wiki" in affected:
            from backend.scheduler.manager import scheduler_manager

            try:
                task = scheduler_manager.get_task("llm_wiki_maintenance")
                interval = float((task or {}).get("interval_minutes") or 1440)
                scheduler_manager.update_task(
                    "llm_wiki_maintenance",
                    interval_minutes=interval,
                    enabled=builtin_plugins.is_enabled(saved, "llm-wiki"),
                )
            except Exception as exc:  # noqa: BLE001
                log.warning("Could not update the LLM Wiki maintenance task: %s", exc)
        _reconcile_plugin_ai_contributions()
        return {
            **saved,
            **agent_result,
            "plugin_id": plugin_id,
            "enabled": builtin_plugins.is_enabled(saved, plugin_id),
            "affected": affected,
            "builtins": builtin_plugins.public_registry(),
        }

    try:
        async with _plugins_mutation_lock:
            result = await asyncio.to_thread(_write)
    except LlmWikiAgentError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    await _refresh_plugin_runtime(request, result)
    cache = getattr(request.app.state, "agent_cache", None)
    if cache:
        cache.clear()
    return result


async def _refresh_plugin_runtime(request: Request, state: dict) -> None:
    """Apply safe runtime transitions after the state has been committed."""
    affected = set(state.get("affected") or [])
    if "mail" in affected:
        try:
            from backend.services.imap_idle_service import idle_manager

            if builtin_plugins.is_enabled(state, "mail"):
                await asyncio.to_thread(idle_manager.start_all)
            else:
                await asyncio.to_thread(idle_manager.stop_all)
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not refresh Mail background workers: %s", exc)

    if "ai-platform" not in affected:
        return
    if not builtin_plugins.is_enabled(state, "ai-platform"):
        # Existing requests retain their current workflow and can finish safely.
        # Route guards prevent new work; process shutdown closes the MCP client.
        return
    if getattr(request.app.state, "mcp_client", None):
        return
    try:
        from backend.agent.factory import create_agent_workflow
        from backend.config.mcp_config import MCP_SERVERS
        from backend.mcp.client import MultiServerMCPClient

        mcp_client = MultiServerMCPClient(MCP_SERVERS)
        await mcp_client.start()
        tools_list = await mcp_client.get_all_tools()
        request.app.state.mcp_client = mcp_client
        request.app.state.tools_list = tools_list
        workflow, _ = await create_agent_workflow(
            tools_list,
            mcp_client,
            agent_id="gnosy",
        )
        if workflow:
            request.app.state.agent_workflow = workflow
            request.app.state.agent_app = workflow.compile()
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not start the AI plugin runtime: %s", exc)


@router.post(
    "/plugins/{plugin_id}/lifecycle",
    dependencies=[Depends(require_role("admin"))],
)
async def set_plugin_lifecycle(
    plugin_id: str,
    payload: PluginLifecycleRequest,
    request: Request,
):
    """Enable or disable a plugin and its confirmed dependency changes."""
    return await _change_plugin_lifecycle(plugin_id, payload, request)


@router.post(
    "/plugins/llm-wiki/lifecycle",
    dependencies=[Depends(require_role("admin"))],
)
async def set_llm_wiki_lifecycle(
    payload: LlmWikiLifecycleRequest,
    request: Request,
):
    """Backward-compatible alias for the general lifecycle endpoint."""
    return await _change_plugin_lifecycle("llm-wiki", payload, request)


# ---------------------------------------------------------------------------
# THIRD-PARTY plugins (v2): manifest, permissions, and assets. See directive
# `plugin_system.md` and services `plugin_system` / `plugin_sandbox`.
# ---------------------------------------------------------------------------
class PluginPermissionsRequest(BaseModel):
    # List of permissions the user GRANTS to the plugin (subset of the
    # catalog). Empty = revoke all of them.
    permissions: list = []


@router.get("/plugins/catalog")
async def get_plugins_catalog():
    """Catalog of available permissions (id → description) + host API version."""
    from backend.services import plugin_system as ps
    return {"permissions": ps.PERMISSIONS, "apiVersion": ps.PLUGIN_API_VERSION}


@router.get("/plugins/installed")
async def get_installed_plugins():
    """Lists the installed third-party plugins with manifest + status + permissions."""
    from backend.services import plugin_system as ps

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        state = _load_plugins_state()
        out = []
        for entry in ps.discover_plugins(config_dir):
            manifest = entry.get("manifest")
            if not manifest:
                out.append({"id": entry.get("id"), "error": entry.get("error")})
                continue
            pid = manifest["id"]
            out.append({
                "manifest": manifest,
                "enabled": builtin_plugins.is_enabled(state, pid),
                "granted": ps.granted_permissions(state, pid),
                "provenance": entry.get("provenance") or None,
            })
        return {"plugins": out}

    return await asyncio.to_thread(_work)


@router.post("/plugins/{plugin_id}/permissions", dependencies=[Depends(require_role("admin"))])
async def set_plugin_permissions(plugin_id: str, request: PluginPermissionsRequest):
    """Grants (or revokes) permissions to a third-party plugin."""
    from backend.services import plugin_system as ps

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        # Validates that the plugin exists and that we only grant permissions it declares.
        manifest = ps.read_manifest(config_dir, plugin_id)
        requested = [p for p in (request.permissions or []) if p in ps.PERMISSIONS]
        declared = set(manifest.get("permissions") or [])
        clean = [p for p in requested if p in declared]
        state = _load_plugins_state()
        new_state = ps.set_granted(state, plugin_id, clean)
        _save_plugins_state(new_state)
        _reconcile_plugin_ai_contributions()
        return {"id": plugin_id, "granted": clean}

    try:
        async with _plugins_mutation_lock:
            return await asyncio.to_thread(_work)
    except ps.PluginError as e:
        raise HTTPException(status_code=404, detail=str(e))


class PluginSettingsRequest(BaseModel):
    # Patch to merge with the plugin's own configuration (key `settings`).
    settings: dict = {}


class PluginNetworkFetchRequest(BaseModel):
    """Permission-gated network request from a UI plugin frame."""

    url: str
    opts: dict = Field(default_factory=dict)


class VaultSummaryRequest(BaseModel):
    """Payload accepted by the built-in vault summary plugin."""

    content: str
    language: str = "en"


def _configured_summary_model() -> tuple[str, str]:
    """Return the enabled model selected for the vault-summary plugin."""
    state = _load_plugins_state()
    settings = (state.get("settings") or {}).get("vault-summary") or {}
    model_ref = str(settings.get("model") or "").strip()
    provider, separator, model_id = model_ref.partition(":")
    if not separator or not provider or not model_id:
        raise HTTPException(
            status_code=409,
            detail="Configure an active model for the vault-summary plugin first.",
        )

    from backend.agent.model_router import load_registry

    active_models = {
        f"{row.get('provider')}:{row.get('model_id')}"
        for row in load_registry()
        if row.get("enabled", True)
    }
    if model_ref not in active_models:
        raise HTTPException(
            status_code=409,
            detail="The configured vault-summary model is no longer active.",
        )
    return provider, model_id


@router.get("/plugins/{plugin_id}/settings")
async def get_plugin_settings(plugin_id: str):
    """Returns a plugin's own configuration (`settings[plugin_id]`)."""
    def _work():
        state = _load_plugins_state()
        return {"settings": (state.get("settings") or {}).get(plugin_id) or {}}
    return await asyncio.to_thread(_work)


@router.put("/plugins/{plugin_id}/settings", dependencies=[Depends(require_role("editor"))])
async def set_plugin_settings(plugin_id: str, request: PluginSettingsRequest):
    """Merges a patch into a plugin's own configuration."""
    def _work():
        state = _load_plugins_state()
        settings = dict(state.get("settings") or {})
        patch = request.settings if isinstance(request.settings, dict) else {}
        settings[plugin_id] = {**(settings.get(plugin_id) or {}), **patch}
        state["settings"] = settings
        _save_plugins_state(state)
        return {"settings": settings[plugin_id]}
    async with _plugins_mutation_lock:
        return await asyncio.to_thread(_work)


@router.post(
    "/plugins/{plugin_id}/network/fetch",
    dependencies=[Depends(require_role("editor"))],
)
async def fetch_for_ui_plugin(plugin_id: str, request: PluginNetworkFetchRequest):
    """Proxy UI plugin networking through the backend SSRF and size guard."""

    from backend.services import plugin_dispatcher
    from backend.services import plugin_system as ps

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        manifest = ps.read_manifest(config_dir, plugin_id)
        state = _load_plugins_state()
        if "network" not in (manifest.get("permissions") or []):
            raise HTTPException(status_code=403, detail="Plugin does not declare network access")
        if not ps.has_permission(state, plugin_id, "network"):
            raise HTTPException(status_code=403, detail="Plugin network permission is not granted")
        return plugin_dispatcher.network_fetch(
            {"url": request.url, "opts": request.opts or {}},
            plugin_id,
        )

    try:
        return await asyncio.to_thread(_work)
    except ps.PluginError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post(
    "/plugins/vault-summary/summarize",
    dependencies=[
        Depends(require_role("editor")),
        Depends(require_plugins("vault-summary", "ai-platform")),
    ],
)
async def summarize_with_vault_plugin(request: VaultSummaryRequest):
    """Create a concise summary using the explicitly configured active model."""
    content = request.content.strip()
    if not content:
        raise HTTPException(status_code=422, detail="Content is required.")
    if len(content) > 60_000:
        raise HTTPException(status_code=422, detail="Content exceeds the 60,000 character limit.")

    provider, model_id = await asyncio.to_thread(_configured_summary_model)

    def _summarize() -> dict:
        from backend.agent.factory import get_llm
        from backend.agent.model_router import record_llm_usage, usage_from_message
        from backend.security.ai_credentials import resolve_provider_api_key

        ai_cfg = load_params(strict_env=False).get("ai", {}) or {}
        provider_cfg = (ai_cfg.get("providers") or {}).get(provider, {}) or {}
        llm = get_llm(
            provider=provider,
            model=model_id,
            api_key=resolve_provider_api_key(provider, provider_cfg),
            base_url=provider_cfg.get("base_url"),
            timeout=60,
        )
        if not llm:
            raise HTTPException(status_code=503, detail="The configured summary model is unavailable.")
        prompt = (
            "Summarize the following vault record in the requested language. "
            "Return a concise, factual Markdown summary with a short heading and 3–5 bullets. "
            "Do not invent facts.\n\n"
            f"Language: {request.language}\n\nRecord:\n{content}"
        )
        from langchain_core.messages import HumanMessage

        response = llm.invoke([HumanMessage(content=prompt)])
        summary = getattr(response, "content", "") or ""
        if not isinstance(summary, str):
            summary = str(summary)
        usage = usage_from_message(response)
        if usage:
            record_llm_usage(provider, model_id, usage[0], usage[1])
        return {"summary": summary.strip(), "model": f"{provider}:{model_id}"}

    return await asyncio.to_thread(_summarize)


@router.get("/plugins/{plugin_id}/asset/{asset_path:path}")
async def get_plugin_asset(plugin_id: str, asset_path: str):
    """Serves a static file from the plugin's directory (UI entry, etc.).

    Hardened against path-traversal: the id is validated and the resolved file must
    stay INSIDE the plugin's directory.
    
    """
    from backend.services import plugin_system as ps

    def _resolve() -> Path:
        config_dir = get_p("GNOSI_CONFIG")
        pdir = ps.plugin_dir(config_dir, plugin_id).resolve()
        target = (pdir / asset_path).resolve()
        if pdir not in target.parents:
            raise HTTPException(status_code=400, detail="Invalid asset path")
        if not target.exists() or not target.is_file():
            raise HTTPException(status_code=404, detail="Asset not found")
        return target

    try:
        target = await asyncio.to_thread(_resolve)
    except ps.PluginError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return FileResponse(str(target))


def _quarantine_installed_plugin(plugin_id: str) -> None:
    """Newly installed → starts disabled (added to `disabled`), clean permissions.

    Load→modify→save cycle: ALWAYS call it while holding `_plugins_mutation_lock`.
    
    """
    from backend.services import plugin_system as ps
    state = _load_plugins_state()
    state = builtin_plugins.set_enabled(state, plugin_id, False)
    state = ps.set_granted(state, plugin_id, [])
    _save_plugins_state(state)


@router.post("/plugins/install", dependencies=[Depends(require_role("admin"))])
async def install_plugin(file: UploadFile = File(...)):
    """Installs a third-party plugin from an uploaded .zip (with its manifest.json).

    Manifest validation + anti zip-slip extraction. Once installed it stays
    DISABLED and without permissions until the user grants them.
    
    """
    from backend.services import plugin_system as ps
    data = await file.read()

    def _install():
        config_dir = get_p("GNOSI_CONFIG")
        return ps.install_from_zip(config_dir, data, overwrite=True)

    try:
        # The .zip extraction stays outside the lock; only the state mutation goes inside.
        manifest = await asyncio.to_thread(_install)
    except ps.PluginError as e:
        raise HTTPException(status_code=400, detail=str(e))
    async with _plugins_mutation_lock:
        await asyncio.to_thread(_quarantine_installed_plugin, manifest["id"])
        await asyncio.to_thread(_reconcile_plugin_ai_contributions)
    return {"installed": manifest}


@router.delete("/plugins/{plugin_id}", dependencies=[Depends(require_role("admin"))])
async def uninstall_plugin(plugin_id: str):
    """Uninstall a third-party plugin: delete its folder and clean up its state."""
    from backend.services import plugin_system as ps

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        ps.uninstall(config_dir, plugin_id)
        # Cleans up the associated state (disabled + granted) so it doesn't stay orphaned.
        state = _load_plugins_state()
        state["disabled"] = [d for d in (state.get("disabled") or []) if d != plugin_id]
        state["enabled_third_party"] = [
            value
            for value in (state.get("enabled_third_party") or [])
            if value != plugin_id
        ]
        state = ps.set_granted(state, plugin_id, [])
        _save_plugins_state(state)
        _reconcile_plugin_ai_contributions()
        return True

    try:
        async with _plugins_mutation_lock:
            await asyncio.to_thread(_work)
    except ps.PluginError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"uninstalled": plugin_id}


@router.post(
    "/plugins/{plugin_id}/export",
    dependencies=[Depends(require_role("editor"))],
)
async def export_plugin_package(plugin_id: str):
    """Download a deterministic package for an installed third-party plugin."""

    from backend.services import plugin_system as ps

    try:
        data = await asyncio.to_thread(ps.package_plugin, get_p("GNOSI_CONFIG"), plugin_id)
    except ps.PluginError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="{plugin_id}.gnosi-plugin.zip"',
            "X-Content-SHA256": hashlib.sha256(data).hexdigest(),
        },
    )


@router.post(
    "/plugins/{plugin_id}/submissions",
    dependencies=[Depends(require_role("admin"))],
)
async def submit_plugin_package(plugin_id: str):
    """Upload an installed plugin to the configured moderation broker."""

    from backend.services import marketplace_submission
    from backend.services import plugin_system as ps

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        manifest = ps.read_manifest(config_dir, plugin_id)
        data = ps.package_plugin(config_dir, plugin_id)
        return marketplace_submission.submit_package(
            kind="plugin",
            filename=f"{plugin_id}-{manifest['version']}.gnosi-plugin.zip",
            package=data,
            metadata=manifest,
        )

    try:
        return await asyncio.to_thread(_work)
    except (ps.PluginError, marketplace_submission.MarketplaceSubmissionError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


class CatalogInstallRequest(BaseModel):
    # Installs a `bundled` plugin from the catalog by its id, OR from a remote .zip.
    id: Optional[str] = None
    url: Optional[str] = None
    # Optional SHA-256 checksum to verify the integrity of a remote .zip.
    sha256: Optional[str] = None
    # Optional Ed25519 (base64) signature; if given, it must verify against a
    # key from the trust store or the installation is rejected.
    signature: Optional[str] = None


@router.get("/plugins/catalog/list")
async def list_plugin_catalog():
    """Lists the plugin catalog entries (gallery), marking their status.

    Adds `installed: bool` to each entry so the UI shows "Install" or
    "Installed".
    
    """
    from backend.services import plugin_catalog as pc
    from backend.services import plugin_system as ps

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        state = _load_plugins_state()
        installed_ids = {
            e["manifest"]["id"] for e in ps.discover_plugins(config_dir) if e.get("manifest")
        }
        out = []
        registry_url = state.get("registry_url") or pc.default_registry_url()
        for entry in pc.load_catalog(
            registry_url,
            config_dir,
            require_index_signature=True,
        ):
            out.append({
                **entry,
                "installed": entry.get("id") in installed_ids,
                # The UI can show a badge based on the source and whether it carries a signature.
                "signed": bool(entry.get("signature")),
            })
        return {"catalog": out}

    return await asyncio.to_thread(_work)


@router.post("/plugins/catalog/install", dependencies=[Depends(require_role("admin"))])
async def install_from_catalog(request: CatalogInstallRequest):
    """Installs a plugin from the catalog (bundled by `id`, or remote by `url`)."""
    from backend.services import plugin_catalog as pc
    from backend.services import plugin_system as ps

    def _install():
        config_dir = get_p("GNOSI_CONFIG")
        if request.url:
            return pc.install_from_url(
                config_dir,
                request.url,
                request.sha256,
                request.signature,
                require_integrity=True,
            )
        if request.id:
            state = _load_plugins_state()
            registry_url = state.get("registry_url") or pc.default_registry_url()
            return pc.install_catalog_entry(
                config_dir,
                request.id,
                registry_url,
                require_index_signature=True,
            )
        raise ps.PluginError("`id` or `url` is required")

    try:
        # The download/extraction stays outside the lock (it can take seconds);
        # only the state mutation (disabled + no permissions) goes inside.
        manifest = await asyncio.to_thread(_install)
    except ps.PluginError as e:
        raise HTTPException(status_code=400, detail=str(e))
    async with _plugins_mutation_lock:
        await asyncio.to_thread(_quarantine_installed_plugin, manifest["id"])
        await asyncio.to_thread(_reconcile_plugin_ai_contributions)
    return {"installed": manifest}


# ---------------------------------------------------------------------------
# Phase 3: trust store (plugin signing) + remote index.
# ---------------------------------------------------------------------------
class TrustedKeyRequest(BaseModel):
    name: str
    public_key: str


class RegistryUrlRequest(BaseModel):
    url: Optional[str] = None


@router.get("/plugins/trust")
async def list_trusted_keys():
    """Lists the NAMES of the trusted keys (doesn't expose the full key material)."""
    from backend.services import plugin_signing as psign

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        keys = psign.load_trust_store(config_dir)
        return {"keys": [{"name": n, "fingerprint": (pk or "")[:16]} for n, pk in keys.items()]}

    return await asyncio.to_thread(_work)


@router.post("/plugins/trust", dependencies=[Depends(require_role("admin"))])
async def add_trusted_key(request: TrustedKeyRequest):
    """Adds a trusted Ed25519 public key (base64). Admin action."""
    from backend.services import plugin_signing as psign

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        psign.add_trusted_key(config_dir, request.name, request.public_key)
        return {"added": request.name}

    try:
        return await asyncio.to_thread(_work)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.delete("/plugins/trust/{name}", dependencies=[Depends(require_role("admin"))])
async def remove_trusted_key(name: str):
    """Removes a trusted key by its name."""
    from backend.services import plugin_signing as psign

    def _work():
        config_dir = get_p("GNOSI_CONFIG")
        psign.remove_trusted_key(config_dir, name)
        return {"removed": name}

    return await asyncio.to_thread(_work)


@router.get("/plugins/registry-url")
async def get_registry_url():
    """URL of the configured remote plugin index, or the official default."""
    from backend.services import plugin_catalog as pc

    def _work():
        return {"url": _load_plugins_state().get("registry_url") or pc.default_registry_url()}
    return await asyncio.to_thread(_work)


@router.put("/plugins/registry-url", dependencies=[Depends(require_role("admin"))])
async def set_registry_url(request: RegistryUrlRequest):
    """Configures (or clears) the URL of the remote plugin index."""
    url = (request.url or "").strip()
    if url and not url.lower().startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="Registry URL must use HTTP or HTTPS")

    def _work():
        state = _load_plugins_state()
        state["registry_url"] = url
        _save_plugins_state(state)
        return {"url": url}

    async with _plugins_mutation_lock:
        return await asyncio.to_thread(_work)


def get_table_id(metadata: Optional[dict]) -> Optional[str]:
    """Returns the table_id of a record, looking at both alias keys.

    The codebase has historically written both `database_table_id` (newer,
    preferred) and `table_id` (legacy). PATCH writes both; older imports
    only set one. Centralizing the lookup avoids repeating the
    `or`-chain in 10+ call sites and makes future migrations one-line.
    """
    if not metadata:
        return None
    val = metadata.get("database_table_id") or metadata.get("table_id")
    return str(val) if val else None


def _canonicalize_id(page_id: Any) -> str:
    """Returns the canonical form of a UUID-ish id for comparisons.

    Notion exports IDs as 32-char no-dash hex (`df3614865ff34a1490055d9b7b456492`).
    Gnosi/UUID standard form has dashes (`df361486-5ff3-4a14-9005-5d9b7b456492`).
    Some legacy frontmatter, manual edits, parent_id refs, and link resolution
    paths can carry either form. Comparing as raw strings causes silent
    misses ("page not found" when it's there). This helper strips dashes,
    spaces, and case so both forms map to the same canonical key.
    """
    s = str(page_id or "").strip().lower().replace("-", "")
    return s


def find_page_path(page_id: str, *, allow_full_scan: bool = True) -> Optional[Path]:
    """Resolve one page through the canonical page-domain resolver."""
    return page_resolver.find_page_path(page_id, allow_full_scan=allow_full_scan)


def _find_page_path_for_write(page_id: str) -> Optional[Path]:
    """Find a page for a write, repairing a stale index once on a cache miss.

    External OneDrive renames can leave the in-memory page index behind while
    the Markdown file is still present. Read paths should fail fast for stale
    IDs, but a user edit must get one authoritative index refresh before the
    server returns a misleading 404.
    """
    file_path = find_page_path(page_id)
    if file_path:
        return file_path

    log.info("🔄 Page %s missing from write index; refreshing page index once.", page_id)
    try:
        _get_cached_page_entries(force_refresh=True)
    except Exception as exc:
        log.warning("Page index refresh failed while saving %s: %s", page_id, exc)
        return None
    return find_page_path(page_id, allow_full_scan=False)


async def _materialize_if_online_only(file_path: Path, label: str = "") -> None:
    """Materializes the file if OneDrive has it as online-only (`dataless`)
    BEFORE reading it, avoiding the `OSError [Errno 35]` (EDEADLK) that
    occurs when reading it from inside the container.

    Silent no-op if it fails (warmup daemon down, out of scope, etc.): the
    caller keeps its retry loop as a safety net. It's the same
    pattern already followed by `_compute_preview` for previews.
    
    """
    try:
        provider = get_files_provider()
        st = file_path.stat()
        if provider.is_online_only(file_path, st):
            await provider.materialize(file_path)
    except OSError:
        pass  # no harm: the caller's retry loop already handles it.
    except Exception as e:
        log.debug(f"Proactive warmup failed for {label or file_path}: {e}")


async def _ensure_materialized_or_503(p: Path, label: str = "") -> None:
    """File-insert flows: if the picked file is an online-only OneDrive/iCloud
    placeholder, download it now (like Office/Adobe do on open) and WAIT for it.

    Unlike `_materialize_if_online_only` (a best-effort warmup that swallows
    failures), this reports a 503 when the file can't be materialized, so we
    never register a file the reader won't be able to open afterwards.
    """
    provider = get_files_provider()
    try:
        st = p.stat()
    except OSError:
        return
    if not provider.is_online_only(p, st):
        return
    log.info("☁️ Online-only file during insertion (%s): materializing %s…", label, p.name)
    ok = await provider.materialize(p)
    if not ok:
        raise HTTPException(
            status_code=503,
            detail=(
                "The file is online-only and could not be downloaded from OneDrive/iCloud. "
                "Check that the cloud service is running and try again."
            ),
        )


page_queries_api.register_page_route(router)
get_page = page_queries_api.get_page


def _build_preview_excerpt(body: str, max_chars: int = 320) -> str:
    """Extracts the first meaningful paragraph from the markdown, sanitized for tooltips."""
    if not body:
        return ""

    text = str(body)
    text = re.sub(r"```[\s\S]*?```", " ", text)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(
        r"\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]",
        lambda m: (m.group(2) or m.group(1)).strip(),
        text,
    )
    text = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"^#{1,6}\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"(\*|_)(.+?)\1", r"\2", text)
    text = re.sub(r"^>\s?", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"`([^`]+)`", r"\1", text)

    lines = [ln.strip() for ln in text.split("\n")]
    lines = [ln for ln in lines if ln and not re.fullmatch(r"[-=_*]{3,}", ln)]
    text = "\n".join(lines)

    paragraphs = [p.strip() for p in re.split(r"\n{2,}|\n", text) if p.strip()]
    if not paragraphs:
        return ""

    excerpt = paragraphs[0]
    idx = 1
    while len(excerpt) < max_chars * 0.6 and idx < len(paragraphs):
        candidate = excerpt + " " + paragraphs[idx]
        if len(candidate) > max_chars * 1.2:
            break
        excerpt = candidate
        idx += 1

    excerpt = re.sub(r"\s+", " ", excerpt).strip()

    if len(excerpt) > max_chars:
        cut = excerpt[:max_chars]
        last_space = cut.rfind(" ")
        if last_space > max_chars * 0.7:
            cut = cut[:last_space]
        excerpt = cut.rstrip(".,;:") + "…"

    return excerpt


# -----------------------------------------------------------------------------
# Pandoc export with resolved citations
# -----------------------------------------------------------------------------
#
# Academic workflow Phase 5: exports a Vault page to .docx/.odt/.html/.pdf
# with `[@key]` citations resolved against Recursos and a bibliography generated via
# CSL. Pandoc 3+ ships with citeproc built in, so a single invocation is enough:
#
#     pandoc input.md \
#         --citeproc \
#         --bibliography refs.json   (CSL-JSON generated by us)
#         --csl apa.csl              (style chosen by the user)
#         -o output.docx
#
# refs.json is generated on the fly from the referenced Recursos pages
# in the document. This way Pandoc receives only the relevant subset (not all 4198
# entries) and processing is fast.

import tempfile as _ext_tempfile
import subprocess as _ext_subprocess

from backend.services.csl_type_resolver import resolve_csl_type as _resolve_csl_type


def _citation_page_metadata_snapshot(vault_key: str):
    with _page_index_lock:
        return {
            entry.get("id"): (entry.get("metadata") or {})
            for entry in _page_index_entries.get(vault_key, {}).values()
            if entry.get("id")
        }


def _citation_page_entry_count(vault_key: str) -> int:
    with _page_index_lock:
        return len(_page_index_entries.get(vault_key, {}))


def _citation_page_entries(vault_key: str):
    with _page_index_lock:
        return list(_page_index_entries.get(vault_key, {}).values())


def _references_detect_format(raw: str) -> str:
    from backend.services import references_io

    return references_io.detect_format(raw)


def _references_parse(raw: str, fmt: str):
    from backend.services import references_io

    return references_io.parse_references(raw, fmt)


def _references_serialize(metadata: list[dict], fmt: str) -> str:
    from backend.services import references_io

    return references_io.serialize_references(metadata, fmt)


def _references_find_existing(entry: dict, indexes: dict, keys: set):
    from backend.services.import_dedup import find_existing_match

    return find_existing_match(entry, indexes, keys)


def _references_add_indexes(entry: dict, key: str, indexes: dict) -> None:
    from backend.services.import_dedup import add_to_indexes

    add_to_indexes(entry, key, indexes)


def _references_normalize_title(value: object) -> str:
    from backend.services.import_dedup import normalize_title_for_dedup

    return normalize_title_for_dedup(value)


def _references_normalize_item_type(value: str, catalog: list[str]) -> str:
    from backend.services.csl_type_resolver import normalize_item_type

    return normalize_item_type(value, catalog)


def _references_list_styles():
    from backend.services.csl_styles import list_styles

    return list_styles()


def _references_save_style(raw: bytes, filename: str):
    from backend.services.csl_styles import save_uploaded_style

    return save_uploaded_style(raw, filename)


_CITATION_FORMATTING_DEPENDENCIES = citation_formatting.FormattingDependencies(
    active_vault_path=get_active_vault_path,
    resolve_ensure_index=lambda: globals()["_ensure_cite_key_index"],
    page_metadata_snapshot=_citation_page_metadata_snapshot,
    find_page=lambda page_id: find_page_path(page_id),
    parse_frontmatter=parse_frontmatter,
    resolve_csl_type=_resolve_csl_type,
)

_CITATION_SEARCH_DEPENDENCIES = citation_search.CitationSearchDependencies(
    page_entry_count=_citation_page_entry_count,
    page_entries=_citation_page_entries,
    resolve_reference_table_id=lambda: globals()["get_reference_table_id"](),
    canonicalize_id=lambda page_id: _canonicalize_id(page_id),
    active_vault_path=get_active_vault_path,
    resolve_ensure_index=lambda: globals()["_ensure_cite_key_index"],
)

_REFERENCE_API_DEPENDENCIES = citation_references_api.ReferenceApiDependencies(
    resolve_get_table_id=lambda: globals()["get_reference_table_id"],
    resolve_primary_table=lambda: globals()["_reference_table_by_id_primary"],
    resolve_table=lambda: globals()["_table_by_id"],
    resolve_ensure_schema=lambda: globals()["ensure_reference_table_schema"],
    resolve_set_table_id=lambda: globals()["_set_reference_table_id"],
    resolve_invalidate_index=lambda: globals()["_invalidate_cite_key_index"],
    resolve_create_table=lambda: globals()["create_table"],
)

_REFERENCES_IO_DEPENDENCIES = citation_io_api.ReferencesIoDependencies(
    active_vault_path=get_active_vault_path,
    load_registry=lambda: load_registry(),
    item_type_catalog_names=lambda table, registry: _item_type_catalog_names(
        table,
        registry,
    ),
    resolve_existing_keys=lambda: globals()["_existing_citation_keys"],
    normalize_item_type=_references_normalize_item_type,
    resolve_ensure_index=lambda: globals()["_ensure_cite_key_index"],
    find_page=lambda page_id: find_page_path(page_id),
    parse_frontmatter=parse_frontmatter,
    normalize_doi=lambda value: _normalize_doi(value),
    normalize_isbn=lambda value: _normalize_isbn(value),
    normalize_title=_references_normalize_title,
    detect_format=_references_detect_format,
    parse_references=_references_parse,
    serialize_references=_references_serialize,
    find_existing_match=_references_find_existing,
    add_to_indexes=_references_add_indexes,
    resolve_create_page=lambda: globals()["create_page"],
    resolve_invalidate_index=lambda: globals()["_invalidate_cite_key_index"],
    page_snapshot=lambda: _get_pages_snapshot(),
    list_styles=_references_list_styles,
    save_uploaded_style=_references_save_style,
)


def _parse_authors_to_csl(authors_str: str) -> list:
    return citation_authors.parse_authors_to_csl(authors_str)


def _normalize_authors_field(v):
    return citation_authors.normalize_authors_field(v)


def _find_structured_authors(metadata: dict) -> list:
    return citation_authors.find_structured_authors(metadata)


def _structured_authors_to_csl(authors: list) -> list:
    return citation_authors.structured_authors_to_csl(authors)


def _recursos_metadata_to_csl(title: str, m: dict) -> Optional[dict]:
    return citation_authors.recursos_metadata_to_csl(title, m, _resolve_csl_type)


def _resolve_csl_path(style: str) -> Optional[Path]:
    return citation_formatting.resolve_csl_path(style)


def _build_csl_items_for_keys(keys: List[str]) -> List[dict]:
    return citation_formatting.build_csl_items_for_keys(
        keys,
        _CITATION_FORMATTING_DEPENDENCIES,
    )


_PANDOC_MISSING_MSG = citation_formatting.PANDOC_MISSING_MSG


def _pandoc_bin() -> str:
    return citation_formatting.pandoc_binary(
        path_factory=Path,
        which=shutil.which,
    )


(
    format_citation,
    format_citations,
    format_bibliography,
) = citation_formatting.register_routes(router, _CITATION_FORMATTING_DEPENDENCIES)


def _extract_csl_entries(html_out: str) -> List[str]:
    return citation_formatting.extract_csl_entries(html_out)


@router.get("/export/{page_id}")
async def export_page(
    page_id: str,
    format: str = Query('docx', regex=r'^(docx|odt|html|pdf|tex|markdown)$'),
    csl: str = Query('apa'),
    locale: str = Query('en-US'),
):
    """Exports a Vault page to the requested format with resolved citations.

    Workflow:
      1. Loads the page's Markdown (frontmatter + body).
      2. Identifies all `[@key]` references in the body.
      3. Resolves each key to a Recursos entry. Generates a CSL-JSON
         with only the used subset (not all 4198 entries).
      4. Locates the `.csl` style in frontend/public/csl/styles/.
      5. Invokes pandoc with --citeproc --csl --bibliography and returns
         the resulting binary as a download.

    If pandoc is unavailable or fails, 500 with stderr.
    
    """
    file_path = await asyncio.to_thread(find_page_path, page_id)
    if not file_path:
        raise HTTPException(status_code=404, detail="Page not found")
    raw = file_path.read_text(encoding='utf-8')
    # Strip frontmatter; pandoc would understand it but it usually contains fields that don't
    # we want in the final docx.
    body = raw
    if body.startswith('---'):
        m = re.match(r'^---\n.*?\n---\n', body, re.DOTALL)
        if m:
            body = body[m.end():]

    # Identifies citation keys in the body (both [@key] bracketed and naked @key)
    keys = set()
    for m in re.finditer(r'\[@([a-z][a-z0-9_:-]*(?:\s*;\s*@[a-z][a-z0-9_:-]*)*)\]', body, re.IGNORECASE):
        for k in m.group(1).split(';'):
            kk = k.strip().lstrip('@').strip()
            if kk:
                keys.add(kk)
    # Naked keys: the editor renders them as citation chips (mirror of
    # `CITATION_NAKED_RE` in markdown-mapper.js) and pandoc parses them natively,
    # so leaving them out of refs.json produced a bold "(**key?**)" plus a
    # "citation not found" warning instead of a formatted citation.
    for m in re.finditer(r'(?:^|[\s(])@([a-z][a-z0-9_:-]*)\b', body, re.IGNORECASE | re.MULTILINE):
        keys.add(m.group(1))

    # Builds CSL-JSON for the subset
    csl_items = []
    if keys:
        v_path = get_active_vault_path()
        if v_path:
            idx = _ensure_cite_key_index(str(v_path))
            for k in keys:
                entry = idx.get(k)
                if not entry:
                    continue
                # Read the whole page to get the metadata
                try:
                    page_path = await asyncio.to_thread(find_page_path, entry['id'])
                    if not page_path:
                        continue
                    raw_page = page_path.read_text(encoding='utf-8')
                    meta, _ = parse_frontmatter(raw_page, page_path)
                    csl_item = _recursos_metadata_to_csl(entry.get('title') or '', meta)
                    if csl_item:
                        csl_items.append(csl_item)
                except OSError:
                    continue

    # Locates the .csl style. They used to live in the frontend's public/, also accessible
    # via filesystem if the backend and frontend share the repo.
    # Shared resolver, NOT a local copy: this used to duplicate the style map and
    # the `/app/...`-only candidate list, so it kept silently exporting with
    # pandoc's default style after `_resolve_csl_path` was fixed for native mode,
    # and it was missing the `modern-language-association` id the Word add-in
    # actually sends.
    csl_path = _resolve_csl_path(csl)

    # Invoke pandoc in a temporary directory
    with _ext_tempfile.TemporaryDirectory(prefix='gnosi_export_') as tmpdir:
        tmp = Path(tmpdir)
        (tmp / 'input.md').write_text(body, encoding='utf-8')
        if csl_items:
            (tmp / 'refs.json').write_text(json.dumps(csl_items, ensure_ascii=False), encoding='utf-8')
        # We replace our own `{{bibliography}}` marker with the syntax
        # native to pandoc-citeproc — which injects the bibliography in place.
        # Also a final section if it wasn't there.
        content = (tmp / 'input.md').read_text(encoding='utf-8')
        # Style/locale groups must mirror the frontend serializer
        # (markdown-mapper.js): the style id is a free string that admits digits
        # ('apa-6th-edition' and most of the CSL commons repo). `[a-z-]+` left
        # such markers unreplaced, so the literal `{{bibliography:apa-6th-edition}}`
        # text ended up in the exported document and the bibliography moved to
        # the end instead of the marker.
        _BIB_MARKER_RE = r'\{\{bibliography(?::[a-z][a-z0-9-]*)?(?::[a-zA-Z-]+)?\}\}'
        if '{{bibliography}}' in content or re.search(_BIB_MARKER_RE, content):
            # Pandoc uses `# References` or `:::refs` or the end of the document
            # as the bibliography location. We replace our syntax with
            # a heading + ref div.
            content = re.sub(_BIB_MARKER_RE,
                             '## Bibliografia\n\n::: {#refs}\n:::', content)
            (tmp / 'input.md').write_text(content, encoding='utf-8')
        ext_map = {'docx':'docx','odt':'odt','html':'html','pdf':'pdf','tex':'tex','markdown':'md'}
        out_name = f'output.{ext_map[format]}'
        cmd = [_pandoc_bin(), 'input.md', '-o', out_name]
        if csl_items:
            cmd += ['--citeproc', '--bibliography', 'refs.json']
            if csl_path:
                cmd += ['--csl', str(csl_path)]
        if format in ('docx', 'odt', 'pdf'):
            cmd += ['--standalone']
        cmd += ['--metadata', f'lang={locale}']
        try:
            result = _ext_subprocess.run(
                cmd, cwd=tmp, capture_output=True, text=True, timeout=60,
            )
        except FileNotFoundError:
            raise HTTPException(status_code=500, detail=_PANDOC_MISSING_MSG)
        except _ext_subprocess.TimeoutExpired:
            raise HTTPException(status_code=504, detail="pandoc timeout after 60s")
        if result.returncode != 0:
            raise HTTPException(
                status_code=500,
                detail=f"pandoc failed: {result.stderr[:500]}",
            )
        out_path = tmp / out_name
        if not out_path.exists():
            raise HTTPException(status_code=500, detail="pandoc no ha generat sortida")
        # We read the bytes (the TemporaryDirectory will be deleted on exit)
        data = out_path.read_bytes()

    # Generates a clean download name
    safe_title = re.sub(r'[^A-Za-z0-9._-]+', '_', file_path.stem)[:80] or 'document'
    download_name = f'{safe_title}.{ext_map[format]}'
    media = {
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'odt': 'application/vnd.oasis.opendocument.text',
        'html': 'text/html',
        'pdf': 'application/pdf',
        'tex': 'application/x-latex',
        'markdown': 'text/markdown',
    }[format]
    from fastapi.responses import Response
    return Response(
        content=data,
        media_type=media,
        headers={'Content-Disposition': f'attachment; filename="{download_name}"'},
    )


# ---------------------------------------------------------------------------
# Metadata lookup by identifier (DOI / ISBN / arXiv / URL)
# ---------------------------------------------------------------------------
#
# Endpoint to fill Resources fields from external identifiers.
# Covers the three most common services for academic work:
#
#   - CrossRef (DOI)         — ~140M articles, JSON, no API key required
#   - Open Library (ISBN)    — books, JSON, no API key
#   - arXiv (arxiv id)       — scientific preprints, XML (parsed via stdlib)
#   - HTML meta tags (URL)   — fallback for generic web pages
#                              (Open Graph + Dublin Core + Schema.org)
#
# The response does NOT write anything to the Vault: it only suggests values. The frontend
# shows a modal and the user explicitly chooses which fields to accept.
# ---------------------------------------------------------------------------

_DOI_RE = re.compile(r'10\.\d{4,9}/[-._;()/:A-Z0-9]+', re.IGNORECASE)
_ARXIV_RE = re.compile(r'(?:arxiv:)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z\-]+/\d{7}(?:v\d+)?)', re.IGNORECASE)


def _normalize_doi(raw: str) -> Optional[str]:
    """Extracts a valid DOI from a string (may come with a `doi:` or `https://doi.org/` prefix)."""
    if not raw:
        return None
    m = _DOI_RE.search(raw)
    return m.group(0) if m else None


def _normalize_isbn(raw: str) -> Optional[str]:
    """Extracts an ISBN-10 or ISBN-13 from a string."""
    if not raw:
        return None
    cleaned = re.sub(r'[-\s]', '', raw)
    m = re.search(r'97[89]\d{10}|\d{9}[\dX]', cleaned)
    return m.group(0) if m else None


def _normalize_arxiv(raw: str) -> Optional[str]:
    """Extracts an arXiv id (new format YYMM.NNNNN or old category/YYMMNNN)."""
    if not raw:
        return None
    m = _ARXIV_RE.search(raw)
    return m.group(1) if m else None


def _crossref_to_recursos(work: dict) -> dict:
    """CrossRef → Recursos fields mapping.

    Thin wrapper around the L3 pipeline:
        crossref_to_zotero_item  →  zotero_item_to_recursos
    (see `backend/services/lookup_normalizers.py` and
    `backend/services/zotero_to_recursos_mapper.py`).
    
    """
    from backend.services.lookup_normalizers import crossref_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(crossref_to_zotero_item(work))


def _openlibrary_to_recursos(book: dict) -> dict:
    """Map Open Library data to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import openlibrary_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(openlibrary_to_zotero_item(book))


def _arxiv_to_recursos(entry_xml: str) -> dict:
    """Map arXiv Atom XML to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import arxiv_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(arxiv_to_zotero_item(entry_xml))


def _html_meta_to_recursos(html: str, url: str) -> dict:
    """Map HTML meta tags to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import html_meta_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(html_meta_to_zotero_item(html, url))


def _http_get(url: str, headers: Optional[dict] = None, timeout: float = 8.0) -> Optional[str]:
    """Simple HTTP GET with timeout via urllib stdlib. Returns text or None on error."""
    import urllib.request
    import urllib.error
    req_headers = headers or {
        'User-Agent': 'Gnosi/0.1 (https://github.com/ismigar/Gnosi; mailto:ismigar@gmail.com)',
        'Accept': 'application/json, text/html, application/xml; q=0.9, */*; q=0.8',
    }
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read().decode('utf-8', errors='replace')
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        log.warning(f'HTTP GET {url[:80]}... failed: {e}')
        return None


def _http_get_public(url: str, timeout: float = 8.0, max_redirects: int = 5) -> Optional[str]:
    """HTTP GET for user-supplied URLs, hardened against SSRF.

    Validates every hop against `_is_safe_external_url` (rejecting private,
    loopback and link-local addresses) and follows redirects manually so a 3xx
    to an internal host cannot be reached. Returns text or None on error.
    """
    import urllib.parse
    import urllib.request
    import urllib.error

    class _NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):  # noqa: D401
            return None  # never auto-follow; we validate each hop ourselves

    opener = urllib.request.build_opener(_NoRedirect)
    headers = {
        'User-Agent': 'Gnosi/0.1 (https://github.com/ismigar/Gnosi; mailto:ismigar@gmail.com)',
        'Accept': 'application/json, text/html, application/xml; q=0.9, */*; q=0.8',
    }
    current = url
    for _ in range(max_redirects + 1):
        ok, reason = _is_safe_external_url(current)
        if not ok:
            log.warning(f'Blocked SSRF-unsafe URL {current[:80]}...: {reason}')
            return None
        try:
            with opener.open(urllib.request.Request(current, headers=headers), timeout=timeout) as resp:
                return resp.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as e:
            if e.code in (301, 302, 303, 307, 308):
                location = e.headers.get('Location')
                if not location:
                    return None
                current = urllib.parse.urljoin(current, location)
                continue
            log.warning(f'HTTP GET {current[:80]}... failed: {e}')
            return None
        except (urllib.error.URLError, TimeoutError) as e:
            log.warning(f'HTTP GET {current[:80]}... failed: {e}')
            return None
    return None


# ---------------------------------------------------------------------------
# Citation Key generation (P0).
#
# Without a `Citation Key` a Recursos page is not citable
# (`recursosPageToCsl`/`_recursos_metadata_to_csl` return None). Every registration path
# (lookup, import, PDF, web) must generate one. Better BibTeX-style format:
# `<surname><year>[<suffix>]`, for example `murphy2017`, `murphy2017a` on collision.
# ---------------------------------------------------------------------------

def _ck_norm(s: str) -> str:
    return citation_keys.normalize_key_part(s)


def _first_author_family(authors: Any) -> str:
    return citation_keys.first_author_family(authors)


def _org_acronym(family: str) -> str:
    return citation_keys.organization_acronym(family)


def _title_token(title: str) -> str:
    return citation_keys.title_token(title)


def _alpha_suffix(i: int) -> str:
    return citation_keys.alpha_suffix(i)


def generate_citation_key(
    authors: Any, year: Any, title: str = "", existing: Optional[set] = None
) -> str:
    return citation_keys.generate_citation_key(authors, year, title, existing)


def _existing_citation_keys() -> set:
    return citation_keys.existing_citation_keys(
        get_active_vault_path,
        globals()["_ensure_cite_key_index"],
    )


def _inject_citation_key(suggested: dict) -> dict:
    return citation_keys.inject_citation_key(suggested, _existing_citation_keys())


def _item_type_catalog_names(table: Optional[dict], registry: Optional[dict] = None) -> List[str]:
    """Option names of a table's 'Item Type' select catalog ([] if none).

    Same name normalization as `_citation_key_prop_name` (lowercase, no
    spaces) so an equivalent column name ('item type') still counts. Passing
    the registry resolves `config.catalog_ref` shared catalogs too.
    """
    from backend.services.option_catalogs import get_prop_options
    for p in (table or {}).get('properties') or []:
        if str(p.get('name') or '').lower().replace(' ', '') == 'itemtype':
            return [o['name'] for o in get_prop_options(p, (registry or {}).get('option_catalogs'))]
    return []


def _normalize_suggested_item_type(suggested: dict) -> dict:
    """Rewrites `suggested['Item Type']` (canonical Zotero key) into the label
    the designated references table's catalog uses.

    Every suggestion path (lookup by identifier, web capture, PDF recognition)
    calls this right before responding, and the modal applies the suggested
    values verbatim — so the vault only ever stores catalog labels and
    grouping/filtering by Item Type never splits 'Llibre' vs 'book'. The
    resolution ranking lives in `csl_type_resolver.normalize_item_type`.
    Best-effort: with no designated table (or no catalog) bare keys still
    become a human label in the catalog's inferred locale, en-US as last resort.
    """
    if not isinstance(suggested, dict) or not suggested.get('Item Type'):
        return suggested
    from backend.services.csl_type_resolver import normalize_item_type
    table = registry = None
    try:
        tid = get_reference_table_id()
        if tid:
            registry = load_registry()
            table = next((t for t in registry.get('tables', []) if t.get('id') == tid), None)
    except Exception as e:
        log.warning(f"item-type normalization: reference table unavailable: {e}")
    suggested['Item Type'] = normalize_item_type(
        str(suggested['Item Type']), _item_type_catalog_names(table, registry),
    )
    return suggested


def _citation_key_prop_name(table: Optional[dict]) -> Optional[str]:
    """Actual name of the 'Citation Key' column of a citable table, or None.

    Backend mirror of the frontend's `tableHasCitationKey` (VaultDashboard.jsx):
    a table is "a Recursos table" (citable) if it has a column whose name,
    normalized (lowercase, no spaces), is `citationkey`. We return the
    actual name (e.g. 'Citation Key') so we can write to it with the exact key
    read by `_recursos_metadata_to_csl` and the citation index."""
    for p in (table or {}).get("properties", []) or []:
        if str(p.get("name") or "").lower().replace(" ", "") == "citationkey":
            return p.get("name")
    return None


def get_reference_table_id() -> Optional[str]:
    """Id of the designated references table — the ONLY source of truth.

    The references functionality (automatic Citation Key, BibTeX import/export,
    "Create from a source", citation resolution) doesn't belong to a table
    by its name, but to whichever one the user designates in Settings. If the
    designation changes, all the functionality moves with it.

    Priority:
      1. `target_table` from the references config (Settings; reuses
         `zotero_db_config.json`).
      2. Auto-migration (vaults predating the designation, like those that already
         had "Recursos"): adopts the first table with a 'Citation Key' column and
         persists it as `target_table`. From then on the functionality
         follows the designation, not any heuristic.

    Returns None if there is no designation and no citable table (References not
    enabled yet)."""
    try:
        from backend.services.reference_table_config import (
            CONFIG_PATH, DEFAULT_CONFIG, cfg_lock, load_json, save_json,
        )
    except Exception:
        return None
    cfg = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
    tid = str(cfg.get("target_table") or "").strip()
    if tid:
        return tid
    # If the user has already touched References in Settings (even if it was to
    # DISABLE them, leaving target_table=''), we respect the decision and do NOT
    # auto-migrate. Auto-adoption is only for vaults that have never gone through
    # Settings (e.g. those that already had "Recursos" before this feature).
    if cfg.get("references_configured"):
        return None
    # One-shot auto-migration: adopts an existing citable table and persists it.
    try:
        reg = load_registry()
        for t in reg.get("tables", []) or []:
            if _citation_key_prop_name(t):
                adopted = str(t.get("id") or "").strip()
                if adopted:
                    with cfg_lock:
                        # Re-check with the FRESH state inside the lock: if
                        # while we were looking for the table the user saved a
                        # designation in Settings, respect it and don't clobber it.
                        cfg = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
                        current = str(cfg.get("target_table") or "").strip()
                        if current:
                            return current
                        if cfg.get("references_configured"):
                            return None
                        cfg["target_table"] = adopted
                        try:
                            save_json(CONFIG_PATH, cfg)
                        except Exception:
                            pass
                    log.info(
                        f"📚 Automatically assigned references table: {adopted} "
                        f"({t.get('name')})"
                    )
                    return adopted
    except Exception:
        pass
    return None


def ensure_reference_table_schema(table_id: str) -> int:
    """Adds to the table whichever citable columns it's missing (idempotent).

    This way the user doesn't need to know that "a Citation Key field is needed":
    when designating/creating the references table, the system guarantees the
    schema for them. Returns the number of columns added."""
    if not table_id:
        return 0
    with registry_mutation():
        reg = load_registry()
        table = next(
            (t for t in reg.get("tables", []) or [] if t.get("id") == table_id), None
        )
        if not table:
            return 0
        props = table.setdefault("properties", [])
        existing = {str(p.get("name") or "").lower().replace(" ", "") for p in props}
        added = 0
        for name, ptype in _REFERENCE_SCHEMA:
            norm = name.lower().replace(" ", "")
            if norm not in existing:
                props.append({"id": str(uuid.uuid4()), "name": name, "type": ptype})
                existing.add(norm)
                added += 1
        if added:
            save_registry(reg)
            log.info(f"📚 References schema: +{added} columns in {table_id}")
    return added


def _set_reference_table_id(table_id: Optional[str]) -> None:
    """Persists the references table designation (Settings → `target_table`)."""
    from backend.services.reference_table_config import (
        CONFIG_PATH, DEFAULT_CONFIG, cfg_lock, load_json, save_json,
    )
    with cfg_lock:
        cfg = {**DEFAULT_CONFIG, **(load_json(CONFIG_PATH, {}) or {})}
        cfg["target_table"] = (table_id or "").strip()
        # Marks that the designation is deliberate (Settings) → disables auto-migration.
        cfg["references_configured"] = True
        save_json(CONFIG_PATH, cfg)


def _reference_table_by_id_primary(table_id: str) -> Optional[dict]:
    """Resolves a table by its id in the PRINCIPAL vault's registry.

    The references table designation (Zotero) is GLOBAL and the table lives in
    the Principal vault; without this, in a non-default vault `_table_by_id`
    would look for it in the wrong registry and wouldn't find it."""
    from backend.services.context_vars import active_vault_path, get_primary_vault_path
    base = get_primary_vault_path()
    if not base:
        return _table_by_id(table_id)
    token = active_vault_path.set(base)
    try:
        return _table_by_id(table_id)
    finally:
        active_vault_path.reset(token)


(
    get_reference_table,
    set_reference_table,
    create_reference_table,
    clear_reference_table,
) = citation_references_api.register_routes(
    router,
    post_dependencies=[Depends(require_role("editor"))],
    create_dependencies=[Depends(require_role("editor"))],
    delete_dependencies=[Depends(require_role("editor"))],
    dependencies=_REFERENCE_API_DEPENDENCIES,
)


# ---------------------------------------------------------------------------
# BRAIN (LLM Wiki) table designation. Mirrors the references-table pattern
# but persists PER-VAULT (`<vault>/.gnosi/llm_wiki.json`), not install-wide.
# See directive `llm_wiki_cervell.md` and service `llm_wiki_config.py`.
# ---------------------------------------------------------------------------

_BRAIN_SCHEMA_DEFINITIONS: list[tuple[str, str, dict[str, str]]] = [
    ("note_type", "select", {
        "ca": "Tipus de nota", "en": "Note type", "es": "Tipo de nota", "fr": "Type de note",
    }),
    ("idea_type", "select", {
        "ca": "Tipus d’idea", "en": "Idea type", "es": "Tipo de idea", "fr": "Type d’idée",
    }),
    ("position", "number", {
        "ca": "Posició", "en": "Position", "es": "Posición", "fr": "Position",
    }),
    ("based_on", "relation", {
        "ca": "Basada en", "en": "Based on", "es": "Basada en", "fr": "Basée sur",
    }),
    ("verification", "select", {
        "ca": "Estat de verificació", "en": "Verification status",
        "es": "Estado de verificación", "fr": "État de vérification",
    }),
    ("last_reviewed", "date", {
        "ca": "Última revisió", "en": "Last reviewed",
        "es": "Última revisión", "fr": "Dernière révision",
    }),
    ("areas", "multi_select", {
        "ca": "Àrees", "en": "Areas", "es": "Áreas", "fr": "Domaines",
    }),
    ("tags", "multi_select", {
        "ca": "Etiquetes", "en": "Tags", "es": "Etiquetas", "fr": "Étiquettes",
    }),
]

_BRAIN_SOURCE_NAMES = {
    "ca": "Font",
    "en": "Source",
    "es": "Fuente",
    "fr": "Source",
}
_BRAIN_SOURCE_SINGULAR_TOKENS = {"font", "source", "fuente"}
_BRAIN_SOURCE_PLURAL_TOKENS = {"fonts", "sources", "fuentes"}
BRAIN_SOURCE_CONTRACT_REVISION = 2
_BRAIN_VIEW_DEF_RE = re.compile(
    r"<!--\s*gnosi-view:def\s+(?P<payload>\{.*?\})\s*-->",
)

_BRAIN_ROLE_SPECS: dict = {
    "note_type": ({"tipusdenota", "notetype", "tipodenota", "typedenote"}, "select"),
    "idea_type": ({"tipus", "tipusdidea", "ideatype", "tipodeidea", "typedidee", "classe"}, "select"),
    "position": ({"posicio", "position", "ordre"}, "number"),
    "verification": (
        {"estatdeverificacio", "verificationstatus", "estadodeverificacion", "etatdeverification", "estat"},
        "select",
    ),
    "last_reviewed": (
        {"ultimarevisio", "lastreviewed", "reviewdate", "ultimarevision", "derniererevision"},
        "date",
    ),
    "areas": ({"arees", "area", "areas", "domaines"}, "multi_select"),
    "tags": ({"tags", "etiquetes", "etiquetas", "etiquettes"}, "multi_select"),
}


def _brain_property(role: str, name: str, ptype: str, brain_table_id: str = "") -> dict:
    """Build a localized seed property while keeping relation targets stable."""
    prop = {"id": str(uuid.uuid4()), "name": name, "type": ptype}
    if ptype == "relation":
        if role == "based_on":
            if brain_table_id:
                prop["relation_database_id"] = brain_table_id
                prop["cardinality"] = "many-to-many"
    return prop


def _brain_schema(locale: str = "en") -> list[tuple[str, str, str]]:
    language = str(locale or "en").split("-", 1)[0].lower()
    if language not in {"ca", "en", "es", "fr"}:
        language = "en"
    return [
        (role, names[language], property_type)
        for role, property_type, names in _BRAIN_SCHEMA_DEFINITIONS
    ]


def _brain_role_tokens(role: str) -> set[str]:
    definition = next(
        (item for item in _BRAIN_SCHEMA_DEFINITIONS if item[0] == role),
        None,
    )
    if not definition:
        return set()
    tokens = {_brain_schema_token(name) for name in definition[2].values()}
    tokens.update({
        "idea_type": {"tipus", "classe"},
        "areas": {"area"},
    }.get(role, set()))
    return tokens


def _ensure_default_db_group() -> None:
    """Guarantee the `gnosi_vault_db` databases entry so tables created under
    it (for example, the Brain) show up in the sidebar, which groups by
    `registry.databases`. Folder "BD" — the Notion-clone convention — keeps the
    physical resolution VAULT/BD/<table.folder> unchanged (the disabled global
    bootstrap uses "Databases/Gnosi", which would MOVE existing tables)."""
    with registry_mutation():
        reg = load_registry()
        dbs = reg.setdefault("databases", [])
        if any(d.get("id") == "gnosi_vault_db" for d in dbs):
            return
        dbs.append({"id": "gnosi_vault_db", "name": "Gnosi Vault", "folder": "BD"})
        save_registry(reg)
        log.info("🧠 Created the `gnosi_vault_db` database group in the sidebar registry")


def ensure_brain_table_schema(
    table_id: str,
    locale: str = "en",
    property_id_hints: Optional[dict[str, str]] = None,
) -> int:
    """Add missing Brain fields and stable property ids idempotently."""
    if not table_id:
        return 0
    added = 0
    with registry_mutation():
        reg = load_registry()
        table = next(
            (t for t in reg.get("tables", []) or [] if t.get("id") == table_id), None
        )
        if not table:
            return 0
        props = table.setdefault("properties", [])
        existing = {_brain_schema_token(prop.get("name")) for prop in props}
        for role, name, property_type in _brain_schema(locale):
            equivalent_tokens = _brain_role_tokens(role)
            if not (equivalent_tokens & existing):
                props.append(_brain_property(
                    role,
                    name,
                    property_type,
                    brain_table_id=table_id,
                ))
                existing.add(_brain_schema_token(name))
                added += 1
        repaired = 0
        used_ids = {
            str(prop.get("id") or "")
            for prop in props
            if str(prop.get("id") or "")
        }
        hints = property_id_hints or {}
        for prop in props:
            if prop.get("id"):
                continue
            token = _brain_schema_token(prop.get("name"))
            hinted_id = str(hints.get(token) or "")
            prop["id"] = (
                hinted_id
                if hinted_id and hinted_id not in used_ids
                else str(uuid.uuid4())
            )
            used_ids.add(str(prop["id"]))
            repaired += 1
        for prop in props:
            if prop.get("type") != "relation":
                continue
            property_token = _brain_schema_token(prop.get("name"))
            if property_token in _brain_role_tokens("based_on"):
                if not prop.get("relation_database_id"):
                    prop["relation_database_id"] = table_id
                    repaired += 1
                if prop.get("cardinality") != "many-to-many":
                    prop["cardinality"] = "many-to-many"
                    repaired += 1
        if added or repaired:
            save_registry(reg)
            log.info(
                "LLM Wiki Brain schema updated: %d fields added and %d properties repaired in %s",
                added,
                repaired,
                table_id,
            )
    return added


def _brain_schema_token(value: object) -> str:
    """Accent-insensitive token used only for semantic schema discovery."""
    import unicodedata

    normalized = unicodedata.normalize("NFKD", str(value or "").casefold())
    return "".join(ch for ch in normalized if ch.isalnum() and not unicodedata.combining(ch))


def _infer_brain_roles(table: Optional[dict]) -> dict:
    """Map semantic role names to existing Brain property ids."""
    properties = [
        prop for prop in ((table or {}).get("properties") or [])
        if isinstance(prop, dict) and prop.get("id")
    ]
    roles = {}
    for role, (tokens, expected_type) in _BRAIN_ROLE_SPECS.items():
        candidate = next(
            (
                prop for prop in properties
                if _brain_schema_token(prop.get("name")) in tokens
                and (
                    str(prop.get("type") or "") == expected_type
                    or role == "areas"
                    and str(prop.get("type") or "") in {"relation", "select", "multi_select"}
                )
            ),
            None,
        )
        if candidate:
            roles[role] = str(candidate["id"])
    return roles


def _dimension_name_key(value: object) -> str:
    token = _brain_schema_token(value)
    return {
        "area": "area",
        "areas": "area",
        "arees": "area",
        "domaine": "area",
        "domaines": "area",
    }.get(token, token)


def _brain_property_id_hints(cfg: dict, brain_table: Optional[dict]) -> dict[str, str]:
    """Recover legacy property ids from persisted role and dimension mappings."""
    hints: dict[str, str] = {}
    for role, property_id in (cfg.get("brain_roles") or {}).items():
        stable_id = str(property_id or "")
        if not stable_id:
            continue
        for token in _brain_role_tokens(str(role)):
            hints[token] = stable_id

    brain_properties = [
        prop
        for prop in (brain_table or {}).get("properties") or []
        if isinstance(prop, dict)
    ]
    for field_id in cfg.get("index_field_ids") or []:
        stable_id = str(field_id or "")
        source_keys: set[str] = set()
        for source in cfg.get("source_tables") or []:
            mapping = (source.get("dimension_mappings") or {}).get(stable_id) or {}
            source_property_id = str(mapping.get("source_property_id") or "")
            source_table = _table_by_id(str(source.get("table_id") or "")) or {}
            source_property = next(
                (
                    prop
                    for prop in source_table.get("properties") or []
                    if str(prop.get("id") or "") == source_property_id
                ),
                None,
            )
            if source_property:
                source_keys.add(_dimension_name_key(source_property.get("name")))
        candidates = [
            prop
            for prop in brain_properties
            if _dimension_name_key(prop.get("name")) in source_keys
        ]
        if len(candidates) == 1:
            hints[_brain_schema_token(candidates[0].get("name"))] = stable_id
    return hints


def _brain_source_name(locale: str) -> str:
    language = str(locale or "en").split("-", 1)[0].lower()
    return _BRAIN_SOURCE_NAMES.get(language, _BRAIN_SOURCE_NAMES["en"])


def _relation_values(value: object) -> list[object]:
    if value in (None, "", [], {}):
        return []
    return list(value) if isinstance(value, list) else [value]


def _relation_value_key(value: object) -> str:
    text = str(value or "").strip()
    match = RELATION_WIKILINK_RE.match(text)
    return str(match.group("rid") if match else text)


def _merge_relation_values(*values: object) -> list[object]:
    merged: list[object] = []
    seen: set[str] = set()
    for value in values:
        for item in _relation_values(value):
            key = _relation_value_key(item)
            if not key or key in seen:
                continue
            seen.add(key)
            merged.append(item)
    return merged


def _migrate_brain_source_metadata(
    brain_table_id: str,
    canonical_name: str,
    legacy_names: set[str],
) -> int:
    """Move duplicate source values to the canonical Brain relation."""
    if not legacy_names:
        return 0
    migrated = 0
    for page in _get_pages_for_table(brain_table_id) or []:
        path_value = getattr(page, "path", None)
        path = Path(path_value) if path_value else None
        if not path or not path.exists():
            continue
        try:
            metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"), path)
            present = [name for name in legacy_names if name in metadata]
            if not present:
                continue
            metadata[canonical_name] = _merge_relation_values(
                metadata.get(canonical_name),
                *(metadata.get(name) for name in present),
            )
            for name in present:
                metadata.pop(name, None)
            save_page_md(path, metadata, body)
            register_page_in_index(path)
            migrated += 1
        except Exception as error:
            log.warning("Could not migrate a Brain source relation in %s: %s", path, error)
    return migrated


def _source_filter_rule(canonical_name: str) -> dict:
    return {"field": canonical_name, "value": "this"}


def _is_source_filter(rule: object, source_names: set[str]) -> bool:
    return (
        isinstance(rule, dict)
        and _brain_schema_token(rule.get("field")) in {
            _brain_schema_token(name) for name in source_names
        }
    )


def _strip_source_filter_nodes(node: object, source_names: set[str]) -> object:
    if not isinstance(node, dict):
        return node
    rules = node.get("rules")
    if not isinstance(rules, list):
        return None if _is_source_filter(node, source_names) else dict(node)
    kept = [
        child
        for rule in rules
        if (child := _strip_source_filter_nodes(rule, source_names)) is not None
    ]
    if not kept:
        return None
    if len(kept) == 1:
        return kept[0]
    result = dict(node)
    result["rules"] = kept
    return result


def _normalize_brain_source_view(
    view: dict,
    canonical_name: str,
    source_names: set[str],
) -> bool:
    """Guarantee one contextual source filter while preserving other filters."""
    before = json.dumps(view, sort_keys=True, ensure_ascii=False)
    source_rule = _source_filter_rule(canonical_name)

    filters = view.get("filters")
    if isinstance(filters, list):
        remaining = [rule for rule in filters if not _is_source_filter(rule, source_names)]
        view["filters"] = [source_rule, *remaining]
    elif isinstance(view.get("filter"), dict):
        legacy_filter = view.pop("filter")
        remaining = [] if _is_source_filter(legacy_filter, source_names) else [legacy_filter]
        view["filters"] = [source_rule, *remaining]
    else:
        view["filters"] = [source_rule]

    filter_tree = view.get("filterTree")
    if isinstance(filter_tree, dict):
        remaining_tree = _strip_source_filter_nodes(filter_tree, source_names)
        view["filterTree"] = (
            source_rule
            if remaining_tree is None
            else {"conjunction": "and", "rules": [source_rule, remaining_tree]}
        )

    return before != json.dumps(view, sort_keys=True, ensure_ascii=False)


def _embedded_view_ids_for_table(table_id: str) -> set[str]:
    view_ids: set[str] = set()
    for page in _get_pages_for_table(table_id) or []:
        path_value = getattr(page, "path", None)
        path = Path(path_value) if path_value else None
        if not path or not path.exists():
            continue
        try:
            raw = path.read_text(encoding="utf-8")
        except Exception as error:
            log.warning("Could not inspect embedded views in %s: %s", path, error)
            continue
        for match in _BRAIN_VIEW_DEF_RE.finditer(raw):
            try:
                payload = json.loads(match.group("payload"))
            except (TypeError, ValueError):
                continue
            view_id = str(payload.get("view_id") or "").strip()
            if view_id:
                view_ids.add(view_id)
    return view_ids


def _normalize_brain_source_views(
    brain_table_id: str,
    source_table_id: str,
    canonical_name: str,
    source_names: set[str],
) -> int:
    """Repair every Brain view embedded in pages of one configured source."""
    embedded_ids = _embedded_view_ids_for_table(source_table_id)
    if not embedded_ids:
        return 0
    changed = 0
    with registry_mutation():
        registry = load_registry()
        views = registry.get("views") or []
        by_id = {
            str(view.get("id") or ""): view
            for view in views
            if isinstance(view, dict)
        }
        pending = list(embedded_ids)
        while pending:
            view_id = pending.pop()
            view = by_id.get(view_id)
            if not view:
                continue
            for tab_id in view.get("tabs") or []:
                tab_id = str(tab_id or "")
                if tab_id and tab_id not in embedded_ids:
                    embedded_ids.add(tab_id)
                    pending.append(tab_id)
        for view_id in embedded_ids:
            view = by_id.get(view_id)
            if (
                not view
                or str(view.get("table_id") or "") != brain_table_id
                or not view.get("embedded")
            ):
                continue
            if _normalize_brain_source_view(view, canonical_name, source_names):
                changed += 1
        if changed:
            save_registry(registry)
            log.info(
                "LLM Wiki normalized %d embedded Brain source filters for table %s",
                changed,
                source_table_id,
            )
    return changed


def ensure_brain_source_relation(
    brain_table_id: str,
    source_table_id: str,
    locale: str = "en",
) -> str:
    """Return the single canonical Brain relation targeting one source table.

    A singular relation is preferred, duplicate plural relations are merged and
    removed, and resource-page views are normalized to filter by the host page.
    """
    if not brain_table_id or not source_table_id:
        return ""
    canonical_name = _brain_source_name(locale)
    legacy_names: set[str] = set()
    source_names: set[str] = {canonical_name}
    relation_id = ""
    with registry_mutation():
        registry = load_registry()
        brain = next(
            (table for table in registry.get("tables", []) or [] if table.get("id") == brain_table_id),
            None,
        )
        source = next(
            (table for table in registry.get("tables", []) or [] if table.get("id") == source_table_id),
            None,
        )
        if not brain or not source:
            return ""
        properties = brain.setdefault("properties", [])
        compatible = [
            prop for prop in properties
            if prop.get("type") == "relation"
            and str(prop.get("relation_database_id") or "") == source_table_id
            and _brain_schema_token(prop.get("name")) not in _brain_role_tokens("based_on")
        ]
        compatible.sort(
            key=lambda prop: (
                _brain_schema_token(prop.get("name")) not in _BRAIN_SOURCE_SINGULAR_TOKENS,
                _brain_schema_token(prop.get("name")) in _BRAIN_SOURCE_PLURAL_TOKENS,
            )
        )
        changed = False
        if compatible:
            canonical = compatible[0]
        else:
            used_names = {str(prop.get("name") or "").casefold() for prop in properties}
            name = canonical_name
            if name.casefold() in used_names:
                base_name = f"{canonical_name} · {source.get('name') or source_table_id}"
                name = base_name
                suffix = 2
                while name.casefold() in used_names:
                    name = f"{base_name} {suffix}"
                    suffix += 1
            canonical = {
                "id": str(uuid.uuid4()),
                "name": name,
                "type": "relation",
                "relation_database_id": source_table_id,
                "cardinality": "many-to-one",
            }
            properties.append(canonical)
            compatible = [canonical]
            changed = True

        original_name = str(canonical.get("name") or canonical_name)
        original_token = _brain_schema_token(original_name)
        used_by_others = {
            str(prop.get("name") or "").casefold()
            for prop in properties
            if prop is not canonical
        }
        if original_token in _BRAIN_SOURCE_PLURAL_TOKENS:
            replacement_name = canonical_name
            suffix = 2
            if replacement_name.casefold() in used_by_others:
                base_name = f"{canonical_name} · {source.get('name') or source_table_id}"
                replacement_name = base_name
                while replacement_name.casefold() in used_by_others:
                    replacement_name = f"{base_name} {suffix}"
                    suffix += 1
            canonical["name"] = replacement_name
            legacy_names.add(original_name)
            changed = True
        canonical_name = str(canonical.get("name") or canonical_name)
        source_names.add(canonical_name)

        if not canonical.get("id"):
            canonical["id"] = str(uuid.uuid4())
            changed = True
        if canonical.get("cardinality") != "many-to-one":
            canonical["cardinality"] = "many-to-one"
            changed = True

        duplicates = [prop for prop in compatible if prop is not canonical]
        for duplicate in duplicates:
            duplicate_name = str(duplicate.get("name") or "")
            if duplicate_name:
                legacy_names.add(duplicate_name)
                source_names.add(duplicate_name)
        aliases = [
            str(alias)
            for alias in canonical.get("aliases") or []
            if str(alias).strip() and str(alias) != canonical_name
        ]
        for name in sorted(legacy_names):
            if name and name not in aliases:
                aliases.append(name)
        if aliases != (canonical.get("aliases") or []):
            canonical["aliases"] = aliases
            changed = True
        if duplicates:
            duplicate_ids = {id(prop) for prop in duplicates}
            brain["properties"] = [
                prop for prop in properties if id(prop) not in duplicate_ids
            ]
            changed = True

        relation_id = str(canonical.get("id") or "")
        if changed:
            save_registry(registry)
            log.info(
                "LLM Wiki consolidated the source relation %s in Brain %s",
                relation_id,
                brain_table_id,
            )

    migrated = _migrate_brain_source_metadata(
        brain_table_id,
        canonical_name,
        legacy_names,
    )
    if migrated:
        log.info("LLM Wiki migrated %d Brain pages to %s", migrated, canonical_name)
    _normalize_brain_source_views(
        brain_table_id,
        source_table_id,
        canonical_name,
        source_names | legacy_names,
    )
    return relation_id


def _normalize_brain_page_contract(
    metadata: dict,
    config: dict,
    brain_table: dict,
    source_titles: dict[tuple[str, str], str],
) -> bool:
    """Normalize visible note types, source cardinality, and source labels."""
    from backend.services import llm_wiki_config

    before = json.dumps(metadata, sort_keys=True, ensure_ascii=False, default=str)
    props_by_id = {
        str(prop.get("id") or ""): prop
        for prop in brain_table.get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }
    note_type_id = str((config.get("brain_roles") or {}).get("note_type") or "")
    note_type_prop = props_by_id.get(note_type_id)
    note_type_name = str((note_type_prop or {}).get("name") or "")
    stored_kind = llm_wiki_config.metadata_note_type(metadata)
    managed_role = str(metadata.get("llm_wiki_role") or "")
    semantic_kind = (
        "reading"
        if stored_kind == "lectura"
        else stored_kind
    )
    if not semantic_kind and managed_role.endswith("-index"):
        semantic_kind = "index"
    if semantic_kind and note_type_name:
        metadata[note_type_name] = llm_wiki_config.note_type_value(
            semantic_kind,
            config,
            note_type_prop,
        )

    source_names: set[str] = set()
    source_relations: dict[str, dict] = {}
    for source in config.get("source_tables") or []:
        relation = props_by_id.get(str(source.get("relation_property_id") or ""))
        if not relation:
            continue
        relation_name = str(relation.get("name") or "")
        if relation_name:
            source_names.add(relation_name)
            source_names.update(
                str(alias)
                for alias in relation.get("aliases") or []
                if str(alias).strip()
            )
            source_relations[str(source.get("table_id") or "")] = relation

    if stored_kind == "permanent":
        for name in source_names:
            metadata.pop(name, None)
    else:
        source_table_id = str(metadata.get("llm_wiki_source_table_id") or "")
        resource_id = str(metadata.get("llm_wiki_resource_id") or "")
        source_title = source_titles.get((source_table_id, resource_id))
        relation = source_relations.get(source_table_id)
        if source_title and resource_id:
            metadata["llm_wiki_resource_title"] = source_title
            if relation and (semantic_kind == "reading" or managed_role == "resource-index"):
                relation_name = str(relation.get("name") or "")
                for alias in relation.get("aliases") or []:
                    metadata.pop(str(alias), None)
                metadata[relation_name] = [f"[[{source_title}|{resource_id}]]"]
            if managed_role == "resource-index":
                locale = str(config.get("ui_locale") or "en").split("-", 1)[0].lower()
                prefix = {
                    "ca": "Índex",
                    "en": "Index",
                    "es": "Índice",
                    "fr": "Index",
                }.get(locale, "Index")
                metadata["title"] = f"{prefix} · {source_title}"

    return before != json.dumps(metadata, sort_keys=True, ensure_ascii=False, default=str)


def _normalize_existing_brain_pages(
    brain_table_id: str,
    config: dict,
) -> int:
    """Migrate existing managed notes to the current singular-source contract."""
    from backend.services import llm_wiki_storage

    brain_table = _table_by_id(brain_table_id) or {}
    source_titles: dict[tuple[str, str], str] = {}
    for source in config.get("source_tables") or []:
        source_table_id = str(source.get("table_id") or "")
        source_table = _table_by_id(source_table_id) or {}
        for page in _get_pages_for_table(source_table_id) or []:
            resource_id = str(getattr(page, "id", "") or "")
            path_value = getattr(page, "path", None)
            path = Path(path_value) if path_value else None
            metadata = getattr(page, "metadata", None) or {}
            if path and path.exists() and not metadata:
                try:
                    metadata, _body = parse_frontmatter(
                        path.read_text(encoding="utf-8"),
                        path,
                    )
                except Exception as error:
                    log.warning("Could not read source title from %s: %s", path, error)
            if resource_id and path:
                source_titles[(source_table_id, resource_id)] = _llm_wiki_source_title(
                    metadata,
                    path,
                    source_table,
                    source,
                )

    migrated = 0
    for page in _get_pages_for_table(brain_table_id) or []:
        path_value = getattr(page, "path", None)
        path = Path(path_value) if path_value else None
        if not path or not path.exists():
            continue
        try:
            raw_metadata, body = parse_frontmatter(path.read_text(encoding="utf-8"), path)
            page_id = str(
                getattr(page, "id", "")
                or raw_metadata.get("id")
                or ""
            )
            metadata = llm_wiki_storage.merge_page_metadata(raw_metadata, page_id)
            contract_changed = _normalize_brain_page_contract(
                metadata,
                config,
                brain_table,
                source_titles,
            )
            portable_metadata = llm_wiki_storage.prepare_managed_markdown(metadata)
            portable_metadata.pop("note_type", None)
            if not contract_changed and portable_metadata == raw_metadata:
                continue
            save_page_md(path, portable_metadata, body)
            register_page_in_index(path)
            migrated += 1
        except Exception as error:
            log.warning("Could not normalize a managed Brain page in %s: %s", path, error)
    if migrated:
        log.info("LLM Wiki normalized %d existing Brain pages", migrated)
    return migrated


def _reconcile_llm_wiki_source_contract(cfg: dict) -> dict:
    """Apply the singular-source schema and embedded-view migration once."""
    from backend.services import llm_wiki_config

    brain_id = str(cfg.get("brain_table_id") or "")
    if not brain_id or not _table_by_id(brain_id):
        return cfg
    locale = str(cfg.get("ui_locale") or "en")
    brain_table = _table_by_id(brain_id)
    ensure_brain_table_schema(
        brain_id,
        locale,
        _brain_property_id_hints(cfg, brain_table),
    )
    changed = (
        int(cfg.get("source_contract_revision") or 0)
        < BRAIN_SOURCE_CONTRACT_REVISION
    )
    for source in cfg.get("source_tables") or []:
        relation_id = ensure_brain_source_relation(
            brain_id,
            str(source.get("table_id") or ""),
            locale,
        )
        if relation_id and relation_id != str(source.get("relation_property_id") or ""):
            source["relation_property_id"] = relation_id
            changed = True
    roles = _infer_brain_roles(_table_by_id(brain_id))
    if roles != (cfg.get("brain_roles") or {}):
        cfg["brain_roles"] = roles
        changed = True
    _normalize_existing_brain_pages(brain_id, cfg)
    if cfg.get("source_contract_revision") != BRAIN_SOURCE_CONTRACT_REVISION:
        cfg["source_contract_revision"] = BRAIN_SOURCE_CONTRACT_REVISION
        changed = True
    return llm_wiki_config.set_full_config(cfg) if changed else cfg


@router.get("/brain-table")
async def get_brain_table():
    """Return the designated Brain table status for Settings and UI gating.

    Resolve the per-vault designation in the active vault.
    """
    from backend.services import llm_wiki_config as bw

    cfg = bw.migrate_config()
    tid = cfg.get("brain_table_id")
    t = _table_by_id(tid) if tid else None
    return {"table_id": tid, "configured": bool(tid),
            "name": t.get("name") if t else None,
            "source_table_ids": [
                item.get("table_id") for item in cfg.get("source_tables") or []
                if item.get("table_id")
            ],
            "index_field_ids": cfg.get("index_field_ids") or []}


@router.post("/brain-table", dependencies=[Depends(require_role("editor"))])
async def set_brain_table(payload: dict = Body(...)):
    """Designate an existing table as the Brain and guarantee its
    knowledge schema (note type, sources, verification status, and more)."""
    from backend.services import llm_wiki_config as bw

    table_id = str((payload or {}).get("table_id") or "").strip()
    if not table_id:
        raise HTTPException(status_code=400, detail="table_id is required")
    if not _table_by_id(table_id):
        raise HTTPException(status_code=404, detail=f"Table {table_id} not found")
    locale = str((payload or {}).get("ui_locale") or (payload or {}).get("language") or "en")
    _ensure_default_db_group()
    added = ensure_brain_table_schema(table_id, locale)
    cfg = bw.migrate_config()
    cfg["ui_locale"] = locale
    cfg["brain_table_id"] = table_id
    cfg["target_table"] = table_id
    cfg["brain_roles"] = _infer_brain_roles(_table_by_id(table_id))
    for source in cfg.get("source_tables") or []:
        source["relation_property_id"] = ensure_brain_source_relation(
            table_id,
            str(source.get("table_id") or ""),
            locale,
        )
    cfg["source_contract_revision"] = BRAIN_SOURCE_CONTRACT_REVISION
    cfg = bw.set_full_config(cfg)
    from backend.services import llm_wiki_indices

    await asyncio.to_thread(llm_wiki_indices.ensure_system_pages, table_id, cfg)
    t = _table_by_id(table_id)
    return {"table_id": table_id, "configured": True,
            "name": t.get("name") if t else None, "columns_added": added}


@router.post("/brain-table/create", dependencies=[Depends(require_role("editor"))])
async def create_brain_table(payload: dict = Body(default=None)):
    """Create and designate a new Brain table with the knowledge schema."""
    from backend.services import llm_wiki_config as bw

    locale = str((payload or {}).get("ui_locale") or (payload or {}).get("language") or "en")
    language = locale.split("-", 1)[0].lower()
    name = str((payload or {}).get("name") or "").strip() or {
        "ca": "Cervell",
        "en": "Brain",
        "es": "Cerebro",
        "fr": "Cerveau",
    }.get(language, "Brain")
    # Mint the table id upfront: the `Basada en` self-relation needs it while
    # building the seed properties (create_table keeps an explicit id).
    new_id = str(uuid.uuid4())
    table = {
        "id": new_id,
        "name": name,
        "database_id": "gnosi_vault_db",
        "properties": [
            _brain_property(role, field_name, property_type, brain_table_id=new_id)
            for role, field_name, property_type in _brain_schema(locale)
        ],
    }
    created = await create_table(table)
    _ensure_default_db_group()
    cfg = bw.migrate_config()
    cfg["ui_locale"] = locale
    cfg["brain_table_id"] = created["id"]
    cfg["target_table"] = created["id"]
    cfg["brain_roles"] = _infer_brain_roles(_table_by_id(created["id"]))
    for source in cfg.get("source_tables") or []:
        source["relation_property_id"] = ensure_brain_source_relation(
            created["id"],
            str(source.get("table_id") or ""),
            locale,
        )
    cfg["source_contract_revision"] = BRAIN_SOURCE_CONTRACT_REVISION
    cfg["index_field_ids"] = [
        field_id
        for role in ("areas", "tags")
        if (field_id := str(cfg["brain_roles"].get(role) or ""))
    ]
    cfg = bw.set_full_config(cfg)
    from backend.services import llm_wiki_indices

    await asyncio.to_thread(llm_wiki_indices.ensure_system_pages, created["id"], cfg)
    return {"table_id": created["id"], "configured": True,
            "name": created.get("name"), "created": True}


@router.delete("/brain-table", dependencies=[Depends(require_role("editor"))])
async def clear_brain_table():
    """Disable the Brain designation without deleting any table."""
    from backend.services import llm_wiki_config as bw

    bw.set_brain_table_id("")
    return {"table_id": None, "configured": False}


def _llm_wiki_config_response(cfg: dict) -> dict:
    """Enrich the persisted contract with validation and runtime capabilities."""
    from backend.services import llm_wiki_config as wiki_cfg, llm_wiki_storage
    from backend.services.llm_wiki_extractors import capability_report

    brain_id = str(cfg.get("brain_table_id") or "")
    brain = _table_by_id(brain_id) if brain_id else None
    source_ids = [
        str(item.get("table_id") or "")
        for item in cfg.get("source_tables") or []
        if item.get("table_id")
    ]
    missing = []
    if brain_id and not brain:
        missing.append({"kind": "brain_table", "id": brain_id})
    for source_id in source_ids:
        if not _table_by_id(source_id):
            missing.append({"kind": "source_table", "id": source_id})
    source_relation_ids = {
        str(item.get("relation_property_id") or "")
        for item in cfg.get("source_tables") or []
        if item.get("relation_property_id")
    }
    note_type_id = str((cfg.get("brain_roles") or {}).get("note_type") or "")
    eligible = wiki_cfg.eligible_index_properties(
        brain,
        excluded_ids=source_relation_ids | {note_type_id},
    )
    index_options = {
        str(prop.get("id")): _llm_wiki_property_options(prop)
        for prop in eligible
    }
    return {
        "config": cfg,
        "brain": {
            "table_id": brain_id or None,
            "name": brain.get("name") if brain else None,
            "configured": bool(brain),
        },
        "eligible_index_properties": eligible,
        "index_options": index_options,
        "capabilities": capability_report(),
        "validation": {
            "valid": bool(brain) and bool(source_ids) and not missing,
            "missing": missing,
        },
        "processed_resources": llm_wiki_storage.processed_resources(source_ids),
        "resource_statuses": llm_wiki_storage.resource_statuses(source_ids),
        "enabled": _llm_wiki_enabled(_load_plugins_state()),
    }


def _llm_wiki_property_options(prop: dict) -> list[dict[str, str]]:
    """Return canonical existing values for one categorical Brain property."""
    if str(prop.get("type") or "") == "relation":
        target_id = str(prop.get("relation_database_id") or "")
        return [
            {
                "label": str(getattr(page, "title", "") or ""),
                "value": f"[[{getattr(page, 'title', '')}|{getattr(page, 'id', '')}]]",
            }
            for page in (_get_pages_for_table(target_id) or [])[:250]
            if getattr(page, "title", None) and getattr(page, "id", None)
        ] if target_id else []
    raw_options = (
        prop.get("options")
        or (prop.get("config") or {}).get("options")
        or (prop.get("select") or {}).get("options")
        or []
    )
    return [
        {
            "label": str(option.get("name") if isinstance(option, dict) else option),
            "value": str(option.get("name") if isinstance(option, dict) else option),
        }
        for option in raw_options if str(
            option.get("name") if isinstance(option, dict) else option
        ).strip()
    ]


@router.get("/llm-wiki/config")
async def get_llm_wiki_config():
    """Return the migrated v2 per-vault LLM Wiki configuration."""
    from backend.services import llm_wiki_config

    cfg = await asyncio.to_thread(llm_wiki_config.migrate_config)
    if (
        int(cfg.get("source_contract_revision") or 0)
        < BRAIN_SOURCE_CONTRACT_REVISION
    ):
        cfg = await asyncio.to_thread(_reconcile_llm_wiki_source_contract, cfg)
    return await asyncio.to_thread(_llm_wiki_config_response, cfg)


@router.put("/llm-wiki/config", dependencies=[Depends(require_role("editor"))])
async def put_llm_wiki_config(payload: dict = Body(...)):
    """Validate and atomically save Brain, sources, roles, and index fields."""
    from backend.services import llm_wiki_config, llm_wiki_indices

    normalized = llm_wiki_config.normalize_config(payload)
    brain_id = str(normalized.get("brain_table_id") or "")
    if not brain_id or not _table_by_id(brain_id):
        raise HTTPException(status_code=400, detail="A valid Brain table is required")
    if not normalized.get("source_tables"):
        raise HTTPException(status_code=400, detail="At least one source table is required")
    for source in normalized["source_tables"]:
        source_id = str(source.get("table_id") or "")
        if source_id == brain_id:
            raise HTTPException(status_code=400, detail="The Brain table cannot also be a source table")
        if not _table_by_id(source_id):
            raise HTTPException(status_code=404, detail=f"Source table {source_id} was not found")

    brain = _table_by_id(brain_id) or {}
    requested_index_ids = list(normalized.get("index_field_ids") or [])
    brain_properties = {
        str(prop.get("id") or ""): prop
        for prop in brain.get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }
    preliminary_roles = _infer_brain_roles(brain)
    configured_source_ids = {
        str(source.get("table_id") or "")
        for source in normalized["source_tables"]
    }
    existing_source_relation_ids = {
        str(prop.get("id") or "")
        for prop in brain.get("properties") or []
        if prop.get("type") == "relation"
        and str(prop.get("relation_database_id") or "") in configured_source_ids
    }
    eligible_ids_before_mutation = {
        str(prop.get("id"))
        for prop in llm_wiki_config.eligible_index_properties(
            brain,
            excluded_ids=existing_source_relation_ids | {
                str(preliminary_roles.get("note_type") or ""),
            },
        )
    }
    invalid_index_ids = [
        field_id for field_id in requested_index_ids
        if field_id not in eligible_ids_before_mutation
    ]
    if invalid_index_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Non-categorical or reserved index fields: {', '.join(invalid_index_ids)}",
        )

    prepared_sources = []
    for source in normalized["source_tables"]:
        source_id = str(source["table_id"])
        source_table = _table_by_id(source_id) or {}
        source_properties = {
            str(prop.get("id") or ""): prop
            for prop in source_table.get("properties") or []
            if isinstance(prop, dict) and prop.get("id")
        }
        prepared = llm_wiki_config.auto_detect_source(
            source_table,
            brain,
            requested_index_ids,
            source,
        )
        scalar_ids = [
            str(prepared.get("title_property_id") or ""),
            str(prepared.get("language_property_id") or ""),
        ]
        if any(field_id and field_id not in source_properties for field_id in scalar_ids):
            raise HTTPException(status_code=400, detail=f"Invalid source field in table {source_id}")
        invalid_file_ids = [
            field_id for field_id in prepared.get("attachment_property_ids") or []
            if str((source_properties.get(field_id) or {}).get("type") or "").lower()
            not in llm_wiki_config.FILE_TYPES
        ]
        invalid_url_ids = [
            field_id for field_id in prepared.get("url_property_ids") or []
            if str((source_properties.get(field_id) or {}).get("type") or "").lower()
            not in llm_wiki_config.URL_TYPES | {"text", "rich_text"}
        ]
        if invalid_file_ids or invalid_url_ids:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid attachment or URL field type in table {source_id}",
            )
        for field_id in requested_index_ids:
            mapping = (prepared.get("dimension_mappings") or {}).get(field_id) or {"mode": "ai"}
            mode = str(mapping.get("mode") or "ai")
            brain_prop = brain_properties[field_id]
            if mode == "source":
                source_prop = source_properties.get(str(mapping.get("source_property_id") or ""))
                if not source_prop or not llm_wiki_config._compatible_dimension_types(
                    str(source_prop.get("type") or ""),
                    str(brain_prop.get("type") or ""),
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Incompatible categorical mapping for {field_id} in table {source_id}",
                    )
                if (
                    source_prop.get("type") == "relation"
                    and str(source_prop.get("relation_database_id") or "")
                    != str(brain_prop.get("relation_database_id") or "")
                ):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Relation mapping for {field_id} points to a different table",
                    )
            elif mode == "fixed":
                options = _llm_wiki_property_options(brain_prop)
                canonical = {
                    str(item["label"]).strip().casefold(): item["value"]
                    for item in options
                }
                raw_values = mapping.get("fixed_value")
                raw_values = raw_values if isinstance(raw_values, list) else [raw_values]
                values = [
                    canonical.get(str(value or "").strip().casefold())
                    for value in raw_values
                    if str(value or "").strip()
                ]
                if not values or any(value is None for value in values):
                    raise HTTPException(
                        status_code=400,
                        detail=f"Fixed value for {field_id} must already exist in the Brain field",
                    )
                mapping["fixed_value"] = (
                    values
                    if str(brain_prop.get("type") or "") in {"multi_select", "relation"}
                    else values[0]
                )
        prepared_sources.append(prepared)

    _ensure_default_db_group()
    ensure_brain_table_schema(brain_id, normalized.get("ui_locale") or "en")
    brain = _table_by_id(brain_id)
    normalized["brain_roles"] = _infer_brain_roles(brain)

    relation_ids = set()
    for source in prepared_sources:
        source_id = str(source["table_id"])
        source["relation_property_id"] = ensure_brain_source_relation(
            brain_id,
            source_id,
            normalized.get("ui_locale") or "en",
        )
        relation_ids.add(source["relation_property_id"])
    normalized["source_tables"] = prepared_sources
    brain = _table_by_id(brain_id)
    note_type_id = str(normalized["brain_roles"].get("note_type") or "")
    eligible_ids = {
        str(prop.get("id"))
        for prop in llm_wiki_config.eligible_index_properties(
            brain,
            excluded_ids=relation_ids | {note_type_id},
        )
    }
    invalid_index_ids = [field_id for field_id in requested_index_ids if field_id not in eligible_ids]
    if invalid_index_ids:
        raise HTTPException(
            status_code=400,
            detail=f"Non-categorical or reserved index fields: {', '.join(invalid_index_ids)}",
        )
    normalized["index_field_ids"] = requested_index_ids
    normalized["source_contract_revision"] = BRAIN_SOURCE_CONTRACT_REVISION
    normalized["configured"] = True
    saved = await asyncio.to_thread(llm_wiki_config.set_full_config, normalized)
    await asyncio.to_thread(llm_wiki_indices.ensure_system_pages, brain_id, saved)
    return await asyncio.to_thread(_llm_wiki_config_response, saved)


@router.post("/llm-wiki/brain/create", dependencies=[Depends(require_role("editor"))])
async def create_standard_llm_wiki_brain(payload: dict = Body(default=None)):
    """Compatibility-namespaced alias used by the v2 Settings panel."""
    result = await create_brain_table(payload)
    from backend.services import llm_wiki_config

    cfg = await asyncio.to_thread(llm_wiki_config.load_config)
    return {**result, **(await asyncio.to_thread(_llm_wiki_config_response, cfg))}


# ---------------------------------------------------------------------------
# LLM Wiki (Brain) ingest: the per-row "Process resource" action on a configured
# source table. It uses an asynchronous job (reader.py pattern). See directive
# `llm_wiki_cervell.md` and service `llm_wiki.py`.
# ---------------------------------------------------------------------------

# Visible `date` system column on the references table: the ingest date, which
# is both the "only once" guard and the signal the frontend derives the button
# from (mirrors the Drupal NID / XXSS system columns).
LLM_WIKI_PROCESSED_COL = "Processat pel Cervell"


def ensure_llm_wiki_column(reference_table_id: str) -> bool:
    """Add the `Processat pel Cervell` system date column when missing.

    Return True when the column was added.
    """
    if not reference_table_id:
        return False
    with registry_mutation():
        reg = load_registry()
        table = next((t for t in reg.get("tables", []) or []
                      if t.get("id") == reference_table_id), None)
        if not table:
            return False
        props = table.setdefault("properties", [])
        norm = LLM_WIKI_PROCESSED_COL.lower().replace(" ", "")
        if any(str(p.get("name") or "").lower().replace(" ", "") == norm for p in props):
            return False
        props.append({
            "id": str(uuid.uuid4()), "name": LLM_WIKI_PROCESSED_COL,
            "type": "date", "system": True,
        })
        save_registry(reg)
        log.info("🧠 Column «%s» added to the Resources table %s",
                 LLM_WIKI_PROCESSED_COL, reference_table_id)
        return True


def _resource_processed_value(metadata: dict) -> str:
    """The `Processat pel Cervell` value in a row's metadata, or ''."""
    for k in (LLM_WIKI_PROCESSED_COL, LLM_WIKI_PROCESSED_COL.lower()):
        v = (metadata or {}).get(k)
        if v not in (None, "", [], {}):
            return str(v)
    return ""


def _llm_wiki_title_value(value: object) -> str:
    """Return one displayable title without serializing structured metadata."""
    if isinstance(value, list):
        value = next((item for item in value if item not in (None, "")), "")
    if isinstance(value, dict):
        value = next(
            (
                value.get(key)
                for key in ("title", "name", "label", "value")
                if value.get(key) not in (None, "")
            ),
            "",
        )
    return str(value or "").strip()


def _llm_wiki_source_title(
    metadata: dict,
    path: Path,
    source_table: dict,
    source_config: dict,
) -> str:
    """Resolve a source title from its configured title property before UID fallbacks."""
    title_property_id = str(source_config.get("title_property_id") or "")
    title_property = next(
        (
            prop
            for prop in source_table.get("properties") or []
            if str(prop.get("id") or "") == title_property_id
        ),
        None,
    )
    title_property_name = str((title_property or {}).get("name") or "")
    candidates = [
        metadata.get(title_property_name) if title_property_name else None,
        metadata.get(title_property_id) if title_property_id else None,
        metadata.get("title"),
        metadata.get("Title"),
        path.stem,
    ]
    return next(
        (title for value in candidates if (title := _llm_wiki_title_value(value))),
        path.stem,
    )


def mark_resource_processed(page_id: str, date_str: str) -> bool:
    """Write the ingest date to the resource's `Processat pel Cervell` column."""
    path = find_page_path(page_id)
    if not path or not path.exists():
        return False
    raw = path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(raw, path)
    metadata[LLM_WIKI_PROCESSED_COL] = date_str
    save_page_md(path, metadata, body)
    register_page_in_index(path)
    return True


@router.post("/llm-wiki/process", dependencies=[Depends(require_role("editor"))])
async def llm_wiki_process(payload: dict = Body(...)):
    """Start a durable ingest for one row of a configured source table."""
    from backend.services.llm_wiki_actions import (
        LlmWikiActionError,
        start_source_process,
    )

    try:
        return await asyncio.to_thread(
            start_source_process,
            str(
                (payload or {}).get("resource_id")
                or (payload or {}).get("item_id")
                or ""
            ),
            source_table_id=str((payload or {}).get("source_table_id") or ""),
            force=bool((payload or {}).get("force")),
            language=str((payload or {}).get("language") or ""),
        )
    except LlmWikiActionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/llm-wiki/status/{item_id}", dependencies=[Depends(require_role("editor"))])
async def llm_wiki_status(item_id: str, source_table_id: str = Query(default="")):
    """Non-blocking status of a resource's ongoing/last ingest (for polling)."""
    from backend.services.llm_wiki_actions import (
        LlmWikiActionError,
        process_status,
    )

    try:
        return await asyncio.to_thread(
            process_status,
            item_id,
            source_table_id=source_table_id,
        )
    except LlmWikiActionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/llm-wiki/evidence/{resource_id}/{snapshot_id}/{segment_id}",
            dependencies=[Depends(require_role("editor"))])
async def llm_wiki_evidence(resource_id: str, snapshot_id: str, segment_id: str):
    """Return one persisted normalized source segment for a citation drawer."""
    from backend.services import llm_wiki_storage

    evidence = await asyncio.to_thread(
        llm_wiki_storage.load_evidence,
        resource_id,
        snapshot_id,
        segment_id,
    )
    if not evidence:
        raise HTTPException(status_code=404, detail="Citation evidence was not found")
    return evidence


@router.post("/llm-wiki/maintenance", dependencies=[Depends(require_role("editor"))])
async def llm_wiki_maintenance(semantic: bool = Query(default=False)):
    """Rebuild managed indexes/cache and run deterministic lint.

    ``semantic=true`` additionally runs the connection/contradiction proposal
    pass. Scheduled maintenance always uses the deterministic default.
    """
    from backend.services.llm_wiki_actions import (
        LlmWikiActionError,
        run_maintenance_async,
    )

    try:
        return await run_maintenance_async(semantic=semantic)
    except LlmWikiActionError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get("/llm-wiki/lint", dependencies=[Depends(require_role("editor"))])
async def llm_wiki_lint(suggest: bool = Query(default=False)):
    """Run deterministic lint and optionally request a manual semantic pass."""
    from backend.services import llm_wiki_config, llm_wiki_lint, llm_wiki_suggestions

    brain_table_id = llm_wiki_config.get_brain_table_id()
    if not brain_table_id:
        raise HTTPException(status_code=400, detail="No Brain table has been designated")
    source_ids = llm_wiki_config.get_source_table_ids()
    report = await asyncio.to_thread(llm_wiki_lint.run_lint, brain_table_id, source_ids)
    if suggest:
        report["suggestions_queued"] = await asyncio.to_thread(
            llm_wiki_suggestions.generate_suggestions, brain_table_id
        )
    report["suggestions_pending"] = len(llm_wiki_suggestions.load_queue())
    return report


@router.get("/llm-wiki/suggestions", dependencies=[Depends(require_role("editor"))])
async def llm_wiki_list_suggestions():
    """Return pending read-only connection proposals for the Brain inbox."""
    from backend.services import llm_wiki_suggestions

    return {"suggestions": await asyncio.to_thread(llm_wiki_suggestions.load_queue)}


@router.post("/llm-wiki/suggestions/{suggestion_id}/accept",
             dependencies=[Depends(require_role("editor"))])
async def llm_wiki_accept_suggestion(suggestion_id: str, payload: dict = Body(default=None)):
    """Permanent-note creation was removed; proposals are read-only."""
    raise HTTPException(
        status_code=410,
        detail="Connection proposals cannot create permanent notes",
    )


@router.post("/llm-wiki/suggestions/{suggestion_id}/reject",
             dependencies=[Depends(require_role("editor"))])
async def llm_wiki_reject_suggestion(suggestion_id: str):
    """Discards a pending suggestion (no note is created)."""
    from backend.services import llm_wiki_suggestions

    sug = await asyncio.to_thread(llm_wiki_suggestions.pop_suggestion, suggestion_id)
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion not found; it may already be resolved")
    return {"rejected": suggestion_id}


@router.post("/llm-wiki/suggestions/{suggestion_id}/dismiss",
             dependencies=[Depends(require_role("editor"))])
async def llm_wiki_dismiss_suggestion(suggestion_id: str):
    """Dismiss a read-only connection proposal."""
    return await llm_wiki_reject_suggestion(suggestion_id)


# --- Accessible Inbox editing (F6): variant selection and dictation with
# --- intent reconstruction, personal glossary. See `llm_wiki_assist.py`.

@router.post("/llm-wiki/suggestions/{suggestion_id}/reformulate",
             dependencies=[Depends(require_role("editor"))])
async def llm_wiki_reformulate(suggestion_id: str):
    """Labeled variants of a suggestion's draft, to pick with one click."""
    from backend.services import llm_wiki_assist, llm_wiki_suggestions

    sug = await asyncio.to_thread(llm_wiki_suggestions.get_suggestion, suggestion_id)
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion not found; it may be resolved")
    try:
        variants = await asyncio.to_thread(llm_wiki_assist.reformulate, sug)
    except Exception as exc:  # noqa: BLE001 — provider/auth/parse failures are all "AI unavailable" here
        log.warning(f"llm-wiki reformulate unavailable: {exc}")
        raise HTTPException(status_code=503, detail="AI is unavailable for rewriting; check the API key in Settings → AI")
    return {"variants": variants}


@router.post("/llm-wiki/suggestions/{suggestion_id}/dictate",
             dependencies=[Depends(require_role("editor"))])
async def llm_wiki_dictate(suggestion_id: str, audio: UploadFile = File(...)):
    """Dictated edit for a suggestion: transcribe (faster-whisper) and
    reconstruct the intent with the note's context + personal glossary.
    The result is a PROPOSAL ("Did you mean…?") — the frontend never applies it
    without the user's confirmation."""
    import tempfile

    from backend.services import llm_wiki_assist, llm_wiki_suggestions, transcription

    sug = await asyncio.to_thread(llm_wiki_suggestions.get_suggestion, suggestion_id)
    if not sug:
        raise HTTPException(status_code=404, detail="Suggestion not found; it may be resolved")
    if not transcription.is_available():
        raise HTTPException(status_code=503,
                            detail="Transcription is unavailable (faster-whisper is not installed)")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty audio")
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        result = await asyncio.to_thread(transcription.transcribe, tmp_path)
    finally:
        try:
            Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass
    transcript = (result or {}).get("text") or ""
    if not transcript.strip():
        raise HTTPException(status_code=400,
                            detail="No words were understood from the dictation; try again")
    return await asyncio.to_thread(llm_wiki_assist.correct_dictation, sug, transcript)


@router.post("/llm-wiki/glossary", dependencies=[Depends(require_role("editor"))])
async def llm_wiki_glossary_learn(payload: dict = Body(...)):
    """Stores a user-confirmed correction pair (heard → meant): the personal
    glossary the dictation corrector learns from."""
    from backend.services import llm_wiki_assist

    heard = str((payload or {}).get("heard") or "")
    meant = str((payload or {}).get("meant") or "")
    count = await asyncio.to_thread(llm_wiki_assist.learn_pair, heard, meant)
    return {"pairs": count}


def _ensure_recursos_citation_key(
    metadata: dict, table: Optional[dict] = None, *, regenerate: bool = False
) -> dict:
    """Guarantees that a page in the REFERENCES TABLE carries a `Citation Key`.

    Previously the key was only generated in the metadata lookup; a new entry
    or a normal save from the browser left the resource without a key and,
    therefore, not citable (`recursosPageToCsl`/`_recursos_metadata_to_csl`
    return None). Called from create/save/patch/duplicate, this function
    closes that gap: any persistence path leaves the resource citable.

    Gate EXCLUSIVE to designation: only acts if the page belongs to the
    references table designated in Settings (`get_reference_table_id`), not by
    any name/column heuristic. If the user changes the table in Settings, the
    generation follows the new one.

    Generates only when (1) it's the references table, (2) the cell is empty
    —or `regenerate=True`, e.g. when duplicating so the copy doesn't collide—
    and (3) there is some bibliographic data (Authors/Any/Title), so as not to
    stamp junk keys on completely empty rows. The key is unique against the
    ones already existing in the vault. Mutates and returns `metadata`."""
    ref_id = get_reference_table_id()
    if not ref_id or get_table_id(metadata) != ref_id:
        return metadata
    if table is None:
        table = _table_by_id(ref_id)
    # The references table should have a 'Citation Key' column (Settings
    # guarantees it); if not yet, we still write to the literal field that
    # the CSL readers and the citation index read.
    ck_name = _citation_key_prop_name(table) or "Citation Key"
    if not regenerate and str(metadata.get(ck_name) or "").strip():
        return metadata
    # The structured `autoria` field FIRST: it is what the resource editor (and
    # "Create from a source") writes today, while `Authors` is the legacy
    # free-form leftover. Reading only `Authors` meant every resource created
    # through the current UI fell through to the title branch of
    # `generate_citation_key` and got keys like `zztest2026` / `ref2024`
    # instead of `garciafernandez2026`.
    authors = _find_structured_authors(metadata) or metadata.get("Authors")
    year, title = metadata.get("Any"), metadata.get("Title")
    has_authors = bool(authors) if isinstance(authors, list) else bool(str(authors or "").strip())
    if not (has_authors or str(year or "").strip() or str(title or "").strip()):
        return metadata
    ck = generate_citation_key(authors, year, title or "", _existing_citation_keys())
    if ck:
        metadata[ck_name] = ck
    return metadata


def _dedupe_citation_key(metadata: dict, page_id: str) -> dict:
    """Keeps a hand-typed `Citation Key` unique across the references table.

    The key is the CSL-JSON `id`: two records sharing one means citeproc only
    ever sees one of them and the other is silently cited as its sibling (the
    vault accumulated 18 such collisions before the 2026-07 rebuild). Generated
    keys are already unique (`generate_citation_key` checks the index), but the
    grid lets the user TYPE any key into the cell — this closes that last path
    by suffixing `a`/`b`/`c`… on collision, Better-BibTeX-style; the adjusted
    value is visible immediately in the PATCH response. Best-effort: the check
    reads the cite key index, so a sibling created milliseconds ago may not be
    visible yet. Mutates and returns `metadata`."""
    ref_id = get_reference_table_id()
    if not ref_id or get_table_id(metadata) != ref_id:
        return metadata
    ck_name = _citation_key_prop_name(_table_by_id(ref_id)) or "Citation Key"
    ck = str(metadata.get(ck_name) or "").strip()
    if not ck:
        return metadata
    try:
        from backend.services.context_vars import get_active_vault_path
        v_path = get_active_vault_path()
        if not v_path:
            return metadata
        idx = _ensure_cite_key_index(str(v_path))
    except Exception:
        return metadata
    holder = idx.get(ck)
    if not holder or str(holder.get("id")) == str(page_id):
        return metadata
    i = 0
    while True:
        cand = f"{ck}{_alpha_suffix(i)}"
        holder = idx.get(cand)
        if not holder or str(holder.get("id")) == str(page_id):
            metadata[ck_name] = cand
            return metadata
        i += 1


def _reference_autoria_prop(table: Optional[dict]) -> Optional[dict]:
    """Returns the table's first `autoria`-type property (structured author
    list), or None when the table doesn't have one."""
    for p in (table or {}).get("properties", []) or []:
        if p.get("type") == "autoria":
            return p
    return None


def _authors_string_to_autoria(authors: str) -> list:
    """`"Cognom, Nom; …"` (canonical Recursos author string) → structured
    `autoria` list `[{"nom","cognom1","cognom2"}]`.

    Splits authors on ';'. For each author the text before the first comma is
    the family name(s) (first token → `cognom1`, the rest → `cognom2`) and the
    text after the comma is the given name(s) → `nom`. An author without a comma
    is treated as a single family/institution name (`cognom1`)."""
    out: list = []
    for part in str(authors or "").split(";"):
        part = part.strip()
        if not part:
            continue
        if "," in part:
            family, given = part.split(",", 1)
        else:
            family, given = part, ""
        fam_tokens = family.strip().split()
        author = {
            "nom": given.strip(),
            "cognom1": fam_tokens[0] if fam_tokens else "",
            "cognom2": " ".join(fam_tokens[1:]) if len(fam_tokens) > 1 else "",
        }
        if author["nom"] or author["cognom1"] or author["cognom2"]:
            out.append(author)
    return out


def _fill_autoria_from_authors(metadata: dict, table: Optional[dict]) -> dict:
    """Routes an imported `Authors` string into the table's `autoria` field.

    Create-from-source (PDF/DOI/ISBN/arXiv/PubMed/…) runs metadata through the
    canonical Zotero→Recursos mapper, which only knows the legacy text column
    `Authors`. When the references table has an `autoria`-type property (the
    structured field the user actually maintains), populate THAT instead so the
    import fills the real column rather than the deprecated text one — the
    feature must never leave the record's primary author field empty nor surface
    a stray legacy column.

    Gate EXCLUSIVE to designation (like `_ensure_recursos_citation_key`): only
    acts on the designated references table. Idempotent: only fills when the
    `autoria` cell is empty and an `Authors` value is present, and drops the
    consumed `Authors` key so the legacy column is left untouched (empty).
    Mutates and returns `metadata`."""
    ref_id = get_reference_table_id()
    if not ref_id or get_table_id(metadata) != ref_id:
        return metadata
    prop = _reference_autoria_prop(table)
    if not prop:
        return metadata
    name = prop.get("name")
    if not name or metadata.get(name) not in (None, "", []):
        return metadata
    parsed = _authors_string_to_autoria(metadata.get("Authors"))
    if not parsed:
        return metadata
    metadata[name] = parsed
    metadata.pop("Authors", None)
    return metadata


# ---------------------------------------------------------------------------
# PubMed / PMID lookup (P3) — NCBI E-utilities (esummary JSON, no API key).
# ---------------------------------------------------------------------------

def _normalize_pmid(raw: str) -> Optional[str]:
    """Extracts a PMID (1-8 digits) from a string. Strict match to avoid
    confusing it with ISBN/other numbers: the field arrives already labeled as PMID."""
    if not raw:
        return None
    m = re.match(r'^\s*(?:pmid:?\s*)?(\d{1,8})\s*$', str(raw), re.IGNORECASE)
    return m.group(1) if m else None


def _pubmed_author_to_canonical(name: str) -> str:
    """`"Murphy SA"` (PubMed format: surname + initials) → `"Murphy, SA"` so
    the parser handles the surname correctly."""
    name = (name or '').strip()
    if not name or ',' in name:
        return name
    toks = name.split()
    if len(toks) >= 2 and re.fullmatch(r'[A-Za-z]{1,4}', toks[-1]):
        return f"{' '.join(toks[:-1])}, {toks[-1]}"
    return name


def _pubmed_to_recursos(doc: dict) -> dict:
    """Map a PubMed summary to Resources through the L3 normalizer and central mapper."""
    from backend.services.lookup_normalizers import pubmed_to_zotero_item
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(pubmed_to_zotero_item(doc))


@router.post("/lookup-metadata", dependencies=[Depends(require_role("editor"))])
async def lookup_metadata(payload: dict = Body(...)):
    """Resolves external metadata for a given identifier.

    Body (accepts all and picks the best; priority DOI > arXiv > PMID > ISBN > URL):
      { doi?: str, isbn?: str, arxiv?: str, pmid?: str, url?: str }

    Response:
      {
        "source": "crossref" | "arxiv" | "pubmed" | "openlibrary" | "url" | null,
        "identifier": str | null,
        "suggested": { "Title": ..., "Authors": ..., "Any": ..., "Citation Key": ... },
        "error": null | str
      }

    The `suggested` includes a `Citation Key` generated automatically (unique in
    the vault) so the reference is citable from the very first moment. It never
    modifies the Vault: it only suggests; the frontend accepts fields individually.
    
    """
    doi = _normalize_doi(payload.get('doi') or '') or _normalize_doi(payload.get('url') or '')
    arxiv_id = _normalize_arxiv(payload.get('arxiv') or '') or _normalize_arxiv(payload.get('url') or '')
    pmid = _normalize_pmid(payload.get('pmid') or '')
    isbn = _normalize_isbn(payload.get('isbn') or '')
    url = (payload.get('url') or '').strip()

    if doi:
        body = await asyncio.to_thread(_http_get, f'https://api.crossref.org/works/{doi}')
        if body:
            try:
                data = json.loads(body)
                work = data.get('message') or {}
                if work:
                    return {
                        'source': 'crossref',
                        'identifier': doi,
                        'suggested': _normalize_suggested_item_type(_inject_citation_key(_crossref_to_recursos(work))),
                        'error': None,
                    }
            except json.JSONDecodeError:
                pass
        return {'source': 'crossref', 'identifier': doi, 'suggested': {}, 'error': 'CrossRef returned no valid data'}

    if arxiv_id:
        body = await asyncio.to_thread(_http_get, f'http://export.arxiv.org/api/query?id_list={arxiv_id}')
        if body:
            sug = _normalize_suggested_item_type(_inject_citation_key(_arxiv_to_recursos(body)))
            if sug:
                return {
                    'source': 'arxiv',
                    'identifier': arxiv_id,
                    'suggested': sug,
                    'error': None,
                }
        return {'source': 'arxiv', 'identifier': arxiv_id, 'suggested': {}, 'error': 'arXiv returned no data'}

    if pmid:
        body = await asyncio.to_thread(
            _http_get,
            f'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id={pmid}&retmode=json&version=2.0',
        )
        if body:
            try:
                data = json.loads(body)
                doc = (data.get('result') or {}).get(pmid) or {}
                if doc and not doc.get('error'):
                    return {
                        'source': 'pubmed',
                        'identifier': pmid,
                        'suggested': _normalize_suggested_item_type(_inject_citation_key(_pubmed_to_recursos(doc))),
                        'error': None,
                    }
            except json.JSONDecodeError:
                pass
        return {'source': 'pubmed', 'identifier': pmid, 'suggested': {}, 'error': 'PubMed returned no data'}

    if isbn:
        body = await asyncio.to_thread(
            _http_get,
            f'https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data',
        )
        if body:
            try:
                data = json.loads(body)
                book = data.get(f'ISBN:{isbn}') or {}
                if book:
                    return {
                        'source': 'openlibrary',
                        'identifier': isbn,
                        'suggested': _normalize_suggested_item_type(_inject_citation_key(_openlibrary_to_recursos(book))),
                        'error': None,
                    }
            except json.JSONDecodeError:
                pass
        return {'source': 'openlibrary', 'identifier': isbn, 'suggested': {}, 'error': "Open Library has no data for this ISBN"}

    if url and url.startswith(('http://', 'https://')):
        # User-supplied URL: fetch through the SSRF-hardened helper.
        body = await asyncio.to_thread(_http_get_public, url)
        if body:
            return {
                'source': 'url',
                'identifier': url,
                'suggested': _normalize_suggested_item_type(_inject_citation_key(_html_meta_to_recursos(body, url))),
                'error': None,
            }
        return {'source': 'url', 'identifier': url, 'suggested': {}, 'error': "Could not download the page"}

    return {'source': None, 'identifier': None, 'suggested': {}, 'error': 'No valid identifier (DOI/arXiv/PMID/ISBN/URL)'}


generate_citation_key_endpoint = citation_keys_api.register_route(
    router,
    lambda: globals()["_existing_citation_keys"],
)


# ---------------------------------------------------------------------------
# PDF recognition (P4) — extracts DOI/arXiv from the text and reuses the lookup.
# ---------------------------------------------------------------------------

def _extract_text_from_pdf(data: bytes, max_pages: int = 5) -> str:
    """Text of the first `max_pages` pages of a PDF. Empty if pypdf is not
    available or the PDF is scanned (no text layer)."""
    try:
        from pypdf import PdfReader
    except ImportError:
        log.warning("pypdf not installed: PDF recognition disabled")
        return ""
    import io
    try:
        reader = PdfReader(io.BytesIO(data))
        parts = []
        for page in reader.pages[:max_pages]:
            try:
                parts.append(page.extract_text() or "")
            except Exception:
                continue
        return "\n".join(parts)
    except Exception as e:
        log.warning(f"PDF il·legible: {e}")
        return ""


def _identifiers_from_text(text: str) -> dict:
    """First DOI (and arXiv if there's an explicit prefix) found in a PDF's text."""
    found: dict = {}
    doi = _normalize_doi(text or "")
    if doi:
        found['doi'] = doi
    # arXiv only if the explicit prefix appears: the YYMM.NNNNN pattern would match
    # any similar number in the document body (false positives).
    if re.search(r'arxiv\s*[:.]', text or "", re.IGNORECASE):
        arx = _normalize_arxiv(text)
        if arx:
            found['arxiv'] = arx
    return found


def _pdf_embedded_metadata(data: bytes) -> dict:
    """Best-effort bibliographic metadata from a PDF's document-info dictionary.

    Reads `/Title`, `/Author` and the year from `/CreationDate`. These fields
    exist even in scanned PDFs with no text layer, so they let us register a
    source that carries no DOI/ISBN/arXiv. Returns `{}` when pypdf is missing or
    the PDF exposes nothing usable.
    """
    try:
        from pypdf import PdfReader
    except ImportError:
        return {}
    import io
    try:
        info = PdfReader(io.BytesIO(data)).metadata
    except Exception as e:
        log.warning(f"PDF metadata unreadable: {e}")
        return {}
    if not info:
        return {}
    out: dict = {}
    try:
        title = (info.title or "").strip()
        if title:
            out['title'] = title
        author = (info.author or "").strip()
        if author:
            out['author'] = author
        m = re.search(r'\d{4}', str(info.creation_date_raw or ""))
        if m:
            out['year'] = m.group(0)
    except Exception as e:  # malformed document-info values
        log.warning(f"PDF metadata fields unreadable: {e}")
    return out


def _title_from_filename(filename: str) -> str:
    """Human-readable title guessed from a PDF filename (last-resort source).

    Strips any path and the `.pdf` extension and turns underscores into spaces.
    Hyphens are kept (they are often part of real titles). Returns '' for an
    empty or extension-only name.
    """
    if not filename:
        return ""
    stem = filename.rsplit('/', 1)[-1].rsplit('\\', 1)[-1]
    stem = re.sub(r'\.pdf$', '', stem, flags=re.IGNORECASE)
    stem = re.sub(r'_+', ' ', stem)
    return re.sub(r'\s+', ' ', stem).strip()


def _pdf_fallback_to_recursos(data: bytes, filename: str, ids: Optional[dict] = None) -> dict:
    """Minimal Recursos record for a PDF whose external lookup yielded nothing.

    Builds a Zotero `document` item from the PDF's embedded metadata (falling
    back to the filename for the title) and runs it through the same mapper +
    Citation Key pipeline as the identifier lookups, so the reference is
    registrable and citable even without (a resolvable) DOI/ISBN/arXiv/PMID.
    Any identifier that WAS detected in the text (`ids`) is still carried onto
    the record so it is not lost when the online source is unreachable. Returns
    `{}` when not even a title can be derived.
    """
    meta = _pdf_embedded_metadata(data)
    title = meta.get('title') or _title_from_filename(filename)
    if not title:
        return {}
    item: dict = {'itemType': 'document', 'title': title}
    if (ids or {}).get('doi'):
        item['DOI'] = ids['doi']
    if (ids or {}).get('arxiv'):
        # No native Zotero field for the arXiv id; the canonical abstract URL
        # keeps the pointer to the source without inventing a column.
        item['url'] = f"https://arxiv.org/abs/{ids['arxiv']}"
    author = meta.get('author')
    if author:
        # Normalize common multi-author separators to ';' so the shared parser
        # (which only splits on ';') can pick out individual authors.
        normalized = re.sub(r'\s+and\s+|\s*&\s*|[\r\n]+', '; ', author, flags=re.IGNORECASE)
        creators = []
        for a in _parse_authors_to_csl(normalized):
            c = {'creatorType': 'author'}
            if a.get('family'):
                c['lastName'] = a['family']
            if a.get('given'):
                c['firstName'] = a['given']
            if c.get('lastName') or c.get('firstName'):
                creators.append(c)
        if creators:
            item['creators'] = creators
    if meta.get('year'):
        item['date'] = meta['year']
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return _inject_citation_key(zotero_item_to_recursos(item))


@router.post("/recognize-pdf", dependencies=[Depends(require_role("editor"))])
async def recognize_pdf(file: UploadFile = File(...)):
    """Detects a PDF's reference, with a metadata fallback for id-less sources.

    Strategy:
      1. Extract the first pages' text and look for a DOI/arXiv. If found, run
         the external lookup (CrossRef/arXiv) — the richest result.
      2. Otherwise (or if that lookup returns nothing) build a minimal record
         from the PDF's own document-info (`/Title`, `/Author`, `/CreationDate`)
         or the filename, so a scanned book / paper with no DOI/ISBN/arXiv can
         still be created and cited.

    Response: { identifiers, source, suggested, error }. The `suggested` already
    carries a `Citation Key`. Never writes anything to the Vault.
    """
    data = await file.read()
    text = await asyncio.to_thread(_extract_text_from_pdf, data)
    ids = _identifiers_from_text(text) if text.strip() else {}
    if ids:
        result = await lookup_metadata(ids)
        if result.get("suggested"):
            return {
                "identifiers": ids,
                "source": result.get("source"),
                "suggested": result.get("suggested", {}),
                "error": result.get("error"),
            }
    # No identifier found (or the lookup came back empty): register from the
    # PDF's own metadata / filename instead of failing. Any detected id is kept.
    fallback = await asyncio.to_thread(_pdf_fallback_to_recursos, data, file.filename or "", ids)
    if fallback:
        return {"identifiers": ids, "source": "pdf",
                "suggested": _normalize_suggested_item_type(fallback), "error": None}
    return {"identifiers": ids, "source": None, "suggested": {},
            "error": "Could not extract any metadata from the PDF"}


# ---------------------------------------------------------------------------
# Web capture (P2) — Zotero translation-server.
# ---------------------------------------------------------------------------

def _zotero_creators_to_authors(creators) -> str:
    """Map Zotero creators to a `"Surname, Name; …"` Resources string."""
    parts = []
    for c in creators or []:
        if not isinstance(c, dict) or (c.get('creatorType') or 'author') != 'author':
            continue
        last = (c.get('lastName') or '').strip()
        first = (c.get('firstName') or '').strip()
        name = (c.get('name') or '').strip()  # creators from a single field
        if last and first:
            parts.append(f"{last}, {first}")
        elif last:
            parts.append(last)
        elif name:
            parts.append(name)
    return '; '.join(parts)


def _zotero_item_to_recursos(item: dict) -> dict:
    """Zotero item (translation-server output) → Recursos fields.

    Thin wrapper around the central declarative mapper
    (`zotero_to_recursos_mapper.zotero_item_to_recursos`, L3.1). Kept
    as an alias to minimize the diff for callers; in a later cleanup
    the import can be substituted directly.
    
    """
    from backend.services.zotero_to_recursos_mapper import zotero_item_to_recursos
    return zotero_item_to_recursos(item)


@router.post("/translate-url", dependencies=[Depends(require_role("editor"))])
async def translate_url(payload: dict = Body(...)):
    """Captures a reference from a URL via Zotero translation-server.

    Body: { url }. Response with the same shape as `/lookup-metadata`:
    { source:'web', identifier, suggested (with Citation Key), count, error }.
    
    """
    url = (payload.get('url') or '').strip()
    if not url.startswith(('http://', 'https://')):
        return {'source': 'web', 'identifier': url, 'suggested': {}, 'error': 'URL no vàlida'}
    ts = os.environ.get('TRANSLATION_SERVER_URL', 'http://translation-server:1969').rstrip('/')

    def _post_web(body: str, content_type: str):
        import urllib.request
        import urllib.error
        req = urllib.request.Request(
            f'{ts}/web', data=body.encode('utf-8'),
            headers={'Content-Type': content_type}, method='POST',
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read().decode('utf-8', errors='replace')
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode('utf-8', errors='replace')
        except (urllib.error.URLError, TimeoutError) as e:
            log.warning(f'translation-server inaccessible: {e}')
            return None, None

    status, body = await asyncio.to_thread(_post_web, url, 'text/plain')
    if status is None:
        return {'source': 'web', 'identifier': url, 'suggested': {},
                'error': "El servei de captura web (translation-server) no està disponible"}

    # 300 Multiple Choices: the page contains multiple references. Select them
    # all of them (up to 50) and resend to resolve them.
    if status == 300 and body:
        try:
            data = json.loads(body)
            sel = dict(list((data.get('items') or {}).items())[:50])
            if sel:
                back = json.dumps({'items': sel, 'session': data.get('session')})
                status, body = await asyncio.to_thread(_post_web, back, 'application/json')
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    items = []
    if status == 200 and body:
        try:
            arr = json.loads(body)
            if isinstance(arr, list):
                items = [_zotero_item_to_recursos(it) for it in arr if isinstance(it, dict)]
        except json.JSONDecodeError:
            pass
    items = [it for it in items if it]
    if not items:
        return {'source': 'web', 'identifier': url, 'suggested': {},
                'error': "Could not extract any reference from the URL"}

    suggested = _normalize_suggested_item_type(_inject_citation_key(items[0]))
    if not suggested.get('URL'):
        suggested['URL'] = url
    return {'source': 'web', 'identifier': url, 'suggested': suggested,
            'count': len(items), 'error': None}


# ---------------------------------------------------------------------------
# Import / Export BibTeX i RIS (P1).
# ---------------------------------------------------------------------------

def _build_dedup_indexes(v_str: str) -> dict:
    return citation_io_api.build_dedup_indexes(v_str, _REFERENCES_IO_DEPENDENCIES)


import_references = citation_io_api.register_import_route(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
    dependencies=_REFERENCES_IO_DEPENDENCIES,
)


def _collect_table_reference_metas(table_id: str, wanted: Optional[set]) -> List[dict]:
    return citation_io_api.collect_table_reference_metas(
        table_id,
        wanted,
        _REFERENCES_IO_DEPENDENCIES,
    )


@router.post("/promote-zotero-extra", dependencies=[Depends(require_role("editor"))])
async def promote_zotero_extra(payload: dict = Body(...)):
    """Promotes a `Zotero Extras` field to its own registry column.

    Body:
        {
          "table_id": "<uuid>",
          "zotero_field": "patentNumber",
          "column_name": "Patent No.",       # optional; default = zotero_field
          "column_type": "text",              # optional; default = "text"
          "page_ids": ["uuid1", ...],         # optional; without this, all
                                              #   pages in the table with the field
          "expected_etags": {"uuid1": "abc", ...}  # optional (collaboration Path A)
        }

    For each page:
      1. If `expected_etags[pid]` is present, validate against the current etag.
         Mismatch → marked as `conflict`, NOT written.
      2. Moves `Extras[zotero_field]` to `metadata[column_name]`.
      3. Deletes `Extras[zotero_field]`. If Extras ends up empty, deletes
         the whole key.
      4. Rewrites via `save_page_md`.
    
    """
    table_id = (payload.get('table_id') or '').strip()
    zotero_field = (payload.get('zotero_field') or '').strip()
    column_name = (payload.get('column_name') or zotero_field).strip()
    column_type = (payload.get('column_type') or 'text').strip()
    page_ids_arg = payload.get('page_ids')
    expected_etags = payload.get('expected_etags') or {}

    if not table_id or not zotero_field:
        raise HTTPException(status_code=400, detail="table_id i zotero_field són obligatoris")

    # 1. Create or reuse the property (entire registration cycle under lock).
    #    Page migration (async, further below) goes OUTSIDE: it doesn't touch the registry.
    with registry_mutation():
        registry = load_registry()
        table = next((t for t in registry.get('tables', []) if t.get('id') == table_id), None)
        if not table:
            raise HTTPException(status_code=404, detail=f"Table {table_id} no trobada")

        props = table.setdefault('properties', [])
        existing = next(
            (p for p in props if (p.get('name') or '').strip() == column_name),
            None,
        )
        column_created = False
        if existing is None:
            new_prop = {
                'id': str(uuid.uuid4()),
                'name': column_name,
                'type': column_type,
            }
            props.append(new_prop)
            save_registry(registry)
            existing = new_prop
            column_created = True

    # 2. Determine the set of pages to migrate.
    if isinstance(page_ids_arg, list) and page_ids_arg:
        candidate_ids = [str(p) for p in page_ids_arg]
    else:
        candidate_ids = []
        pages = _get_pages_snapshot()
        for p in pages:
            if getattr(p, 'resolved_table_id', None) != table_id:
                continue
            try:
                fp = find_page_path(getattr(p, 'id', '') or '')
                if not fp:
                    continue
                meta, _ = parse_frontmatter(fp.read_text(encoding='utf-8'), fp)
                extras = meta.get('Zotero Extras')
                if isinstance(extras, dict) and zotero_field in extras:
                    candidate_ids.append(getattr(p, 'id'))
            except OSError:
                continue

    migrated, skipped, conflicts, errors = [], [], [], []

    def _migrate(pid: str):
        fp = find_page_path(pid)
        if not fp or not fp.exists():
            return ('error', "not_found")
        # PR ETag (Path A): optional, not breaking — an old client that doesn't
        # passes expected_etags keeps working exactly as before.
        exp = expected_etags.get(pid)
        if exp:
            current = file_etag(fp)
            if current and current != exp:
                return ('conflict', {"expected_etag": exp, "current_etag": current})
        try:
            raw = fp.read_text(encoding='utf-8')
            md, body = parse_frontmatter(raw, fp)
            extras = md.get('Zotero Extras')
            if not isinstance(extras, dict) or zotero_field not in extras:
                return ('skip', None)
            value = extras.pop(zotero_field)
            if not extras:
                md.pop('Zotero Extras', None)
            else:
                md['Zotero Extras'] = extras
            md[column_name] = value
            save_page_md(fp, md, body or '')
            # Index refresh (like the bulk/PATCH): without this, the metadata
            # migrated stayed stale in the grid until the rescan.
            _refresh_page_index_entry(fp, md, body or '')
            return ('ok', file_etag(fp))
        except (OSError, ValueError) as e:
            return ('error', str(e))

    for pid in candidate_ids:
        result, info = await asyncio.to_thread(_migrate, pid)
        if result == 'ok':
            migrated.append({"page_id": pid, "etag": info})
        elif result == 'skip':
            skipped.append(pid)
        elif result == 'conflict':
            conflicts.append({"page_id": pid, **info})
        else:
            errors.append({"page_id": pid, "error": info})

    if migrated:
        _invalidate_cite_key_index()
        _pages_cache_invalidate_all()

    return {
        "column_created": column_created,
        "column_id": existing.get('id'),
        "column_name": column_name,
        "migrated": len(migrated),
        "migrated_ids": [m["page_id"] for m in migrated],
        "migrated_with_etags": migrated,
        "skipped": skipped,
        "conflicts": conflicts,
        "errors": errors,
    }


@router.post("/bulk-update-metadata", dependencies=[Depends(require_role("editor"))])
async def bulk_update_metadata(payload: dict = Body(...)):
    """Applies the same metadata patch to a collection of pages.

    Body:
        {
          "page_ids": ["uuid1", "uuid2", ...],
          "updates": {"Item Type": "preprint", "Idioma": "en"},
          "remove": ["ObsoleteField"],
          "expected_etags": {"uuid1": "abc", ...}   # optional (collaboration Path A)
        }

    For each page:
      1. If `expected_etags[pid]` is present, validate against the current etag.
         Mismatch → marked as `conflict`, NOT written.
      2. Reads .md, parses frontmatter.
      3. Applies `updates` (None/'' → deleted) and `remove`.
      4. If the patch is identical to the current state → `skip`.
      5. `save_page_md` and returns the new etag to the client.

    Response:
        {
          "updated": N, "updated_ids": [...],
          "updated_with_etags": [{"page_id": "...", "etag": "..."}],
          "skipped": [...],
          "conflicts": [{"page_id": "...", "expected_etag": "...", "current_etag": "..."}],
          "errors": [{"page_id": "...", "error": "..."}]
        }

    A single error does NOT abort the rest. Conflicts are recoverable:
    the client can GET the new version, repeat the logic, and resend
    with the new etag.
    
    """
    page_ids = payload.get('page_ids') or []
    updates = payload.get('updates') or {}
    remove_keys = payload.get('remove') or []
    expected_etags = payload.get('expected_etags') or {}
    if not isinstance(page_ids, list) or not page_ids:
        raise HTTPException(status_code=400, detail="page_ids ha de ser una llista no buida")
    if not isinstance(updates, dict) or (not updates and not remove_keys):
        raise HTTPException(status_code=400, detail="updates o remove són obligatoris")

    updated, errors, skipped, conflicts = [], [], [], []

    def _apply(pid: str):
        fp = find_page_path(pid)
        if not fp or not fp.exists():
            return ('error', "not_found")
        exp = expected_etags.get(pid)
        if exp:
            current = file_etag(fp)
            if current and current != exp:
                return ('conflict', {"expected_etag": exp, "current_etag": current})
        try:
            raw = fp.read_text(encoding='utf-8')
            md, body = parse_frontmatter(raw, fp)
            original_md = dict(md)
            for k, v in (updates or {}).items():
                if v is None or v == '':
                    md.pop(k, None)
                else:
                    md[k] = v
            for k in remove_keys:
                md.pop(k, None)
            if md == original_md:
                return ('skip', None)
            save_page_md(fp, md, body or '')
            # Refreshes the in-memory index with the NEW metadata (as the PATCH
            # for a single page does). Without this, `GET /pages` and `/by-table`
            # served the OLD metadata from `_page_index_entries` until the
            # next full rescan (600s cooldown) → the bulk edit "didn't
            # stick" in the grid (reproduced: updated=2 but by-table
            # kept showing the previous value).
            try:
                v_path = get_active_vault_path()
                if v_path:
                    v_str = str(v_path)
                    new_entry = _build_cache_entry_from_memory(fp, fp.stat(), md, body or '')
                    with _page_index_lock:
                        _page_index_entries.setdefault(v_str, {})[str(fp)] = new_entry
                        _page_id_to_path.setdefault(v_str, {})[md.get("id") or pid] = str(fp)
                        _bump_page_index_version(v_str)
                with _body_cache_lock:
                    _body_cache.pop(str(fp), None)
            except Exception as exc:
                log.debug(f"bulk-update: index refresh failed for {pid}: {exc}")
            return ('ok', file_etag(fp))
        except (OSError, ValueError) as e:
            return ('error', str(e))

    for pid in page_ids:
        result, info = await asyncio.to_thread(_apply, pid)
        if result == 'ok':
            updated.append({"page_id": pid, "etag": info})
        elif result == 'skip':
            skipped.append(pid)
        elif result == 'conflict':
            conflicts.append({"page_id": pid, **info})
        else:
            errors.append({"page_id": pid, "error": info})

    if updated:
        _invalidate_cite_key_index()
        # The response micro-cache (`_pages_resp_cache`, TTL ~1.5s) is NOT
        # refreshes when updating `_page_index_entries`; without invalidating it,
        # a `/pages`/`/by-table` within the TTL would return the pre-bulk snapshot.
        _pages_cache_invalidate_all()

    return {
        "updated": len(updated),
        "updated_ids": [u["page_id"] for u in updated],
        "updated_with_etags": updated,
        "skipped": skipped,
        "conflicts": conflicts,
        "errors": errors,
    }


@router.post("/bulk-apply-template", dependencies=[Depends(require_role("editor"))])
async def bulk_apply_template(payload: dict = Body(...)):
    """Apply a table template body and declared properties to selected rows."""
    page_ids = payload.get("page_ids") or []
    template_id = str(payload.get("template_id") or "").strip()
    expected_etags = payload.get("expected_etags") or {}
    if not isinstance(page_ids, list) or not page_ids:
        raise HTTPException(status_code=400, detail="page_ids must be a non-empty list")
    if not template_id:
        raise HTTPException(status_code=400, detail="template_id is required")

    def _read_template():
        template_path = find_page_path(template_id)
        if not template_path or not template_path.exists():
            return None, None, None
        raw = template_path.read_text(encoding="utf-8")
        metadata, body = parse_frontmatter(raw, template_path)
        return template_path, metadata, body or ""

    try:
        _template_path, template_metadata, template_body = await asyncio.to_thread(_read_template)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Could not read template: {exc}") from exc
    if not template_metadata:
        raise HTTPException(status_code=404, detail="Template not found")
    if template_metadata.get("is_template") is not True:
        raise HTTPException(status_code=400, detail="Selected page is not a template")

    table_id = get_table_id(template_metadata)
    table = _table_by_id(table_id)
    if not table:
        raise HTTPException(status_code=400, detail="Template does not belong to a table")

    # Each property can be stored by its name, id, or legacy alias. Copy only
    # schema-declared values: frontmatter such as title, id, table context and
    # sidecar flags must always remain specific to the target record.
    property_keys = []
    for prop in table.get("properties") or []:
        keys = [prop.get("name"), prop.get("id"), *(prop.get("aliases") or [])]
        keys = [str(key) for key in keys if key]
        template_key = next((key for key in keys if key in template_metadata), None)
        if template_key:
            property_keys.append((keys, template_key))

    updated, errors, skipped, conflicts = [], [], [], []

    for page_id in dict.fromkeys(str(pid) for pid in page_ids if pid):
        async with await _get_page_write_lock(page_id):
            def _apply():
                page_path = find_page_path(page_id)
                if not page_path or not page_path.exists():
                    return "error", "not_found"
                expected_etag = expected_etags.get(page_id)
                if expected_etag:
                    current_etag = file_etag(page_path)
                    if current_etag and current_etag != expected_etag:
                        return "conflict", {
                            "expected_etag": expected_etag,
                            "current_etag": current_etag,
                        }
                raw = page_path.read_text(encoding="utf-8")
                metadata, current_body = parse_frontmatter(raw, page_path)
                if metadata.get("is_template") is True:
                    return "error", "target_is_template"
                if get_table_id(metadata) != table_id:
                    return "error", "different_table"
                next_metadata = dict(metadata)
                for candidate_keys, template_key in property_keys:
                    target_key = next((key for key in candidate_keys if key in metadata), template_key)
                    next_metadata[target_key] = template_metadata[template_key]
                if next_metadata == metadata and current_body == template_body:
                    return "skip", None
                save_page_md(page_path, next_metadata, template_body)
                _refresh_page_index_entry(page_path, next_metadata, template_body)
                with _body_cache_lock:
                    _body_cache.pop(str(page_path), None)
                return "ok", file_etag(page_path)

            try:
                result, info = await asyncio.to_thread(_apply)
            except (OSError, ValueError) as exc:
                result, info = "error", str(exc)
        if result == "ok":
            updated.append({"page_id": page_id, "etag": info})
        elif result == "skip":
            skipped.append(page_id)
        elif result == "conflict":
            conflicts.append({"page_id": page_id, **info})
        else:
            errors.append({"page_id": page_id, "error": info})

    if updated:
        _invalidate_cite_key_index()
        _pages_cache_invalidate_all()
    return {
        "updated": len(updated),
        "updated_ids": [item["page_id"] for item in updated],
        "updated_with_etags": updated,
        "skipped": skipped,
        "conflicts": conflicts,
        "errors": errors,
    }


(
    list_csl_styles,
    upload_csl_style,
    export_references,
) = citation_io_api.register_catalog_export_routes(
    router,
    upload_dependencies=[Depends(require_role("editor"))],
    export_dependencies=[Depends(require_role("editor"))],
    dependencies=_REFERENCES_IO_DEPENDENCIES,
)

search_citations, resolve_by_citation_key = citation_search.register_routes(
    router,
    _CITATION_SEARCH_DEPENDENCIES,
)


def _fold_accents(s) -> str:
    return citation_search.fold_accents(s)


def _format_one_author(a) -> str:
    return citation_search.format_one_author(a)


def _cite_author_from_metadata(md: dict):
    return citation_search.cite_author_from_metadata(md)


def _cite_year_from_metadata(md: dict):
    return citation_search.cite_year_from_metadata(md)


def _cite_search_blob(title, ck, author, year, md) -> str:
    return citation_search.cite_search_blob(title, ck, author, year, md)


def _enrich_cite_entry(entry: dict) -> dict:
    return citation_search.enrich_cite_entry(entry)


def _ensure_cite_key_index(v_str: str) -> dict:
    return citation_search.ensure_citation_index(
        v_str,
        citation_index_state,
        _CITATION_SEARCH_DEPENDENCIES,
    )


def _invalidate_cite_key_index(v_str: str = None) -> None:
    citation_search.invalidate_citation_index(citation_index_state, v_str)


def normalize_aliases(val) -> list[str]:
    """Normalize the `aliases` field of the frontmatter into a list of strings.

    Accepts a YAML list (`aliases: [a, b]`), a scalar, or a comma-separated
    string (`aliases: a, b`). Discards non-text values.
    
    """
    if val is None:
        return []
    if isinstance(val, str):
        parts = [p.strip() for p in val.split(",")]
        return [p for p in parts if p]
    if isinstance(val, (list, tuple)):
        out = []
        for item in val:
            s = str(item).strip()
            if s:
                out.append(s)
        return out
    s = str(val).strip()
    return [s] if s else []


@router.get("/resolve-by-title")
async def resolve_by_title(title: str):
    """Resolve a literal title (or a note alias) to a UUID via _page_index_entries.

    Use case: the frontend has received a wikilink `[[Foo]]` but its
    `idToTitle` is empty or stale (right after a parent_id mutation,
    a cache cleanup, or direct URL navigation). Instead of
    doing GET /pages/<title> and leaving the match to the backend (which now has
    title fallback thanks to `find_page_path`), the frontend can
    query here and get the UUID directly — fast and without noise.

    Besides the title, it also matches note aliases declared in the frontmatter
    (`aliases:`), so that `[[Alias]]` resolves to the page (Obsidian-style).
    
    """
    title_lower = str(title or "").strip().lower()
    if not title_lower:
        raise HTTPException(status_code=400, detail="title is required")
    from backend.services.context_vars import get_active_vault_path
    v_path = get_active_vault_path()
    if not v_path:
        raise HTTPException(status_code=503, detail="No active vault")
    v_str = str(v_path)
    alias_match = None
    with _page_index_lock:
        entries = _page_index_entries.get(v_str, {})
        for entry in list(entries.values()):
            entry_title = str(entry.get("title") or "").strip().lower()
            if entry_title and entry_title == title_lower:
                return {
                    "id": entry.get("id"),
                    "title": entry.get("title"),
                    "folder": entry.get("folder"),
                    "matched_alias": None,
                }
            # We remember the first alias match, but the title takes priority.
            if alias_match is None:
                meta = entry.get("metadata") or {}
                for alias in normalize_aliases(meta.get("aliases")):
                    if alias.strip().lower() == title_lower:
                        alias_match = entry
                        break
    if alias_match is not None:
        return {
            "id": alias_match.get("id"),
            "title": alias_match.get("title"),
            "folder": alias_match.get("folder"),
            "matched_alias": title,
        }
    return {"id": None, "title": None, "folder": None, "matched_alias": None}


def _extract_images_from_body(body: str, max_images: int = 6) -> list[str]:
    """Extracts the URLs of images referenced in the markdown (syntax ![alt](url))."""
    if not body:
        return []
    seen = set()
    out: list[str] = []
    for m in re.finditer(r"!\[[^\]]*\]\(([^)]+)\)", body):
        raw = m.group(1).strip()
        # CommonMark accepts `<url>` to wrap URLs containing spaces.
        if raw.startswith("<") and raw.endswith(">"):
            raw = raw[1:-1]
        # Some parser may leave `"alt text"` at the end: `url "alt"`.
        if " " in raw:
            raw = raw.split(" ", 1)[0]
        if not raw or raw in seen:
            continue
        seen.add(raw)
        out.append(raw)
        if len(out) >= max_images:
            break
    return out


async def _compute_preview(file_path: Path, page_id: str) -> Tuple[Dict[str, Any], Dict[str, Any], float]:
    """Read the file and build the two responses (short + full) for the
    preview, along with the mtime for cache invalidation.

    This function is reusable for:
      - `get_page_preview` (a single id, possible cache hit).
      - `bulk_warm_previews` (proactive warmup of a list of ids).

    Materializes the file if it is online-only BEFORE attempting to read it,
    thus avoiding the 4.55s retry queue; it only falls back to retry if the File
    Provider takes longer than expected.
    
    """
    # Mtime (silently falls to 0 if st() fails — the cache already handles the case).
    try:
        mtime = file_path.stat().st_mtime
    except OSError:
        mtime = 0.0

    # Proactive warmup: if the file is online-only, OneDrive's File Provider
    # must download it before `read_text` fails with errno 35. Same
    # helper that uses get_page.
    await _materialize_if_online_only(file_path, page_id)

    def _read_and_parse():
        if _is_dashboard_file_path(file_path):
            md, body = _read_dashboard_file(file_path)
            return md, body, body
        # Same retries as get_page (~4.55s total) as a safety net
        # in case the proactive warmup above wasn't enough.
        last_error = None
        delays = [0.05, 0.1, 0.2, 0.4, 0.8, 1.0, 1.0, 1.0]
        for attempt in range(len(delays) + 1):
            try:
                raw_content = file_path.read_text(encoding="utf-8")
                md, body = parse_frontmatter(raw_content, file_path)
                # `body_full`: same as `body` but with the view snapshots
                # rendered (visible table/list) and the flattened columns —
                # for the preview's `body_md` (pop-up and feed). The `excerpt` keeps
                # coming from `body` (without snapshots) for the wikilink hover.
                _, body_full = parse_frontmatter(raw_content, file_path, render_snapshots=True)
                return md, body, body_full
            except OSError as e:
                last_error = e
                if e.errno == 35 and attempt < len(delays):
                    time.sleep(delays[attempt])
                    continue
                raise
        if last_error:
            raise last_error
        return {}, "", ""

    metadata, body, body_full = await asyncio.to_thread(_read_and_parse)
    excerpt = _build_preview_excerpt(body)
    short = {
        "id": str(metadata.get("id") or page_id),
        "title": metadata.get("title", "") or "",
        "excerpt": excerpt,
        "icon": metadata.get("icon"),
        "cover": metadata.get("cover"),
    }
    full_resp = {
        **short,
        "body_md": body_full or "",
        "images": _extract_images_from_body(body_full or ""),
    }
    return short, full_resp, mtime


async def _fetch_preview_with_cache(
    file_path: Path, page_id: str
) -> Tuple[Dict[str, Any], Dict[str, Any], float]:
    """Wrapper with cache + in-flight dedup over `_compute_preview`.

    Single robust logic for `get_page_preview` and `bulk_warm_previews`:

      1. Read the file's mtime.
      2. Cache hit (mtime matches) → return immediately.
      3. Cache miss but there's a future already running for this id → share
         it (await; no one repeats the work).
      4. Cache miss and no future → create a new future, compute,
         store in the cache, signal the future. Always clears the
         in-flight map at the end, whether it succeeds or fails.
    
    """
    try:
        mtime = await asyncio.to_thread(lambda: file_path.stat().st_mtime)
    except OSError:
        mtime = 0.0

    cached_short = _preview_cache_get(page_id, mtime, full=False)
    cached_full = _preview_cache_get(page_id, mtime, full=True)
    if cached_short is not None and cached_full is not None:
        return cached_short, cached_full, mtime

    loop = asyncio.get_running_loop()
    with _preview_inflight_lock:
        existing = _preview_inflight.get(page_id)
        if existing is None:
            future: "asyncio.Future[Tuple[Dict[str, Any], Dict[str, Any], float]]" = loop.create_future()
            _preview_inflight[page_id] = future
            owner = True
        else:
            future = existing
            owner = False

    if not owner:
        # Another coroutine is already computing this id. We wait for its
        # result to avoid duplicating work or stressing OneDrive.
        return await future

    try:
        short, full_resp, real_mtime = await _compute_preview(file_path, page_id)
        _preview_cache_set(page_id, real_mtime, short, full_resp)
        result = (short, full_resp, real_mtime)
        future.set_result(result)
        return result
    except Exception as e:
        if not future.done():
            future.set_exception(e)
        raise
    finally:
        with _preview_inflight_lock:
            _preview_inflight.pop(page_id, None)


# Per-item timeout inside the bulk warmup. Covers pathological cases where
# `materialize` or `read_text` can hang (OneDrive lock, FUSE hang,
# etc.) without stopping the whole batch. The daemon already has its own timeout
# (ONEDRIVE_WARMUP_TIMEOUT, default 90s); this is its upper bound at
# the backend coordination level.
# Bulk concurrency: high enough to parallelize, low enough that it doesn't
# saturate OneDrive's File Provider. Matches the limit that was previously
# the frontend used to impose.


async def _bulk_warm_one(pid: str) -> str:
    """Warms up a single id and returns the status: 'cached' | 'warmed' | 'failed'.

    Never propagates exceptions: an individual failure must NOT bring down the batch.

    Robust against:
      - **Orphan ids** (stale pages in a database view that have already
        been removed from disk): `find_page_path(allow_full_scan=False)`
        avoids a full vault `rglob` when the id is not in the
        page index.
      - **Cache hit + miss race**: all the cache and in-flight dedup
        logic lives in `_fetch_preview_with_cache` — shared with
        `get_page_preview`.
    
    """
    try:
        # allow_full_scan=False: stale ids → fail fast without a full rglob.
        file_path = await asyncio.to_thread(find_page_path, pid, allow_full_scan=False)
        if not file_path or not file_path.exists():
            return "failed"

        try:
            mtime = await asyncio.to_thread(lambda: file_path.stat().st_mtime)
        except OSError:
            mtime = 0.0

        # Fast cache hit before entering `_fetch_preview_with_cache`
        # (saves the cost of setting up the dedup future when it's not needed).
        if _preview_cache_get(pid, mtime, full=True) is not None:
            return "cached"

        await _fetch_preview_with_cache(file_path, pid)
        return "warmed"
    except Exception as e:
        log.debug(f"bulk warmup falla per {pid}: {e}")
        return "failed"


page_queries_api.register_preview_routes(router)
get_page_preview = page_queries_api.get_page_preview
bulk_warm_previews = page_queries_api.bulk_warm_previews


def _prepare_save_metadata(
    metadata: Dict[str, Any],
    file_path: Optional[Path],
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    metadata = normalize_table_context(normalize_metadata_ids(metadata))
    table = _table_by_id(get_table_id(metadata))
    if not table:
        return metadata, None
    metadata, _ = to_storage_names(metadata, table)
    created_fallback = None
    try:
        if file_path and file_path.exists():
            stat_result = file_path.stat()
            created_fallback = datetime.fromtimestamp(
                getattr(stat_result, "st_birthtime", 0) or stat_result.st_ctime,
                tz=timezone.utc,
            ).isoformat()
    except OSError:
        pass
    stamp_system_dates(
        metadata,
        table,
        is_create=not bool(file_path),
        created_fallback=created_fallback,
    )
    return metadata, table


def _locate_save_file(
    page_id: str,
    title: str,
    metadata: Dict[str, Any],
    file_path: Optional[Path],
) -> Path:
    if file_path is None:
        if metadata.get("is_template") is True:
            target_dir = get_p("PLANTILLES")
        elif is_calendar_entry(metadata):
            target_dir = get_p("CALENDAR")
        elif metadata.get("is_dashboard") is True:
            target_dir = get_p("DASHBOARDS")
        else:
            target_dir = _resolve_table_folder_from_metadata(metadata) or get_p("WIKI")
        target_dir.mkdir(parents=True, exist_ok=True)
        canonical = _canonicalize_id(page_id)
        try:
            for candidate in target_dir.iterdir():
                if not candidate.is_file() or candidate.suffix != ".md":
                    continue
                try:
                    raw_existing = candidate.read_text(encoding="utf-8")
                    existing_metadata, _ = parse_frontmatter(raw_existing, candidate)
                    if (
                        _canonicalize_id(str(existing_metadata.get("id", "")))
                        == canonical
                    ):
                        with _page_index_lock:
                            vault_root = get_active_vault_path()
                            if vault_root:
                                _page_id_to_path.setdefault(str(vault_root), {})[
                                    page_id
                                ] = str(candidate)
                        log.info("Reusing existing file for %s: %s", page_id, candidate)
                        return candidate
                except Exception:
                    continue
        except OSError:
            pass
        return target_dir / f"{_safe_filename(title, target_dir)}.md"

    original_path = file_path
    file_path = ensure_correct_page_location(file_path, metadata)
    file_path = _rename_page_file_to_match_title(file_path, title)
    if file_path != original_path:
        _remove_page_from_index_cache(page_id, original_path)
        _add_page_to_index_cache(file_path)
        with _page_index_lock:
            vault_root = get_active_vault_path()
            if vault_root:
                _page_id_to_path.setdefault(str(vault_root), {})[page_id] = str(
                    file_path
                )
    return file_path


def _read_save_page(file_path: Path) -> Tuple[Dict[str, Any], str]:
    if not file_path.exists():
        return {}, ""
    try:
        return parse_frontmatter(file_path.read_text(encoding="utf-8"), file_path)
    except Exception:
        return {}, ""


def _write_save_page_with_version(
    page_id: str,
    file_path: Path,
    metadata: Dict[str, Any],
    content: str,
) -> None:
    if file_path.exists():
        _create_page_version(page_id, file_path)
    save_page_md(file_path, metadata, content)


_SAVE_PAGE_DEPENDENCIES = page_save_service.SavePageDependencies(
    find_page=lambda page_id, *, allow_full_scan=True: find_page_path(
        page_id,
        allow_full_scan=allow_full_scan,
    ),
    file_etag=file_etag,
    get_page_write_lock=lambda page_id: _get_page_write_lock(page_id),
    prepare_metadata=_prepare_save_metadata,
    locate_file=_locate_save_file,
    read_page=_read_save_page,
    process_updates=lambda page_id, old, new: get_rule_engine().process_updates(
        page_id,
        old,
        new,
    ),
    stamp_author=lambda metadata, user_id, is_create: _stamp_author(
        metadata,
        user_id,
        is_create,
    ),
    persist_assets=lambda metadata: _persist_metadata_assets(metadata),
    ensure_citation_key=lambda metadata, table: _ensure_recursos_citation_key(
        metadata,
        table,
    ),
    dedupe_citation_key=lambda metadata, page_id: _dedupe_citation_key(
        metadata,
        page_id,
    ),
    write_with_version=_write_save_page_with_version,
    refresh_page_index=lambda path, metadata, content: _refresh_page_index_entry(
        path,
        metadata,
        content,
    ),
    invalidate_page_responses=lambda: _pages_cache_invalidate_all(),
    update_link_index=lambda: update_link_index_for_page,
    rewrite_wikilinks=lambda: rewrite_wikilinks_on_title_change,
    get_table_id=lambda metadata: get_table_id(metadata),
    recompute_formulas=lambda: _recompute_cross_record_formulas_for_table,
    sync_calendar=lambda metadata, tasks: sync_to_google_calendar_if_needed(
        metadata,
        tasks,
    ),
    propagate_translation=lambda: _propagate_translation_staleness,
    resolve_page_context=lambda metadata, path: _resolve_page_context_from_path(
        metadata,
        path,
    ),
)


def _find_and_read_patch_page(
    page_id: str,
    expected_etag: Optional[str],
    force: bool,
) -> page_patch_service.PatchReadResult:
    file_path = _find_page_path_for_write(page_id)
    if not file_path:
        return None, None, None, None, None
    current_etag = None
    if expected_etag and not force:
        current_etag = file_etag(file_path)
        if current_etag and current_etag != expected_etag:
            return file_path, None, None, None, current_etag
    if _is_dashboard_file_path(file_path):
        metadata, body = _read_dashboard_file(file_path)
        return file_path, metadata, body, None, current_etag
    raw_content = file_path.read_text(encoding="utf-8")
    metadata, body = parse_frontmatter(raw_content, file_path)
    return file_path, metadata, body, raw_content, current_etag


def _prepare_patch_metadata(
    metadata: Dict[str, Any],
    file_path: Path,
) -> Tuple[Dict[str, Any], Optional[Dict[str, Any]]]:
    metadata = normalize_table_context(normalize_metadata_ids(metadata))
    table = _table_by_id(get_table_id(metadata))
    if table:
        metadata, _ = to_storage_names(metadata, table)
        created_fallback = None
        try:
            stat_result = file_path.stat()
            created_fallback = datetime.fromtimestamp(
                getattr(stat_result, "st_birthtime", 0) or stat_result.st_ctime,
                tz=timezone.utc,
            ).isoformat()
        except OSError:
            pass
        stamp_system_dates(
            metadata,
            table,
            is_create=False,
            created_fallback=created_fallback,
        )
    if metadata.get("is_dashboard") is True:
        metadata.pop("content_format", None)
    return metadata, table


def _relocate_patch_file(
    page_id: str,
    file_path: Path,
    metadata: Dict[str, Any],
    title: Optional[str],
) -> Path:
    original_path = file_path
    file_path = ensure_correct_page_location(file_path, metadata)
    if title is not None:
        file_path = _rename_page_file_to_match_title(file_path, title)
    if file_path != original_path:
        _remove_page_from_index_cache(page_id, original_path)
        _add_page_to_index_cache(file_path)
        with _page_index_lock:
            vault_root = get_active_vault_path()
            if vault_root:
                _page_id_to_path.setdefault(str(vault_root), {})[page_id] = str(
                    file_path
                )
    return file_path


def _update_patch_caches(
    page_id: str,
    file_path: Path,
    metadata: Dict[str, Any],
    content: str,
    original_metadata: Dict[str, Any],
) -> None:
    try:
        vault_path = get_active_vault_path()
        vault_key = str(vault_path) if vault_path else ""
        if vault_path:
            try:
                new_entry = _build_cache_entry_from_memory(
                    file_path,
                    file_path.stat(),
                    metadata,
                    content,
                )
                with _page_index_lock:
                    _page_index_entries.setdefault(vault_key, {})[
                        str(file_path)
                    ] = new_entry
                    new_id = new_entry.get("id")
                    if new_id:
                        _page_id_to_path.setdefault(vault_key, {})[new_id] = str(
                            file_path
                        )
                    _bump_page_index_version(vault_key)
                path_resolver.add_file(
                    vault_path,
                    new_id or page_id,
                    file_path,
                )
            except Exception as exc:
                log.debug("Cache update after PATCH failed for %s: %s", page_id, exc)
        with _body_cache_lock:
            _body_cache.pop(str(file_path), None)
        _pages_cache_invalidate_all()
        if str(original_metadata.get("Citation Key") or "") != str(
            metadata.get("Citation Key") or ""
        ):
            _invalidate_cite_key_index()
        if vault_key:
            with _iter_docs_lock:
                cache_entry = _iter_docs_cache.get(vault_key)
                docs = cache_entry.get("docs") if cache_entry else None
                if docs is not None:
                    path_str = str(file_path)
                    new_doc = (
                        Path(path_str),
                        dict(metadata),
                        content,
                        _is_dashboard_file_path(file_path),
                    )
                    for index, document in enumerate(docs):
                        if str(document[0]) == path_str:
                            docs[index] = new_doc
                            break
                    else:
                        docs.append(new_doc)
    except Exception as exc:
        log.debug("Cache invalidation after PATCH failed: %s", exc)


_PATCH_PAGE_DEPENDENCIES = page_patch_service.PatchPageDependencies(
    find_and_read=_find_and_read_patch_page,
    get_page_write_lock=lambda page_id: _get_page_write_lock(page_id),
    prepare_metadata=_prepare_patch_metadata,
    relocate_file=_relocate_patch_file,
    process_updates=lambda page_id, old, new: get_rule_engine().process_updates(
        page_id,
        old,
        new,
    ),
    stamp_author=lambda metadata, user_id, is_create: _stamp_author(
        metadata,
        user_id,
        is_create,
    ),
    persist_assets=lambda metadata: _persist_metadata_assets(metadata),
    ensure_citation_key=lambda metadata: _ensure_recursos_citation_key(metadata),
    dedupe_citation_key=lambda metadata, page_id: _dedupe_citation_key(
        metadata,
        page_id,
    ),
    save_page=lambda path, metadata, content: save_page_md(path, metadata, content),
    update_caches=_update_patch_caches,
    create_content_version=lambda: _create_page_version_from_content,
    create_file_version=lambda: _create_page_version,
    update_link_index=lambda: update_link_index_for_page,
    rewrite_wikilinks=lambda: rewrite_wikilinks_on_title_change,
    get_table_id=lambda metadata: get_table_id(metadata),
    recompute_formulas=lambda: _recompute_cross_record_formulas_for_table,
    sync_calendar=lambda metadata, tasks: sync_to_google_calendar_if_needed(
        metadata,
        tasks,
    ),
    propagate_translation=lambda: _propagate_translation_staleness,
    propagate_relations=lambda: _propagate_relation_inverse,
    resolve_page_context=lambda metadata, path: _resolve_page_context_from_path(
        metadata,
        path,
    ),
    file_etag=file_etag,
    safe_error_detail=safe_error_detail,
)


save_page, patch_page = page_commands_api.register_write_routes(
    router,
    editor_dependency=require_role("editor"),
    workspace_context_dependency=get_workspace_context,
    save_dependencies=_SAVE_PAGE_DEPENDENCIES,
    patch_dependencies=_PATCH_PAGE_DEPENDENCIES,
)


# ---------------------------------------------------------------------------
# Paperera (soft-delete) — vegeu docs/dev_memory/directives/vault_trash.md
# ---------------------------------------------------------------------------

TRASH_RETENTION_DAYS = 90


def _trash_root() -> Path:
    """Root of the Vault trash. Call it only from worker threads
    (it touches the filesystem). Creates the directory if it doesn't exist."""
    return TrashRepository(
        get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=parse_frontmatter,
        write_json=safe_write_json,
    ).root()


def _trash_entry_dir(page_id: str) -> Path:
    # Defense-in-depth against path traversal: a `page_id` like ".." would make
    # `_trash_root() / page_id` resolve to the vault itself, and `shutil.rmtree`
    # would then wipe the whole vault. HTTP handlers already call
    # `_validate_safe_page_id`; this backstops every other caller.
    return TrashRepository(
        get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=parse_frontmatter,
        write_json=safe_write_json,
    ).entry_dir(page_id)


def _move_page_to_trash(page_id: str, file_path: Path) -> Dict[str, Any]:
    """Moves a .md file to `.trash/{page_id}/page.md` and writes the sidecar.

    Returns the trash metadata (id, deleted_at, original_path, ...).
    Does not invoke any async helper: it is meant to run inside
    `asyncio.to_thread` from the HTTP handler.
    
    """
    return TrashRepository(
        get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=parse_frontmatter,
        write_json=safe_write_json,
    ).move_page(page_id, file_path)


def _restore_page_from_trash(page_id: str) -> Dict[str, Any]:
    """Inverse of `_move_page_to_trash`. Restores the file to `original_path`.

    Raises `FileNotFoundError` if the trash doesn't contain the entry,
    `FileExistsError` if there's already a file at the destination, and `PermissionError`
    if the sidecar path escapes the Vault (anti-path-traversal defense).
    
    """
    return TrashRepository(
        get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=parse_frontmatter,
        write_json=safe_write_json,
    ).restore_page(page_id)


def _read_trash_entries() -> List[Dict[str, Any]]:
    """Reads all `.trash/*/_trash.json` sidecars. Tolerates entries without
    a sidecar (they are returned with `deleted_at=None` and a fallback title)."""
    return TrashRepository(
        get_p("VAULT"),
        retention_days=TRASH_RETENTION_DAYS,
        parse_frontmatter=parse_frontmatter,
        write_json=safe_write_json,
    ).list_entries()


async def _materialize_trash_sidecar(page_id: str) -> None:
    """Materializes ONLY the `_trash.json` of an entry before reading it in the
    sync thread (restore/purge). Without this, a dataless OneDrive sidecar
    crashes with [Errno 35] EDEADLK. The path calculation —which touches the FS via
    `_trash_root()` (mkdir)— goes to a worker thread so as not to block the event
    loop; only the async materialization happens here. `page.md` is not downloaded
    (unnecessary: the restore move is a rename and the purge only does unlink)."""
    def _existing_sidecar() -> Optional[Path]:
        sidecar = _trash_entry_dir(page_id) / "_trash.json"
        return sidecar if sidecar.exists() else None
    try:
        sidecar = await asyncio.to_thread(_existing_sidecar)
    except OSError:
        return
    if sidecar is not None:
        await _materialize_if_online_only(sidecar, f"trash/{page_id}")


async def _materialize_all_trash_sidecars() -> None:
    """Warmup of all `_trash.json` files before listing the trash. The scan
    of `.trash` (mkdir/iterdir, cf. the note in `_trash_root`) goes to a worker
    thread; only the async materialization happens on the event loop. Without this, the
    dataless sidecars crash with EDEADLK and the entries show up as "(corrupt)"."""
    def _scan_sidecars() -> List[Path]:
        root = _trash_root()
        if not root.exists():
            return []
        return [d / "_trash.json" for d in root.iterdir() if d.is_dir()]
    try:
        sidecars = await asyncio.to_thread(_scan_sidecars)
    except OSError:
        return
    for sidecar in sidecars:
        await _materialize_if_online_only(sidecar, f"trash/{sidecar.parent.name}")


def _purge_trash_entry(page_id: str) -> Dict[str, Any]:
    """Permanently deletes an entry from the trash."""
    entry_dir = _trash_entry_dir(page_id)
    if not entry_dir.exists():
        raise FileNotFoundError(f"No trash entry for {page_id}")
    # Size before purging (telemetry).
    freed_bytes = 0
    for f in entry_dir.rglob("*"):
        try:
            if f.is_file():
                freed_bytes += f.stat().st_size
        except Exception:
            pass

    # Reads the page's relations BEFORE destroying it: when purging, we need to
    # remove its id from the pages that pointed to it (the inverse). Without this,
    # deleting a source page left relations dangling toward an id that no longer
    # exists anywhere — permanently, because the page cannot be restored
    # (audited on the real vault: 4 pages with `Font →` a purged id). In a
    # soft-delete it is intentionally NOT cleaned up (it preserves the relation in case of restore);
    # the purge is the final point where it's appropriate.
    _purged_meta: Optional[dict] = None
    _purged_table_id: Optional[str] = None
    try:
        _page_md = entry_dir / "page.md"
        if _page_md.exists():
            _raw = _page_md.read_text(encoding="utf-8")
            _purged_meta, _ = parse_frontmatter(_raw, _page_md)
            _purged_table_id = (
                _purged_meta.get("table_id")
                or _purged_meta.get("database_table_id")
            )
    except Exception as exc:
        log.debug(f"purge: could not read relationships for {page_id}: {exc}")

    shutil.rmtree(entry_dir)

    # Removes this page's id from the inverse relations of the others
    # (best-effort; `_propagate_relation_inverse` is defensive and non-blocking).
    # empty new_meta → all of the page's relations count as "remove".
    if _purged_meta and _purged_table_id:
        try:
            _propagate_relation_inverse(page_id, _purged_table_id, _purged_meta, {})
        except Exception as exc:
            log.debug(f"purge: inverse relationship cleanup failed for {page_id}: {exc}")

    # Clean up the internal metadata sidecar: if it were left orphaned, it wouldn't hurt, but it's
    # better to purge it for consistency. The page is no longer recoverable.
    try:
        vault_root = get_p("VAULT")
        if vault_root:
            delete_sidecar_for_page(vault_root, page_id)
    except Exception as exc:
        log.debug(f"Could not purge the page_meta sidecar for {page_id}: {exc}")
    # Purge = PERMANENT deletion: also remove the traces that used to remain
    # orphaned forever (audited on the real vault: 158 history directories from
    # already-purged pages, with the FULL CONTENT inside — the user believes that
    # the page is gone but .history still has it). All best-effort: the
    # purge never fails due to the cleanup.
    try:
        safe_id = _validate_safe_page_id(page_id)
        history_dir = get_p("VAULT") / ".history" / safe_id
        if history_dir.exists():
            shutil.rmtree(history_dir)
    except Exception as exc:
        log.debug(f"Could not purge history for {page_id}: {exc}")
    try:
        data = _load_comments()
        if page_id in data:
            data.pop(page_id, None)
            _save_comments(data)
    except Exception as exc:
        log.debug(f"Could not purge comments for {page_id}: {exc}")
    try:
        inline_path = _inline_comments_path(page_id)
        if inline_path.exists():
            inline_path.unlink()
    except Exception as exc:
        log.debug(f"Could not purge inline comments for {page_id}: {exc}")
    return {"id": page_id, "freed_bytes": freed_bytes}


def _force_index_rescan() -> None:
    """Invalidates the index cache to force a rescan on the next listing."""
    page_state.last_vault_sync_time = 0.0
    _clear_page_index_cache()


def _remove_page_from_index_cache(page_id: str, old_path: Optional[Path] = None) -> None:
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
    with _page_index_lock:
        id_map = _page_id_to_path.get(v_str, {})
        entries = _page_index_entries.get(v_str, {})
        path_str = id_map.pop(page_id, None)
        if path_str:
            entries.pop(path_str, None)
        if old_path:
            entries.pop(str(old_path), None)
    # Keeps the PathResolver in sync (rule_engine.find_path and the listing
    # of files from /unlinked-mentions read from there, not from this index).
    path_resolver.remove_file(v_path, page_id, old_path or (Path(path_str) if path_str else None))
    # Surgical removal from the derived caches too. Without this, the
    # soft-deleted page keeps showing up in `/global-index` (and thus in the
    # `[[` wikilink autocomplete) until their 60s TTLs expire — and with
    # stale-while-revalidate the FIRST fetch after the TTL still returns
    # the stale copy.
    removed_paths = {str(old_path)} if old_path else set()
    if path_str:
        removed_paths.add(path_str)
    with _iter_docs_lock:
        _dc_entry = _iter_docs_cache.get(v_str)
        docs = _dc_entry.get("docs") if _dc_entry else None
        if docs is not None and removed_paths:
            _dc_entry["docs"] = [d for d in docs if str(d[0]) not in removed_paths]
    with _id_title_lock:
        _it_entry = _id_title_cache.get(v_str)
        if _it_entry:
            _it_entry.get("index", {}).pop(page_id, None)
    # Any delete/restore changes the composition of visible pages;
    # invalidates the response micro-cache to avoid a stale `/by-table`.
    _pages_cache_invalidate_all()


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
        new_entry = _build_page_cache_entry(file_path, stat_result)
    except Exception as e:
        # warning, not debug: a silent failure here means the restored/duplicated
        # page stays invisible until the next full rescan (600s cooldown).
        log.warning(f"_add_page_to_index_cache failed for {file_path}: {e}")
        return
    with _page_index_lock:
        _page_index_entries.setdefault(v_str, {})[str(file_path)] = new_entry
        new_id = new_entry.get("id")
        if new_id:
            _page_id_to_path.setdefault(v_str, {})[new_id] = str(file_path)
    # PathResolver too: without this the restored/duplicated page would remain
    # out of the file list until the full rescan (600s cooldown) and
    # /unlinked-mentions i rule_engine.find_path no la veien.
    path_resolver.add_file(v_path, new_id, file_path)
    # Derived caches too (symmetric to `_remove_page_from_index_cache`): the
    # restored page must reappear in `/global-index` (the `[[` autocomplete)
    # without waiting for the 60s TTL + stale-while-revalidate cycle.
    try:
        raw_content = file_path.read_text(encoding="utf-8", errors="ignore")
        metadata, body = parse_frontmatter(raw_content, file_path)
        path_str = str(file_path)
        with _iter_docs_lock:
            _dc_entry = _iter_docs_cache.get(v_str)
            docs = _dc_entry.get("docs") if _dc_entry else None
            if docs is not None:
                new_doc = (file_path, metadata, body, _is_dashboard_file_path(file_path))
                for i, doc in enumerate(docs):
                    if str(doc[0]) == path_str:
                        docs[i] = new_doc
                        break
                else:
                    docs.append(new_doc)
        if new_id:
            with _id_title_lock:
                _it_entry = _id_title_cache.get(v_str)
                if _it_entry:
                    _it_entry.get("index", {})[str(new_id)] = str(
                        metadata.get("title") or file_path.stem
                    )
    except Exception as e:
        log.debug(f"Derived-cache update after add failed for {file_path}: {e}")
    _pages_cache_invalidate_all()


def _emit_page_deleted_event(page_id: str) -> None:
    try:
        from backend.services import plugin_events

        plugin_events.emit("page:deleted", {"page_id": page_id})
    except Exception:  # noqa: BLE001
        pass


trash_api.configure(
    trash_api.TrashDependencies(
        retention_days=TRASH_RETENTION_DAYS,
        validate_page_id=_validate_safe_page_id,
        get_page_write_lock=lambda page_id: _get_page_write_lock(page_id),
        find_page=lambda page_id: find_page_path(page_id),
        move_page=lambda page_id, file_path: _move_page_to_trash(
            page_id,
            file_path,
        ),
        remove_link_index=lambda page_id: remove_from_link_index(page_id),
        remove_page_index=lambda page_id, path: _remove_page_from_index_cache(
            page_id,
            path,
        ),
        emit_page_deleted=_emit_page_deleted_event,
        materialize_sidecar=lambda page_id: _materialize_trash_sidecar(page_id),
        materialize_all_sidecars=lambda: _materialize_all_trash_sidecars(),
        restore_page=lambda page_id: _restore_page_from_trash(page_id),
        add_page_index=lambda path: _add_page_to_index_cache(path),
        vault_root=lambda: get_p("VAULT"),
        read_entries=lambda: _read_trash_entries(),
        trash_root=lambda: _trash_root(),
        purge_entry=lambda page_id: _purge_trash_entry(page_id),
        safe_error_detail=safe_error_detail,
    )
)
trash_api.register_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
    admin_dependencies=[Depends(require_role("admin"))],
)
delete_page = trash_api.delete_page
restore_page = trash_api.restore_page
list_trash = trash_api.list_trash
empty_trash = trash_api.empty_trash
purge_trash_entry = trash_api.purge_trash_entry
purge_expired_trash = trash_api.purge_expired_trash


_LOCAL_LINK_STORE = LocalLinkStore(resolve_data_dir)
_PROPERTY_FILE_DEPENDENCIES = property_file_service.PropertyFileDependencies(
    get_path=lambda key: get_p(key),
    load_registry=lambda: load_registry(),
    resolve_table=lambda table_id, registry: _resolve_table_and_database_for_assets(
        table_id,
        registry,
    ),
    find_property=lambda table, name: _find_table_property(table, name),
    property_config_value=lambda prop, key: _property_config_value(prop, key),
    property_assets_dir=lambda table, database, name: _property_assets_dir(
        table,
        database,
        name,
    ),
    sanitize_filename=lambda value: _sanitize_filename_base(value),
    sanitize_segment=lambda value, fallback: _sanitize_asset_segment(
        value,
        fallback,
    ),
    active_vault_path=lambda: get_active_vault_path(),
    library_roots=lambda vault: _library_roots(vault),
)
_LOCAL_FILE_DEPENDENCIES = file_local_service.LocalFileDependencies(
    store=_LOCAL_LINK_STORE,
    resolve_target=lambda raw: _resolve_stored_file_target(raw),
    materialize=lambda path, label: _ensure_materialized_or_503(path, label),
    classify_kind=lambda extension: media_service.classify_kind(extension),
    get_path=lambda key: get_p(key),
    provider=get_files_provider,
)
_LINK_FILE_DEPENDENCIES = file_local_service.LinkFileDependencies(
    resolve_target=lambda raw: _resolve_stored_file_target(raw),
    materialize=lambda path, label: _ensure_materialized_or_503(path, label),
    sanitize_filename=lambda value: _sanitize_filename_base(value),
    library_roots=lambda vault: _library_roots(vault),
    active_vault_path=lambda: get_active_vault_path(),
    get_path=lambda key: get_p(key),
    host_home_path=lambda: _host_home_path(),
)
_DELETE_FILE_DEPENDENCIES = file_local_service.DeleteFileDependencies(
    store=_LOCAL_LINK_STORE,
    get_path=lambda key: get_p(key),
    expand_host_tilde=lambda value: _expand_host_tilde(value),
    reroot_attachment=lambda value: _reroot_attachment_under_current_host(value),
    move_to_trash=lambda target: file_host_trash.try_host_trash_helper(
        target,
        helper_url=_HOST_TRASH_HELPER_URL,
    ),
)
_THUMBNAIL_DEPENDENCIES = ThumbnailDependencies(
    get_path=lambda key: get_p(key),
    provider=get_files_provider,
    daemon_url=lambda: _THUMB_DAEMON_URL,
    daemon_timeout=lambda: _THUMB_DAEMON_TIMEOUT,
)
files_api.configure(
    files_api.FileApiDependencies(
        get_path=lambda key: get_p(key),
        active_vault_path=lambda: get_active_vault_path(),
        library_roots=lambda vault: _library_roots(vault),
        provider=get_files_provider,
        serving_state=file_serving_state,
        local_files=_LOCAL_FILE_DEPENDENCIES,
        link_files=_LINK_FILE_DEPENDENCIES,
        delete_files=_DELETE_FILE_DEPENDENCIES,
        property_files=_PROPERTY_FILE_DEPENDENCIES,
        thumbnails=_THUMBNAIL_DEPENDENCIES,
    )
)
_CUSTOM_ICON_STORE = CustomIconStore(
    path_provider=lambda: get_p("CUSTOM_ICONS"),
    json_writer=lambda path, value: safe_write_json(
        path,
        value,
        indent=2,
        ensure_ascii=False,
    ),
)
_ASSET_SERVICE_DEPENDENCIES = assets_service.AssetDependencies(
    get_path=lambda key: get_p(key),
    save_uploaded_asset=lambda upload, target, name: _save_uploaded_file_to_assets(
        upload,
        target,
        name,
    ),
    load_registry=lambda: load_registry(),
    resolve_table=lambda table_id, registry: _resolve_table_and_database_for_assets(
        table_id,
        registry,
    ),
    table_assets_dir=lambda table, database: _table_assets_dir(table, database),
    safe_write_bytes=lambda path, payload: safe_write_bytes(path, payload),
    validate_external_url=lambda url: _is_safe_external_url(url),
)
assets_api.configure(
    assets_api.AssetApiDependencies(
        service=_ASSET_SERVICE_DEPENDENCIES,
        custom_icons=_CUSTOM_ICON_STORE,
        materialize=lambda path, label: _materialize_if_online_only(path, label),
        serve_contained=lambda root, rel: files_api._serve_file_with_containment(
            root,
            rel,
        ),
        serve_image=lambda vault, rel: file_serving.serve_vault_image(
            vault,
            rel,
            state=file_serving_state,
            provider=get_files_provider(),
        ),
    )
)
assets_api.register_primary_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
)
upload_cover = assets_api.upload_cover
upload_icon = assets_api.upload_icon
import_icon_from_url = assets_api.import_icon_from_url
upload_asset = assets_api.upload_asset
get_asset = assets_api.get_asset
_custom_icons_lock = _CUSTOM_ICON_STORE.lock
_LOCAL_LINKS_LOCK = _LOCAL_LINK_STORE.lock
_VAULT_IMAGE_SEMAPHORE = file_serving_state.semaphore


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
        return False, "Invalid URL"
    if parsed.scheme.lower() not in ("http", "https"):
        return False, "URL must be http(s)"
    host = parsed.hostname
    if not host:
        return False, "URL has no host"
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror:
        return False, "Could not resolve host"
    for info in infos:
        try:
            ip = ipaddress.ip_address(info[4][0])
        except ValueError:
            continue
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_multicast or ip.is_reserved or ip.is_unspecified):
            return False, f"Host resolves to a non-public address ({ip})"
    return True, ""


# --- Media Manager (ADVANCED ARCHIVE) ---

# Valid roots: the UI sends ?root=images|assets|library|vault. The
# response from /media/roots indicates which ones have a folder on disk.
_VALID_MEDIA_ROOTS = {"images", "assets", "library", "vault"}


def _validate_root(root: str) -> str:
    if root not in _VALID_MEDIA_ROOTS:
        raise HTTPException(status_code=400, detail=f"Root invàlid: {root!r}")
    return root


@router.get("/media/roots")
async def get_media_roots():
    """Returns the roots available for media search (Images, Assets,
    Library, Vault). Each element indicates `available` based on whether the folder
    currently exists on disk."""
    return media_service.get_roots()


@router.get("/media")
async def get_all_media(
    album: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    root: str = Query("images"),
    # Filters (all optional — with none, keeps the historical behavior)
    kinds: Optional[str] = Query(None, description="csv: image,video,audio,pdf,other"),
    extensions: Optional[str] = Query(None, description="csv sense punt: jpg,png,..."),
    q: Optional[str] = Query(None, description="substring sobre filename"),
    desc_contains: Optional[str] = Query(None, description="substring sobre descripció"),
    tags_any: Optional[str] = Query(None, description="csv de tags (OR)"),
    tags_all: Optional[str] = Query(None, description="csv de tags (AND)"),
    tags_none: Optional[str] = Query(None, description="csv de tags (NOT)"),
    size_min: Optional[int] = Query(None, ge=0, description="KB"),
    size_max: Optional[int] = Query(None, ge=0, description="KB"),
    mtime_from: Optional[str] = Query(None, description="ISO date"),
    mtime_to: Optional[str] = Query(None, description="ISO date"),
    sort: str = Query("mtime", description="mtime|filename|size|kind"),
    dir: str = Query("desc", description="asc|desc"),
):
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
    return media_service.get_all_media(
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


@router.get("/media/albums")
async def get_albums():
    """Returns the list of top-level albums. Compat: the new frontend
    uses /media/tree for hierarchical navigation."""
    return media_service.get_albums()


@router.get("/media/tree")
async def get_media_tree(
    path: Optional[str] = Query(None),
    root: str = Query("images"),
):
    """Returns the immediate subfolders of `<root>/path` (lazy). Each node
    includes `has_children` so the UI can draw the chevron without having to
    load the whole tree (the archive has ~33k directories).
    For root="vault" it excludes system folders (.git, BD, .gnosi, etc.).
    
    """
    _validate_root(root)
    return media_service.get_tree_node(path, root=root)


@router.post("/media/upload", dependencies=[Depends(require_role("editor"))])
async def upload_media(
    file: UploadFile = File(...),
    album: str = Query("General"),
    background_tasks: BackgroundTasks = BackgroundTasks()
):
    """Uploads a media file to an album."""
    result = media_service.upload_media(file, album)
    return result


@router.patch("/media/metadata", dependencies=[Depends(require_role("editor"))])
async def update_media_metadata(
    metadata: Dict[str, Any] = Body(..., description="{tags?: string[], description?: string}"),
    path_in_root: Optional[str] = Body(None, description="Path relative to the root (preferred)"),
    root: str = Body("images"),
    # Compat with old calls (filename + album); reconstructs the path.
    filename: Optional[str] = Body(None),
    album: Optional[str] = Body(None),
):
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
    success = media_service.update_metadata(resolved, metadata, root=root)
    if not success:
        raise HTTPException(status_code=500, detail="Persistence error")
    return {"status": "ok"}


# --- Saved views (filters + sort + named scope) ---

@router.get("/media/views")
async def list_media_views():
    """Returns the user's saved views (JSON sidecar in the vault)."""
    return media_service.list_views()


@router.post("/media/views", dependencies=[Depends(require_role("editor"))])
async def create_media_view(payload: Dict[str, Any] = Body(...)):
    """Creates a new view. Payload: {label, scope, filters, sort}."""
    try:
        return media_service.create_view(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.patch("/media/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def update_media_view(view_id: str, payload: Dict[str, Any] = Body(...)):
    """Updates an existing view."""
    updated = media_service.update_view(view_id, payload)
    if updated is None:
        raise HTTPException(status_code=404, detail="Vista no trobada")
    return updated


@router.delete("/media/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def delete_media_view(view_id: str):
    """Deletes a view."""
    if not media_service.delete_view(view_id):
        raise HTTPException(status_code=404, detail="Vista no trobada")
    return {"status": "ok"}

# Limits the number of concurrent reads on the vault bind-mount:
# `grpcfuse` (Docker Desktop) can return Errno 35 (Resource deadlock
# avoided) under pressure, especially when the underlying filesystem is
# cloud-on-demand (OneDrive/iCloud File Provider) and each file is
# materialized separately. With HTTP/1.1 the browser already limits it to ~6
# per host, but more serialization is needed to avoid chaining errors.
_VAULT_IMAGE_SEMAPHORE = file_serving_state.semaphore

# The detection + materialization of cloud-on-demand files lives in
# `backend.platform.files`. The instance (OneDriveProvider or
# LocalProvider) is decided by the factory based on env vars; here we only
# we consume. See docs/dev_memory/directives/files_provider_abstraction.md.


_NO_STORE_HEADERS = {"Cache-Control": "no-store, must-revalidate"}


def _image_error(status: int, detail: str, retry_after: Optional[int] = None) -> HTTPException:
    return file_serving.image_error(status, detail, retry_after)


def _onedrive_read_failure_hint(err: OSError) -> str:
    return file_serving.read_failure_hint(err)


assets_api.register_image_route(router)
serve_vault_image = assets_api.serve_vault_image


# --- File servers for the multi-root roots ---
#
# `/images/...` already existed (historical gallery with OneDrive warmup). To make
# the multi-root search can return servable URLs for Assets/Library/Vault,
# we add:
#   - /library/{path}   → serves Library/ (sibling of the vault)
#   - /raw/{path}          → serves any path inside VAULT/
# They validate strict containment (`is_relative_to`) to prevent escapes
# such as `../` or similar names (e.g. `Assets-secret/`). Without Cache-Control
# long because PDFs and videos can be updated in place.

async def _serve_file_with_containment(root_dir: Path, rel_path: str) -> FileResponse:
    return await files_api._serve_file_with_containment(root_dir, rel_path)


files_api.register_serving_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
)
serve_library_file = files_api.serve_library_file
serve_vault_raw_file = files_api.serve_vault_raw_file
serve_thumb = files_api.serve_thumb
register_local_file = files_api.register_local_file
serve_local_file = files_api.serve_local_file


# --- Thumbnails (QuickLook via host daemon) ---
#
# For files that `<img>` cannot render (videos, PDFs, audio...),
# we generate a thumbnail using `qlmanage` through the host daemon
# (`scripts/runtime/onedrive_warmup_daemon.py`, endpoint `/thumb`). The thumb is cached on the
# host at `${HOME}/.cache/gnosi/thumbs/<sha>.png` and the container can
# read it directly (the home directory is bind-mounted for OneDrive).
#
# The frontend transforms `item.url` (e.g. `/api/vault/raw/foo/bar.mp4`)
# to `/api/vault/thumb/raw/foo/bar.mp4`. Here we parse the first segment
# to resolve the correct root and we validate containment.

# Autodetect native vs Docker (host.docker.internal does not resolve natively,
# which silently broke thumbnails on the default native runtime).
_THUMB_DAEMON_URL = default_thumb_daemon_url()
_THUMB_DAEMON_TIMEOUT = float(os.environ.get("THUMB_DAEMON_TIMEOUT", "45"))
# Roots exposed to thumbs. All of them live inside /vault; `library` isn't there
# because no frontend consumer requests thumbs for Library (the PDFs
# in `files` fields are shown with an icon). If it's ever needed, it's enough to
# add `"library": ("LIBRARY", None)` here: the rest of the chain already
# supports it — the daemon accepts multiple roots (allowlist OneDrive-UNED,
# 2026-05-18) and `_container_to_host_path` passes the mounts as-is
# identity like Library or HOME (2026-06-10).
_THUMB_ROOTS_MAP = file_thumbnails.THUMB_ROOTS_MAP


def _resolve_thumb_source(rel_url: str) -> Path:
    return files_api._resolve_thumb_source(rel_url)


def _container_to_host_path(container_path: Path) -> Optional[str]:
    return files_api._container_to_host_path(container_path)


def _thumb_no_store(status_code: int, detail: str):
    return files_api._thumb_no_store(status_code, detail)


# --- Links to local files (Variant C: no copy, no upload) ---
#
# When the user selects "Link local file" in the MediaInsertDialog, the
# absolute path is chosen via `/pick-file` (osascript) and registered here. We return an
# opaque token and a `/api/vault/local-file/{token}` URL that the frontend can
# insert into the BlockEditor as an image/video src.
#
# Why tokens instead of serving the path directly in the URL?
#  1) Paths can contain problematic characters (apostrophes, spaces).
#  2) Without an explicit allowlist, any GET to /local-file/<path> would allow
#     reading the user's entire home directory. With tokens we only serve paths that
#     the user has explicitly registered through the native picker.
#  3) If the original path moves, we can invalidate the token without changing the URL
#     saved in the document.

_LOCAL_LINKS_LOCK = _LOCAL_LINK_STORE.lock


def _local_links_file() -> Path:
    return files_api._local_links_file()


def _load_local_links() -> Dict[str, str]:
    return files_api._load_local_links()


def _save_local_links(mapping: Dict[str, str]) -> None:
    files_api._save_local_links(mapping)


assets_api.register_custom_icon_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
)
get_custom_icons = assets_api.get_custom_icons
save_custom_icons = assets_api.save_custom_icons


# Legacy `storage_folder` values kept working: the Library folder was called
# "Biblioteca" before the rename, and registries written back then still carry
# it. Without this alias the value matched no branch and silently fell through
# to Assets — a field configured for the Library uploaded to Assets instead
# (seen on Recursos/"Arxiu/s", whose config is still storage_folder=biblioteca).
_STORAGE_FOLDER_ALIASES = property_file_service.STORAGE_FOLDER_ALIASES


def _normalize_storage_folder(storage_folder: str) -> str:
    return files_api._normalize_storage_folder(storage_folder)


def _effective_storage_folder(configured_storage: str, requested_storage: str) -> str:
    return files_api._effective_storage_folder(configured_storage, requested_storage)


def _resolve_storage_dir(
    storage_folder: str, table, database, property_name: str, dest_folder: str = ""
) -> tuple[Path, str]:
    return files_api._resolve_storage_dir(
        storage_folder, table, database, property_name, dest_folder
    )


def _file_response_payload(dest_path: Path, url_prefix_type: str) -> dict:
    return property_file_service.file_response_payload(
        dest_path, url_prefix_type, _PROPERTY_FILE_DEPENDENCIES
    )


files_api.register_property_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
)
upload_property_file = files_api.upload_property_file
link_existing_file = files_api.link_existing_file
delete_physical_file = files_api.delete_physical_file


def _numbered_candidate(directory: Path, stem: str, ext: str, index: int) -> Path:
    return files_api._numbered_candidate(directory, stem, ext, index)


# Ceiling on the numbering probe. A field pattern that resolves to the same name
# for hundreds of rows is a schema problem, not something to spin on; past this
# we fall back to a random suffix, which always terminates.
_MAX_NUMBERED_ATTEMPTS = property_file_service.MAX_NUMBERED_ATTEMPTS


def _save_uploaded_file_to_dir(upload: UploadFile, target_dir: Path, target_name: str = "") -> Path:
    return files_api._save_uploaded_file_to_dir(upload, target_dir, target_name)


def _run_osascript_picker(script: str) -> str:
    """Sync helper for use with asyncio.to_thread."""
    import subprocess
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=60,
    )
    return result.stdout.strip()


@router.post("/pick-folder", dependencies=[Depends(require_role("editor"))])
async def pick_folder():
    """Open a native macOS folder-picker dialog and return the chosen path."""
    import asyncio as _asyncio
    import subprocess
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        'set chosen to choose folder with prompt "Selecciona la carpeta de destinació"\n'
        'return POSIX path of chosen'
    )
    try:
        # subprocess.run with timeout=60 inside an async endpoint blocks
        # the whole event loop for up to 1 minute while the user thinks in the dialog
        # the Finder. Off-thread to serve other requests in parallel.
        chosen = await _asyncio.to_thread(_run_osascript_picker, script)
        if not chosen:
            raise HTTPException(status_code=204, detail="No folder selected")
        return {"path": chosen}
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=408, detail="Folder picker timed out")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /pick-folder"),
        )


@router.post("/pick-file", dependencies=[Depends(require_role("editor"))])
async def pick_file():
    """Open a native macOS file-picker dialog and return the chosen file path."""
    import asyncio as _asyncio
    import subprocess
    script = (
        'tell application "System Events"\n'
        '  activate\n'
        'end tell\n'
        'set chosen to choose file with prompt "Select the file to link"\n'
        'return POSIX path of chosen'
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
        raise HTTPException(
            status_code=500,
            detail=safe_error_detail(e, "POST /pick-file"),
        )


@router.get("/unsplash/search")
async def unsplash_search(query: str = Query(...), page: int = Query(1)):
    """Searches images on Unsplash acting as a proxy."""
    unsplash_key = os.getenv("UNSPLASH_ACCESS_KEY")
    if not unsplash_key:
        raise HTTPException(
            status_code=500,
            detail="Unsplash API Key is not configured in .env (UNSPLASH_ACCESS_KEY)",
        )

    url = "https://api.unsplash.com/search/photos"
    headers = {"Authorization": f"Client-ID {unsplash_key}"}
    params = {"query": query, "page": page, "per_page": 21, "orientation": "landscape"}

    try:
        # to_thread + explicit timeout. Without timeout, a stuck Unsplash
        # connection would block this async handler indefinitely (and via
        # the shared event loop, all concurrent requests with it).
        resp = await asyncio.to_thread(
            requests.get, url, headers=headers, params=params, timeout=10
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
        log.error(f"Error fetching from Unsplash: {e}")
        raise HTTPException(status_code=502, detail="Error fetching from Unsplash API")


page_duplicate_api.configure(
    page_duplicate_api.DuplicatePageDependencies(
        find_page=lambda page_id: find_page_path(page_id),
        is_dashboard=lambda path: _is_dashboard_file_path(path),
        read_dashboard=lambda path: _read_dashboard_file(path),
        parse_frontmatter=lambda content, path: parse_frontmatter(content, path),
        new_id=lambda: str(uuid.uuid4()),
        write_dashboard=lambda path, page_id, title, metadata, content: _write_dashboard_file(
            file_path=path,
            page_id=page_id,
            title=title,
            metadata=metadata,
            content=content,
            parent_id=metadata.get("parent_id"),
            is_database=bool(metadata.get("is_database")),
        ),
        ensure_citation_key=lambda metadata: _ensure_recursos_citation_key(
            metadata,
            regenerate=True,
        ),
        save_page=lambda path, metadata, content: save_page_md(
            path,
            metadata,
            content,
        ),
        add_page_index=lambda path: _add_page_to_index_cache(path),
        update_link_index=lambda: update_link_index_for_page,
    )
)
page_duplicate_api.register_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
)
duplicate_page = page_duplicate_api.duplicate_page


# ── Global id→title index with disk persistence + stale-while-revalidate ───
# It's used by /backlinks, /unlinked-mentions and /global-index, all in the
# load of ANY page. Building it walks the entire vault on OneDrive
# (rglob + parse frontmatter), measured cost ~15s COLD. Previously it wasn't persisted
# nor was it pre-warmed at warmup, so the 1st page load after
# EVERY backend restart paid these ~15s (symptom: "the embedded view
# takes a long time to load"). Now, same pattern as the page-index/body-cache:
#   • it's saved to /app/data/cache/vault_id_title_index.json,
#   • it loads from disk at startup (instant response),
#   • it refreshes in the background (stale-while-revalidate): the request returns the
#     cached value and the OneDrive rglob is paid OUTSIDE the request.
# Maximum staleness: _ID_TITLE_TTL (same as the TTL of _iter_docs_cache,
# which this index derives from — that's why no explicit invalidation is needed on
# write endpoints: _iter_docs_cache is already updated surgically).
_ID_TITLE_TTL = 60.0
# Per-vault (v_str -> {"index": {...}, "ts": float}). Multi-vault: like
# `_page_index_entries`, this cache MUST be indexed by vault. With a single
# global dict, one vault would serve another's index (and right after switching
# vaults, /global-index and /backlinks returned data from the previous vault until
# the TTL expired). Same fix in `_iter_docs_cache`, which it derives from.
_id_title_cache: dict = {}
_id_title_lock = threading.Lock()
_id_title_refreshing: set = set()   # v_str of the refreshes in progress (one per vault)


def _current_vault_key() -> str:
    """Key for this module's per-vault caches: str of the ACTIVE vault's path
    (via contextvar). Empty outside a request (or if there is no vault) → falls back to
    the previous behavior (a single entry with key "")."""
    try:
        from backend.services.context_vars import get_active_vault_path
        v = get_active_vault_path()
        return str(v) if v else ""
    except Exception:
        return ""


def _get_id_title_cache_path(v_str: Optional[str] = None) -> Optional[Path]:
    """Local path where the id→title index is persisted, PER VAULT (same pattern as
    `get_page_index_cache_path`: one file per vault via a hash of the path)."""
    base = get_p("PAGE_INDEX_CACHE")
    p = (
        base.parent / "vault_id_title_index.json"
        if base
        else resolve_data_dir() / "cache" / "vault_id_title_index.json"
    )
    if v_str:
        digest = hashlib.sha256(v_str.encode("utf-8")).hexdigest()[:16]
        return p.with_name(f"{p.stem}_{digest}{p.suffix}")
    return p


def _save_id_title_to_disk(v_str: str, index: Dict[str, str]) -> None:
    try:
        cache_path = _get_id_title_cache_path(v_str)
        if not cache_path:
            return
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        safe_write_json(cache_path, index, indent=None, ensure_ascii=False)
    except Exception as e:
        log.warning(f"id-title persist failed: {e}")


def _load_id_title_from_disk(v_str: str) -> bool:
    """Loads the persisted index for vault `v_str` and marks it STALE (ts=0) so that
    the first use triggers a background refresh against the vault's real state."""
    try:
        cache_path = _get_id_title_cache_path(v_str)
        if not cache_path or not cache_path.exists():
            return False
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        with _id_title_lock:
            _id_title_cache[v_str] = {
                "index": {str(k): str(v) for k, v in data.items()},
                "ts": 0.0,
            }
        log.info(f"📂 id-title index loaded from disk ({len(data)} entries)")
        return True
    except Exception as e:
        log.warning(f"id-title load skipped: {e}")
        return False


def _compute_id_title_index() -> Dict[str, str]:
    """Actual computation: id→title for the whole vault and dashboards. May run an rglob on
    OneDrive cold (expensive). Call only outside the request (background)."""
    index: Dict[str, str] = {}
    for file_path, metadata, _body, is_dashboard in _iter_linkable_page_documents():
        try:
            if is_dashboard:
                page_id = str(metadata.get("id") or file_path.stem)
            else:
                page_id = str(
                    metadata.get("id") or metadata.get("migration_id") or file_path.stem
                )
            title = str(metadata.get("title") or file_path.stem)
            index[page_id] = title
        except Exception as e:
            log.warning(f"Error indexing {file_path.name}: {e}")
    return index


def _refresh_id_title_index(v_str: str) -> None:
    """Recomputes and persists in the background FOR VAULT `v_str`. Only one concurrent
    refresh per vault. The thread SETS the vault's contextvar: threads do NOT
    inherit contextvars, so without this `_compute_id_title_index` would iterate
    the default vault and we would write wrong data under the `v_str` key."""
    with _id_title_lock:
        if v_str in _id_title_refreshing:
            return
        _id_title_refreshing.add(v_str)

    def _run():
        from backend.services.context_vars import active_vault_path
        token = None
        try:
            if v_str:
                token = active_vault_path.set(Path(v_str))
            idx = _compute_id_title_index()
            with _id_title_lock:
                _id_title_cache[v_str] = {"index": idx, "ts": time.time()}
            _save_id_title_to_disk(v_str, idx)
        except Exception as e:
            log.warning(f"id-title refresh failed: {e}")
        finally:
            if token is not None:
                active_vault_path.reset(token)
            with _id_title_lock:
                _id_title_refreshing.discard(v_str)

    threading.Thread(target=_run, daemon=True, name="id-title-refresh").start()


def build_id_title_index() -> Dict[str, str]:
    """Global id→title with persistent cache + stale-while-revalidate.

    Never blocks the request if there is a cache (memory or disk): it returns a copy
    of the cached value and triggers the recomputation in the background. Only the
    very FIRST time, with no cache at all (not even on disk), is the synchronous cost paid.
    Returns a copy to prevent a consumer from mutating the shared cache.
    
    """
    now = time.time()
    vkey = _current_vault_key()
    with _id_title_lock:
        entry = _id_title_cache.get(vkey)
        idx = entry.get("index") if entry else None
        ts = entry.get("ts", 0.0) if entry else 0.0
    if idx is not None:
        if (now - ts) >= _ID_TITLE_TTL:
            _refresh_id_title_index(vkey)
        return dict(idx)

    # No in-memory cache → try disk (instant after a restart).
    if _load_id_title_from_disk(vkey):
        _refresh_id_title_index(vkey)
        with _id_title_lock:
            entry = _id_title_cache.get(vkey)
            cur = entry.get("index") if entry else None
        return dict(cur) if cur else {}

    # Neither memory nor disk → synchronous computation (only the very first time ever).
    idx = _compute_id_title_index()
    with _id_title_lock:
        _id_title_cache[vkey] = {"index": idx, "ts": time.time()}
    _save_id_title_to_disk(vkey, idx)
    return dict(idx)


# TTL cache for `_iter_linkable_page_documents`. Every call used to iterate
# 3000+ files on OneDrive (rglob + read_text + parse_frontmatter), taking
# 30+ seconds on slow mounts. The /backlinks and /unlinked-mentions endpoints
# are called at the same time when loading a page, doubling the load and timing out
# on the frontend (axios.defaults.timeout = 30s). With a 60s TTL we reuse the
# list between consecutive calls. The backlinks remain slightly
# out of date (60s) — acceptable for this use case.
_iter_docs_cache: dict = {}   # v_str -> {"docs": [...], "ts": float} (per-vault)
_iter_docs_lock = threading.Lock()
_ITER_DOCS_TTL = 60.0

# Cache of markdown bodies indexed by path → (mtime_ns, body). Independent of the
# TTL for the list: this cache only invalidates when the file changes. This way
# the first invocation of /backlinks after the TTL does not force re-reading 3988
# files; only the ones that changed. New files (not yet cached) are
# are read once and incorporated.
#
# **Disk persistence**: this cache is saved periodically to
# `/app/data/cache/vault_body_cache.json` so that when the backend restarts
# (and autoreloads in dev mode) there's no need to reread ~3500 OneDrive files
# to rebuild it (measured cost: 80-140 s the first time). In the
# at startup, it loads from disk and mtimes are validated to discard
# stale entries quickly — without having to pay for the read.
_body_cache: Dict[str, tuple[int, str]] = {}
_body_cache_lock = threading.Lock()
_BODY_CACHE_PERSIST_PENDING = False
_BODY_CACHE_PERSIST_DEBOUNCE = 10.0  # seconds
_body_cache_persist_lock = threading.Lock()


def _get_body_cache_path() -> Optional[Path]:
    """Local path where the body cache is persisted. Same pattern as page-index."""
    base = get_p("PAGE_INDEX_CACHE")
    if base:
        return base.parent / "vault_body_cache.json"
    return resolve_data_dir() / "cache" / "vault_body_cache.json"


def _save_body_cache_to_disk() -> None:
    """Persists the body cache to disk. Called under lock for a consistent
    snapshot. Typical size: 3500 × ~3KB body = ~10MB JSON."""
    try:
        cache_path = _get_body_cache_path()
        if not cache_path:
            return
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with _body_cache_lock:
            payload = {
                path: {"mtime_ns": mt, "body": bd}
                for path, (mt, bd) in _body_cache.items()
            }
        safe_write_json(cache_path, payload, indent=None, ensure_ascii=False)
        log.info(f"💾 Body cache saved ({len(payload)} files)")
    except Exception as e:
        log.warning(f"body-cache persist failed: {e}")


def _schedule_body_cache_persist() -> None:
    """Debounce persist: individual invalidations trigger a save to disk
    at most every `_BODY_CACHE_PERSIST_DEBOUNCE` seconds."""
    global _BODY_CACHE_PERSIST_PENDING
    with _body_cache_persist_lock:
        if _BODY_CACHE_PERSIST_PENDING:
            return
        _BODY_CACHE_PERSIST_PENDING = True

    def _run():
        global _BODY_CACHE_PERSIST_PENDING
        time.sleep(_BODY_CACHE_PERSIST_DEBOUNCE)
        try:
            _save_body_cache_to_disk()
        except Exception:
            pass
        finally:
            with _body_cache_persist_lock:
                _BODY_CACHE_PERSIST_PENDING = False

    threading.Thread(target=_run, daemon=True, name="body-cache-persist").start()


def _load_body_cache_from_disk() -> bool:
    """Loads the saved body cache. Returns True if it was useful. It does not
    validate mtimes here — that is done in `_get_body_for_path` for each
    entry queried (amortized cost)."""
    try:
        cache_path = _get_body_cache_path()
        if not cache_path or not cache_path.exists():
            return False
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        with _body_cache_lock:
            _body_cache.clear()
            for path, val in data.items():
                if isinstance(val, dict):
                    mt = val.get("mtime_ns") or 0
                    bd = val.get("body") or ""
                    if mt and bd:
                        _body_cache[path] = (mt, bd)
        log.info(f"📂 Body cache loaded from disk ({len(_body_cache)} files)")
        return True
    except Exception as e:
        log.warning(f"body-cache load failed: {e}")
        return False

# TTL for the stale-path check in `_get_pages_snapshot`. Each `Path.exists()`
# call on OneDrive takes ~10ms — multiplied by 3988 entries that's 40s. We limit
# this cleanup to run only every 10 min: at 30s, consecutive reloads
# of embedded feeds would trigger 4000 stat() calls every time the feed re-renders
# (every navigation between views). 10 min is more than enough: files
# rarely disappear outside the app's own flow, and the
# `find_page_path` code already invalidates stale entries individually when it detects them.
_last_stale_check = page_state.last_stale_check
_STALE_CHECK_TTL = 600.0


def _get_body_for_path(file_path: Path) -> str:
    """Returns the body of an .md file, taking advantage of a cache with mtime-based invalidation.

    We iterate over ALL the Vault's .md files for /backlinks and /unlinked-mentions.
    We do NOT retry on Errno 35: with 3988 files, if N return a deadlock
    in parallel, retrying × N dramatically worsens the iteration (60+
    seconds instead of 5). We skip the file; the next invocation of
    /backlinks (once the TTL expires) will try again and pick up the ones that were missing.
    If a file fails repeatedly, its backlinks are left out of the
    result — acceptable gradual degradation.
    
    """
    path_str = str(file_path)
    try:
        mtime_ns = file_path.stat().st_mtime_ns
    except OSError:
        return ""

    with _body_cache_lock:
        cached = _body_cache.get(path_str)
        if cached and cached[0] == mtime_ns:
            return cached[1]

    try:
        raw_content = file_path.read_text(encoding="utf-8")
    except OSError as e:
        if e.errno == 35:
            # Silent Errno 35 (deadlock) — log.debug instead of warning
            # so as not to flood the logs with 3988 messages during OneDrive sync.
            log.debug(f"Body skip (Errno 35): {file_path.name}")
        else:
            log.warning(f"Error reading body of {file_path.name}: {e}")
        return ""
    except Exception as e:
        log.warning(f"Error reading body of {file_path.name}: {e}")
        return ""

    with _body_cache_lock:
        _body_cache[path_str] = (mtime_ns, raw_content)
    _schedule_body_cache_persist()
    return raw_content


# Cache of PARSED documents indexed by path → (mtime_ns, metadata, body).
# `_body_cache` only spares the READ; `parse_frontmatter` still ran for every
# file on each `_ITER_DOCS_TTL` rebuild, so a rebuild cost ~18s on the real
# vault and pushed a cold /unlinked-mentions past the frontend's 30s axios
# timeout (`[load-unlinked-mentions] timeout of 30000ms exceeded`). Keyed by
# mtime, a rebuild is now O(stat) per unchanged file instead of O(parse).
#
# **Disk persistence**: mirrors `_body_cache`. Without it every backend restart
# (and every autoreload in dev) paid the full re-parse on the first request.
_parsed_doc_cache: Dict[str, tuple[int, Dict[str, Any], str]] = {}
_parsed_doc_lock = threading.Lock()
_PARSED_DOC_PERSIST_PENDING = False
_PARSED_DOC_PERSIST_DEBOUNCE = 10.0  # seconds
_parsed_doc_persist_lock = threading.Lock()


def _get_parsed_doc_cache_path() -> Optional[Path]:
    """Local path where the parsed-document cache is persisted."""
    base = get_p("PAGE_INDEX_CACHE")
    if base:
        return base.parent / "vault_parsed_doc_cache.json"
    return resolve_data_dir() / "cache" / "vault_parsed_doc_cache.json"


def _save_parsed_doc_cache_to_disk() -> None:
    """Persists the parsed-document cache to disk.

    Entries whose metadata is not JSON-serializable are skipped rather than
    aborting the whole save: YAML can yield dates/objects that json rejects, and
    one odd page must not cost every other page its cached parse. A skipped
    entry is simply re-parsed after the next restart.
    """
    try:
        cache_path = _get_parsed_doc_cache_path()
        if not cache_path:
            return
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        with _parsed_doc_lock:
            snapshot = list(_parsed_doc_cache.items())
        payload = {}
        skipped = 0
        for path, (mtime_ns, metadata, body) in snapshot:
            try:
                json.dumps(metadata, allow_nan=False)
            except (TypeError, ValueError):
                skipped += 1
                continue
            payload[path] = {"mtime_ns": mtime_ns, "metadata": metadata, "body": body}
        safe_write_json(cache_path, payload, indent=None, ensure_ascii=False)
        suffix = f", {skipped} skipped" if skipped else ""
        log.info(f"💾 Parsed-document cache saved ({len(payload)} files{suffix})")
    except Exception as e:
        log.warning(f"parsed-doc-cache save failed: {e}")


def _schedule_parsed_doc_cache_persist() -> None:
    """Debounce persist, mirroring `_schedule_body_cache_persist`."""
    global _PARSED_DOC_PERSIST_PENDING
    with _parsed_doc_persist_lock:
        if _PARSED_DOC_PERSIST_PENDING:
            return
        _PARSED_DOC_PERSIST_PENDING = True

    def _run():
        global _PARSED_DOC_PERSIST_PENDING
        time.sleep(_PARSED_DOC_PERSIST_DEBOUNCE)
        try:
            _save_parsed_doc_cache_to_disk()
        except Exception:
            pass
        finally:
            with _parsed_doc_persist_lock:
                _PARSED_DOC_PERSIST_PENDING = False

    threading.Thread(target=_run, daemon=True, name="parsed-doc-cache-persist").start()


def _load_parsed_doc_cache_from_disk() -> bool:
    """Loads the saved parsed-document cache. Mtimes are not validated here —
    `_get_parsed_document` does it per entry queried (amortized cost)."""
    try:
        cache_path = _get_parsed_doc_cache_path()
        if not cache_path or not cache_path.exists():
            return False
        data = json.loads(cache_path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return False
        with _parsed_doc_lock:
            _parsed_doc_cache.clear()
            for path, val in data.items():
                if not isinstance(val, dict):
                    continue
                mt = val.get("mtime_ns") or 0
                metadata = val.get("metadata")
                body = val.get("body") or ""
                if mt and isinstance(metadata, dict):
                    _parsed_doc_cache[path] = (mt, metadata, body)
        log.info(
            f"📂 Parsed-document cache loaded from disk ({len(_parsed_doc_cache)} files)"
        )
        return True
    except Exception as e:
        log.warning(f"parsed-doc-cache load failed: {e}")
        return False


def _get_parsed_document(file_path: Path) -> Optional[tuple[Dict[str, Any], str]]:
    """Returns (metadata, body) for an .md file, memoized by mtime.

    Returns None when the file is unreadable or empty, mirroring the behaviour
    `_iter_linkable_page_documents` had when `_get_body_for_path` returned "".
    """
    path_str = str(file_path)
    try:
        mtime_ns = file_path.stat().st_mtime_ns
    except OSError:
        return None

    with _parsed_doc_lock:
        cached = _parsed_doc_cache.get(path_str)
        if cached and cached[0] == mtime_ns:
            return cached[1], cached[2]

    raw_content = _get_body_for_path(file_path)
    if not raw_content:
        return None

    metadata, body = parse_frontmatter(raw_content, file_path)

    with _parsed_doc_lock:
        _parsed_doc_cache[path_str] = (mtime_ns, metadata, body)
    _schedule_parsed_doc_cache_persist()
    return metadata, body


def _iter_linkable_page_documents() -> List[tuple[Path, Dict[str, Any], str, bool]]:
    """Yields page documents as (path, metadata, body, is_dashboard).

    Cached per `_ITER_DOCS_TTL` seconds. When the list cache expires,
    individual bodies are not re-read if their mtime has not changed
    (see `_get_body_for_path`). So the 2nd/3rd/Nth invocation is O(stat()) per
    file instead of O(read).
    
    """
    now = time.time()
    vkey = _current_vault_key()
    entry = _iter_docs_cache.get(vkey)
    cached = entry.get("docs") if entry else None
    cached_ts = entry.get("ts", 0.0) if entry else 0.0
    if cached is not None and (now - cached_ts) < _ITER_DOCS_TTL:
        return cached

    with _iter_docs_lock:
        # Re-check under lock to avoid two concurrent builds
        entry = _iter_docs_cache.get(vkey)
        cached = entry.get("docs") if entry else None
        cached_ts = entry.get("ts", 0.0) if entry else 0.0
        if cached is not None and (time.time() - cached_ts) < _ITER_DOCS_TTL:
            return cached

        docs: List[tuple[Path, Dict[str, Any], str, bool]] = []

        # We use PathResolver (cache pre-warmed at startup) for the list of
        # files, avoiding a slow rglob on OneDrive. If the cache is not yet
        # ready, list_all_files falls back to rglob.
        vault_path = get_p("VAULT")
        if vault_path and vault_path.exists():
            try:
                from backend.services.path_resolver import path_resolver
                all_files = path_resolver.list_all_files(vault_path)
            except Exception:
                all_files = list(vault_path.rglob("*.md"))

            for file_path in all_files:
                # Skip version snapshots (.history) and soft-deleted pages
                # (.trash): trashed pages must not appear in the global
                # id→title index — otherwise they show up in the `[[`
                # wikilink autocomplete until they are purged.
                if ".history" in file_path.parts or ".trash" in file_path.parts:
                    continue
                try:
                    parsed = _get_parsed_document(file_path)
                    if parsed is None:
                        continue
                    metadata, body = parsed
                    docs.append((file_path, metadata, body, False))
                except Exception as e:
                    log.warning(f"Error parsing linkable page {file_path.name}: {e}")

        if get_p("DASHBOARDS") and get_p("DASHBOARDS").exists():
            for file_path in get_p("DASHBOARDS").rglob("*.json"):
                try:
                    metadata, body = _read_dashboard_file(file_path)
                    docs.append((file_path, metadata, body, True))
                except Exception as e:
                    log.warning(f"Error parsing dashboard page {file_path.name}: {e}")

        _iter_docs_cache[vkey] = {"docs": docs, "ts": time.time()}
        return docs


def _read_parsed_doc_cache_snapshot():
    with _parsed_doc_lock:
        return dict(_parsed_doc_cache)


def _build_alias_index():
    v_path = get_active_vault_path()
    if not v_path:
        return {}
    v_str = str(v_path)
    out: dict[str, list[str]] = {}
    with _page_index_lock:
        for entry in list(_page_index_entries.get(v_str, {}).values()):
            meta = entry.get("metadata") or {}
            aliases = normalize_aliases(meta.get("aliases"))
            if aliases:
                pid = entry.get("id")
                if pid:
                    out[str(pid)] = aliases
    return out


_LINK_INDEX_DEPENDENCIES = link_index_service.LinkIndexDependencies(
    get_cache_path=lambda: _get_link_index_cache_path(),
    write_json=safe_write_json,
    iter_documents=_iter_linkable_page_documents,
    current_vault_key=_current_vault_key,
    get_body=_get_body_for_path,
    is_dashboard=_is_dashboard_file_path,
    read_dashboard=_read_dashboard_file,
    parse_frontmatter=parse_frontmatter,
    write_text=safe_write_text,
)

_LINK_API_DEPENDENCIES = LinkApiDependencies(
    read_state=_link_index_view,
    build_id_title_index=build_id_title_index,
    build_alias_index=_build_alias_index,
    get_cache_path=lambda: _get_link_index_cache_path(),
    resolve_kickoff_rebuild=lambda: globals()["kickoff_link_index_rebuild"],
    iter_documents=_iter_linkable_page_documents,
    find_page=lambda page_id: find_page_path(page_id),
    is_dashboard=_is_dashboard_file_path,
    read_dashboard=_read_dashboard_file,
    parse_frontmatter=parse_frontmatter,
    resolve_create_page_version=lambda: globals()["_create_page_version"],
    write_dashboard=_write_dashboard_file,
    save_page=save_page_md,
    resolve_update_index=lambda: globals()["update_link_index_for_page"],
    is_safe_external_url=_is_safe_external_url,
    build_browser_path=canonical_vault_browser_path,
)


# ── Inverted wikilinks/backlinks index (in-memory) ─────────────────────────
# Veure: docs/dev_memory/directives/wiki_inverse_link_index.md
#
# Motivation: /backlinks and /unlinked-mentions used to iterate over 4000 files on every
# call. Even with the body cache, the regex per source × N files made
# a page load take 30-60s the first time. With this index,
# /backlinks is O(lookup) and /unlinked-mentions filters down to ~10-100 candidates.
# Per source: {ref -> "link" | "relation"}. Classifies each outgoing ref by ORIGIN:
# body wikilinks/md-links → "link"; metadata (relation-ish) fields → "relation".
# "relation" wins over "link" when a ref appears in both (mirrors the graph, which
# adds metadata-relation edges before body-link edges). Lets the panel and the graph
# agree on what is a wiki-link vs a schema relation. See
# feedback_links_panel_vs_graph_divergence.
def _get_link_index_cache_path() -> Optional[Path]:
    return link_index_service.resolve_link_index_cache_path(
        get_p("LINK_INDEX_CACHE"),
        resolve_data_dir(),
    )


def _save_link_index_to_disk() -> None:
    link_index_service.save_link_index(link_index_state, _LINK_INDEX_DEPENDENCIES)


def _load_link_index_from_disk() -> bool:
    return link_index_service.load_link_index(
        link_index_state,
        _LINK_INDEX_DEPENDENCIES,
    )


def get_link_index_terms(
    page_ids: Iterable[str],
) -> tuple[Dict[str, tuple[frozenset, frozenset]], float]:
    return link_index_service.get_link_index_terms(
        page_ids,
        _link_index_view,
        _load_link_index_from_disk,
    )


def get_agent_index_freshness(
    *,
    requested_count: int,
    covered_count: int,
    direct_reads: int,
    stale_after_seconds: int = 1_800,
) -> Dict[str, Any]:
    return link_index_service.get_agent_index_freshness(
        requested_count=requested_count,
        covered_count=covered_count,
        direct_reads=direct_reads,
        stale_after_seconds=stale_after_seconds,
        read_view=_link_index_view,
        load_index=_load_link_index_from_disk,
        current_vault_key=_current_vault_key,
        kickoff_rebuild=kickoff_link_index_rebuild,
    )


def get_cached_document_texts(paths: Iterable[str]) -> Dict[str, str]:
    return link_index_service.get_cached_document_texts(
        paths,
        ensure_loaded=_load_parsed_doc_cache_from_disk,
        read_cache=_read_parsed_doc_cache_snapshot,
    )


def _normalize_ref_for_index(raw_ref: str) -> str:
    return link_parsing.normalize_ref(raw_ref)


def _extract_outlinks_with_kinds(metadata: Dict[str, Any], body: str) -> tuple:
    return link_parsing.extract_outlinks_with_kinds(metadata, body)


def _extract_outlinks_from_doc(metadata: Dict[str, Any], body: str) -> set:
    return link_parsing.extract_outlinks(metadata, body)


def _tokenize_body_for_mentions(body: str) -> frozenset:
    return link_parsing.tokenize_body(body)


def _resolve_page_id_from_metadata(metadata: Dict[str, Any], file_path: Path) -> str:
    return link_parsing.resolve_page_id(metadata, file_path)


def _rebuild_backlinks_invertion_locked():
    link_index_service.rebuild_backlinks_locked(link_index_state)


def _rebuild_link_index(persist: bool = True) -> None:
    link_index_service.rebuild_link_index(
        link_index_state,
        _LINK_INDEX_DEPENDENCIES,
        persist=persist,
    )


# Debounced persist: occasional invalidations (writes) trigger a save to disk,
# but doing it synchronously on every PUT would be expensive. We accumulate and save at
# most every N seconds from a separate thread.
def _schedule_link_index_persist() -> None:
    link_index_service.schedule_link_index_persist(
        link_index_state,
        _LINK_INDEX_DEPENDENCIES,
    )


def kickoff_link_index_rebuild() -> None:
    link_index_service.kickoff_link_index_rebuild(
        link_index_state,
        _LINK_INDEX_DEPENDENCIES,
    )


def update_link_index_for_page(file_path: Path) -> None:
    link_index_service.update_link_index_for_page(
        file_path,
        link_index_state,
        _LINK_INDEX_DEPENDENCIES,
    )


# ---------------------------------------------------------------------------
# Bidirectional synchronization of relations (direct ↔ inverse)
# When a page changes a relation field, the INVERSE field on the other side
# is updated, or else embedded views (which filter by the inverse) come out
# empty. See docs/dev_memory/directives/vault_relation_inverse_sync.md
# ---------------------------------------------------------------------------

def _inverse_relation_frontmatter_key(md: dict, inverse_name: str) -> str:
    """REAL frontmatter key for the inverse field: reuses the one that already exists
    (for normalization, e.g. an old variant of the name) or, if there is none,
    the registry name. Avoids creating a duplicate key that views would not
    see."""
    from backend.services.relation_sync import _norm
    if inverse_name in md:
        return inverse_name
    nk = _norm(inverse_name)
    for k in list(md.keys()):
        if isinstance(k, str) and _norm(k) == nk:
            return k
    return inverse_name


def _apply_inverse_relation_change(
    target_id: str, inverse_name: str, host_id: str, op: str
) -> bool:
    """Adds/removes `host_id` in the inverse field of page `target_id`. Writes via
    `save_page_md` (decorates `id→[[Title|id]]` and canonicalizes the key). Idempotent:
    does not write if it is already in the desired state. Writing directly (not via the endpoint)
    avoids re-triggering the propagation → no recursion. Returns True if it wrote."""
    from backend.services.relation_sync import to_ids
    fp = find_page_path(target_id)
    if not fp or not fp.exists():
        return False
    raw = fp.read_text(encoding="utf-8")
    md, body = parse_frontmatter(raw, fp)
    key = _inverse_relation_frontmatter_key(md, inverse_name)
    cur = to_ids(md.get(key))
    if op == "add":
        if host_id in cur:
            return False
        md[key] = cur + [host_id]
    elif op == "remove":
        if host_id not in cur:
            return False
        md[key] = [x for x in cur if x != host_id]
    else:
        return False
    save_page_md(fp, md, body)
    try:
        update_link_index_for_page(fp)
    except Exception as e:
        log.debug(f"relation sync: link-index update failed for {target_id}: {e}")
    try:
        from backend.services.context_vars import get_active_vault_path
        v_path = get_active_vault_path()
        if v_path:
            v_str = str(v_path)
            entry = _build_page_cache_entry(fp, fp.stat())
            with _page_index_lock:
                _page_index_entries.setdefault(v_str, {})[str(fp)] = entry
                eid = entry.get("id")
                if eid:
                    _page_id_to_path.setdefault(v_str, {})[eid] = str(fp)
                _bump_page_index_version(v_str)
    except Exception as e:
        log.debug(f"relation sync: cache update failed for {target_id}: {e}")
    return True


def _propagate_relation_inverse(
    page_id: str, table_id: Optional[str], old_meta: dict, new_meta: dict
) -> None:
    """Propagates a page's relation field changes to the INVERSE field of
    the pages on the other side. Defensive: never blocks the caller nor propagates in a
    loop. Meant to run as a background task from PATCH/POST."""
    try:
        if not table_id:
            return
        from backend.services.relation_sync import relation_changes
        origin = _table_by_id(table_id)
        if not origin:
            return
        changes = relation_changes(old_meta, new_meta, origin, _table_by_id)
        if not changes:
            return
        wrote = False
        for target_id, inverse_name, op in changes:
            if not target_id or target_id == page_id:
                continue  # defensive self-reference
            try:
                wrote = _apply_inverse_relation_change(
                    target_id, inverse_name, page_id, op
                ) or wrote
            except Exception as e:
                log.debug(f"relation sync target {target_id} ({op}) failed: {e}")
        if wrote:
            _pages_cache_invalidate_all()
    except Exception as e:
        log.debug(f"relation inverse propagation failed for {page_id}: {e}")


def remove_from_link_index(page_id: str) -> None:
    link_index_service.remove_from_link_index(
        page_id,
        link_index_state,
        _LINK_INDEX_DEPENDENCIES,
    )


def rewrite_wikilinks_on_title_change(
    target_id: str, old_title: str, new_title: str
) -> int:
    return link_index_service.rewrite_wikilinks_on_title_change(
        target_id,
        old_title,
        new_title,
        link_index_state,
        _LINK_INDEX_DEPENDENCIES,
        update_link_index_for_page,
    )


get_global_index, get_alias_index = link_overview_api.register_routes(
    router,
    _LINK_API_DEPENDENCIES,
)
get_link_preview = link_preview_api.register_route(
    router,
    _LINK_API_DEPENDENCIES,
)


def register_page_in_index(file_path: Path) -> None:
    """Inserts/updates in the in-memory page-index a page that was just written
    to disk, so it appears IMMEDIATELY in /pages (without waiting for the rebuild) and
    is deletable by id. Used by the importer, the web clipper, and the
    public API, which write .md files directly (not via the /pages flow)."""
    try:
        v = get_active_vault_path()
        if not v:
            return
        entry = _build_page_cache_entry(Path(file_path), Path(file_path).stat())
        if not entry:
            return
        with _page_index_lock:
            _page_index_entries.setdefault(str(v), {})[str(file_path)] = entry
        _bump_page_index_version(str(v))
    except Exception as e:
        log.warning(f"register_page_in_index failed for {file_path}: {e}")


class ImportFile(BaseModel):
    name: str
    content: str


class ImportRequest(BaseModel):
    files: list[ImportFile]
    folder: str = "Importades"


@router.post("/import", dependencies=[Depends(require_role("editor"))])
async def import_markdown(body: ImportRequest):
    """Imports Markdown/Obsidian files into the vault (importer style with UI).

    Each file is created as a page inside `folder`. Existing frontmatter is preserved
    (an `id` is added if it doesn't have one) and the body as-is: wikilinks
    `[[…]]`, `#…` tags, and Obsidian frontmatter are already compatible with Gnosi.
    Returns the count of imported files and the errors per file.
    """
    import yaml as _yaml
    from backend.services.context_vars import get_active_vault_path
    vault = get_active_vault_path()
    if not vault:
        raise HTTPException(status_code=503, detail="No hi ha cap vault actiu")
    folder = sanitize_rel_folder(body.folder, fallback="Importades")
    target_dir = Path(vault) / folder
    target_dir.mkdir(parents=True, exist_ok=True)

    imported = 0
    errors = []
    for f in body.files:
        try:
            stem = Path(f.name).stem or "Sense títol"
            raw = f.content or ""
            meta, body_md = parse_frontmatter(raw)
            if not isinstance(meta, dict):
                meta = {}
            if body_md is None:
                body_md = raw
            meta.setdefault("title", meta.get("title") or stem)
            if not meta.get("id"):
                meta["id"] = str(uuid.uuid4())
            safe = sanitize_vault_title(stem)
            path = target_dir / f"{safe}.md"
            if path.exists():
                path = target_dir / f"{safe} {meta['id'][:8]}.md"
            fm = _yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
            path.write_text(f"---\n{fm}\n---\n\n{str(body_md).lstrip()}\n", encoding="utf-8")
            register_page_in_index(path)  # It appears in /pages immediately.
            imported += 1
        except Exception as e:
            errors.append({"name": f.name, "error": str(e)})

    return {"imported": imported, "errors": errors, "folder": folder}


# ───────────────── Inline comments (anchored to a selection) ─────────────────
# Google Docs / Notion style: a comment anchored to a fragment of text from a
# page. They are stored vault-first in `.gnosi/inline_comments/<page_id>.json`
# (separate from the .md body because they are derived metadata, not editable content).

def _inline_comments_path(page_id: str) -> Path:
    return comments_repository.inline_comments_path(page_id, get_active_vault_path)


def _load_inline_comments(page_id: str) -> list:
    return comments_repository.load_inline_comments(_inline_comments_path, page_id)


(
    list_inline_comments,
    create_inline_comment,
    update_inline_comment,
    delete_inline_comment,
) = comments_api.register_inline_comment_routes(
    router,
    post_dependencies=[Depends(require_role("editor"))],
    patch_dependencies=[Depends(require_role("editor"))],
    delete_dependencies=[Depends(require_role("editor"))],
    workspace_context_dependency=get_workspace_context,
    dependencies=_COMMENTS_DEPENDENCIES,
)


# In-memory pub/sub for REAL-TIME synchronization of synced blocks
# across devices/clients: each client opens an SSE at /synced-events and, when
# a block is saved (PUT /synced), all receive the notification and reload the source.
# Multi-vault: each subscriber carries its vault (v_str) and the broadcast
# ONLY notifies clients of the SAME vault. Without this, saving a block in one vault
# would wake up clients of ALL vaults (cross-vault noise and unnecessary
# re-reads; sync_ids can collide across vaults). The client's vault
# arrives via the `gnosi_active_vault` cookie, which now also travels with the SSE.
_synced_subscribers: dict = {}   # asyncio.Queue -> v_str


def _broadcast_synced(sync_id: str, v_str: str) -> None:
    """Notifies SSE subscribers OF VAULT `v_str` that a synced block has changed."""
    for q, qv in list(_synced_subscribers.items()):
        if qv != v_str:
            continue
        try:
            q.put_nowait(sync_id)
        except Exception:
            pass


def _synced_block_path(sync_id: str) -> Path:
    vault = get_active_vault_path()
    if not vault:
        raise HTTPException(status_code=503, detail="No hi ha cap vault actiu")
    safe = re.sub(r"[^\w\-]", "", str(sync_id))[:80]
    if not safe:
        raise HTTPException(status_code=400, detail="sync_id invàlid")
    d = Path(vault) / ".gnosi" / "synced"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{safe}.md"


@router.get("/synced-events")
async def synced_events():
    """SSE: notifies REAL-TIME changes of synced blocks to all connected
    clients (any device). The frontend subscribes to it with EventSource
    and reloads the source of the affected block."""
    from fastapi.responses import StreamingResponse
    queue: asyncio.Queue = asyncio.Queue()
    # Subscriber's vault (set by the middleware from the cookie/header);
    # the broadcast only notifies those in the same vault.
    _synced_subscribers[queue] = _current_vault_key()

    async def gen():
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                try:
                    sync_id = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {json.dumps({'syncId': sync_id})}\n\n"
                except asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"  # heartbeat
        except asyncio.CancelledError:
            raise
        finally:
            _synced_subscribers.pop(queue, None)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/synced/{sync_id}")
async def get_synced_block(sync_id: str):
    """Content of a synced block (source shared across instances)."""
    p = _synced_block_path(sync_id)
    content = p.read_text(encoding="utf-8") if p.exists() else ""
    return {"sync_id": sync_id, "content": content}


class SyncedBlockSave(BaseModel):
    content: str = ""


@router.put("/synced/{sync_id}", dependencies=[Depends(require_role("editor"))])
async def save_synced_block(sync_id: str, body: SyncedBlockSave):
    """Saves the source of a synced block. All instances (on any
    page) that reference this `sync_id` reflect the change."""
    p = _synced_block_path(sync_id)
    p.write_text(body.content or "", encoding="utf-8")
    _broadcast_synced(sync_id, _current_vault_key())  # push SSE to clients of the same vault
    return {"sync_id": sync_id, "content": body.content or "", "saved": True}


(
    get_link_index_stats,
    post_link_index_rebuild,
    get_backlinks,
    get_outlinks,
) = link_navigation_api.register_routes(
    router,
    admin_dependencies=[Depends(require_role("admin"))],
    dependencies=_LINK_API_DEPENDENCIES,
)


def _build_unlinked_mention_regex(target_title: str) -> Optional[re.Pattern]:
    return link_parsing.build_unlinked_mention_regex(target_title)


def _strip_existing_links_for_mentions_scan(text: str) -> str:
    return link_parsing.strip_existing_links(text)


def _count_unlinked_mentions(text: str, target_title: str) -> int:
    return link_parsing.count_unlinked_mentions(text, target_title)


def _first_unlinked_mention_snippet(
    text: str, target_title: str, radius: int = 48
) -> str:
    return link_parsing.first_unlinked_mention_snippet(text, target_title, radius)


def _link_mentions_in_plain_segments(
    body: str, target_title: str, target_id: str
) -> tuple[str, int]:
    return link_parsing.link_mentions_in_plain_segments(
        body,
        target_title,
        target_id,
        canonical_vault_browser_path,
    )


get_unlinked_mentions, link_unlinked_mentions = link_mentions_api.register_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
    dependencies=_LINK_API_DEPENDENCIES,
)


# PER-VAULT registry keys (key = registry path, which depends on the active vault via get_p).
# They used to be global → in multi-vault they served another vault's registry. Now each vault has
# its cache entry.
_registry_cache = registry_state.cache
_registry_cache_mtime = registry_state.cache_mtime
_registry_cache_ts = registry_state.cache_timestamp
_registry_cache_ttl_seconds = registry_state.cache_ttl_seconds

# Tracks tables that already had _ensure_table_vault_folder called once successfully
# during this process lifetime. Avoids redundant FUSE stat() calls on every read.
_registry_ensured_tables = registry_state.ensured_tables

# Registry paths (str of get_p("REGISTRY")) this process has ever seen NON-degenerate,
# read from disk or written. A degenerate save on such a path is a deliberate mutation
# (e.g. the user deleted the last database); on a path never seen non-degenerate it is
# far more likely a misread being written back. 2026-07-14 incident: a second Mac read
# the OneDrive registry as a dataless placeholder (→ empty), reseeded the default
# structure and clobbered 16 tables / 797 views on the shared vault.
_registry_seen_nondegenerate = registry_state.seen_nondegenerate


def _registry_is_degenerate(data) -> bool:
    """True when the registry carries no database or table structure."""
    return registry_repository.is_degenerate(data)


def _degenerate_overwrite_is_risky(reg_path) -> bool:
    """Return whether an empty write could clobber an existing registry."""
    return registry_repository.degenerate_overwrite_is_risky(reg_path)

# Serializes the ENTIRE load→modify→save cycle of the central registry
# (vault_db_registry.json). Same systemic pattern as #728/#729/#743 (daily
# note, comments, plugins): without this, two concurrent mutations read the
# same snapshot and the last write clobbered the other (last-writer-wins).
# RLock and not Lock because `load_registry` calls `save_registry` when it sanitizes
# (changed=True) with the lock already held by the same thread.
_registry_mutation_lock = registry_state.mutation_lock


# Decorative emoji and their presentation/control characters. This is scoped to
# table and view labels; page titles, property values, and icons remain untouched.
_TABLE_VIEW_EMOJI_RE = re.compile(
    r"[\U0001F000-\U0001FAFF\U0001FC00-\U0001FFFD\u2122\u2139\u2300-\u23FF\u2600-\u27BF\u2B00-\u2BFF\u3030\u303D\u3297\u3299]"
)
_TABLE_VIEW_KEYCAP_RE = re.compile(r"[0-9#*]\uFE0F?\u20E3")
_TABLE_VIEW_EMOJI_CONTROL_RE = re.compile(r"[\u200D\u20E3\uFE0E\uFE0F]")
_LEGACY_MAIN_VIEW_NAMES = frozenset(
    {"main table", "taula principal", "vista principal", "tableau principal"}
)


def _normalize_table_view_name(value: object, fallback: str) -> str:
    """Return a compact table/view label without decorative emoji."""
    return registry_normalize_table_view_name(value, fallback)


def _table_name_from_registry(registry: dict, table_id: object) -> str:
    """Return the normalized display name for a table ID."""
    return registry_table_name(registry, table_id)


def _main_view_fields(registry: dict, table_id: object) -> list[str]:
    """Return the canonical visible fields for a table's main view."""
    return registry_main_view_fields(registry, table_id)


def _is_main_or_locked_view(view: dict) -> bool:
    """Return whether a view is protected as a table's main view."""
    return registry_is_main_or_locked_view(view)


def _normalize_main_view_configuration(registry: dict, view: dict) -> bool:
    """Enforce the immutable configuration of a main or locked view."""
    return registry_normalize_main_view_configuration(registry, view)

def _normalize_registry_table_view_names(registry: dict) -> bool:
    """Normalize persisted table/view labels and canonicalize main view names."""
    return registry_normalize_table_view_names(registry)


@contextmanager
def registry_mutation():
    """Wrap an entire load, modify and save registry cycle."""
    with registry_repository.mutation():
        yield


def _update_registry_cache(reg_path, data) -> None:
    """Synchronize the canonical per-vault registry cache after a write."""
    registry_repository.update_cache(reg_path, data)


def load_registry():
    """Read the central registry through its canonical repository."""
    return registry_repository.load()


def _enabled_vault_calendar_tables() -> List[str]:
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
    return page_state.last_vault_sync_time


def _set_last_vault_sync_time(value: float) -> None:
    page_state.last_vault_sync_time = value


page_index_entries.configure(
    page_index_entries.PageIndexEntryDependencies(
        parse_frontmatter=lambda content, path: parse_frontmatter(content, path),
        is_dashboard_file=lambda path: _is_dashboard_file_path(path),
        read_dashboard_file=lambda path: _read_dashboard_file(path),
        process_metadata_paths=lambda metadata: _process_metadata_paths(metadata),
        vault_root=lambda: get_p("VAULT"),
        logger=log,
    )
)

page_index_service.configure(
    page_index_service.PageIndexDependencies(
        active_vault_path=lambda: get_active_vault_path(),
        get_path=lambda name: get_p(name),
        load_from_disk=lambda vault_key: _load_page_index_from_disk(vault_key),
        save_to_disk=lambda vault_key: _save_page_index_to_disk(vault_key),
        build_entry=lambda path, stat_result: _build_page_cache_entry(
            path,
            stat_result,
        ),
        build_entry_from_memory=lambda path, stat_result, metadata, body: (
            _build_cache_entry_from_memory(path, stat_result, metadata, body)
        ),
        is_metadata_stub=lambda metadata: _is_metadata_stub(metadata),
        vault_cache_key=_vault_cache_key,
        cache_get=lambda key: _pages_cache_get(key),
        cache_set=lambda key, pages: _pages_cache_set(key, pages),
        load_registry=lambda: load_registry(),
        table_vault_dir=lambda table, registry: _table_vault_dir(table, registry),
        build_table_folder_index=lambda registry: _build_table_folder_index(registry),
        resolve_table_id=lambda metadata, folder, index, sorted_folders: (
            _resolve_table_id_from_context(
                metadata,
                folder,
                index,
                sorted_folders=sorted_folders,
            )
        ),
        enabled_calendar_tables=_enabled_vault_calendar_tables,
        hidden_event_ids=_hidden_calendar_event_ids,
        sync_calendars=_sync_vault_calendars,
        update_path_resolver=path_resolver.update_index,
        get_last_vault_sync=_get_last_vault_sync_time,
        set_last_vault_sync=_set_last_vault_sync_time,
        index_lock=_page_index_lock,
        index_entries=_page_index_entries,
        index_initialized=_page_index_initialized,
        id_to_path=_page_id_to_path,
        index_version=_page_index_version,
        body_cache_lock=_body_cache_lock,
        body_cache=_body_cache,
        last_stale_check=_last_stale_check,
        vault_sync_cooldown_seconds=_VAULT_SYNC_COOLDOWN_SECONDS,
        calendar_sync_cooldown_seconds=_GOOGLE_CALENDAR_SYNC_COOLDOWN_SECONDS,
        stale_check_ttl=_STALE_CHECK_TTL,
        logger=log,
    )
)

page_resolver.configure(
    page_resolver.PageResolverDependencies(
        active_vault_path=lambda: get_active_vault_path(),
        get_path=lambda name: get_p(name),
        path_factory=lambda value: Path(value),
        parse_frontmatter=lambda content, path: parse_frontmatter(content, path),
        canonicalize_id=lambda value: _canonicalize_id(value),
        bump_index_version=lambda vault_key: _bump_page_index_version(vault_key),
        set_last_vault_sync=_set_last_vault_sync_time,
        monotonic=lambda: time.monotonic(),
        stale_check_ttl=_STALE_CHECK_TTL,
        last_stale_check=_last_stale_check,
        index_lock=_page_index_lock,
        index_entries=_page_index_entries,
        index_initialized=_page_index_initialized,
        id_to_path=_page_id_to_path,
        logger=log,
    )
)


def _load_registry_from_disk(registry_path, _ck: str, now: float):
    """Read and normalize a registry while holding the mutation lock."""
    return registry_repository.load_from_disk(registry_path, _ck, now)


def save_registry(data):
    """Persist the registry through its canonical repository."""
    registry_repository.save(data)


# ensure_default_registry_structure() # Disabled: initialized dynamically per workspace


def _sort_key_name(item):
    """Sort by explicit order, then accent-insensitive display name."""
    return registry_sort_key_name(item)


_HOST_OPEN_HELPER_URL = (
    os.environ.get("GNOSI_HOST_OPEN_HELPER_URL")
    or default_host_helper_url("/open")
)

_HOST_TRASH_HELPER_URL = os.environ.get(
    "GNOSI_HOST_TRASH_HELPER_URL",
    _HOST_OPEN_HELPER_URL.rsplit("/", 1)[0] + "/trash",
)


def _try_host_trash_helper(target: str, timeout: float = 20.0) -> "tuple[bool, str]":
    return file_host_trash.try_host_trash_helper(
        target,
        timeout,
        helper_url=_HOST_TRASH_HELPER_URL,
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
        import urllib.request
        import urllib.error
        req = urllib.request.Request(
            _HOST_OPEN_HELPER_URL,
            data=json.dumps({"path": target}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
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
        os.startfile(target)  # type: ignore[attr-defined]
        return
    subprocess.Popen(["xdg-open", target])


def _extract_attachment_paths(attachments: object) -> List[str]:
    """Extract candidate file paths from heterogeneous attachment values."""
    if attachments is None:
        return []

    raw_values: List[str] = []
    if isinstance(attachments, list):
        raw_values = [str(v).strip() for v in attachments if str(v).strip()]
    elif isinstance(attachments, str):
        text = attachments.strip()
        if not text:
            return []
        parts = re.split(r"[\n;,]", text)
        raw_values = [p.strip() for p in parts if p.strip()]

    candidates: List[str] = []
    for item in raw_values:
        match = re.search(r"\(([^)]+)\)", item)
        if match:
            item = match.group(1).strip()

        if item.startswith("file://"):
            item = urllib.parse.unquote(item[7:])

        # `~` always against the HOST's HOME (inside Docker, expanduser → /root).
        expanded = str(Path(_expand_host_tilde(item)).expanduser())
        candidates.append(expanded)

    return candidates


def _pick_existing_path(
    file_path: Optional[str], attachments: Optional[object]
) -> Optional[str]:
    candidates: List[str] = []

    if isinstance(file_path, str) and file_path.strip():
        fp = file_path.strip()
        # Same cleanup as _extract_attachment_paths: if the saved value is a
        # file:// URL-encoded, strip the scheme and decode BEFORE turning into a Path
        # (Path would collapse "//"→"/" and the re-rooter would no longer recognize it).
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

    # Portability across machines: no candidate exists as-is (e.g.,
    # the link comes from a Mac with a different macOS user). Tries to re-root them
    # under this machine before giving up.
    for candidate in candidates:
        rerooted = _reroot_attachment_under_current_host(candidate)
        if rerooted is not None and rerooted.is_file():
            return str(rerooted)

    return None


@router.get("/registry")
async def get_registry():
    """Returns the full registry of databases, tables, and views (sorted alphabetically)."""
    return await registry_api.get_registry(registry_api_dependencies)


@router.post("/registry", dependencies=[Depends(require_role("admin"))])
async def update_registry(data: dict = Body(...)):
    """Updates the entire registry (use with care).

    Auth: admin-only. Overwrites the ENTIRE registry at once, so an
    error or an attacker with a lower role could destroy all
    databases/tables/views of a workspace in a single call.
    
    """
    return await registry_api.update_registry(data, registry_api_dependencies)


@router.post("/open-resource", dependencies=[Depends(require_role("editor"))])
async def open_resource(payload: OpenResourceRequest):
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
            raise HTTPException(
                status_code=500, detail=f"Could not open Zotero URI: {e}"
            )

    existing_path = _pick_existing_path(payload.file_path, payload.attachments)
    if not existing_path:
        raise HTTPException(
            status_code=404, detail="No valid local attachment found"
        )

    try:
        _safe_open_target(existing_path)
        return {"status": "ok", "opened_with": "file_path", "target": existing_path}
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Could not open local file: {e}"
        )


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
        b = get_p("LIBRARY")
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


def _reroot_attachment_under_current_host(raw: str) -> Optional[Path]:
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
    s = (raw or "").strip()
    # (1) Served relative form (new library attachments, already portable). It's tried
    # against ALL roots (inside the vault and legacy), like serve_library_file does.
    m_rel = re.match(r"^/api/vault/library/(.+)$", s)
    if m_rel:
        try:
            from backend.services.context_vars import get_active_vault_path
            rel = urllib.parse.unquote(m_rel.group(1))
            for _broot in _library_roots(get_active_vault_path()):
                cand = _broot / rel
                if cand.exists():
                    return cand
        except Exception:
            return None
        return None
    if s.lower().startswith("file://"):
        rest = s[7:]
        s = urllib.parse.unquote(rest if rest.startswith("/") else "//" + rest)
    # Portable form `~/<rel>`: fully determined by the host's HOME
    # (the other strategies don't help here).
    if s == "~" or s.startswith("~/"):
        cand = Path(_expand_host_tilde(s))
        return cand if cand.exists() else None
    try:
        # Cloud root (e.g. `.../OneDrive-UNED`) in HOST path: the grandparent of the
        # active vault (…/OneDrive-UNED/Gnosi/<vault>). Derived from the host env —
        # not of get_active_vault_path(), which inside Docker would return /vault(s).
        # (It used to anchor to the LEGACY sibling Library; the Library now lives
        # INSIDE the vault and no longer serves as a cloud anchor.)
        _vrh = (os.environ.get("VAULTS_ROOT_HOST_PATH") or "").strip()
        if _vrh:
            cloud_root = Path(_vrh).parent          # …/Gnosi → …/OneDrive-UNED
        else:
            _vh = (os.environ.get("VAULT_HOST_PATH") or "").strip()
            if _vh:
                cloud_root = Path(_vh).parent.parent  # …/Gnosi/<vault> → …/OneDrive-UNED
            else:
                from backend.services.context_vars import get_active_vault_path
                cloud_root = get_active_vault_path().parent.parent
    except Exception:
        return None

    candidates: List[Path] = []

    # (2) Re-root under the cloud root via the sibling folder. rfind: anchors
    # at the LAST occurrence (if the name repeats, we take the segment closest to
    # the real root; find would calculate an incorrect relative suffix).
    cloud_anchor = f"/{cloud_root.name}/"
    idx = s.rfind(cloud_anchor)
    if idx != -1:
        rel = s[idx + len(cloud_anchor):].lstrip("/")
        if rel:
            candidates.append(cloud_root / rel)

    # (3) macOS home swap: /Users/<user>/<rest> → <current_home>/<rest>.
    # The current home is derived from cloud_root (/Users/<actual>/Library/...).
    m_home = re.match(r"^/Users/[^/]+/(.+)$", s)
    if (
        m_home
        and len(cloud_root.parts) >= 3
        and cloud_root.parts[1] == "Users"
    ):
        host_home = (
            Path(cloud_root.parts[0])
            / cloud_root.parts[1]
            / cloud_root.parts[2]
        )
        candidates.append(host_home / m_home.group(1))

    for candidate in candidates:
        try:
            if candidate.exists():
                return candidate
        except Exception:
            continue
    return None


def _resolve_stored_file_target(raw: str) -> Optional[Path]:
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


@router.post("/open-local-path", dependencies=[Depends(require_role("editor"))])
async def open_local_path(payload: dict = Body(...)):
    """
        Opens a local path (file or folder) with the system's default app.
    Accepts an absolute path or file:// URL. Useful for file:// links inserted
    in the BlockEditor that modern browsers block for security reasons.
    
    """
    raw = (payload or {}).get("path") or (payload or {}).get("url") or ""
    raw = str(raw).strip()
    if not raw:
        raise HTTPException(status_code=400, detail="Missing 'path'")

    # Normalizes file://… → system path
    if raw.lower().startswith("file://"):
        # file:///Users/foo  → /Users/foo  ;  file://host/share → //host/share
        without_scheme = raw[7:]
        if without_scheme.startswith("/"):
            target = urllib.parse.unquote(without_scheme)
        else:
            target = "//" + urllib.parse.unquote(without_scheme)
    else:
        target = raw

    # Expands ~ (against the HOST's HOME, not the container's) and resolves
    try:
        path = Path(_expand_host_tilde(target)).expanduser()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")

    if not path.exists():
        # Portability across machines/clouds: the link can come from another Mac
        # (a different macOS user) or a different provider (Dropbox/iCloud...). If
        # the saved path doesn't exist here, we re-root the segment under Library to
        # this machine's root before giving up.
        rerooted = _reroot_attachment_under_current_host(raw)
        if rerooted is not None:
            path = rerooted
        else:
            raise HTTPException(status_code=404, detail=f"Path not found: {path}")

    # Proactive warmup: if the file is online-only (dataless placeholder
    # from OneDrive), materialize it BEFORE opening it. Without this, we would ask the
    # system to open a 0-byte file → the app (Word/Excel/Preview)
    # opens BLANK or with an error while OneDrive is still downloading it. The other
    # read paths (`get_page`, PDF viewer) already do this warmup; this
    # one doesn't, and that's why links to non-downloaded files "didn't work".
    # Only for files: a folder is not materializable.
    if path.is_file():
        await _materialize_if_online_only(path, "open-local-path")

    try:
        _safe_open_target(str(path))
        return {"status": "ok", "target": str(path), "kind": "dir" if path.is_dir() else "file"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not open: {e}")


@router.get("/databases")
async def list_databases():
    return await table_collection_api.list_databases(table_collection_dependencies)


@router.post("/databases", dependencies=[Depends(require_role("editor"))])
async def create_database(db: dict = Body(...)):
    return await table_collection_api.create_database(db, table_collection_dependencies)


@router.delete("/databases/{database_id}", dependencies=[Depends(require_role("admin"))])
async def delete_database(database_id: str):
    return await table_collection_api.delete_database(
        database_id, table_collection_dependencies
    )


@router.get("/tables")
async def list_tables(database_id: Optional[str] = None):
    return await table_collection_api.list_tables(
        database_id, table_collection_dependencies
    )


def _ensure_main_view(registry: dict, table_id: str) -> Optional[dict]:
    """Guarantee that ``table_id`` owns one canonical main view."""
    return table_schema.ensure_main_view(registry, table_id)


@router.post("/tables", dependencies=[Depends(require_role("editor"))])
async def create_table(table: dict = Body(...)):
    return await table_lifecycle.create_table(table, table_create_dependencies)


def _table_schema_signature(properties: object) -> str:
    """Return a deterministic signature for one ordered property schema."""
    return table_schema.table_schema_signature(properties)


def _schema_revision(value: object) -> int:
    """Parse a non-negative schema revision without trusting client types."""
    return table_schema.schema_revision(value)


def _reconcile_table_schema_revision(old_table: dict, incoming_table: dict) -> None:
    """Reject stale schema writes through the canonical table domain."""
    table_schema.reconcile_table_schema_revision(old_table, incoming_table)


def _create_table_locked(table: dict):
    return table_lifecycle.create_table_locked(table, table_create_dependencies)


@router.delete("/tables/{table_id}", dependencies=[Depends(require_role("admin"))])
async def delete_table(
    table_id: str,
    background_tasks: BackgroundTasks,
    expected_table_revision: Optional[str] = None,
    expected_views_revision: Optional[str] = None,
    expected_asset_revision: Optional[str] = None,
):
    """Delete a table.

    Why background_tasks for the rmtree:
      The asset folders may live on cloud-synced storage (OneDrive FUSE)
      where deleting hundreds of files can take seconds-to-minutes. Doing
      it inline blocks the HTTP response → the frontend modal hangs in
      `isSubmitting=true` state, looking like the operation is broken.
      We update the registry synchronously (the user-visible source of
      truth) and queue the disk cleanup as a background task.
    """
    return await table_lifecycle.delete_table(
        table_id,
        background_tasks,
        expected_table_revision,
        expected_views_revision,
        expected_asset_revision,
        table_delete_dependencies,
    )


@router.put("/tables/{table_id}", dependencies=[Depends(require_role("editor"))])
async def rename_table(table_id: str, data: dict = Body(...)):
    return await table_lifecycle.rename_table(
        table_id,
        data,
        table_rename_dependencies,
    )


def _rename_table_locked(table_id: str, data: dict):
    """Rename a table while the canonical registry mutation lock is held."""
    return table_lifecycle.rename_table_locked(
        table_id,
        data,
        table_rename_dependencies,
    )


# --- Propagate a property rename to every place that stores the field NAME ----
# Renaming a property only records the old name as an `alias` so rows (which key
# by name) keep resolving until they migrate on their own. But view/section
# CONFIG stores the name as a plain string in several places, and those never
# migrate on their own — they'd keep showing (and sorting/filtering by) the old
# name. This walks every reference position and rewrites old→new so a rename
# truly propagates everywhere. See `feedback_field_rename_orphan_view_refs`.
_VIEW_REF_LIST_KEYS = ("visibleProperties", "visible_properties", "columns")
_VIEW_REF_SCALAR_KEYS = ("groupBy", "dateField", "coverField", "groupSort")
_VIEW_REF_FIELD_LIST_KEYS = ("sorts", "filters")
_VIEW_REF_DICT_KEYS = ("columnWidths", "aggregations")
# A filterTree (nested AND/OR groups, #868) can nest under any of these keys.
_FILTER_TREE_CHILD_KEYS = ("rules", "conditions", "children", "groups", "filters")


def _rename_field_in_filter_tree(node: Any, old: str, new: str) -> bool:
    """Recursively rewrite a field reference inside a filter tree."""
    return table_schema.rename_field_in_filter_tree(node, old, new)


def _rename_field_refs_in_view_like(container: Any, old: str, new: str) -> bool:
    """Rewrite field-name references in a view or embedded section."""
    return table_schema.rename_field_refs_in_view_like(container, old, new)


def _propagate_property_rename(
    registry: dict, table_id: str, old_name: str, new_name: str
) -> int:
    """Propagate a property rename through canonical view configuration."""
    return table_schema.propagate_property_rename(
        registry, table_id, old_name, new_name
    )


@router.patch("/tables/{table_id}/properties/{field_id}",
               dependencies=[Depends(require_role("editor"))])
async def patch_table_property(table_id: str, field_id: str, data: dict = Body(...)):
    """
        Renames or updates non-structural attributes of a property identified
    by its immutable 'id'. Never changes the id.

    PERSISTENCE BY NAME: since pages store keys by the current name,
    renaming records the old name as an `alias` of the property. Rows with
    the old name keep resolving (via aliases) and migrate on their own to the new name on
    the next save — without rewriting any file here (instant, robust
    offline). See `vault_persist_by_name.md`.

    Accepted body (all optional):
      - name: new displayed name
      - type: new type (only if data migration is safe)
      - config: dict that gets merged with the existing config
    
    """
    return await table_schema.patch_table_property(
        table_id,
        field_id,
        data,
        table_property_dependencies,
    )


def _patch_table_property_locked(table_id: str, field_id: str, data: dict):
    return table_schema.patch_table_property_locked(
        table_id,
        field_id,
        data,
        table_property_dependencies,
    )


# --- Option catalogs: usage, renaming and deletion everywhere ---------------------
# Bulk operations ALWAYS on the server (1 endpoint, N atomic writes
# of file), never N PATCH requests from the client (they exhaust the pool and hide
# partial errors — see feedback_bulk_ops_server_side).


def _find_table_and_prop(registry: dict, table_id: str, field_ref: str) -> tuple:
    """Return a table and property by table ID and field ID or name."""
    return table_options.find_table_and_property(registry, table_id, field_ref)


def _option_value_keys(prop: dict) -> list:
    """Candidate frontmatter keys for this field's value."""
    return table_options.option_value_keys(prop)


def _global_status_members(registry: dict) -> list[tuple[dict, dict]]:
    """Return every table/property pair backed by the global status catalog."""
    return table_options.global_status_members(registry, table_option_dependencies)


async def _rewrite_option_in_rows(
    table: dict, prop: dict, old: str, new: Optional[str]
) -> int:
    """Rewrite one option value in all rows of a table."""
    return await table_options.rewrite_option_in_rows(
        table,
        prop,
        old,
        new,
        table_option_dependencies,
    )


@router.get("/tables/{table_id}/options/usage")
async def table_option_usage(table_id: str, field_id: str):
    """Usage counter per option (how many rows use each value) — feeds
    the option editor of the SchemaConfigModal."""
    return await table_options.table_option_usage(
        table_id,
        field_id,
        table_option_dependencies,
    )


@router.post(
    "/tables/{table_id}/options/rename",
    dependencies=[Depends(require_role("editor"))],
)
async def rename_table_option(table_id: str, payload: dict = Body(...)):
    """Renames an option in the catalog AND in all rows that use it (the
    values are persisted by name → eager rewrite of the affected .md files).

    Body: ``{field_id, old, new}``. Returns the count of touched files.
    
    """
    return await table_options.rename_table_option(
        table_id,
        payload,
        table_option_dependencies,
    )


@router.post(
    "/tables/{table_id}/options/remove",
    dependencies=[Depends(require_role("editor"))],
)
async def remove_table_option(table_id: str, payload: dict = Body(...)):
    """Deletes an option from the catalog and from ALL rows that use it, clearing
    the value or REASSIGNING it to another option (Notion-style).

    Body: ``{field_id, value, reassign_to?}``. Returns touched files.
    
    """
    return await table_options.remove_table_option(
        table_id,
        payload,
        table_option_dependencies,
    )


# --- Named shared catalogs (root registry `option_catalogs`) ---------
# Several tables share the same list (e.g. tags) by referencing it
# with `config.catalog_ref`; editing the catalog in one place updates it everywhere.


@router.get("/option-catalogs")
async def list_option_catalogs():
    return await table_options.list_option_catalogs(table_option_dependencies)


@router.put(
    "/option-catalogs/{name}", dependencies=[Depends(require_role("editor"))]
)
async def put_option_catalog(name: str, payload: dict = Body(...)):
    """Creates or replaces a shared catalog. Body: ``{options: [...]}``."""
    return await table_options.put_option_catalog(
        name,
        payload,
        table_option_dependencies,
    )


@router.delete(
    "/option-catalogs/{name}", dependencies=[Depends(require_role("editor"))]
)
async def delete_option_catalog(name: str):
    """Deletes a shared catalog. 409 if any field still references it."""
    return await table_options.delete_option_catalog(
        name,
        table_option_dependencies,
    )


@router.get("/views")
async def list_views(table_id: Optional[str] = None):
    return await vault_views.list_views(table_id, vault_view_dependencies)


@router.post("/views", dependencies=[Depends(require_role("editor"))])
async def create_view(view: dict = Body(...)):
    return await vault_views.create_view(view, vault_view_dependencies)


@router.put("/views/order", dependencies=[Depends(require_role("editor"))])
async def reorder_views(body: dict = Body(...)):
    """Reorders a table's views according to the received order.

    Body: {"table_id": "...", "ordered_ids": ["v1", "v2", "v3"]}.
    Views from other tables keep their relative position. Views
    of the referenced table are placed at the end of the registry following
    the given order.
    
    """
    return await vault_views.reorder_views(body, vault_view_dependencies)


@router.get("/views/{view_id}")
async def get_view(view_id: str):
    return await vault_views.get_view(view_id, vault_view_dependencies)


@router.get("/views/{view_id}/usage")
async def get_view_usage(view_id: str):
    """Find all pages/notes in the vault where this view_id is embedded or referenced."""
    return await vault_views.get_view_usage(view_id, vault_view_dependencies)


@router.delete("/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def delete_view(view_id: str):
    return await vault_views.delete_view(view_id, vault_view_dependencies)


@router.put("/views/{view_id}", dependencies=[Depends(require_role("editor"))])
async def update_view(view_id: str, data: dict = Body(...)):
    return await vault_views.update_view(view_id, data, vault_view_dependencies)


def _resolve_subpath_within_vault(folder: str, *segments: str) -> Path:
    """Resolve a subpath and reject traversal outside the active vault."""
    return vault_view_schema.resolve_subpath_within_vault(
        folder,
        *segments,
        dependencies=vault_schema_dependencies,
    )


# Route for backward compatibility with the existing frontend (SchemaConfigModal)
@router.post("/schema", dependencies=[Depends(require_role("editor"))])
async def save_schema(folder: str, schema: dict = Body(...)):
    """
    Legacy route to save schemas per folder.
    Now we redirect it to table creation if needed, or save it as a local file.
    """
    return await vault_view_schema.save_schema(
        folder,
        schema,
        vault_schema_dependencies,
    )


@router.get("/schema")
async def get_schema(folder: str):
    return await vault_view_schema.get_schema(folder, vault_schema_dependencies)


# --------------------------------------------------------------------------
# EXCALIDRAW DRAWINGS ROUTES
# --------------------------------------------------------------------------


@router.get("/drawings")
async def list_drawings():
    """Lists all drawings in the vault (tldraw and excalidraw)."""
    def _list() -> List[Dict[str, Any]]:
        dib_path = get_p('DIBUIXOS')
        dib_path.mkdir(parents=True, exist_ok=True)
        drawings = []
        seen_ids = set()

        # First search for .tldraw.json files (new format)
        for file_path in dib_path.glob("*.tldraw.json"):
            drawing_id = file_path.stem.replace(".tldraw", "")
            seen_ids.add(drawing_id)
            try:
                stat = file_path.stat()
                data = json.loads(file_path.read_text(encoding="utf-8"))
                # New format has { title, data, metadata }
                title = data.get("title", drawing_id)
                drawings.append(
                    {
                        "id": drawing_id,
                        "title": title,
                        "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "size": stat.st_size,
                    }
                )
            except Exception as e:
                log.warning(f"Error reading drawing {file_path.name}: {e}")

        # Then search for .excalidraw.json files (old format)
        for file_path in dib_path.glob("*.excalidraw.json"):
            drawing_id = file_path.stem.replace(".excalidraw", "")
            if drawing_id in seen_ids:
                continue  # We already have the new format
            try:
                stat = file_path.stat()
                data = json.loads(file_path.read_text(encoding="utf-8"))
                drawings.append(
                    {
                        "id": drawing_id,
                        "title": data.get("metadata", {}).get("title", drawing_id),
                        "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
                        "size": stat.st_size,
                    }
                )
            except Exception as e:
                log.warning(f"Error reading drawing {file_path.name}: {e}")

        return drawings

    # Drawings live in the cloud-backed vault. Keep filesystem latency out of
    # FastAPI's event loop so one unavailable placeholder cannot freeze all
    # drawing loads and saves.
    return await asyncio.to_thread(_list)


@router.get("/drawings/{drawing_id}")
async def get_drawing(drawing_id: str):
    """Returns the data of a Tldraw drawing."""
    def _read() -> dict:
        # Search first in new format (.tldraw.json)
        file_path = get_p("DIBUIXOS") / f"{drawing_id}.tldraw.json"
        if not file_path.exists():
            # Fallback to old format (.excalidraw.json)
            file_path = get_p("DIBUIXOS") / f"{drawing_id}.excalidraw.json"
            if not file_path.exists():
                raise FileNotFoundError(drawing_id)

        return json.loads(file_path.read_text(encoding="utf-8"))

    try:
        # The vault can be backed by OneDrive; never perform its read on the
        # event loop or a slow online-only file will block every drawing.
        file_data = await asyncio.to_thread(_read)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Drawing not found")
    except Exception as e:
        log.error(f"Error reading drawing {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading target file")

    try:
        # New format has { title, data, metadata } - return data
        if "data" in file_data:
            return file_data["data"]
        # Old format - return as-is
        return file_data
    except Exception as e:
        log.error(f"Error reading drawing {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error reading target file")


def _backup_drawing_version(drawing_id: str, file_path: Path) -> None:
    """Copies the current .tldraw.json to .history/{id}/{ts}.tldraw.json before
    overwriting it. Last line of defense against clients that save an empty
    canvas after a failed load (directive tldraw_save_integrity.md).
    Same 10 min cooldown as `_create_page_version`: also prevents a broken
    client saving in a loop from clobbering the good backup with empty versions.
    
    """
    if not file_path.exists():
        return
    history_base = get_p("VAULT") / ".history" / drawing_id
    history_base.mkdir(parents=True, exist_ok=True)

    COOLDOWN = 600
    versions = sorted(history_base.glob("*.tldraw.json"))
    if versions:
        try:
            if time.time() - versions[-1].stat().st_mtime < COOLDOWN:
                return
        except Exception:
            pass

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    version_path = history_base / f"{timestamp}.tldraw.json"
    try:
        shutil.copy2(file_path, version_path)
        log.info(f"Drawing version created: {version_path}")
    except Exception as e:
        log.warning(f"Could not create drawing version for {drawing_id}: {e}")


@router.put("/drawings/{drawing_id}", dependencies=[Depends(require_role("editor"))])
async def save_drawing(drawing_id: str, request: DrawingSaveRequest):
    """Saves or updates a Tldraw drawing."""
    file_path = get_p("DIBUIXOS") / f"{drawing_id}.tldraw.json"

    # Save title and data together
    payload = {
        "title": request.title,
        "data": request.data,
        "metadata": request.metadata or {},
    }

    def _write() -> None:
        # Vault IO (OneDrive may need to materialize files
        # online-only) outside the event loop — see async_event_loop_vault_io.md
        get_p("DIBUIXOS").mkdir(parents=True, exist_ok=True)
        _backup_drawing_version(drawing_id, file_path)
        safe_write_json(file_path, payload, indent=2, ensure_ascii=False)

    try:
        await asyncio.to_thread(_write)
        return {"status": "success", "id": drawing_id}
    except Exception as e:
        log.error(f"Error saving drawing {drawing_id}: {e}")
        raise HTTPException(status_code=500, detail="Error writing target file")


@router.delete("/drawings/{drawing_id}", dependencies=[Depends(require_role("editor"))])
async def delete_drawing(drawing_id: str):
    """Soft-delete: moves the drawing to the trash, like pages.

    It used to do a direct `unlink()`: instant and IRREVERSIBLE deletion —
    the only thing in the app without the 90-day recovery window. And the
    `.history` backup didn't cover this case: it only exists if the drawing
    had been overwritten at some point (the first save doesn't create one), so
    a newly created drawing that got deleted was lost entirely. The trash
    mechanism is format-agnostic (it stores the file + a sidecar with
    `original_path` and restores there), so we reuse `_move_page_to_trash`:
    Restore/Purge and the 90-day cron work for free.
    
    """
    drawing_id = _validate_safe_page_id(drawing_id)
    dib_path = get_p('DIBUIXOS')
    file_path = dib_path / f"{drawing_id}.tldraw.json"
    if not file_path.exists():
        file_path = dib_path / f"{drawing_id}.excalidraw.json"
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Drawing not found")

    # Title for the trash: from the drawing's JSON payload (the helper reads
    # frontmatter of .md; in a JSON it stays empty and the trash would show the id).
    title = ""
    try:
        title = str((json.loads(file_path.read_text(encoding="utf-8")) or {}).get("title") or "")
    except Exception:
        pass

    def _move() -> Dict[str, Any]:
        sidecar = _move_page_to_trash(drawing_id, file_path)
        if title and not sidecar.get("title"):
            sidecar["title"] = title
            safe_write_json(_trash_entry_dir(drawing_id) / "_trash.json", sidecar, indent=2)
        return sidecar

    sidecar = await asyncio.to_thread(_move)
    return {
        "status": "soft_deleted",
        "id": drawing_id,
        "deleted_at": sidecar.get("deleted_at"),
        "title": sidecar.get("title") or title,
    }


def _create_page_version(page_id: str, file_path: Path, force: bool = False):
    """Saves a version of the current file to .history/{page_id}/{timestamp}.md if cooldown passed.

    `force=True` skips the cooldown: it's for the SAFETY snapshots
    of explicit actions (e.g. the "state right before the restore"). The
    cooldown is meant to avoid saturating with autosaves; applying it also to
    the pre-restore snapshot meant that, if you had edited less than 10 min ago,
    the current state would be SILENTLY discarded and become unrecoverable after
    the restore (reproduced: restoring v1 with v3 on disk lost v3 forever).
    
    """
    HistoryRepository(get_p("VAULT")).create_file_version(
        page_id,
        file_path,
        force=force,
    )


def _create_page_version_from_content(page_id: str, original_content: str):
    """Variant of `_create_page_version` that writes the original content
    directly as passed in as a parameter, without needing to `shutil.copy2` the
    file. Meant to run as a `background_task` AFTER the
    response to the client has already been sent: if we waited to copy the file
    before `save_page_md`, the user would pay an extra 50-300 ms of OneDrive I/O
    per PATCH; here we do it in the background with the content the
    handler already had in memory.

    Keeps the original 10 min cooldown.
    
    """
    HistoryRepository(get_p("VAULT")).create_content_version(
        page_id,
        original_content,
    )


history_api.configure(
    history_api.HistoryDependencies(
        vault_root=lambda: get_p("VAULT"),
        validate_page_id=_validate_safe_page_id,
        validate_timestamp=_validate_history_timestamp,
        parse_frontmatter=parse_frontmatter,
        find_page=lambda page_id: find_page_path(page_id),
        create_page_version=lambda page_id, file_path, force: _create_page_version(
            page_id,
            file_path,
            force=force,
        ),
        get_table_id=get_table_id,
        recompute_formulas=_recompute_cross_record_formulas_for_table,
    )
)
history_api.register_routes(
    router,
    editor_dependencies=[Depends(require_role("editor"))],
    admin_dependencies=[Depends(require_role("admin"))],
)
get_page_history = history_api.get_page_history
get_page_version_content = history_api.get_page_version_content
restore_page_version = history_api.restore_page_version
purge_page_history = history_api.purge_page_history


# ---------------------------------------------------------------------------
# Skills — actions triggered from `button`-typed fields in the table schema.
# Each skill expects the row id and any action-specific payload, runs its
# logic synchronously (creating subitems, calling external APIs, etc.) and
# returns a structured summary the UI can surface.
# ---------------------------------------------------------------------------


# --- Translation lifecycle helpers (idempotency + staleness) ---------------
# Shared by translate-row / translate-rows / translate-page and by the save
# hooks that flag translations as out-of-date. See directive
# `translate_gaps_implementation` for the rationale and the autosave-safety
# constraints.


def _read_deepl_key() -> str:
    """DeepL API key from the macOS Keychain (preferred), env fallback.

    Returns "" when unavailable — the skills degrade to free providers /
    visible placeholders rather than failing.
    """
    try:
        from backend.security.keychain_manager import get_keychain
        kc = get_keychain()
        if kc.has_credential("deepl_api_key"):
            return kc.get_credential("deepl_api_key") or ""
    except Exception as exc:
        log.warning(f"translate: keychain unavailable, using env fallback: {exc}")
    return ""


def _load_translate_row_skill():
    """Lazy import of the row skill (translate, detect_source_lang).

    Deferred so a missing optional dependency never breaks app startup —
    translation is opt-in per table.
    """
    try:
        from pipeline.skills.translate_row.scripts.translate_text import (
            translate as _translate,
            detect_source_lang as _detect_source_lang,
        )
        return _translate, _detect_source_lang
    except Exception as exc:
        log.error(f"translate_row skill not importable: {exc}")
        raise HTTPException(status_code=500, detail="translate_row skill unavailable")


async def _get_existing_translations(origin_id: str) -> Dict[str, Any]:
    """Return ``{lang: PageInfo}`` of translation children already created for an
    origin. Powers idempotent re-translation: a language that already has a
    subitem/subpage is updated in place instead of duplicated. The lookup runs
    over the TTL-cached page snapshot (in-memory) so it adds no disk I/O.
    """
    def _work():
        try:
            return find_translations_of(origin_id, _get_pages_snapshot())
        except Exception as exc:
            log.debug(f"existing-translations lookup failed for {origin_id}: {exc}")
            return {}
    return await asyncio.to_thread(_work)


async def _recover_translations_from_disk(
    origin_id: str, table_dir: Path, known_langs
) -> Dict[str, Any]:
    """Safety net for translate-row idempotency under OneDrive.

    `_get_existing_translations` looks at the in-memory index snapshot. If a
    child translation exists on disk but the indexer was NOT able to index it —an
    online-only (dataless) file makes the parse fail and it stays as a *stub* entry
    without `translation_origin_id`/`translation_lang`, so
    `find_translations_of` doesn't recognize it— the lookup treats it as nonexistent and
    translate-row would create a DUPLICATE ("... (2).md").

    This fallback scans the table's directory, materializes the
    online-only files and re-parses the frontmatter to recover the child translations
    for `origin_id` of the missing languages. Scoped to the table's directory and
    called ONLY when some language is missing from the snapshot, so the cost is
    marginal compared to the translation calls themselves. Returns
    `{lang: SimpleNamespace(id, metadata)}` (same `.id` access shape as the
    `PageInfo` from the snapshot) for the unknown languages.
    
    """
    from types import SimpleNamespace

    out: Dict[str, Any] = {}
    target = _canonicalize_id(origin_id)
    if not target:
        return out
    known = {str(l).strip().lower() for l in known_langs}
    try:
        candidates = sorted(table_dir.glob("*.md"))
    except OSError:
        return out
    for p in candidates:
        try:
            await _materialize_if_online_only(p, f"translate-recover/{origin_id}")
            meta, _ = await asyncio.to_thread(_read_frontmatter_partial, p)
        except Exception:
            continue
        meta = meta or {}
        if _canonicalize_id(meta.get("translation_origin_id")) != target:
            continue
        lang = str(meta.get("translation_lang") or "").strip().lower()
        if lang and lang not in known and lang not in out:
            pid = meta.get("id")
            # We repair the index: insert the recovered entry (same pattern as
            # create_page) so that the later patch_page —via find_page_path— can
            # find it, and it stays indexed for future lookups. Without this, the update
            # fails with 404 because the file wasn't in the index.
            try:
                from backend.services.context_vars import get_active_vault_path
                v_str = str(get_active_vault_path())
                entry = _build_page_cache_entry(p, p.stat())
                with _page_index_lock:
                    _page_index_entries.setdefault(v_str, {})[str(p)] = entry
                    if pid:
                        _page_id_to_path.setdefault(v_str, {})[pid] = str(p)
                    _bump_page_index_version(v_str)
                _pages_cache_invalidate_all()
            except Exception as exc:
                log.debug(f"translate-recover: could not index {p}: {exc}")
            out[lang] = SimpleNamespace(id=pid, metadata=meta)
    return out


def _ensure_status_options_persisted(table_id: str, values: list) -> None:
    """Best-effort: ensures in the ON-DISK registry that the status field has the
    `values` options (directive §4.1.5: a rule never fails due to an
    incomplete catalog). Called when an action_rules effect has had to create an
    option on the table's in-memory copy — it reapplies the change
    on a fresh load and persists it."""
    try:
        with registry_mutation():
            reg = load_registry()
            table = next(
                (t for t in reg.get("tables", []) if t.get("id") == table_id), None
            )
            if not table:
                return
            prop = option_catalogs_service.find_role_prop(
                table, option_catalogs_service.ROLE_STATUS
            )
            if not prop:
                return
            wanted = [(str(v), "") for v in values if str(v or "").strip()]
            if not wanted:
                return
            if option_catalogs_service.is_global_status_prop(prop):
                catalog = reg.setdefault("option_catalogs", {}).setdefault(
                    option_catalogs_service.STATUS_CATALOG_REF, []
                )
                names = {
                    option["name"]
                    for option in option_catalogs_service.normalize_options(catalog)
                }
                changed = False
                for value, group in wanted:
                    if value in names:
                        continue
                    option = {"name": value, "color": option_catalogs_service.auto_color(value)}
                    if group:
                        option["group"] = group
                    catalog.append(option)
                    names.add(value)
                    changed = True
                if changed:
                    reg["option_catalogs"][option_catalogs_service.STATUS_CATALOG_REF] = option_catalogs_service.normalize_options(catalog)
                    save_registry(reg)
            elif option_catalogs_service.ensure_options_exist(prop, wanted):
                save_registry(reg)
    except Exception as exc:
        log.warning(
            f"action_rules: could not persist the expanded catalog for {table_id}: {exc}"
        )


def _write_metadata_key_on_disk(page_id: str, file_path: Path, key: str, value) -> bool:
    """Writes a SINGLE metadata key directly to the file (without going through
    the PATCH: no rule engine, no etags, no re-resolution by id — we already have the path).
    Idempotent: if the value is already there, it doesn't write. Refreshes the cache like the
    staleness flag does. Used by action_rules effects on the original."""
    try:
        raw = file_path.read_text(encoding="utf-8")
        md, body = parse_frontmatter(raw, file_path)
    except Exception as exc:
        log.warning(f"status-effect read failed for {page_id}: {exc}")
        return False
    if md.get(key) == value:
        return False
    md[key] = value
    try:
        save_page_md(file_path, md, body)
    except Exception as exc:
        log.warning(f"status-effect write failed for {page_id}: {exc}")
        return False
    try:
        from backend.services.context_vars import get_active_vault_path
        v_path = get_active_vault_path()
        if v_path:
            v_str = str(v_path)
            stat_result = file_path.stat()
            new_entry = _build_cache_entry_from_memory(file_path, stat_result, md, body)
            with _page_index_lock:
                _page_index_entries.setdefault(v_str, {})[str(file_path)] = new_entry
                _page_id_to_path.setdefault(v_str, {})[md.get("id") or page_id] = str(file_path)
                _bump_page_index_version(v_str)
        _pages_cache_invalidate_all()
    except Exception as exc:
        log.debug(f"status-effect cache update failed for {page_id}: {exc}")
    return True


def _set_translation_stale_on_disk(
    page_id: str,
    file_path: Path,
    stale_status: Optional[tuple] = None,
) -> bool:
    """Flag a single translation page as stale on disk. Idempotent.

    Returns True only when it actually wrote (flag flipped). Writes the minimal
    change directly with ``save_page_md`` — NOT through the PATCH handler — so it
    never re-enters the rule engine, etag checks, or this very propagation. The
    "already stale → no write" short-circuit is what keeps autosave from
    triggering a write storm.

    ``stale_status``: `(property, valor)` optional, from the table's `on_stale`
    rule — when marking stale, the translation's Status reverts (e.g.) to
    "Draft" in the same write.
    
    """
    try:
        raw = file_path.read_text(encoding="utf-8")
        md, body = parse_frontmatter(raw, file_path)
    except Exception as exc:
        log.debug(f"stale-flag read failed for {page_id}: {exc}")
        return False
    if md.get("translation_stale") is True:
        return False  # already flagged → no redundant write
    md["translation_stale"] = True
    if stale_status:
        _prop, _value = stale_status
        _key = action_rules_service.effect_write_key(md, _prop)
        if _key:
            md[_key] = _value
    try:
        save_page_md(file_path, md, body)
    except Exception as exc:
        log.warning(f"stale-flag write failed for {page_id}: {exc}")
        return False
    # Surgical cache refresh so the UI sees the flag without a full rescan
    # (mirrors what PATCH does after a write).
    try:
        from backend.services.context_vars import get_active_vault_path
        v_path = get_active_vault_path()
        if v_path:
            v_str = str(v_path)
            stat_result = file_path.stat()
            new_entry = _build_cache_entry_from_memory(file_path, stat_result, md, body)
            with _page_index_lock:
                _page_index_entries.setdefault(v_str, {})[str(file_path)] = new_entry
                _page_id_to_path.setdefault(v_str, {})[md.get("id") or page_id] = str(file_path)
                _bump_page_index_version(v_str)
        _pages_cache_invalidate_all()
    except Exception as exc:
        log.debug(f"stale-flag cache update failed for {page_id}: {exc}")
    return True


def _propagate_translation_staleness(
    origin_id: str,
    old_md: Optional[dict],
    new_md: Optional[dict],
    old_body: Optional[str],
    new_body: Optional[str],
) -> None:
    """Background task: flag an original's translations stale after a real edit.

    Guards (all required to keep autosave cheap and avoid loops):
      • The edited page must NOT itself be a translation (`translation_lang`).
      • The change must touch translatable content (`translatable_content_changed`)
        — icon/cover/cursor churn is ignored.
      • Each child write is idempotent (`_set_translation_stale_on_disk`).

    It never regenerates translations (too costly/risky); it only signals that a
    re-translation is due. Re-translation is idempotent, so acting on the signal
    updates in place.
    """
    try:
        new_md = new_md or {}
        if new_md.get("translation_lang"):
            return  # editing a translation, not an original → nothing to propagate
        canonical_id = str(new_md.get("id") or origin_id)

        table = _table_by_id(get_table_id(new_md))
        if table and table.get("translation_enabled"):
            props = [p for p in (table.get("properties") or []) if p.get("translatable") is True]
            # Keys by ID and by NAME (and aliases): the frontmatter persists by
            # name (vault_persist_by_name), but some old rows store
            # by id. Comparing only by id NEVER detected changes in
            # name-based rows and translations were never marked stale.
            keys = []
            for p in props:
                for k in (p.get("id"), p.get("name"), *(p.get("aliases") or [])):
                    if k:
                        keys.append(k)
            title_matters = any(
                (p.get("name") == "title" or p.get("type") == "title") for p in props
            )
            changed = translatable_content_changed(
                keys, old_md, new_md, title_matters=title_matters
            )
        else:
            # Plain page (translate_page mode): title + body are what we translate.
            changed = translatable_content_changed(
                [], old_md, new_md,
                old_body=old_body, new_body=new_body, title_matters=True,
            )
        if not changed:
            return

        translations = find_translations_of(canonical_id, _get_pages_snapshot())
        if not translations:
            return
        # on_stale rule (action_rules): besides the flag, the Status of each
        # stale translation reverts to "Draft" (= pending review).
        stale_status = None
        if table:
            _sprop, _svalue, _schanged = action_rules_service.on_stale_effect(table)
            if _sprop and _svalue is not None:
                stale_status = (_sprop, _svalue)
                if _schanged:
                    _ensure_status_options_persisted(table.get("id"), [_svalue])
        flagged = 0
        for _lang, page in translations.items():
            pid = getattr(page, "id", None)
            ppath = getattr(page, "path", None)
            if pid is None and isinstance(page, dict):
                pid = page.get("id")
                ppath = page.get("path")
            if not pid:
                continue
            fp = Path(ppath) if ppath else find_page_path(pid)
            if not fp or not fp.exists():
                continue
            if _set_translation_stale_on_disk(pid, fp, stale_status=stale_status):
                flagged += 1
        if flagged:
            log.info(f"Flagged {flagged} translation(s) of {canonical_id} as stale.")
    except Exception as exc:
        log.debug(f"translation staleness propagation skipped: {exc}")


async def _do_translate_row(
    item_id: str,
    target_languages: list,
    *,
    translate_fn,
    detect_fn,
    deepl_api_key: str,
    background_tasks: BackgroundTasks,
) -> dict:
    """Translate one row's translatable fields into one subitem per language.

    Creates the per-language subitem the first time and UPDATES it in place on
    re-translation (idempotent — keyed by `translation_origin_id` +
    `translation_lang`). Raises HTTPException for caller-visible problems; the
    single endpoint re-raises them, the bulk endpoint catches them per item.
    """
    file_path = await asyncio.to_thread(find_page_path, item_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {item_id})")
    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = parse_frontmatter(raw_content, file_path)

    # Resolve the parent table and validate it's set up for translation.
    table_id = get_table_id(metadata)
    table = _table_by_id(table_id) if table_id else None
    if not table:
        raise HTTPException(status_code=400, detail="Row is not part of a table")
    if not table.get("translation_enabled"):
        raise HTTPException(
            status_code=400,
            detail="This table is not configured for translation. Enable it in the schema config.",
        )

    # Translatable properties carry the explicit flag the SchemaConfigModal writes.
    properties = table.get("properties") or []
    translatable_props = [p for p in properties if p.get("translatable") is True]
    if not translatable_props:
        raise HTTPException(
            status_code=400,
            detail="No translatable fields configured on this table.",
        )

    # action_rules safeguard (e.g. «a draft cannot be translated»):
    # the frontend already shows the button disabled with the reason, but the backend
    # always revalidates (never trust the client alone). 409 with the reason.
    _ok, _reason = action_rules_service.check_requires(
        table, action_rules_service.ACTION_TRANSLATE, metadata
    )
    if not _ok:
        raise HTTPException(status_code=409, detail=_reason)

    def _read_meta(prop: dict):
        # The title field is saved under the canonical key `title`. The key with the
        # property's NAME (e.g. "Title") may exist in the frontmatter but
        # EMPTY — that's why `title` must be prioritized for title fields; otherwise,
        # `_read_meta` would return "" and the subitem would end up taking the title from the
        # first text field ("Imatge Alt Text"). See bug "no veo resultados".
        is_title = prop.get("type") == "title" or prop.get("name") == "title"
        candidate_keys = []
        if is_title:
            candidate_keys.append("title")
        prop_id = prop.get("id")
        prop_name = prop.get("name") or ""
        if prop_id:
            candidate_keys.append(prop_id)
        if prop_name:
            candidate_keys.append(prop_name)
        if is_title:
            candidate_keys.append("title")  # last resort, already included before
        # First NON-empty value among the candidate keys.
        fallback = None
        for key in candidate_keys:
            if key in metadata:
                val = metadata.get(key)
                if isinstance(val, str) and val.strip():
                    return val
                if val not in (None, "", [], {}):
                    return val
                if fallback is None:
                    fallback = val
        return fallback

    # Source language: the record's "Language" field takes precedence (if it has one); otherwise
    # heuristic based on the text of the longest translatable field. This way we respect the
    # user's explicit data instead of guessing (e.g. ES marked as CA).
    source_lang = detect_record_source_lang(metadata)
    # If the origin comes from the "Language" field, it is RELIABLE data (the user declared it);
    # if it comes from the text heuristic, less so. We keep track of this to decide whether we can
    # trust the per-field detection of the translation-skip further below.
    source_is_explicit = bool(source_lang)
    if not source_lang:
        sample = ""
        for p in translatable_props:
            val = _read_meta(p)
            if isinstance(val, str) and len(val.strip()) > len(sample):
                sample = val.strip()
        if not sample:
            sample = str(metadata.get("title") or "")
        source_lang = detect_fn(sample) if sample else "en"

    def _translate_one(text: str, lang: str):
        """Translates a source string→`lang` respecting the per-field skip (#309):
        with explicit origin ("Language" field) we always translate; without it, if the field already
        looks like it's in the target language it is kept as is. Reused for text fields and for the
        text subfields of image fields. Returns (translated, provider)."""
        if source_is_explicit:
            field_lang = ""
        else:
            try:
                field_lang = detect_fn(text)
            except Exception:
                field_lang = ""
        if field_lang == lang:
            return text, "noop"
        try:
            return translate_fn(text, source_lang, lang, deepl_api_key=deepl_api_key)
        except Exception as exc:
            log.warning(f"translate_row: failed translating field → {lang}: {exc}")
            return f"[error: {exc}]", "error"

    parent_title = str(metadata.get("title") or "")
    title_is_translatable = any(
        (p.get("name") == "title" or p.get("type") == "title") and p.get("translatable") is True
        for p in translatable_props
    )

    # The original's markdown body is also translated (articles have their text
    # in the body, not just in the fields). We reuse the segmenter from `translate_page`, which
    # preserves code, wikilinks, citations, etc. If it's not importable, the body is left
    # empty and only the fields are translated (degradation, not an error).
    _translate_markdown = None
    if body and body.strip():
        try:
            from pipeline.skills.translate_page.scripts.markdown_segmenter import (
                translate_markdown as _translate_markdown,
            )
        except Exception as exc:
            log.warning(f"translate_row: markdown segmenter unavailable, body left empty: {exc}")

    # Pre-fetch the already-existing translations so re-runs update instead of duplicate.
    existing_translations = await _get_existing_translations(item_id)
    # OneDrive safety net: if the index snapshot doesn't have all the
    # requested translations, they might exist on disk but the indexer
    # may not have been able to index them (online-only/dataless files → stub entry). We
    # recover them from disk before creating, so as not to duplicate ("... (2).md").
    _requested_langs = {
        str(lang).strip().lower()
        for lang in target_languages
        if isinstance(lang, str) and lang.strip()
    }
    if not _requested_langs.issubset(existing_translations.keys()):
        _recovered = await _recover_translations_from_disk(
            item_id, file_path.parent, set(existing_translations.keys())
        )
        for _lang, _page in _recovered.items():
            existing_translations.setdefault(_lang, _page)

    # MOST reliable source under OneDrive: the LOCAL translation index, which lives outside
    # the Vault and is never online-only (unlike the snapshot and the disk, which
    # fail with downloaded files → duplicates were created). We rely on it for
    # languages that the other paths haven't found, validating each id against disk;
    # if the subitem no longer exists (deleted), we clean up the stale entry.
    from types import SimpleNamespace as _SNS
    _local_known = await asyncio.to_thread(translation_index.get_known_translations, item_id)
    for _lang, _sid in _local_known.items():
        if _lang in existing_translations:
            continue
        _p = await asyncio.to_thread(find_page_path, _sid)
        if _p and _p.exists():
            existing_translations[_lang] = _SNS(id=_sid, metadata={})
        else:
            await asyncio.to_thread(translation_index.forget_translation, item_id, _lang)

    created: list = []
    updated: list = []
    skipped: list = []

    for lang in target_languages:
        if not isinstance(lang, str) or not lang.strip():
            continue
        lang = lang.strip().lower()
        if lang == source_lang:
            skipped.append({"lang": lang, "reason": "same as source"})
            continue

        sub_metadata: Dict[str, Any] = {
            "table_id": table_id,
            "database_table_id": table_id,
            "translation_lang": lang,
            "translation_source_lang": source_lang,
            "translation_origin_id": item_id,
            # A fresh translation is, by definition, up to date with the origin.
            "translation_stale": False,
        }
        providers_used = set()
        any_translated = False
        translated_title = ""
        first_text_translation = ""

        for prop in translatable_props:
            val = _read_meta(prop)
            # Persist by the same key the parent row uses, preferring stable id.
            key = prop.get("id") or prop.get("name")

            # Image field ({src, alt, title…} composite or string path): it stays the
            # image (src, without duplicating the file — the subitem references the
            # same) and only the TEXT subfields are translated (alt, title,
            # caption, credit). A string path is copied as-is (it is not translated
            # as if the path were prose). Detected by the composite value or by the name.
            if is_composite_image_value(val) or (
                (prop.get("type") == "image" or is_image_field_name(prop.get("name")))
                and isinstance(val, (dict, str))
                and val
            ):
                new_val, img_provs, img_tr = translate_image_field(
                    val, lambda s: _translate_one(s, lang)
                )
                if key:
                    sub_metadata[key] = new_val
                providers_used |= img_provs
                if img_tr:
                    any_translated = True
                continue

            if not isinstance(val, str) or not val.strip():
                continue
            translated, provider = _translate_one(val, lang)
            if provider != "noop":
                providers_used.add(provider)
            if key:
                sub_metadata[key] = translated
            any_translated = True
            if (prop.get("name") == "title" or prop.get("type") == "title") and not translated_title:
                translated_title = translated
            elif not first_text_translation and prop.get("type") in ("text", "rich_text"):
                first_text_translation = translated

        # Marks the subitem's "Language" field with the translation's language (if the
        # table has one). It used to be left empty: the subitem inherited the
        # translated fields but didn't say what language it was in. It reuses the
        # catalog option that matches the code; if not, it puts the code in uppercase
        # ("CA", "EN"…). It's written AFTER the field loop so that it takes precedence even
        # if someone had marked the language field itself as translatable.
        lang_key, lang_value = language_field_assignment(properties, lang, metadata)
        if lang_key and lang_value is not None:
            sub_metadata[lang_key] = lang_value

        # action_rules effect on the created OR updated translation:
        # Status "Draft" (= pending human review; the safeguard for
        # publishing thus blocks unreviewed translations). It's written like the
        # language field: via sub_metadata, which create/patch merges.
        _eprop, _evalue, _echanged = action_rules_service.status_effect(
            table, action_rules_service.ACTION_TRANSLATE, "created"
        )
        if _eprop and _evalue is not None:
            _ekey = _eprop.get("id") or _eprop.get("name")
            if _ekey:
                sub_metadata[_ekey] = _evalue
            if _echanged:
                _ensure_status_options_persisted(table_id, [_evalue])

        # Translate the markdown body of the original (if there is one and the segmenter
        # is available). The result is the subitem's `content`.
        translated_body = ""
        if _translate_markdown is not None:
            try:
                translated_body, body_providers = await asyncio.to_thread(
                    _translate_markdown, body, source_lang, lang, deepl_api_key=deepl_api_key
                )
                providers_used |= {p for p in body_providers if p != "noop"}
            except Exception as exc:
                log.warning(f"translate_row: failed translating body → {lang}: {exc}")
                translated_body = body  # better the original text than nothing

        if not any_translated and not (translated_body and translated_body.strip()):
            skipped.append({"lang": lang, "reason": "no translatable content"})
            continue

        if title_is_translatable and translated_title:
            sub_title = translated_title
        elif first_text_translation:
            sub_title = first_text_translation[:120]
        else:
            sub_title = f"{parent_title} ({lang})" if parent_title else lang
        sub_metadata["translation_provider"] = (
            "mixed" if len(providers_used) > 1 else (next(iter(providers_used), "placeholder"))
        )

        existing = existing_translations.get(lang)
        existing_id = getattr(existing, "id", None) if existing is not None else None
        if existing_id:
            # Materialize the subitem if OneDrive has downloaded it (online-only)
            # so that the patch —which reads it to merge— doesn't fail with errno 35.
            _existing_path = await asyncio.to_thread(find_page_path, existing_id)
            if _existing_path:
                await _materialize_if_online_only(_existing_path, f"translate-patch/{existing_id}")
            # Idempotent update: refresh title, fields and body. We only pass `content`
            # if we translated the body; if not, we leave it as it was (None) so as not to
            # erase a body that the user might have edited manually.
            patch_req = PagePatchRequest(
                title=sub_title,
                metadata=sub_metadata,
                content=(translated_body if (translated_body and translated_body.strip()) else None),
            )
            try:
                await patch_page(existing_id, patch_req, background_tasks)
                await asyncio.to_thread(translation_index.record_translation, item_id, lang, existing_id)
                updated.append({
                    "id": existing_id,
                    "lang": lang,
                    "providers": sorted(providers_used),
                    "title": sub_title,
                })
            except Exception as exc:
                log.error(f"translate_row: failed updating subitem for {lang}: {exc}")
                skipped.append({"lang": lang, "reason": f"update failed: {exc}"})
            continue

        sub_request = PageSaveRequest(
            title=sub_title,
            content=translated_body or "",
            parent_id=item_id,
            metadata=sub_metadata,
        )
        try:
            result = await create_page(sub_request, background_tasks)
            _new_id = result.get("id")
            if _new_id:
                await asyncio.to_thread(translation_index.record_translation, item_id, lang, _new_id)
            created.append({
                "id": _new_id,
                "lang": lang,
                "providers": sorted(providers_used),
                "title": sub_title,
            })
        except Exception as exc:
            log.error(f"translate_row: failed creating subitem for {lang}: {exc}")
            skipped.append({"lang": lang, "reason": f"create failed: {exc}"})

    # action_rules effect on the ORIGINAL: Status "Translated" when at least one
    # translation has been created or updated. DIRECT write to the path we already
    # have (like the staleness flag): without re-resolution by id (the index
    # might be mid-refresh right after creating the child) nor rule
    # engine. It does not re-mark the children as stale (it doesn't touch translatable fields).
    if created or updated:
        _sprop, _svalue, _schanged = action_rules_service.status_effect(
            table, action_rules_service.ACTION_TRANSLATE, "source"
        )
        if _sprop and _svalue is not None:
            if _schanged:
                _ensure_status_options_persisted(table_id, [_svalue])
            _skey = action_rules_service.effect_write_key(metadata, _sprop)
            if _skey:
                await asyncio.to_thread(
                    _write_metadata_key_on_disk, item_id, file_path, _skey, _svalue
                )

    return {
        "item_id": item_id,
        "source_lang": source_lang,
        "created": created,
        "updated": updated,
        "skipped": skipped,
    }


# === Synchronization with Drupal: per-row write ========================
# Creates or updates a Drupal node (and its translations) from a
# Vault row, according to the table's field mapping. Idempotent: anchored
# by `drupal_uuid` (hidden metadata). Resilient to the WAF (create=POST JSON:API,
# update/translate=custom POST endpoints). See drupal_sync_service.py.

# Pseudo-reference in the mapping that associates the page's markdown BODY (not a
# field) into a Drupal rich text field (e.g. `body`).
DRUPAL_BODY_REF = "__body__"


def _drupal_props_by_ref(table: dict) -> dict:
    """Index of the table's properties by stable id and by name."""
    out: Dict[str, dict] = {}
    for p in table.get("properties") or []:
        if p.get("id"):
            out[p["id"]] = p
        if p.get("name"):
            out.setdefault(p["name"], p)
    return out


def _drupal_find_column(table: dict, name: str) -> Optional[dict]:
    """Property by name (case-insensitive); for the NID/URL columns."""
    target = name.strip().lower()
    for p in table.get("properties") or []:
        if (p.get("name") or "").strip().lower() == target:
            return p
    return None


def _drupal_identity_meta(table: dict, uuid, nid, url) -> Dict[str, Any]:
    """Drupal identity metadata to write to the row: hidden keys
    (`drupal_uuid/nid/url`) + the visible columns "Drupal NID" / "Drupal URL"
    if they exist. Shared by the sync and by the title match."""
    meta: Dict[str, Any] = {
        "drupal_uuid": uuid or "",
        "drupal_nid": str(nid) if nid is not None else "",
        "drupal_url": url or "",
    }
    nid_col = _drupal_find_column(table, "Drupal NID")
    url_col = _drupal_find_column(table, "Drupal URL")
    if nid_col:
        meta[nid_col.get("id") or nid_col["name"]] = str(nid) if nid is not None else ""
    if url_col:
        meta[url_col.get("id") or url_col["name"]] = url or ""
    return meta


def _drupal_read_prop_value(metadata: dict, prop: dict):
    """Value of a property in the frontmatter, prioritized title→id→name."""
    is_title = prop.get("type") == "title" or prop.get("name") == "title"
    keys = []
    if is_title:
        keys.append("title")
    if prop.get("id"):
        keys.append(prop["id"])
    if prop.get("name"):
        keys.append(prop["name"])
    for k in keys:
        if k in metadata:
            v = metadata.get(k)
            if v not in (None, "", [], {}):
                return v
    return None


def _drupal_coerce_scalar(value, field_type: Optional[str]):
    """Adapts a Gnosi scalar value to the Drupal field type."""
    if value is None:
        return None
    if field_type in ("integer",):
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return None
    if field_type in ("decimal", "float"):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if isinstance(value, list):
        return ", ".join(str(v) for v in value if v not in (None, ""))
    return str(value)


def _drupal_reanchor_home(p: Path) -> Path:
    """Re-anchors an absolute OneDrive path to the real HOME if it doesn't exist as-is.

    The ``file://`` links from the Library were saved with the username of the
    HOME at the time (e.g. ``/Users/ismaelgarcia/``); if the current HOME is different
    (``/Users/ismaelgarciafernandez/``) the path doesn't resolve. It re-anchors the segment from
    ``/Library/CloudStorage/`` to the real HOME (``HOME_HOST_PATH`` inside the container,
    or ``~``). Returns the candidate if it exists; otherwise, the original path untouched.
    
    """
    try:
        if p.exists():
            return p
        marker = "/Library/CloudStorage/"
        s = str(p)
        idx = s.find(marker)
        if idx < 0:
            return p
        home = os.environ.get("HOME_HOST_PATH") or os.path.expanduser("~")
        candidate = Path(home) / s[idx + 1:]  # "Library/CloudStorage/..."
        if candidate.exists():
            return candidate
    except Exception:
        pass
    return p


def _drupal_resolve_local_path(value) -> Optional[Path]:
    """Resolves the value of an image/file field to a local path on disk.

    Covers the two ways Gnosi stores files: paths relative to the
    Vault (``Assets/...``) and absolute paths / ``file://`` (Library). Re-anchors
    absolute OneDrive paths saved under a different username (``_drupal_reanchor_home``).
    
    """
    if not value:
        return None
    raw = value[0] if isinstance(value, list) else value
    raw = str(raw).strip()
    if not raw:
        return None
    if raw.startswith("file://"):
        from urllib.parse import unquote, urlparse

        return _drupal_reanchor_home(Path(unquote(urlparse(raw).path)))
    p = Path(raw)
    if p.is_absolute():
        return _drupal_reanchor_home(p)
    # Relative path: it's relative to the Vault's Assets folder (same as
    # toServedAssetUrl in the frontend), whether it carries the "Assets/" prefix or not
    # (p. ex. "Articles/x.jpg" → <Vault>/Assets/Articles/x.jpg).
    idx = raw.find("Assets/")
    rel = raw[idx + len("Assets/"):] if idx >= 0 else raw.lstrip("./")
    try:
        return (get_p("ASSETS") / rel).resolve()
    except Exception:
        return None


# Image optimization for WEB before uploading them to Drupal. The
# Vault's images tend to be high-resolution (3-6 MB); we downscale them to 1600px and recompress them
# (JPEG for photos, PNG for flat graphics or ones with transparency) to serve them
# lightweight and avoid the 2 MiB limit of `field_image`. The original in the Vault stays
# intact (only the copy that goes to Drupal is transformed).
_DRUPAL_IMAGE_MAX_BYTES = 1_900_000   # hard cap, under Drupal's 2 MiB limit
_DRUPAL_IMAGE_WEB_TARGET = 450_000    # web target: optimize if the size exceeds ~450 KB
_DRUPAL_IMAGE_MAX_DIM = 1600          # max width/height (px) recommended for web
_DRUPAL_JPEG_QUALITY = 82             # minimum quality recommended for web (good detail, low weight)


def _drupal_shrink_image(data: bytes, filename: str):
    """Optimizes an image for web and returns ``(bytes, filename)``.

    It's applied WHENEVER it improves the file size (not only when it exceeds Drupal's limit):
    downscales to ``_DRUPAL_IMAGE_MAX_DIM`` px and recompresses —JPEG q82 for photos, PNG
    for graphics with few colors or with transparency (preserves sharpness/alpha).
    The extension may change to ``.jpg``. It's a no-op if Pillow isn't available, if it's not an
    image, or if the result would NOT be smaller than the original (never makes it worse).
    CPU-bound: call it inside ``asyncio.to_thread``."""
    try:
        from io import BytesIO
        from PIL import Image
    except Exception:
        return data, filename
    try:
        img = Image.open(BytesIO(data))
        img.load()
    except Exception:
        return data, filename  # not an image that Pillow knows how to open
    fmt = (img.format or "PNG").upper()
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    w, h = img.size
    too_big = max(w, h) > _DRUPAL_IMAGE_MAX_DIM
    # If it's already lightweight AND web-sized, we don't touch it: a re-encode would only degrade it.
    if not too_big and len(data) <= _DRUPAL_IMAGE_WEB_TARGET:
        return data, filename

    if too_big:
        s = _DRUPAL_IMAGE_MAX_DIM / float(max(w, h))
        img = img.resize((max(1, int(w * s)), max(1, int(h * s))), Image.LANCZOS)

    def _png() -> bytes:
        buf = BytesIO()
        mode = "RGBA" if img.mode in ("RGBA", "LA", "P") else "RGB"
        img.convert(mode).save(buf, format="PNG", optimize=True)
        return buf.getvalue()

    def _jpeg(q: int) -> bytes:
        buf = BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=q, optimize=True, progressive=True)
        return buf.getvalue()

    # Real transparency → PNG is needed (preserves alpha).
    has_alpha = False
    try:
        if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
            has_alpha = img.convert("RGBA").getchannel("A").getextrema()[0] < 255
    except Exception:
        has_alpha = (fmt == "PNG")
    # Flat graphic with few colors (logo, illustration) → PNG looks better and weighs little;
    # photo (many colors) → JPEG, much lighter.
    is_graphic = False
    if not has_alpha:
        try:
            is_graphic = img.convert("RGB").getcolors(maxcolors=4096) is not None
        except Exception:
            is_graphic = False

    if has_alpha or is_graphic:
        out = _png()
        return (out, filename) if len(out) < len(data) else (data, filename)

    # Opaque photo → JPEG at web quality; only lower the quality if needed for the hard limit.
    best = data
    for q in (_DRUPAL_JPEG_QUALITY, 75, 65, 55):
        cand = _jpeg(q)
        best = cand
        if len(cand) <= _DRUPAL_IMAGE_MAX_BYTES:
            break
    return (best, f"{stem}.jpg") if len(best) < len(data) else (data, filename)


# The Vault's PDFs (scanned, high-resolution) can weigh dozens of MB and cause
# the upload to fail or fill up the server. Ghostscript recompresses them to a compromise
# reasonable quality/weight (/ebook ≈ 150 dpi) before uploading them, keeping the original
# in the Vault intact.
_DRUPAL_GS_PDF_SETTING = "/ebook"  # ~150 dpi: quality/size trade-off for web


def _drupal_shrink_pdf(data: bytes, filename: str):
    """Compresses a PDF with Ghostscript (``/ebook``) if it reduces the size. Returns
    ``(bytes, filename)``. It's a no-op (returns the original) if it's not a PDF, if ``gs``
    isn't installed (e.g. on the dev host), if the compression fails/exceeds the
    timeout, or if the result isn't smaller. CPU/IO-bound: call it inside
    ``asyncio.to_thread``."""
    if data[:5] != b"%PDF-":
        return data, filename
    import os
    import subprocess
    import tempfile
    try:
        with tempfile.TemporaryDirectory() as td:
            in_path = os.path.join(td, "in.pdf")
            out_path = os.path.join(td, "out.pdf")
            with open(in_path, "wb") as f:
                f.write(data)
            # Argument list (never shell=True) with controlled paths → no injection.
            subprocess.run(
                [
                    "gs", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.4",
                    f"-dPDFSETTINGS={_DRUPAL_GS_PDF_SETTING}",
                    "-dNOPAUSE", "-dQUIET", "-dBATCH",
                    f"-sOutputFile={out_path}", in_path,
                ],
                check=True, capture_output=True, timeout=120,
            )
            if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                with open(out_path, "rb") as f:
                    out = f.read()
                # Validates that the output is a real PDF and strictly smaller.
                if out[:5] == b"%PDF-" and len(out) < len(data):
                    return out, filename
    except Exception as exc:  # Missing gs, timeout, corrupt output… → original.
        log.warning("drupal: PDF compression skipped (%s): %s", filename, exc)
    return data, filename


async def _drupal_upload_field_image(value, bundle, drupal_field, metadata, image_cache):
    """Uploads a local file to an image/file field and returns the JSON:API relationship.

    Materializes OneDrive online-only files before reading them and
    reuses a file already uploaded within the same run (cache per path).
    Returns ``None`` if the file can't be resolved.
    
    """
    from backend.services import drupal_sync_service as drupal

    # COMPOSITE image field {src, alt, title} or string (path) — backward-compatible.
    if isinstance(value, dict):
        src = value.get("src") or value.get("url") or value.get("path")
        comp_alt = value.get("alt")
        comp_title = value.get("title")
    else:
        src, comp_alt, comp_title = value, None, None
    path = _drupal_resolve_local_path(src)
    if not path:
        return None
    await _materialize_if_online_only(path, "drupal-img")
    if not path.exists():
        raise RuntimeError(f"file not found: {path}")
    key = str(path)
    file_uuid = image_cache.get(key)
    if not file_uuid:
        data = await asyncio.to_thread(path.read_bytes)
        # Reduces the size before uploading (keeps the original in the Vault intact): the
        # PDFs with Ghostscript (/ebook), everything else as an image with Pillow. Both
        # are no-ops if they're already small enough or the tool isn't available.
        if data[:5] == b"%PDF-":
            data, upload_name = await asyncio.to_thread(_drupal_shrink_pdf, data, path.name)
        else:
            data, upload_name = await asyncio.to_thread(_drupal_shrink_image, data, path.name)
        # Reuses a file already uploaded to Drupal with the same name and size: avoids
        # creating «_0/_1/…» copies on every re-sync (they were bloating sites/default/files
        # up to hundreds of duplicates of the same image — see find_existing_file).
        file_uuid = await drupal.find_existing_file(upload_name, len(data))
        if not file_uuid:
            file_uuid = await drupal.upload_image(bundle, drupal_field, upload_name, data)
        image_cache[key] = file_uuid
    alt = str(comp_alt or metadata.get("title") or path.stem)
    meta = {"alt": alt}
    if comp_title:
        meta["title"] = str(comp_title)
    return {"data": {"type": "file--file", "id": file_uuid, "meta": meta}}


# Preprocessing of Gnosi markdown before sending it to Drupal: resolves
# wikilinks `[[...]]` (into a link to the node if the target is already synced, or into
# plain text) and strips embeds `![[...]]`. Typography and `:::` blocks are
# handled by Pandoc (see drupal_sync_service.markdown_to_full_html).
_DRUPAL_EMBED_RE = re.compile(r"!\[\[([^\]]+)\]\]")
_DRUPAL_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
_DRUPAL_UUID_RE = re.compile(r"^[0-9a-fA-F-]{32,36}$")


def _drupal_resolve_title_to_id(title: str) -> Optional[str]:
    """Title → page_id via the in-memory index (like /resolve-by-title)."""
    tl = str(title or "").strip().lower()
    if not tl:
        return None
    try:
        from backend.services.context_vars import get_active_vault_path

        v_path = get_active_vault_path()
        if not v_path:
            return None
        with _page_index_lock:
            for entry in list(_page_index_entries.get(str(v_path), {}).values()):
                if str(entry.get("title") or "").strip().lower() == tl:
                    return entry.get("id")
    except Exception:
        return None
    return None


def _drupal_wikilink_url(target: str, cache: dict) -> Optional[str]:
    """Drupal URL of a wikilink target's node (title or uuid), or None."""
    base = target.split("#", 1)[0].strip()
    if not base:
        return None
    if base in cache:
        return cache[base]
    url = None
    pid = base if _DRUPAL_UUID_RE.match(base) else _drupal_resolve_title_to_id(base)
    if pid:
        try:
            fp = find_page_path(pid)
            if fp and fp.exists():
                meta, _ = parse_frontmatter(fp.read_text(encoding="utf-8"), fp)
                url = str(meta.get("drupal_url") or "").strip() or None
        except Exception:
            url = None
    cache[base] = url
    return url


def _drupal_preprocess_md(md: str, *, cache: Optional[dict] = None) -> str:
    """Adapts Gnosi markdown for Drupal: strips embeds and resolves wikilinks."""
    if not md:
        return md
    cache = cache if cache is not None else {}
    md = _DRUPAL_EMBED_RE.sub("", md)  # Embeds/transclusions are not portable.

    def _repl(m):
        inner = m.group(1)
        if "|" in inner:
            target, display = inner.split("|", 1)
            display = display.strip()
        else:
            target = inner
            display = inner.split("#", 1)[0].strip()
        try:
            url = _drupal_wikilink_url(target.strip(), cache)
        except Exception:
            url = None
        return f"[{display}]({url})" if url else display

    return _DRUPAL_WIKILINK_RE.sub(_repl, md)


def _drupal_md_to_html(text: str, wl_cache: dict) -> str:
    """Preprocesses (wikilinks/embeds) and converts to HTML with pandoc. Blocking."""
    from backend.services import drupal_sync_service as drupal

    return drupal.markdown_to_full_html(_drupal_preprocess_md(text or "", cache=wl_cache))


def _drupal_media_signatures(mapping, props_by_ref, field_meta, metadata) -> Dict[str, str]:
    """Signature for NON-text fields (image/file and tags) to detect changes between
    syncs and avoid re-uploading/rewriting what hasn't changed. image/file →
    ``"size:mtime"`` of the source file; entity_reference (tags) → normalized and
    sorted names. Fields with no value or that can't be resolved are skipped. Doesn't materialize files
    (only reads ``stat``), so it's cheap."""
    sigs: Dict[str, str] = {}
    for ref, drupal_field in (mapping or {}).items():
        if not drupal_field:
            continue
        ftype = (field_meta.get(drupal_field) or {}).get("type")
        prop = props_by_ref.get(ref)
        if not prop:
            continue
        value = _drupal_read_prop_value(metadata, prop)
        if value in (None, "", [], {}):
            continue
        if ftype in ("image", "file"):
            src = value.get("src") if isinstance(value, dict) else value
            try:
                path = _drupal_resolve_local_path(src)
                if path and path.exists():
                    st = path.stat()
                    sigs[drupal_field] = f"{st.st_size}:{int(st.st_mtime)}"
            except Exception:
                pass
        elif ftype == "entity_reference":
            raw = value if isinstance(value, list) else re.split(r"[;,]", str(value))
            names = sorted(s for s in (str(x).strip().lower() for x in raw) if s)
            if names:
                sigs[drupal_field] = "tags:" + "|".join(names)
    return sigs


async def _drupal_build_fields(
    *, mapping, props_by_ref, field_meta, metadata, body, bundle,
    term_cache, image_cache, text_only=False, media_only=False,
):
    """Builds (attributes, relationships, skipped) for a record.

    ``field_meta``: ``{field_name: {"type":.., "vocab":..}}``. With ``text_only``
    only text/scalars/body are built — taxonomy and image in Drupal are
    fields shared between translations, they aren't translated. With ``media_only``
    the NON-text fields shared between translations are built: image/file
    **and taxonomy (tags)** — to re-push them when updating an already existing node
    (the text path doesn't touch them). Note: if a row ends up with no tags, the field
    isn't sent and old tags are NOT cleared in Drupal (only added/replaced).
    
    """
    from backend.services import drupal_sync_service as drupal

    attributes: Dict[str, Any] = {}
    relationships: Dict[str, Any] = {}
    skipped: list = []
    wl_cache: Dict[str, Any] = {}  # wikilink resolution cache for this call
    for ref, drupal_field in (mapping or {}).items():
        if not drupal_field:
            continue
        meta = field_meta.get(drupal_field) or {}
        ftype = meta.get("type")
        if ref == DRUPAL_BODY_REF:
            if media_only:
                continue
            if not (body or "").strip():
                continue  # empty body: don't send it (avoids clearing the body in Drupal)
            html = await asyncio.to_thread(_drupal_md_to_html, body, wl_cache)
            attributes[drupal_field] = {"value": html, "format": "full_html"}
            continue
        prop = props_by_ref.get(ref)
        if not prop:
            continue
        value = _drupal_read_prop_value(metadata, prop)
        if value in (None, "", [], {}):
            continue
        if ftype in ("text_with_summary", "text_long"):
            if media_only:
                continue
            html = await asyncio.to_thread(_drupal_md_to_html, str(value), wl_cache)
            attributes[drupal_field] = {"value": html, "format": "full_html"}
        elif ftype == "entity_reference":
            # Tags: shared non-text field → included on create and on re-push
            # media (media_only), but NOT in the text-only path (text_only).
            if text_only:
                continue
            vocab = meta.get("vocab") or "tags"
            names = value if isinstance(value, list) else re.split(r"[;,]", str(value))
            data = []
            for name in names:
                name = str(name).strip()
                if not name:
                    continue
                try:
                    tid = await drupal.resolve_or_create_term(vocab, name, cache=term_cache)
                    data.append({"type": f"taxonomy_term--{vocab}", "id": tid})
                except drupal.DrupalSyncError as exc:
                    skipped.append({"field": drupal_field, "value": name, "reason": str(exc)})
            if data:
                relationships[drupal_field] = {"data": data}
        elif ftype in ("image", "file"):
            if text_only:
                continue
            try:
                rel = await _drupal_upload_field_image(value, bundle, drupal_field, metadata, image_cache)
                if rel:
                    relationships[drupal_field] = rel
            except Exception as exc:
                skipped.append({"field": drupal_field, "reason": f"image: {exc}"})
        else:
            if media_only:
                continue
            coerced = _drupal_coerce_scalar(value, ftype)
            if coerced is not None:
                attributes[drupal_field] = coerced
    return attributes, relationships, skipped


def _drupal_sibling_rows(table_id, nid, exclude_id):
    """Sibling rows: other records in the same table linked to the SAME
    Drupal node (same nid), each in its own language. For tables where
    translations are separate rows (not subitems)."""
    if not nid:
        return []
    out = []
    try:
        for p in _get_pages_for_table(table_id):
            if p.id == exclude_id:
                continue
            md = p.metadata or {}
            if md.get("translation_lang"):
                continue
            if str(md.get("drupal_nid") or "") == str(nid) and str(md.get("drupal_uuid") or "").strip():
                out.append(p)
    except Exception as exc:
        log.warning(f"sync-drupal: sibling lookup failed: {exc}")
    return out


_DRUPAL_LANGCODES_CACHE = None


async def _drupal_langcodes() -> set:
    """Langcodes configured in Drupal (process cache). E.g. {'ca','es','en-gb'}."""
    global _DRUPAL_LANGCODES_CACHE
    if _DRUPAL_LANGCODES_CACHE is not None:
        return _DRUPAL_LANGCODES_CACHE
    from backend.services import drupal_sync_service as drupal
    langs: set = set()
    try:
        async with drupal._client() as c:
            r = await c.get(
                "/jsonapi/configurable_language/configurable_language",
                params={"fields[configurable_language--configurable_language]": "drupal_internal__id"},
            )
        for l in (r.json() or {}).get("data", []):
            code = (l.get("attributes") or {}).get("drupal_internal__id")
            if code and str(code).lower() not in ("und", "zxx"):
                langs.add(str(code).lower())
    except Exception as exc:
        log.warning(f"drupal: could not read the configured languages: {exc}")
    _DRUPAL_LANGCODES_CACHE = langs
    return langs


async def _drupal_resolve_langcode(metadata: dict) -> str:
    """Maps the row's Language field to the REAL Drupal langcode, which may be
    regional (e.g. 'en-gb', not 'en'). If there's no match, falls back to 2-letter
    normalization."""
    langs = await _drupal_langcodes()
    raw = detect_record_lang_raw(metadata)  # 'en-gb'
    if raw and langs:
        if raw in langs:
            return raw
        pref = raw.split("-")[0].split("_")[0]
        if pref in langs:
            return pref
    code = detect_record_source_lang(metadata)  # 'en' (two letters)
    if code and (not langs or code in langs):
        return code
    return code or "en"


_DRUPAL_FIELD_TRANSLATABLE_CACHE: dict = {}


async def _drupal_uuid_to_fid(file_uuid):
    """uuid of a Drupal file → its internal fid. Needed to set field_image on
    translations: the TranslationController does a generic set() and the image field
    expects ``{target_id: fid, alt: ...}`` (not the JSON:API relationship format by uuid)."""
    if not file_uuid:
        return None
    from backend.services import drupal_sync_service as drupal
    try:
        async with drupal._client() as c:
            r = await c.get(
                f"/jsonapi/file/file/{file_uuid}",
                params={"fields[file--file]": "drupal_internal__fid"},
            )
        return ((r.json() or {}).get("data") or {}).get("attributes", {}).get("drupal_internal__fid")
    except Exception as exc:
        log.warning("drupal: uuid→fid ha fallat: %s", exc)
        return None


async def _drupal_field_translatable(bundle: str, field_name: str) -> bool:
    """True if the bundle's field is TRANSLATABLE in Drupal (cache). If so, each
    translation needs its own value (e.g. field_image with its own alt)."""
    key = f"{bundle}.{field_name}"
    if key in _DRUPAL_FIELD_TRANSLATABLE_CACHE:
        return _DRUPAL_FIELD_TRANSLATABLE_CACHE[key]
    from backend.services import drupal_sync_service as drupal
    val = False
    try:
        async with drupal._client() as c:
            r = await c.get(
                "/jsonapi/field_config/field_config",
                params={
                    "filter[field_name]": field_name, "filter[bundle]": bundle,
                    "fields[field_config--field_config]": "translatable",
                },
            )
        data = (r.json() or {}).get("data") or []
        if data:
            val = bool(data[0].get("attributes", {}).get("translatable"))
    except Exception as exc:
        log.warning("drupal: could not read 'translatable' for %s: %s", field_name, exc)
    _DRUPAL_FIELD_TRANSLATABLE_CACHE[key] = val
    return val


def _drupal_image_mapping(mapping, field_meta):
    """(ref_prop, drupal_field) of the first image/file field in the mapping, or (None, None)."""
    for ref, dfield in (mapping or {}).items():
        if dfield and (field_meta.get(dfield) or {}).get("type") in ("image", "file"):
            return ref, dfield
    return None, None


def _drupal_row_image_alt(metadata, props_by_ref, image_ref) -> str:
    """Image alt text for a row: from the {src,alt} composite, or from an orphaned 'Alt'
    field (unmigrated rows), or the title as a fallback."""
    if image_ref:
        prop = props_by_ref.get(image_ref)
        if prop:
            val = _drupal_read_prop_value(metadata, prop)
            if isinstance(val, dict) and val.get("alt"):
                return str(val["alt"])
    for k, v in (metadata or {}).items():
        if "alt" in str(k).lower() and isinstance(v, str) and v.strip():
            return v.strip()
    return str((metadata or {}).get("title") or "")


async def _drupal_row_text_fields(page_id, *, mapping, props_by_ref, field_meta, bundle, term_cache, image_cache):
    """Reads a row and builds its TEXT fields (for add_translation).
    Returns (fields, langcode) or (None, None) if it can't be read."""
    fp = await asyncio.to_thread(find_page_path, page_id)
    if not fp or not fp.exists():
        return None, None, None
    await _materialize_if_online_only(fp, "drupal-sync")
    raw = await asyncio.to_thread(fp.read_text, encoding="utf-8")
    meta, bdy = parse_frontmatter(raw, fp)
    # Derived fields (`type:'virtual'`, e.g. «Progress») aren't saved to the .md:
    # they're injected on read so the sync can map them to Drupal.
    _vf_table = _table_by_id(get_table_id(meta))
    if _vf_table:
        await asyncio.to_thread(
            _vf_inject_for_single_page, _vf_table, str(meta.get("id") or page_id),
            meta, _vf_page_loader,
        )
    fields, _, _ = await _drupal_build_fields(
        mapping=mapping, props_by_ref=props_by_ref, field_meta=field_meta,
        metadata=meta, body=bdy, bundle=bundle,
        term_cache=term_cache, image_cache=image_cache, text_only=True,
    )
    if fields and not fields.get("title"):
        fields["title"] = str(meta.get("title") or "Sense títol")
    return fields, (await _drupal_resolve_langcode(meta)), meta


async def _do_sync_drupal_row(item_id: str, *, background_tasks: BackgroundTasks, publish: bool = True, scope: str = "all", push_media: bool = False) -> dict:
    """Creates or updates a row's Drupal node.

    ``scope``:
      - ``"all"``: this row's language + all translations (subitems) and
        sibling rows (same node, one record per language).
      - ``"lang_only"``: only this row's language.
    Creating a new node uploads image/tags; updating only touches the TEXT of
    the corresponding language (``add_translation``), without re-uploading the image.
    With ``push_media`` the image (and its alt) is also re-uploaded and re-linked
    when updating an already existing node.
    With ``publish=False`` the new node is created unpublished.
    
    """
    from backend.services import drupal_sync_service as drupal

    file_path = await asyncio.to_thread(find_page_path, item_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {item_id})")
    await _materialize_if_online_only(file_path, "drupal-sync")
    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = parse_frontmatter(raw_content, file_path)

    table_id = get_table_id(metadata)
    table = _table_by_id(table_id) if table_id else None
    if not table:
        raise HTTPException(status_code=400, detail="Row is not part of a table")
    if not table.get("drupal_sync_enabled"):
        raise HTTPException(status_code=400, detail="Drupal sync is not enabled on this table")
    # Injects derived fields (e.g. «Progress») before building the Drupal fields.
    await asyncio.to_thread(
        _vf_inject_for_single_page, table, str(metadata.get("id") or item_id),
        metadata, _vf_page_loader,
    )
    # action_rules safeguard («a draft cannot be synced»): the
    # backend always revalidates what the frontend already shows as a disabled button.
    _ok, _reason = action_rules_service.check_requires(
        table, action_rules_service.ACTION_SYNC_DRUPAL, metadata
    )
    if not _ok:
        raise HTTPException(status_code=409, detail=_reason)
    bundle = (table.get("drupal_bundle") or "").strip()
    mapping = table.get("drupal_field_mapping") or {}
    if not bundle or not mapping:
        raise HTTPException(status_code=400, detail="Drupal content type or field mapping not configured")

    props_by_ref = _drupal_props_by_ref(table)
    try:
        drupal_fields = await drupal.list_fields(bundle)
    except drupal.DrupalSyncError as exc:
        raise HTTPException(status_code=502, detail=f"Drupal: {exc}")
    field_meta: Dict[str, dict] = {}
    for f in drupal_fields:
        ftype = f.get("field_type")
        vocab = None
        if ftype == "entity_reference":
            tbs = f.get("target_bundles") or []
            vocab = tbs[0] if tbs else "tags"
        field_meta[f["field_name"]] = {"type": ftype, "vocab": vocab}
    term_cache: Dict[str, str] = {}
    image_cache: Dict[str, str] = {}

    source_lang = await _drupal_resolve_langcode(metadata)
    skipped_fields: list = []
    languages: list = []

    # TEXT fields of this row (to update its language without re-uploading
    # the image). The full build (image/tags) is only done when CREATING the node.
    text_attrs, _, _ = await _drupal_build_fields(
        mapping=mapping, props_by_ref=props_by_ref, field_meta=field_meta,
        metadata=metadata, body=body, bundle=bundle,
        term_cache=term_cache, image_cache=image_cache, text_only=True,
    )
    if not text_attrs.get("title"):
        text_attrs["title"] = str(metadata.get("title") or "Sense títol")

    # TRANSLATABLE field_image: prepares a shared file (uploaded once, from the
    # main record) to set it on EACH translation with its own alt. If
    # the field isn't translatable, Drupal shares it automatically and there's no need to do it per language.
    image_ref, image_field = _drupal_image_mapping(mapping, field_meta)
    shared_img_fid = None
    if image_field and await _drupal_field_translatable(bundle, image_field):
        main_img = _drupal_read_prop_value(metadata, props_by_ref.get(image_ref)) if image_ref else None
        if main_img not in (None, "", [], {}):
            try:
                rel = await _drupal_upload_field_image(main_img, bundle, image_field, metadata, image_cache)
                if rel:
                    shared_img_fid = await _drupal_uuid_to_fid(rel.get("data", {}).get("id"))
            except Exception as exc:
                skipped_fields.append({"field": image_field, "reason": f"image(trad): {exc}"})

    def _img_field(meta):
        """field_image for a translation: shared file + this row's alt."""
        if not (shared_img_fid and image_field):
            return {}
        return {image_field: {"target_id": shared_img_fid, "alt": _drupal_row_image_alt(meta, props_by_ref, image_ref)}}

    drupal_uuid = (str(metadata.get("drupal_uuid") or "")).strip() or None
    prev_url = (str(metadata.get("drupal_url") or "")).strip() or None
    nid = None
    url = None
    created = False
    # Avoids DUPLICATES: if the row isn't linked but a node with the
    # exact same title already exists, link to it (and update) instead of creating a
    # new one (which Drupal would disambiguate with a '-0' alias). If there's >1 (there's already a
    # duplicate), we don't auto-disambiguate: it falls back to creating and needs manual cleanup.
    if not drupal_uuid:
        title_txt = str(metadata.get("title") or "").strip()
        try:
            matches = await drupal.find_nodes_by_title(bundle, title_txt) if title_txt else []
        except drupal.DrupalSyncError:
            matches = []
        if len(matches) == 1:
            drupal_uuid = matches[0]["uuid"]
            nid = matches[0].get("nid")
            url = matches[0].get("url")
            log.info("sync-drupal: '%s' linked by title to node %s (avoids duplicate)", title_txt[:40], nid)
    try:
        if drupal_uuid:
            # Updates ONLY this row's language (text), at the correct langcode.
            try:
                r = await drupal.add_translation(drupal_uuid, source_lang, {**text_attrs, **_img_field(metadata)})
                nid = r.get("nid")
                url = prev_url or (f"{drupal.base_url()}/node/{nid}" if nid else prev_url)
                languages.append(source_lang)
            except drupal.DrupalNotFound:
                drupal_uuid = None  # stale uuid → create anew
        if not drupal_uuid:
            # NEW node: full build (image/tags/body) in the row's language.
            full_attrs, relationships, skipped_fields = await _drupal_build_fields(
                mapping=mapping, props_by_ref=props_by_ref, field_meta=field_meta,
                metadata=metadata, body=body, bundle=bundle,
                term_cache=term_cache, image_cache=image_cache,
            )
            if not full_attrs.get("title"):
                full_attrs["title"] = str(metadata.get("title") or "Sense títol")
            create_attrs = full_attrs if publish else {**full_attrs, "status": False}
            res = await drupal.create_node(bundle, create_attrs, relationships, langcode=source_lang)
            drupal_uuid = res.get("uuid")
            nid = res.get("nid")
            url = res.get("url")
            created = True
            languages.append(source_lang)
    except drupal.DrupalSyncError as exc:
        msg = str(exc)
        # Common case: the article requires `field_image` but the image couldn't
        # be prepared (too large even after reducing, missing, or invalid format).
        # Clear message instead of Drupal's raw 422/502.
        if "field_image" in msg:
            img_reason = next(
                (s.get("reason") for s in (skipped_fields or [])
                 if "image" in str(s.get("reason", ""))),
                None,
            )
            detail = "This article needs a valid image smaller than 2 MB before it can be published to Drupal."
            if img_reason:
                detail += f" Detail: {img_reason}"
            raise HTTPException(status_code=400, detail=detail)
        raise HTTPException(status_code=502, detail=f"Drupal: {exc}")

    # --- Re-push media (image/file) and tags on UPDATE ---
    # On create, media and tags are already included; the text update path doesn't
    # touches. With push_media they are re-uploaded/rewritten via update_node (shared fields
    # between translations → it's enough to do it once for the node). Detection of
    # change: only re-uploaded if the media/tags signature differs from the last sync,
    # to avoid needlessly re-uploading and creating+deleting files in Drupal on every touch.
    media_pushed = False
    cur_media_sig = None
    if push_media and drupal_uuid and not created:
        cur_media_sig = _drupal_media_signatures(mapping, props_by_ref, field_meta, metadata)
        prev_media_sig = metadata.get("drupal_media_sig") or {}
        if cur_media_sig != prev_media_sig:
            _ma, media_rels, media_skipped = await _drupal_build_fields(
                mapping=mapping, props_by_ref=props_by_ref, field_meta=field_meta,
                metadata=metadata, body=body, bundle=bundle,
                term_cache=term_cache, image_cache=image_cache, media_only=True,
            )
            if media_skipped:
                skipped_fields.extend(media_skipped)
            if media_rels:
                try:
                    await drupal.update_node(drupal_uuid, bundle, {}, media_rels)
                    media_pushed = True
                except drupal.DrupalSyncError as exc:
                    skipped_fields.append({"field": "media", "reason": str(exc)})

    # --- "whole node" scope: translations (subitems) + sibling rows ---
    translations: list = []
    if scope == "all" and drupal_uuid:
        # 1) Translations as subitems (parent + child subitems).
        existing = await _get_existing_translations(item_id)
        for lang, page in (existing or {}).items():
            sub_id = getattr(page, "id", None)
            if not sub_id:
                continue
            tfields, tlang, tmeta = await _drupal_row_text_fields(
                sub_id, mapping=mapping, props_by_ref=props_by_ref, field_meta=field_meta,
                bundle=bundle, term_cache=term_cache, image_cache=image_cache)
            tlang = tlang or lang  # REAL Drupal langcode (e.g. en-gb, not en)
            if not tfields:
                translations.append({"lang": tlang, "status": "skipped (sense text)"})
                continue
            try:
                await drupal.add_translation(drupal_uuid, tlang, {**tfields, **_img_field(tmeta)})
                translations.append({"lang": tlang, "status": "ok"})
                languages.append(tlang)
            except drupal.DrupalSyncError as exc:
                translations.append({"lang": tlang, "status": f"error: {exc}"})
        # 2) Sibling rows: other records of the same node (one per language).
        siblings = await asyncio.to_thread(_drupal_sibling_rows, table_id, nid, item_id)
        for sib in siblings:
            tfields, sib_lang, smeta = await _drupal_row_text_fields(
                sib.id, mapping=mapping, props_by_ref=props_by_ref, field_meta=field_meta,
                bundle=bundle, term_cache=term_cache, image_cache=image_cache)
            if not tfields or not sib_lang:
                continue
            try:
                await drupal.add_translation(drupal_uuid, sib_lang, {**tfields, **_img_field(smeta)})
                translations.append({"lang": sib_lang, "row": sib.id, "status": "ok"})
                languages.append(sib_lang)
            except drupal.DrupalSyncError as exc:
                translations.append({"lang": sib_lang, "row": sib.id, "status": f"error: {exc}"})

    # --- Writes identity to the row (visible columns + hidden metadata) ---
    meta_update = _drupal_identity_meta(table, drupal_uuid, nid, url)
    # action_rules effect on success: Status → «Published to Drupal» (decision §9.3
    # from the directive). Travels in the same patch as the identity.
    _eprop, _evalue, _echanged = action_rules_service.status_effect(
        table, action_rules_service.ACTION_SYNC_DRUPAL, "source"
    )
    if _eprop and _evalue is not None:
        if _echanged:
            _ensure_status_options_persisted(table_id, [_evalue])
        meta_update[action_rules_service.effect_write_key(metadata, _eprop)] = _evalue
    # Saves the media/tags signature for the next sync's change detection,
    # EXCLUDING the fields that failed (skipped) so they get retried and don't remain
    # marked as synced without actually having been uploaded.
    if cur_media_sig is not None:
        _failed = {s.get("field") for s in (skipped_fields or []) if s.get("field")}
        meta_update["drupal_media_sig"] = {k: v for k, v in cur_media_sig.items() if k not in _failed}
    try:
        await patch_page(item_id, PagePatchRequest(metadata=meta_update), background_tasks)
    except Exception as exc:
        log.error(f"sync-drupal: failed writing identity back to {item_id}: {exc}")

    return {
        "item_id": item_id,
        "uuid": drupal_uuid,
        "nid": nid,
        "url": url,
        "created": created,
        "media_pushed": media_pushed,
        "source_lang": source_lang,
        "scope": scope,
        "languages": sorted(set(languages)),
        "translations": translations,
        "skipped_fields": skipped_fields,
    }


# --- Sync with Drupal --------------------------------------------
# Discovery (read) of Drupal content types and fields to feed the
# the "Sync with Drupal" checkbox and the mapping editor of the config of the
# table. The per-row write (sync-drupal-row) is further down, next to
# translate-row. Client: `backend/services/drupal_sync_service.py`.


@router.get("/drupal/content-types", dependencies=[Depends(require_role("editor"))])
async def drupal_content_types():
    """Drupal content type for the table config dropdown."""
    from backend.services import drupal_sync_service as drupal

    try:
        return {"content_types": await drupal.list_content_types()}
    except drupal.DrupalSyncError as exc:
        raise HTTPException(status_code=502, detail=f"Drupal: {exc}")


@router.get(
    "/drupal/content-types/{bundle}/fields",
    dependencies=[Depends(require_role("editor"))],
)
async def drupal_content_type_fields(bundle: str):
    """Fields of a Drupal content type for the mapping editor."""
    from backend.services import drupal_sync_service as drupal

    try:
        return {"bundle": bundle, "fields": await drupal.list_fields(bundle)}
    except drupal.DrupalSyncError as exc:
        raise HTTPException(status_code=502, detail=f"Drupal: {exc}")


@router.post("/skills/sync-drupal-row", dependencies=[Depends(require_role("editor"))])
async def sync_drupal_row(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    """Creates or updates a row's Drupal node (and its translations).

    Body: ``{ "item_id": "<uuid>", "button_action": "sync_drupal" }``.
    Idempotent (anchored by `drupal_uuid`). Writes nid/url to the row's
    columns and the uuid to the hidden metadata.
    
    """
    item_id = (payload.get("item_id") or "").strip()
    button_action = payload.get("button_action") or "sync_drupal"
    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    if button_action != "sync_drupal":
        raise HTTPException(status_code=400, detail=f"Unsupported button_action: {button_action}")
    publish = payload.get("publish", True)
    scope = payload.get("scope") or "all"
    if scope not in ("all", "lang_only"):
        scope = "all"
    push_media = bool(payload.get("push_media", True))
    result = await _do_sync_drupal_row(
        item_id, background_tasks=background_tasks, publish=bool(publish),
        scope=scope, push_media=push_media,
    )
    return {"status": "ok", **result}


@router.post("/skills/sync-drupal-rows", dependencies=[Depends(require_role("editor"))])
async def sync_drupal_rows(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    """Bulk variant of sync-drupal-row. Each row is independent; per-row errors
    are reported in `errors` instead of aborting the batch."""
    item_ids = payload.get("item_ids") or []
    if not isinstance(item_ids, list) or not item_ids:
        raise HTTPException(status_code=400, detail="item_ids must be a non-empty list")
    scope = payload.get("scope") or "all"
    if scope not in ("all", "lang_only"):
        scope = "all"
    publish = bool(payload.get("publish", True))
    push_media = bool(payload.get("push_media", True))
    results: list = []
    errors: list = []
    for iid in item_ids:
        try:
            results.append(await _do_sync_drupal_row(
                str(iid), background_tasks=background_tasks,
                publish=publish, scope=scope, push_media=push_media,
            ))
        except HTTPException as exc:
            errors.append({"item_id": iid, "detail": exc.detail})
        except Exception as exc:
            errors.append({"item_id": iid, "detail": str(exc)})
    return {"status": "ok", "results": results, "errors": errors}


@router.post("/skills/match-drupal-rows", dependencies=[Depends(require_role("editor"))])
async def match_drupal_rows(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    """Links rows to **existing** Drupal nodes by title, without creating anything.

    Searches each row by exact title; if it finds exactly one, writes
    nid/url/uuid to the row (doesn't touch Drupal). Skips translation subitems and rows
    already linked. With ``dry_run`` (default True) only reports what it would do.

    Body: ``{table_id, bundle?, item_ids?, dry_run?}``.
    
    """
    from backend.services import drupal_sync_service as drupal

    table_id = (payload.get("table_id") or "").strip()
    if not table_id:
        raise HTTPException(status_code=400, detail="table_id is required")
    table = _table_by_id(table_id)
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    bundle = (payload.get("bundle") or table.get("drupal_bundle") or "").strip()
    if not bundle:
        raise HTTPException(status_code=400, detail="Drupal bundle not configured (pass `bundle` or enable sync)")
    dry_run = bool(payload.get("dry_run", True))
    only_ids = payload.get("item_ids")
    wanted = set(str(i) for i in only_ids) if isinstance(only_ids, list) and only_ids else None

    rows = await asyncio.to_thread(_get_pages_for_table, table_id)

    matched: list = []
    unmatched: list = []
    ambiguous: list = []
    for p in rows:
        if wanted is not None and p.id not in wanted:
            continue
        md = p.metadata or {}
        if md.get("translation_lang"):
            continue  # translation subitem: covered by the parent node
        if str(md.get("drupal_uuid") or "").strip():
            continue  # Already linked.
        title = (p.title or md.get("title") or "").strip()
        if not title:
            continue
        try:
            found = await drupal.find_nodes_by_title(bundle, title)
        except drupal.DrupalSyncError as exc:
            unmatched.append({"row_id": p.id, "title": title, "reason": str(exc)})
            continue
        if len(found) == 1:
            m = found[0]
            entry = {"row_id": p.id, "title": title, "nid": m["nid"], "url": m["url"], "uuid": m["uuid"]}
            if not dry_run:
                try:
                    meta = _drupal_identity_meta(table, m["uuid"], m["nid"], m["url"])
                    await patch_page(p.id, PagePatchRequest(metadata=meta), background_tasks)
                    entry["applied"] = True
                except Exception as exc:
                    entry["applied"] = False
                    entry["error"] = str(exc)
            matched.append(entry)
        elif not found:
            unmatched.append({"row_id": p.id, "title": title})
        else:
            ambiguous.append({"row_id": p.id, "title": title, "nids": [m["nid"] for m in found]})

    return {
        "status": "ok",
        "dry_run": dry_run,
        "bundle": bundle,
        "counts": {"matched": len(matched), "unmatched": len(unmatched), "ambiguous": len(ambiguous)},
        "matched": matched,
        "unmatched": unmatched,
        "ambiguous": ambiguous,
    }


@router.post(
    "/skills/translate-row",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("translation"))],
)
async def translate_row(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    """Translate the translatable fields of a row to one subitem per language.

    Body:
        {
          "item_id": "<uuid of the row>",
          "target_languages": ["en", "es", ...],
          "button_action": "translate_row"  # validated; rejects others
        }

    The row's table must have `translation_enabled: true` and at least one
    property marked with `translatable: true`. For each target language a new
    subitem is created (`parent_id = item_id`), with the translated values
    keyed by the same property `id`/`name` as the parent row. Re-running updates
    the existing per-language subitem in place (idempotent) instead of
    duplicating it.
    """
    item_id = (payload.get("item_id") or "").strip()
    target_languages = payload.get("target_languages") or []
    button_action = payload.get("button_action") or "translate_row"

    if not item_id:
        raise HTTPException(status_code=400, detail="item_id is required")
    if not isinstance(target_languages, list) or not target_languages:
        raise HTTPException(status_code=400, detail="target_languages must be a non-empty list")
    if button_action != "translate_row":
        raise HTTPException(status_code=400, detail=f"Unsupported button_action: {button_action}")

    translate_fn, detect_fn = _load_translate_row_skill()
    deepl_api_key = _read_deepl_key()

    result = await _do_translate_row(
        item_id,
        target_languages,
        translate_fn=translate_fn,
        detect_fn=detect_fn,
        deepl_api_key=deepl_api_key,
        background_tasks=background_tasks,
    )
    return {"status": "ok", **result}


@router.post(
    "/skills/translate-rows",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("translation"))],
)
async def translate_rows(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    """Bulk variant of translate-row: translate many selected rows at once.

    Body:
        {
          "item_ids": ["<uuid>", ...],
          "target_languages": ["en", "es", ...],
          "button_action": "translate_row"  # validated; rejects others
        }

    Each row is processed independently and idempotently (see `_do_translate_row`).
    A per-row failure (e.g. a selected row whose table isn't translatable) is
    reported in `errors` rather than aborting the whole batch.
    """
    item_ids = payload.get("item_ids") or []
    target_languages = payload.get("target_languages") or []
    button_action = payload.get("button_action") or "translate_row"

    if not isinstance(item_ids, list) or not item_ids:
        raise HTTPException(status_code=400, detail="item_ids must be a non-empty list")
    if not isinstance(target_languages, list) or not target_languages:
        raise HTTPException(status_code=400, detail="target_languages must be a non-empty list")
    if button_action != "translate_row":
        raise HTTPException(status_code=400, detail=f"Unsupported button_action: {button_action}")

    translate_fn, detect_fn = _load_translate_row_skill()
    deepl_api_key = _read_deepl_key()

    results: list = []
    errors: list = []
    seen: set = set()
    for raw_id in item_ids:
        item_id = raw_id.strip() if isinstance(raw_id, str) else ""
        if not item_id or item_id in seen:
            continue
        seen.add(item_id)
        try:
            res = await _do_translate_row(
                item_id,
                target_languages,
                translate_fn=translate_fn,
                detect_fn=detect_fn,
                deepl_api_key=deepl_api_key,
                background_tasks=background_tasks,
            )
            results.append(res)
        except HTTPException as exc:
            errors.append({"item_id": item_id, "detail": exc.detail})
        except Exception as exc:
            log.error(f"translate_rows: unexpected error for {item_id}: {exc}")
            errors.append({"item_id": item_id, "detail": str(exc)})

    return {"status": "ok", "count": len(results), "results": results, "errors": errors}


@router.post("/skills/generate-button-action", dependencies=[Depends(require_role("editor"))])
async def generate_button_action(payload: dict = Body(...)):
    """Generates structured button action configuration using LLM based on user prompt."""
    user_prompt = (payload.get("prompt") or "").strip()
    fields = payload.get("fields") or []

    if not user_prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    from backend.agent.factory import generate_text
    import json
    import re

    field_names = [f.get("name") for f in fields if isinstance(f, dict) and f.get("name")]

    system_instruction = (
        "You are an AI assistant helping configure table button actions in a database application.\n"
        f"Available table fields: {', '.join(field_names) if field_names else 'Title'}\n\n"
        "Given the user's natural language request, output ONLY a valid JSON object (no markdown wrapping) with these keys:\n"
        "{\n"
        '  "button_label": "<Short button label max 20 characters>",\n'
        '  "button_action": "set_fields" | "ai_prompt" | "run_skill",\n'
        '  "button_config": {\n'
        '    "assignments": [\n'
        '       { "field": "<field_name>", "value": "<literal or formula like today()>" }\n'
        '    ],\n'
        '    "prompt": "<prompt text for ai_prompt>",\n'
        '    "target_field": "<target field_name for ai_prompt>",\n'
        '    "skill_id": "<skill id for run_skill>"\n'
        '  }\n'
        "}\n"
    )

    try:
        raw_resp, _ = await asyncio.to_thread(generate_text, system_instruction, user_prompt)
        cleaned = (raw_resp or "").strip()
        if cleaned.startswith("```"):
            cleaned = re.sub(r"^```[a-z]*\n", "", cleaned)
            cleaned = re.sub(r"\n```$", "", cleaned)
        data = json.loads(cleaned.strip())
        return {"status": "ok", "result": data}
    except Exception as e:
        log.error(f"Error generating button action: {e}")
        return {
            "status": "ok",
            "result": {
                "button_label": "Acció IA",
                "button_action": "ai_prompt",
                "button_config": {
                    "prompt": user_prompt,
                    "target_field": field_names[0] if field_names else "title"
                }
            }
        }


@router.post("/skills/execute-button-action", dependencies=[Depends(require_role("editor"))])
async def execute_button_action(payload: dict = Body(...)):
    """Executes a custom AI prompt or Skill button action on a note/row."""
    note_id = (payload.get("note_id") or "").strip()
    button_action = (payload.get("button_action") or "").strip()
    button_config = payload.get("button_config") or {}

    if not note_id:
        raise HTTPException(status_code=400, detail="note_id is required")

    file_path = await asyncio.to_thread(find_page_path, note_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {note_id})")

    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = parse_frontmatter(raw_content, file_path)
    title = metadata.get("title") or file_path.stem

    if button_action == "ai_prompt":
        user_prompt = (button_config.get("prompt") or "").strip()
        target_field = (button_config.get("target_field") or "").strip()
        if not user_prompt:
            raise HTTPException(status_code=400, detail="Prompt is required for ai_prompt action")
        if not target_field:
            raise HTTPException(status_code=400, detail="target_field is required for ai_prompt action")

        from backend.agent.factory import generate_text
        import json

        context_str = f"Title: {title}\nMetadata: {json.dumps(metadata, ensure_ascii=False)}\nContent: {body[:1000]}"
        full_instruction = f"Task: {user_prompt}\nProvide ONLY the result value to set for field '{target_field}'. Do not include formatting or commentary unless requested."

        output_val, _ = await asyncio.to_thread(generate_text, full_instruction, context_str)
        cleaned_val = (output_val or "").strip()

        metadata[target_field] = cleaned_val
        metadata["last_edited_at"] = datetime.now().isoformat()
        save_page_md(file_path, metadata, body)

        return {
            "status": "ok",
            "note_id": note_id,
            "updated_field": target_field,
            "value": cleaned_val,
            "metadata": metadata,
        }
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported button_action for server execution: {button_action}")



@router.post(
    "/skills/translate-page",
    dependencies=[Depends(require_role("editor")), Depends(require_plugins("translation"))],
)
async def translate_page(background_tasks: BackgroundTasks, payload: dict = Body(...)):
    """Translate a Vault page (title + markdown body) into one child page per language.

    Body:
        {
          "page_id": "<uuid of the page>",
          "target_languages": ["en", "es", ...],
          "button_action": "translate_page"  # validated; rejects others
        }

    For each target language a child page is created (`parent_id = page_id`) with the
    translated title and body. Gnosi's enriched-markdown directives (code fences, `:::`
    blocks, wikilinks, citations, bibliography, transclusions) are preserved by the
    `translate_page` skill's segmenter. Mirrors `translate_row` but for whole documents.
    """
    page_id = (payload.get("page_id") or "").strip()
    target_languages = payload.get("target_languages") or []
    button_action = payload.get("button_action") or "translate_page"

    if not page_id:
        raise HTTPException(status_code=400, detail="page_id is required")
    if not isinstance(target_languages, list) or not target_languages:
        raise HTTPException(status_code=400, detail="target_languages must be a non-empty list")
    if button_action != "translate_page":
        raise HTTPException(status_code=400, detail=f"Unsupported button_action: {button_action}")

    # Defer the import so a missing dependency doesn't break the whole API —
    # translation is opt-in per page.
    try:
        from pipeline.skills.translate_page.scripts.markdown_segmenter import (
            translate_markdown as _translate_markdown,
            translate_title as _translate_title,
            detect_source_lang as _detect_source_lang,
        )
    except Exception as exc:
        log.error(f"translate_page skill not importable: {exc}")
        raise HTTPException(status_code=500, detail="translate_page skill unavailable")

    # Read the DeepL API key from the Keychain (same source as translate_row).
    deepl_api_key = ""
    try:
        from backend.security.keychain_manager import get_keychain
        kc = get_keychain()
        if kc.has_credential("deepl_api_key"):
            deepl_api_key = kc.get_credential("deepl_api_key") or ""
    except Exception as exc:
        log.warning(f"translate_page: keychain unavailable, using env fallback: {exc}")

    # 1. Locate and read the source page.
    file_path = await asyncio.to_thread(find_page_path, page_id)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail=f"Page not found (ID: {page_id})")
    raw_content = await asyncio.to_thread(file_path.read_text, encoding="utf-8")
    metadata, body = parse_frontmatter(raw_content, file_path)
    parent_title = str(metadata.get("title") or "")

    # 2. Source language: the record's "Language" field governs (if the page is a
    # table record and has one); otherwise heuristics on the body/title.
    source_lang = detect_record_source_lang(metadata)
    if not source_lang:
        sample = body.strip() if body and body.strip() else parent_title
        source_lang = _detect_source_lang(sample) if sample else "en"

    # Sync worker run off the event loop: each segment is a blocking HTTP call.
    def _translate_page_content(src_lang: str, tgt_lang: str):
        providers = set()
        t_title, title_provider = _translate_title(
            parent_title, src_lang, tgt_lang, deepl_api_key=deepl_api_key
        )
        if title_provider != "noop":
            providers.add(title_provider)
        t_body, body_providers = _translate_markdown(
            body, src_lang, tgt_lang, deepl_api_key=deepl_api_key
        )
        providers |= {p for p in body_providers if p != "noop"}
        return t_title, t_body, providers

    # 3. Translate per language and create (or idempotently update) one child page each.
    existing_translations = await _get_existing_translations(page_id)
    created = []
    updated = []
    skipped = []

    for lang in target_languages:
        if not isinstance(lang, str) or not lang.strip():
            continue
        lang = lang.strip().lower()
        if lang == source_lang:
            skipped.append({"lang": lang, "reason": "same as source"})
            continue

        try:
            translated_title, translated_body, providers_used = await asyncio.to_thread(
                _translate_page_content, source_lang, lang
            )
        except Exception as exc:
            log.error(f"translate_page: failed translating page {page_id} → {lang}: {exc}")
            skipped.append({"lang": lang, "reason": f"translate failed: {exc}"})
            continue

        sub_title = translated_title or (f"{parent_title} ({lang})" if parent_title else lang)
        sub_metadata: Dict[str, Any] = {
            "translation_lang": lang,
            "translation_source_lang": source_lang,
            "translation_origin_id": page_id,
            # A fresh translation is, by definition, up to date with the origin.
            "translation_stale": False,
            "translation_provider": (
                "mixed" if len(providers_used) > 1 else next(iter(providers_used), "noop")
            ),
        }

        existing = existing_translations.get(lang)
        existing_id = getattr(existing, "id", None) if existing is not None else None
        if existing_id:
            # Idempotent update: refresh the existing subpage's title + body in place.
            patch_req = PagePatchRequest(
                title=sub_title, content=translated_body, metadata=sub_metadata
            )
            try:
                await patch_page(existing_id, patch_req, background_tasks)
                updated.append({
                    "id": existing_id,
                    "lang": lang,
                    "providers": sorted(providers_used),
                    "title": sub_title,
                })
            except Exception as exc:
                log.error(f"translate_page: failed updating child page for {lang}: {exc}")
                skipped.append({"lang": lang, "reason": f"update failed: {exc}"})
            continue

        sub_request = PageSaveRequest(
            title=sub_title,
            content=translated_body,
            parent_id=page_id,
            metadata=sub_metadata,
        )
        try:
            result = await create_page(sub_request, background_tasks)
            created.append({
                "id": result.get("id"),
                "lang": lang,
                "providers": sorted(providers_used),
                "title": sub_title,
            })
        except Exception as exc:
            log.error(f"translate_page: failed creating child page for {lang}: {exc}")
            skipped.append({"lang": lang, "reason": f"create failed: {exc}"})

    return {
        "status": "ok",
        "page_id": page_id,
        "source_lang": source_lang,
        "created": created,
        "updated": updated,
        "skipped": skipped,
    }


# -----------------------------------------------------------------------------
# PDF annotations
# -----------------------------------------------------------------------------
# Persistent annotations from the integrated PDF viewer. See
# `backend/models/pdf_annotation.py` for the model and fields. The table lives
# in the active vault's DB, whose schema reaches the reusable Vault Alembic
# head before get_engine_for_path exposes a session.

from sqlalchemy.orm import Session as _AnnSession
from backend.data.db import get_db as _ann_get_db
from backend.models.pdf_annotation import PdfAnnotation as _PdfAnnotation


class _PdfAnnotationCreate(BaseModel):
    source_uri: str
    page: int
    type: str
    color: Optional[str] = "#ffeb3b"
    rects: Optional[List[Dict[str, float]]] = None
    text: Optional[str] = None
    comment: Optional[str] = None
    tags: Optional[str] = None


class _PdfAnnotationUpdate(BaseModel):
    color: Optional[str] = None
    rects: Optional[List[Dict[str, float]]] = None
    text: Optional[str] = None
    comment: Optional[str] = None
    tags: Optional[str] = None


def _pdf_annotation_to_dict(ann: _PdfAnnotation) -> Dict[str, Any]:
    return {
        "id": ann.id,
        "source_uri": ann.source_uri,
        "page": ann.page,
        "type": ann.type,
        "color": ann.color,
        "rects": json.loads(ann.rects_json) if ann.rects_json else [],
        "text": ann.text,
        "comment": ann.comment,
        "tags": ann.tags,
        "created_at": ann.created_at.isoformat() if ann.created_at else None,
        "updated_at": ann.updated_at.isoformat() if ann.updated_at else None,
    }


@router.get("/pdf-annotations")
def list_pdf_annotations(
    source_uri: str = Query(..., min_length=1),
    db: _AnnSession = Depends(_ann_get_db),
):
    """Lists all annotations associated with a PDF (by `source_uri`).

    Sorted by ascending page + creation date, so the sidebar
    can show them in natural reading order.
    
    """
    items = (
        db.query(_PdfAnnotation)
        .filter(_PdfAnnotation.source_uri == source_uri)
        .order_by(_PdfAnnotation.page.asc(), _PdfAnnotation.created_at.asc())
        .all()
    )
    return [_pdf_annotation_to_dict(i) for i in items]


@router.post(
    "/pdf-annotations",
    dependencies=[Depends(require_role("editor"))],
)
def create_pdf_annotation(
    body: _PdfAnnotationCreate,
    db: _AnnSession = Depends(_ann_get_db),
):
    # Supported types: those from the old pdf.js viewer (highlight, underline,
    # strikeout, comment, area) PLUS the ones emitted by the Zotero reader (text,
    # note, ink, image). Without these last ones, saves coming from the
    # the built-in reader would return 400 and the frontend would silently lose them.
    if body.type not in {
        "highlight", "underline", "strikeout", "comment", "area",
        "text", "note", "ink", "image",
    }:
        raise HTTPException(status_code=400, detail=f"Unsupported annotation type: {body.type}")
    ann = _PdfAnnotation(
        source_uri=body.source_uri,
        page=body.page,
        type=body.type,
        color=body.color or "#ffeb3b",
        rects_json=json.dumps(body.rects) if body.rects else None,
        text=body.text,
        comment=body.comment,
        tags=body.tags,
    )
    db.add(ann)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@router.patch(
    "/pdf-annotations/{ann_id}",
    dependencies=[Depends(require_role("editor"))],
)
def update_pdf_annotation(
    ann_id: int,
    body: _PdfAnnotationUpdate,
    db: _AnnSession = Depends(_ann_get_db),
):
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    if body.color is not None:
        ann.color = body.color
    if body.comment is not None:
        ann.comment = body.comment
    if body.tags is not None:
        ann.tags = body.tags
    if body.text is not None:
        ann.text = body.text
    if body.rects is not None:
        ann.rects_json = json.dumps(body.rects)
    db.commit()
    db.refresh(ann)
    return _pdf_annotation_to_dict(ann)


@router.delete(
    "/pdf-annotations/{ann_id}",
    dependencies=[Depends(require_role("editor"))],
)
def delete_pdf_annotation(
    ann_id: int,
    db: _AnnSession = Depends(_ann_get_db),
):
    ann = db.query(_PdfAnnotation).filter(_PdfAnnotation.id == ann_id).first()
    if not ann:
        raise HTTPException(status_code=404, detail="Annotation not found")
    db.delete(ann)
    db.commit()
    return {"status": "ok", "id": ann_id}
