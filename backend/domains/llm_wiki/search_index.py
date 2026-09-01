"""Typed rebuildable lexical and vector indexes for LLM Wiki."""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import logging
import math
import re
import sqlite3
import unicodedata
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol


class JsonWriter(Protocol):
    def __call__(
        self,
        path: Path,
        payload: object,
        *,
        indent: int,
        ensure_ascii: bool,
    ) -> object: ...


class UpsertRecords(Protocol):
    def __call__(
        self,
        brain_table_id: str,
        records: Iterable[dict[str, Any]],
        *,
        replace_snapshot: bool = False,
    ) -> int: ...


@dataclass(frozen=True)
class SearchDependencies:
    """Late-bound storage and facade collaborators for cache rebuilding."""

    brain_pages: Callable[[str], list[Any]]
    metadata: Callable[[Any], dict[str, Any]]
    note_kind: Callable[[Any], str]
    page_id: Callable[[Any], str]
    page_path: Callable[[Any], Path | None]
    read_page: Callable[[Path | None], tuple[dict[str, Any], str]]
    safe_token: Callable[[Any], str]
    title: Callable[[Any], str]
    vector: Callable[[str], list[float]]
    local_data: Callable[[], Path]
    json_writer: JsonWriter
    upsert_records: UpsertRecords
    clear_search_cache: Callable[[str], None]


def rebuild_search_cache(
    brain_table_id: str,
    *,
    dependencies: SearchDependencies,
) -> int:
    """Write a rebuildable Brain-only lexical cache outside the synced vault."""
    records: list[dict[str, Any]] = []
    for page in dependencies.brain_pages(brain_table_id):
        metadata = dependencies.metadata(page)
        if metadata.get("is_template"):
            continue
        path = dependencies.page_path(page)
        _portable_metadata, body = dependencies.read_page(path)
        title = dependencies.title(page)
        records.append(
            {
                "id": dependencies.page_id(page),
                "title": title,
                "note_type": dependencies.note_kind(page),
                "managed_role": str(metadata.get("llm_wiki_role") or ""),
                "excerpt": " ".join(body.split())[:1200],
                "vector": dependencies.vector(f"{title}\n{body}"),
                "source_table_id": str(metadata.get("llm_wiki_source_table_id") or ""),
                "resource_id": str(metadata.get("llm_wiki_resource_id") or ""),
            }
        )
    root = dependencies.local_data() / "llm_wiki"
    root.mkdir(parents=True, exist_ok=True)
    dependencies.json_writer(
        root / f"search-{dependencies.safe_token(brain_table_id)}.json",
        {
            "brain_table_id": brain_table_id,
            "updated_at": dt.datetime.now().isoformat(),
            "notes": records,
        },
        indent=2,
        ensure_ascii=False,
    )
    dependencies.upsert_records(
        brain_table_id,
        records,
        replace_snapshot=True,
    )
    try:
        dependencies.clear_search_cache(brain_table_id)
    except Exception:
        pass
    return len(records)


def fts_path(
    brain_table_id: str,
    *,
    local_data: Callable[[], Path],
    safe_token: Callable[[Any], str],
) -> Path:
    """Resolve and create the private FTS5 sidecar directory."""
    root = local_data() / "llm_wiki"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"search-{safe_token(brain_table_id)}.sqlite3"


def upsert_search_records(
    brain_table_id: str,
    records: Iterable[dict[str, Any]],
    *,
    replace_snapshot: bool = False,
    path_for_index: Callable[[str], Path],
    logger: logging.Logger,
) -> int:
    """Apply only changed records to the FTS5 sidecar."""
    prepared = [dict(item) for item in records if isinstance(item, dict) and item.get("id")]
    try:
        with sqlite3.connect(path_for_index(brain_table_id), timeout=30) as connection:
            _prepare_database(connection)
            existing = {
                str(identifier): str(raw)
                for identifier, raw in connection.execute(
                    "SELECT id, record_json FROM notes_fts"
                ).fetchall()
            }
            incoming_ids = {str(item.get("id")) for item in prepared}
            if replace_snapshot:
                _delete_stale_records(connection, existing, incoming_ids)
            changed = _write_changed_records(connection, prepared, existing)
            _write_index_metadata(connection)
            return changed
    except sqlite3.DatabaseError:
        logger.exception("Unable to refresh the Brain FTS5 sidecar")
    return 0


def rebuild_fts_index(
    brain_table_id: str,
    records: list[dict[str, Any]],
    *,
    upsert_records: UpsertRecords,
) -> None:
    """Compatibility implementation for full FTS rebuild callers."""
    upsert_records(brain_table_id, records, replace_snapshot=True)


def mark_search_index_stale(
    brain_table_id: str,
    stale: bool = True,
    *,
    path_for_index: Callable[[str], Path],
    logger: logging.Logger,
) -> None:
    """Mark an index stale when a vault change arrives before reindexing."""
    try:
        with sqlite3.connect(path_for_index(brain_table_id), timeout=5) as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            connection.execute(
                "INSERT OR REPLACE INTO index_meta(key,value) VALUES('stale',?)",
                ("1" if stale else "0",),
            )
    except sqlite3.DatabaseError:
        logger.exception("Unable to update Brain FTS5 freshness metadata")


def search_index_candidates(
    brain_table_id: str,
    query: str,
    limit: int = 128,
    *,
    path_for_index: Callable[[str], Path],
    load_cache: Callable[[str], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Return lexical candidates from FTS5, falling back to the JSON cache."""
    bounded_limit = max(1, min(int(limit), 256))
    tokens = [word for word in re.findall(r"[\wÀ-ÿ]{2,}", str(query or ""))[:32] if word]
    if not tokens:
        return load_cache(brain_table_id)[:bounded_limit]
    match = " OR ".join('"' + token.replace('"', "") + '"' for token in tokens)
    try:
        with sqlite3.connect(path_for_index(brain_table_id), timeout=5) as connection:
            rows = connection.execute(
                "SELECT record_json FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT ?",
                (match, bounded_limit),
            ).fetchall()
        values: list[dict[str, Any]] = []
        for row in rows:
            raw = row[0]
            try:
                item: object = json.loads(raw)
            except (TypeError, ValueError):
                continue
            if isinstance(item, dict):
                values.append(dict(item))
        return values
    except sqlite3.DatabaseError:
        return load_cache(brain_table_id)[:bounded_limit]


def search_index_status(
    brain_table_id: str,
    *,
    path_for_index: Callable[[str], Path],
) -> dict[str, Any]:
    """Expose bounded freshness metadata for diagnostics and UX progress."""
    try:
        with sqlite3.connect(path_for_index(brain_table_id), timeout=5) as connection:
            rows = {
                str(key): str(value)
                for key, value in connection.execute("SELECT key,value FROM index_meta").fetchall()
            }
        return {
            "available": True,
            "updated_at": rows.get("updated_at"),
            "record_count": int(rows.get("record_count", 0)),
            "stale": rows.get("stale", "0") == "1",
        }
    except (sqlite3.DatabaseError, OSError, ValueError):
        return {
            "available": False,
            "updated_at": None,
            "record_count": 0,
            "stale": True,
        }


def load_search_cache(
    brain_table_id: str,
    *,
    local_data: Callable[[], Path],
    safe_token: Callable[[Any], str],
) -> list[dict[str, Any]]:
    """Load the rebuildable JSON fallback for one Brain table."""
    path = local_data() / "llm_wiki" / f"search-{safe_token(brain_table_id)}.json"
    try:
        payload: object = json.loads(path.read_text(encoding="utf-8"))
        notes = payload.get("notes") if isinstance(payload, dict) else []
        return (
            [dict(item) for item in notes if isinstance(item, dict)]
            if isinstance(notes, list)
            else []
        )
    except Exception:
        return []


def search_vector(text: str, dimensions: int = 192) -> list[float]:
    """Build a deterministic local hashed vector for hybrid cache search."""
    normalized = unicodedata.normalize("NFKD", str(text or "").casefold())
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    words = re.findall(r"[a-z0-9]{2,}", normalized)
    features = list(words)
    features.extend(
        word[index : index + 3] for word in words for index in range(max(0, len(word) - 2))
    )
    vector = [0.0] * dimensions
    for feature in features:
        digest = hashlib.sha256(feature.encode("utf-8")).digest()
        slot = int.from_bytes(digest[:4], "big") % dimensions
        vector[slot] += 1.0
    norm = math.sqrt(sum(value * value for value in vector))
    return [round(value / norm, 7) for value in vector] if norm else vector


def vector_similarity(left: list[Any], right: list[Any]) -> float:
    """Return cosine similarity for normalized cache vectors."""
    if not left or not right or len(left) != len(right):
        return 0.0
    try:
        return float(sum(float(a) * float(b) for a, b in zip(left, right)))
    except (TypeError, ValueError):
        return 0.0


def _prepare_database(connection: sqlite3.Connection) -> None:
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute(
        "CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING "
        "fts5(id UNINDEXED, title, excerpt, note_type, managed_role, "
        "record_json UNINDEXED)"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    )


def _delete_stale_records(
    connection: sqlite3.Connection,
    existing: dict[str, str],
    incoming_ids: set[str],
) -> None:
    for stale_id in set(existing).difference(incoming_ids):
        connection.execute("DELETE FROM notes_fts WHERE id=?", (stale_id,))


def _write_changed_records(
    connection: sqlite3.Connection,
    records: list[dict[str, Any]],
    existing: dict[str, str],
) -> int:
    changed = 0
    for item in records:
        identifier = str(item.get("id") or "")
        encoded = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if existing.get(identifier) == encoded:
            continue
        connection.execute("DELETE FROM notes_fts WHERE id=?", (identifier,))
        connection.execute(
            "INSERT INTO notes_fts"
            "(id,title,excerpt,note_type,managed_role,record_json) "
            "VALUES (?,?,?,?,?,?)",
            (
                identifier,
                str(item.get("title") or ""),
                str(item.get("excerpt") or ""),
                str(item.get("note_type") or ""),
                str(item.get("managed_role") or ""),
                encoded,
            ),
        )
        changed += 1
    return changed


def _write_index_metadata(connection: sqlite3.Connection) -> None:
    connection.execute(
        "INSERT OR REPLACE INTO index_meta(key,value) VALUES('updated_at',?)",
        (dt.datetime.now(dt.timezone.utc).isoformat(),),
    )
    row = connection.execute("SELECT COUNT(*) FROM notes_fts").fetchone()
    count = int(row[0]) if row is not None else 0
    connection.execute(
        "INSERT OR REPLACE INTO index_meta(key,value) VALUES('record_count',?)",
        (str(count),),
    )
    connection.execute(
        "INSERT OR REPLACE INTO index_meta(key,value) VALUES('stale',?)",
        ("0",),
    )


__all__ = [
    "SearchDependencies",
    "fts_path",
    "load_search_cache",
    "mark_search_index_stale",
    "rebuild_fts_index",
    "rebuild_search_cache",
    "search_index_candidates",
    "search_index_status",
    "search_vector",
    "upsert_search_records",
    "vector_similarity",
]
