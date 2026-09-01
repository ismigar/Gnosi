"""Typed Vault domain extracted from the historical route facade."""

import asyncio
import importlib as _legacy_importlib
import re
from collections.abc import AsyncIterator
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.domains.vault.comments.repository import InlineComments
from backend.utils.open_values import item_value

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")
router: APIRouter = _legacy.router


class ImportFile(BaseModel):
    __module__ = "backend.api.vault_routes"
    name: str
    content: str


class ImportRequest(BaseModel):
    __module__ = "backend.api.vault_routes"
    files: list[ImportFile]
    folder: str = "Importades"


class ImportErrorResponse(BaseModel):
    name: str
    error: str


class ImportResponse(BaseModel):
    imported: int
    errors: list[ImportErrorResponse]
    folder: str


@router.post(
    "/import",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=ImportResponse,
)
async def import_markdown(body: ImportRequest) -> dict[str, object]:
    """Imports Markdown/Obsidian files into the vault (importer style with UI).

    Each file is created as a page inside `folder`. Existing frontmatter is preserved
    (an `id` is added if it doesn't have one) and the body as-is: wikilinks
    `[[…]]`, `#…` tags, and Obsidian frontmatter are already compatible with Gnosi.
    Returns the count of imported files and the errors per file.
    """
    import yaml as _yaml

    from backend.services.context_vars import get_active_vault_path

    vault = get_active_vault_path()
    if not vault:
        raise _legacy.HTTPException(status_code=503, detail="No hi ha cap vault actiu")
    folder = _legacy.sanitize_rel_folder(body.folder, fallback="Importades")
    target_dir = _legacy.Path(vault) / folder
    target_dir.mkdir(parents=True, exist_ok=True)
    imported = 0
    errors = []
    for f in body.files:
        try:
            stem = _legacy.Path(f.name).stem or "Sense títol"
            raw = f.content or ""
            meta, body_md = _legacy.parse_frontmatter(raw)
            if not isinstance(meta, dict):
                meta = {}
            if body_md is None:
                body_md = raw
            meta.setdefault("title", meta.get("title") or stem)
            if not meta.get("id"):
                meta["id"] = str(_legacy.uuid.uuid4())
            safe = _legacy.sanitize_vault_title(stem)
            path = target_dir / f"{safe}.md"
            if path.exists():
                path = target_dir / f"{safe} {item_value(meta['id'], slice(None, 8))}.md"
            fm = _yaml.safe_dump(meta, allow_unicode=True, sort_keys=False).strip()
            path.write_text(f"---\n{fm}\n---\n\n{str(body_md).lstrip()}\n", encoding="utf-8")
            _legacy.register_page_in_index(path)
            imported += 1
        except Exception as e:
            errors.append({"name": f.name, "error": str(e)})
    return {"imported": imported, "errors": errors, "folder": folder}


def _inline_comments_path(page_id: str) -> Path:
    return _legacy.comments_repository.inline_comments_path(page_id, _legacy.get_active_vault_path)


def _load_inline_comments(page_id: str) -> InlineComments:
    return _legacy.comments_repository.load_inline_comments(_inline_comments_path, page_id)


list_inline_comments, create_inline_comment, update_inline_comment, delete_inline_comment = (
    _legacy.comments_api.register_inline_comment_routes(
        router,
        post_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
        patch_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
        delete_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
        workspace_context_dependency=_legacy.get_workspace_context,
        dependencies=_legacy._COMMENTS_DEPENDENCIES,
    )
)
_synced_subscribers: dict[asyncio.Queue[str], str] = {}


def _broadcast_synced(sync_id: str, v_str: str) -> None:
    """Notifies SSE subscribers OF VAULT `v_str` that a synced block has changed."""
    for q, qv in list(_synced_subscribers.items()):
        if qv != v_str:
            continue
        try:
            q.put_nowait(sync_id)
        except Exception:
            pass


def _synced_block_path(sync_id: str) -> Path:
    vault = _legacy.get_active_vault_path()
    if not vault:
        raise _legacy.HTTPException(status_code=503, detail="No hi ha cap vault actiu")
    safe = _legacy.re.sub("[^\\w\\-]", "", str(sync_id))[:80]
    if not safe:
        raise _legacy.HTTPException(status_code=400, detail="sync_id invàlid")
    d = _legacy.Path(vault) / ".gnosi" / "synced"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{safe}.md"


@router.get("/synced-events", response_model=None)
async def synced_events() -> StreamingResponse:
    """SSE: notifies REAL-TIME changes of synced blocks to all connected
    clients (any device). The frontend subscribes to it with EventSource
    and reloads the source of the affected block."""
    from fastapi.responses import StreamingResponse

    queue: asyncio.Queue[str] = _legacy.asyncio.Queue()
    _synced_subscribers[queue] = _legacy._current_vault_key()

    async def gen() -> AsyncIterator[str]:
        try:
            yield "event: ready\ndata: {}\n\n"
            while True:
                try:
                    sync_id = await _legacy.asyncio.wait_for(queue.get(), timeout=25)
                    yield f"data: {_legacy.json.dumps({'syncId': sync_id})}\n\n"
                except _legacy.asyncio.TimeoutError:
                    yield "event: ping\ndata: {}\n\n"
        except _legacy.asyncio.CancelledError:
            raise
        finally:
            _synced_subscribers.pop(queue, None)

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


class SyncedBlockResponse(BaseModel):
    __module__ = "backend.api.vault_routes"
    sync_id: str
    content: str


@router.get("/synced/{sync_id}", response_model=SyncedBlockResponse)
async def get_synced_block(sync_id: str) -> dict[str, str]:
    """Content of a synced block (source shared across instances)."""
    p = _synced_block_path(sync_id)
    content = p.read_text(encoding="utf-8") if p.exists() else ""
    return {"sync_id": sync_id, "content": content}


class SyncedBlockSave(BaseModel):
    __module__ = "backend.api.vault_routes"
    content: str = ""


class SyncedBlockSaveResponse(BaseModel):
    __module__ = "backend.api.vault_routes"
    sync_id: str
    content: str
    saved: bool


@router.put(
    "/synced/{sync_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=SyncedBlockSaveResponse,
)
async def save_synced_block(sync_id: str, body: SyncedBlockSave) -> dict[str, object]:
    """Saves the source of a synced block. All instances (on any
    page) that reference this `sync_id` reflect the change."""
    p = _synced_block_path(sync_id)
    p.write_text(body.content or "", encoding="utf-8")
    _broadcast_synced(sync_id, _legacy._current_vault_key())
    return {"sync_id": sync_id, "content": body.content or "", "saved": True}


get_link_index_stats, post_link_index_rebuild, get_backlinks, get_outlinks = (
    _legacy.link_navigation_api.register_routes(
        router,
        admin_dependencies=[_legacy.Depends(_legacy.require_role("admin"))],
        dependencies=_legacy._LINK_API_DEPENDENCIES,
    )
)


def _build_unlinked_mention_regex(target_title: str) -> re.Pattern[str] | None:
    return _legacy.link_parsing.build_unlinked_mention_regex(target_title)


def _strip_existing_links_for_mentions_scan(text: str) -> str:
    return _legacy.link_parsing.strip_existing_links(text)


def _count_unlinked_mentions(text: str, target_title: str) -> int:
    return _legacy.link_parsing.count_unlinked_mentions(text, target_title)


def _first_unlinked_mention_snippet(text: str, target_title: str, radius: int = 48) -> str:
    return _legacy.link_parsing.first_unlinked_mention_snippet(text, target_title, radius)


def _link_mentions_in_plain_segments(
    body: str, target_title: str, target_id: str
) -> tuple[str, int]:
    return _legacy.link_parsing.link_mentions_in_plain_segments(
        body, target_title, target_id, _legacy.canonical_vault_browser_path
    )


get_unlinked_mentions, link_unlinked_mentions = _legacy.link_mentions_api.register_routes(
    router,
    editor_dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    dependencies=_legacy._LINK_API_DEPENDENCIES,
)
