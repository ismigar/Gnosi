"""Stable origin identity, deduplication, and LLM chunking."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable



Origin = dict[str, object]
Segment = dict[str, object]


def chunk_origins(
    origins: list[Origin],
    *,
    max_chars: int = 12_000,
) -> list[Origin]:
    """Create complete ordered LLM chunks without dropping any segment."""
    chunks: list[Origin] = []
    for origin in origins:
        current: list[Segment] = []
        current_chars = 0
        raw_segments = origin.get("segments") or []
        if not isinstance(raw_segments, list):
            continue
        for raw_segment in raw_segments:
            if not isinstance(raw_segment, dict):
                continue
            segment = dict(raw_segment)
            text = str(segment.get("text") or "")
            if current and current_chars + len(text) > max_chars:
                chunks.append(_chunk(origin, current, len(chunks)))
                current = []
                current_chars = 0
            if len(text) > max_chars:
                if current:
                    chunks.append(_chunk(origin, current, len(chunks)))
                    current = []
                    current_chars = 0
                for part_index, start in enumerate(range(0, len(text), max_chars)):
                    part = dict(segment)
                    part["id"] = segment["id"]
                    part["text"] = text[start : start + max_chars]
                    raw_locator = segment.get("locator") or {}
                    locator = dict(raw_locator) if isinstance(raw_locator, dict) else {}
                    part["locator"] = {**locator, "part": part_index + 1}
                    chunks.append(_chunk(origin, [part], len(chunks)))
                continue
            current.append(segment)
            current_chars += len(text)
        if current:
            chunks.append(_chunk(origin, current, len(chunks)))
    return chunks


def _chunk(origin: Origin, segments: list[Segment], index: int) -> Origin:
    return {
        "id": f"chunk-{index + 1}",
        "origin_id": origin["origin_id"],
        "origin_order": origin.get("input_order", 0),
        "origin_label": origin.get("label") or origin.get("kind"),
        "kind": origin.get("kind"),
        "snapshot_id": origin.get("snapshot_id"),
        "segments": segments,
    }


def finalize_origin(origin: Origin) -> Origin:
    """Normalize segments and assign deterministic origin and segment IDs."""
    segments: list[Segment] = []
    raw_segments = origin.get("segments") or []
    if not isinstance(raw_segments, list):
        raw_segments = []
    for order, raw_segment in enumerate(raw_segments, start=1):
        if not isinstance(raw_segment, dict):
            continue
        text = " ".join(str(raw_segment.get("text") or "").split()).strip()
        if not text:
            continue
        raw_locator = raw_segment.get("locator") or {}
        locator = dict(raw_locator) if isinstance(raw_locator, dict) else {}
        segments.append({"id": "", "order": order, "text": text, "locator": locator})
    content_hash = hashlib.sha256(
        "\n".join(str(segment["text"]) for segment in segments).encode("utf-8")
    ).hexdigest()
    finalized: Origin = {
        **origin,
        "content_hash": content_hash,
        "segments": segments,
        "aliases": origin.get("aliases") or [],
    }
    finalized["origin_id"] = origin_id(finalized)
    for segment in segments:
        text = str(segment["text"])
        short = hashlib.sha256(text.encode("utf-8")).hexdigest()[:8]
        segment["id"] = f"{finalized['origin_id']}-s{segment['order']}-{short}"
    return finalized


def origin_id(origin: Origin) -> str:
    """Return the stable identity derived from kind, source, and content."""
    value = json.dumps(
        {
            "kind": origin.get("kind"),
            "label": origin.get("label"),
            "url": origin.get("source_url"),
            "hash": origin.get("content_hash"),
        },
        sort_keys=True,
        ensure_ascii=False,
    )
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:16]


def deduplicate_origins(origins: Iterable[Origin]) -> list[Origin]:
    """Keep the first content origin while preserving later source aliases."""
    unique: list[Origin] = []
    by_hash: dict[str, Origin] = {}
    for origin in origins:
        content_hash = str(origin.get("content_hash") or "")
        existing = by_hash.get(content_hash)
        if existing is not None:
            aliases = existing.setdefault("aliases", [])
            if isinstance(aliases, list):
                aliases.append(
                    {
                        "kind": origin.get("kind"),
                        "label": origin.get("label"),
                        "source_url": origin.get("source_url"),
                        "input_order": origin.get("input_order"),
                    }
                )
            if origin.get("requested_url"):
                sources = existing.setdefault("http_sources", [])
                if isinstance(sources, list):
                    sources.append(
                        {
                            "requested_url": origin.get("requested_url"),
                            "final_url": origin.get("http_final_url"),
                            "etag": origin.get("http_etag"),
                            "last_modified": origin.get("http_last_modified"),
                            "content_hash": origin.get("http_content_hash"),
                            "checked_at": origin.get("http_checked_at"),
                        }
                    )
            continue
        by_hash[content_hash] = origin
        unique.append(origin)
    return unique


__all__ = [
    "Origin",
    "Segment",
    "chunk_origins",
    "deduplicate_origins",
    "finalize_origin",
    "origin_id",
]
