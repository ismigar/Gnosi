"""SQLite writes and revision copies for notebook ingestion."""

from __future__ import annotations

import hashlib
import json
import sqlite3
import uuid
from typing import Any, Optional
from urllib.parse import urlencode

from backend.domains.notebooks.repository import _bounded_text
from backend.services import llm_wiki_extractors
from backend.services.llm_wiki_indices import search_vector


def _insert_source(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    revision: int,
    resource_id: str,
    origin: dict[str, Any],
    status: str,
    error: Optional[str] = None,
) -> tuple[str, int]:
    origin_id = str(origin.get("origin_id") or uuid.uuid4().hex)
    source_id = hashlib.sha256(f"{resource_id}:{origin_id}".encode("utf-8")).hexdigest()[:24]
    public_origin = {key: value for key, value in origin.items() if not str(key).startswith("_")}
    fingerprint = (
        str(origin.get("content_hash") or "")
        or hashlib.sha256(
            json.dumps(public_origin, sort_keys=True, ensure_ascii=False).encode("utf-8")
        ).hexdigest()
    )
    connection.execute(
        """INSERT OR REPLACE INTO notebook_sources
        (notebook_id,revision,source_id,resource_id,kind,label,source_url,
         fingerprint,snapshot_id,status,error,origin_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            notebook_id,
            revision,
            source_id,
            resource_id,
            str(origin.get("kind") or "unknown"),
            _bounded_text(origin.get("label"), 500, "Source"),
            str(origin.get("source_url") or "")[:4_000] or None,
            fingerprint,
            str(origin.get("snapshot_id") or fingerprint[:24]),
            status,
            _bounded_text(error, 2_000) or None,
            json.dumps(public_origin, ensure_ascii=False, separators=(",", ":")),
        ),
    )
    chunks = llm_wiki_extractors.chunk_origins([origin])
    for ordinal, chunk in enumerate(chunks):
        segments = chunk.get("segments") or []
        text = "\n\n".join(
            str(segment.get("text") or "")
            for segment in segments
            if str(segment.get("text") or "").strip()
        )
        if not text:
            continue
        locator = (segments[0].get("locator") or {}) if segments else {}
        segment_id = str((segments[0] if segments else {}).get("id") or "")
        chunk_id = hashlib.sha256(
            f"{source_id}:{ordinal}:{segment_id}:{hashlib.sha256(text.encode('utf-8')).hexdigest()}".encode(
                "utf-8"
            )
        ).hexdigest()[:28]
        source_url = str(origin.get("source_url") or "")
        if source_url.lower().startswith(("http://", "https://")):
            citation_href = source_url
        else:
            params: dict[str, Any] = {
                "res": resource_id,
                "notebook": notebook_id,
                "revision": revision,
                "chunk": chunk_id,
                "snapshot": str(origin.get("snapshot_id") or fingerprint[:24]),
                "segment": segment_id,
                "origin": origin_id,
            }
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
                if locator.get(key) not in (None, ""):
                    params[key] = locator[key]
            citation_href = f"gnosi-cite:?{urlencode(params)}"
        connection.execute(
            """INSERT OR REPLACE INTO notebook_chunks
            (notebook_id,revision,chunk_id,source_id,resource_id,ordinal,text,
             locator_json,citation_href,vector_json)
            VALUES(?,?,?,?,?,?,?,?,?,?)""",
            (
                notebook_id,
                revision,
                chunk_id,
                source_id,
                resource_id,
                ordinal,
                text,
                json.dumps(locator, ensure_ascii=False, separators=(",", ":")),
                citation_href,
                json.dumps(search_vector(text), separators=(",", ":")),
            ),
        )
        connection.execute(
            "INSERT INTO notebook_chunks_fts(notebook_id,revision,chunk_id,text) VALUES(?,?,?,?)",
            (notebook_id, revision, chunk_id, text),
        )
    return source_id, len(chunks)


def _insert_error_source(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    revision: int,
    resource_id: str,
    message: str,
    ordinal: int,
) -> None:
    normalized = _bounded_text(message, 2_000, "Source extraction failed.")
    source_id = hashlib.sha256(
        f"error:{resource_id}:{ordinal}:{normalized}".encode("utf-8")
    ).hexdigest()[:24]
    connection.execute(
        """INSERT OR REPLACE INTO notebook_sources
        (notebook_id,revision,source_id,resource_id,kind,label,source_url,
         fingerprint,snapshot_id,status,error,origin_json)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            notebook_id,
            revision,
            source_id,
            resource_id,
            "error",
            "Unavailable source",
            None,
            hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
            None,
            "error",
            normalized,
            "{}",
        ),
    )


def _copy_resource_revision(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    from_revision: int,
    to_revision: int,
    resource_id: str,
    status: Optional[str] = None,
) -> int:
    sources = connection.execute(
        """SELECT * FROM notebook_sources WHERE notebook_id=? AND revision=?
        AND resource_id=? AND status IN ('available','stale')""",
        (notebook_id, from_revision, resource_id),
    ).fetchall()
    copied = 0
    for source in sources:
        copied_status = status or source["status"]
        connection.execute(
            """INSERT OR REPLACE INTO notebook_sources
            (notebook_id,revision,source_id,resource_id,kind,label,source_url,
             fingerprint,snapshot_id,status,error,origin_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                notebook_id,
                to_revision,
                source["source_id"],
                resource_id,
                source["kind"],
                source["label"],
                source["source_url"],
                source["fingerprint"],
                source["snapshot_id"],
                copied_status,
                source["error"]
                if copied_status == source["status"]
                else (
                    "The current source could not be refreshed; the last valid version is retained."
                ),
                source["origin_json"],
            ),
        )
        chunks = connection.execute(
            """SELECT * FROM notebook_chunks WHERE notebook_id=? AND revision=?
            AND source_id=? ORDER BY ordinal""",
            (notebook_id, from_revision, source["source_id"]),
        ).fetchall()
        for chunk in chunks:
            connection.execute(
                """INSERT OR REPLACE INTO notebook_chunks
                (notebook_id,revision,chunk_id,source_id,resource_id,ordinal,text,
                 locator_json,citation_href,vector_json)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    notebook_id,
                    to_revision,
                    chunk["chunk_id"],
                    chunk["source_id"],
                    resource_id,
                    chunk["ordinal"],
                    chunk["text"],
                    chunk["locator_json"],
                    chunk["citation_href"],
                    chunk["vector_json"],
                ),
            )
            connection.execute(
                "INSERT INTO notebook_chunks_fts"
                "(notebook_id,revision,chunk_id,text) VALUES(?,?,?,?)",
                (notebook_id, to_revision, chunk["chunk_id"], chunk["text"]),
            )
        copied += 1
    return copied


def _copy_resource_errors(
    connection: sqlite3.Connection,
    *,
    notebook_id: str,
    from_revision: int,
    to_revision: int,
    resource_id: str,
) -> int:
    """Copy excluded error markers when a targeted retry defers a Resource."""
    sources = connection.execute(
        """SELECT * FROM notebook_sources WHERE notebook_id=? AND revision=?
        AND resource_id=? AND status='error'""",
        (notebook_id, from_revision, resource_id),
    ).fetchall()
    for source in sources:
        connection.execute(
            """INSERT OR REPLACE INTO notebook_sources
            (notebook_id,revision,source_id,resource_id,kind,label,source_url,
             fingerprint,snapshot_id,status,error,origin_json)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                notebook_id,
                to_revision,
                source["source_id"],
                resource_id,
                source["kind"],
                source["label"],
                source["source_url"],
                source["fingerprint"],
                source["snapshot_id"],
                "error",
                source["error"],
                source["origin_json"],
            ),
        )
    return len(sources)
