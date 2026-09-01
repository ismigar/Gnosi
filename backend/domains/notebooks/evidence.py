"""Search and citation retrieval over pinned notebook evidence."""

from __future__ import annotations

import json
import re
import sqlite3
from typing import Any, Iterable, Optional
from urllib.parse import parse_qsl, urlencode, urlparse

from backend.domains.notebooks.chat import _authorized_source_ids
from backend.domains.notebooks.repository import (
    _bounded_text,
    _connect,
    _notebook_row,
)
from backend.domains.notebooks.state import MAX_SEARCH_RESULTS
from backend.services.llm_wiki_indices import search_vector, vector_similarity


def _fts_query(value: str) -> str:
    tokens = re.findall(r"[\wÀ-ÿ]{2,}", str(value or ""))[:32]
    return " OR ".join(f'"{token.replace(chr(34), "")}"' for token in tokens)


def _source_filter(source_ids: list[str] | None) -> tuple[str, tuple[str, ...]]:
    if source_ids is None:
        return "", ()
    clause = " AND c.source_id IN (" + ",".join("?" for _item in source_ids) + ")"
    return clause, tuple(source_ids)


def _search_candidates(
    notebook_id: str,
    revision: int,
    query: str,
    source_clause: str,
    source_params: tuple[str, ...],
    limit: int,
) -> list[sqlite3.Row]:
    match = _fts_query(query)
    with _connect() as connection:
        candidates: list[sqlite3.Row] = []
        if match:
            try:
                candidates = connection.execute(
                    f"""SELECT c.*,s.label,s.kind,s.source_url,s.status,
                    bm25(notebook_chunks_fts) AS lexical_rank
                    FROM notebook_chunks_fts
                    JOIN notebook_chunks c
                      ON c.notebook_id=notebook_chunks_fts.notebook_id
                     AND c.revision=notebook_chunks_fts.revision
                     AND c.chunk_id=notebook_chunks_fts.chunk_id
                    JOIN notebook_sources s
                      ON s.notebook_id=c.notebook_id AND s.revision=c.revision
                     AND s.source_id=c.source_id
                    JOIN notebook_resources r
                      ON r.notebook_id=c.notebook_id AND r.resource_id=c.resource_id
                    WHERE notebook_chunks_fts MATCH ?
                      AND c.notebook_id=? AND c.revision=?
                      AND s.status IN ('available','stale')
                      {source_clause}
                    ORDER BY lexical_rank LIMIT 200""",
                    (match, notebook_id, revision, *source_params),
                ).fetchall()
            except sqlite3.DatabaseError:
                candidates = []
        if len(candidates) >= limit:
            return candidates
        known = {str(row["chunk_id"]) for row in candidates}
        fallback = connection.execute(
            f"""SELECT c.*,s.label,s.kind,s.source_url,s.status,
            1000.0 AS lexical_rank
            FROM notebook_chunks c
            JOIN notebook_sources s
              ON s.notebook_id=c.notebook_id AND s.revision=c.revision
             AND s.source_id=c.source_id
            JOIN notebook_resources r
              ON r.notebook_id=c.notebook_id AND r.resource_id=c.resource_id
            WHERE c.notebook_id=? AND c.revision=?
              AND s.status IN ('available','stale')
              {source_clause}
            ORDER BY c.resource_id,c.source_id,c.ordinal LIMIT 500""",
            (notebook_id, revision, *source_params),
        ).fetchall()
        candidates.extend(row for row in fallback if str(row["chunk_id"]) not in known)
        return candidates


def _score_candidates(candidates: list[sqlite3.Row], query: str) -> list[tuple[float, sqlite3.Row]]:
    query_vector = search_vector(query)
    scored: list[tuple[float, sqlite3.Row]] = []
    for row in candidates:
        try:
            vector = json.loads(row["vector_json"])
        except (TypeError, ValueError):
            vector = []
        lexical_rank = float(row["lexical_rank"] or 0.0)
        lexical_score = 0.0 if lexical_rank >= 999 else 1.0 / (1.0 + abs(lexical_rank))
        score = (0.55 * lexical_score) + (0.45 * vector_similarity(query_vector, vector))
        scored.append((score, row))
    scored.sort(key=lambda item: (-item[0], str(item[1]["chunk_id"])))
    return scored


def _search_result(
    score: float, row: sqlite3.Row, notebook_id: str, revision: int
) -> dict[str, Any]:
    try:
        locator = json.loads(row["locator_json"])
    except (TypeError, ValueError):
        locator = {}
    return {
        "chunk_id": row["chunk_id"],
        "source_id": row["source_id"],
        "resource_id": row["resource_id"],
        "source_label": row["label"],
        "source_kind": row["kind"],
        "source_status": row["status"],
        "text": row["text"],
        "locator": locator,
        "citation": {
            "href": _notebook_citation_href(
                row["citation_href"],
                notebook_id=notebook_id,
                revision=revision,
                chunk_id=str(row["chunk_id"]),
                resource_id=str(row["resource_id"]),
                locator=locator,
            ),
            "label": _locator_label(locator, str(row["label"])),
            "resource_id": row["resource_id"],
            "revision": revision,
            "source_id": row["source_id"],
            "chunk_id": row["chunk_id"],
        },
        "score": round(score, 6),
    }


def search_notebook(
    notebook_id: str,
    query: str,
    *,
    revision: Optional[int] = None,
    source_ids: Optional[Iterable[str]] = None,
    limit: int = 12,
) -> dict[str, Any]:
    """Run hybrid local retrieval within one immutable notebook revision."""
    notebook = _notebook_row(notebook_id)
    resolved_revision = int(
        revision if revision is not None else notebook.get("active_revision") or 0
    )
    if resolved_revision <= 0:
        return {"notebook_id": notebook_id, "revision": None, "results": []}
    limit = max(1, min(int(limit), MAX_SEARCH_RESULTS))
    selected_source_ids = _authorized_source_ids(notebook_id, resolved_revision, source_ids)
    if selected_source_ids == []:
        return {
            "notebook_id": notebook_id,
            "revision": resolved_revision,
            "query": _bounded_text(query, 2_000),
            "results": [],
        }
    source_clause, source_params = _source_filter(selected_source_ids)
    candidates = _search_candidates(
        notebook_id,
        resolved_revision,
        query,
        source_clause,
        source_params,
        limit,
    )
    scored = _score_candidates(candidates, query)
    results = [
        _search_result(score, row, notebook_id, resolved_revision) for score, row in scored[:limit]
    ]
    return {
        "notebook_id": notebook_id,
        "revision": resolved_revision,
        "query": _bounded_text(query, 2_000),
        "results": results,
    }


def _locator_label(locator: dict[str, Any], fallback: str) -> str:
    if locator.get("page") not in (None, ""):
        return f"p. {locator['page']}"
    if locator.get("chapter") not in (None, ""):
        return f"Chapter {locator['chapter']}"
    if locator.get("line_start") not in (None, ""):
        end = locator.get("line_end")
        return f"lines {locator['line_start']}-{end}" if end else f"line {locator['line_start']}"
    return _bounded_text(fallback, 120, "Source")


def _notebook_citation_href(
    href: Any,
    *,
    notebook_id: str,
    revision: int,
    chunk_id: str,
    resource_id: str,
    locator: dict[str, Any],
) -> str:
    """Upgrade attachment citations from older revisions without reindexing."""
    candidate = str(href or "").strip()
    if candidate.lower().startswith(("http://", "https://")):
        return candidate
    parsed = urlparse(candidate)
    params = dict(parse_qsl(parsed.query, keep_blank_values=False))
    params.update(
        {
            "res": str(resource_id),
            "notebook": str(notebook_id),
            "revision": str(int(revision)),
            "chunk": str(chunk_id),
        }
    )
    for key in (
        "page",
        "chapter",
        "paragraph",
        "line_start",
        "line_end",
        "start",
        "end",
        "part",
    ):
        if key not in params and locator.get(key) not in (None, ""):
            params[key] = locator[key]
    return f"gnosi-cite:?{urlencode(params)}"


def read_notebook_evidence(
    notebook_id: str,
    chunk_id: str,
    *,
    revision: Optional[int] = None,
    source_ids: Optional[Iterable[str]] = None,
) -> dict[str, Any]:
    notebook = _notebook_row(notebook_id)
    resolved_revision = int(
        revision if revision is not None else notebook.get("active_revision") or 0
    )
    selected_source_ids = _authorized_source_ids(notebook_id, resolved_revision, source_ids)
    source_clause = ""
    source_params: tuple[str, ...] = ()
    if selected_source_ids is not None:
        if not selected_source_ids:
            raise KeyError("Notebook evidence is outside the selected sources.")
        source_clause = (
            " AND c.source_id IN (" + ",".join("?" for _item in selected_source_ids) + ")"
        )
        source_params = tuple(selected_source_ids)
    with _connect() as connection:
        row = connection.execute(
            f"""SELECT c.*,s.label,s.kind,s.source_url,s.status
            FROM notebook_chunks c
            JOIN notebook_sources s ON s.notebook_id=c.notebook_id
              AND s.revision=c.revision AND s.source_id=c.source_id
            JOIN notebook_resources r ON r.notebook_id=c.notebook_id
              AND r.resource_id=c.resource_id
            WHERE c.notebook_id=? AND c.revision=? AND c.chunk_id=?
              AND s.status IN ('available','stale')
              {source_clause}""",
            (notebook_id, resolved_revision, str(chunk_id), *source_params),
        ).fetchone()
    if row is None:
        raise KeyError("Notebook evidence was not found in the pinned revision.")
    try:
        locator = json.loads(row["locator_json"])
    except (TypeError, ValueError):
        locator = {}
    return {
        "notebook_id": notebook_id,
        "revision": resolved_revision,
        "chunk_id": row["chunk_id"],
        "source_id": row["source_id"],
        "resource_id": row["resource_id"],
        "source_label": row["label"],
        "source_kind": row["kind"],
        "source_status": row["status"],
        "text": row["text"],
        "locator": locator,
        "citation": {
            "href": _notebook_citation_href(
                row["citation_href"],
                notebook_id=notebook_id,
                revision=resolved_revision,
                chunk_id=str(row["chunk_id"]),
                resource_id=str(row["resource_id"]),
                locator=locator,
            ),
            "label": _locator_label(locator, str(row["label"])),
            "resource_id": row["resource_id"],
            "revision": resolved_revision,
            "source_id": row["source_id"],
            "chunk_id": row["chunk_id"],
        },
    }
