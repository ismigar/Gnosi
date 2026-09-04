"""Typed Vault domain extracted from the historical route facade."""

import importlib as _legacy_importlib
from typing import TYPE_CHECKING, Never

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, JsonValue

from backend.domains.llm_wiki.lint_contracts import LintReport
from backend.domains.vault.knowledge.native_calls import capture_append
from backend.domains.vault.pages.foundation_values import PageMetadata
from backend.utils.open_values import get_value, iterable_values

if TYPE_CHECKING:
    from backend.api import vault_routes as _legacy
else:
    _legacy = _legacy_importlib.import_module("backend.api.vault_routes")
router: APIRouter = _legacy.router
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
    index_report: dict[str, object] | None = None


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

    indexes: dict[str, object]
    lint: LlmWikiLintReportResponse
    suggestions_queued: int
    suggestions_pending: int


class _ForwardCompatibleResponse(BaseModel):
    """Preserve future JSON fields while publishing today's known contract."""

    model_config = ConfigDict(extra="allow")


class LlmWikiEvidenceSegmentResponse(_ForwardCompatibleResponse):
    """One immutable normalized segment and its source locator."""

    id: JsonValue
    order: JsonValue | None = None
    text: JsonValue | None = None
    locator: JsonValue | None = None


class LlmWikiEvidenceResponse(_ForwardCompatibleResponse):
    """Persisted citation evidence resolved without exposing filesystem paths."""

    snapshot_id: JsonValue
    resource_id: JsonValue
    kind: JsonValue
    label: JsonValue
    source_url: JsonValue
    segment: LlmWikiEvidenceSegmentResponse


class LlmWikiNoteFindingResponse(_ForwardCompatibleResponse):
    id: str
    title: str


class LlmWikiStaleFindingResponse(LlmWikiNoteFindingResponse):
    review: str | None
    days: int | None


class LlmWikiMissingCrossReferenceResponse(LlmWikiNoteFindingResponse):
    should_link: str
    target_id: str


class LlmWikiReprocessCandidateResponse(LlmWikiNoteFindingResponse):
    processed: str
    modified: str


class LlmWikiDuplicateManagedKeyResponse(_ForwardCompatibleResponse):
    key: str
    notes: list[LlmWikiNoteFindingResponse]


class LlmWikiBrokenCitationResponse(LlmWikiNoteFindingResponse):
    resource_id: str
    snapshot_id: str
    segment_id: str


class LlmWikiResourceIndexDriftResponse(_ForwardCompatibleResponse):
    source_table_id: str
    resource_id: str


class LlmWikiLintCountsResponse(_ForwardCompatibleResponse):
    orphans: int
    stale: int
    missing_xref: int
    reprocess: int
    duplicate_keys: int
    stale_managed: int
    broken_cites: int
    index_drift: int


class LlmWikiLintResponse(_ForwardCompatibleResponse):
    """Complete deterministic Brain lint report and optional suggestion totals."""

    note_count: int
    orphans: list[LlmWikiNoteFindingResponse]
    stale: list[LlmWikiStaleFindingResponse]
    missing_xref: list[LlmWikiMissingCrossReferenceResponse]
    reprocess: list[LlmWikiReprocessCandidateResponse]
    duplicate_keys: list[LlmWikiDuplicateManagedKeyResponse]
    stale_managed: list[LlmWikiNoteFindingResponse]
    broken_cites: list[LlmWikiBrokenCitationResponse]
    index_drift: list[LlmWikiResourceIndexDriftResponse]
    counts: LlmWikiLintCountsResponse
    truncated_missing_xref: bool
    suggestions_queued: int | None = None
    suggestions_pending: int | None = None


class BrainSuggestionReadOnlyErrorResponse(BaseModel):
    """Permanent-note creation refusal returned by the retired accept route."""

    detail: str


class BrainSuggestionAcceptRequest(BaseModel):
    """Ignored legacy payload retained for the permanently read-only route."""

    model_config = ConfigDict(extra="allow")


class BrainSuggestionVariantResponse(BaseModel):
    label: str
    text: str


class BrainSuggestionVariantsResponse(BaseModel):
    variants: list[BrainSuggestionVariantResponse]


class BrainDictationResponse(BaseModel):
    transcript: str
    proposed: str
    corrected: bool


class BrainGlossaryResponse(BaseModel):
    pairs: int


class BrainGlossaryRequest(BaseModel):
    """User-confirmed correction pair with legacy endpoint coercion."""

    heard: object | None = None
    meant: object | None = None


def ensure_llm_wiki_column(reference_table_id: str) -> bool:
    """Add the `Processat pel Cervell` system date column when missing.

    Return True when the column was added.
    """
    if not reference_table_id:
        return False
    with _legacy.registry_mutation():
        reg = _legacy.load_registry()
        table = next(
            (
                t
                for t in iterable_values(reg.get("tables", []) or [])
                if get_value(t, "id") == reference_table_id
            ),
            None,
        )
        if not table:
            return False
        from operator import methodcaller

        props: object = methodcaller("setdefault", "properties", [])(table)
        append_property = capture_append(props)
        norm = LLM_WIKI_PROCESSED_COL.lower().replace(" ", "")
        if any(
            (
                str(get_value(p, "name") or "").lower().replace(" ", "") == norm
                for p in iterable_values(props)
            )
        ):
            return False
        append_property(
            {
                "id": str(_legacy.uuid.uuid4()),
                "name": LLM_WIKI_PROCESSED_COL,
                "type": "date",
                "system": True,
            },
        )
        _legacy.save_registry(reg)
        _legacy.log.info(
            "🧠 Column «%s» added to the Resources table %s",
            LLM_WIKI_PROCESSED_COL,
            reference_table_id,
        )
        return True


def _resource_processed_value(metadata: PageMetadata) -> str:
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
    metadata: PageMetadata,
    path: _legacy.Path,
    source_table: PageMetadata,
    source_config: PageMetadata,
) -> str:
    """Resolve a source title from its configured title property before UID fallbacks."""
    title_property_id = str(source_config.get("title_property_id") or "")
    title_property = next(
        (
            prop
            for prop in iterable_values(source_table.get("properties") or [])
            if str(get_value(prop, "id") or "") == title_property_id
        ),
        None,
    )
    title_property_name = str(get_value(title_property or {}, "name") or "")
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
) -> dict[str, object]:
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
) -> dict[str, object]:
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
    response_model=LlmWikiEvidenceResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_evidence(
    resource_id: str, snapshot_id: str, segment_id: str
) -> dict[str, object]:
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
async def llm_wiki_maintenance(semantic: bool = _legacy.Query(default=False)) -> dict[str, object]:
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
    response_model=LlmWikiLintResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_lint(suggest: bool = _legacy.Query(default=False)) -> LintReport:
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
async def llm_wiki_list_suggestions() -> dict[str, list[dict[str, object]]]:
    """Return pending read-only connection proposals for the Brain inbox."""
    from backend.services import llm_wiki_suggestions

    return {"suggestions": await _legacy.asyncio.to_thread(llm_wiki_suggestions.load_queue)}


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/accept",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainSuggestionReadOnlyErrorResponse,
    response_model_exclude_unset=True,
    responses={410: {"model": BrainSuggestionReadOnlyErrorResponse}},
)
async def llm_wiki_accept_suggestion(
    suggestion_id: str,
    payload: BrainSuggestionAcceptRequest | None = _legacy.Body(default=None),
) -> Never:
    """Permanent-note creation was removed; proposals are read-only."""
    raise _legacy.HTTPException(
        status_code=410, detail="Connection proposals cannot create permanent notes"
    )


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/reject",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainSuggestionRejectedResponse,
)
async def llm_wiki_reject_suggestion(suggestion_id: str) -> dict[str, str]:
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
async def llm_wiki_dismiss_suggestion(suggestion_id: str) -> dict[str, str]:
    """Dismiss a read-only connection proposal."""
    return await llm_wiki_reject_suggestion(suggestion_id)


@router.post(
    "/llm-wiki/suggestions/{suggestion_id}/reformulate",
    dependencies=[_legacy.Depends(_legacy.require_role("editor"))],
    response_model=BrainSuggestionVariantsResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_reformulate(suggestion_id: str) -> dict[str, list[dict[str, str]]]:
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
    response_model=BrainDictationResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_dictate(
    suggestion_id: str, audio: _legacy.UploadFile = _legacy.File(...)
) -> dict[str, object]:
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
    response_model=BrainGlossaryResponse,
    response_model_exclude_unset=True,
)
async def llm_wiki_glossary_learn(
    payload: BrainGlossaryRequest = _legacy.Body(...),
) -> dict[str, int]:
    """Stores a user-confirmed correction pair (heard → meant): the personal
    glossary the dictation corrector learns from."""
    from backend.services import llm_wiki_assist

    heard = str(payload.heard or "")
    meant = str(payload.meant or "")
    count = await _legacy.asyncio.to_thread(llm_wiki_assist.learn_pair, heard, meant)
    return {"pairs": count}
