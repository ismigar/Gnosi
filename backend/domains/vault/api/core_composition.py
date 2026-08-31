"""Narrow late-bound collaborators for page creation and daily-note routing.

This is a transitional contract for providers still owned by the ordered vault
bootstrap, not a claim that the wider compatibility facade is fully typed.
"""

from __future__ import annotations

import asyncio
import importlib
import logging
import os
from collections.abc import Awaitable
from contextlib import AbstractContextManager
from pathlib import Path
from typing import Protocol, TypedDict, cast

from backend.domains.vault.daily.service import DailySource
from backend.domains.vault.schemas.pages import PageSaveRequest
from backend.domains.vault.tables.rows import TableMetadataDependencies

Metadata = dict[str, object]


class VirtualFieldsPayload(TypedDict):
    computers: list[Metadata]


class RuleEnginePort(Protocol):
    def process_updates(self, page_id: str, old: Metadata, new: Metadata) -> Metadata: ...


class PathIndexPort(Protocol):
    def add_file(self, vault: Path, page_id: str, path: Path) -> None: ...


class ActionRulesPort(Protocol):
    def read_prop_value(self, metadata: Metadata, prop: Metadata) -> object: ...

    def effect_write_key(self, metadata: Metadata, prop: Metadata) -> str | None: ...


class CoreVaultPort(Protocol):
    """Only the replaceable collaborators consumed by this composition."""

    log: logging.Logger
    table_metadata_dependencies: TableMetadataDependencies
    path_resolver: PathIndexPort
    action_rules_service: ActionRulesPort
    _page_index_lock: AbstractContextManager[object]
    _page_index_entries: dict[str, dict[str, Metadata]]
    _page_id_to_path: dict[str, dict[str, str]]
    _daily_note_lock: asyncio.Lock

    def _vf_list_specs(self) -> list[Metadata]: ...

    def _safe_filename(self, name: str, directory: Path) -> str: ...

    def get_active_vault_path(self) -> Path | None: ...

    def _build_page_cache_entry(self, path: Path, stat: os.stat_result) -> Metadata: ...

    def _bump_page_index_version(self, vault_key: str) -> None: ...

    def _clear_page_index_cache(self) -> None: ...

    def normalize_metadata_ids(self, metadata: Metadata) -> Metadata: ...

    def normalize_table_context(self, metadata: Metadata) -> Metadata: ...

    def get_rule_engine(self) -> RuleEnginePort: ...

    def _persist_metadata_assets(self, metadata: Metadata) -> Metadata: ...

    def _ensure_recursos_citation_key(
        self, metadata: Metadata, table: Metadata | None
    ) -> Metadata: ...

    def _dedupe_citation_key(self, metadata: Metadata, page_id: str) -> Metadata: ...

    def _fill_autoria_from_authors(
        self, metadata: Metadata, table: Metadata | None
    ) -> Metadata: ...

    def get_p(self, key: str) -> Path: ...

    def is_calendar_entry(self, metadata: Metadata) -> bool: ...

    def _resolve_table_folder_from_metadata(self, metadata: Metadata) -> Path | None: ...

    def _canonicalize_id(self, page_id: object) -> str: ...

    def parse_frontmatter(self, content: str, path: Path | None = None) -> tuple[Metadata, str]: ...

    def save_page_md(self, path: Path, metadata: Metadata, content: str) -> None: ...

    def get_table_id(self, metadata: Metadata) -> str | None: ...

    def _recompute_cross_record_formulas_for_table(self, table: str, page_id: str) -> object: ...

    def _pages_cache_invalidate_all(self) -> None: ...

    def _add_page_to_index_cache(self, path: Path) -> None: ...

    def update_link_index_for_page(self, path: Path) -> object: ...

    def _propagate_relation_inverse(
        self,
        page_id: str,
        table: str | None,
        old: Metadata,
        new: Metadata,
    ) -> object: ...

    def _resolve_page_context_from_path(
        self, metadata: Metadata, path: Path
    ) -> tuple[str, str | None]: ...

    def _load_plugins_state(self) -> Metadata: ...

    def _table_by_id(self, table_id: str) -> Metadata | None: ...

    def _get_pages_for_table(self, table_id: object) -> list[object]: ...

    def _daily_source_config(self) -> DailySource: ...

    def _find_daily_note_in_table(
        self, table: Metadata, prop: Metadata, date: str
    ) -> str | None: ...

    def _find_daily_note_id(self, date: str) -> str | None: ...

    def _load_daily_template_content(self) -> str: ...

    def get_page(self, page_id: str) -> Awaitable[object]: ...

    def create_page(self, request: PageSaveRequest, tasks: object) -> Awaitable[object]: ...


# Preserve late lookup and the original mutable owners across legacy overrides.
vault = cast(CoreVaultPort, importlib.import_module("backend.api.vault_routes"))
