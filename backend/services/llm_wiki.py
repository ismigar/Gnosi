"""Incremental Zettelkasten ingestion for Gnosi's built-in LLM Wiki.

The model reads complete ordered source segments and returns a write plan.
Application code validates citations, owns stable note ids, persists job
checkpoints, and updates deterministic index pages.  The LLM never writes
files directly.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urlencode

from backend.config.logger_config import get_logger
from backend.services import (
    llm_wiki_config,
    llm_wiki_extractors,
    llm_wiki_indices,
    llm_wiki_storage,
)

logger = get_logger(__name__)

PHASE_IDLE = "idle"
PHASE_READING = "reading"
PHASE_PLANNING = "planning"
PHASE_WRITING = "writing"
PHASE_INDEXING = "indexing"
PHASE_DONE = "done"
PHASE_PARTIAL = "partial"
PHASE_ERROR = "error"

NOTE_TYPES = ("entitat", "concepte", "resum", "síntesi")
GENERATED_NOTE_TYPE = "lectura"
PROCESSED_COLUMN = "Processat pel Cervell"
_MANAGED_NOTE_START = "<!-- gnosi:llm-wiki:start note:{key} -->"
_MANAGED_NOTE_END = "<!-- gnosi:llm-wiki:end note:{key} -->"


def get_job_status(identifier: str, source_table_id: str = "") -> Dict[str, Any]:
    return llm_wiki_storage.get_job_status(identifier, source_table_id)


def is_running(page_id: str, source_table_id: str = "") -> bool:
    """Compatibility helper for the former one-argument route guard."""
    if source_table_id:
        return llm_wiki_storage.is_running(source_table_id, page_id)
    return any(
        llm_wiki_storage.is_running(table_id, page_id)
        for table_id in llm_wiki_config.get_source_table_ids()
    )


# ---------------------------------------------------------------------------
# Source compatibility helpers
# ---------------------------------------------------------------------------

def read_source(metadata: dict, body: str, vault_root) -> tuple[str, str]:
    """Compatibility wrapper returning all detected source text, untruncated."""
    properties = []
    for name, value in (metadata or {}).items():
        if name in {"title", "id", "table_id"}:
            continue
        value_text = str(value or "")
        lowered = str(name).casefold()
        if "url" in lowered:
            ptype = "url"
        elif any(token in lowered for token in ("file", "fitxer", "arxiu", "adjunt")):
            ptype = "files"
        else:
            ptype = "text"
        properties.append({"id": name, "name": name, "type": ptype})
    table = {"id": str(metadata.get("table_id") or "legacy"), "properties": properties}
    config = llm_wiki_config.auto_detect_source(table)
    config["include_body"] = True
    origins, _warnings = llm_wiki_extractors.extract_resource_sources(
        metadata,
        body,
        Path(vault_root),
        table,
        config,
    )
    text = "\n\n".join(
        segment["text"]
        for origin in origins
        for segment in origin.get("segments") or []
    )
    kinds = "+".join(dict.fromkeys(str(origin.get("kind") or "") for origin in origins))
    return text, kinds or "empty"


def _first_value(metadata: dict, keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = (metadata or {}).get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _fonts_ids(meta: dict) -> List[str]:
    """Extract linked page ids from any known source relation metadata."""
    values: list[Any] = []
    for key, raw in (meta or {}).items():
        normalized = re.sub(r"[^a-z0-9]+", "", str(key).casefold())
        if normalized in {"fonts", "font", "sources", "source"} or str(key).startswith("Font ·"):
            values.extend(raw if isinstance(raw, list) else ([raw] if raw else []))
    out = []
    for value in values:
        text = str(value or "").strip().strip("[]")
        if "|" in text:
            out.append(text.rsplit("|", 1)[1].strip())
    return list(dict.fromkeys(out))


def _load_brain_index(brain_table_id: str, source_page_id: str = "") -> List[Dict[str, Any]]:
    """Compact, bounded context packet for cross-links and connection proposals."""
    from backend.api.vault_routes import _get_pages_for_table

    out = []
    try:
        for page in _get_pages_for_table(brain_table_id) or []:
            meta = llm_wiki_storage.page_metadata(page)
            if meta.get("is_template"):
                continue
            out.append({
                "id": str(getattr(page, "id", "") or meta.get("id") or ""),
                "title": str(getattr(page, "title", "") or meta.get("title") or ""),
                "type": str(meta.get("Tipus") or meta.get("note_type") or ""),
                "same_source": bool(source_page_id) and (
                    str(meta.get("llm_wiki_resource_id") or "") == source_page_id
                    or source_page_id in _fonts_ids(meta)
                ),
            })
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki could not load the Brain index: %s", exc)
    return out[:300]


# ---------------------------------------------------------------------------
# Planning and grounding
# ---------------------------------------------------------------------------

def _build_chunk_prompt(
    chunk: dict[str, Any],
    source_title: str,
    brain_index: List[Dict[str, Any]],
    language: str,
    ai_dimensions: list[dict[str, Any]],
) -> str:
    index_lines = "\n".join(
        f"- [{item['id']}] {item['title']} ({item['type']})"
        for item in brain_index
        if item.get("title")
    ) or "(empty Brain)"
    segment_lines = "\n\n".join(
        f"[SEGMENT {segment['id']} | {_locator_label(segment.get('locator') or {})}]\n"
        f"{segment['text']}"
        for segment in chunk.get("segments") or []
    )
    dimension_lines = "\n".join(
        f"- field_id={item['field_id']} name={item['name']} "
        f"allowed={json.dumps(item['allowed_labels'], ensure_ascii=False)}"
        for item in ai_dimensions
    ) or "(no AI-classified fields)"
    return f"""You maintain a persistent personal knowledge wiki using atomic Zettelkasten
reading notes. Process this ordered SOURCE CHUNK completely.

Rules:
- Write in {language}.
- Each note contains exactly ONE idea. Split distinct ideas into distinct notes.
- Preserve source order, not importance order.
- Ground every note in at least one exact source segment.
- citation.quote must be a verbatim substring of the cited segment.
- Return source_segment_id for the segment where the idea first appears.
- Never propose or create permanent notes.
- Existing Brain notes are context for wikilinks only; do not ask to overwrite them.
- For dimensions, use only the listed allowed labels. Omit a field when no label fits.

RESOURCE: {source_title}
ORIGIN: {chunk.get('origin_label')} ({chunk.get('kind')})

SOURCE SEGMENTS:
{segment_lines}

OPTIONAL AI DIMENSIONS:
{dimension_lines}

COMPACT BRAIN INDEX:
{index_lines}

Return only valid JSON:
{{
  "summary": "short chunk summary",
  "notes": [
    {{
      "title": "atomic idea title",
      "type": "entitat|concepte|resum|síntesi",
      "body_md": "one-idea markdown body with useful [[wikilinks]]",
      "tags": ["optional", "tags"],
      "source_segment_id": "exact SEGMENT id",
      "dimensions": {{"brain-field-id": ["allowed label"]}},
      "citations": [
        {{"segment_id": "exact SEGMENT id", "quote": "verbatim source substring"}}
      ]
    }}
  ]
}}"""


def _parse_plan(text: str) -> Dict[str, Any]:
    if not text:
        return {"summary": "", "notes": []}
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    candidate = cleaned[start:end + 1] if start != -1 and end > start else cleaned
    try:
        data = json.loads(candidate)
    except Exception:
        logger.warning("llm_wiki could not parse the model plan as JSON")
        return {"summary": "", "notes": []}
    if not isinstance(data, dict):
        return {"summary": "", "notes": []}
    notes = data.get("notes")
    data["notes"] = [
        note
        for note in notes
        if isinstance(note, dict) and note.get("title")
    ] if isinstance(notes, list) else []
    return data


def _validate_and_reduce_plans(
    plans: list[tuple[dict[str, Any], dict[str, Any]]],
    origins: list[dict[str, Any]],
    ai_dimensions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate evidence, classify dimensions, and assign stable managed keys."""
    segments = {
        str(segment.get("id")): {
            **segment,
            "origin_id": origin["origin_id"],
            "origin_order": int(origin.get("input_order") or 0),
            "origin_label": origin.get("label") or origin.get("kind"),
            "snapshot_id": origin.get("snapshot_id"),
            "source_url": origin.get("source_url"),
        }
        for origin in origins
        for segment in origin.get("segments") or []
    }
    allowed_by_field = {
        item["field_id"]: item
        for item in ai_dimensions
    }
    counters: dict[tuple[str, str], int] = {}
    reduced = []
    warnings = []
    seen_evidence: set[tuple[str, str, str]] = set()

    for chunk, plan in plans:
        chunk_segment_ids = {str(item.get("id")) for item in chunk.get("segments") or []}
        for note in plan.get("notes") or []:
            citations = []
            for citation in note.get("citations") or []:
                if not isinstance(citation, dict):
                    continue
                segment_id = str(citation.get("segment_id") or note.get("source_segment_id") or "")
                segment = segments.get(segment_id)
                quote = " ".join(str(citation.get("quote") or "").split()).strip()
                if not segment or segment_id not in chunk_segment_ids or not quote:
                    continue
                if _normalized_text(quote) not in _normalized_text(segment.get("text")):
                    continue
                citations.append({
                    "segment_id": segment_id,
                    "quote": quote,
                    "locator": segment.get("locator") or {},
                    "origin_id": segment["origin_id"],
                    "origin_label": segment["origin_label"],
                    "snapshot_id": segment["snapshot_id"],
                    "source_url": segment["source_url"],
                })
            if not citations:
                warnings.append(f"Ungrounded model note skipped: {note.get('title')}")
                continue
            first_segment_id = str(note.get("source_segment_id") or citations[0]["segment_id"])
            if first_segment_id not in segments:
                first_segment_id = citations[0]["segment_id"]
            first_segment = segments[first_segment_id]
            counter_key = (first_segment["origin_id"], first_segment_id)
            counters[counter_key] = counters.get(counter_key, 0) + 1
            ordinal = counters[counter_key]
            managed_key = hashlib.sha256(
                f"{first_segment['origin_id']}|{first_segment_id}|{ordinal}".encode("utf-8")
            ).hexdigest()[:24]
            evidence_key = (
                first_segment["origin_id"],
                first_segment_id,
                _normalized_text(note.get("title")),
            )
            if evidence_key in seen_evidence:
                continue
            seen_evidence.add(evidence_key)
            dimensions = _validate_ai_dimensions(note.get("dimensions"), allowed_by_field)
            reduced.append({
                **note,
                "managed_key": managed_key,
                "citations": citations,
                "dimensions": dimensions,
                "origin_id": first_segment["origin_id"],
                "origin_order": first_segment["origin_order"],
                "origin_label": first_segment["origin_label"],
                "source_segment_id": first_segment_id,
                "segment_order": int(first_segment.get("order") or 0),
            })

    reduced.sort(
        key=lambda note: (
            int(note.get("origin_order") or 0),
            int(note.get("segment_order") or 0),
            note.get("managed_key"),
        )
    )
    for position, note in enumerate(reduced, start=1):
        note["position"] = position
    return reduced, warnings


def _validate_ai_dimensions(
    raw: Any,
    allowed_by_field: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for field_id, values in raw.items():
        spec = allowed_by_field.get(str(field_id))
        if not spec:
            continue
        candidates = values if isinstance(values, list) else [values]
        mapped = []
        for value in candidates:
            canonical = spec["by_label"].get(str(value).strip().casefold())
            if canonical is not None:
                mapped.append(canonical)
        if mapped:
            out[str(field_id)] = mapped if spec["multiple"] else mapped[0]
    return out


# ---------------------------------------------------------------------------
# Deterministic writes
# ---------------------------------------------------------------------------

def _today() -> str:
    return dt.date.today().isoformat()


def _parse_page(locator: str) -> Optional[int]:
    if not locator:
        return None
    match = re.search(r"(?:p{1,2}\.?|p[àa]g\.?|page|pl?\.?)\s*(\d{1,5})", locator, re.IGNORECASE)
    if not match:
        match = re.search(r"\b(\d{1,5})\b", locator)
    if not match:
        return None
    try:
        page = int(match.group(1))
        return page if page > 0 else None
    except ValueError:
        return None


def _render_citations(
    citations: Any,
    _source_title: str,
    source_id: str,
    source_table_id: str = "",
) -> str:
    if not isinstance(citations, list) or not citations:
        return ""
    lines = ["", "### Cites", ""]
    for citation in citations:
        if not isinstance(citation, dict):
            continue
        quote = str(citation.get("quote") or "").strip()
        if not quote:
            continue
        locator = citation.get("locator") or {}
        if isinstance(locator, str):
            page = _parse_page(locator)
            locator = {"page": page} if page else {"label": locator}
        params = {
            "res": source_id,
            "table": source_table_id,
            "snapshot": citation.get("snapshot_id") or "",
            "segment": citation.get("segment_id") or "",
            "origin": citation.get("origin_id") or "",
        }
        for key in ("page", "chapter", "paragraph", "line_start", "line_end", "start", "end"):
            value = locator.get(key)
            if value not in (None, ""):
                params[key] = value
        jump = f"[{_locator_label(locator)}](gnosi-cite:?{urlencode(params)})"
        lines.extend([f"> {quote} — {jump}", ""])
    return "\n".join(lines) if len(lines) > 3 else ""


def _base_note_metadata(
    note: dict,
    source_title: str,
    source_id: str,
    position: Optional[int] = None,
) -> dict:
    """Build metadata shared by every generated reading note."""
    note_type = str(note.get("type") or "").strip().lower()
    if note_type not in NOTE_TYPES:
        note_type = "concepte"
    tags = note.get("tags")
    tags = [str(tag).strip() for tag in tags if str(tag).strip()] if isinstance(tags, list) else []
    metadata = {
        "title": str(note.get("title") or "").strip(),
        "note_type": GENERATED_NOTE_TYPE,
        "Tipus": note_type,
        "Estat de verificació": "provisional",
        "Última revisió": _today(),
        "Tags": tags,
    }
    if position is not None:
        metadata["Posició"] = position
    return metadata


def _apply_plan(
    plan: dict,
    source_page_id: str,
    source_title: str,
    brain_table_id: str,
    *,
    source_table_id: str = "",
    source_config: Optional[dict[str, Any]] = None,
    config: Optional[dict[str, Any]] = None,
    source_dimensions: Optional[dict[str, Any]] = None,
) -> Dict[str, List[str]]:
    """Apply validated reading notes idempotently using stable managed keys."""
    from backend.api.vault_routes import (
        _get_pages_for_table,
        _get_unique_filepath,
        _resolve_table_folder_from_metadata,
        _table_by_id,
        parse_frontmatter,
        register_page_in_index,
        save_page_md,
    )

    config = config or llm_wiki_config.load_config()
    source_config = source_config or {}
    source_dimensions = source_dimensions or {}
    brain_table = _table_by_id(brain_table_id) or {}
    props_by_id = {
        str(prop.get("id") or ""): prop
        for prop in brain_table.get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }
    role_names = {
        role: str((props_by_id.get(str(prop_id)) or {}).get("name") or "")
        for role, prop_id in (config.get("brain_roles") or {}).items()
    }
    relation_prop = props_by_id.get(str(source_config.get("relation_property_id") or ""))
    locale = str(config.get("ui_locale") or "en").split("-", 1)[0].lower()
    relation_name = str((relation_prop or {}).get("name") or {
        "ca": "Font",
        "en": "Source",
        "es": "Fuente",
        "fr": "Source",
    }.get(locale, "Source"))

    brain_dir = _resolve_table_folder_from_metadata({"table_id": brain_table_id})
    if not brain_dir:
        raise RuntimeError("Could not resolve the Brain table folder")
    brain_dir.mkdir(parents=True, exist_ok=True)

    existing_by_key: dict[str, Any] = {}
    legacy_by_position: dict[int, list[Any]] = {}
    managed_for_resource: list[Any] = []
    for page in _get_pages_for_table(brain_table_id) or []:
        meta = llm_wiki_storage.page_metadata(page)
        if str(meta.get("llm_wiki_resource_id") or "") == source_page_id:
            managed_for_resource.append(page)
            key = str(meta.get("llm_wiki_key") or "")
            if key:
                existing_by_key[key] = page
        elif source_page_id in _fonts_ids(meta) and str(meta.get("note_type") or "").casefold() == "lectura":
            try:
                legacy_by_position.setdefault(int(meta.get("Posició") or 0), []).append(page)
            except (TypeError, ValueError):
                pass

    created: List[str] = []
    created_ids: List[str] = []
    updated: List[str] = []
    active_keys: set[str] = set()
    notes = plan.get("notes") if isinstance(plan.get("notes"), list) else []
    for note in notes:
        title = str(note.get("title") or "").strip()
        managed_key = str(note.get("managed_key") or "").strip()
        if not title or not managed_key:
            continue
        active_keys.add(managed_key)
        metadata = _base_note_metadata(note, source_title, source_page_id, int(note.get("position") or 0))
        metadata.update({
            "title": title,
            "table_id": brain_table_id,
            "note_type": GENERATED_NOTE_TYPE,
            "llm_wiki_managed": True,
            "llm_wiki_key": managed_key,
            "llm_wiki_source_table_id": source_table_id,
            "llm_wiki_resource_id": source_page_id,
            "llm_wiki_resource_title": source_title,
            "llm_wiki_origin_id": note.get("origin_id"),
            "llm_wiki_origin_order": note.get("origin_order"),
            "llm_wiki_origin_label": note.get("origin_label"),
            "llm_wiki_segment_id": note.get("source_segment_id"),
            "llm_wiki_stale": False,
            relation_name: [f"[[{source_title}|{source_page_id}]]"],
        })
        for fallback_name, role in (
            ("Tipus", "idea_type"),
            ("Posició", "position"),
            ("Estat de verificació", "verification"),
            ("Última revisió", "last_reviewed"),
            ("Tags", "tags"),
        ):
            if role_names.get(role) and role_names[role] != fallback_name:
                metadata.pop(fallback_name, None)
        if role_names.get("note_type"):
            metadata[role_names["note_type"]] = llm_wiki_config.note_type_value(
                "reading",
                config,
                props_by_id.get(str((config.get("brain_roles") or {}).get("note_type") or "")),
            )
        if role_names.get("idea_type"):
            metadata[role_names["idea_type"]] = metadata.get("Tipus")
        if role_names.get("position"):
            metadata[role_names["position"]] = int(note.get("position") or 0)
        if role_names.get("verification"):
            metadata[role_names["verification"]] = "provisional"
        if role_names.get("last_reviewed"):
            metadata[role_names["last_reviewed"]] = _today()
        if role_names.get("tags") and note.get("tags"):
            metadata[role_names["tags"]] = list(dict.fromkeys(str(tag) for tag in note["tags"] if tag))
        _apply_dimensions_to_metadata(
            metadata,
            _effective_dimensions(note.get("dimensions"), source_dimensions),
            props_by_id,
        )
        citations = _render_citations(
            note.get("citations"),
            source_title,
            source_page_id,
            source_table_id,
        )
        managed_body = (str(note.get("body_md") or "").strip() + citations).strip()

        page = existing_by_key.get(managed_key)
        # Adopt one unambiguous legacy generated note at the same source position.
        if page is None:
            candidates = legacy_by_position.get(int(note.get("position") or 0), [])
            if len(candidates) == 1:
                page = candidates[0]
                legacy_by_position[int(note.get("position") or 0)] = []
        if page is not None:
            path = _page_path(page)
            if path and path.exists():
                old_meta, old_body = parse_frontmatter(path.read_text(encoding="utf-8"), path)
                old_meta = llm_wiki_storage.merge_page_metadata(
                    old_meta,
                    str(getattr(page, "id", "") or old_meta.get("id") or ""),
                )
                old_meta.update(metadata)
                portable_meta = llm_wiki_storage.prepare_managed_markdown(old_meta)
                save_page_md(
                    path,
                    portable_meta,
                    _replace_note_block(old_body, managed_key, managed_body),
                )
                register_page_in_index(path)
                updated.append(title)
                continue

        metadata["id"] = str(uuid.uuid4())
        path = _get_unique_filepath(brain_dir, title, ".md")
        portable_meta = llm_wiki_storage.prepare_managed_markdown(metadata)
        save_page_md(path, portable_meta, _replace_note_block("", managed_key, managed_body))
        register_page_in_index(path)
        created.append(title)
        created_ids.append(metadata["id"])

    for page in managed_for_resource:
        meta = llm_wiki_storage.page_metadata(page)
        key = str(meta.get("llm_wiki_key") or "")
        if key and key not in active_keys and not meta.get("llm_wiki_stale"):
            path = _page_path(page)
            if not path or not path.exists():
                continue
            old_meta, old_body = parse_frontmatter(path.read_text(encoding="utf-8"), path)
            old_meta = llm_wiki_storage.merge_page_metadata(
                old_meta,
                str(getattr(page, "id", "") or old_meta.get("id") or ""),
            )
            old_meta["llm_wiki_stale"] = True
            save_page_md(
                path,
                llm_wiki_storage.prepare_managed_markdown(old_meta),
                old_body,
            )
            register_page_in_index(path)

    return {"created": created, "created_ids": created_ids, "updated": updated}


def _replace_note_block(body: str, managed_key: str, content: str) -> str:
    start = _MANAGED_NOTE_START.format(key=managed_key)
    end = _MANAGED_NOTE_END.format(key=managed_key)
    block = f"{start}\n{content.strip()}\n{end}"
    pattern = re.compile(re.escape(start) + r".*?" + re.escape(end), re.DOTALL)
    if pattern.search(body or ""):
        return pattern.sub(block, body).rstrip() + "\n"
    prefix = str(body or "").rstrip()
    return ((prefix + "\n\n") if prefix else "") + block + "\n"


def _apply_dimensions_to_metadata(
    metadata: dict[str, Any],
    dimensions: dict[str, Any],
    props_by_id: dict[str, dict],
) -> None:
    for field_id, value in dimensions.items():
        prop = props_by_id.get(str(field_id))
        if not prop or value in (None, "", [], {}):
            continue
        metadata[str(prop.get("name") or field_id)] = value


def _effective_dimensions(
    generated: Any,
    source_mapped: Any,
) -> dict[str, Any]:
    """Merge dimensions while keeping explicit source mappings authoritative."""
    generated_values = generated if isinstance(generated, dict) else {}
    source_values = source_mapped if isinstance(source_mapped, dict) else {}
    return {**generated_values, **source_values}


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def process_resource(
    source_page_id: str,
    source_title: str,
    metadata: dict,
    body: str,
    brain_table_id: str,
    vault_root,
    language: str = "English",
    *,
    source_table_id: str = "",
    source_table: Optional[dict[str, Any]] = None,
    source_config: Optional[dict[str, Any]] = None,
    job_id: str = "",
    resume_checkpoint: Optional[dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run a complete blocking ingest. Call from :func:`start_ingest`."""
    from backend.api.vault_routes import _table_by_id

    config = llm_wiki_config.load_config()
    source_table_id = source_table_id or str(metadata.get("table_id") or "")
    source_table = source_table or _table_by_id(source_table_id) or {
        "id": source_table_id,
        "properties": [],
    }
    source_config = source_config or llm_wiki_config.get_source_config(source_table_id)
    if not source_config:
        raise RuntimeError("The resource table is not configured as an LLM Wiki source")

    if job_id:
        llm_wiki_storage.update_job(job_id, phase=PHASE_READING, progress=3)
    origins, warnings = llm_wiki_extractors.extract_resource_sources(
        metadata,
        body,
        Path(vault_root),
        source_table,
        source_config,
    )
    if not origins:
        details = "; ".join(warnings[:3])
        raise RuntimeError(f"No readable configured attachment or URL was found. {details}".strip())

    snapshot_descriptors = []
    for origin in origins:
        descriptor = llm_wiki_storage.save_snapshot(source_table_id, source_page_id, origin)
        origin["snapshot_id"] = descriptor["snapshot_id"]
        snapshot_descriptors.append(descriptor)
    chunks = llm_wiki_extractors.chunk_origins(origins)
    if job_id:
        llm_wiki_storage.update_job(
            job_id,
            phase=PHASE_PLANNING,
            progress=10,
            origins_total=len(origins),
            origins_done=len(origins),
            chunks_total=len(chunks),
            warnings=warnings,
        )

    brain_index = _load_brain_index(brain_table_id, source_page_id)
    source_dimensions, ai_dimensions = _dimension_context(
        config,
        source_table,
        source_config,
        metadata,
    )
    current_hashes = [str(origin.get("content_hash") or "") for origin in origins]
    checkpoint_plan = (
        resume_checkpoint.get("plan")
        if isinstance(resume_checkpoint, dict)
        and isinstance(resume_checkpoint.get("plan"), dict)
        else None
    )
    checkpoint_hashes = (
        [str(item) for item in resume_checkpoint.get("origin_hashes") or []]
        if isinstance(resume_checkpoint, dict)
        else []
    )
    can_resume = bool(checkpoint_plan) and checkpoint_hashes == current_hashes
    models = []
    if can_resume:
        plan = checkpoint_plan
        model = str(resume_checkpoint.get("model") or "")
        models.append(model)
        if job_id:
            llm_wiki_storage.update_job(
                job_id,
                phase=PHASE_WRITING,
                progress=75,
                chunks_done=len(chunks),
                model=model or None,
            )
    else:
        from backend.agent.factory import generate_text

        plans = []
        for chunk_index, chunk in enumerate(chunks, start=1):
            prompt = _build_chunk_prompt(
                chunk,
                source_title,
                brain_index,
                language,
                ai_dimensions,
            )
            raw, model = generate_text(prompt, user_message=source_title, timeout=240)
            models.append(model)
            chunk_plan = _parse_plan(raw)
            plans.append((chunk, chunk_plan))
            if job_id:
                llm_wiki_storage.save_checkpoint(
                    job_id,
                    f"plan-{chunk_index}",
                    {"chunk": chunk, "plan": chunk_plan, "model": model},
                )
                llm_wiki_storage.update_job(
                    job_id,
                    chunks_done=chunk_index,
                    model=model,
                    progress=10 + round(60 * chunk_index / max(1, len(chunks))),
                )

        notes, grounding_warnings = _validate_and_reduce_plans(plans, origins, ai_dimensions)
        warnings.extend(grounding_warnings)
        if not notes:
            raise RuntimeError("The model produced no grounded atomic reading notes")
        plan = {
            "summary": "\n\n".join(
                str(item.get("summary") or "").strip()
                for _chunk, item in plans
                if str(item.get("summary") or "").strip()
            ),
            "notes": notes,
        }
    notes = plan.get("notes") if isinstance(plan.get("notes"), list) else []
    if not notes:
        raise RuntimeError("The persisted or generated plan contains no reading notes")
    if job_id:
        llm_wiki_storage.save_checkpoint(
            job_id,
            "reduced-plan",
            {
                "plan": plan,
                "origin_hashes": current_hashes,
                "model": next((str(item) for item in reversed(models) if item), ""),
            },
        )
        llm_wiki_storage.update_job(job_id, phase=PHASE_WRITING, progress=75)
    result = _apply_plan(
        plan,
        source_page_id,
        source_title,
        brain_table_id,
        source_table_id=source_table_id,
        source_config=source_config,
        config=config,
        source_dimensions=source_dimensions,
    )
    model = next((str(item) for item in reversed(models) if item), "")
    report = {
        "source_kind": "+".join(dict.fromkeys(str(origin.get("kind")) for origin in origins)),
        "source_count": len(origins),
        "snapshots": snapshot_descriptors,
        "created": result["created"],
        "created_ids": result.get("created_ids", []),
        "updated": result["updated"],
        "pages_touched": len(result["created"]) + len(result["updated"]),
        "model": model,
        "summary": plan["summary"],
        "warnings": warnings,
        "managed_keys": [note["managed_key"] for note in notes],
    }
    manifest = llm_wiki_storage.load_manifest(source_table_id, source_page_id)
    manifest.update({
        "version": 2,
        "source_table_id": source_table_id,
        "resource_id": source_page_id,
        "resource_title": source_title,
        "updated_at": time.time(),
        "origins": snapshot_descriptors,
        "managed_keys": report["managed_keys"],
        "last_job_id": job_id,
        "model": model,
        "warnings": warnings,
    })
    llm_wiki_storage.save_manifest(source_table_id, source_page_id, manifest)
    return report


def start_ingest(
    source_page_id: str,
    source_title: str,
    metadata: dict,
    body: str,
    brain_table_id: str,
    vault_root,
    language: str = "English",
    *,
    source_table_id: str = "",
    source_table: Optional[dict[str, Any]] = None,
    source_config: Optional[dict[str, Any]] = None,
    force: bool = False,
) -> dict[str, Any]:
    """Start a durable background job and return its initial state."""
    from backend.services import context_vars as cv

    source_table_id = source_table_id or str(metadata.get("table_id") or "")
    existing = (
        llm_wiki_storage.get_job_status(source_page_id, source_table_id)
        if llm_wiki_storage.is_running(source_table_id, source_page_id)
        else None
    )
    if existing:
        return existing
    previous = llm_wiki_storage.get_job_status(source_page_id, source_table_id)
    resume_checkpoint = None
    if not force and previous.get("phase") == PHASE_PARTIAL and previous.get("job_id"):
        resume_checkpoint = llm_wiki_storage.load_checkpoint(
            str(previous["job_id"]),
            "reduced-plan",
        )
    job = llm_wiki_storage.create_job(source_table_id, source_page_id)
    active_vault = cv.get_active_vault_path()

    def _worker() -> None:
        token = None
        try:
            if active_vault is not None:
                token = cv.active_vault_path.set(active_vault)
            report = process_resource(
                source_page_id,
                source_title,
                metadata,
                body,
                brain_table_id,
                vault_root,
                language,
                source_table_id=source_table_id,
                source_table=source_table,
                source_config=source_config,
                job_id=job["job_id"],
                resume_checkpoint=resume_checkpoint,
            )
            llm_wiki_storage.update_job(job["job_id"], phase=PHASE_INDEXING, progress=90)
            index_report = llm_wiki_indices.rebuild_indexes(
                brain_table_id,
                llm_wiki_config.load_config(),
            )
            report["index_report"] = index_report
            llm_wiki_indices.append_log(
                brain_table_id,
                resource_title=source_title,
                resource_id=source_page_id,
                source_table_id=source_table_id,
                report=report,
            )
            _on_ingest_success(source_page_id, source_table_id, report)
            llm_wiki_storage.finish_job(
                job["job_id"],
                phase=PHASE_DONE,
                pages_touched=report["pages_touched"],
                created=report["created"],
                updated=report["updated"],
                model=report["model"],
                warnings=report["warnings"],
                index_report=index_report,
            )
        except Exception as exc:  # noqa: BLE001
            logger.error("llm_wiki ingest failed for %s: %s", source_page_id, exc)
            checkpoint = llm_wiki_storage.load_checkpoint(job["job_id"], "reduced-plan")
            phase = PHASE_PARTIAL if checkpoint else PHASE_ERROR
            llm_wiki_storage.finish_job(job["job_id"], phase=phase, error=str(exc))
        finally:
            if token is not None:
                cv.active_vault_path.reset(token)

    threading.Thread(
        target=_worker,
        name=f"llm-wiki-{source_page_id[:8]}",
        daemon=True,
    ).start()
    return job


def _on_ingest_success(
    source_page_id: str,
    source_table_id: str,
    report: Dict[str, Any],
) -> None:
    try:
        from backend.api.vault_routes import mark_resource_processed

        mark_resource_processed(source_page_id, _today())
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki could not update the optional processed field: %s", exc)
    try:
        from backend.services import plugin_events

        plugin_events.emit("llm-wiki:ingested", {
            "page_id": source_page_id,
            "source_table_id": source_table_id,
            "pages_touched": report.get("pages_touched", 0),
            "created": len(report.get("created", [])),
            "updated": len(report.get("updated", [])),
        })
    except Exception as exc:  # noqa: BLE001
        logger.warning("llm_wiki could not emit the ingest event: %s", exc)


# ---------------------------------------------------------------------------
# Dimension mapping
# ---------------------------------------------------------------------------

def _dimension_context(
    config: dict[str, Any],
    source_table: dict,
    source_config: dict,
    metadata: dict,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from backend.api.vault_routes import _get_pages_for_table, _table_by_id

    brain_table = _table_by_id(str(config.get("brain_table_id") or "")) or {}
    brain_props = {
        str(prop.get("id") or ""): prop
        for prop in brain_table.get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }
    source_props = {
        str(prop.get("id") or ""): prop
        for prop in source_table.get("properties") or []
        if isinstance(prop, dict) and prop.get("id")
    }
    mapped: dict[str, Any] = {}
    ai_specs: list[dict[str, Any]] = []
    mappings = source_config.get("dimension_mappings") or {}
    for field_id in config.get("index_field_ids") or []:
        prop = brain_props.get(str(field_id))
        if not prop:
            continue
        mapping = mappings.get(str(field_id)) or {"mode": "ai"}
        mode = str(mapping.get("mode") or "ai")
        if mode == "empty":
            continue
        options = _dimension_options(prop, _get_pages_for_table)
        if mode == "fixed":
            value = _canonical_dimension_value(prop, mapping.get("fixed_value"), options)
            if value not in (None, "", [], {}):
                mapped[str(field_id)] = value
            continue
        if mode == "source":
            source_prop = source_props.get(str(mapping.get("source_property_id") or ""))
            if source_prop:
                value = _canonical_dimension_value(
                    prop,
                    _metadata_property_value(metadata, source_prop),
                    options,
                )
                if value not in (None, "", [], {}):
                    mapped[str(field_id)] = value
            continue

        if options:
            ai_specs.append({
                "field_id": str(field_id),
                "name": str(prop.get("name") or field_id),
                "allowed_labels": [item["label"] for item in options],
                "by_label": {item["label"].casefold(): item["value"] for item in options},
                "multiple": str(prop.get("type") or "") in {"multi_select", "relation"},
            })
    return mapped, ai_specs


def _canonical_dimension_value(
    prop: dict,
    raw: Any,
    options: list[dict[str, Any]],
) -> Any:
    """Map source/fixed values only to options that already exist."""
    if raw in (None, "", [], {}) or not options:
        return None
    allowed: dict[str, Any] = {}
    for option in options:
        for candidate in (
            option.get("label"),
            option.get("value"),
            option.get("id"),
        ):
            key = str(candidate or "").strip().casefold()
            if key:
                allowed[key] = option.get("value")
    candidates = raw if isinstance(raw, list) else [raw]
    mapped = []
    for candidate in candidates:
        if isinstance(candidate, dict):
            candidate = (
                candidate.get("name")
                or candidate.get("title")
                or candidate.get("value")
                or candidate.get("id")
            )
        value = allowed.get(str(candidate or "").strip().casefold())
        if value is not None and value not in mapped:
            mapped.append(value)
    if not mapped:
        return None
    return mapped if str(prop.get("type") or "") in {"multi_select", "relation"} else mapped[0]


def _dimension_options(prop: dict, pages_for_table) -> list[dict[str, Any]]:
    prop_type = str(prop.get("type") or "")
    if prop_type == "relation":
        target_id = str(prop.get("relation_database_id") or "")
        if not target_id:
            return []
        return [
            {
                "label": str(getattr(page, "title", "") or ""),
                "value": f"[[{getattr(page, 'title', '')}|{getattr(page, 'id', '')}]]",
                "id": str(getattr(page, "id", "") or ""),
            }
            for page in list(pages_for_table(target_id) or [])[:150]
            if getattr(page, "title", None) and getattr(page, "id", None)
        ]
    raw_options = (
        prop.get("options")
        or (prop.get("config") or {}).get("options")
        or (prop.get("select") or {}).get("options")
        or []
    )
    out = []
    for option in raw_options if isinstance(raw_options, list) else []:
        label = str(option.get("name") if isinstance(option, dict) else option).strip()
        if label:
            out.append({"label": label, "value": label})
    return out


def _metadata_property_value(metadata: dict, prop: dict) -> Any:
    for key in (str(prop.get("name") or ""), str(prop.get("id") or "")):
        if key and metadata.get(key) not in (None, "", [], {}):
            return metadata.get(key)
    return None


def _locator_label(locator: dict[str, Any]) -> str:
    if locator.get("page"):
        label = f"p. {locator['page']}"
        if locator.get("paragraph"):
            label += f", ¶ {locator['paragraph']}"
        return label
    if locator.get("chapter"):
        label = str(locator["chapter"])
        if locator.get("paragraph"):
            label += f", ¶ {locator['paragraph']}"
        return label
    if locator.get("line_start"):
        end = locator.get("line_end") or locator["line_start"]
        return f"l. {locator['line_start']}–{end}"
    if locator.get("start") is not None:
        return _format_timestamp(float(locator.get("start") or 0))
    if locator.get("image"):
        return str(locator["image"])
    return str(locator.get("label") or "fragment")


def _format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes}:{secs:02d}"


def _normalized_text(value: Any) -> str:
    return " ".join(str(value or "").casefold().split())


def _page_path(page: Any) -> Optional[Path]:
    value = page.get("path") if isinstance(page, dict) else getattr(page, "path", None)
    return Path(value) if value else None
