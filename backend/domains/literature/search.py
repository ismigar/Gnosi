"""Federated and indexed academic search orchestration."""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable, cast

from fastapi import HTTPException

from backend.config.logger_config import get_logger
from backend.domains.literature.repositories import (
    _credential_value,
    _search_plugin_adapter,
    catalog,
    load_config,
)
from backend.domains.literature.state import (
    _SEARCH_LOCK,
    _SEARCH_TASKS,
    MAX_EVENTS,
    MAX_SEARCH_RESULTS,
)
from backend.domains.literature.storage import (
    _connect_index,
    _now,
    _search_path,
    literature_dir,
)
from backend.services import academic_connectors
from backend.services.literature_models import (
    deduplicate_works,
    deterministic_key,
    normalize_title,
)
from backend.utils.safe_io import safe_write_json

log = get_logger(__name__)


def _read_search(vault_path: Path | str, search_id: str) -> dict[str, Any]:
    path = _search_path(vault_path, search_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="Literature search not found.")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(
            status_code=500, detail="Literature search history is unavailable."
        ) from exc
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="Literature search history is unavailable.")
    return dict(data)


def _write_search(vault_path: Path | str, search: dict[str, Any]) -> None:
    with _SEARCH_LOCK:
        safe_write_json(
            _search_path(vault_path, search["id"]), search, indent=2, ensure_ascii=False
        )


def _event(search: dict[str, Any], event_type: str, **payload: Any) -> None:
    events = search.setdefault("events", [])
    seq = int(events[-1]["seq"] if events else 0) + 1
    events.append({"seq": seq, "type": event_type, "at": _now(), **payload})
    if len(events) > MAX_EVENTS:
        del events[: len(events) - MAX_EVENTS]


def search_oai_index(
    vault_path: Path | str, source_id: str, query: str, filters: dict[str, Any], limit: int
) -> list[dict[str, Any]]:
    expression = _oai_fts_expression(query)
    if not expression:
        return []
    params: list[Any] = [source_id, expression]
    where = "r.source_id=? AND oai_records_fts MATCH ?"
    if filters.get("date_from"):
        where += " AND r.year>=?"
        params.append(int(str(filters["date_from"])[:4]))
    if filters.get("date_to"):
        where += " AND r.year<=?"
        params.append(int(str(filters["date_to"])[:4]))
    requested_limit = max(1, min(int(limit), 100))
    has_language_filter = bool(filters.get("languages") or filters.get("language"))
    params.append(min(100, requested_limit * 4) if has_language_filter else requested_limit)
    with _connect_index(vault_path) as connection:
        rows = connection.execute(
            f"""SELECT r.work_json FROM oai_records r
            JOIN oai_records_fts f ON f.rowid=r.rowid
            WHERE {where} ORDER BY bm25(oai_records_fts) LIMIT ?""",
            params,
        ).fetchall()
    filtered = academic_connectors.filter_works(
        [json.loads(row["work_json"]) for row in rows], filters
    )
    return cast(list[dict[str, Any]], filtered)[:requested_limit]


def _oai_fts_expression(query: str) -> str:
    tokens = [token for token in re.findall(r"[\w-]+", normalize_title(query)) if len(token) > 1][
        :12
    ]
    return " AND ".join(f'"{token.replace(chr(34), "")}"' for token in tokens)


def _source_query_audit(
    source: dict[str, Any],
    search: dict[str, Any],
    requests: list[dict[str, Any]],
    effective_query: str | None = None,
) -> dict[str, Any]:
    """Describe the effective query without persisting secrets."""
    provider_query = effective_query or search["query"]
    return {
        "source_id": source["id"],
        "source_name": source.get("name") or source["id"],
        "original_query": search["query"],
        "effective_query": provider_query,
        "filters": deepcopy(search.get("filters") or {}),
        "connector_version": 1,
        "provider_syntax": (
            _oai_fts_expression(provider_query) if source.get("kind") == "oai" else provider_query
        ),
        "requests": deepcopy(requests),
    }


def start_search(
    vault_path: Path | str,
    *,
    query: str,
    filters: dict[str, Any],
    source_ids: Iterable[str] | None = None,
    source_queries: dict[str, str] | None = None,
    ai_audits: list[dict[str, Any]] | None = None,
    limit_per_source: int = 25,
    owner_user_id: str = "",
) -> dict[str, Any]:
    text = " ".join(str(query or "").split()).strip()[:2_000]
    if not text:
        raise HTTPException(status_code=400, detail="Search query is required.")
    available = {item["id"]: item for item in catalog(vault_path)}
    selected = list(
        dict.fromkeys(str(item) for item in (source_ids or []) if str(item) in available)
    )
    if not selected:
        selected = [
            item["id"]
            for item in available.values()
            if item.get("enabled") and item.get("automated") and item.get("kind") != "enrichment"
        ]
    if not selected:
        raise HTTPException(
            status_code=400, detail="Select at least one automated academic source."
        )
    translated_queries = {
        source_id: " ".join(str((source_queries or {}).get(source_id) or "").split()).strip()[
            :2_000
        ]
        for source_id in selected
        if str((source_queries or {}).get(source_id) or "").strip()
    }
    search_id = uuid.uuid4().hex
    config = load_config(vault_path)
    snapshot_fields = (
        "id",
        "name",
        "kind",
        "group",
        "base_url",
        "metadata_prefix",
        "set",
        "sync_mode",
        "tombstones",
        "query_parameter",
        "limit_parameter",
        "results_path",
        "pagination",
        "page_parameter",
        "offset_parameter",
        "cursor_parameter",
        "next_cursor_path",
        "static_filters",
        "mapping",
        "docs_url",
        "search_url",
    )
    source_snapshots = [
        {key: deepcopy(item.get(key)) for key in snapshot_fields if item.get(key) not in (None, "")}
        for item in available.values()
        if item["id"] in selected
    ]
    safe_ai_audits = [deepcopy(item) for item in (ai_audits or [])[:50] if isinstance(item, dict)]
    search = {
        "id": search_id,
        "query": text,
        "source_queries": translated_queries,
        "filters": filters if isinstance(filters, dict) else {},
        "source_ids": selected,
        "source_snapshots": source_snapshots,
        "owner_user_id": owner_user_id,
        "state": "queued",
        "cancel_requested": False,
        "source_status": {
            source_id: {"state": "queued", "count": 0, "error": None} for source_id in selected
        },
        "exact_queries": {},
        "ai_audits": safe_ai_audits,
        "counts": {
            "raw_occurrences": 0,
            "unique_works": 0,
            "duplicates_removed": 0,
            "possible_duplicate_pairs": 0,
            "returned_works": 0,
            "truncated_works": 0,
        },
        "results": [],
        "errors": [],
        "events": [],
        "created_at": _now(),
        "updated_at": _now(),
        "completed_at": None,
        "limit_per_source": max(1, min(int(limit_per_source), 100)),
        "contact_email_configured": bool(config.get("contact_email")),
    }
    _event(search, "search.created", source_ids=selected)
    _write_search(vault_path, search)
    task = asyncio.create_task(
        _execute_search(Path(vault_path), search_id), name=f"literature-search-{search_id[:8]}"
    )
    _SEARCH_TASKS[search_id] = task
    task.add_done_callback(lambda _: _SEARCH_TASKS.pop(search_id, None))
    return _public_search(search, include_results=False)


async def _execute_source(
    vault_path: Path,
    search_id: str,
    source_id: str,
    source: dict[str, Any],
    definition: dict[str, Any] | None,
    contact_email: str,
) -> None:
    with _SEARCH_LOCK:
        search = _read_search(vault_path, search_id)
        if search.get("cancel_requested"):
            return
        search["source_status"][source_id] = {
            "state": "running",
            "count": 0,
            "error": None,
            "started_at": _now(),
        }
        _event(search, "source.started", source_id=source_id)
        _write_search(vault_path, search)
    audit_token, request_audit = academic_connectors.begin_request_audit()
    effective_query = str((search.get("source_queries") or {}).get(source_id) or search["query"])
    try:
        try:
            if not source.get("available"):
                raise academic_connectors.ConnectorError(
                    "This academic source is not configured or its connector is unavailable."
                )
            if source.get("kind") == "oai":
                works = await asyncio.to_thread(
                    search_oai_index,
                    vault_path,
                    source_id,
                    effective_query,
                    search["filters"],
                    search["limit_per_source"],
                )
                request_audit.append(
                    {
                        "method": "LOCAL_FTS",
                        "expression": _oai_fts_expression(effective_query),
                        "filters": deepcopy(search["filters"]),
                        "connector_audit_version": 1,
                    }
                )
            elif source.get("kind") == "plugin":
                works = await asyncio.to_thread(
                    _search_plugin_adapter,
                    vault_path,
                    source,
                    effective_query,
                    search["filters"],
                    search["limit_per_source"],
                )
                request_audit.append(
                    {
                        "method": "PLUGIN_SANDBOX",
                        "event": "literature.search",
                        "connector_audit_version": 1,
                    }
                )
            else:
                credential = (
                    contact_email
                    if source.get("requires_contact")
                    else _credential_value(
                        str(
                            source.get("credential_key")
                            or source.get("optional_credential_key")
                            or ""
                        )
                    )
                )
                works = await academic_connectors.search_source(
                    source_id,
                    effective_query,
                    search["filters"],
                    search["limit_per_source"],
                    credential=credential,
                    definition=definition,
                )
        finally:
            academic_connectors.end_request_audit(audit_token)
        with _SEARCH_LOCK:
            search = _read_search(vault_path, search_id)
            if search.get("cancel_requested"):
                return
            counts = search.setdefault("counts", {})
            raw_occurrences = int(counts.get("raw_occurrences") or 0) + len(works)
            deduplicated = deduplicate_works((search.get("results") or []) + works)
            returned = deduplicated[:MAX_SEARCH_RESULTS]
            possible_pairs = (
                sum(len(work.get("possible_duplicates") or []) for work in deduplicated) // 2
            )
            search["results"] = returned
            search.setdefault("exact_queries", {})[source_id] = _source_query_audit(
                source, search, request_audit, effective_query
            )
            search["counts"] = {
                "raw_occurrences": raw_occurrences,
                "unique_works": len(deduplicated),
                "duplicates_removed": max(0, raw_occurrences - len(deduplicated)),
                "possible_duplicate_pairs": possible_pairs,
                "returned_works": len(returned),
                "truncated_works": max(0, len(deduplicated) - len(returned)),
            }
            search["source_status"][source_id] = {
                "state": "completed",
                "count": len(works),
                "error": None,
                "completed_at": _now(),
            }
            _event(
                search,
                "source.completed",
                source_id=source_id,
                count=len(works),
                total_results=len(search["results"]),
                duplicates_removed=search["counts"]["duplicates_removed"],
            )
            search["updated_at"] = _now()
            _write_search(vault_path, search)
        return
    except academic_connectors.ConnectorError as exc:
        with _SEARCH_LOCK:
            search = _read_search(vault_path, search_id)
            search.setdefault("exact_queries", {})[source_id] = _source_query_audit(
                source, search, request_audit, effective_query
            )
            error = {"source_id": source_id, "message": str(exc), "retry_after": exc.retry_after}
            search["errors"].append(error)
            search["source_status"][source_id] = {
                "state": "failed",
                "count": 0,
                "error": str(exc),
                "retry_after": exc.retry_after,
                "completed_at": _now(),
            }
            _event(search, "source.failed", **error)
            search["updated_at"] = _now()
            _write_search(vault_path, search)
        return
    except Exception:  # noqa: BLE001
        log.exception("Academic source %s failed", source_id)
        with _SEARCH_LOCK:
            search = _read_search(vault_path, search_id)
            search.setdefault("exact_queries", {})[source_id] = _source_query_audit(
                source, search, request_audit, effective_query
            )
            message = "The academic source returned an unexpected response."
            search["errors"].append({"source_id": source_id, "message": message})
            search["source_status"][source_id] = {
                "state": "failed",
                "count": 0,
                "error": message,
                "completed_at": _now(),
            }
            _event(search, "source.failed", source_id=source_id, message=message)
            search["updated_at"] = _now()
            _write_search(vault_path, search)


async def _execute_search(vault_path: Path, search_id: str) -> None:
    search = _read_search(vault_path, search_id)
    search["state"] = "running"
    search["updated_at"] = _now()
    _event(search, "search.started")
    _write_search(vault_path, search)
    config = load_config(vault_path)
    definitions = {item["id"]: item for item in catalog(vault_path)}
    custom = {item["id"]: item for item in config.get("custom_repositories") or []}
    tasks = [
        asyncio.create_task(
            _execute_source(
                vault_path,
                search_id,
                source_id,
                definitions[source_id],
                custom.get(source_id),
                str(config.get("contact_email") or ""),
            )
        )
        for source_id in search["source_ids"]
        if source_id != "unpaywall"
    ]
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    search = _read_search(vault_path, search_id)
    if search.get("cancel_requested"):
        search["state"] = "cancelled"
        _event(search, "search.cancelled")
    else:
        if "unpaywall" in search["source_ids"] and config.get("contact_email"):
            source = definitions["unpaywall"]
            audit_token, request_audit = academic_connectors.begin_request_audit()
            enriched = []
            enriched_count = 0
            try:
                for work in search.get("results") or []:
                    try:
                        updated = await academic_connectors.enrich_unpaywall(
                            work, str(config["contact_email"])
                        )
                        enriched.append(updated)
                        if updated != work:
                            enriched_count += 1
                    except academic_connectors.ConnectorError as exc:
                        enriched.append(work)
                        search["errors"].append({"source_id": "unpaywall", "message": str(exc)})
            finally:
                academic_connectors.end_request_audit(audit_token)
            search["results"] = enriched
            search.setdefault("exact_queries", {})["unpaywall"] = _source_query_audit(
                source, search, request_audit
            )
            search["source_status"]["unpaywall"] = {
                "state": "completed",
                "count": enriched_count,
                "error": None,
                "completed_at": _now(),
            }
            _event(
                search,
                "source.completed",
                source_id="unpaywall",
                count=enriched_count,
                total_results=len(enriched),
            )
        elif "unpaywall" in search["source_ids"]:
            search["source_status"]["unpaywall"] = {
                "state": "failed",
                "count": 0,
                "error": "A contact email is required.",
                "completed_at": _now(),
            }
        search["state"] = "completed"
        _event(
            search,
            "search.completed",
            total_results=len(search.get("results") or []),
            failed_sources=len(search.get("errors") or []),
        )
    search["updated_at"] = _now()
    search["completed_at"] = _now()
    _write_search(vault_path, search)


def _public_search(
    search: dict[str, Any], *, include_results: bool = True, offset: int = 0, limit: int = 50
) -> dict[str, Any]:
    payload = {
        key: deepcopy(value) for key, value in search.items() if key not in {"events", "results"}
    }
    results = search.get("results") or []
    payload["result_count"] = len(results)
    if include_results:
        payload["results"] = results[max(0, offset) : max(0, offset) + max(1, min(limit, 200))]
        payload["offset"] = max(0, offset)
        payload["limit"] = max(1, min(limit, 200))
    return payload


def get_search(
    vault_path: Path | str, search_id: str, *, offset: int = 0, limit: int = 50
) -> dict[str, Any]:
    return _public_search(_read_search(vault_path, search_id), offset=offset, limit=limit)


def get_search_result(vault_path: Path | str, search_id: str, result_id: str) -> dict[str, Any]:
    result = next(
        (
            item
            for item in _read_search(vault_path, search_id).get("results") or []
            if str(item.get("id")) == result_id
        ),
        None,
    )
    if result is None:
        raise HTTPException(status_code=404, detail="Academic search result not found.")
    return deepcopy(result)


def search_events(vault_path: Path | str, search_id: str, after: int = 0) -> dict[str, Any]:
    search = _read_search(vault_path, search_id)
    return {
        "events": [
            item for item in search.get("events") or [] if int(item.get("seq") or 0) > max(0, after)
        ],
        "state": search.get("state"),
        "last_seq": int((search.get("events") or [{}])[-1].get("seq") or 0),
    }


def cancel_search(vault_path: Path | str, search_id: str) -> dict[str, Any]:
    search = _read_search(vault_path, search_id)
    if search.get("state") in {"completed", "cancelled", "failed"}:
        return _public_search(search, include_results=False)
    search["cancel_requested"] = True
    search["updated_at"] = _now()
    _event(search, "search.cancel.requested")
    _write_search(vault_path, search)
    return _public_search(search, include_results=False)


def append_search_ai_audit(
    vault_path: Path | str, search_id: str, operation: str, audit: dict[str, Any]
) -> dict[str, Any]:
    """Append one server-produced AI audit to a persisted search history item."""
    with _SEARCH_LOCK:
        search = _read_search(vault_path, search_id)
        entry = {
            "operation": str(operation)[:100],
            **deepcopy(audit if isinstance(audit, dict) else {}),
        }
        search.setdefault("ai_audits", []).append(entry)
        search["ai_audits"] = search["ai_audits"][-50:]
        search["updated_at"] = _now()
        _write_search(vault_path, search)
    return entry


def list_searches(vault_path: Path | str, limit: int = 50) -> list[dict[str, Any]]:
    directory = literature_dir(vault_path) / "searches"
    rows: list[dict[str, Any]] = []
    for path in (
        sorted(directory.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)[
            : max(1, min(limit, 200))
        ]
        if directory.exists()
        else []
    ):
        try:
            rows.append(
                _public_search(json.loads(path.read_text(encoding="utf-8")), include_results=False)
            )
        except (OSError, json.JSONDecodeError):
            continue
    return rows


async def discover_citation_neighbors(
    vault_path: Path | str,
    seeds: list[dict[str, Any]],
    *,
    direction: str = "both",
    limit_per_seed: int = 25,
) -> dict[str, Any]:
    """Retrieve deterministic backward or forward citation links from an authorized API."""
    selected = [seed for seed in seeds if isinstance(seed, dict)][:20]
    if not selected:
        raise HTTPException(status_code=400, detail="Select at least one seed work.")
    if direction not in {"backward", "forward", "both"}:
        raise HTTPException(
            status_code=400, detail="Citation direction must be backward, forward, or both."
        )
    semantic_key = _credential_value("semantic_scholar_api_key")
    openalex_key = _credential_value("openalex_api_key")
    if not semantic_key and not openalex_key:
        raise HTTPException(
            status_code=409,
            detail="Configure a Semantic Scholar or OpenAlex API key for citation expansion.",
        )
    provider = "semantic-scholar" if semantic_key else "openalex"
    key = semantic_key or openalex_key
    directions = [direction] if direction != "both" else ["backward", "forward"]
    raw: list[dict[str, Any]] = []
    audit_token, requests = academic_connectors.begin_request_audit()
    try:
        for selected_direction in directions:
            if provider == "semantic-scholar":
                raw.extend(
                    await academic_connectors.semantic_scholar_neighbors(
                        selected, selected_direction, limit_per_seed, key
                    )
                )
            else:
                raw.extend(
                    await academic_connectors.openalex_neighbors(
                        selected, selected_direction, limit_per_seed, key
                    )
                )
    except academic_connectors.ConnectorError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    finally:
        academic_connectors.end_request_audit(audit_token)
    seed_keys = {deterministic_key(seed) for seed in selected if deterministic_key(seed)}
    deduplicated = [
        work for work in deduplicate_works(raw) if deterministic_key(work) not in seed_keys
    ]
    possible_pairs = sum(len(work.get("possible_duplicates") or []) for work in deduplicated) // 2
    return {
        "provider": provider,
        "direction": direction,
        "works": deduplicated,
        "counts": {
            "raw_occurrences": len(raw),
            "unique_works": len(deduplicated),
            "duplicates_removed": max(0, len(raw) - len(deduplicated)),
            "possible_duplicate_pairs": possible_pairs,
        },
        "exact_queries": {
            provider: {
                "source_id": provider,
                "original_query": "citation graph expansion",
                "filters": {
                    "direction": direction,
                    "limit_per_seed": max(1, min(int(limit_per_seed), 100)),
                },
                "connector_version": 1,
                "provider_syntax": directions,
                "requests": requests,
            },
        },
    }
