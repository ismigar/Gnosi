"""Vault-native systematic-review records, blind decisions, and exports."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, cast

from fastapi import BackgroundTasks, HTTPException

from backend.domains.literature import review_logic
from backend.services.context_vars import active_vault_path, get_primary_vault_path
from backend.services.literature_models import deterministic_key
from backend.services.workspace_service import ROLE_WEIGHTS, WorkspaceContext


REVIEWS_TABLE_ID = "gnosi_literature_reviews"
ACTIVITIES_TABLE_ID = "gnosi_literature_activities"
CANDIDATES_TABLE_ID = "gnosi_literature_candidates"
DECISIONS_TABLE_ID = "gnosi_literature_decisions"

TABLE_SPECS: tuple[dict[str, Any], ...] = (
    {
        "id": REVIEWS_TABLE_ID,
        "name": "Literature Reviews",
        "folder": "Literature Reviews",
        "properties": (
            ("Question", "text"),
            ("Protocol", "text"),
            ("Eligibility Criteria", "text"),
            ("Reviewer Mode", "select"),
            ("Reviewers", "text"),
            ("Status", "select"),
            ("Configuration", "text"),
        ),
    },
    {
        "id": ACTIVITIES_TABLE_ID,
        "name": "Literature Activities",
        "folder": "Literature Activities",
        "properties": (
            ("Review ID", "text"),
            ("Activity Type", "select"),
            ("Version", "number"),
            ("Strategy", "text"),
            ("Exact Queries", "text"),
            ("Source Snapshot", "text"),
            ("Errors", "text"),
            ("Counts", "text"),
            ("AI Audit", "text"),
            ("Export Format", "text"),
            ("Occurred At", "date"),
        ),
    },
    {
        "id": CANDIDATES_TABLE_ID,
        "name": "Literature Candidates",
        "folder": "Literature Candidates",
        "properties": (
            ("Review ID", "text"),
            ("Work Key", "text"),
            ("Work Snapshot", "text"),
            ("Sources", "text"),
            ("Identifiers", "text"),
            ("Phase", "select"),
            ("Full Text", "select"),
            ("Resource ID", "text"),
            ("Activity ID", "text"),
            ("Conflict", "checkbox"),
        ),
    },
    {
        "id": DECISIONS_TABLE_ID,
        "name": "Literature Decisions",
        "folder": "Literature Decisions",
        "properties": (
            ("Review ID", "text"),
            ("Candidate ID", "text"),
            ("Reviewer ID", "text"),
            ("Phase", "select"),
            ("Decision", "select"),
            ("Reason", "text"),
            ("Notes", "text"),
            ("Decided At", "date"),
            ("Replaces Decision ID", "text"),
            ("Resolution", "checkbox"),
        ),
    },
)

PHASES = {
    "identified",
    "title_abstract",
    "full_text_requested",
    "full_text_assessed",
    "included",
    "excluded",
}
DECISIONS = {"include", "exclude", "uncertain"}
REVIEWER_MODES = {"single", "dual_blind"}
FULL_TEXT_STATUSES = {
    "not_requested",
    "requested",
    "available_oa",
    "attached",
    "unavailable",
    "assessed",
}


_now = review_logic.now_iso
_json = review_logic.json_text
_decode = review_logic.decode


async def ensure_tables() -> dict[str, str]:
    """Create all four managed tables idempotently in the Principal vault."""
    from backend.api.vault_routes import create_table, load_registry

    primary = get_primary_vault_path()
    token = active_vault_path.set(primary) if primary else None
    try:
        load_registry_typed = cast(Callable[[], dict[str, Any]], load_registry)
        create_table_typed = cast(Callable[[dict[str, Any]], Any], create_table)
        existing = {table.get("id") for table in load_registry_typed().get("tables", [])}
        for spec in TABLE_SPECS:
            if spec["id"] in existing:
                continue
            await create_table_typed(
                {
                    "id": spec["id"],
                    "name": spec["name"],
                    "folder": spec["folder"],
                    "database_id": "gnosi_vault_db",
                    "schema_source": {"kind": "managed", "domain": "literature", "version": 1},
                    "properties": [
                        {"id": f"{spec['id']}:{index}", "name": name, "type": field_type}
                        for index, (name, field_type) in enumerate(spec["properties"], start=1)
                    ],
                }
            )
        return {spec["name"]: spec["id"] for spec in TABLE_SPECS}
    finally:
        if token is not None:
            active_vault_path.reset(token)


def _with_primary() -> Any:
    primary = get_primary_vault_path()
    return active_vault_path.set(primary) if primary else None


def _reset_primary(token: Any) -> None:
    if token is not None:
        active_vault_path.reset(token)


async def _create_record(
    *,
    table_id: str,
    title: str,
    metadata: dict[str, Any],
    content: str,
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> dict[str, Any]:
    from backend.api.vault_routes import PageSaveRequest, create_page

    token = _with_primary()
    try:
        payload = {"database_table_id": table_id, "table_id": table_id, **metadata}
        request_factory = cast(Callable[..., Any], PageSaveRequest)
        create_page_typed = cast(Callable[..., Any], create_page)
        return cast(
            dict[str, Any],
            await create_page_typed(
                request_factory(title=title, content=content, metadata=payload),
                background_tasks,
                context,
            ),
        )
    finally:
        _reset_primary(token)


async def _patch_record(
    page_id: str,
    metadata: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> dict[str, Any]:
    from backend.api.vault_routes import PagePatchRequest, patch_page

    token = _with_primary()
    try:
        request_factory = cast(Callable[..., Any], PagePatchRequest)
        patch_page_typed = cast(Callable[..., Any], patch_page)
        return cast(
            dict[str, Any],
            await patch_page_typed(
                page_id,
                request_factory(metadata=metadata),
                background_tasks,
                context,
            ),
        )
    finally:
        _reset_primary(token)


def _records(table_id: str) -> list[dict[str, Any]]:
    from backend.api.vault_routes import _resolve_table_folder_from_metadata, parse_frontmatter

    token = _with_primary()
    try:
        resolve_folder = cast(
            Callable[[dict[str, Any]], Path | None],
            _resolve_table_folder_from_metadata,
        )
        parse_frontmatter_typed = cast(
            Callable[[str, Path], tuple[dict[str, Any], str]], parse_frontmatter
        )
        folder = resolve_folder({"database_table_id": table_id})
        if not folder or not folder.exists():
            return []
        rows: list[dict[str, Any]] = []
        for path in folder.glob("*.md"):
            try:
                metadata, content = parse_frontmatter_typed(path.read_text(encoding="utf-8"), path)
            except Exception:  # noqa: BLE001
                continue
            if str(metadata.get("database_table_id") or metadata.get("table_id")) != table_id:
                continue
            rows.append({**metadata, "content": content, "_path": str(path)})
        return rows
    finally:
        _reset_primary(token)


def _record(table_id: str, page_id: str) -> dict[str, Any]:
    row = next((item for item in _records(table_id) if str(item.get("id")) == str(page_id)), None)
    if row is None:
        raise HTTPException(status_code=404, detail="Literature review record not found.")
    return row


_review_public = review_logic.review_public


async def create_review(
    payload: dict[str, Any], background_tasks: BackgroundTasks, context: WorkspaceContext
) -> dict[str, Any]:
    await ensure_tables()
    question = " ".join(str(payload.get("question") or "").split()).strip()[:2_000]
    title = " ".join(str(payload.get("title") or question or "Literature review").split()).strip()[
        :300
    ]
    if not question:
        raise HTTPException(status_code=400, detail="A review question is required.")
    mode = str(payload.get("reviewer_mode") or "single")
    if mode not in REVIEWER_MODES:
        raise HTTPException(status_code=400, detail="Reviewer mode must be single or dual_blind.")
    reviewers = list(
        dict.fromkeys(str(item) for item in payload.get("reviewers") or [] if str(item))
    )
    if context.user_id not in reviewers:
        reviewers.insert(0, context.user_id)
    required = 2 if mode == "dual_blind" else 1
    if len(reviewers) < required:
        raise HTTPException(
            status_code=400, detail="Dual-blind reviews require two assigned reviewers."
        )
    if mode == "dual_blind" and len(reviewers) != 2:
        raise HTTPException(
            status_code=400, detail="Dual-blind reviews require exactly two assigned reviewers."
        )
    metadata = {
        "Question": question,
        "Protocol": str(payload.get("protocol") or "")[:50_000],
        "Eligibility Criteria": _json(
            payload.get("criteria") if isinstance(payload.get("criteria"), dict) else {}
        ),
        "Reviewer Mode": mode,
        "Reviewers": _json(reviewers[:20]),
        "Status": "draft",
        "Configuration": _json(
            payload.get("configuration") if isinstance(payload.get("configuration"), dict) else {}
        ),
    }
    created = await _create_record(
        table_id=REVIEWS_TABLE_ID,
        title=title,
        metadata=metadata,
        content=metadata["Protocol"],
        background_tasks=background_tasks,
        context=context,
    )
    return _review_public(
        created.get("metadata") or {**metadata, "id": created.get("id"), "title": title}
    )


def list_reviews() -> list[dict[str, Any]]:
    rows = [_review_public(row) for row in _records(REVIEWS_TABLE_ID)]
    return sorted(
        rows,
        key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""),
        reverse=True,
    )


def get_review(review_id: str) -> dict[str, Any]:
    return _review_public(_record(REVIEWS_TABLE_ID, review_id))


async def append_activity(
    review_id: str,
    activity_type: str,
    payload: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> dict[str, Any]:
    await ensure_tables()
    review = get_review(review_id)
    activities = [
        row
        for row in _records(ACTIVITIES_TABLE_ID)
        if str(row.get("Review ID")) == review_id and str(row.get("Activity Type")) == activity_type
    ]
    version = max([int(row.get("Version") or 0) for row in activities] or [0]) + 1
    occurred = _now()
    metadata = {
        "Review ID": review_id,
        "Activity Type": str(activity_type)[:100],
        "Version": version,
        "Strategy": _json(payload.get("strategy") or {}),
        "Exact Queries": _json(payload.get("exact_queries") or {}),
        "Source Snapshot": _json(payload.get("source_snapshot") or []),
        "Errors": _json(payload.get("errors") or []),
        "Counts": _json(payload.get("counts") or {}),
        "AI Audit": _json(payload.get("ai_audit") or {}),
        "Export Format": str(payload.get("export_format") or "")[:100],
        "Occurred At": occurred,
    }
    title = f"{review['title']} · {activity_type} · v{version}"
    created = await _create_record(
        table_id=ACTIVITIES_TABLE_ID,
        title=title,
        metadata=metadata,
        content=str(payload.get("notes") or ""),
        background_tasks=background_tasks,
        context=context,
    )
    return {"id": created.get("id"), **metadata}


async def update_configuration(
    review_id: str,
    patch: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> dict[str, Any]:
    """Merge scheduling or workflow settings without replacing the protocol."""
    row = _record(REVIEWS_TABLE_ID, review_id)
    configuration = _decode(row.get("Configuration"), {})
    configuration.update(patch if isinstance(patch, dict) else {})
    await _patch_record(
        review_id, {"Configuration": _json(configuration)}, background_tasks, context
    )
    return {**_review_public(row), "configuration": configuration}


def list_activities(review_id: str) -> list[dict[str, Any]]:
    get_review(review_id)
    rows = [row for row in _records(ACTIVITIES_TABLE_ID) if str(row.get("Review ID")) == review_id]
    return [
        {
            "id": row.get("id"),
            "title": row.get("title"),
            "review_id": review_id,
            "activity_type": row.get("Activity Type"),
            "version": row.get("Version"),
            "strategy": _decode(row.get("Strategy"), {}),
            "exact_queries": _decode(row.get("Exact Queries"), {}),
            "source_snapshot": _decode(row.get("Source Snapshot"), []),
            "errors": _decode(row.get("Errors"), []),
            "counts": _decode(row.get("Counts"), {}),
            "ai_audit": _decode(row.get("AI Audit"), {}),
            "export_format": row.get("Export Format"),
            "occurred_at": row.get("Occurred At"),
            "notes": row.get("content") or "",
        }
        for row in sorted(rows, key=lambda item: str(item.get("Occurred At") or ""), reverse=True)
    ]


def _candidate_public(row: dict[str, Any]) -> dict[str, Any]:
    work = _decode(row.get("Work Snapshot"), {})
    evidence = work.pop("_review_full_text", {}) if isinstance(work, dict) else {}
    return {
        "id": row.get("id"),
        "title": row.get("title") or work.get("title"),
        "review_id": row.get("Review ID"),
        "work_key": row.get("Work Key"),
        "work": work,
        "sources": _decode(row.get("Sources"), []),
        "identifiers": _decode(row.get("Identifiers"), {}),
        "phase": row.get("Phase") or "identified",
        "full_text": row.get("Full Text") or "not_requested",
        "full_text_evidence": evidence,
        "resource_id": row.get("Resource ID") or None,
        "activity_id": row.get("Activity ID") or None,
        "conflict": bool(row.get("Conflict")),
    }


async def add_candidates(
    review_id: str,
    works: Iterable[dict[str, Any]],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
    activity_id: str = "",
) -> dict[str, Any]:
    await ensure_tables()
    get_review(review_id)
    existing = {
        _candidate_public(row)["work_key"]: _candidate_public(row)
        for row in _records(CANDIDATES_TABLE_ID)
        if str(row.get("Review ID")) == review_id
    }
    added: list[dict[str, Any]] = []
    reused: list[dict[str, Any]] = []
    for work in list(works)[:1_000]:
        if not isinstance(work, dict):
            continue
        key = deterministic_key(work) or f"result:{work.get('id') or uuid.uuid4().hex}"
        if key in existing:
            reused.append(existing[key])
            continue
        metadata = {
            "Review ID": review_id,
            "Work Key": key,
            "Work Snapshot": _json(work),
            "Sources": _json(work.get("sources") or []),
            "Identifiers": _json(work.get("identifiers") or {}),
            "Phase": "title_abstract",
            "Full Text": "not_requested",
            "Resource ID": work.get("resource_id") or "",
            "Activity ID": activity_id,
            "Conflict": False,
        }
        created = await _create_record(
            table_id=CANDIDATES_TABLE_ID,
            title=str(work.get("title") or "Untitled academic work")[:500],
            metadata=metadata,
            content=str(work.get("abstract") or ""),
            background_tasks=background_tasks,
            context=context,
        )
        candidate = _candidate_public(
            {**metadata, "id": created.get("id"), "title": work.get("title")}
        )
        existing[key] = candidate
        added.append(candidate)
    return {
        "added": added,
        "existing": reused,
        "added_count": len(added),
        "existing_count": len(reused),
    }


def _decision_public(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row.get("id"),
        "review_id": row.get("Review ID"),
        "candidate_id": row.get("Candidate ID"),
        "reviewer_id": row.get("Reviewer ID"),
        "phase": row.get("Phase"),
        "decision": row.get("Decision"),
        "reason": row.get("Reason") or "",
        "notes": row.get("Notes") or row.get("content") or "",
        "decided_at": row.get("Decided At"),
        "replaces_decision_id": row.get("Replaces Decision ID") or None,
        "resolution": bool(row.get("Resolution")),
    }


def _candidate_decisions(candidate_id: str) -> list[dict[str, Any]]:
    rows = [
        _decision_public(row)
        for row in _records(DECISIONS_TABLE_ID)
        if str(row.get("Candidate ID")) == candidate_id
    ]
    return sorted(rows, key=lambda row: str(row.get("decided_at") or ""))


_current_by_reviewer = review_logic.current_by_reviewer


def list_candidates(
    review_id: str, context: WorkspaceContext, phase: str = ""
) -> list[dict[str, Any]]:
    review = get_review(review_id)
    rows = [
        _candidate_public(row)
        for row in _records(CANDIDATES_TABLE_ID)
        if str(row.get("Review ID")) == review_id
    ]
    if phase:
        rows = [row for row in rows if row["phase"] == phase]
    for candidate in rows:
        decisions = _candidate_decisions(candidate["id"])
        current = _current_by_reviewer(decisions, candidate["phase"])
        if review["reviewer_mode"] == "dual_blind" and len(current) < 2:
            candidate["decisions"] = [
                decision for decision in decisions if decision["reviewer_id"] == context.user_id
            ]
            candidate["blind_pending"] = True
        else:
            candidate["decisions"] = decisions
            candidate["blind_pending"] = False
    return rows


_next_phase = review_logic.next_phase
_prisma_svg = review_logic._prisma_svg


async def submit_decision(
    review_id: str,
    candidate_id: str,
    payload: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> dict[str, Any]:
    await ensure_tables()
    review = get_review(review_id)
    candidate_row = _record(CANDIDATES_TABLE_ID, candidate_id)
    candidate = _candidate_public(candidate_row)
    if candidate["review_id"] != review_id:
        raise HTTPException(status_code=404, detail="Candidate does not belong to this review.")
    if (
        context.user_id not in review["reviewers"]
        and ROLE_WEIGHTS.get(context.role.lower(), 0) < ROLE_WEIGHTS["admin"]
    ):
        raise HTTPException(status_code=403, detail="You are not assigned as a reviewer.")
    phase = str(payload.get("phase") or candidate["phase"])
    decision = str(payload.get("decision") or "")
    if phase not in PHASES or decision not in DECISIONS:
        raise HTTPException(status_code=400, detail="Invalid screening phase or decision.")
    if phase != candidate["phase"]:
        raise HTTPException(
            status_code=409, detail="The candidate moved to another screening phase."
        )
    reason = " ".join(str(payload.get("reason") or "").split()).strip()[:4_000]
    if decision == "exclude" and not reason:
        raise HTTPException(status_code=400, detail="An exclusion reason is required.")
    previous = _current_by_reviewer(_candidate_decisions(candidate_id), phase).get(context.user_id)
    metadata: dict[str, Any] = {
        "Review ID": review_id,
        "Candidate ID": candidate_id,
        "Reviewer ID": context.user_id,
        "Phase": phase,
        "Decision": decision,
        "Reason": reason,
        "Notes": str(payload.get("notes") or "")[:20_000],
        "Decided At": _now(),
        "Replaces Decision ID": previous["id"] if previous else "",
        "Resolution": False,
    }
    created = await _create_record(
        table_id=DECISIONS_TABLE_ID,
        title=f"{candidate['title']} · {context.user_id} · {decision}",
        metadata=metadata,
        content=str(metadata["Notes"]),
        background_tasks=background_tasks,
        context=context,
    )
    current = _current_by_reviewer(_candidate_decisions(candidate_id), phase)
    current[context.user_id] = {
        "id": created.get("id"),
        **metadata,
        "reviewer_id": context.user_id,
        "decision": decision,
    }
    conflict = False
    advance = False
    resolved_decision = decision
    if review["reviewer_mode"] == "dual_blind":
        assigned = review["reviewers"][:2]
        if all(reviewer in current for reviewer in assigned):
            values = {current[reviewer]["decision"] for reviewer in assigned}
            conflict = len(values) > 1 or "uncertain" in values
            advance = not conflict
            resolved_decision = next(iter(values)) if len(values) == 1 else "uncertain"
    else:
        advance = decision != "uncertain"
        conflict = decision == "uncertain"
    patch: dict[str, Any] = {"Conflict": conflict}
    if advance:
        patch["Phase"] = _next_phase(phase, resolved_decision)
    await _patch_record(candidate_id, patch, background_tasks, context)
    return {
        "decision": {"id": created.get("id"), **metadata},
        "phase": patch.get("Phase", phase),
        "conflict": conflict,
        "blind_released": review["reviewer_mode"] != "dual_blind" or len(current) >= 2,
    }


async def resolve_conflict(
    review_id: str,
    candidate_id: str,
    payload: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> dict[str, Any]:
    review = get_review(review_id)
    candidate = _candidate_public(_record(CANDIDATES_TABLE_ID, candidate_id))
    if candidate["review_id"] != review_id or not candidate["conflict"]:
        raise HTTPException(
            status_code=409, detail="Candidate has no unresolved screening conflict."
        )
    decision = str(payload.get("decision") or "")
    if decision not in {"include", "exclude"}:
        raise HTTPException(status_code=400, detail="Conflict resolution must include or exclude.")
    if (
        context.user_id not in review["reviewers"]
        and ROLE_WEIGHTS.get(context.role.lower(), 0) < ROLE_WEIGHTS["admin"]
    ):
        raise HTTPException(status_code=403, detail="You cannot resolve this review conflict.")
    reason = " ".join(str(payload.get("reason") or "").split()).strip()[:4_000]
    if decision == "exclude" and not reason:
        raise HTTPException(status_code=400, detail="An exclusion reason is required.")
    metadata: dict[str, Any] = {
        "Review ID": review_id,
        "Candidate ID": candidate_id,
        "Reviewer ID": context.user_id,
        "Phase": candidate["phase"],
        "Decision": decision,
        "Reason": reason or "Conflict resolution",
        "Notes": str(payload.get("notes") or "")[:20_000],
        "Decided At": _now(),
        "Replaces Decision ID": "",
        "Resolution": True,
    }
    created = await _create_record(
        table_id=DECISIONS_TABLE_ID,
        title=f"{candidate['title']} · conflict resolution · {decision}",
        metadata=metadata,
        content=str(metadata["Notes"]),
        background_tasks=background_tasks,
        context=context,
    )
    next_phase = _next_phase(candidate["phase"], decision)
    await _patch_record(
        candidate_id, {"Conflict": False, "Phase": next_phase}, background_tasks, context
    )
    return {
        "decision": {"id": created.get("id"), **metadata},
        "phase": next_phase,
        "conflict": False,
    }


_verified_oa_location = review_logic.verified_oa_location


async def update_full_text(
    review_id: str,
    candidate_id: str,
    payload: dict[str, Any],
    background_tasks: BackgroundTasks,
    context: WorkspaceContext,
) -> dict[str, Any]:
    """Record a manual full-text workflow transition with verifiable evidence."""
    get_review(review_id)
    row = _record(CANDIDATES_TABLE_ID, candidate_id)
    candidate = _candidate_public(row)
    if candidate["review_id"] != review_id:
        raise HTTPException(status_code=404, detail="Candidate does not belong to this review.")
    status = str(payload.get("status") or "")
    if status not in FULL_TEXT_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid full-text status.")
    resource_id = str(payload.get("resource_id") or candidate.get("resource_id") or "").strip()[
        :160
    ]
    location_url = str(payload.get("location_url") or "").strip()[:4_000]
    evidence: dict[str, Any] = {
        "status": status,
        "location_url": location_url,
        "license": str(payload.get("license") or "")[:500],
        "resource_id": resource_id,
        "notes": str(payload.get("notes") or "")[:20_000],
        "recorded_at": _now(),
        "recorded_by": context.user_id,
    }
    if status == "available_oa":
        verified = _verified_oa_location(candidate["work"], location_url)
        if verified is None:
            raise HTTPException(
                status_code=400,
                detail="Open-access availability must match a provider-verified canonical location.",
            )
        evidence.update(verified)
        if not evidence["license"]:
            evidence["license"] = verified["license"]
    if status == "attached" and not resource_id:
        raise HTTPException(
            status_code=400, detail="An attached full text requires a Resources record identifier."
        )
    previous_status = candidate.get("full_text") or "not_requested"
    if status == "assessed" and previous_status not in {"available_oa", "attached", "assessed"}:
        raise HTTPException(
            status_code=409,
            detail="Full text must be available or attached before it can be assessed.",
        )
    stored_work = dict(candidate["work"])
    stored_work["_review_full_text"] = evidence
    patch: dict[str, Any] = {"Full Text": status, "Work Snapshot": _json(stored_work)}
    if resource_id:
        patch["Resource ID"] = resource_id
    if status in {"requested", "available_oa", "attached", "unavailable"} and candidate[
        "phase"
    ] in {"identified", "title_abstract"}:
        patch["Phase"] = "full_text_requested"
    elif status == "assessed" and candidate["phase"] in {
        "identified",
        "title_abstract",
        "full_text_requested",
    }:
        patch["Phase"] = "full_text_assessed"
    await _patch_record(candidate_id, patch, background_tasks, context)
    activity = await append_activity(
        review_id,
        "full_text_status",
        {
            "counts": {"candidate_id": candidate_id, "from": previous_status, "to": status},
            "notes": _json(evidence),
        },
        background_tasks,
        context,
    )
    return {
        **candidate,
        "phase": patch.get("Phase", candidate["phase"]),
        "full_text": status,
        "full_text_evidence": evidence,
        "resource_id": resource_id or None,
        "activity_id": activity.get("id"),
    }


def review_audit(review_id: str, context: WorkspaceContext) -> dict[str, Any]:
    review = get_review(review_id)
    candidates = list_candidates(review_id, context)
    decisions = [
        _decision_public(row)
        for row in _records(DECISIONS_TABLE_ID)
        if str(row.get("Review ID")) == review_id
    ]
    activities = list_activities(review_id)
    return {
        "schema_version": 1,
        "generated_at": _now(),
        "review": review,
        "activities": activities,
        "candidates": candidates,
        "decisions": decisions,
        "prisma": prisma_counts(candidates, decisions, activities),
    }


def prisma_counts(
    candidates: list[dict[str, Any]],
    decisions: list[dict[str, Any]],
    activities: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return review_logic.prisma_counts(candidates, decisions, activities)


def export_review(
    review_id: str, export_format: str, context: WorkspaceContext
) -> tuple[bytes, str, str]:
    return review_logic.render_export(review_audit(review_id, context), export_format)
