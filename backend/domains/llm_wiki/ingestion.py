"""Typed blocking orchestration for durable LLM Wiki ingestion."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, cast

from backend.utils.open_values import iterable_values

class UpdateJob(Protocol):
    def __call__(self, job_id: str, **fields: object) -> object: ...


class ExtractSources(Protocol):
    def __call__(
        self,
        metadata: dict[str, object],
        body: str,
        vault_root: Path,
        source_table: dict[str, object],
        source_config: dict[str, object],
    ) -> tuple[list[dict[str, object]], list[str]]: ...


class GenerateText(Protocol):
    def __call__(
        self,
        prompt: str,
        *,
        user_message: str,
        timeout: int,
    ) -> tuple[str, str]: ...


class ApplyPlan(Protocol):
    def __call__(
        self,
        plan: dict[str, object],
        source_page_id: str,
        source_title: str,
        brain_table_id: str,
        *,
        source_table_id: str = "",
        source_config: dict[str, object] | None = None,
        config: dict[str, object] | None = None,
        source_dimensions: dict[str, object] | None = None,
    ) -> dict[str, list[str]]: ...


@dataclass(frozen=True)
class IngestionPhases:
    reading: str
    planning: str
    writing: str


@dataclass(frozen=True)
class IngestionDependencies:
    """Late-bound collaborators exposed by the compatibility facade."""

    load_config: Callable[[], dict[str, object]]
    source_config: Callable[[str], dict[str, object] | None]
    table_by_id: Callable[[str], dict[str, object] | None]
    update_job: UpdateJob
    extract_sources: ExtractSources
    save_snapshot: Callable[[str, str, dict[str, object]], dict[str, object]]
    chunk_origins: Callable[[list[dict[str, object]]], list[dict[str, object]]]
    load_brain_index: Callable[[str, str], list[dict[str, object]]]
    dimension_context: Callable[
        [dict[str, object], dict[str, object], dict[str, object], dict[str, object]],
        tuple[dict[str, object], list[dict[str, object]]],
    ]
    build_prompt: Callable[
        [dict[str, object], str, list[dict[str, object]], str, list[dict[str, object]]],
        str,
    ]
    generate_text: GenerateText
    parse_plan: Callable[[str], dict[str, object]]
    save_checkpoint: Callable[[str, str, dict[str, object]], object]
    reduce_plans: Callable[
        [
            list[tuple[dict[str, object], dict[str, object]]],
            list[dict[str, object]],
            list[dict[str, object]],
        ],
        tuple[list[dict[str, object]], list[str]],
    ]
    apply_plan: ApplyPlan
    sync_annotations: Callable[
        [list[dict[str, object]], list[dict[str, object]], str],
        dict[str, object],
    ]
    load_manifest: Callable[[str, str], dict[str, object]]
    save_manifest: Callable[[str, str, dict[str, object]], object]
    clock: Callable[[], float]
    logger: logging.Logger
    phases: IngestionPhases


@dataclass(frozen=True)
class _PreparedSources:
    origins: list[dict[str, object]]
    warnings: list[str]
    snapshots: list[dict[str, object]]
    chunks: list[dict[str, object]]


def process_resource(
    source_page_id: str,
    source_title: str,
    metadata: dict[str, object],
    body: str,
    brain_table_id: str,
    vault_root: str | Path,
    language: str = "English",
    *,
    source_table_id: str = "",
    source_table: dict[str, object] | None = None,
    source_config: dict[str, object] | None = None,
    job_id: str = "",
    resume_checkpoint: dict[str, object] | None = None,
    dependencies: IngestionDependencies,
) -> dict[str, object]:
    """Run one complete blocking ingest through explicit application ports."""
    config = dependencies.load_config()
    resolved_table_id = source_table_id or str(metadata.get("table_id") or "")
    resolved_table = (
        source_table
        or dependencies.table_by_id(resolved_table_id)
        or {
            "id": resolved_table_id,
            "properties": [],
        }
    )
    resolved_config = source_config or dependencies.source_config(resolved_table_id)
    if not resolved_config:
        raise RuntimeError("The resource table is not configured as an LLM Wiki source")
    sources = _prepare_sources(
        resolved_table_id,
        source_page_id,
        metadata,
        body,
        Path(vault_root),
        resolved_table,
        resolved_config,
        job_id,
        dependencies,
    )
    brain_index = dependencies.load_brain_index(brain_table_id, source_page_id)
    source_dimensions, ai_dimensions = dependencies.dimension_context(
        config,
        resolved_table,
        resolved_config,
        metadata,
    )
    plan, models = _resolve_plan(
        source_title,
        language,
        sources,
        brain_index,
        ai_dimensions,
        resume_checkpoint,
        job_id,
        dependencies,
    )
    notes = _plan_notes(plan)
    if not notes:
        raise RuntimeError("The persisted or generated plan contains no reading notes")
    _persist_reduced_plan(
        plan,
        models,
        sources.origins,
        job_id,
        dependencies,
    )
    result = dependencies.apply_plan(
        plan,
        source_page_id,
        source_title,
        brain_table_id,
        source_table_id=resolved_table_id,
        source_config=resolved_config,
        config=config,
        source_dimensions=source_dimensions,
    )
    annotation_report = _sync_annotations(
        notes,
        sources.origins,
        source_page_id,
        sources.warnings,
        dependencies,
    )
    model = next((item for item in reversed(models) if item), "")
    report = _build_report(
        sources,
        result,
        plan,
        notes,
        model,
        annotation_report,
    )
    _save_manifest(
        resolved_table_id,
        source_page_id,
        source_title,
        job_id,
        model,
        sources,
        report,
        dependencies,
    )
    return report


def _prepare_sources(
    source_table_id: str,
    source_page_id: str,
    metadata: dict[str, object],
    body: str,
    vault_root: Path,
    source_table: dict[str, object],
    source_config: dict[str, object],
    job_id: str,
    dependencies: IngestionDependencies,
) -> _PreparedSources:
    if job_id:
        dependencies.update_job(
            job_id,
            phase=dependencies.phases.reading,
            progress=3,
        )
    origins, warnings = dependencies.extract_sources(
        metadata,
        body,
        vault_root,
        source_table,
        source_config,
    )
    if not origins:
        details = "; ".join(warnings[:3])
        raise RuntimeError(f"No readable configured attachment or URL was found. {details}".strip())
    snapshots: list[dict[str, object]] = []
    for origin in origins:
        descriptor = dependencies.save_snapshot(
            source_table_id,
            source_page_id,
            origin,
        )
        origin["snapshot_id"] = descriptor["snapshot_id"]
        snapshots.append(descriptor)
    chunks = dependencies.chunk_origins(origins)
    if job_id:
        dependencies.update_job(
            job_id,
            phase=dependencies.phases.planning,
            progress=10,
            origins_total=len(origins),
            origins_done=len(origins),
            chunks_total=len(chunks),
            warnings=warnings,
        )
    return _PreparedSources(origins, warnings, snapshots, chunks)


def _resolve_plan(
    source_title: str,
    language: str,
    sources: _PreparedSources,
    brain_index: list[dict[str, object]],
    ai_dimensions: list[dict[str, object]],
    resume_checkpoint: dict[str, object] | None,
    job_id: str,
    dependencies: IngestionDependencies,
) -> tuple[dict[str, object], list[str]]:
    current_hashes = [str(origin.get("content_hash") or "") for origin in sources.origins]
    checkpoint_plan = _checkpoint_plan(resume_checkpoint)
    checkpoint_hashes = (
        [str(item) for item in iterable_values(resume_checkpoint.get("origin_hashes") or [])]
        if resume_checkpoint
        else []
    )
    if checkpoint_plan and checkpoint_hashes == current_hashes:
        model = str(resume_checkpoint.get("model") or "") if resume_checkpoint else ""
        if job_id:
            dependencies.update_job(
                job_id,
                phase=dependencies.phases.writing,
                progress=75,
                chunks_done=len(sources.chunks),
                model=model or None,
            )
        return checkpoint_plan, [model]
    return _generate_plan(
        source_title,
        language,
        sources,
        brain_index,
        ai_dimensions,
        job_id,
        dependencies,
    )


def _generate_plan(
    source_title: str,
    language: str,
    sources: _PreparedSources,
    brain_index: list[dict[str, object]],
    ai_dimensions: list[dict[str, object]],
    job_id: str,
    dependencies: IngestionDependencies,
) -> tuple[dict[str, object], list[str]]:
    plans: list[tuple[dict[str, object], dict[str, object]]] = []
    models: list[str] = []
    for chunk_index, chunk in enumerate(sources.chunks, start=1):
        prompt = dependencies.build_prompt(
            chunk,
            source_title,
            brain_index,
            language,
            ai_dimensions,
        )
        raw, model = dependencies.generate_text(
            prompt,
            user_message=source_title,
            timeout=240,
        )
        models.append(model)
        chunk_plan = dependencies.parse_plan(raw)
        plans.append((chunk, chunk_plan))
        _record_chunk_progress(
            chunk_index,
            chunk,
            chunk_plan,
            model,
            len(sources.chunks),
            job_id,
            dependencies,
        )
    notes, grounding_warnings = dependencies.reduce_plans(
        plans,
        sources.origins,
        ai_dimensions,
    )
    sources.warnings.extend(grounding_warnings)
    if not notes:
        raise RuntimeError("The model produced no grounded atomic reading notes")
    summary = "\n\n".join(
        str(item.get("summary") or "").strip()
        for _chunk, item in plans
        if str(item.get("summary") or "").strip()
    )
    return {"summary": summary, "notes": notes}, models


def _record_chunk_progress(
    chunk_index: int,
    chunk: dict[str, object],
    chunk_plan: dict[str, object],
    model: str,
    chunk_count: int,
    job_id: str,
    dependencies: IngestionDependencies,
) -> None:
    if not job_id:
        return
    dependencies.save_checkpoint(
        job_id,
        f"plan-{chunk_index}",
        {"chunk": chunk, "plan": chunk_plan, "model": model},
    )
    dependencies.update_job(
        job_id,
        chunks_done=chunk_index,
        model=model,
        progress=10 + round(60 * chunk_index / max(1, chunk_count)),
    )


def _persist_reduced_plan(
    plan: dict[str, object],
    models: list[str],
    origins: list[dict[str, object]],
    job_id: str,
    dependencies: IngestionDependencies,
) -> None:
    if not job_id:
        return
    dependencies.save_checkpoint(
        job_id,
        "reduced-plan",
        {
            "plan": plan,
            "origin_hashes": [str(origin.get("content_hash") or "") for origin in origins],
            "model": next((item for item in reversed(models) if item), ""),
        },
    )
    dependencies.update_job(
        job_id,
        phase=dependencies.phases.writing,
        progress=75,
    )


def _sync_annotations(
    notes: list[dict[str, object]],
    origins: list[dict[str, object]],
    source_page_id: str,
    warnings: list[str],
    dependencies: IngestionDependencies,
) -> dict[str, object]:
    try:
        report = dependencies.sync_annotations(notes, origins, source_page_id)
        warnings.extend(cast(Iterable[str], report.get("warnings") or []))
        return report
    except Exception as exc:
        dependencies.logger.warning(
            "llm_wiki managed PDF annotations failed: %s",
            exc,
        )
        warnings.append(f"Managed PDF annotations could not be synchronized: {exc}")
        return {
            "created": 0,
            "updated": 0,
            "removed": 0,
            "matched": 0,
            "requested": 0,
        }


def _build_report(
    sources: _PreparedSources,
    result: dict[str, list[str]],
    plan: dict[str, object],
    notes: list[dict[str, object]],
    model: str,
    annotation_report: dict[str, object],
) -> dict[str, object]:
    return {
        "source_kind": "+".join(
            dict.fromkeys(str(origin.get("kind")) for origin in sources.origins)
        ),
        "source_count": len(sources.origins),
        "snapshots": sources.snapshots,
        "created": result["created"],
        "created_ids": result.get("created_ids", []),
        "updated": result["updated"],
        "pages_touched": len(result["created"]) + len(result["updated"]),
        "model": model,
        "summary": plan["summary"],
        "warnings": sources.warnings,
        "managed_keys": [note["managed_key"] for note in notes],
        "pdf_annotations": annotation_report,
    }


def _save_manifest(
    source_table_id: str,
    source_page_id: str,
    source_title: str,
    job_id: str,
    model: str,
    sources: _PreparedSources,
    report: dict[str, object],
    dependencies: IngestionDependencies,
) -> None:
    manifest = dependencies.load_manifest(source_table_id, source_page_id)
    manifest.update(
        {
            "version": 2,
            "source_table_id": source_table_id,
            "resource_id": source_page_id,
            "resource_title": source_title,
            "updated_at": dependencies.clock(),
            "origins": sources.snapshots,
            "managed_keys": report["managed_keys"],
            "last_job_id": job_id,
            "model": model,
            "warnings": sources.warnings,
        }
    )
    dependencies.save_manifest(source_table_id, source_page_id, manifest)


def _checkpoint_plan(
    resume_checkpoint: dict[str, object] | None,
) -> dict[str, object] | None:
    raw_plan = resume_checkpoint.get("plan") if resume_checkpoint else None
    return cast(dict[str, object], raw_plan) if isinstance(raw_plan, dict) else None


def _plan_notes(plan: dict[str, object]) -> list[dict[str, object]]:
    raw_notes = plan.get("notes")
    return cast(list[dict[str, object]], raw_notes) if isinstance(raw_notes, list) else []


__all__ = ["IngestionDependencies", "IngestionPhases", "process_resource"]
