"""Typed late-bound ports for the remaining historical Vault collaborators.

Only the facade boundary is asserted here. The media service, file dependency
records and duplicate-page API keep their canonical owners. Their remaining
legacy metadata annotations are upstream debt, not a fully typed facade claim.
"""

from __future__ import annotations

import importlib
import uuid
from collections.abc import Callable
from pathlib import Path
from typing import Protocol, cast

from backend.domains.vault.api.pages_duplicate import DuplicatePageDependencies
from backend.domains.vault.files.property_service import PropertyFileDependencies
from backend.domains.vault.files.state import LocalLinkStore
from backend.domains.vault.media.contracts import MediaServicePort
from backend.services.media_service import MediaService


class MediaVaultPort(Protocol):
    """Actual collaborators still selected through the compatibility facade."""

    @property
    def media_service(self) -> MediaService: ...

    @property
    def _LOCAL_LINK_STORE(self) -> LocalLinkStore: ...

    @property
    def _PROPERTY_FILE_DEPENDENCIES(self) -> PropertyFileDependencies: ...

    def find_page_path(self, page_id: str) -> Path | None: ...
    def _is_dashboard_file_path(self, path: Path) -> bool: ...
    def _read_dashboard_file(self, path: Path) -> tuple[dict[str, object], str]: ...
    def parse_frontmatter(
        self, content: str, path: Path | None
    ) -> tuple[dict[str, object], str]: ...
    def _write_dashboard_file(
        self,
        *,
        file_path: Path,
        page_id: str,
        title: str,
        metadata: dict[str, object],
        content: str,
        parent_id: object,
        is_database: bool,
    ) -> None: ...
    def _ensure_recursos_citation_key(
        self, metadata: dict[str, object], *, regenerate: bool
    ) -> dict[str, object]: ...
    def save_page_md(self, path: Path, metadata: dict[str, object], content: str) -> None: ...
    def _add_page_to_index_cache(self, path: Path) -> None: ...

    @property
    def update_link_index_for_page(self) -> Callable[[Path], object]: ...


vault = cast(MediaVaultPort, importlib.import_module("backend.api.vault_routes"))


def media_service() -> MediaServicePort:
    """Resolve the real service lazily and statically check the route-side port."""
    return vault.media_service


def duplicate_dependencies() -> DuplicatePageDependencies:
    """Keep callback lookup lazy, including the queued callback's identity."""
    return DuplicatePageDependencies(
        find_page=lambda page_id: vault.find_page_path(page_id),
        is_dashboard=lambda path: vault._is_dashboard_file_path(path),
        read_dashboard=lambda path: vault._read_dashboard_file(path),
        parse_frontmatter=lambda content, path: vault.parse_frontmatter(content, path),
        new_id=lambda: str(uuid.uuid4()),
        write_dashboard=lambda path, page_id, title, metadata, content: vault._write_dashboard_file(
            file_path=path,
            page_id=page_id,
            title=title,
            metadata=metadata,
            content=content,
            parent_id=metadata.get("parent_id"),
            is_database=bool(metadata.get("is_database")),
        ),
        ensure_citation_key=lambda metadata: vault._ensure_recursos_citation_key(
            metadata, regenerate=True
        ),
        save_page=lambda path, metadata, content: vault.save_page_md(path, metadata, content),
        add_page_index=lambda path: vault._add_page_to_index_cache(path),
        update_link_index=lambda: vault.update_link_index_for_page,
    )
