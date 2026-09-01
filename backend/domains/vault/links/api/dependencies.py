"""Narrow composition ports used by link HTTP adapters."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from backend.domains.vault.links.index_service import Document
from backend.domains.vault.links.state import LinkIndexView


class DashboardWriter(Protocol):
    def __call__(
        self,
        *,
        file_path: Path,
        page_id: str,
        title: str,
        metadata: dict[str, Any],
        content: str,
        parent_id: object,
        is_database: bool,
    ) -> object: ...


@dataclass(frozen=True)
class LinkApiDependencies:
    read_state: Callable[[], LinkIndexView]
    build_id_title_index: Callable[[], dict[str, str]]
    build_alias_index: Callable[[], dict[str, list[str]]]
    get_cache_path: Callable[[], Path | None]
    resolve_kickoff_rebuild: Callable[[], Callable[[], None]]
    iter_documents: Callable[[], list[Document]]
    find_page: Callable[[str], Path | None]
    is_dashboard: Callable[[Path], bool]
    read_dashboard: Callable[[Path], tuple[dict[str, Any], str]]
    parse_frontmatter: Callable[[str, Path], tuple[dict[str, Any], str]]
    resolve_create_page_version: Callable[[], Callable[[str, Path], object]]
    write_dashboard: DashboardWriter
    save_page: Callable[[Path, dict[str, Any], str], object]
    resolve_update_index: Callable[[], Callable[[Path], None]]
    is_safe_external_url: Callable[[str], tuple[bool, str]]
    build_browser_path: Callable[[str, str], str]


__all__ = ["DashboardWriter", "LinkApiDependencies"]
