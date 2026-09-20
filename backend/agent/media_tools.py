"""Bounded gallery adapters over the existing media endpoints."""

from typing import Literal

from langchain_core.tools import tool

from backend.agent.feature_tool_support import feature_context, result_json


@tool
async def media_list_roots() -> str:
    """List the active Vault's available gallery roots before selecting a search scope."""
    from backend.domains.vault.media.routes import get_media_roots

    feature_context("social-publishing")
    return result_json({"roots": await get_media_roots()})


@tool
async def media_search(
    query: str = "",
    root: Literal["images", "assets", "library", "vault"] = "images",
    kind: Literal["", "image", "video", "audio", "pdf", "other"] = "",
    tags: str = "",
    offset: int = 0,
    limit: int = 25,
) -> str:
    """Find gallery files by name, type or tags within one configured root; returns paths and pagination."""
    from fastapi import Response
    from backend.domains.vault.media.routes import get_all_media

    feature_context("social-publishing")
    response = Response()
    payload = await get_all_media(
        response,
        album=None,
        limit=max(1, min(limit, 50)),
        offset=max(0, offset),
        root=root,
        kinds=kind or None,
        extensions=None,
        q=query[:200] or None,
        desc_contains=None,
        tags_any=tags[:500] or None,
        tags_all=None,
        tags_none=None,
        size_min=None,
        size_max=None,
        mtime_from=None,
        mtime_to=None,
        sort="mtime",
        dir="desc",
    )
    return result_json(
        {
            **payload,
            "index_state": response.headers.get("X-Gnosi-Media-Index"),
            "next_offset": response.headers.get("X-Gnosi-Media-Next-Offset"),
        }
    )


@tool
async def media_update_description(
    path_in_root: str,
    description: str,
    tags: list[str],
    root: Literal["images", "assets", "library", "vault"] = "images",
) -> str:
    """Set tags and description of one gallery file; never changes the file contents."""
    from pathlib import PurePosixPath
    from backend.domains.vault.media.routes import update_media_metadata

    feature_context("social-publishing", "editor")
    path = PurePosixPath(path_in_root)
    if not path_in_root or path.is_absolute() or ".." in path.parts or "\\" in path_in_root:
        raise ValueError("Use the relative file path returned by media_search.")
    if len(tags) > 50 or len(description) > 4000:
        raise ValueError("Use at most 50 tags and a 4000-character description.")
    return result_json(
        await update_media_metadata(
            metadata={"description": description, "tags": tags},
            path_in_root=path_in_root,
            root=root,
            filename=None,
            album=None,
        )
    )


MEDIA_READ_TOOLS = [media_list_roots, media_search]
MEDIA_WRITE_TOOLS = [media_update_description]
