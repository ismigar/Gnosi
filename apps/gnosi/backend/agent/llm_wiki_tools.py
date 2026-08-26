"""Governed agent adapters for the built-in LLM Wiki plugin."""

from __future__ import annotations

import json

from langchain_core.tools import tool

from backend.agent.vault_tools import query_wiki
from backend.services.llm_wiki_actions import (
    LlmWikiActionError,
    process_status,
    run_maintenance,
    start_source_process,
)


@tool
def process_brain_source(
    resource_id: str,
    source_table_id: str = "",
    force: bool = False,
    language: str = "",
) -> str:
    """Start a durable Brain ingest for a configured source resource.

    Use ``force=true`` only when the user explicitly requests reprocessing.
    The result includes the durable job id; query it with
    ``brain_process_status`` instead of waiting synchronously.
    """

    try:
        result = start_source_process(
            resource_id,
            source_table_id=source_table_id,
            force=force,
            language=language,
        )
        return json.dumps(result, ensure_ascii=False, default=str)
    except LlmWikiActionError as exc:
        return json.dumps(
            {
                "status": "error",
                "code": exc.status_code,
                "error": exc.detail,
            },
            ensure_ascii=False,
        )


@tool
def brain_process_status(item_id: str, source_table_id: str = "") -> str:
    """Read the durable current or latest Brain process state."""

    try:
        return json.dumps(
            process_status(item_id, source_table_id=source_table_id),
            ensure_ascii=False,
            default=str,
        )
    except LlmWikiActionError as exc:
        return json.dumps(
            {
                "status": "error",
                "code": exc.status_code,
                "error": exc.detail,
            },
            ensure_ascii=False,
        )


@tool
def maintain_brain() -> str:
    """Rebuild Brain indexes and run deterministic lint without model work."""

    try:
        return json.dumps(
            run_maintenance(semantic=False),
            ensure_ascii=False,
            default=str,
        )
    except LlmWikiActionError as exc:
        return json.dumps(
            {
                "status": "error",
                "code": exc.status_code,
                "error": exc.detail,
            },
            ensure_ascii=False,
        )


@tool
def propose_brain_connections() -> str:
    """Run the explicit model-costing Brain connection proposal pass."""

    try:
        return json.dumps(
            run_maintenance(semantic=True),
            ensure_ascii=False,
            default=str,
        )
    except LlmWikiActionError as exc:
        return json.dumps(
            {
                "status": "error",
                "code": exc.status_code,
                "error": exc.detail,
            },
            ensure_ascii=False,
        )


LLM_WIKI_TOOL_HANDLERS = {
    "plugin.llm-wiki.query-wiki": query_wiki,
    "plugin.llm-wiki.process-source": process_brain_source,
    "plugin.llm-wiki.process-status": brain_process_status,
    "plugin.llm-wiki.maintain": maintain_brain,
    "plugin.llm-wiki.propose-connections": propose_brain_connections,
}
