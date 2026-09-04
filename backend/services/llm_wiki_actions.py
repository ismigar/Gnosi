"""Application actions shared by LLM Wiki HTTP routes and agent tools.

The action layer keeps validation and durable-job orchestration in one place.
HTTP handlers translate :class:`LlmWikiActionError` into status codes while
agent tools return the same error as an auditable tool result.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Protocol, cast

from backend.domains.vault.registry.records import is_record
from backend.utils.open_values import get_value, iterable_values


@dataclass
class LlmWikiActionError(ValueError):
    """A user-facing LLM Wiki action failure with an HTTP-compatible status."""

    status_code: int
    detail: str

    def __str__(self) -> str:
        return self.detail


class VaultActionsPort(Protocol):
    """Legacy Vault seams consumed by the LLM Wiki action boundary."""

    def _load_plugins_state(self) -> dict[str, object]: ...

    def _llm_wiki_enabled(self, state: dict[str, object]) -> bool: ...

    def _table_by_id(self, table_id: str) -> dict[str, object] | None: ...

    def find_page_path(self, page_id: str) -> Path | None: ...

    def parse_frontmatter(
        self,
        text: str,
        path: Path,
    ) -> tuple[dict[str, object], str]: ...

    def _resource_processed_value(self, metadata: dict[str, object]) -> str: ...

    def _llm_wiki_source_title(
        self,
        metadata: dict[str, object],
        path: Path,
        source_table: dict[str, object],
        source_config: dict[str, object],
    ) -> str: ...

    def get_p(self, key: str) -> Path: ...


def start_source_process(
    resource_id: str,
    *,
    source_table_id: str = "",
    force: bool = False,
    language: str = "",
) -> Dict[str, object]:
    """Start one validated durable Brain ingest or reprocess job."""

    from backend.api import vault_routes as legacy_vault_routes
    from backend.services import llm_wiki, llm_wiki_config

    vr = cast(VaultActionsPort, legacy_vault_routes)

    if not vr._llm_wiki_enabled(vr._load_plugins_state()):  # noqa: SLF001
        raise LlmWikiActionError(409, "The LLM Wiki plugin is disabled")

    item_id = str(resource_id or "").strip()
    if not item_id:
        raise LlmWikiActionError(400, "resource_id is required")

    config = llm_wiki_config.load_config()
    brain_table_id = str(config.get("brain_table_id") or "")
    if not brain_table_id:
        raise LlmWikiActionError(400, "No Brain table is configured")
    if not vr._table_by_id(brain_table_id):  # noqa: SLF001
        raise LlmWikiActionError(400, "The configured Brain table does not exist")

    path = vr.find_page_path(item_id)
    if not path or not path.exists():
        raise LlmWikiActionError(404, f"Resource {item_id} was not found")
    metadata, body = vr.parse_frontmatter(path.read_text(encoding="utf-8"), path)
    resolved_source_table_id = str(source_table_id or metadata.get("table_id") or "").strip()
    source_config = llm_wiki_config.get_source_config(resolved_source_table_id)
    source_table = vr._table_by_id(resolved_source_table_id)  # noqa: SLF001
    if not source_config or not source_table:
        raise LlmWikiActionError(
            400,
            "This row is not in a configured source table",
        )
    metadata_table_id = str(metadata.get("table_id") or "")
    if metadata_table_id and metadata_table_id != resolved_source_table_id:
        raise LlmWikiActionError(
            400,
            "source_table_id does not match the resource row",
        )

    resolved_language = str(language or "").strip()
    if not resolved_language:
        language_property_id = str(source_config.get("language_property_id") or "")
        language_property = next(
            (
                prop
                for prop in iterable_values(source_table.get("properties") or [])
                if is_record(prop) and str(prop.get("id") or "") == language_property_id
            ),
            None,
        )
        if language_property:
            resolved_language = str(
                metadata.get(str(language_property.get("name") or ""))
                or metadata.get(language_property_id)
                or ""
            ).strip()
    resolved_language = resolved_language or "the main language detected in the source"

    if llm_wiki.is_running(item_id, resolved_source_table_id):
        raise LlmWikiActionError(
            409,
            "This resource is already being processed",
        )
    processed_value = vr._resource_processed_value(metadata)  # noqa: SLF001
    if not force and processed_value:
        raise LlmWikiActionError(
            409,
            f"Already processed on {processed_value}; use force to reprocess",
        )

    title = vr._llm_wiki_source_title(  # noqa: SLF001
        metadata,
        path,
        source_table,
        source_config,
    )
    job = llm_wiki.start_ingest(
        item_id,
        title,
        metadata,
        body,
        brain_table_id,
        vr.get_p("VAULT"),
        resolved_language,
        source_table_id=resolved_source_table_id,
        source_table=source_table,
        source_config=source_config,
        force=force,
    )
    return {
        "status": "started",
        "item_id": item_id,
        "resource_id": item_id,
        "source_table_id": resolved_source_table_id,
        "job_id": job.get("job_id"),
        "job": job,
    }


def process_status(item_id: str, *, source_table_id: str = "") -> Dict[str, object]:
    """Return the durable current or latest process status."""

    from backend.services import llm_wiki

    normalized = str(item_id or "").strip()
    if not normalized:
        raise LlmWikiActionError(400, "item_id is required")
    return llm_wiki.get_job_status(normalized, str(source_table_id or "").strip())


def run_maintenance(*, semantic: bool = False) -> Dict[str, object]:
    """Rebuild Brain indexes/cache, lint, and optionally propose connections."""

    from backend.services import (
        llm_wiki_config,
        llm_wiki_indices,
        llm_wiki_lint,
        llm_wiki_suggestions,
    )

    config = llm_wiki_config.load_config()
    brain_table_id = str(config.get("brain_table_id") or "")
    if not brain_table_id:
        raise LlmWikiActionError(400, "No Brain table is configured")
    index_report = llm_wiki_indices.rebuild_indexes(brain_table_id, config)
    source_ids = [
        str(get_value(item, "table_id") or "")
        for item in iterable_values(config.get("source_tables") or [])
        if get_value(item, "table_id")
    ]
    lint_report = llm_wiki_lint.run_lint(brain_table_id, source_ids)
    queued = llm_wiki_suggestions.generate_suggestions(brain_table_id) if semantic else 0
    return {
        "indexes": index_report,
        "lint": lint_report,
        "suggestions_queued": queued,
        "suggestions_pending": len(llm_wiki_suggestions.load_queue()),
    }


async def run_maintenance_async(*, semantic: bool = False) -> Dict[str, object]:
    """Async adapter that keeps blocking maintenance off the event loop."""

    return await asyncio.to_thread(run_maintenance, semantic=semantic)
