"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import Any as _LegacyAny
from typing import cast as _strict_cast

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

_legacy: _LegacyAny = _legacy_importlib.import_module("backend.api.vault_routes")
router = _strict_cast(APIRouter, _legacy.router)
LLM_WIKI_PROCESSED_COL = "Processat pel Cervell"


class BrainSuggestionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    title: str | None = None
    kind: str | None = None
    why: str | None = None
    evidence: list[str] | None = None
    member_ids: list[str] | None = None
    member_titles: list[str] | None = None


class BrainSuggestionListResponse(BaseModel):
    suggestions: list[BrainSuggestionResponse]


class BrainSuggestionRejectedResponse(BaseModel):
    rejected: str


class LlmWikiProcessRequest(BaseModel):
    """Compatible request body for starting one durable Brain ingest."""

    model_config = ConfigDict(extra="allow")

    resource_id: str = ""
    item_id: str = ""
    source_table_id: str = ""
    force: bool = False
    language: str = ""


class LlmWikiJobResponse(BaseModel):
    """Durable Brain-ingest state returned while a resource is processed."""

    model_config = ConfigDict(extra="allow")

    job_id: str | None = None
    source_table_id: str | None = None
    resource_id: str | None = None
    running: bool | None = None
    phase: str | None = None
    progress: int | None = None
    origins_total: int | None = None
    origins_done: int | None = None
    chunks_total: int | None = None
    chunks_done: int | None = None
    pages_touched: int | None = None
    created: list[str] | None = None
    updated: list[str] | None = None
    model: str | None = None
    warnings: list[str] | None = None
    error: str | None = None
    started_at: float | None = None
    updated_at: float | None = None
    finished_at: float | None = None
    index_report: dict[str, _LegacyAny] | None = None


class LlmWikiProcessStartResponse(BaseModel):
    """Acknowledgement and initial state for a newly started Brain ingest."""

    status: str
    item_id: str
    resource_id: str
    source_table_id: str
    job_id: str | None
    job: LlmWikiJobResponse


class LlmWikiLintReportResponse(BaseModel):
    """Deterministic Brain lint report with forward-compatible findings."""

    model_config = ConfigDict(extra="allow")

    note_count: int
    counts: dict[str, int]


class LlmWikiMaintenanceResponse(BaseModel):
    """Index, lint and suggestion totals returned by Brain maintenance."""

    indexes: dict[str, _LegacyAny]
    lint: LlmWikiLintReportResponse
    suggestions_queued: int
    suggestions_pending: int


def ensure_llm_wiki_column(reference_table_id: str) -> bool:
    """Add the `Processat pel Cervell` system date column when missing.

    Return True when the column was added.
    """
    if not reference_table_id:
        return False
    with _legacy.registry_mutation():
        reg = _legacy.load_registry()
        table = next(
            (t for t in reg.get("tables", []) or [] if t.get("id") == reference_table_id), None
        )
        if not table:
            return False
        props = table.setdefault("properties", [])
        norm = LLM_WIKI_PROCESSED_COL.lower().replace(" ", "")
        if any((str(p.get("name") or "").lower().replace(" ", "") == norm for p in props)):
            return False
        props.append(
            {
                "id": str(_legacy.uuid.uuid4()),
                "name": LLM_WIKI_PROCESSED_COL,
                "type": "date",
                "system": True,
            }
        )
        _legacy.save_registry(reg)
        _legacy.log.info(
            "🧠 Column «%s» added to the Resources table %s",
            LLM_WIKI_PROCESSED_COL,
            reference_table_id,
        )
        return True


def _resource_processed_value(metadata: dict[_LegacyAny, _LegacyAny]) -> str:
    """The `Processat pel Cervell` value in a row's metadata, or ''."""
    for k in (LLM_WIKI_PROCESSED_COL, LLM_WIKI_PROCESSED_COL.lower()):
        v = (metadata or {}).get(k)
        if v not in (None, "", [], {}):
            return str(v)
    return ""


def _llm_wiki_title_value(value: object) -> str:
    """Return one displayable title without serializing structured metadata."""
    if isinstance(value, list):
        value = next((item for item in value if item not in (None, "")), "")
    if isinstance(value, dict):
        value = next(
            (
                value.get(key)
                for key in ("title", "name", "label", "value")
                if value.get(key) not in (None, "")
            ),
            "",
        )
    return str(value or "").strip()


def _llm_wiki_source_title(
    metadata: dict[_LegacyAny, _LegacyAny],
    path: _legacy.Path,
    source_table: dict[_LegacyAny, _LegacyAny],
    source_config: dict[_LegacyAny, _LegacyAny],
) -> str:
    """Resolve a source title from its configured title property before UID fallbacks."""
    title_property_id = str(source_config.get("title_property_id") or "")
    title_property = next(
        (
            prop
            for prop in source_table.get("properties") or []
            if str(prop.get("id") or "") == title_property_id
        ),
        None,
    )
    title_property_name = str((title_property or {}).get("name") or "")
    candidates = [
        metadata.get(title_property_name) if title_property_name else None,
        metadata.get(title_property_id) if title_property_id else None,
        metadata.get("title"),
        metadata.get("Title"),
        path.stem,
    ]
    return next(
        (title for value in candidates if (title := _llm_wiki_title_value(value))), path.stem
    )


def mark_resource_processed(page_id: str, date_str: str) -> bool:
    """Write the ingest date to the resource's `Processat pel Cervell` column."""
    path = _legacy.find_page_path(page_id)
    if not path or not path.exists():
        return False
    raw = path.read_text(encoding="utf-8")
    metadata, body = _legacy.parse_frontmatter(raw, path)
    metadata[LLM_WIKI_PROCESSED_COL] = date_str
    _legacy.save_page_md(path, metadata, body)
    _legacy.register_page_in_index(path)
    return True


@router.post(
    "/llm-wiki/process",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=LlmWikiProcessStartResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_process(
    payload: LlmWikiProcessRequest = _legacy.Body(...),
) -> _LegacyAny:
    """Start a durable ingest for one row of a configured source table."""
    from backend.services.llm_wiki_actions import LlmWikiActionError, start_source_process

    try:
        return await _legacy.asyncio.to_thread(
            start_source_process,
            payload.resource_id or payload.item_id,
            source_table_id=payload.source_table_id,
            force=payload.force,
            language=payload.language,
        )
    except LlmWikiActionError as exc:
        raise _legacy.HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get(
    "/llm-wiki/status/{item_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=LlmWikiJobResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_status(
    item_id: str, source_table_id: str = _legacy.Query(default="")
) -> _LegacyAny:
    """Non-blocking status of a resource's ongoing/last ingest (for polling)."""
    from backend.services.llm_wiki_actions import LlmWikiActionError, process_status

    try:
        return await _legacy.asyncio.to_thread(
            process_status, item_id, source_table_id=source_table_id
        )
    except LlmWikiActionError as exc:
        raise _legacy.HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get(
    "/llm-wiki/evidence/{resource_id}/{snapshot_id}/{segment_id}",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def llm_wiki_evidence(resource_id: str, snapshot_id: str, segment_id: str) -> _LegacyAny:
    """Return one persisted normalized source segment for a citation drawer."""
    from backend.services import llm_wiki_storage

    evidence = await _legacy.asyncio.to_thread(
        llm_wiki_storage.load_evidence, resource_id, snapshot_id, segment_id
    )
    if not evidence:
        raise _legacy.HTTPException(status_code=404, detail="Citation evidence was not found")
    return evidence


@router.post(
    "/llm-wiki/maintenance",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=LlmWikiMaintenanceResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_maintenance(semantic: bool = _legacy.Query(default=False)) -> _LegacyAny:
    """Rebuild managed indexes/cache and run deterministic lint.

    ``semantic=true`` additionally runs the connection/contradiction proposal
    pass. Scheduled maintenance always uses the deterministic default.
    """
    from backend.services.llm_wiki_actions import LlmWikiActionError, run_maintenance_async

    try:
        return await run_maintenance_async(semantic=semantic)
    except LlmWikiActionError as exc:
        raise _legacy.HTTPException(status_code=exc.status_code, detail=exc.detail) from exc


@router.get(
    "/llm-wiki/lint",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def llm_wiki_lint(suggest: bool = _legacy.Query(default=False)) -> _LegacyAny:
    """Run deterministic lint and optionally request a manual semantic pass."""
    from backend.services import llm_wiki_config, llm_wiki_lint, llm_wiki_suggestions

    brain_table_id = llm_wiki_config.get_brain_table_id()
    if not brain_table_id:
        raise _legacy.HTTPException(status_code=400, detail="No Brain table has been designated")
    source_ids = llm_wiki_config.get_source_table_ids()
    report = await _legacy.asyncio.to_thread(llm_wiki_lint.run_lint, brain_table_id, source_ids)
    if suggest:
        report["suggestions_queued"] = await _legacy.asyncio.to_thread(
            llm_wiki_suggestions.generate_suggestions, brain_table_id
        )
    report["suggestions_pending"] = len(llm_wiki_suggestions.load_queue())
    return report


@router.get(
    "/llm-wiki/suggestions",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainSuggestionListResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_list_suggestions() -> _LegacyAny:
    """Return pending read-only connection proposals for the Brain inbox."""
    from backend.services import llm_wiki_suggestions

    return {"suggestions": await _legacy.asyncio.to_thread(llm_wiki_suggestions.load_queue)}


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/accept",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def llm_wiki_accept_suggestion(
    suggestion_id: str, payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(default=None)
) -> _LegacyAny:
    """Permanent-note creation was removed; proposals are read-only."""
    raise _legacy.HTTPException(
        status_code=410, detail="Connection proposals cannot create permanent notes"
    )


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/reject",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainSuggestionRejectedResponse,
)
async def llm_wiki_reject_suggestion(suggestion_id: str) -> _LegacyAny:
    """Discards a pending suggestion (no note is created)."""
    from backend.services import llm_wiki_suggestions

    sug = await _legacy.asyncio.to_thread(llm_wiki_suggestions.pop_suggestion, suggestion_id)
    if not sug:
        raise _legacy.HTTPException(
            status_code=404, detail="Suggestion not found; it may already be resolved"
        )
    return {"rejected": suggestion_id}


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/dismiss",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainSuggestionRejectedResponse,
)
async def llm_wiki_dismiss_suggestion(suggestion_id: str) -> _LegacyAny:
    """Dismiss a read-only connection proposal."""
    return await llm_wiki_reject_suggestion(suggestion_id)


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/reformulate",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def llm_wiki_reformulate(suggestion_id: str) -> _LegacyAny:
    """Labeled variants of a suggestion's draft, to pick with one click."""
    from backend.services import llm_wiki_assist, llm_wiki_suggestions

    sug = await _legacy.asyncio.to_thread(llm_wiki_suggestions.get_suggestion, suggestion_id)
    if not sug:
        raise _legacy.HTTPException(
            status_code=404, detail="Suggestion not found; it may be resolved"
        )
    try:
        variants = await _legacy.asyncio.to_thread(llm_wiki_assist.reformulate, sug)
    except Exception as exc:
        _legacy.log.warning(f"llm-wiki reformulate unavailable: {exc}")
        raise _legacy.HTTPException(
            status_code=503,
            detail="AI is unavailable for rewriting; check the API key in Settings → AI",
        )
    return {"variants": variants}


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/dictate",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def llm_wiki_dictate(
    suggestion_id: str, audio: _legacy.UploadFile = _legacy.File(...)
) -> _LegacyAny:
    """Dictated edit for a suggestion: transcribe (faster-whisper) and
    reconstruct the intent with the note's context + personal glossary.
    The result is a PROPOSAL ("Did you mean…?") — the frontend never applies it
    without the user's confirmation."""
    import tempfile

    from backend.services import llm_wiki_assist, llm_wiki_suggestions, transcription

    sug = await _legacy.asyncio.to_thread(llm_wiki_suggestions.get_suggestion, suggestion_id)
    if not sug:
        raise _legacy.HTTPException(
            status_code=404, detail="Suggestion not found; it may be resolved"
        )
    if not transcription.is_available():
        raise _legacy.HTTPException(
            status_code=503, detail="Transcription is unavailable (faster-whisper is not installed)"
        )
    data = await audio.read()
    if not data:
        raise _legacy.HTTPException(status_code=400, detail="Empty audio")
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(data)
        tmp_path = tmp.name
    try:
        result = await _legacy.asyncio.to_thread(transcription.transcribe, tmp_path)
    finally:
        try:
            _legacy.Path(tmp_path).unlink(missing_ok=True)
        except OSError:
            pass
    transcript = (result or {}).get("text") or ""
    if not transcript.strip():
        raise _legacy.HTTPException(
            status_code=400, detail="No words were understood from the dictation; try again"
        )
    return await _legacy.asyncio.to_thread(llm_wiki_assist.correct_dictation, sug, transcript)


@router.post(
    "/llm-wiki/glossary",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=None,
)
async def llm_wiki_glossary_learn(
    payload: dict[_LegacyAny, _LegacyAny] = _legacy.Body(...),
) -> _LegacyAny:
    """Stores a user-confirmed correction pair (heard → meant): the personal
    glossary the dictation corrector learns from."""
    from backend.services import llm_wiki_assist

    heard = str((payload or {}).get("heard") or "")
    meant = str((payload or {}).get("meant") or "")
    count = await _legacy.asyncio.to_thread(llm_wiki_assist.learn_pair, heard, meant)
    return {"pairs": count}
