"""Typed late-bound Vault ports for social publication persistence."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any, cast

from fastapi import BackgroundTasks


async def create_table(table: dict[str, Any]) -> None:
    from backend.api import vault_routes

    create = cast(Callable[[dict[str, Any]], Awaitable[Any]], vault_routes.create_table)
    await create(table)


def load_registry() -> dict[str, Any]:
    from backend.api import vault_routes

    load = cast(Callable[[], dict[str, Any]], vault_routes.load_registry)
    return load()


async def create_page(
    *,
    title: str,
    content: str,
    metadata: dict[str, Any],
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    from backend.api import vault_routes

    request_factory = cast(Callable[..., Any], vault_routes.PageSaveRequest)
    request = request_factory(title=title, content=content, metadata=metadata)
    create = cast(
        Callable[[Any, BackgroundTasks], Awaitable[dict[str, Any]]],
        vault_routes.create_page,
    )
    return await create(request, background_tasks)


def find_page_path(page_id: str) -> Path | None:
    from backend.api import vault_routes

    find = cast(Callable[[str], Path | None], vault_routes.find_page_path)
    return find(page_id)


def parse_frontmatter(raw: str, path: Path) -> tuple[dict[str, Any], str]:
    from backend.api import vault_routes

    parse = cast(
        Callable[[str, Path], tuple[dict[str, Any], str]],
        vault_routes.parse_frontmatter,
    )
    return parse(raw, path)


async def patch_page(
    page_id: str,
    metadata: dict[str, Any],
    background_tasks: BackgroundTasks,
) -> None:
    from backend.api import vault_routes

    request_factory = cast(Callable[..., Any], vault_routes.PagePatchRequest)
    request = request_factory(metadata=metadata)
    patch = cast(
        Callable[[str, Any, BackgroundTasks], Awaitable[Any]],
        vault_routes.patch_page,
    )
    await patch(page_id, request, background_tasks)


def resolve_table_folder(metadata: dict[str, Any]) -> Path | None:
    from backend.api import vault_routes

    resolve = cast(
        Callable[[dict[str, Any]], Path | None],
        vault_routes._resolve_table_folder_from_metadata,
    )
    return resolve(metadata)
