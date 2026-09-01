import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple, cast

import requests
import yaml
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from backend.config.app_config import load_params
from backend.config.data_dir import resolve_data_dir
from backend.config.env_config import default_host_helper_url, default_thumb_daemon_url
from backend.domains.vault.assets import persistence as table_asset_persistence
from backend.domains.vault.assets import quarantine as table_asset_quarantine
from backend.domains.vault.assets import table_paths as table_asset_paths
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
from backend.domains.vault.tables import folders as table_folders
from backend.domains.vault.tables.folders import (
    _ensure_table_vault_folder as _ensure_table_vault_folder,
)
from backend.domains.vault.tables.folders import _table_vault_dir as _table_vault_dir
from backend.services.content_revision import path_collection_revision
from backend.services.rule_engine import RuleEngine

log = logging.getLogger(__name__)
import asyncio

from backend.services.frontmatter_fallback import parse_frontmatter_fallback
from backend.services.page_sidecar import apply_sidecar_to, persist_sidecar_from, vault_root_for
from backend.services.page_sidecar import delete_sidecar as delete_sidecar_for_page
from backend.services.page_sidecar import split_metadata as split_sidecar_metadata
from backend.services.path_resolver import path_resolver
from backend.services.plugin_access import require_plugins
from backend.services.vault_routing import canonical_vault_browser_path
from backend.services.workspace_service import get_workspace_context, require_role
from backend.utils.errors import safe_error_detail
from backend.utils.safe_io import (
    file_etag,
    file_mtime_ns,
    safe_write_bytes,
    safe_write_json,
    safe_write_text,
    sanitize_path_segment,
    sanitize_rel_folder,
    sanitize_vault_title,
)

router = APIRouter(dependencies=[Depends(get_workspace_context)])

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
