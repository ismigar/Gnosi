"""Resolve stable page identifiers to current Vault file paths."""

from __future__ import annotations

import logging
import re
from _thread import LockType
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from backend.domains.vault.pages.index_entries import PageCacheEntry as PageCacheEntry
from backend.domains.vault.registry.state import RegistryData


Metadata = RegistryData


@dataclass(frozen=True)
class PageResolverDependencies:
    """Ports and shared page-index state required for path resolution."""

    active_vault_path: Callable[[], Path | None]
    get_path: Callable[[str], Path]
    path_factory: Callable[[str], Path]
    parse_frontmatter: Callable[[str, Path], tuple[Metadata, str]]
    canonicalize_id: Callable[[object], str]
    bump_index_version: Callable[[str], None]
    set_last_vault_sync: Callable[[float], None]
    monotonic: Callable[[], float]
    stale_check_ttl: float
    last_stale_check: dict[str, float]
    index_lock: LockType
    index_entries: dict[str, dict[str, PageCacheEntry]]
    index_initialized: dict[str, bool]
    id_to_path: dict[str, dict[str, str]]
    logger: logging.Logger


_dependencies: PageResolverDependencies | None = None


def configure(dependencies: PageResolverDependencies) -> None:
    """Bind resolver ports from the application composition root."""
    global _dependencies
    if _dependencies is not None and _dependencies != dependencies:
        raise RuntimeError("Page resolver is already configured")
    _dependencies = dependencies


def _deps() -> PageResolverDependencies:
    if _dependencies is None:
        raise RuntimeError("Page resolver has not been configured")
    return _dependencies


def _recent_stale_check() -> bool:
    dependencies = _deps()
    try:
        age = dependencies.monotonic() - dependencies.last_stale_check["ts"]
    except Exception:
        return False
    return age < dependencies.stale_check_ttl


def _exact_or_canonical_id_path(
    vault_key: str,
    page_id: str,
    canonical_target: str,
) -> tuple[Path | None, bool]:
    dependencies = _deps()
    with dependencies.index_lock:
        id_map = dependencies.id_to_path.get(vault_key, {})
        path_value = id_map.get(page_id)
        if not path_value and canonical_target:
            path_value = next(
                (
                    candidate_path
                    for candidate_id, candidate_path in id_map.items()
                    if dependencies.canonicalize_id(candidate_id) == canonical_target
                ),
                None,
            )
        if not path_value:
            return None, False
        path = dependencies.path_factory(path_value)
        if _recent_stale_check() or path.exists():
            return path, False
        id_map.pop(page_id, None)
        dependencies.index_entries.get(vault_key, {}).pop(path_value, None)
        dependencies.bump_index_version(vault_key)
        return None, True


def _entry_cache_path(
    vault_key: str,
    page_id: str,
    canonical_target: str,
) -> tuple[Path | None, bool]:
    dependencies = _deps()
    with dependencies.index_lock:
        entries = dependencies.index_entries.get(vault_key, {})
        for path_value, entry in list(entries.items()):
            if dependencies.canonicalize_id(entry.get("id")) != canonical_target:
                continue
            path = dependencies.path_factory(path_value)
            if path.exists():
                dependencies.id_to_path.setdefault(vault_key, {})[page_id] = path_value
                return path, False
            entries.pop(path_value, None)
            dependencies.id_to_path.get(vault_key, {}).pop(page_id, None)
            dependencies.bump_index_version(vault_key)
            return None, True
    return None, False


def _direct_page_path(page_id: str) -> Path | None:
    dependencies = _deps()
    direct_path = dependencies.get_path("VAULT") / f"{page_id}.md"
    if direct_path.exists():
        return direct_path
    dashboards_path = dependencies.get_path("DASHBOARDS")
    dashboard_path = dashboards_path / f"{page_id}.json"
    return dashboard_path if dashboard_path.exists() else None


def _uuid_like(value: str) -> bool:
    return bool(
        value
        and re.fullmatch(
            r"[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}",
            value,
        )
    )


def _title_cache_path(vault_key: str, page_id: str) -> Path | None:
    title = str(page_id or "").strip().lower()
    if not title or _uuid_like(title):
        return None
    dependencies = _deps()
    with dependencies.index_lock:
        entries = dependencies.index_entries.get(vault_key, {})
        for path_value, entry in list(entries.items()):
            entry_title = str(entry.get("title") or "").strip().lower()
            if not entry_title or entry_title != title:
                continue
            path = dependencies.path_factory(path_value)
            if not path.exists():
                continue
            entry_id = entry.get("id")
            if entry_id:
                dependencies.id_to_path.setdefault(vault_key, {})[str(entry_id)] = path_value
            return path
    return None


def _initialized_cache_has_entries(vault_key: str) -> bool:
    dependencies = _deps()
    with dependencies.index_lock:
        has_entries = bool(dependencies.index_entries.get(vault_key))
    return bool(dependencies.index_initialized.get(vault_key) and has_entries)


def _full_scan_path(
    vault_key: str,
    page_id: str,
    canonical_target: str,
) -> Path | None:
    dependencies = _deps()
    vault_root = dependencies.get_path("VAULT")
    if not vault_root.exists():
        return None
    for markdown_path in vault_root.rglob("*.md"):
        try:
            raw = markdown_path.read_text(encoding="utf-8")
            metadata, _body = dependencies.parse_frontmatter(raw, markdown_path)
        except Exception:
            continue
        if dependencies.canonicalize_id(metadata.get("id", "")) != canonical_target:
            continue
        with dependencies.index_lock:
            dependencies.id_to_path.setdefault(vault_key, {})[page_id] = str(markdown_path)
        return markdown_path
    return None


def find_page_path(page_id: str, *, allow_full_scan: bool = True) -> Path | None:
    """Resolve a page ID, compatible UUID form or indexed title to a file."""
    dependencies = _deps()
    vault_path = dependencies.active_vault_path()
    if not vault_path:
        return None
    vault_key = str(vault_path)
    canonical_target = dependencies.canonicalize_id(page_id)

    path, stale_from_id = _exact_or_canonical_id_path(
        vault_key,
        page_id,
        canonical_target,
    )
    if path:
        return path
    path, stale_from_entry = _entry_cache_path(
        vault_key,
        page_id,
        canonical_target,
    )
    if path:
        return path
    if stale_from_id or stale_from_entry:
        dependencies.set_last_vault_sync(0.0)
        dependencies.logger.info(
            "Stale cache entry detected for page %s. Rescan scheduled.",
            page_id,
        )

    direct_path = _direct_page_path(page_id)
    if direct_path:
        return direct_path
    title_path = _title_cache_path(vault_key, page_id)
    if title_path:
        return title_path
    if not allow_full_scan:
        return None
    if _initialized_cache_has_entries(vault_key):
        dependencies.logger.info(
            "Page %s is absent from an initialized cache; skipping full scan.",
            page_id,
        )
        return None
    return _full_scan_path(vault_key, page_id, canonical_target)


_find_page_path = find_page_path


__all__ = [
    "Metadata",
    "PageCacheEntry",
    "PageResolverDependencies",
    "configure",
    "find_page_path",
]
