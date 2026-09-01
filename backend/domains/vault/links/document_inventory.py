"""Cached inventory of Markdown pages and dashboards eligible for linking."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from contextlib import AbstractContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import TypeGuard, TypedDict

from backend.domains.vault.pages.foundation_values import PageMetadata


Metadata = PageMetadata
LinkableDocument = tuple[Path, Metadata, str, bool]


class DocumentCacheEntry(TypedDict, total=False):
    """Envelope written by the document inventory and patched in place."""

    docs: list[LinkableDocument]
    ts: float


DocumentCache = dict[str, DocumentCacheEntry]


@dataclass(frozen=True)
class DocumentInventoryDependencies:
    """Filesystem, parser, clock, and per-vault cache ports."""

    now: Callable[[], float]
    current_vault_key: Callable[[], str]
    cache: DocumentCache
    cache_lock: AbstractContextManager[object]
    cache_ttl: float
    vault_path: Callable[[], Path | None]
    list_markdown: Callable[[Path], Iterable[Path]]
    parsed_document: Callable[[Path], tuple[Metadata, str] | None]
    dashboards_path: Callable[[], Path | None]
    read_dashboard: Callable[[Path], tuple[Metadata, str]]
    logger: logging.Logger


def _cached_documents(
    vault_key: str,
    dependencies: DocumentInventoryDependencies,
) -> tuple[list[LinkableDocument] | None, float]:
    entry = dependencies.cache.get(vault_key)
    if not entry:
        return None, 0.0
    raw_documents = entry.get("docs")
    documents = raw_documents if isinstance(raw_documents, list) else None
    raw_timestamp = entry.get("ts", 0.0)
    timestamp = float(raw_timestamp) if isinstance(raw_timestamp, (int, float)) else 0.0
    return documents, timestamp


def _is_fresh(
    documents: list[LinkableDocument] | None,
    timestamp: float,
    dependencies: DocumentInventoryDependencies,
) -> TypeGuard[list[LinkableDocument]]:
    return documents is not None and dependencies.now() - timestamp < dependencies.cache_ttl


def _markdown_files(
    vault_path: Path,
    dependencies: DocumentInventoryDependencies,
) -> Iterable[Path]:
    try:
        return dependencies.list_markdown(vault_path)
    except Exception:
        return vault_path.rglob("*.md")


def _vault_documents(dependencies: DocumentInventoryDependencies) -> list[LinkableDocument]:
    vault_path = dependencies.vault_path()
    if not vault_path or not vault_path.exists():
        return []
    documents: list[LinkableDocument] = []
    for file_path in _markdown_files(vault_path, dependencies):
        if ".history" in file_path.parts or ".trash" in file_path.parts:
            continue
        try:
            parsed = dependencies.parsed_document(file_path)
            if parsed is None:
                continue
            metadata, body = parsed
            documents.append((file_path, metadata, body, False))
        except Exception as error:
            dependencies.logger.warning(
                "Error parsing linkable page %s: %s",
                file_path.name,
                error,
            )
    return documents


def _dashboard_documents(
    dependencies: DocumentInventoryDependencies,
) -> list[LinkableDocument]:
    dashboards_path = dependencies.dashboards_path()
    if not dashboards_path or not dashboards_path.exists():
        return []
    documents: list[LinkableDocument] = []
    for file_path in dashboards_path.rglob("*.json"):
        try:
            metadata, body = dependencies.read_dashboard(file_path)
            documents.append((file_path, metadata, body, True))
        except Exception as error:
            dependencies.logger.warning(
                "Error parsing dashboard page %s: %s",
                file_path.name,
                error,
            )
    return documents


def linkable_documents(
    dependencies: DocumentInventoryDependencies,
) -> list[LinkableDocument]:
    """Return one TTL-cached inventory for the active Vault."""
    vault_key = dependencies.current_vault_key()
    cached, timestamp = _cached_documents(vault_key, dependencies)
    if _is_fresh(cached, timestamp, dependencies):
        return cached
    with dependencies.cache_lock:
        cached, timestamp = _cached_documents(vault_key, dependencies)
        if _is_fresh(cached, timestamp, dependencies):
            return cached
        documents = _vault_documents(dependencies)
        documents.extend(_dashboard_documents(dependencies))
        dependencies.cache[vault_key] = {
            "docs": documents,
            "ts": dependencies.now(),
        }
        return documents


__all__ = [
    "DocumentCache",
    "DocumentInventoryDependencies",
    "LinkableDocument",
    "Metadata",
    "linkable_documents",
]
