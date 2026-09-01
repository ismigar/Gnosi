"""Resource fingerprinting, refresh detection and revision retention."""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.domains.notebooks.catalog import _selectable_reference_pages
from backend.domains.notebooks.repository import _bounded_text, _connect, _now
from backend.domains.notebooks.state import _WRITE_LOCK
from backend.services import llm_wiki_config, llm_wiki_extractors


def _property_values(
    metadata: dict[str, Any], table: dict[str, Any], source_config: dict[str, Any]
) -> list[tuple[str, str]]:
    props_by_id = {
        str(prop.get("id") or ""): prop
        for prop in table.get("properties") or []
        if isinstance(prop, dict)
    }
    values: list[tuple[str, str]] = []
    for prop_id in source_config.get("attachment_property_ids") or []:
        for value in llm_wiki_extractors._values_for_property(
            metadata, props_by_id.get(str(prop_id))
        ):  # noqa: SLF001
            values.append(("attachment", value))
    for prop_id in source_config.get("url_property_ids") or []:
        for value in llm_wiki_extractors._values_for_property(
            metadata, props_by_id.get(str(prop_id))
        ):  # noqa: SLF001
            if value.lower().startswith(("http://", "https://")):
                values.append(("url", value))
    return values


def resource_fingerprint(
    metadata: dict[str, Any],
    table: dict[str, Any],
    source_config: dict[str, Any],
    vault_root: Path,
) -> tuple[str, bool]:
    """Fingerprint current source cells and trusted attachment file state."""
    inputs = _property_values(metadata, table, source_config)
    payload: list[dict[str, Any]] = []
    has_url = False
    for kind, value in inputs:
        item: dict[str, Any] = {"kind": kind, "value": value}
        if kind == "url":
            has_url = True
        else:
            path = llm_wiki_extractors._resolve_attachment_path(value, Path(vault_root))  # noqa: SLF001
            if path:
                try:
                    stat = path.stat()
                    item.update({"size": stat.st_size, "mtime_ns": stat.st_mtime_ns})
                except OSError:
                    item["missing"] = True
            else:
                item["outside_or_missing"] = True
        payload.append(item)
    encoded = json.dumps(payload, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest(), has_url


def _url_refresh_ttl() -> timedelta:
    raw = str(os.environ.get("GNOSI_NOTEBOOK_URL_REFRESH_TTL_SECONDS", "21600"))
    try:
        seconds = int(raw)
    except ValueError:
        seconds = 21_600
    return timedelta(seconds=max(60, min(seconds, 604_800)))


def _url_refresh_due(resource: sqlite3.Row | dict[str, Any], has_url: bool) -> bool:
    if not has_url:
        return False
    try:
        checked_at = str(resource["url_checked_at"] or "")
    except (KeyError, IndexError):
        checked_at = ""
    if not checked_at:
        return True
    try:
        checked = datetime.fromisoformat(checked_at.replace("Z", "+00:00"))
        if checked.tzinfo is None:
            checked = checked.replace(tzinfo=timezone.utc)
    except ValueError:
        return True
    return datetime.now(timezone.utc) - checked.astimezone(timezone.utc) >= _url_refresh_ttl()


def _url_values(
    metadata: dict[str, Any],
    table: dict[str, Any],
    source_config: dict[str, Any],
) -> list[str]:
    return [
        value for kind, value in _property_values(metadata, table, source_config) if kind == "url"
    ]


def _load_url_validators(resource: sqlite3.Row | dict[str, Any]) -> dict[str, dict[str, str]]:
    try:
        raw = resource["url_validators_json"]
    except (KeyError, IndexError):
        raw = "{}"
    try:
        parsed = json.loads(str(raw or "{}"))
    except json.JSONDecodeError:
        return {}
    if not isinstance(parsed, dict):
        return {}
    return {
        str(url): {
            str(key): str(value or "")[:1_000]
            for key, value in metadata.items()
            if key
            in {
                "final_url",
                "etag",
                "last_modified",
                "content_hash",
                "stream_fingerprint",
                "checked_at",
            }
        }
        for url, metadata in parsed.items()
        if isinstance(metadata, dict)
    }


def _probe_resource_urls(
    urls: list[str],
    previous: dict[str, dict[str, str]],
) -> tuple[bool, dict[str, dict[str, str]]]:
    changed = False
    current: dict[str, dict[str, str]] = {}
    for url in urls:
        cached = previous.get(url, {})
        if llm_wiki_extractors.is_streaming_url(url):
            result = llm_wiki_extractors.probe_streaming_url(
                url,
                fingerprint=cached.get("stream_fingerprint", ""),
            )
            changed = changed or bool(result.get("changed"))
            current[url] = {
                "final_url": str(result.get("final_url") or url)[:4_000],
                "etag": "",
                "last_modified": "",
                "content_hash": str(cached.get("content_hash") or "")[:128],
                "stream_fingerprint": str(result.get("stream_fingerprint") or "")[:128],
                "checked_at": str(result.get("checked_at") or _now()),
            }
            continue
        result = llm_wiki_extractors.probe_public_url(
            url,
            etag=cached.get("etag", ""),
            last_modified=cached.get("last_modified", ""),
            content_hash=cached.get("content_hash", ""),
        )
        changed = changed or bool(result.get("changed"))
        current[url] = {
            "final_url": str(result.get("final_url") or url)[:4_000],
            "etag": str(result.get("etag") or "")[:1_000],
            "last_modified": str(result.get("last_modified") or "")[:1_000],
            "content_hash": str(result.get("content_hash") or "")[:128],
            "stream_fingerprint": "",
            "checked_at": str(result.get("checked_at") or _now()),
        }
    return changed, current


def _url_validators_from_origins(
    urls: list[str],
    origins: list[dict[str, Any]],
    previous: dict[str, dict[str, str]],
) -> dict[str, dict[str, str]]:
    discovered: dict[str, dict[str, str]] = {}
    for origin in origins:
        candidates = [
            {
                "requested_url": origin.get("requested_url"),
                "final_url": origin.get("http_final_url"),
                "etag": origin.get("http_etag"),
                "last_modified": origin.get("http_last_modified"),
                "content_hash": origin.get("http_content_hash"),
                "stream_fingerprint": origin.get("http_stream_fingerprint"),
                "checked_at": origin.get("http_checked_at"),
            },
            *(origin.get("http_sources") or []),
        ]
        for item in candidates:
            requested_url = str(item.get("requested_url") or "")
            if not requested_url:
                continue
            discovered[requested_url] = {
                "final_url": str(item.get("final_url") or requested_url)[:4_000],
                "etag": str(item.get("etag") or "")[:1_000],
                "last_modified": str(item.get("last_modified") or "")[:1_000],
                "content_hash": str(item.get("content_hash") or "")[:128],
                "stream_fingerprint": str(item.get("stream_fingerprint") or "")[:128],
                "checked_at": str(item.get("checked_at") or _now()),
            }
    return {url: discovered.get(url, previous.get(url, {})) for url in urls}


def _current_resource_snapshot(
    notebook: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any], list[Any]]:
    from backend.domains.vault.pages.foundation import _get_pages_for_table
    from backend.domains.vault.tables.legacy_composition import _table_by_id

    table_id = str(notebook["source_table_id"])
    table = _table_by_id(table_id)
    if not table:
        raise RuntimeError("The notebook source table is unavailable.")
    source_config = llm_wiki_config.auto_detect_source(table)
    source_config["include_body"] = False
    return table, source_config, _selectable_reference_pages(_get_pages_for_table(table_id))


def _needs_refresh(notebook: dict[str, Any]) -> bool:
    table, source_config, pages = _current_resource_snapshot(notebook)
    pages_by_id = {str(page.id): page for page in pages}
    with _connect() as connection:
        resources = connection.execute(
            """SELECT resource_id,fingerprint,url_checked_at
            FROM notebook_resources WHERE notebook_id=?""",
            (notebook["id"],),
        ).fetchall()
    if notebook.get("active_revision") is None:
        return True
    for resource in resources:
        page = pages_by_id.get(str(resource["resource_id"]))
        if page is None:
            return True
        fingerprint, has_url = resource_fingerprint(
            page.metadata or {},
            table,
            source_config,
            Path(notebook["vault_path"]) if notebook.get("vault_path") else Path("."),
        )
        if fingerprint != str(resource["fingerprint"] or ""):
            return True
        if _url_refresh_due(resource, has_url):
            return True
    return False


def _retention_limit(name: str, default: int, maximum: int) -> int:
    try:
        value = int(str(os.environ.get(name, default)))
    except ValueError:
        value = default
    return max(1, min(value, maximum))


def _pin_active_notebook_revision(
    notebook_id: str,
    *,
    pin_type: str,
    pin_id: str,
) -> int:
    """Atomically pin and return the currently active evidence revision."""
    with _WRITE_LOCK, _connect() as connection:
        row = connection.execute(
            "SELECT active_revision FROM notebooks WHERE id=?",
            (str(notebook_id),),
        ).fetchone()
        revision = int(row["active_revision"] or 0) if row else 0
        if revision <= 0:
            raise HTTPException(
                status_code=409,
                detail="The notebook has no active evidence revision.",
            )
        connection.execute(
            """INSERT OR IGNORE INTO notebook_revision_pins
            (notebook_id,revision,pin_type,pin_id,created_at) VALUES(?,?,?,?,?)""",
            (
                str(notebook_id),
                int(revision),
                _bounded_text(pin_type, 40, "reference"),
                _bounded_text(pin_id, 300, "reference"),
                _now(),
            ),
        )
        connection.commit()
    return revision


def _prune_notebook_revisions(
    connection: sqlite3.Connection,
    notebook_id: str,
) -> list[int]:
    """Delete eligible obsolete revisions while preserving stable references."""
    notebook = connection.execute(
        "SELECT active_revision FROM notebooks WHERE id=?", (str(notebook_id),)
    ).fetchone()
    protected: set[int] = set()
    if notebook and notebook["active_revision"] is not None:
        protected.add(int(notebook["active_revision"]))
    protected.update(
        int(row[0])
        for row in connection.execute(
            "SELECT DISTINCT revision FROM notebook_revision_pins WHERE notebook_id=?",
            (str(notebook_id),),
        ).fetchall()
    )
    protected.update(
        int(row[0])
        for row in connection.execute(
            "SELECT DISTINCT revision FROM notebook_analyses WHERE notebook_id=?",
            (str(notebook_id),),
        ).fetchall()
    )
    completed_limit = _retention_limit("GNOSI_NOTEBOOK_COMPLETED_REVISION_RETENTION", 3, 50)
    audit_limit = _retention_limit("GNOSI_NOTEBOOK_AUDIT_REVISION_RETENTION", 20, 200)
    protected.update(
        int(row[0])
        for row in connection.execute(
            """SELECT revision FROM notebook_revisions WHERE notebook_id=?
            AND state='completed' ORDER BY revision DESC LIMIT ?""",
            (str(notebook_id), completed_limit),
        ).fetchall()
    )
    protected.update(
        int(row[0])
        for row in connection.execute(
            """SELECT revision FROM notebook_revisions WHERE notebook_id=?
            AND state IN ('unchanged','failed','cancelled')
            ORDER BY revision DESC LIMIT ?""",
            (str(notebook_id), audit_limit),
        ).fetchall()
    )
    candidates = [
        int(row[0])
        for row in connection.execute(
            """SELECT revision FROM notebook_revisions WHERE notebook_id=?
            AND retention_eligible=1
            AND state IN ('completed','unchanged','failed','cancelled')""",
            (str(notebook_id),),
        ).fetchall()
        if int(row[0]) not in protected
    ]
    for revision in candidates:
        connection.execute(
            "DELETE FROM notebook_chunks_fts WHERE notebook_id=? AND revision=?",
            (str(notebook_id), revision),
        )
        connection.execute(
            "DELETE FROM notebook_revisions WHERE notebook_id=? AND revision=?",
            (str(notebook_id), revision),
        )
    return candidates
