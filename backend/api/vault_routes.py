import hashlib as hashlib
import json as json
import logging
import os as os
import re as re
import shutil as shutil
import subprocess
import sys as sys
import threading as threading
import time as time
import urllib.parse
import uuid as uuid
from contextlib import contextmanager
from datetime import datetime as datetime, timedelta, timezone as timezone
from pathlib import Path as Path
from typing import TYPE_CHECKING, Any, Dict, Iterable, List, Optional, Tuple, cast

if TYPE_CHECKING:
    from fastapi import BackgroundTasks as BackgroundTasks, Body as Body, UploadFile as UploadFile, Query as Query, File as File, Request as Request
    from contextlib import AbstractContextManager as _typed_ContextManager
    from collections.abc import Callable as _typed_DeclaredCallable
    from backend.domains.vault.assets import api as _typed_assets_api
    from backend.domains.vault.assets.state import normalize_custom_icons as normalize_custom_icons
    from backend.domains.vault.links.state import LinkIndexView as LinkIndexView, link_index_state as link_index_state
    from backend.domains.vault.registry import defaults as _typed_registry_defaults
    from backend.services.library_paths import resolve_library as _typed_resolve_library
    from backend.domains.vault.schemas.pages import PageInfo as PageInfo
    from backend.domains.vault.api import trash as _typed_trash_api
    from backend.domains.vault.trash import purge as _typed_trash_purge
    from backend.domains.vault.trash.repository import TrashRepository as TrashRepository
    from backend.domains.vault.files import api as _typed_files_api, local_service as _typed_file_local_service
    from backend.domains.vault.files import property_service as _typed_property_file_service, serving as _typed_file_serving
    from backend.domains.vault.files.state import LocalLinkStore as LocalLinkStore, file_serving_state as file_serving_state
    from backend.domains.vault.files.thumbnails import ThumbnailDependencies as ThumbnailDependencies
    from backend.domains.vault.assets import service as _typed_assets_service
    from backend.domains.vault.assets.state import CustomIconStore as CustomIconStore
    from backend.domains.vault.links import document_cache as _typed_link_document_cache, document_inventory as _typed_link_document_inventory
    from backend.domains.vault.links import relation_sync as _typed_relation_sync_domain
    from backend.domains.vault.links.api import overview as _typed_link_overview_api, preview as _typed_link_preview_api
    from backend.services import relation_sync as _typed_relation_rules, builtin_plugins as _typed_builtin_plugins
    from backend.services.media_service import media_service as media_service
    from backend.platform.files import get_files_provider as get_files_provider
    from backend.services.relation_links import RELATION_WIKILINK_RE as RELATION_WIKILINK_RE
    from backend.domains.vault.tables.routes import create_table as create_table
    from backend.domains.vault.pages.identifiers import validate_safe_page_id as _typed_validate_safe_page_id
    from backend.domains.vault.registry.runtime import (
        _degenerate_overwrite_is_risky as _degenerate_overwrite_is_risky, _sort_key_name as _sort_key_name,
        _host_home_path as _host_home_path, _expand_host_tilde as _expand_host_tilde,
        _reroot_attachment_under_current_host as _reroot_attachment_under_current_host,
        _resolve_stored_file_target as _resolve_stored_file_target, _HOST_TRASH_HELPER_URL as _HOST_TRASH_HELPER_URL,
    )
    from backend.domains.vault.media.routes import _THUMB_DAEMON_URL as _THUMB_DAEMON_URL, _THUMB_DAEMON_TIMEOUT as _THUMB_DAEMON_TIMEOUT
    from backend.domains.vault.pages.foundation import (
        _normalize_rel_folder as _normalize_rel_folder, _is_asset_property as _is_asset_property,
        _stable_value_revision as _stable_value_revision, _table_views_revision as _table_views_revision,
        _link_index_title_for as _link_index_title_for, _sanitize_filename_base as _sanitize_filename_base,
        _sanitize_asset_segment as _sanitize_asset_segment, _write_dashboard_file as _write_dashboard_file,
    )
    from backend.domains.vault.files.route_composition import _move_page_to_trash as _move_page_to_trash, _purge_trash_entry as _purge_trash_entry, _is_safe_external_url as _is_safe_external_url
    from backend.domains.vault.pages.runtime import _clear_page_index_cache as _clear_page_index_cache
    from backend.domains.vault.knowledge.schema_service import (
        _brain_property as _brain_property, _brain_schema as _brain_schema,
        _ensure_default_db_group as _ensure_default_db_group, _infer_brain_roles as _infer_brain_roles,
        ensure_brain_table_schema as ensure_brain_table_schema, ensure_brain_source_relation as ensure_brain_source_relation,
        _reconcile_llm_wiki_source_contract as _reconcile_llm_wiki_source_contract,
        BRAIN_SOURCE_CONTRACT_REVISION as BRAIN_SOURCE_CONTRACT_REVISION,
    )
    from backend.domains.vault.knowledge.jobs_routes import _llm_wiki_source_title as _llm_wiki_source_title
    from backend.domains.vault.api.configuration_routes import (
        _load_plugins_state as _load_plugins_state, _llm_wiki_enabled as _llm_wiki_enabled,
        _ensure_materialized_or_503 as _ensure_materialized_or_503,
        _get_plugins_path as _get_plugins_path, _save_plugins_state as _save_plugins_state,
        _plugins_mutation_lock as _plugins_mutation_lock,
        _reconcile_plugin_ai_contributions as _reconcile_plugin_ai_contributions,
        _refresh_plugin_runtime as _refresh_plugin_runtime,
        _change_plugin_lifecycle as _change_plugin_lifecycle,
        _configured_summary_model as _configured_summary_model,
    )
    trash_api = _typed_trash_api
    trash_purge = _typed_trash_purge
    files_api = _typed_files_api
    file_local_service = _typed_file_local_service
    property_file_service = _typed_property_file_service
    file_serving = _typed_file_serving
    assets_service = _typed_assets_service
    link_document_cache = _typed_link_document_cache
    link_document_inventory = _typed_link_document_inventory
    relation_sync_domain = _typed_relation_sync_domain
    relation_rules = _typed_relation_rules
    link_overview_api = _typed_link_overview_api
    link_preview_api = _typed_link_preview_api
    builtin_plugins = _typed_builtin_plugins
    _validate_safe_page_id: _typed_DeclaredCallable[[str], str] = _typed_validate_safe_page_id
    assets_api = _typed_assets_api
    registry_defaults = _typed_registry_defaults
    _resolve_library = _typed_resolve_library
    from backend.domains.vault.links.runtime import (
        _parsed_doc_cache as _parsed_doc_cache, _parsed_doc_lock as _parsed_doc_lock,
        _iter_linkable_page_documents as _iter_linkable_page_documents,
        _resolve_page_id_from_metadata as _resolve_page_id_from_metadata,
        _load_link_index_from_disk as _load_link_index_from_disk,
        _load_parsed_doc_cache_from_disk as _load_parsed_doc_cache_from_disk,
        _read_parsed_doc_cache_snapshot as _read_parsed_doc_cache_snapshot,
        remove_from_link_index as remove_from_link_index,
        _id_title_cache as _id_title_cache,
        _id_title_lock as _id_title_lock,
        _get_id_title_cache_path as _get_id_title_cache_path,
        _load_id_title_from_disk as _load_id_title_from_disk,
        _refresh_id_title_index as _refresh_id_title_index,
        _load_body_cache_from_disk as _load_body_cache_from_disk,
        kickoff_link_index_rebuild as kickoff_link_index_rebuild,
    )
    # Checked aliases of the actual owners, not fabricated Protocol signatures.
    # Runtime __getattr__ below retains late binding and legacy override behavior.
    from _thread import LockType as _typed_LockType
    from collections.abc import Callable as _typed_Callable
    from collections.abc import Awaitable as _typed_Awaitable
    from asyncio import Lock as _typed_AsyncLock
    from pathlib import Path as _typed_Path
    from backend.domains.vault.pages.foundation_values import PageMetadata as _typed_PageMetadata
    from asyncio import Future as _typed_Future
    from backend.domains.vault.comments import api as _typed_comments_api
    from backend.domains.vault.comments import repository as _typed_comments_repository
    from backend.domains.vault.comments.composition import (
        _get_comments_path as _get_comments_path,
        _load_comments as _load_comments,
        _save_comments as _save_comments,
    )
    from backend.domains.vault.pages.sync_routes import (
        _inline_comments_path as _inline_comments_path,
        _load_inline_comments as _load_inline_comments,
    )
    from backend.domains.vault.links import parsing as _typed_link_parsing
    from backend.domains.vault.links.api import mentions as _typed_link_mentions_api
    from backend.domains.vault.links.api import navigation as _typed_link_navigation_api
    from backend.domains.vault.translation import adapters as _typed_translation_adapters
    from backend.domains.vault.translation import lookup as _typed_translation_lookup
    from backend.domains.vault.translation import metadata_io as _typed_translation_metadata_io
    from backend.domains.vault.translation import staleness as _typed_translation_staleness
    from backend.domains.vault.translation import row_service as _typed_translation_row_service
    from backend.domains.vault.translation import page_service as _typed_translation_page_service
    from backend.domains.vault.tables import status_options as _typed_table_status_options
    from backend.domains.vault.drupal import media as _typed_drupal_media
    from backend.domains.vault.drupal import fields as _typed_drupal_fields
    from backend.domains.vault.drupal import markdown as _typed_drupal_markdown
    from backend.domains.vault.drupal import languages as _typed_drupal_languages
    from backend.domains.vault.drupal import core as _typed_drupal_core
    from backend.domains.vault.drupal import service as _typed_drupal_service
    from backend.domains.vault.drupal import matching as _typed_drupal_matching
    from backend.domains.vault.pages.foundation import _vf_page_loader as _vf_page_loader
    from backend.services import action_rules as _typed_action_rules
    from backend.services import translation_index as _typed_translation_index
    from backend.services.translation_helpers import (
        find_translations_of as find_translations_of,
        translatable_content_changed as translatable_content_changed,
        detect_record_source_lang as detect_record_source_lang,
        detect_record_lang_raw as detect_record_lang_raw,
        is_composite_image_value as is_composite_image_value,
        is_image_field_name as is_image_field_name,
        translate_image_field as translate_image_field,
        language_field_assignment as language_field_assignment,
    )
    from backend.domains.vault.pages.state import PreviewDocument as _typed_PreviewDocument
    from backend.domains.vault.api import pages_commands as _typed_page_commands
    from backend.domains.vault.pages import save_helpers as _typed_save_helpers
    from backend.domains.vault.pages import save_service as _typed_save_service
    from backend.domains.vault.pages import patch_helpers as _typed_patch_helpers
    from backend.domains.vault.pages import patch_service as _typed_patch_service
    from backend.services.table_system_dates import stamp_system_dates as stamp_system_dates
    from backend.services.field_resolver import to_storage_names as to_storage_names
    from backend.domains.vault.schemas.pages import PageInfo as _typed_PageInfo
    from backend.api import virtual_fields as _typed_virtual_fields
    from backend.domains.vault.api import pages_queries as _typed_page_queries
    from backend.domains.vault.links import index_service as _typed_link_index
    from backend.domains.vault.pages import markdown_writer as _typed_markdown_writer
    from backend.domains.vault.pages import preview_routes as _typed_preview_routes
    from backend.domains.vault.pages import runtime as _typed_page_runtime
    from backend.domains.vault.tables import formula_recalculation as _typed_formula_recalculation
    from backend.domains.vault.tables import rows as _typed_table_rows
    from backend.domains.vault.views import snapshots as _typed_view_snapshots
    from backend.services import field_resolver as _typed_field_resolver
    from backend.services import relation_links as _typed_relation_links
    from backend.services import view_snapshot as _typed_view_snapshot
    from backend.services.context_vars import active_vault_path as active_vault_path
    from backend.domains.vault.api.configuration_routes import (
        _COMMENTS_DEPENDENCIES as _COMMENTS_DEPENDENCIES,
        _canonicalize_id as _canonicalize_id,
        _build_preview_excerpt as _build_preview_excerpt,
        _find_page_path_for_write as _find_page_path_for_write,
        _materialize_if_online_only as _materialize_if_online_only,
        find_page_path as find_page_path,
        get_table_id as get_table_id,
    )
    from backend.domains.vault.citations.export_routes import (
        _CITATION_SEARCH_DEPENDENCIES as _CITATION_SEARCH_DEPENDENCIES,
        _REFERENCES_IO_DEPENDENCIES as _REFERENCES_IO_DEPENDENCIES,
        _alpha_suffix as _alpha_suffix,
        _arxiv_to_recursos as _arxiv_to_recursos,
        _citation_key_prop_name as _citation_key_prop_name,
        _crossref_to_recursos as _crossref_to_recursos,
        _existing_citation_keys as _existing_citation_keys,
        _find_structured_authors as _find_structured_authors,
        _html_meta_to_recursos as _html_meta_to_recursos,
        _http_get as _http_get,
        _http_get_public as _http_get_public,
        _inject_citation_key as _inject_citation_key,
        _normalize_arxiv as _normalize_arxiv,
        _normalize_doi as _normalize_doi,
        _normalize_isbn as _normalize_isbn,
        _normalize_suggested_item_type as _normalize_suggested_item_type,
        _openlibrary_to_recursos as _openlibrary_to_recursos,
        _parse_authors_to_csl as _parse_authors_to_csl,
        generate_citation_key as generate_citation_key,
        get_reference_table_id as get_reference_table_id,
    )
    from backend.domains.vault.citations.lookup_routes import (
        _ensure_cite_key_index as _ensure_cite_key_index,
        _ensure_recursos_citation_key as _ensure_recursos_citation_key,
        _dedupe_citation_key as _dedupe_citation_key,
        _invalidate_cite_key_index as _invalidate_cite_key_index,
        normalize_aliases as normalize_aliases,
    )
    from backend.domains.vault.citations.state import citation_index_state as citation_index_state
    from backend.domains.vault.pages import cache as _typed_page_cache
    from backend.domains.vault.pages import index_service as _typed_page_index
    from backend.domains.vault.pages.index_entries import (
        PageCacheEntry as _typed_PageCacheEntry,
        _build_cache_entry_from_memory as _build_cache_entry_from_memory,
        _build_page_cache_entry as _build_page_cache_entry,
        _is_metadata_stub as _is_metadata_stub,
        _read_frontmatter_partial as _read_frontmatter_partial,
    )
    from backend.domains.vault.pages.index_service import (
        _bump_page_index_version as _bump_page_index_version,
        _get_pages_snapshot as _get_pages_snapshot,
    )
    from backend.domains.vault.pages.foundation import (
        _build_table_folder_index as _build_table_folder_index,
        _get_pages_for_table as _get_pages_for_table,
        _is_dashboard_file_path as _is_dashboard_file_path,
        _process_metadata_paths as _process_metadata_paths,
        _read_dashboard_file as _read_dashboard_file,
        _resolve_table_id_from_context as _resolve_table_id_from_context,
        _resolve_table_folder_from_metadata as _resolve_table_folder_from_metadata,
        _resolve_page_context_from_path as _resolve_page_context_from_path,
        _safe_filename as _safe_filename,
        _rename_page_file_to_match_title as _rename_page_file_to_match_title,
        _recompute_cross_record_formulas_for_table as _recompute_cross_record_formulas_for_table,
        normalize_metadata_ids as normalize_metadata_ids,
        normalize_table_context as normalize_table_context,
        ensure_correct_page_location as ensure_correct_page_location,
        parse_frontmatter as parse_frontmatter,
        save_page_md as save_page_md,
    )
    from backend.domains.vault.registry.runtime import (
        load_registry as load_registry,
        registry_mutation as _typed_registry_mutation,
        save_registry as save_registry,
    )
    from backend.domains.vault.pages.runtime import (
        OpenResourceRequest as OpenResourceRequest,
        _VAULT_SYNC_COOLDOWN_SECONDS as _VAULT_SYNC_COOLDOWN_SECONDS,
        _load_page_index_from_disk as _load_page_index_from_disk,
        _save_page_index_to_disk as _save_page_index_to_disk,
        _vault_cache_key as _vault_cache_key,
        get_p as get_p,
        get_rule_engine as get_rule_engine,
        is_calendar_entry as is_calendar_entry,
        sync_to_google_calendar_if_needed as sync_to_google_calendar_if_needed,
    )
    from backend.domains.vault.links.runtime import (
        _LINK_API_DEPENDENCIES as _LINK_API_DEPENDENCIES,
        _current_vault_key as _current_vault_key,
        register_page_in_index as register_page_in_index,
        _body_cache as _body_cache,
        _body_cache_lock as _body_cache_lock,
        _iter_docs_cache as _iter_docs_cache,
        _iter_docs_lock as _iter_docs_lock,
        update_link_index_for_page as update_link_index_for_page,
        rewrite_wikilinks_on_title_change as rewrite_wikilinks_on_title_change,
        _propagate_relation_inverse as _propagate_relation_inverse,
        _STALE_CHECK_TTL as _STALE_CHECK_TTL,
    )
    from backend.domains.vault.tables.legacy_composition import (
        default_registry_dependencies as default_registry_dependencies,
        _table_by_id as _table_by_id,
        registry_api_dependencies as registry_api_dependencies,
        registry_repository as registry_repository,
        table_row_query_dependencies as table_row_query_dependencies,
        vault_view_snapshot_dependencies as vault_view_snapshot_dependencies,
    )
    from backend.domains.vault.files import host_trash as _typed_host_trash
    from backend.domains.vault.files.route_composition import (
        _remove_page_from_index_cache as _remove_page_from_index_cache,
        _add_page_to_index_cache as _add_page_to_index_cache,
    )
    from backend.domains.vault.drawings.routes import (
        _create_page_version as _create_page_version,
        _create_page_version_from_content as _create_page_version_from_content,
    )
    from backend.domains.vault.translation.lifecycle import (
        _propagate_translation_staleness as _propagate_translation_staleness,
        _get_existing_translations as _get_existing_translations,
        _read_deepl_key as _read_deepl_key,
        _load_translate_row_skill as _load_translate_row_skill,
        _do_translate_row as _do_translate_row,
        _drupal_client_module as _drupal_client_module,
        _ensure_status_options_persisted as _ensure_status_options_persisted,
        _DRUPAL_PATH_DEPENDENCIES as _DRUPAL_PATH_DEPENDENCIES,
        _DRUPAL_MARKDOWN_DEPENDENCIES as _DRUPAL_MARKDOWN_DEPENDENCIES,
        _DRUPAL_LANGUAGE_DEPENDENCIES as _DRUPAL_LANGUAGE_DEPENDENCIES,
        _PAGE_TRANSLATION_DEPENDENCIES as _PAGE_TRANSLATION_DEPENDENCIES,
        _drupal_upload_dependencies as _drupal_upload_dependencies,
        _drupal_field_dependencies as _drupal_field_dependencies,
    )
    from backend.domains.vault.drupal.composition import (
        _drupal_resolve_local_path as _drupal_resolve_local_path,
        _drupal_shrink_pdf as _drupal_shrink_pdf,
        _drupal_shrink_image as _drupal_shrink_image,
        _drupal_md_to_html as _drupal_md_to_html,
        _drupal_read_prop_value as _drupal_read_prop_value,
        _drupal_upload_field_image as _drupal_upload_field_image,
        _drupal_coerce_scalar as _drupal_coerce_scalar,
        _do_sync_drupal_row as _do_sync_drupal_row,
        _drupal_matching_dependencies as _drupal_matching_dependencies,
    )
    from backend.domains.vault.api.core_routes import create_page as create_page
    from backend.domains.vault.api.core_routes import _stamp_author as _stamp_author
    from backend.domains.vault.pages.preview_routes import (
        patch_page as patch_page,
        _prepare_save_metadata as _prepare_save_metadata,
        _locate_save_file as _locate_save_file,
        _read_save_page as _read_save_page,
        _write_save_page_with_version as _write_save_page_with_version,
        _find_and_read_patch_page as _find_and_read_patch_page,
        _prepare_patch_metadata as _prepare_patch_metadata,
        _relocate_patch_file as _relocate_patch_file,
        _update_patch_caches as _update_patch_caches,
    )
    from backend.domains.vault.pages import index_entries as _typed_index_entries
    from backend.domains.vault.pages import resolver as _typed_page_resolver
    from backend.domains.vault.pages import tags as _typed_tags
    from backend.domains.vault.pages.state import page_state as page_state
    from backend.domains.vault.registry import api as _typed_registry_api
    from backend.domains.vault.registry import names as _typed_registry_names
    from backend.domains.vault.registry.state import registry_state as registry_state
    from backend.domains.vault.tables import routes as _typed_table_routes
    from backend.services import option_catalogs as _typed_option_catalogs
    from backend.services.context_vars import get_active_vault_path as get_active_vault_path
    from backend.services.library_paths import library_roots as _typed_library_roots

    translation_adapters = _typed_translation_adapters
    translation_lookup = _typed_translation_lookup
    translation_metadata_io = _typed_translation_metadata_io
    translation_staleness = _typed_translation_staleness
    translation_row_service = _typed_translation_row_service
    translation_page_service = _typed_translation_page_service
    table_status_options = _typed_table_status_options
    action_rules_service = _typed_action_rules
    translation_index = _typed_translation_index
    drupal_media = _typed_drupal_media
    drupal_fields = _typed_drupal_fields
    drupal_markdown = _typed_drupal_markdown
    drupal_languages = _typed_drupal_languages
    drupal_core = _typed_drupal_core
    drupal_service = _typed_drupal_service
    drupal_matching = _typed_drupal_matching
    comments_api = _typed_comments_api
    comments_repository = _typed_comments_repository
    link_parsing = _typed_link_parsing
    link_mentions_api = _typed_link_mentions_api
    link_navigation_api = _typed_link_navigation_api
    file_host_trash = _typed_host_trash
    page_index_entries = _typed_index_entries
    page_index_service = _typed_page_index
    page_resolver = _typed_page_resolver
    tags_query = _typed_tags
    registry_api = _typed_registry_api
    registry_is_main_or_locked_view = _typed_registry_names.is_main_or_locked_view
    registry_main_view_fields = _typed_registry_names.main_view_fields
    registry_normalize_main_view_configuration = _typed_registry_names.normalize_main_view_configuration
    registry_normalize_table_view_name = _typed_registry_names.normalize_table_view_name
    registry_normalize_table_view_names = _typed_registry_names.normalize_registry_table_view_names
    registry_sort_key_name = _typed_registry_names.sort_key_name
    registry_table_name = _typed_registry_names.table_name_from_registry
    table_routes = _typed_table_routes
    option_catalogs_service = _typed_option_catalogs
    _library_roots: _typed_Callable[[Path | None], list[Path]] = _typed_library_roots
    registry_mutation: _typed_Callable[[], _typed_ContextManager[None]] = _typed_registry_mutation

    link_index_service = _typed_link_index
    _outlinks_by_source = link_index_state.outlinks_by_source
    _outlink_kinds_by_source = link_index_state.outlink_kinds_by_source
    _backlinks_by_target = link_index_state.backlinks_by_target
    _backlinks_by_target_title = link_index_state.backlinks_by_target_title
    _tokens_by_source = link_index_state.tokens_by_source
    _page_meta_by_id = link_index_state.page_meta_by_id
    _link_index_lock = link_index_state.lock
    _link_index_built = link_index_state.built
    _link_index_build_ts = link_index_state.build_ts
    _link_index_source_count = link_index_state.source_count
    _link_index_rebuild_in_progress = link_index_state.rebuild_in_progress
    _link_index_rebuild_state_lock = link_index_state.rebuild_state_lock
    _set_indexer_status = _typed_page_cache.set_indexer_status
    _get_cached_page_entries = _typed_page_index.get_cached_page_entries
    table_rows = _typed_table_rows
    vault_view_snapshots = _typed_view_snapshots
    page_markdown_writer = _typed_markdown_writer
    formula_recalculation = _typed_formula_recalculation
    page_queries_api = _typed_page_queries
    page_commands_api = _typed_page_commands
    page_save_helpers = _typed_save_helpers
    page_save_service = _typed_save_service
    page_patch_helpers = _typed_patch_helpers
    page_patch_service = _typed_patch_service
    _vf_inject_for_single_page = _typed_virtual_fields.inject_for_single_page
    _link_index_view: _typed_Callable[[], LinkIndexView] = _typed_page_runtime._link_index_view
    get_page_index_cache_path = _typed_page_runtime.get_page_index_cache_path
    _canonical_visible_table_pages = _typed_page_runtime._canonical_visible_table_pages
    _table_recalc_lock = _typed_page_runtime._table_recalc_lock
    _table_recalc_state = _typed_page_runtime._table_recalc_state
    _TABLE_RECALC_COOLDOWN_SECONDS = _typed_page_runtime._TABLE_RECALC_COOLDOWN_SECONDS
    _PREVIEW_WARM_CONCURRENCY = _typed_page_runtime._PREVIEW_WARM_CONCURRENCY
    _PREVIEW_WARM_PER_ITEM_TIMEOUT_S = _typed_page_runtime._PREVIEW_WARM_PER_ITEM_TIMEOUT_S
    _fetch_preview_with_cache = _typed_preview_routes._fetch_preview_with_cache
    _bulk_warm_one = _typed_preview_routes._bulk_warm_one
    get_indexer_status = _typed_page_cache.get_indexer_status
    to_response_names = _typed_field_resolver.to_response_names
    relation_keys_from_table = _typed_relation_links.relation_keys_from_table
    strip_relation_wikilinks = _typed_relation_links.strip_relation_wikilinks
    decorate_relation_wikilinks = _typed_relation_links.decorate_relation_wikilinks
    compact_view_fences = _typed_view_snapshot.compact_view_fences
    flatten_view_columns = _typed_view_snapshot.flatten_view_columns
    inject_view_snapshots = _typed_view_snapshot.inject_view_snapshots
    render_view_snapshots = _typed_view_snapshot.render_view_snapshots
    restore_view_fences = _typed_view_snapshot.restore_view_fences
    strip_view_snapshots = _typed_view_snapshot.strip_view_snapshots

    _get_page_write_lock: _typed_Callable[[str], _typed_Awaitable[_typed_AsyncLock]] = (
        _typed_page_cache.get_page_write_lock
    )
    _preview_cache_get = _typed_page_cache.get_cached_preview
    _preview_cache_set = _typed_page_cache.set_cached_preview
    _preview_inflight: dict[str, _typed_Future[_typed_PreviewDocument]] = page_state.preview_inflight
    _preview_inflight_lock: _typed_LockType = page_state.preview_inflight_lock
    _pages_cache_invalidate_all: _typed_Callable[[], None] = _typed_page_cache.invalidate_page_responses
    _refresh_page_index_entry: _typed_Callable[[_typed_Path, _typed_PageMetadata, str], None] = (
        _typed_page_index.refresh_page_index_entry
    )
    _pages_cache_get: _typed_Callable[[str], list[_typed_PageInfo] | None] = (
        _typed_page_cache.get_cached_page_response
    )
    _pages_cache_set: _typed_Callable[[str, list[_typed_PageInfo]], None] = (
        _typed_page_cache.set_cached_page_response
    )
    _page_index_lock: _typed_LockType = page_state.index_lock
    _page_index_entries: dict[str, dict[str, _typed_PageCacheEntry]] = page_state.index_entries
    _page_index_initialized: dict[str, bool] = page_state.index_initialized
    _page_id_to_path: dict[str, dict[object, str]] = page_state.id_to_path
    _page_index_version: dict[str, int] = page_state.index_version
    _last_stale_check: dict[str, float] = page_state.last_stale_check

import requests
import yaml as yaml
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends as Depends,
    File,
    Form,
    HTTPException as HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from backend.config.app_config import load_params as load_params
from backend.config.data_dir import resolve_data_dir as resolve_data_dir
from backend.config.env_config import default_host_helper_url, default_thumb_daemon_url
from backend.domains.vault.assets import persistence as _typed_export_table_asset_persistence
table_asset_persistence = _typed_export_table_asset_persistence
from backend.domains.vault.assets import quarantine as _typed_export_table_asset_quarantine
table_asset_quarantine = _typed_export_table_asset_quarantine
from backend.domains.vault.assets import table_paths as _typed_export_table_asset_paths
table_asset_paths = _typed_export_table_asset_paths
from backend.domains.vault.assets.persistence import (
    _copy_local_file_to_assets as _copy_local_file_to_assets,
)
from backend.domains.vault.assets.persistence import (
    _delete_asset_files_for_page as _delete_asset_files_for_page,
)
from backend.domains.vault.assets.persistence import _persist_asset_value as _persist_asset_value
from backend.domains.vault.assets.persistence import (
    _persist_metadata_assets as _persist_metadata_assets,
)
from backend.domains.vault.assets.persistence import (
    _save_data_url_image_to_assets as _save_data_url_image_to_assets,
)
from backend.domains.vault.assets.persistence import (
    _save_uploaded_file_to_assets as _save_uploaded_file_to_assets,
)
from backend.domains.vault.assets.quarantine import (
    _cleanup_registry_table_ids as _cleanup_registry_table_ids,
)
from backend.domains.vault.assets.quarantine import (
    _delete_table_asset_quarantine as _delete_table_asset_quarantine,
)
from backend.domains.vault.assets.quarantine import (
    _mark_table_asset_quarantine_ready as _mark_table_asset_quarantine_ready,
)
from backend.domains.vault.assets.quarantine import (
    _quarantine_table_asset_dirs as _quarantine_table_asset_dirs,
)
from backend.domains.vault.assets.quarantine import (
    _quarantined_table_asset_revision as _quarantined_table_asset_revision,
)
from backend.domains.vault.assets.quarantine import (
    _restore_abandoned_table_asset_quarantine as _restore_abandoned_table_asset_quarantine,
)
from backend.domains.vault.assets.quarantine import (
    _restore_quarantined_table_assets as _restore_quarantined_table_assets,
)
from backend.domains.vault.assets.quarantine import (
    _table_asset_cleanup_root as _table_asset_cleanup_root,
)
from backend.domains.vault.assets.quarantine import (
    cleanup_pending_table_asset_quarantines as cleanup_pending_table_asset_quarantines,
)
from backend.domains.vault.assets.table_paths import (
    _asset_segments_collide as _asset_segments_collide,
)
from backend.domains.vault.assets.table_paths import (
    _delete_asset_property_dir as _delete_asset_property_dir,
)
from backend.domains.vault.assets.table_paths import (
    _delete_asset_table_dir as _delete_asset_table_dir,
)
from backend.domains.vault.assets.table_paths import (
    _ensure_asset_dirs_for_table_entry as _ensure_asset_dirs_for_table_entry,
)
from backend.domains.vault.assets.table_paths import _find_table_property as _find_table_property
from backend.domains.vault.assets.table_paths import _move_loose_files as _move_loose_files
from backend.domains.vault.assets.table_paths import _property_assets_dir as _property_assets_dir
from backend.domains.vault.assets.table_paths import (
    _property_config_value as _property_config_value,
)
from backend.domains.vault.assets.table_paths import (
    _resolve_table_and_database_for_assets as _resolve_table_and_database_for_assets,
)
from backend.domains.vault.assets.table_paths import (
    _rewrite_inline_asset_refs as _rewrite_inline_asset_refs,
)
from backend.domains.vault.assets.table_paths import _table_asset_paths as _table_asset_paths
from backend.domains.vault.assets.table_paths import _table_asset_revision as _table_asset_revision
from backend.domains.vault.assets.table_paths import _table_assets_dir as _table_assets_dir
from backend.domains.vault.tables import folders as _typed_export_table_folders
table_folders = _typed_export_table_folders
from backend.domains.vault.tables.folders import (
    _ensure_table_vault_folder as _ensure_table_vault_folder,
)
from backend.domains.vault.tables.folders import _table_vault_dir as _table_vault_dir
from backend.services.content_revision import path_collection_revision as path_collection_revision
from backend.services.rule_engine import RuleEngine

log: logging.Logger = logging.getLogger(__name__)
import asyncio as asyncio

from backend.services.frontmatter_fallback import parse_frontmatter_fallback as parse_frontmatter_fallback
from backend.services.page_sidecar import apply_sidecar_to as apply_sidecar_to
from backend.services.page_sidecar import persist_sidecar_from as persist_sidecar_from
from backend.services.page_sidecar import vault_root_for
from backend.services.page_sidecar import delete_sidecar as _typed_delete_sidecar
delete_sidecar_for_page: "_typed_Callable[[Path, str], None]" = _typed_delete_sidecar
from backend.services.page_sidecar import split_metadata as _typed_split_metadata
split_sidecar_metadata = _typed_split_metadata
from backend.services.path_resolver import path_resolver as path_resolver
from backend.services.plugin_access import require_plugins as require_plugins
from backend.services.vault_routing import canonical_vault_browser_path as canonical_vault_browser_path
from backend.services.workspace_service import get_workspace_context as get_workspace_context
from backend.services.workspace_service import require_role as require_role
from backend.utils.errors import safe_error_detail as safe_error_detail
from backend.utils.safe_io import (
    file_etag as file_etag,
    file_mtime_ns,
    safe_write_bytes as safe_write_bytes,
    safe_write_json as safe_write_json,
    safe_write_text as safe_write_text,
    sanitize_path_segment as sanitize_path_segment,
    sanitize_rel_folder as sanitize_rel_folder,
    sanitize_vault_title as sanitize_vault_title,
)

router: APIRouter = APIRouter(dependencies=[Depends(get_workspace_context)])

from backend.domains.vault import facade_bridge as _vault_facade_bridge  # noqa: E402


def __getattr__(name: str) -> Any:
    return _vault_facade_bridge.resolve(name)


def __dir__() -> list[str]:
    return sorted(set(globals()) | _vault_facade_bridge.exported_names())


from backend.domains.vault.tables import (
    legacy_composition as _vault_legacy_tables,
)  # noqa: E402

_vault_facade_bridge.register(_vault_legacy_tables)

from backend.domains.vault.pages import (
    runtime as _vault_runtime,
)  # noqa: E402

_vault_facade_bridge.register(_vault_runtime)

from backend.domains.vault.pages import (
    foundation as _vault_foundation,
)  # noqa: E402

# Also initialize here when the foundation module initiated this import cycle.
# Keep route registration and captured callbacks at the same bootstrap position.
_vault_foundation.initialize_foundation(sys.modules[__name__])
_vault_facade_bridge.register(_vault_foundation)

from backend.domains.vault.api import (
    core_routes as _vault_core_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_core_routes)

from backend.domains.vault.api import (
    configuration_routes as _vault_configuration_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_configuration_routes)

from backend.domains.vault.citations import (
    export_routes as _vault_export_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_export_routes)

from backend.domains.vault.knowledge import (
    schema_service as _vault_schema_service,
)  # noqa: E402

_vault_facade_bridge.register(_vault_schema_service)

from backend.domains.vault.knowledge import (
    config_routes as _vault_config_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_config_routes)

from backend.domains.vault.knowledge import (
    jobs_routes as _vault_jobs_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_jobs_routes)

from backend.domains.vault.citations import (
    lookup_routes as _vault_lookup_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_lookup_routes)

from backend.domains.vault.pages import (
    preview_routes as _vault_preview_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_preview_routes)

from backend.domains.vault.files import (
    route_composition as _vault_route_composition,
)  # noqa: E402

_vault_facade_bridge.register(_vault_route_composition)

from backend.domains.vault.media import (
    routes as _vault_media_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_media_routes)

from backend.domains.vault.links import (
    runtime as _vault_link_runtime,
)  # noqa: E402

_vault_facade_bridge.register(_vault_link_runtime)

from backend.domains.vault.pages import (
    sync_routes as _vault_sync_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_sync_routes)

from backend.domains.vault.registry import (
    runtime as _vault_registry_runtime,
)  # noqa: E402

_vault_facade_bridge.register(_vault_registry_runtime)

from backend.domains.vault.drawings import (
    routes as _vault_drawing_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_drawing_routes)

from backend.domains.vault.translation import (
    lifecycle as _vault_translation_lifecycle,
)  # noqa: E402

_vault_facade_bridge.register(_vault_translation_lifecycle)

from backend.domains.vault.drupal import (
    composition as _vault_drupal_composition,
)  # noqa: E402

_vault_facade_bridge.register(_vault_drupal_composition)

from backend.domains.vault.translation import (
    routes as _vault_translation_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_translation_routes)

from backend.domains.vault.annotations import (
    pdf_routes as _vault_pdf_routes,
)  # noqa: E402

_vault_facade_bridge.register(_vault_pdf_routes)
