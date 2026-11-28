"""Offline publication of already extracted and jointly reviewed reading notes.

When all source chunks have been interpreted and all joint-review groups have
passed validation, but optional individual independent-audit refinements remain
pending (for instance after provider credit exhaustion), the operator can
publish the saved notes directly to the Brain with zero AI calls and zero cost.
"""

from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import cast

from backend.config.logger_config import get_logger
from backend.domains.llm_wiki import ingestion as llm_wiki_ingestion
from backend.domains.llm_wiki import legacy_ports
from backend.domains.llm_wiki.audit_groups import review_passages
from backend.domains.llm_wiki.chunking import reading_chunk_budget, reading_chunks, records
from backend.domains.llm_wiki.contextual_reading import ContextualReader, fingerprint
from backend.domains.llm_wiki.independent_review import _finding
from backend.domains.llm_wiki.reading_identity import job_identity
from backend.domains.llm_wiki.reading_quality import REVIEW_QUALITY_VERSION
from backend.domains.llm_wiki.review_selection import passage_key
from backend.domains.llm_wiki.semantic_reading import SemanticReader
from backend.domains.llm_wiki.semantic_review import review_plans
from backend.domains.llm_wiki.source_structure import document_key
from backend.domains.vault.registry.records import is_record
from backend.utils.metadata_io import read_metadata_text
from backend.utils.open_values import iterable_values

logger = get_logger(__name__)


def _no_ai_call(*_args: object, **_kwargs: object) -> tuple[str, str]:
    raise RuntimeError("AI calls are disabled when publishing saved review notes")


def _restore_knowledge_shifted_reviews(
    state: dict[str, object],
    resume_job_id: str,
    load_checkpoint: object,
) -> bool:
    from collections.abc import Callable

    if not state.get("knowledge_context_changed") or not resume_job_id:
        return False
    loader = cast(Callable[[str, str], object], load_checkpoint)
    raw = loader(resume_job_id, "semantic-state")
    if not isinstance(raw, dict) or raw.get("review_quality_version") != REVIEW_QUALITY_VERSION:
        return False
    for field in ("reviewed_groups", "reviewed_ranges", "review_sources", "independent_reviews"):
        if field in raw and not state.get(field):
            state[field] = raw[field]
    return True


def _build_offline_plan(
    *,
    origins: list[dict[str, object]],
    chunks: list[dict[str, object]],
    source_title: str,
    language: str,
    brain_index: list[dict[str, object]],
    ai_dimensions: list[dict[str, object]],
    resume_job_id: str,
    execution_revision: str,
    input_budget: int,
    count_tokens: object,
    reviewer: object,
    legacy_reader_revision: object,
) -> dict[str, object]:
    from collections.abc import Callable
    from backend.services import llm_wiki, llm_wiki_config, llm_wiki_extractors, llm_wiki_pdf_annotations, llm_wiki_storage

    token_counter = cast(Callable[[str], int], count_tokens)
    rev_runtime = cast(llm_wiki_ingestion.ReviewRuntime | None, reviewer)
    legacy_rev = cast(Callable[[str], str] | None, legacy_reader_revision)

    deps = llm_wiki_ingestion.IngestionDependencies(
        load_config=llm_wiki_config.load_config,
        source_config=llm_wiki_config.get_source_config,
        table_by_id=legacy_ports.table_by_id,
        update_job=lambda *_a, **_kw: None,
        extract_sources=llm_wiki_extractors.extract_resource_sources,
        save_snapshot=llm_wiki_storage.save_snapshot,
        chunk_origins=lambda _o: chunks,
        load_brain_index=lambda *_a: brain_index,
        dimension_context=llm_wiki._dimension_context,  # noqa: SLF001
        build_prompt=llm_wiki._build_chunk_prompt,  # noqa: SLF001
        generate_text=_no_ai_call,
        generate_structured=_no_ai_call,
        generate_prose=_no_ai_call,
        batch_size=4,
        expected_reading_identity="",
        execution_revision=execution_revision,
        semantic_reading=True,
        execution_metadata={},
        reviewer=rev_runtime,
        legacy_reader_revision=legacy_rev,
        input_budget=input_budget,
        count_tokens=token_counter,
        parse_plan=llm_wiki._parse_plan,  # noqa: SLF001
        save_checkpoint=lambda *_a: None,
        load_checkpoint=llm_wiki_storage.load_checkpoint,
        resume_candidates=llm_wiki_storage.resume_checkpoint_jobs,
        resume_job_status=llm_wiki_storage.get_job_status,
        reduce_plans=llm_wiki._validate_and_reduce_plans,  # noqa: SLF001
        apply_plan=llm_wiki._apply_plan,  # noqa: SLF001
        sync_annotations=llm_wiki_pdf_annotations.sync_generated_pdf_annotations,
        citation_issues=llm_wiki_pdf_annotations.reading_citation_issues,
        pdf_quote_excerpts=llm_wiki_pdf_annotations.reading_pdf_quote_excerpts,
        load_manifest=llm_wiki_storage.load_manifest,
        save_manifest=llm_wiki_storage.save_manifest,
        clock=time.time,
        logger=logger,
        phases=llm_wiki_ingestion.IngestionPhases(
            reading=llm_wiki.PHASE_READING,
            planning=llm_wiki.PHASE_PLANNING,
            writing=llm_wiki.PHASE_WRITING,
        ),
    )
    creader = ContextualReader(
        deps, chunks, origins, source_title, language, brain_index, ai_dimensions, "", resume_job_id,
    )
    sreader = SemanticReader(creader)
    knowledge_shifted = _restore_knowledge_shifted_reviews(
        sreader.state, creader.resume_job_id, llm_wiki_storage.load_checkpoint,
    )
    plans = sreader.state.get("plans")
    if not isinstance(plans, dict) or any(str(c["id"]) not in plans for c in chunks):
        raise RuntimeError("Saved checkpoint does not cover all source fragments")
    if sreader.state.get("review_drafts") or sreader.state.get("pending_review_groups"):
        raise RuntimeError("Joint review is not complete in the saved checkpoint")
    global_map = str(sreader.state.get("global_map") or "").strip()
    notes_map = str(sreader.state.get("notes_map") or "").strip()
    if not global_map or not notes_map:
        raise RuntimeError("Saved checkpoint is missing its source or note maps")

    reviewed = review_plans(sreader, global_map, notes_map, checkpoints_only=True)
    saved_audits = sreader.state.get("independent_reviews")
    if isinstance(saved_audits, dict) and saved_audits:
        cases = review_passages(sreader, reviewed)
        doc_nums = {
            str(s["id"]): num
            for num, origin in enumerate(origins, start=1)
            for s in records(origin.get("segments"))
        }
        for case in cases:
            saved = saved_audits.get(case.receipt, saved_audits.get(passage_key(case.primary), {}))
            if isinstance(saved, dict) and isinstance(saved.get("answer"), dict):
                _finding(creader, case, saved["answer"], doc_nums)

    pending_audits = sreader.state.get("pending_audits")
    skipped = len(pending_audits) if isinstance(pending_audits, dict) else 0
    notes, reduce_warnings = llm_wiki._validate_and_reduce_plans(reviewed, origins, ai_dimensions)  # noqa: SLF001
    warnings = [*sreader.reader.warnings, *reduce_warnings]
    if skipped:
        warnings.append(
            f"Published from saved review with {skipped} pending independent-audit passage(s) skipped by operator."
        )
    if knowledge_shifted:
        warnings.append(
            "Published using the Brain index captured during the saved joint review."
        )
    summary = str(sreader.state.get("independent_synthesis") or global_map)
    return {
        "summary": summary,
        "notes": notes,
        "warnings": warnings,
        "reviewed": False,
        "operator_published": True,
        "quality_review_version": REVIEW_QUALITY_VERSION,
        "coverage": [
            {**row, "chunk_id": chunk["id"]}
            for chunk, plan in reviewed
            for row in records(plan.get("coverage"))
        ],
    }


def _resolve_source_language(
    requested: str,
    metadata: dict[str, object],
    source_table: dict[str, object],
    source_config: dict[str, object],
) -> str:
    resolved = str(requested or "").strip()
    if resolved:
        return resolved
    lang_prop_id = str(source_config.get("language_property_id") or "")
    lang_prop = next(
        (
            p for p in iterable_values(source_table.get("properties") or [])
            if is_record(p) and str(p.get("id") or "") == lang_prop_id
        ),
        None,
    )
    if lang_prop:
        resolved = str(
            metadata.get(str(lang_prop.get("name") or "")) or metadata.get(lang_prop_id) or ""
        ).strip()
    return resolved or "the main language detected in the source"


def _execute_publish_worker(
    *,
    item_id: str,
    source_title: str,
    metadata: dict[str, object],
    body: str,
    brain_table_id: str,
    vault_root: Path,
    resolved_language: str,
    resolved_table_id: str,
    source_table: dict[str, object],
    source_config: dict[str, object],
    job_id: str,
    resume_job_id: str,
    job_snapshot: object,
    review_runtime: object,
    budget_id: str,
    active_vault: Path | None,
) -> None:
    from backend.services import (
        agent_execution_store,
        context_vars as cv,
        llm_wiki,
        llm_wiki_config,
        llm_wiki_extractors,
        llm_wiki_indices,
        llm_wiki_storage,
        reading_budget,
    )
    from backend.services.agent_execution import operation_session
    from backend.services.agent_execution_models import AgentExecutionSnapshot
    from backend.services.llm_wiki_reading_runtime import ReadingRuntime, prepare_reading_runtime

    snap = cast(AgentExecutionSnapshot, job_snapshot)
    rev_runtime = cast(ReadingRuntime | None, review_runtime)
    token = None
    try:
        if active_vault is not None:
            token = cv.active_vault_path.set(active_vault)
        with operation_session(snap):
            agent_execution_store.update(snap.scope, job_id, status="running")
            runtime = prepare_reading_runtime(vault_root)
            origins, _ = llm_wiki_extractors.extract_resource_sources(
                metadata, body, vault_root, source_table, source_config,
            )
            for origin in origins:
                descriptor = llm_wiki_storage.save_snapshot(resolved_table_id, item_id, origin)
                origin["snapshot_id"] = descriptor["snapshot_id"]
            cap = min(runtime.input_budget, rev_runtime.input_budget) if rev_runtime else runtime.input_budget
            chunks = reading_chunks(origins, budget=reading_chunk_budget(cap), count=runtime.count_tokens)
            brain_index = llm_wiki._load_brain_index(brain_table_id, item_id)  # noqa: SLF001
            source_dims, ai_dims = llm_wiki._dimension_context(  # noqa: SLF001
                llm_wiki_config.load_config(), source_table, source_config, metadata,
            )
            offline_plan = _build_offline_plan(
                origins=origins,
                chunks=chunks,
                source_title=source_title,
                language=resolved_language,
                brain_index=brain_index,
                ai_dimensions=ai_dims,
                resume_job_id=resume_job_id,
                execution_revision=runtime.identity,
                input_budget=runtime.input_budget,
                count_tokens=runtime.count_tokens,
                reviewer=rev_runtime,
                legacy_reader_revision=getattr(runtime, "compatible_legacy_revision", None),
            )
            rev_id = rev_runtime.identity if rev_runtime else ""
            reading_revision = job_identity(
                fingerprint([
                    runtime.identity, source_title, resolved_language,
                    source_dims, ai_dims, brain_index, chunks,
                    [document_key(origin) for origin in origins],
                ]),
                rev_id,
            )
            resume_checkpoint: dict[str, object] = {
                "plan": offline_plan,
                "reading_revision": reading_revision,
                "origin_hashes": [str(origin.get("content_hash") or "") for origin in origins],
                "model": runtime.model,
            }
            report = llm_wiki.process_resource(
                item_id, source_title, metadata, body, brain_table_id, vault_root, resolved_language,
                source_table_id=resolved_table_id, source_table=source_table, source_config=source_config,
                job_id=job_id, resume_checkpoint=resume_checkpoint, resume_job_id=resume_job_id,
                reuse_results=True, review_runtime=rev_runtime,
            )
            llm_wiki_storage.update_job(job_id, phase=llm_wiki.PHASE_INDEXING, progress=90)
            index_report = llm_wiki_indices.rebuild_indexes(brain_table_id, llm_wiki_config.load_config())
            report["index_report"] = index_report
            llm_wiki_indices.append_log(
                brain_table_id, resource_title=source_title, resource_id=item_id,
                source_table_id=resolved_table_id, report=report,
            )
            llm_wiki._on_ingest_success(item_id, resolved_table_id, report)  # noqa: SLF001
            llm_wiki_storage.finish_job(
                job_id,
                phase=llm_wiki.PHASE_DONE,
                pages_touched=report["pages_touched"],
                created=report["created"],
                updated=report["updated"],
                model=report["model"],
                warnings=report["warnings"],
                reviewed=report.get("reviewed", False),
                review_completed=report.get("review_completed", False),
                quality_review_version=report.get("quality_review_version"),
                quality_status=report.get("quality_status", "needs_review"),
                coverage=report.get("coverage", []),
                index_report=index_report,
            )
    except Exception as exc:  # noqa: BLE001
        from backend.domains.llm_wiki.recovery import processing_error_message
        error_message = processing_error_message(exc)
        logger.exception("llm_wiki offline publish failed for %s: %s", item_id, error_message)
        status = llm_wiki_storage.get_job_status(job_id)
        llm_wiki_storage.finish_job(
            job_id, phase=llm_wiki.PHASE_PARTIAL, error=error_message, progress=status.get("progress", 0),
        )
    finally:
        final_status = llm_wiki_storage.get_job_status(job_id)
        agent_execution_store.update(
            snap.scope,
            job_id,
            status="completed" if final_status.get("phase") == llm_wiki.PHASE_DONE else "failed",
            error=str(final_status.get("error") or ""),
        )
        if budget_id:
            try:
                llm_wiki_storage.update_job(job_id, budget=reading_budget.status(budget_id))
            except Exception:  # noqa: BLE001
                pass
        if token is not None:
            cv.active_vault_path.reset(token)


def start_publish_saved_review(
    resource_id: str,
    *,
    source_table_id: str = "",
    language: str = "",
) -> dict[str, object]:
    """Launch an AI-free background job that writes validated saved notes to the Brain."""
    from backend.api import vault_routes as legacy_vault_routes
    from backend.domains.llm_wiki.reading_skill import SKILL_ID
    from backend.services import context_vars as cv, llm_wiki, llm_wiki_config, llm_wiki_storage
    from backend.services.agent_execution import create_job_run, prepare_snapshot
    from backend.services.llm_wiki_actions import LlmWikiActionError, VaultActionsPort, _source_page_path
    from backend.services.llm_wiki_reading_runtime import prepare_review_runtime

    vr = cast(VaultActionsPort, legacy_vault_routes)
    if not vr._llm_wiki_enabled(vr._load_plugins_state()):  # noqa: SLF001
        raise LlmWikiActionError(409, "The LLM Wiki plugin is disabled")
    item_id = str(resource_id or "").strip()
    if not item_id:
        raise LlmWikiActionError(400, "resource_id is required")
    config = llm_wiki_config.load_config()
    brain_table_id = str(config.get("brain_table_id") or "")
    if not brain_table_id or not vr._table_by_id(brain_table_id):  # noqa: SLF001
        raise LlmWikiActionError(400, "No valid Brain table is configured")
    path = _source_page_path(vr, item_id)
    if not path or not path.exists():
        raise LlmWikiActionError(404, f"Resource {item_id} was not found")
    metadata, body = vr.parse_frontmatter(read_metadata_text(path, encoding="utf-8"), path)
    resolved_table_id = str(source_table_id or metadata.get("table_id") or "").strip()
    source_config = llm_wiki_config.get_source_config(resolved_table_id)
    source_table = vr._table_by_id(resolved_table_id)  # noqa: SLF001
    if not source_config or not source_table:
        raise LlmWikiActionError(400, "This row is not in a configured source table")
    if llm_wiki.is_running(item_id, resolved_table_id):
        raise LlmWikiActionError(409, "Resource processing is already running")

    previous = llm_wiki_storage.get_job_status(item_id, resolved_table_id)
    resume_job_id = str(previous.get("job_id") or "").strip()
    if not resume_job_id or previous.get("phase") not in {llm_wiki.PHASE_PARTIAL, llm_wiki.PHASE_ERROR}:
        raise LlmWikiActionError(409, "No resumable checkpoint was found for this resource")

    resolved_language = _resolve_source_language(language, metadata, source_table, source_config)
    source_title = vr._llm_wiki_source_title(metadata, path, source_table, source_config)  # noqa: SLF001
    vault_root = Path(vr.get_p("VAULT"))

    snapshot = prepare_snapshot(SKILL_ID)
    if Path(snapshot.scope.vault_path).resolve() != vault_root.resolve():
        raise LlmWikiActionError(403, "agent_execution_vault_mismatch")
    review_runtime = prepare_review_runtime(vault_root, snapshot) if snapshot.behavior_resources else None
    budget_id = str(previous.get("budget_id") or "")

    job = llm_wiki_storage.create_job(resolved_table_id, item_id)
    job_id = str(job["job_id"])
    batch_val = previous.get("batch_size")
    llm_wiki_storage.update_job(
        job_id,
        budget_id=budget_id,
        batch_size=batch_val if isinstance(batch_val, int) else 4,
        resume_lineage=previous.get("resume_lineage") or resume_job_id,
    )
    job_snapshot = create_job_run(snapshot, job_id, "knowledge.process-source")
    if review_runtime:
        review_runtime.snapshot = review_runtime.snapshot.model_copy(update={"parent_run_id": job_id})
    active_vault = cv.get_active_vault_path()

    from contextvars import copy_context

    worker_context = copy_context()
    threading.Thread(
        target=lambda: worker_context.run(
            lambda: _execute_publish_worker(
                item_id=item_id,
                source_title=source_title,
                metadata=metadata,
                body=body,
                brain_table_id=brain_table_id,
                vault_root=vault_root,
                resolved_language=resolved_language,
                resolved_table_id=resolved_table_id,
                source_table=source_table,
                source_config=source_config,
                job_id=job_id,
                resume_job_id=resume_job_id,
                job_snapshot=job_snapshot,
                review_runtime=review_runtime,
                budget_id=budget_id,
                active_vault=active_vault,
            )
        ),
        name=f"llm-wiki-publish-{job_id[:8]}",
        daemon=True,
    ).start()
    return {
        "status": "started",
        "item_id": item_id,
        "resource_id": item_id,
        "source_table_id": resolved_table_id,
        "job_id": job_id,
        "job": llm_wiki_storage.get_job_status(job_id),
    }
