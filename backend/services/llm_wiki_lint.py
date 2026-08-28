"""LLM Wiki (Brain) lint — the "Lint" operation of Karpathy's pattern.

Periodic health check of the Brain: it surfaces the bookkeeping drift a wiki
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
    from backend.services import llm_wiki_config, llm_wiki_storage

    notes: List[Dict[str, Any]] = []
    for p in _get_pages_for_table(brain_table_id) or []:
        meta = llm_wiki_storage.page_metadata(p)
        if meta.get("is_template"):
            continue
        pid = str(getattr(p, "id", "") or meta.get("id") or "")
        title = str(getattr(p, "title", "") or meta.get("title") or "")
        if not pid or not title:
            continue
        body = _read_body(getattr(p, "path", None))
        ids, titles = _outbound_targets(body)
        notes.append(
            {
                "id": pid,
                "title": title,
                "body": body,
                "out_ids": ids,
                "out_titles": titles,
                "review": str(
                    meta.get("Última revisió") or meta.get("última revisió") or ""
                ).strip(),
                "note_type": llm_wiki_config.metadata_note_type(meta),
                "managed_key": str(meta.get("llm_wiki_key") or ""),
                "managed_role": str(meta.get("llm_wiki_role") or ""),
                "managed_stale": bool(meta.get("llm_wiki_stale")),
                "source_table_id": str(meta.get("llm_wiki_source_table_id") or ""),
                "resource_id": str(meta.get("llm_wiki_resource_id") or ""),
            }
        )
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


def _inbound_note_ids(notes: List[Dict[str, Any]]) -> set[str]:
    """Collect note ids referenced by another note's id or title."""
    canon_to_id = {_canonical_id(note["id"]): note["id"] for note in notes}
    title_to_id = {note["title"].strip().lower(): note["id"] for note in notes}
    inbound: set[str] = set()
    for note in notes:
        for candidate in note["out_ids"]:
            target = canon_to_id.get(candidate)
            if target and target != note["id"]:
                inbound.add(target)
        for title in note["out_titles"]:
            target = title_to_id.get(title)
            if target and target != note["id"]:
                inbound.add(target)
    return inbound


def _orphan_findings(notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return managed knowledge notes with no inbound link."""
    inbound = _inbound_note_ids(notes)
    return [
        {"id": note["id"], "title": note["title"]}
        for note in notes
        if note["id"] not in inbound and note["note_type"] in {"lectura", "permanent"}
    ]


def _stale_findings(notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return knowledge notes whose review date is missing or old."""
    stale: List[Dict[str, Any]] = []
    for note in notes:
        days = _days_since(note["review"])
        if note["note_type"] not in {"lectura", "permanent"}:
            continue
        if note["review"] == "" or days is None or days > STALE_DAYS:
            stale.append(
                {
                    "id": note["id"],
                    "title": note["title"],
                    "review": note["review"] or None,
                    "days": days,
                }
            )
    return stale


def _missing_cross_references(notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Find prose title mentions that are not explicit wiki links."""
    findings: List[Dict[str, Any]] = []
    for note in notes:
        body = note["body"].lower()
        for other in notes:
            title = other["title"].strip()
            already_linked = (
                _canonical_id(other["id"]) in note["out_ids"] or title.lower() in note["out_titles"]
            )
            if other["id"] == note["id"] or len(title) < 4 or already_linked:
                continue
            if re.search(r"\b" + re.escape(title.lower()) + r"\b", body):
                findings.append(
                    {
                        "id": note["id"],
                        "title": note["title"],
                        "should_link": other["title"],
                        "target_id": other["id"],
                    }
                )
                if len(findings) >= _MAX_MENTION_FINDINGS:
                    return findings
    return findings


def _duplicate_managed_keys(notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Group managed notes that share one provenance key."""
    grouped_by_key: Dict[str, List[Dict[str, Any]]] = {}
    for note in notes:
        if note["managed_key"]:
            grouped_by_key.setdefault(note["managed_key"], []).append(note)
    return [
        {
            "key": key,
            "notes": [{"id": note["id"], "title": note["title"]} for note in grouped],
        }
        for key, grouped in grouped_by_key.items()
        if len(grouped) > 1
    ]


def _resource_index_drift(notes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Return active reading resources that lack a managed index note."""
    indexed = {
        (note["source_table_id"], note["resource_id"])
        for note in notes
        if note["managed_role"] == "resource-index"
    }
    reading = {
        (note["source_table_id"], note["resource_id"])
        for note in notes
        if note["note_type"] == "lectura"
        and not note["managed_stale"]
        and note["source_table_id"]
        and note["resource_id"]
    }
    return [
        {"source_table_id": source_id, "resource_id": resource_id}
        for source_id, resource_id in sorted(reading - indexed)
    ]


def run_lint(
    brain_table_id: str,
    reference_table_id: Optional[str | List[str]] = None,
) -> Dict[str, Any]:
    """Run the deterministic Brain health checks and return a report."""
    notes = _load_notes(brain_table_id)
    orphans = _orphan_findings(notes)
    stale = _stale_findings(notes)
    missing_xref = _missing_cross_references(notes)

    source_ids = (
        [reference_table_id]
        if isinstance(reference_table_id, str)
        else list(reference_table_id or [])
    )
    reprocess = [item for source_id in source_ids for item in _reprocess_candidates(source_id)]

    duplicate_keys = _duplicate_managed_keys(notes)
    stale_managed = [
        {"id": note["id"], "title": note["title"]} for note in notes if note["managed_stale"]
    ]
    broken_cites = _broken_citations(notes)
    index_drift = _resource_index_drift(notes)

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
            "orphans": len(orphans),
            "stale": len(stale),
            "missing_xref": len(missing_xref),
            "reprocess": len(reprocess),
            "duplicate_keys": len(duplicate_keys),
            "stale_managed": len(stale_managed),
            "broken_cites": len(broken_cites),
            "index_drift": len(index_drift),
        },
        "truncated_missing_xref": len(missing_xref) >= _MAX_MENTION_FINDINGS,
    }


def _reprocess_candidates(reference_table_id: str) -> List[Dict[str, Any]]:
    """Resources whose file was modified after they were processed into the
    Brain (the `Processat pel Cervell` date is older than the file mtime)."""
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
            out.append(
                {
                    "id": str(getattr(p, "id", "") or meta.get("id") or ""),
                    "title": str(getattr(p, "title", "") or ""),
                    "processed": processed,
                    "modified": mtime.isoformat(),
                }
            )
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
                out.append(
                    {
                        "id": note["id"],
                        "title": note["title"],
                        "resource_id": resource_id,
                        "snapshot_id": snapshot_id,
                        "segment_id": segment_id,
                    }
                )
    return out[:100]
