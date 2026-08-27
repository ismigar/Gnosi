"""Global and alias index HTTP registration."""

from __future__ import annotations

from collections.abc import Callable

from fastapi import APIRouter

from backend.domains.vault.links.api.dependencies import LinkApiDependencies


def register_routes(
    router: APIRouter,
    dependencies: LinkApiDependencies,
) -> tuple[Callable[..., object], Callable[..., object]]:
    def get_global_index() -> dict[str, str]:
        """Returns a global mapping id -> title for the entire Vault.

        Declared as `def` (not `async def`) so FastAPI runs it in a threadpool —
        `build_id_title_index` rglobs the whole vault on OneDrive and reads many
        files; running on the asyncio loop would block all concurrent requests.
        Same rationale as /backlinks and /unlinked-mentions below.
        """
        return dependencies.build_id_title_index()

    def get_alias_index() -> dict[str, list[str]]:
        """Map of id → [aliases] for notes that declare `aliases:` in the frontmatter.

        Consumed by the frontend to (a) suggest aliases in the wikilink
        `[[…]]` autocomplete and (b) resolve `[[Alias]]` locally without a round-trip to
        /resolve-by-title. Obsidian-style: a note can have multiple aliases.
        """
        return dependencies.build_alias_index()

    router.add_api_route(
        "/global-index",
        get_global_index,
        methods=["GET"],
        response_model=None,
    )
    router.add_api_route(
        "/alias-index",
        get_alias_index,
        methods=["GET"],
        response_model=None,
    )
    return get_global_index, get_alias_index


__all__ = ["register_routes"]
