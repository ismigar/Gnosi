"""Governed adapters for connected Notion discovery and exact cloning."""
from __future__ import annotations

import json
from typing import Dict, List

try:
    from langchain_core.tools import tool
except Exception:  # pragma: no cover
    def tool(fn=None, **_kwargs):
        return fn if fn else (lambda function: function)


@tool
async def notion_connection_status() -> str:
    """Read whether the Notion integration is connected."""
    from backend.api.notion_routes import notion_status

    return json.dumps(await notion_status())


@tool
async def list_notion_databases() -> str:
    """List databases shared with the connected Notion integration."""
    from backend.api.notion_routes import list_databases

    return json.dumps(await list_databases(), ensure_ascii=False, default=str)


@tool
async def read_notion_database_schema(database_id: str) -> str:
    """Read one exact connected Notion database schema."""
    from backend.api.notion_routes import database_schema

    return json.dumps(
        await database_schema(database_id), ensure_ascii=False, default=str
    )


@tool
async def list_notion_loose_pages() -> str:
    """List connected Notion pages that are outside databases."""
    from backend.api.notion_routes import list_loose_pages

    return json.dumps(await list_loose_pages(), ensure_ascii=False, default=str)


@tool
async def clone_notion_content(
    database_ids: List[str] | None = None,
    target_folder: str = "Notion",
    loose_page_types: Dict[str, str] | None = None,
    download_assets: bool = True,
) -> str:
    """Clone selected Notion content into the active Vault after explicit approval."""
    from backend.api.notion_routes import ClonePayload, run_clone

    payload = ClonePayload(
        database_ids=(database_ids or [])[:50] or None,
        target_folder=target_folder,
        loose_page_types=loose_page_types or None,
        download_assets=download_assets,
        prune_orphans=False,
        follow_subpages=True,
    )
    result = await run_clone(payload, x_vault_id=None)
    return json.dumps(result, ensure_ascii=False, default=str)


NOTION_READ_TOOLS = [
    notion_connection_status,
    list_notion_databases,
    read_notion_database_schema,
    list_notion_loose_pages,
]
NOTION_BULK_WRITE_TOOLS = [clone_notion_content]
