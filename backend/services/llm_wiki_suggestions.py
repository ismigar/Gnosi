"""Read-only connection proposals for the Brain.

The AI detects connections, support, contradictions, and gaps between reading
notes and existing manual permanent notes. A proposal can be opened or
dismissed; this service never creates or edits a permanent note.

Storage: `<vault>/.gnosi/llm_wiki_suggestions.json` (per-vault, travels with
the vault). Pending suggestions are also mirrored into the graph's
`<vault>/suggestions.json` as `kind=suggestion` edges between member notes
(entries tagged `llm_wiki: <id>` so only ours are added/removed).
"""
from __future__ import annotations

import json
import threading
import uuid
from typing import Any, Dict, List, Optional

from backend.config.logger_config import get_logger

logger = get_logger(__name__)

_lock = threading.Lock()

QUEUE_FILENAME = "llm_wiki_suggestions.json"

# Cap on suggestions generated per pass — review must stay reviewable.
MAX_SUGGESTIONS_PER_PASS = 8


# ---------------------------------------------------------------------------
# Queue persistence
# ---------------------------------------------------------------------------

def _queue_path():
    from backend.api.vault_routes import get_p

    return get_p("GNOSI_CONFIG") / QUEUE_FILENAME


def load_queue() -> List[Dict[str, Any]]:
    """Pending suggestions (newest last). Malformed/missing → empty."""
    try:
        data = json.loads(_queue_path().read_text(encoding="utf-8"))
        items = data.get("suggestions") if isinstance(data, dict) else None
        return [s for s in items if isinstance(s, dict) and s.get("id")] if isinstance(items, list) else []
    except Exception:  # noqa: BLE001
        return []


def _save_queue(items: List[Dict[str, Any]]) -> None:
    from backend.utils.safe_io import safe_write_json

    path = _queue_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    safe_write_json(path, {"suggestions": items}, indent=2, ensure_ascii=False)


def add_suggestions(new_items: List[Dict[str, Any]]) -> int:
    """Appends suggestions to the queue, skipping near-duplicates (same member
    set already pending). Returns how many were added."""
    added = 0
    with _lock:
        items = load_queue()
        pending_keys = {frozenset(s.get("member_ids") or []) for s in items}
        for s in new_items:
            members = frozenset(s.get("member_ids") or [])
            if not members or members in pending_keys:
                continue
            s.setdefault("id", str(uuid.uuid4()))
            items.append(s)
            pending_keys.add(members)
            added += 1
        if added:
            _save_queue(items)
    if added:
        _mirror_to_graph()
    return added


def get_suggestion(suggestion_id: str) -> Optional[Dict[str, Any]]:
    """A pending suggestion by id, without removing it (assist endpoints)."""
    return next((s for s in load_queue() if s.get("id") == suggestion_id), None)


def pop_suggestion(suggestion_id: str) -> Optional[Dict[str, Any]]:
    """Removes and returns a suggestion by id (accept and reject both end here)."""
    with _lock:
        items = load_queue()
        kept, found = [], None
        for s in items:
            if s.get("id") == suggestion_id and found is None:
                found = s
            else:
                kept.append(s)
        if found is not None:
            _save_queue(kept)
    if found is not None:
        _mirror_to_graph()
    return found


# ---------------------------------------------------------------------------
# Graph mirror — pending suggestions as dashed edges among member notes
# ---------------------------------------------------------------------------

def _graph_suggestions_path():
    from backend.api.vault_routes import get_p

    return get_p("VAULT") / "suggestions.json"


def _mirror_to_graph() -> None:
    """Rewrites OUR entries in the graph's suggestions.json (tagged `llm_wiki`)
    to match the current queue. Entries from external writers are preserved
    untouched for backwards-compatible vault portability."""
    try:
        from backend.utils.safe_io import safe_write_json

        path = _graph_suggestions_path()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
        except Exception:  # noqa: BLE001
            data = {}

        # Drop all previous llm_wiki-tagged entries.
        for src in list(data.keys()):
            entries = [e for e in (data.get(src) or []) if not (isinstance(e, dict) and e.get("llm_wiki"))]
            if entries:
                data[src] = entries
            else:
                data.pop(src, None)

        # Re-add one edge chain per pending suggestion (first member → rest).
        for s in load_queue():
            members = [m for m in (s.get("member_ids") or []) if m]
            if len(members) < 2:
                continue
            head = members[0]
            data.setdefault(head, [])
            for other in members[1:]:
                data[head].append({
                    "target_id": other,
                    "reason": str(s.get("question") or s.get("title") or ""),
                    "score": 0.9,
                    "llm_wiki": s["id"],
                })
        safe_write_json(path, data, indent=2, ensure_ascii=False)
        from backend.services.graph_service import GraphService

        GraphService.invalidate_response_cache()
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki: graph mirror failed: %s", exc)


def sync_graph_mirror() -> int:
    """Synchronize the portable graph overlay and return the pending count."""

    _mirror_to_graph()
    return len(load_queue())


def list_graph_edges() -> List[Dict[str, Any]]:
    """Return canonical pending proposals as graph-compatible edge objects."""

    edges: List[Dict[str, Any]] = []
    for suggestion in load_queue():
        members = [str(member) for member in suggestion.get("member_ids") or [] if member]
        if len(members) < 2:
            continue
        source = members[0]
        for target in members[1:]:
            edges.append({
                "source": source,
                "target": target,
                "kind": "suggestion",
                "similarity": 90,
                "reason": str(suggestion.get("question") or suggestion.get("title") or ""),
                "suggestion_id": str(suggestion.get("id") or ""),
            })
    return edges


# ---------------------------------------------------------------------------
# LLM pass — propose permanent notes from cross-source reading notes
# ---------------------------------------------------------------------------

def _suggest_prompt(reading_notes: List[Dict[str, str]], language: str) -> str:
    listing = "\n".join(
        f"- [{n['id']}] «{n['title']}» (source: {n['source']}) — {n['excerpt']}"
        for n in reading_notes
    )
    return f"""You audit a personal Zettelkasten. Detect meaningful relationships among
the following reading notes and existing MANUAL permanent notes. You only
propose; you never draft or create a permanent note.

For each proposal return:
- "kind": connection|support|contradiction|gap.
- "title": a short description in {language}.
- "why": a precise explanation in {language}.
- "member_ids": exact ids from the list.
- "evidence": 1-3 short evidence excerpts already present in the notes.

Only propose groups with a real relationship, normally spanning different
resources. Return an empty list when none qualify. Maximum
{MAX_SUGGESTIONS_PER_PASS} proposals.

READING NOTES:
{listing}

Return only JSON: {{"suggestions": [{{"kind": "connection", "title": "…",
"member_ids": ["…"], "why": "…", "evidence": ["…"]}}]}}"""


def generate_suggestions(brain_table_id: str, language: str = "English",
                         focus_ids: Optional[List[str]] = None) -> int:
    """Run the LLM pass over the Brain's reading notes and queue proposals.

    ``focus_ids`` (post-ingest mode) limits proposals to groups touching at
    least one of the given notes; None (lint mode) scans everything. Degrades
    gracefully: no provider / no parseable plan → 0 added, never raises to the
    caller's flow.
    """
    try:
        notes = _reading_notes_digest(brain_table_id)
        if len(notes) < 2:
            return 0
        from backend.agent.factory import generate_text

        raw, _model = generate_text(_suggest_prompt(notes, language), timeout=120)
        parsed = _parse_suggestions(raw, {n["id"] for n in notes}, {n["id"]: n for n in notes})
        if focus_ids:
            focus = set(focus_ids)
            parsed = [s for s in parsed if focus & set(s["member_ids"])]
        return add_suggestions(parsed)
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki: suggestion pass skipped: %s", exc)
        return 0


def _reading_notes_digest(brain_table_id: str) -> List[Dict[str, str]]:
    """Compact digest of readings and existing manual permanent notes."""
    from pathlib import Path

    from backend.api.vault_routes import _get_pages_for_table
    from backend.services import llm_wiki_config, llm_wiki_storage
    from backend.services.llm_wiki import _fonts_ids

    out: List[Dict[str, str]] = []
    for p in _get_pages_for_table(brain_table_id) or []:
        meta = llm_wiki_storage.page_metadata(p)
        if meta.get("is_template"):
            continue
        note_type = llm_wiki_config.metadata_note_type(meta)
        if note_type not in {"lectura", "permanent"}:
            continue
        if meta.get("llm_wiki_stale"):
            continue
        body = ""
        path = getattr(p, "path", None)
        if path:
            try:
                raw = Path(path).read_text(encoding="utf-8")
                body = raw.split("---", 2)[2] if raw.startswith("---") else raw
            except Exception:  # noqa: BLE001
                body = ""
        fonts = _fonts_ids(meta)
        out.append({
            "id": str(getattr(p, "id", "") or meta.get("id") or ""),
            "title": str(getattr(p, "title", "") or ""),
            "source": fonts[0] if fonts else "?",
            "excerpt": " ".join(body.split())[:280],
            "note_type": note_type,
        })
    return out[:150]


def _parse_suggestions(raw: str, valid_ids: set, notes_by_id: Dict[str, Dict[str, str]]) -> List[Dict[str, Any]]:
    """Tolerant parse + validation: members must exist, be ≥2, and span ≥2
    DIFFERENT sources (the whole point of a permanent note)."""
    import re

    cleaned = re.sub(r"^```(?:json)?|```$", "", (raw or "").strip(), flags=re.MULTILINE).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    try:
        data = json.loads(cleaned[start:end + 1] if (start != -1 and end > start) else cleaned)
    except Exception:  # noqa: BLE001
        logger.warning("llm_wiki: could not parse suggestions JSON")
        return []
    items = data.get("suggestions") if isinstance(data, dict) else None
    out: List[Dict[str, Any]] = []
    for s in items if isinstance(items, list) else []:
        if not isinstance(s, dict):
            continue
        members = [str(m).strip() for m in (s.get("member_ids") or []) if str(m).strip() in valid_ids]
        members = list(dict.fromkeys(members))
        sources = {notes_by_id[m]["source"] for m in members if notes_by_id[m]["source"] != "?"}
        has_manual_permanent = any(notes_by_id[m].get("note_type") == "permanent" for m in members)
        if len(members) < 2 or (len(sources) < 2 and not has_manual_permanent):
            continue
        title = str(s.get("title") or "").strip()
        if not title:
            continue
        out.append({
            "id": str(uuid.uuid4()),
            "title": title,
            "kind": str(s.get("kind") or "connection").strip().lower(),
            "why": str(s.get("why") or "").strip(),
            "evidence": [
                str(item).strip()
                for item in (s.get("evidence") or [])
                if str(item).strip()
            ][:3],
            "member_ids": members,
            "member_titles": [notes_by_id[m]["title"] for m in members],
        })
        if len(out) >= MAX_SUGGESTIONS_PER_PASS:
            break
    return out


# ---------------------------------------------------------------------------
# Compatibility guard — permanent-note writes are forbidden
# ---------------------------------------------------------------------------

def accept_suggestion(
    suggestion_id: str,
    brain_table_id: str,
    edited_title: Optional[str] = None,
    edited_draft: Optional[str] = None,
) -> Dict[str, Any]:
    """Compatibility guard: permanent-note creation is intentionally disabled."""
    raise RuntimeError(
        "LLM Wiki connection proposals are read-only and cannot create permanent notes"
    )
