"""Incremental Zettelkasten ingestion for Gnosi's built-in LLM Wiki.

The model reads complete ordered source segments and returns a write plan.
Application code validates citations, owns stable note ids, persists job
checkpoints, and updates deterministic index pages.  The LLM never writes
files directly.
"""
from __future__ import annotations

import datetime as dt
import re
import threading
import time
import uuid
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any, Dict, List, Optional, cast
from urllib.parse import urlencode

from backend.config.logger_config import get_logger
from backend.domains.llm_wiki import dimensions as llm_wiki_dimensions
from backend.domains.llm_wiki import ingestion as llm_wiki_ingestion
from backend.domains.llm_wiki import planning as llm_wiki_planning
from backend.domains.llm_wiki import writing as llm_wiki_writing
from backend.services import (
    llm_wiki_config,
    llm_wiki_extractors,
    llm_wiki_indices,
    llm_wiki_pdf_annotations,
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
    return cast(
        Dict[str, Any],
        llm_wiki_storage.get_job_status(identifier, source_table_id),
    )


def is_running(page_id: str, source_table_id: str = "") -> bool:
    """Compatibility helper for the former one-argument route guard."""
    if source_table_id:
        return bool(llm_wiki_storage.is_running(source_table_id, page_id))
    return any(
        bool(llm_wiki_storage.is_running(table_id, page_id))
        for table_id in llm_wiki_config.get_source_table_ids()
    )


# ---------------------------------------------------------------------------
# Source compatibility helpers
# ---------------------------------------------------------------------------

def read_source(
    metadata: dict[str, Any],
    body: str,
    vault_root: str | Path,
) -> tuple[str, str]:
    """Compatibility wrapper returning all detected source text, untruncated."""
    properties: list[dict[str, str]] = []
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
    table: dict[str, Any] = {
        "id": str(metadata.get("table_id") or "legacy"),
        "properties": properties,
    }
    config = cast(dict[str, Any], llm_wiki_config.auto_detect_source(table))
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


def _first_value(metadata: dict[str, Any], keys: tuple[str, ...]) -> Any:
    for key in keys:
        value = (metadata or {}).get(key)
        if value not in (None, "", [], {}):
            return value
    return None


def _fonts_ids(meta: dict[str, Any]) -> List[str]:
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
    return cast(
        str,
        llm_wiki_planning.build_chunk_prompt(
            chunk,
            source_title,
            brain_index,
            language,
            ai_dimensions,
            locator_label=_locator_label,
        ),
    )


def _parse_plan(text: str) -> Dict[str, Any]:
    return cast(Dict[str, Any], llm_wiki_planning.parse_plan(text, logger=logger))


def _validate_and_reduce_plans(
    plans: list[tuple[dict[str, Any], dict[str, Any]]],
    origins: list[dict[str, Any]],
    ai_dimensions: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """Validate evidence, classify dimensions, and assign stable managed keys."""
    return cast(
        tuple[list[dict[str, Any]], list[str]],
        llm_wiki_planning.validate_and_reduce_plans(
            plans,
            origins,
            ai_dimensions,
            normalized_text=_normalized_text,
            validate_dimensions=_validate_ai_dimensions,
        ),
    )


def _validate_ai_dimensions(
    raw: Any,
    allowed_by_field: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        llm_wiki_planning.validate_ai_dimensions(raw, allowed_by_field),
    )


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
    note: dict[str, Any],
    source_title: str,
    source_id: str,
    position: Optional[int] = None,
) -> dict[str, Any]:
    """Build metadata shared by every generated reading note."""
    note_type = str(note.get("type") or "").strip().lower()
    if note_type not in NOTE_TYPES:
        note_type = "concepte"
    tags = note.get("tags")
    tags = [str(tag).strip() for tag in tags if str(tag).strip()] if isinstance(tags, list) else []
    metadata: dict[str, Any] = {
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
    plan: dict[str, Any],
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

    dependencies = llm_wiki_writing.WritingDependencies(
        get_pages_for_table=_get_pages_for_table,
        get_unique_filepath=_get_unique_filepath,
        resolve_table_folder=_resolve_table_folder_from_metadata,
        table_by_id=_table_by_id,
        parse_frontmatter=parse_frontmatter,
        register_page_in_index=register_page_in_index,
        save_page_md=save_page_md,
        load_config=llm_wiki_config.load_config,
        note_type_value=llm_wiki_config.note_type_value,
        page_metadata=llm_wiki_storage.page_metadata,
        merge_page_metadata=llm_wiki_storage.merge_page_metadata,
        prepare_managed_markdown=llm_wiki_storage.prepare_managed_markdown,
        base_note_metadata=_base_note_metadata,
        fonts_ids=_fonts_ids,
        page_path=_page_path,
        apply_dimensions=_apply_dimensions_to_metadata,
        effective_dimensions=_effective_dimensions,
        render_citations=_render_citations,
        replace_note_block=_replace_note_block,
        today=_today,
        uuid_factory=lambda: str(uuid.uuid4()),
        generated_note_type=GENERATED_NOTE_TYPE,
    )
    return cast(
        Dict[str, List[str]],
        llm_wiki_writing.apply_plan(
            plan,
            source_page_id,
            source_title,
            brain_table_id,
            source_table_id=source_table_id,
            source_config=source_config,
            config=config,
            source_dimensions=source_dimensions,
            dependencies=dependencies,
        ),
    )


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
    props_by_id: dict[str, dict[str, Any]],
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
    metadata: dict[str, Any],
    body: str,
    brain_table_id: str,
    vault_root: str | Path,
    language: str = "English",
    *,
    source_table_id: str = "",
    source_table: Optional[dict[str, Any]] = None,
    source_config: Optional[dict[str, Any]] = None,
    job_id: str = "",
    resume_checkpoint: Optional[dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run a complete blocking ingest. Call from :func:`start_ingest`."""
    from backend.agent.factory import generate_text
    from backend.api.vault_routes import _table_by_id

    dependencies = llm_wiki_ingestion.IngestionDependencies(
        load_config=lambda: cast(
            dict[str, Any],
            llm_wiki_config.load_config(),
        ),
        source_config=lambda table_id: cast(
            dict[str, Any] | None,
            llm_wiki_config.get_source_config(table_id),
        ),
        table_by_id=lambda table_id: cast(
            dict[str, Any] | None,
            _table_by_id(table_id),
        ),
        update_job=llm_wiki_storage.update_job,
        extract_sources=llm_wiki_extractors.extract_resource_sources,
        save_snapshot=llm_wiki_storage.save_snapshot,
        chunk_origins=llm_wiki_extractors.chunk_origins,
        load_brain_index=_load_brain_index,
        dimension_context=_dimension_context,
        build_prompt=_build_chunk_prompt,
        generate_text=lambda prompt, **kwargs: cast(
            tuple[str, str],
            generate_text(prompt, **kwargs),
        ),
        parse_plan=_parse_plan,
        save_checkpoint=llm_wiki_storage.save_checkpoint,
        reduce_plans=_validate_and_reduce_plans,
        apply_plan=_apply_plan,
        sync_annotations=lambda notes, origins, page_id: cast(
            dict[str, Any],
            llm_wiki_pdf_annotations.sync_generated_pdf_annotations(
                notes,
                origins,
                page_id,
            ),
        ),
        load_manifest=lambda table_id, page_id: cast(
            dict[str, Any],
            llm_wiki_storage.load_manifest(table_id, page_id),
        ),
        save_manifest=llm_wiki_storage.save_manifest,
        clock=time.time,
        logger=logger,
        phases=llm_wiki_ingestion.IngestionPhases(
            reading=PHASE_READING,
            planning=PHASE_PLANNING,
            writing=PHASE_WRITING,
        ),
    )
    return cast(
        Dict[str, Any],
        llm_wiki_ingestion.process_resource(
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
            job_id=job_id,
            resume_checkpoint=resume_checkpoint,
            dependencies=dependencies,
        ),
    )


def start_ingest(
    source_page_id: str,
    source_title: str,
    metadata: dict[str, Any],
    body: str,
    brain_table_id: str,
    vault_root: str | Path,
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
    existing = cast(
        dict[str, Any] | None,
        llm_wiki_storage.get_job_status(source_page_id, source_table_id)
        if llm_wiki_storage.is_running(source_table_id, source_page_id)
        else None,
    )
    if existing:
        return existing
    previous = cast(
        dict[str, Any],
        llm_wiki_storage.get_job_status(source_page_id, source_table_id),
    )
    resume_checkpoint: dict[str, Any] | None = None
    if not force and previous.get("phase") == PHASE_PARTIAL and previous.get("job_id"):
        resume_checkpoint = cast(
            dict[str, Any] | None,
            llm_wiki_storage.load_checkpoint(
                str(previous["job_id"]),
                "reduced-plan",
            ),
        )
    job = cast(
        dict[str, Any],
        llm_wiki_storage.create_job(source_table_id, source_page_id),
    )
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
    source_table: dict[str, Any],
    source_config: dict[str, Any],
    metadata: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    from backend.api.vault_routes import _get_pages_for_table, _table_by_id

    dependencies = llm_wiki_dimensions.DimensionDependencies(
        table_by_id=_table_by_id,
        pages_for_table=_get_pages_for_table,
        canonical_value=_canonical_dimension_value,
        dimension_options=_dimension_options,
        metadata_value=_metadata_property_value,
    )
    return cast(
        tuple[dict[str, Any], list[dict[str, Any]]],
        llm_wiki_dimensions.build_dimension_context(
            config,
            source_table,
            source_config,
            metadata,
            dependencies=dependencies,
        ),
    )


def _canonical_dimension_value(
    prop: dict[str, Any],
    raw: Any,
    options: list[dict[str, Any]],
) -> Any:
    """Map source/fixed values only to options that already exist."""
    return llm_wiki_dimensions.canonical_dimension_value(prop, raw, options)


def _dimension_options(
    prop: dict[str, Any],
    pages_for_table: Callable[[str], Iterable[Any]],
) -> list[dict[str, Any]]:
    return cast(
        list[dict[str, Any]],
        llm_wiki_dimensions.dimension_options(prop, pages_for_table),
    )


def _metadata_property_value(
    metadata: dict[str, Any],
    prop: dict[str, Any],
) -> Any:
    return llm_wiki_dimensions.metadata_property_value(metadata, prop)


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
