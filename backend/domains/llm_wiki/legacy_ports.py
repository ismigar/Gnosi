"""Typed late-bound ports for historical Vault facade collaborators."""

from __future__ import annotations

from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, cast


def path_for(key: str) -> Path:
    """Resolve one historical Vault path through its late-bound facade seam."""
    from backend.api import vault_routes

    get_path = cast(Callable[[str], Path], vault_routes.get_p)
    return get_path(key)


def local_data_path() -> Path:
    return path_for("LOCAL_DATA")


def resolve_table_folder(metadata: dict[str, Any]) -> Path | None:
    from backend.api import vault_routes

    resolve = cast(
        Callable[[dict[str, Any]], Path | None],
        vault_routes._resolve_table_folder_from_metadata,
    )
    return resolve(metadata)


def unique_filepath(directory: Path, title: str, suffix: str) -> Path:
    from backend.api import vault_routes

    resolve = cast(
        Callable[[Path, str, str], Path],
        vault_routes._get_unique_filepath,
    )
    return resolve(directory, title, suffix)


def save_page(path: Path, metadata: dict[str, Any], body: str) -> None:
    from backend.api import vault_routes

    save = cast(
        Callable[[Path, dict[str, Any], str], None],
        vault_routes.save_page_md,
    )
    save(path, metadata, body)


def register_page(path: Path) -> None:
    from backend.api import vault_routes

    register = cast(Callable[[Path], None], vault_routes.register_page_in_index)
    register(path)


def parse_frontmatter(raw: str, path: Path) -> tuple[dict[str, Any], str]:
    from backend.api import vault_routes

    parse = cast(
        Callable[[str, Path], tuple[dict[str, Any], str]],
        vault_routes.parse_frontmatter,
    )
    return parse(raw, path)


def table_pages(table_id: str) -> list[Any]:
    from backend.api import vault_routes

    get_pages = cast(Callable[[str], Iterable[Any]], vault_routes._get_pages_for_table)
    return list(get_pages(table_id) or [])


def table_by_id(table_id: str) -> dict[str, Any] | None:
    from backend.api import vault_routes

    get_table = cast(
        Callable[[str], dict[str, Any] | None],
        vault_routes._table_by_id,
    )
    return get_table(table_id)


def mark_resource_processed(page_id: str, processed_at: str) -> None:
    from backend.api import vault_routes

    mark = cast(
        Callable[[str, str], None],
        vault_routes.mark_resource_processed,
    )
    mark(page_id, processed_at)
