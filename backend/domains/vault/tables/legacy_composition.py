"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from collections.abc import Callable
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")
from backend.api.virtual_fields import inject_for_single_page as _vf_inject_for_single_page
from backend.api.virtual_fields import inject_for_table as _vf_inject_for_table
from backend.api.virtual_fields import list_virtual_field_specs as _vf_list_specs
from backend.domains.vault.api import history as history_api
from backend.domains.vault.api import pages_commands as page_commands_api
from backend.domains.vault.api import pages_duplicate as page_duplicate_api
from backend.domains.vault.api import pages_queries as page_queries_api
from backend.domains.vault.api import trash as trash_api
from backend.domains.vault.daily import service as daily_notes_service
from backend.domains.vault.drawings import service as drawing_service
from backend.domains.vault.drupal import core as drupal_core
from backend.domains.vault.drupal import fields as drupal_fields
from backend.domains.vault.drupal import languages as drupal_languages
from backend.domains.vault.drupal import markdown as drupal_markdown
from backend.domains.vault.drupal import matching as drupal_matching
from backend.domains.vault.drupal import media as drupal_media
from backend.domains.vault.drupal import service as drupal_service
from backend.domains.vault.history.repository import HistoryRepository
from backend.domains.vault.pages import create_service as page_create_service
from backend.domains.vault.pages import index_entries as page_index_entries
from backend.domains.vault.pages import index_service as page_index_service
from backend.domains.vault.pages import markdown_writer as page_markdown_writer
from backend.domains.vault.pages import metadata_mutations
from backend.domains.vault.pages import patch_helpers as page_patch_helpers
from backend.domains.vault.pages import patch_service as page_patch_service
from backend.domains.vault.pages import resolver as page_resolver
from backend.domains.vault.pages import save_helpers as page_save_helpers
from backend.domains.vault.pages import save_service as page_save_service
from backend.domains.vault.pages import tags as tags_query
from backend.domains.vault.pages.cache import PAGES_RESPONSE_CACHE_TTL as _PAGES_RESP_CACHE_TTL
from backend.domains.vault.pages.cache import PREVIEW_CACHE_MAX as _PREVIEW_CACHE_MAX
from backend.domains.vault.pages.cache import get_cached_page_response as _pages_cache_get
from backend.domains.vault.pages.cache import get_cached_preview as _preview_cache_get
from backend.domains.vault.pages.cache import get_indexer_status
from backend.domains.vault.pages.cache import get_page_write_lock as _get_page_write_lock
from backend.domains.vault.pages.cache import invalidate_cached_preview as _preview_cache_invalidate
from backend.domains.vault.pages.cache import (
    invalidate_page_responses as _pages_cache_invalidate_all,
)
from backend.domains.vault.pages.cache import set_cached_page_response as _pages_cache_set
from backend.domains.vault.pages.cache import set_cached_preview as _preview_cache_set
from backend.domains.vault.pages.cache import set_indexer_status as _set_indexer_status
from backend.domains.vault.pages.identifiers import HISTORY_TIMESTAMP_RE as _HISTORY_TIMESTAMP_RE
from backend.domains.vault.pages.identifiers import PAGE_ID_RE as _PAGE_ID_RE
from backend.domains.vault.pages.identifiers import (
    validate_history_timestamp as _validate_history_timestamp,
)
from backend.domains.vault.pages.identifiers import validate_safe_page_id as _validate_safe_page_id
from backend.domains.vault.pages.index_entries import (
    build_cache_entry_from_memory as _build_cache_entry_from_memory,
)
from backend.domains.vault.pages.index_entries import (
    build_page_cache_entry as _build_page_cache_entry,
)
from backend.domains.vault.pages.index_entries import (
    humanize_relation_index_title as _humanize_relation_index_title,
)
from backend.domains.vault.pages.index_entries import is_metadata_stub as _is_metadata_stub
from backend.domains.vault.pages.index_entries import (
    read_frontmatter_partial as _read_frontmatter_partial,
)
from backend.domains.vault.pages.index_service import (
    bump_page_index_version as _bump_page_index_version,
)
from backend.domains.vault.pages.index_service import (
    get_cached_page_entries as _get_cached_page_entries,
)
from backend.domains.vault.pages.index_service import get_pages_snapshot as _get_pages_snapshot
from backend.domains.vault.pages.index_service import (
    refresh_page_index_entry as _refresh_page_index_entry,
)
from backend.domains.vault.pages.index_service import (
    refresh_table_pages_metadata as _refresh_table_pages_metadata,
)
from backend.domains.vault.pages.state import page_state
from backend.domains.vault.registry import api as registry_api
from backend.domains.vault.registry import defaults as registry_defaults
from backend.domains.vault.registry.names import (
    is_main_or_locked_view as registry_is_main_or_locked_view,
)
from backend.domains.vault.registry.names import main_view_fields as registry_main_view_fields
from backend.domains.vault.registry.names import (
    normalize_main_view_configuration as registry_normalize_main_view_configuration,
)
from backend.domains.vault.registry.names import (
    normalize_registry_table_view_names as registry_normalize_table_view_names,
)
from backend.domains.vault.registry.names import (
    normalize_table_view_name as registry_normalize_table_view_name,
)
from backend.domains.vault.registry.names import sort_key_name as registry_sort_key_name
from backend.domains.vault.registry.names import table_name_from_registry as registry_table_name
from backend.domains.vault.registry.repository import (
    RegistryRepository,
    RegistryRepositoryDependencies,
)
from backend.domains.vault.registry.state import registry_state
from backend.domains.vault.schemas.pages import (
    PageInfo,
    PagePatchRequest,
    PageSaveRequest,
    SidebarPageInfo,
    TablePagesSnapshot,
    _BulkWarmPayload,
)
from backend.domains.vault.tables import api as table_collection_api
from backend.domains.vault.tables import formula_recalculation
from backend.domains.vault.tables import lifecycle as table_lifecycle
from backend.domains.vault.tables import options as table_options
from backend.domains.vault.tables import routes as table_routes
from backend.domains.vault.tables import rows as table_rows
from backend.domains.vault.tables import schema as table_schema
from backend.domains.vault.tables import status_options as table_status_options
from backend.domains.vault.tables.composition import TableDomainDependencies
from backend.domains.vault.tables.routes import _create_table_locked as _create_table_locked
from backend.domains.vault.tables.routes import _ensure_main_view as _ensure_main_view
from backend.domains.vault.tables.routes import _find_table_and_prop as _find_table_and_prop
from backend.domains.vault.tables.routes import _global_status_members as _global_status_members
from backend.domains.vault.tables.routes import _option_value_keys as _option_value_keys
from backend.domains.vault.tables.routes import (
    _patch_table_property_locked as _patch_table_property_locked,
)
from backend.domains.vault.tables.routes import (
    _propagate_property_rename as _propagate_property_rename,
)
from backend.domains.vault.tables.routes import (
    _reconcile_table_schema_revision as _reconcile_table_schema_revision,
)
from backend.domains.vault.tables.routes import (
    _rename_field_in_filter_tree as _rename_field_in_filter_tree,
)
from backend.domains.vault.tables.routes import (
    _rename_field_refs_in_view_like as _rename_field_refs_in_view_like,
)
from backend.domains.vault.tables.routes import _rename_table_locked as _rename_table_locked
from backend.domains.vault.tables.routes import (
    _resolve_subpath_within_vault as _resolve_subpath_within_vault,
)
from backend.domains.vault.tables.routes import _rewrite_option_in_rows as _rewrite_option_in_rows
from backend.domains.vault.tables.routes import _schema_revision as _schema_revision
from backend.domains.vault.tables.routes import _table_schema_signature as _table_schema_signature
from backend.domains.vault.tables.routes import create_database as create_database
from backend.domains.vault.tables.routes import create_table as create_table
from backend.domains.vault.tables.routes import create_view as create_view
from backend.domains.vault.tables.routes import delete_database as delete_database
from backend.domains.vault.tables.routes import delete_option_catalog as delete_option_catalog
from backend.domains.vault.tables.routes import delete_table as delete_table
from backend.domains.vault.tables.routes import delete_view as delete_view
from backend.domains.vault.tables.routes import get_schema as get_schema
from backend.domains.vault.tables.routes import get_view as get_view
from backend.domains.vault.tables.routes import get_view_usage as get_view_usage
from backend.domains.vault.tables.routes import list_databases as list_databases
from backend.domains.vault.tables.routes import list_option_catalogs as list_option_catalogs
from backend.domains.vault.tables.routes import list_tables as list_tables
from backend.domains.vault.tables.routes import list_views as list_views
from backend.domains.vault.tables.routes import patch_table_property as patch_table_property
from backend.domains.vault.tables.routes import put_option_catalog as put_option_catalog
from backend.domains.vault.tables.routes import remove_table_option as remove_table_option
from backend.domains.vault.tables.routes import rename_table as rename_table
from backend.domains.vault.tables.routes import rename_table_option as rename_table_option
from backend.domains.vault.tables.routes import reorder_views as reorder_views
from backend.domains.vault.tables.routes import save_schema as save_schema
from backend.domains.vault.tables.routes import table_option_usage as table_option_usage
from backend.domains.vault.tables.routes import update_view as update_view
from backend.domains.vault.translation import adapters as translation_adapters
from backend.domains.vault.translation import lookup as translation_lookup
from backend.domains.vault.translation import metadata_io as translation_metadata_io
from backend.domains.vault.translation import page_service as translation_page_service
from backend.domains.vault.translation import row_service as translation_row_service
from backend.domains.vault.translation import staleness as translation_staleness
from backend.domains.vault.trash import purge as trash_purge
from backend.domains.vault.trash.repository import TrashRepository
from backend.domains.vault.views import api as vault_views
from backend.domains.vault.views import schema as vault_view_schema
from backend.domains.vault.views import snapshots as vault_view_snapshots
from backend.platform import translation_server as translation_server_transport
from backend.platform.files import get_files_provider
from backend.services import action_rules as action_rules_service
from backend.services import builtin_plugins, translation_index
from backend.services import option_catalogs as option_catalogs_service
from backend.services import relation_sync as relation_rules
from backend.services.context_vars import active_vault_path, get_active_vault_path
from backend.services.field_resolver import to_response_names, to_storage_names
from backend.services.media_service import media_service
from backend.services.relation_links import (
    RELATION_WIKILINK_RE,
    TITLE_ONLY_WIKILINK_RE,
    decorate_relation_wikilinks,
    relation_keys_from_table,
    strip_relation_wikilinks,
)
from backend.services.relation_links import _decorate_item as _decorate_relation_item
from backend.services.table_system_dates import ensure_system_date_properties, stamp_system_dates
from backend.services.translation_helpers import (
    detect_record_lang_raw,
    detect_record_source_lang,
    find_translations_of,
    is_composite_image_value,
    is_image_field_name,
    language_field_assignment,
    translatable_content_changed,
    translate_image_field,
)
from backend.services.view_snapshot import DEFAULT_MAX_ITEMS as _VIEW_SNAPSHOT_DEFAULT_LIMIT
from backend.services.view_snapshot import (
    apply_joins,
    compact_view_fences,
    flatten_view_columns,
    inject_view_snapshots,
    rematerialize_md,
    render_view_snapshots,
    resolve_row_ids,
    resolve_rows,
    restore_view_fences,
    strip_view_snapshots,
)
from backend.services.workspace_service import WorkspaceContext, get_workspace_context

registry_repository = RegistryRepository(
    dependencies=RegistryRepositoryDependencies(
        registry_path=lambda: _legacy.get_p("REGISTRY"),
        normalize_folder=lambda value: _legacy._normalize_rel_folder(value),
        ensure_table_folder=lambda table, registry: _legacy._ensure_table_vault_folder(
            table, registry
        ),
        ensure_status_catalog=lambda registry: _ensure_registry_status_catalog(registry),
        write_json=_legacy.safe_write_json,
    ),
    state=registry_state,
    logger=_legacy.log,
)
registry_api_dependencies = registry_api.RegistryApiDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    sort_key=lambda item: _legacy._sort_key_name(item),
    safe_error_detail=_legacy.safe_error_detail,
    logger=_legacy.log,
)
default_registry_dependencies = registry_defaults.DefaultRegistryDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    registry_path=lambda: _legacy.get_p("REGISTRY"),
    overwrite_is_risky=lambda path: _legacy._degenerate_overwrite_is_risky(path),
    state=registry_state,
    logger=_legacy.log,
)
table_collection_dependencies = table_collection_api.TableCollectionDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    sort_key=lambda item: _legacy._sort_key_name(item),
)
table_property_dependencies = table_schema.PropertyDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    get_prop_options=option_catalogs_service.get_prop_options,
    set_prop_options=option_catalogs_service.set_prop_options,
    normalize_options=option_catalogs_service.normalize_options,
    option_types=frozenset(option_catalogs_service.OPTION_TYPES),
)
table_create_dependencies = table_lifecycle.CreateTableDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    configured_language=lambda: _configured_table_language(),
    ensure_system_dates=ensure_system_date_properties,
    normalize_folder=lambda value: _legacy._normalize_rel_folder(value),
    sanitize_folder=_legacy.sanitize_rel_folder,
    is_asset_property=lambda prop: _legacy._is_asset_property(prop),
    delete_asset_property=lambda table, database, name: _legacy._delete_asset_property_dir(
        table, database, name
    ),
    ensure_asset_directories=lambda table, registry: _legacy._ensure_asset_dirs_for_table_entry(
        table, registry
    ),
    ensure_table_folder=lambda table, registry: _legacy._ensure_table_vault_folder(table, registry),
    ensure_table_seeds=option_catalogs_service.ensure_table_seeds,
    ensure_global_status_catalog=option_catalogs_service.ensure_global_status_catalog,
    ensure_action_rules=action_rules_service.ensure_action_rules,
)
table_delete_dependencies = table_lifecycle.DeleteTableDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    vault_root=lambda: _legacy.get_p("VAULT"),
    stable_revision=lambda value: _legacy._stable_value_revision(value),
    views_revision=lambda registry, table_id: _legacy._table_views_revision(registry, table_id),
    quarantine_assets=lambda table, database: _legacy._quarantine_table_asset_dirs(table, database),
    quarantined_revision=lambda table, database, moved: _legacy._quarantined_table_asset_revision(
        table, database, moved
    ),
    restore_quarantine=lambda quarantine, moved: _legacy._restore_quarantined_table_assets(
        quarantine, moved
    ),
    mark_quarantine_ready=lambda quarantine: _legacy._mark_table_asset_quarantine_ready(quarantine),
    delete_quarantine=lambda quarantine, vault_root: _legacy._delete_table_asset_quarantine(
        quarantine, vault_root
    ),
    logger=_legacy.log,
)
table_rename_dependencies = table_lifecycle.RenameTableDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    assets_root=lambda: _legacy.get_p("ASSETS"),
    sanitize_title=_legacy.sanitize_vault_title,
    sanitize_folder=_legacy.sanitize_rel_folder,
    sanitize_asset_segment=lambda value, fallback: _legacy._sanitize_asset_segment(value, fallback),
    asset_segments_collide=lambda first, second: _legacy._asset_segments_collide(first, second),
    move_loose_files=lambda source, destination: _legacy._move_loose_files(source, destination),
    table_vault_directory=lambda table, registry: _legacy._table_vault_dir(table, registry),
    ensure_asset_directories=lambda table, registry: _legacy._ensure_asset_dirs_for_table_entry(
        table, registry
    ),
    ensure_table_folder=lambda table, registry: _legacy._ensure_table_vault_folder(table, registry),
    rewrite_inline_asset_refs=lambda table_dir, old, new: _legacy._rewrite_inline_asset_refs(
        table_dir, old, new
    ),
    logger=_legacy.log,
)
table_option_dependencies = table_options.OptionDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    pages_for_table=lambda table_id: _legacy._get_pages_for_table(table_id),
    find_page=lambda page_id, allow_full_scan=True: _legacy.find_page_path(
        page_id, allow_full_scan=allow_full_scan
    ),
    materialize=lambda path, reason: _legacy._materialize_if_online_only(path, reason),
    parse_frontmatter=lambda raw, path: _legacy.parse_frontmatter(raw, path),
    save_page=lambda path, metadata, body: _legacy.save_page_md(path, metadata, body),
    refresh_page_cache=lambda path, metadata, body, row: _refresh_option_rewrite_cache(
        path, metadata, body, row
    ),
    invalidate_page_responses=_pages_cache_invalidate_all,
    read_prop_value=action_rules_service.read_prop_value,
    get_prop_config=option_catalogs_service.get_prop_config,
    get_prop_options=option_catalogs_service.get_prop_options,
    set_prop_options=option_catalogs_service.set_prop_options,
    normalize_options=option_catalogs_service.normalize_options,
    auto_color=option_catalogs_service.auto_color,
    is_global_status_prop=option_catalogs_service.is_global_status_prop,
    status_catalog_ref=option_catalogs_service.STATUS_CATALOG_REF,
    logger=_legacy.log,
)
vault_view_dependencies = vault_views.ViewDependencies(
    load_registry=lambda: _legacy.load_registry(),
    save_registry=lambda data: _legacy.save_registry(data),
    registry_mutation=lambda: _legacy.registry_mutation(),
    sort_key=lambda item: _legacy._sort_key_name(item),
    pages_snapshot=lambda: _get_pages_snapshot(),
    logger=_legacy.log,
)
vault_schema_dependencies = vault_view_schema.SchemaDependencies(
    vault_root=lambda: _legacy.get_p("VAULT"),
    write_json=lambda path, data, indent: _legacy.safe_write_json(path, data, indent=indent),
    logger=_legacy.log,
)
table_row_query_dependencies: table_rows.TableRowQueryDependencies
def _rematerialize_snapshot(
    markdown: str,
    page_id: str,
    *,
    resolve_ids: Callable[[str, str | None], list[str]],
    id_to_title: Callable[[str], str | None],
    config_for: Callable[[str], dict[str, _LegacyAny]],
    resolve_table: Callable[
        [str, str | None], vault_view_snapshots.SnapshotTable | None
    ],
) -> str:
    result = rematerialize_md(
        markdown,
        page_id,
        resolve_ids,
        id_to_title=id_to_title,
        config_for=config_for,
        resolve_table=resolve_table,
    )
    if not isinstance(result, str):
        raise TypeError("Snapshot rematerialization must return Markdown text")
    return result


vault_view_snapshot_dependencies = vault_view_snapshots.SnapshotDependencies(
    pages_for_table=lambda table_id: _legacy._get_pages_for_table(table_id),
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    inject_virtual_fields=_vf_inject_for_table,
    virtual_page_loader=lambda table_id: table_rows.virtual_page_loader(
        table_id, table_row_query_dependencies
    ),
    response_names=lambda metadata, table: to_response_names(metadata, table),
    load_registry=lambda: _legacy.load_registry(),
    apply_joins=apply_joins,
    resolve_row_ids=resolve_row_ids,
    resolve_rows=resolve_rows,
    decorate_relation=lambda value: _decorate_relation_item(
        value, _legacy._link_index_title_for, None
    ),
    link_title=lambda page_id: _legacy._link_index_title_for(page_id),
    default_limit=_VIEW_SNAPSHOT_DEFAULT_LIMIT,
    documents=lambda: _legacy._iter_linkable_page_documents(),
    resolve_page_id=lambda metadata, path: _legacy._resolve_page_id_from_metadata(metadata, path),
    rematerialize=_rematerialize_snapshot,
    write_text=lambda path, content: _legacy.safe_write_text(path, content),
    logger=_legacy.log,
)
table_row_query_dependencies = table_rows.TableRowQueryDependencies(
    vault_cache_key=lambda: _legacy._vault_cache_key(),
    cache_get=lambda key: _pages_cache_get(key),
    cache_set=lambda key, pages: _pages_cache_set(key, pages),
    cached_entries=lambda: _get_cached_page_entries(force_refresh=False),
    load_registry=lambda: _legacy.load_registry(),
    hidden_event_ids=lambda: _hidden_calendar_event_ids(),
    humanize_title=lambda title, metadata: _humanize_relation_index_title(title, metadata),
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    refresh_metadata=lambda pages: _refresh_table_pages_metadata(pages),
    inject_virtual_fields=_vf_inject_for_table,
    response_names=lambda metadata, table: to_response_names(metadata, table),
    vault_root=lambda: _legacy.get_p("VAULT"),
    logger=_legacy.log,
)
table_metadata_dependencies = table_rows.TableMetadataDependencies(
    table_id=lambda metadata: _legacy.get_table_id(metadata),
    table_by_id=lambda table_id: _legacy._table_by_id(table_id),
    storage_names=lambda metadata, table: to_storage_names(metadata, table),
    stamp_system_dates=stamp_system_dates,
    option_types=frozenset(option_catalogs_service.OPTION_TYPES),
    prop_config=option_catalogs_service.get_prop_config,
    read_prop_value=action_rules_service.read_prop_value,
    effect_write_key=action_rules_service.effect_write_key,
)
table_domain_dependencies = TableDomainDependencies(
    collections=table_collection_dependencies,
    properties=table_property_dependencies,
    create_table=table_create_dependencies,
    delete_table=table_delete_dependencies,
    rename_table=table_rename_dependencies,
    options=table_option_dependencies,
    views=vault_view_dependencies,
    folder_schema=vault_schema_dependencies,
    row_queries=table_row_query_dependencies,
    row_metadata=table_metadata_dependencies,
)
table_routes.configure(table_domain_dependencies)
_registry_cache = registry_state.cache
_registry_cache_mtime = registry_state.cache_mtime
_registry_cache_ts = registry_state.cache_timestamp
_registry_cache_ttl_seconds = registry_state.cache_ttl_seconds
_registry_ensured_tables = registry_state.ensured_tables
_registry_seen_nondegenerate = registry_state.seen_nondegenerate
_registry_mutation_lock = registry_state.mutation_lock


def _ensure_registry_status_catalog(registry: dict[_LegacyAny, _LegacyAny]) -> bool:
    """Run the optional legacy status-catalog migrator when it is available."""
    ensure_status_catalog = getattr(option_catalogs_service, "ensure_global_status_catalog", None)
    return bool(ensure_status_catalog(registry) if callable(ensure_status_catalog) else False)


def _configured_table_language() -> str:
    try:
        return str(_legacy.load_params(strict_env=False).settings.get("language") or "en")
    except Exception:
        return "en"


def _refresh_option_rewrite_cache(
    file_path: _legacy.Path, metadata: dict[_LegacyAny, _LegacyAny], body: str, row: PageInfo
) -> None:
    """Refresh the existing page-index owner after an option row rewrite."""
    vault_path = _legacy.get_active_vault_path()
    if not vault_path:
        return
    vault_key = str(vault_path)
    stat_result = file_path.stat()
    entry = _build_cache_entry_from_memory(file_path, stat_result, metadata, body)
    with _legacy._page_index_lock:
        _legacy._page_index_entries.setdefault(vault_key, {})[str(file_path)] = entry
        _legacy._page_id_to_path.setdefault(vault_key, {})[str(metadata.get("id") or row.id)] = str(
            file_path
        )
        _bump_page_index_version(vault_key)


def _hidden_calendar_event_ids() -> set[str]:
    from backend.api.calendar_routes import _get_hidden_event_ids

    return {str(value) for value in _get_hidden_event_ids()}


from backend.domains.vault.assets import api as assets_api
from backend.domains.vault.assets import service as assets_service
from backend.domains.vault.assets.schemas import CustomIconsRequest, IconUrlImportRequest
from backend.domains.vault.assets.state import CustomIconStore, normalize_custom_icons
from backend.domains.vault.citations import authors as citation_authors
from backend.domains.vault.citations import exporting as citation_exporting
from backend.domains.vault.citations import formatting as citation_formatting
from backend.domains.vault.citations import io_api as citation_io_api
from backend.domains.vault.citations import keys as citation_keys
from backend.domains.vault.citations import keys_api as citation_keys_api
from backend.domains.vault.citations import metadata_lookup, reference_configuration
from backend.domains.vault.citations import pdf_fallback as citation_pdf_fallback
from backend.domains.vault.citations import references_api as citation_references_api
from backend.domains.vault.citations import search as citation_search
from backend.domains.vault.citations import web_capture as citation_web_capture
from backend.domains.vault.citations.references_api import REFERENCE_SCHEMA as _REFERENCE_SCHEMA
from backend.domains.vault.citations.state import citation_index_state
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
)
from backend.domains.vault.comments.state import page_comments_io_lock as _comments_lock
from backend.domains.vault.comments.state import (
    page_comments_mutation_lock as _comments_mutation_lock,
)
from backend.domains.vault.files import api as files_api
from backend.domains.vault.files import host_trash as file_host_trash
from backend.domains.vault.files import local_service as file_local_service
from backend.domains.vault.files import property_service as property_file_service
from backend.domains.vault.files import serving as file_serving
from backend.domains.vault.files import thumbnails as file_thumbnails
from backend.domains.vault.files.state import LocalLinkStore, file_serving_state
from backend.domains.vault.files.thumbnails import ThumbnailDependencies
from backend.domains.vault.links import document_cache as link_document_cache
from backend.domains.vault.links import document_inventory as link_document_inventory
from backend.domains.vault.links import index_service as link_index_service
from backend.domains.vault.links import parsing as link_parsing
from backend.domains.vault.links import relation_sync as relation_sync_domain
from backend.domains.vault.links.api import mentions as link_mentions_api
from backend.domains.vault.links.api import navigation as link_navigation_api
from backend.domains.vault.links.api import overview as link_overview_api
from backend.domains.vault.links.api import preview as link_preview_api
from backend.domains.vault.links.api.dependencies import LinkApiDependencies
from backend.domains.vault.links.schemas import LinkMentionsRequest
from backend.domains.vault.links.state import LinkIndexView, link_index_state


def _table_by_id(table_id: str) -> dict[_LegacyAny, _LegacyAny] | None:
    """Return one table through the canonical registry domain."""
    return _strict_cast(
        dict[_LegacyAny, _LegacyAny] | None,
        registry_api.table_by_id(table_id, registry_api_dependencies),
    )


from backend.services.library_paths import library_roots as _library_roots
from backend.services.library_paths import resolve_library as _resolve_library
