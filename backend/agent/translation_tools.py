"""Governed adapters for the existing idempotent translation workflows."""
from __future__ import annotations

import json

from fastapi import BackgroundTasks
from langchain_core.tools import tool


@tool
async def translate_vault_page(page_id: str, target_languages: list[str]) -> str:
    """Translate one page idempotently after an explicit cost-bearing request."""
    from backend.domains.vault.translation.routes import translate_page

    result = await translate_page(
        BackgroundTasks(),
        {
            "page_id": page_id,
            "target_languages": target_languages[:20],
            "button_action": "translate_page",
        },
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def translate_vault_row(item_id: str, target_languages: list[str]) -> str:
    """Translate one table row idempotently after an explicit cost-bearing request."""
    from backend.domains.vault.translation.routes import translate_row

    result = await translate_row(
        BackgroundTasks(),
        {
            "item_id": item_id,
            "target_languages": target_languages[:20],
            "button_action": "translate_row",
        },
    )
    return json.dumps(result, ensure_ascii=False, default=str)


@tool
async def translate_vault_rows(
    item_ids: list[str], target_languages: list[str]
) -> str:
    """Translate at most 100 table rows after an explicit bulk request."""
    from backend.domains.vault.translation.routes import translate_rows

    result = await translate_rows(
        BackgroundTasks(),
        {
            "item_ids": item_ids[:100],
            "target_languages": target_languages[:20],
            "button_action": "translate_row",
        },
    )
    return json.dumps(result, ensure_ascii=False, default=str)


TRANSLATION_AI_TOOLS = [
    translate_vault_page,
    translate_vault_row,
    translate_vault_rows,
]
