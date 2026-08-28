"""Vault reference-library read adapter."""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any, cast

from backend.domains.agent.sources.scopes import (
    MAX_EXCERPT_CHARS,
    MAX_RECORD_CHARS,
    _bounded_json_value,
    _plain_text,
)


def _reference_table() -> dict[str, Any] | None:
    """Resolve the legacy reference-table seam lazily."""
    from backend.agent import internal_sources

    return internal_sources._reference_table()


def _metadata_value(metadata: dict[str, Any], *names: str) -> Any:
    wanted = {name.casefold().replace(" ", "").replace("_", "") for name in names}
    for key, value in (metadata or {}).items():
        normalized = str(key).casefold().replace(" ", "").replace("_", "")
        if normalized in wanted:
            return value
    return None


def _reference_page_body(page: Any) -> str:
    from backend.services.context_vars import get_active_vault_path

    active_vault = get_active_vault_path()
    if active_vault is None:
        raise RuntimeError("An active Vault is required to read reference records")
    root = active_vault.resolve()
    path_value = getattr(page, "path", None)
    if not path_value:
        return ""
    path = Path(path_value).resolve()
    try:
        path.relative_to(root)
    except ValueError as error:
        raise PermissionError("Reference record path is outside the active Vault.") from error
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    return raw.split("---", 2)[2] if raw.startswith("---") else raw


def _reference_payload(page: Any, *, include_body: bool = False) -> dict[str, Any]:
    metadata = dict(getattr(page, "metadata", {}) or {})
    payload = {
        "id": str(getattr(page, "id", "") or ""),
        "title": str(getattr(page, "title", "") or "")[:1_000],
        "citation_key": str(_metadata_value(metadata, "Citation Key") or "")[:500],
        "authors": _metadata_value(metadata, "Authors", "Author"),
        "item_type": str(_metadata_value(metadata, "Item Type", "Type") or "")[:200],
        "year": _metadata_value(metadata, "Year", "Date", "Any"),
        "language": str(_metadata_value(metadata, "Language", "Idioma") or "")[:100],
        "doi": str(_metadata_value(metadata, "DOI") or "")[:500],
        "url": str(_metadata_value(metadata, "URL") or "")[:2_000],
        "abstract": _plain_text(
            _metadata_value(metadata, "Abstract", "Summary", "Resum") or "",
            MAX_EXCERPT_CHARS,
        ),
    }
    if include_body:
        payload["body"] = _plain_text(_reference_page_body(page), MAX_RECORD_CHARS)
        payload["metadata"] = {
            str(key): _bounded_json_value(value)
            for key, value in metadata.items()
            if not str(key).startswith("_")
        }
    return payload


def _reference_pages(scope: dict[str, Any]) -> list[Any]:
    from backend.api.vault_routes import _get_pages_for_table

    table = _reference_table()
    if not table:
        return []
    list_pages = cast(Callable[[str], list[Any]], _get_pages_for_table)
    pages = list_pages(str(table["id"]))
    output = []
    for page in pages:
        metadata = dict(getattr(page, "metadata", {}) or {})
        item_type = str(_metadata_value(metadata, "Item Type", "Type") or "").casefold()
        language = str(_metadata_value(metadata, "Language", "Idioma") or "").casefold()
        if scope["item_types"] and item_type not in scope["item_types"]:
            continue
        if scope["languages"] and language not in scope["languages"]:
            continue
        output.append(page)
    return output


def _references_inventory(scope: dict[str, Any]) -> dict[str, Any]:
    table = _reference_table()
    pages = _reference_pages(scope)
    counts: dict[str, int] = {}
    for page in pages:
        item_type = _reference_payload(page).get("item_type") or "Unspecified"
        counts[str(item_type)] = counts.get(str(item_type), 0) + 1
    return {
        "source": "references",
        "configured": table is not None,
        "table_id": str((table or {}).get("id") or ""),
        "count": len(pages),
        "item_types": counts,
        "scope": scope,
    }


def _references_search(scope: dict[str, Any], query_text: str) -> dict[str, Any]:
    term = str(query_text or "").strip().casefold()
    records = [_reference_payload(page) for page in _reference_pages(scope)]
    if term:
        records = [
            record
            for record in records
            if term in json.dumps(record, ensure_ascii=False, default=str).casefold()
        ]
    return {"source": "references", "query": term, "records": records[: scope["limit"]]}


def _references_read(scope: dict[str, Any], record_id: str) -> dict[str, Any]:
    page = next(
        (
            page
            for page in _reference_pages(scope)
            if str(getattr(page, "id", "")) == str(record_id)
        ),
        None,
    )
    if page is None:
        raise KeyError(record_id)
    return _reference_payload(page, include_body=True)
