"""LLM Wiki (Cervell) lint — the "Lint" operation of Karpathy's pattern.

Periodic health-check of the Cervell: it surfaces the bookkeeping drift a wiki
accumulates so the user (or a later LLM pass) can fix it. All checks here are
DETERMINISTIC (no LLM, no API key needed) so the lint always runs:

  * orphans        — notes no other note links to (isolated knowledge).
  * missing_xref   — a note mentions another note's title in prose but doesn't
                     `[[link]]` it (a cross-reference that drifted).
  * stale          — notes whose «Última revisió» is old or missing.
  * reprocess      — resources modified after their last successful ingest.
  * duplicate_keys — managed reading notes sharing a provenance key.
  * stale_managed  — superseded managed notes deliberately retained.
  * broken_cites   — evidence links whose immutable snapshot is unavailable.
  * index_drift    — resources with reading notes but no managed resource index.

LLM-based checks (contradictions, data gaps) are a future layer that degrades
away when no provider is configured; this module is the always-available core.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

# A note is "stale" if it hasn't been reviewed in this many days (or ever).
STALE_DAYS = 120

# Cap the mention scan so a huge wiki doesn't produce an unusable wall of noise.
_MAX_MENTION_FINDINGS = 100

_WIKILINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")


def _canonical_id(v: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(v or "").lower())


def _outbound_targets(body: str) -> tuple[set[str], set[str]]:
    """Returns (linked_ids, linked_titles) referenced by `[[...|id]]` in a body."""
    ids: set[str] = set()
    titles: set[str] = set()
    for m in _WIKILINK_RE.finditer(body or ""):
        title = (m.group(1) or "").strip()
        ident = (m.group(2) or "").strip()
        if ident:
            ids.add(_canonical_id(ident))
        if title:
            titles.add(title.strip().lower())
    return ids, titles


def _read_body(path: Optional[str]) -> str:
    if not path:
        return ""
    try:
        from pathlib import Path

        raw = Path(path).read_text(encoding="utf-8")
    except Exception:  # noqa: BLE001
        return ""
    # Drop the frontmatter block so mentions/links are scanned in the body only.
    if raw.startswith("---"):
        parts = raw.split("---", 2)
        if len(parts) >= 3:
            return parts[2]
    return raw


def _load_notes(brain_table_id: str) -> List[Dict[str, Any]]:
    from backend.api.vault_routes import _get_pages_for_table

    notes: List[Dict[str, Any]] = []
    for p in _get_pages_for_table(brain_table_id) or []:
        meta = getattr(p, "metadata", None) or {}
        if meta.get("is_template"):
            continue
        pid = str(getattr(p, "id", "") or meta.get("id") or "")
        title = str(getattr(p, "title", "") or meta.get("title") or "")
        if not pid or not title:
            continue
        body = _read_body(getattr(p, "path", None))
        ids, titles = _outbound_targets(body)
        notes.append({
            "id": pid, "title": title, "body": body,
            "out_ids": ids, "out_titles": titles,
            "review": str(meta.get("Última revisió") or meta.get("última revisió") or "").strip(),
            "note_type": str(meta.get("note_type") or "").strip().casefold(),
            "managed_key": str(meta.get("llm_wiki_key") or ""),
            "managed_role": str(meta.get("llm_wiki_role") or ""),
            "managed_stale": bool(meta.get("llm_wiki_stale")),
            "source_table_id": str(meta.get("llm_wiki_source_table_id") or ""),
            "resource_id": str(meta.get("llm_wiki_resource_id") or ""),
        })
    return notes


def _days_since(iso_date: str) -> Optional[int]:
    if not iso_date:
        return None
    import datetime

    try:
        d = datetime.date.fromisoformat(iso_date[:10])
    except ValueError:
        return None
    return (datetime.date.today() - d).days


def run_lint(
    brain_table_id: str,
    reference_table_id: Optional[str | List[str]] = None,
) -> Dict[str, Any]:
    """Runs the deterministic Cervell health checks and returns a report."""
    notes = _load_notes(brain_table_id)
    by_id = {n["id"]: n for n in notes}
    canon_to_id = {_canonical_id(n["id"]): n["id"] for n in notes}
    title_to_id = {n["title"].strip().lower(): n["id"] for n in notes}

    # Inbound link set: a note is referenced if any OTHER note links it by id/title.
    inbound: set[str] = set()
    for n in notes:
        for cid in n["out_ids"]:
            tgt = canon_to_id.get(cid)
            if tgt and tgt != n["id"]:
                inbound.add(tgt)
        for tt in n["out_titles"]:
            tgt = title_to_id.get(tt)
            if tgt and tgt != n["id"]:
                inbound.add(tgt)

    orphans = [
        {"id": n["id"], "title": n["title"]}
        for n in notes
        if n["id"] not in inbound and n["note_type"] in {"lectura", "permanent"}
    ]

    stale: List[Dict[str, Any]] = []
    for n in notes:
        days = _days_since(n["review"])
        if n["note_type"] not in {"lectura", "permanent"}:
            continue
        if n["review"] == "" or days is None or days > STALE_DAYS:
            stale.append({"id": n["id"], "title": n["title"],
                          "review": n["review"] or None, "days": days})

    # Missing cross-references: note body mentions another note's title as prose
    # but doesn't link it. Word-boundary, case-insensitive; skip very short titles.
    missing_xref: List[Dict[str, Any]] = []
    for n in notes:
        low_body = n["body"].lower()
        for other in notes:
            if other["id"] == n["id"]:
                continue
            ot = other["title"].strip()
            if len(ot) < 4:
                continue
            if _canonical_id(other["id"]) in n["out_ids"] or ot.lower() in n["out_titles"]:
                continue
            if re.search(r"\b" + re.escape(ot.lower()) + r"\b", low_body):
                missing_xref.append({"id": n["id"], "title": n["title"],
                                     "should_link": other["title"], "target_id": other["id"]})
                if len(missing_xref) >= _MAX_MENTION_FINDINGS:
                    break
        if len(missing_xref) >= _MAX_MENTION_FINDINGS:
            break

    source_ids = (
        [reference_table_id]
        if isinstance(reference_table_id, str)
        else list(reference_table_id or [])
    )
    reprocess = [
        item
        for source_id in source_ids
        for item in _reprocess_candidates(source_id)
    ]

    by_managed_key: Dict[str, List[Dict[str, Any]]] = {}
    for note in notes:
        if note["managed_key"]:
            by_managed_key.setdefault(note["managed_key"], []).append(note)
    duplicate_keys = [
        {
            "key": key,
            "notes": [{"id": note["id"], "title": note["title"]} for note in grouped],
        }
        for key, grouped in by_managed_key.items()
        if len(grouped) > 1
    ]
    stale_managed = [
        {"id": note["id"], "title": note["title"]}
        for note in notes
        if note["managed_stale"]
    ]
    broken_cites = _broken_citations(notes)
    indexed_resources = {
        (note["source_table_id"], note["resource_id"])
        for note in notes
        if note["managed_role"] == "resource-index"
    }
    reading_resources = {
        (note["source_table_id"], note["resource_id"])
        for note in notes
        if note["note_type"] == "lectura"
        and not note["managed_stale"]
        and note["source_table_id"]
        and note["resource_id"]
    }
    index_drift = [
        {"source_table_id": source_id, "resource_id": resource_id}
        for source_id, resource_id in sorted(reading_resources - indexed_resources)
    ]

    return {
        "note_count": len(notes),
        "orphans": orphans,
        "stale": stale,
        "missing_xref": missing_xref,
        "reprocess": reprocess,
        "duplicate_keys": duplicate_keys,
        "stale_managed": stale_managed,
        "broken_cites": broken_cites,
        "index_drift": index_drift,
        "counts": {
            "orphans": len(orphans), "stale": len(stale),
            "missing_xref": len(missing_xref), "reprocess": len(reprocess),
            "duplicate_keys": len(duplicate_keys),
            "stale_managed": len(stale_managed),
            "broken_cites": len(broken_cites),
            "index_drift": len(index_drift),
        },
        "truncated_missing_xref": len(missing_xref) >= _MAX_MENTION_FINDINGS,
    }


def _reprocess_candidates(reference_table_id: str) -> List[Dict[str, Any]]:
    """Resources whose file was modified after they were processed into the
    Cervell (the `Processat pel Cervell` date is older than the file mtime)."""
    import datetime
    from pathlib import Path

    from backend.api.vault_routes import _get_pages_for_table, LLM_WIKI_PROCESSED_COL

    out: List[Dict[str, Any]] = []
    for p in _get_pages_for_table(reference_table_id) or []:
        meta = getattr(p, "metadata", None) or {}
        processed = str(meta.get(LLM_WIKI_PROCESSED_COL) or "").strip()
        if not processed:
            continue
        path = getattr(p, "path", None)
        if not path:
            continue
        try:
            mtime = datetime.date.fromtimestamp(Path(path).stat().st_mtime)
            pdate = datetime.date.fromisoformat(processed[:10])
        except (ValueError, OSError):
            continue
        if mtime > pdate:
            out.append({
                "id": str(getattr(p, "id", "") or meta.get("id") or ""),
                "title": str(getattr(p, "title", "") or ""),
                "processed": processed, "modified": mtime.isoformat(),
            })
    return out


_CITE_RE = re.compile(
    r"gnosi-cite:\?[^)\s]*res=([^&)\s]+)[^)\s]*snapshot=([^&)\s]+)[^)\s]*segment=([^&)\s]+)"
)


def _broken_citations(notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    from urllib.parse import unquote

    from backend.services.llm_wiki_storage import load_evidence

    out = []
    for note in notes:
        for match in _CITE_RE.finditer(note["body"]):
            resource_id, snapshot_id, segment_id = (unquote(value) for value in match.groups())
            if not resource_id or not snapshot_id or not segment_id:
                continue
            if load_evidence(resource_id, snapshot_id, segment_id) is None:
                out.append({
                    "id": note["id"],
                    "title": note["title"],
                    "resource_id": resource_id,
                    "snapshot_id": snapshot_id,
                    "segment_id": segment_id,
                })
    return out[:100]
