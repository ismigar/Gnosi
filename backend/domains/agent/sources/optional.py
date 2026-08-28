"""Social, meeting and Notion read adapters."""

from __future__ import annotations

import json
from collections.abc import Callable, Coroutine
from typing import Any, TypeVar, cast

from backend.domains.agent.sources.scopes import (
    MAX_EXCERPT_CHARS,
    MAX_RECORD_CHARS,
    _bounded_json_value,
    _iso_datetime,
    _plain_text,
)

_T = TypeVar("_T")


def _assert_personal_workspace() -> None:
    """Resolve the legacy workspace guard lazily."""
    from backend.agent import internal_sources

    internal_sources._assert_personal_workspace()


def _run_async(coroutine: Coroutine[Any, Any, _T]) -> _T:
    """Resolve the legacy async seam lazily."""
    from backend.agent import internal_sources

    return internal_sources._run_async(coroutine)


def _reference_page_body(page: Any) -> str:
    """Share the reference path guard without duplicating it."""
    from backend.agent import internal_sources

    return internal_sources._reference_page_body(page)


def _social_records(scope: dict[str, Any]) -> list[dict[str, Any]]:
    from backend.services import social_store

    _assert_personal_workspace()
    publications = _run_async(social_store.list_publications())
    records: list[dict[str, Any]] = []
    for publication in publications:
        networks = [
            item.strip().lower()
            for item in str(publication.get(social_store.COL_NETWORKS) or "").split(",")
            if item.strip()
        ]
        status = str(publication.get(social_store.COL_STATUS) or "").lower()
        if scope["networks"] and not set(networks).intersection(scope["networks"]):
            continue
        if scope["statuses"] and status not in scope["statuses"]:
            continue
        try:
            messages = json.loads(publication.get(social_store.COL_MESSAGES) or "{}")
        except (TypeError, ValueError):
            messages = {}
        records.append(
            {
                "id": str(publication.get("id") or ""),
                "title": str(publication.get("title") or "")[:500],
                "status": status,
                "networks": networks,
                "scheduled_at": str(publication.get(social_store.COL_SCHEDULED) or "")[:100],
                "published_at": str(publication.get(social_store.COL_PUBLISHED) or "")[:100],
                "source_page_id": str(publication.get(social_store.COL_ORIGIN) or "")[:200],
                "messages": {
                    str(network)[:50]: {
                        "text": _plain_text((value or {}).get("text") or "", MAX_EXCERPT_CHARS),
                        "status": str((value or {}).get("status") or "")[:100],
                        "url": str((value or {}).get("url") or "")[:2_000],
                    }
                    for network, value in list(messages.items())[:20]
                    if isinstance(value, dict)
                },
            }
        )
    return records


def _social_inventory(scope: dict[str, Any]) -> dict[str, Any]:
    records = _social_records(scope)
    statuses: dict[str, int] = {}
    for record in records:
        statuses[record["status"]] = statuses.get(record["status"], 0) + 1
    return {"source": "social", "count": len(records), "statuses": statuses, "scope": scope}


def _social_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = _social_records(scope)
    if term:
        records = [
            record
            for record in records
            if term in json.dumps(record, ensure_ascii=False).casefold()
        ]
    return {"source": "social", "query": term, "records": records[: scope["limit"]]}


def _social_read(scope: dict[str, Any], record_id: str) -> dict[str, Any]:
    record = next((item for item in _social_records(scope) if item["id"] == str(record_id)), None)
    if record is None:
        raise KeyError(record_id)
    return record


def _meeting_pages(scope: dict[str, Any]) -> list[Any]:
    from backend.api.vault_routes import _get_pages_snapshot

    start = scope.get("date_from") or ""
    end = scope.get("date_to") or ""
    pages = []
    read_pages = cast(Callable[[], list[Any]], _get_pages_snapshot)
    for page in read_pages():
        metadata = dict(getattr(page, "metadata", {}) or {})
        title = str(getattr(page, "title", "") or metadata.get("title") or "")
        if metadata.get("icon") != "🎙️" and not title.startswith(("Acta —", "Minutes —")):
            continue
        modified = str(
            metadata.get("date")
            or metadata.get("created_at")
            or getattr(page, "modified", "")
            or ""
        )
        normalized = _iso_datetime(modified)
        if start and normalized and normalized < start:
            continue
        if end and normalized and normalized > end:
            continue
        pages.append(page)
    return pages


def _meeting_payload(page: Any, *, include_body: bool = False) -> dict[str, Any]:
    payload = {
        "id": str(getattr(page, "id", "") or ""),
        "title": str(getattr(page, "title", "") or "")[:1_000],
        "modified": str(getattr(page, "modified", "") or "")[:100],
    }
    if include_body:
        payload["body"] = _plain_text(_reference_page_body(page), MAX_RECORD_CHARS)
    return payload


def _meetings_inventory(scope: dict[str, Any]) -> dict[str, Any]:
    pages = _meeting_pages(scope)
    return {"source": "meetings", "count": len(pages), "scope": scope}


def _meetings_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = [_meeting_payload(page) for page in _meeting_pages(scope)]
    if term:
        records = [item for item in records if term in item["title"].casefold()]
    return {"source": "meetings", "query": term, "records": records[: scope["limit"]]}


def _meetings_read(scope: dict[str, Any], record_id: str) -> dict[str, Any]:
    page = next(
        (item for item in _meeting_pages(scope) if str(getattr(item, "id", "")) == str(record_id)),
        None,
    )
    if page is None:
        raise KeyError(record_id)
    return _meeting_payload(page, include_body=True)


def _notion_client() -> Any:
    from backend.api.notion_routes import _get_token
    from backend.services.notion_importer import NotionClient

    _assert_personal_workspace()
    token = _get_token()
    if not token:
        raise PermissionError("Notion is not connected.")
    return NotionClient(token)


def _notion_records(scope: dict[str, Any]) -> list[dict[str, Any]]:
    from backend.services.notion_importer import _plain_title

    client = _notion_client()
    types = set(scope["object_types"] or ["database", "page"])
    records: list[dict[str, Any]] = []
    if "database" in types:
        for database in client.search_databases():
            database_id = str(database.get("id") or "")
            if scope["database_ids"] and database_id not in scope["database_ids"]:
                continue
            records.append(
                {
                    "id": f"database::{database_id}",
                    "object_type": "database",
                    "notion_id": database_id,
                    "title": _plain_title(database.get("title")) or "Untitled",
                    "url": str(database.get("url") or "")[:2_000],
                }
            )
    if "page" in types:
        for page in client.search_pages():
            page_id = str(page.get("id") or "")
            parent = page.get("parent") or {}
            database_id = str(parent.get("database_id") or "")
            if scope["database_ids"] and database_id not in scope["database_ids"]:
                continue
            title = ""
            for prop in (page.get("properties") or {}).values():
                if prop.get("type") == "title":
                    title = _plain_title(prop.get("title"))
                    break
            records.append(
                {
                    "id": f"page::{page_id}",
                    "object_type": "page",
                    "notion_id": page_id,
                    "database_id": database_id or None,
                    "title": title or "Untitled",
                    "url": str(page.get("url") or "")[:2_000],
                    "last_edited_time": str(page.get("last_edited_time") or "")[:100],
                }
            )
    return records


def _notion_inventory(scope: dict[str, Any]) -> dict[str, Any]:
    records = _notion_records(scope)
    return {
        "source": "notion",
        "count": len(records),
        "counts": {
            kind: sum(1 for item in records if item["object_type"] == kind)
            for kind in ("database", "page")
        },
        "scope": scope,
    }


def _notion_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = _notion_records(scope)
    if term:
        records = [item for item in records if term in item["title"].casefold()]
    return {"source": "notion", "query": term, "records": records[: scope["limit"]]}


def _notion_read(scope: dict[str, Any], record_id: str) -> dict[str, Any]:
    from backend.services.notion_importer import blocks_to_md, map_database_schema, page_to_values

    record = next((item for item in _notion_records(scope) if item["id"] == str(record_id)), None)
    if record is None:
        raise KeyError(record_id)
    client = _notion_client()
    if record["object_type"] == "database":
        database = client.get_database(record["notion_id"])
        record["schema"] = _bounded_json_value(map_database_schema(database))
    else:
        page = client.get_page(record["notion_id"])
        record["properties"] = _bounded_json_value(page_to_values(page))
        record["body"] = blocks_to_md(client.get_block_children(record["notion_id"]))[
            :MAX_RECORD_CHARS
        ]
    return record
