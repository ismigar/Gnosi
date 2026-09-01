"""Translation-child discovery with cloud-file recovery."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from backend.domains.vault.pages.state import PageState
from backend.domains.vault.translation.types import Metadata


@dataclass(frozen=True)
class TranslationLookupDependencies:
    page_snapshot: Callable[[], list[Any]]
    find_translations: Callable[[str, Iterable[Any]], dict[str, Any]]
    canonicalize_id: Callable[[Any], str]
    materialize: Callable[[Path, str], Awaitable[object]]
    read_frontmatter_partial: Callable[[Path], tuple[Metadata, str]]
    active_vault_path: Callable[[], Path | None]
    build_page_cache_entry: Callable[[Path, Any], dict[str, Any]]
    bump_page_index_version: Callable[[str], None]
    invalidate_pages: Callable[[], None]
    page_state: PageState
    logger: logging.Logger


async def existing_translations(
    origin_id: str,
    dependencies: TranslationLookupDependencies,
) -> dict[str, Any]:
    """Return indexed child translations without adding disk I/O."""

    def _work() -> dict[str, Any]:
        try:
            return dependencies.find_translations(
                origin_id,
                dependencies.page_snapshot(),
            )
        except Exception as error:
            dependencies.logger.debug(
                "existing-translations lookup failed for %s: %s",
                origin_id,
                error,
            )
            return {}

    return await asyncio.to_thread(_work)


def _cache_recovered_page(
    page_path: Path,
    page_id: object,
    dependencies: TranslationLookupDependencies,
) -> None:
    vault_path = dependencies.active_vault_path()
    if not vault_path:
        return
    vault_key = str(vault_path)
    entry = dependencies.build_page_cache_entry(page_path, page_path.stat())
    with dependencies.page_state.index_lock:
        dependencies.page_state.index_entries.setdefault(vault_key, {})[str(page_path)] = entry
        if page_id:
            dependencies.page_state.id_to_path.setdefault(vault_key, {})[str(page_id)] = str(
                page_path
            )
        dependencies.bump_page_index_version(vault_key)
    dependencies.invalidate_pages()


async def recover_translations_from_disk(
    origin_id: str,
    table_directory: Path,
    known_langs: Iterable[object],
    dependencies: TranslationLookupDependencies,
) -> dict[str, Any]:
    """Recover unindexed cloud-backed translation children from one table."""
    recovered: dict[str, Any] = {}
    target = dependencies.canonicalize_id(origin_id)
    if not target:
        return recovered
    known = {str(language).strip().lower() for language in known_langs}
    try:
        candidates = sorted(table_directory.glob("*.md"))
    except OSError:
        return recovered
    for page_path in candidates:
        try:
            await dependencies.materialize(
                page_path,
                f"translate-recover/{origin_id}",
            )
            metadata, _body = await asyncio.to_thread(
                dependencies.read_frontmatter_partial,
                page_path,
            )
        except Exception:
            continue
        if dependencies.canonicalize_id(metadata.get("translation_origin_id")) != target:
            continue
        language = str(metadata.get("translation_lang") or "").strip().lower()
        if not language or language in known or language in recovered:
            continue
        page_id = metadata.get("id")
        try:
            _cache_recovered_page(
                page_path,
                page_id,
                dependencies,
            )
        except Exception as error:
            dependencies.logger.debug(
                "translate-recover: could not index %s: %s",
                page_path,
                error,
            )
        recovered[language] = SimpleNamespace(id=page_id, metadata=metadata)
    return recovered


__all__ = [
    "TranslationLookupDependencies",
    "existing_translations",
    "recover_translations_from_disk",
]
