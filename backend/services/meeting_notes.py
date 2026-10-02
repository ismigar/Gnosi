"""Private durable meeting jobs: local transcription, validated excerpts, canonical page.

Successful phases are checkpointed. Explicit continuation uses the original inputs
and page receipt, never a second write after an uncertain effect.
"""

from backend.services.agent_behavior import task_input
from backend.services.meeting_contracts import (LABELS, META_LABELS, WARNINGS, MINUTES_SCHEMA, meeting_language, parse_minutes, render_minutes, validate_minutes)
import asyncio
import logging
import os
import threading
import hashlib
from contextvars import ContextVar
from backend.services import agent_execution_store as meeting_store
from backend.services.agent_execution_scope import current_scope
from datetime import datetime
from pathlib import Path
from typing import Any
from backend.services.agent_execution_models import AgentExecutionSnapshot

log = logging.getLogger(__name__)

# Private live state is keyed by the same ownership boundary as durable jobs.
_states: dict[tuple[str, str, str], dict[str, Any]] = {}
_LOCK = threading.RLock()
_job_id: ContextVar[str] = ContextVar("meeting_job_id", default="")


def _state() -> dict[str, Any]:
    scope = current_scope()
    key = (scope.user_id, scope.workspace_id, scope.vault_path)
    with _LOCK:
        return _states.setdefault(key, {"running": False, "stage": "idle", "progress": 0,
            "error": None, "page_id": None, "title": None, "warning": None})


def _update_status(**changes: Any) -> None:
    with _LOCK:
        _state().update(changes)
        if _job_id.get():
            meeting_store.work_checkpoint(current_scope(), _job_id.get(), "meeting.status", dict(_state()))


def _checkpoint(key: str, value: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if not _job_id.get():
        return None
    return meeting_store.work_checkpoint(current_scope(), _job_id.get(), "meeting." + key, value)


def _ensure_active() -> None:
    if current_scope().role == "viewer":
        raise PermissionError("meeting_editor_required")
    if _job_id.get() and meeting_store.cancelled(current_scope(), _job_id.get()):
        from backend.services.agent_cancellation import AgentTurnCancelled
        raise AgentTurnCancelled("meeting_cancelled")


def get_status() -> dict[str, Any]:
    with _LOCK:
        run = meeting_store.latest_job(current_scope(), "meeting.minutes")
        if run is None:
            return dict(_state())
        status = meeting_store.work_checkpoint(current_scope(), run.run_id, "meeting.status") or dict(_state())
        status["job_id"] = run.run_id
        if run.status == "interrupted":
            status.update(running=False, stage="interrupted", error="meeting_worker_stopped")
        elif run.status == "failed":
            status.update(running=False, stage="error", error=run.error)
        elif run.status == "cancelled":
            status.update(running=False, stage="error", error="meeting_cancelled")
        elif run.status == "completed":
            status.update(running=False, stage="done", page_id=run.result)
        else:
            status["running"] = True
        status["can_resume"] = run.status in {"interrupted", "failed"} and meeting_store.work_checkpoint(current_scope(), run.run_id, "meeting.transcript") is not None
        return status


def _build_acta_prompt(title: str, transcript: str, language: str = "ca") -> str:
    return task_input("meeting.minutes", title=title, transcript=transcript, language=language)


def _acta_page_markdown(acta_md: str, transcript: str, meta_line: str, language: str = "ca") -> str:
    from html import escape
    transcript_block = escape(transcript)
    return (
        f"{meta_line}\n\n"
        f"{acta_md}\n\n"
        "---\n\n"
        f"<details>\n<summary>📝 {LABELS[language][8]}</summary>\n\n"
        f"<pre>{transcript_block}</pre>\n\n</details>\n"
    )


def _create_vault_page(title: str, content: str, metadata: dict[str, Any] | None = None) -> str:
    """Creates a page in the Vault reusing `create_page` (via asyncio.run).

    Bind the job's explicit workspace context and execute queued indexing tasks
    before reporting success. The job revalidates membership before calling this.
    """
    from fastapi import BackgroundTasks

    from backend.api.vault_routes import PageSaveRequest, create_page

    from backend.services.agent_execution_scope import current_scope
    from backend.services.workspace_service import WorkspaceContext
    scope = current_scope()
    context = WorkspaceContext(scope.workspace_id, scope.user_id, scope.role, Path(scope.vault_path))
    req = PageSaveRequest(title=title, content=content, metadata={"icon": "🎙️", **(metadata or {})})

    async def _run() -> dict[str, Any]:
        tasks = BackgroundTasks()
        from fastapi import HTTPException
        from backend.domains.vault.api.core_routes import recover_feature_page_creation
        key = "meeting-" + _job_id.get() if _job_id.get() else None
        try:
            result = dict(await create_page(req, tasks, context=context, idempotency_key=key))
        except HTTPException as exc:
            if key is None or exc.status_code != 409:
                raise
            result = await recover_feature_page_creation(context, key)
        await tasks()
        return result

    result = asyncio.run(_run())
    page_id = result.get("id")
    if not isinstance(page_id, str) or not page_id.strip():
        raise ValueError("Meeting page creation returned no page ID")
    return page_id


def process_meeting(audio_path: str, title: str, mode: str, language: str | None = None) -> dict[str, Any]:
    import uuid
    from backend.services.agent_execution import _snapshot, prepare_snapshot, create_job_run, operation_session
    from backend.services.agent_operation_catalog import skill_id
    from backend.services import agent_execution_store
    snapshot = _snapshot.get() or prepare_snapshot(skill_id("meeting"))
    run_id = _job_id.get() or uuid.uuid4().hex
    if not _job_id.get():
        snapshot = create_job_run(snapshot, run_id, "meeting.minutes")
    token = _job_id.set(run_id)
    try:
        with operation_session(snapshot):
            agent_execution_store.update(snapshot.scope, run_id, status="running")
            result = _process_meeting(audio_path, title, mode, requested_language=language)
            agent_execution_store.update(snapshot.scope, run_id,
                status="cancelled" if meeting_store.cancelled(snapshot.scope, run_id) else ("failed" if result.get("error") else "completed"),
                result=str(result.get("page_id") or ""), error=str(result.get("error") or ""))
            return result
    except BaseException as error:
        agent_execution_store.update(snapshot.scope, run_id, status="failed", error=str(error))
        raise
    finally:
        _job_id.reset(token)


def _process_meeting(
    audio_path: str,
    title: str,
    mode: str = "presencial",
    requested_language: str | None = None,
) -> dict[str, Any]:
    """Full job (intended to run in a background thread)."""
    from backend.services.transcription import transcribe

    safe_title = (title or "").strip() or "Meeting"
    try:
        # 1) Local transcription
        _ensure_active()
        _update_status(stage="transcribing", progress=10, error=None, page_id=None, warning=None, title=safe_title)
        result = _checkpoint("transcript")
        if result is None:
            inputs = _checkpoint("input")
            if inputs is not None and hashlib.sha256(Path(audio_path).read_bytes()).hexdigest() != inputs["audio_hash"]:
                raise ValueError("Meeting audio changed since recording")
            result = dict(transcribe(audio_path, language=requested_language) if requested_language else transcribe(audio_path))
        transcript = result.get("text") or ""
        if not isinstance(transcript, str) or not transcript.strip():
            raise ValueError("Empty meeting transcript")
        _checkpoint("transcript", result)
        language = meeting_language(result.get("language"))
        duration = result.get("duration", 0) or 0

        # 2) AI-generated minutes (degrades on failure)
        _update_status(stage="summarizing", progress=60)
        _ensure_active()
        saved_minutes = _checkpoint("minutes")
        acta_md = str(saved_minutes["body"]) if saved_minutes is not None else ""
        warning = saved_minutes.get("warning") if saved_minutes is not None else None
        if saved_minutes is None:
            try:
                from functools import partial
                from backend.services.agent_execution import generate_for

                generate_text = partial(generate_for, "meeting")
                acta_md, _ = generate_text(
                    _build_acta_prompt(safe_title, transcript, language), user_message=safe_title,
                    output_schema=MINUTES_SCHEMA,
                    output_validator=lambda text: validate_minutes(text, transcript)
                )
                acta_md = render_minutes(parse_minutes(acta_md, transcript), language)
            except Exception as e:
                from backend.services.agent_cancellation import AgentTurnCancelled
                if isinstance(e, (AgentTurnCancelled, PermissionError)):
                    raise
                acta_md = ""
                log.info(f"meeting_notes: AI minutes unavailable ({e}).")
        if not acta_md:
            warning = WARNINGS[language]
        _checkpoint("minutes", {"body": acta_md, "warning": warning})

        # 3) Vault page
        _update_status(stage="saving", progress=85)
        now = datetime.now()
        meta_labels = META_LABELS[language]
        meta_bits = [
            f"**{meta_labels[0]}:** {now.strftime('%Y-%m-%d %H:%M')}",
            f"**{meta_labels[1]}:** {meta_labels[2] if mode == 'online' else meta_labels[3]}",
        ]
        if duration:
            seconds = max(0, round(duration))
            duration_label = f"{seconds} s" if seconds < 60 else f"{seconds // 60} min {seconds % 60} s"
            meta_bits.append(f"**{meta_labels[4]}:** {duration_label}")
        if language:
            meta_bits.append(f"**{meta_labels[5]}:** {language}")
        meta_line = " · ".join(meta_bits)
        if warning:
            meta_line += f"\n\n> ⚠️ {warning}"
        page_title = f"{LABELS[language][9]} — {safe_title} ({now.strftime('%d/%m/%Y')})"
        content = _acta_page_markdown(acta_md, transcript, meta_line, language)

        from backend.services.agent_execution_scope import current_scope, revalidate_scope
        revalidate_scope(current_scope())
        _ensure_active()
        page = _checkpoint("page_input")
        if page is None:
            page = {"title": page_title, "content": content, "metadata": {
            "meeting_language": language, "meeting_transcript": transcript,
            "minutes_status": "unavailable" if warning else "validated",
            "minutes_warning": warning,
            }}
            _checkpoint("page_input", page)
        page_id = _create_vault_page(page["title"], page["content"], page["metadata"])
        _update_status(running=False, stage="done", progress=100, page_id=page_id, warning=warning)
        return {"page_id": page_id, "transcript_chars": len(transcript), "warning": warning}
    except Exception as e:
        log.error(f"meeting_notes: job failed: {e}", exc_info=True)
        _update_status(running=False, stage="error", error=str(e))
        return {"error": str(e)}
    finally:
        # Cleans up the temporary audio file (privacy + space).
        try:
            if audio_path and os.path.exists(audio_path):
                os.remove(audio_path)
        except Exception:
            pass


def _launch(snapshot: "AgentExecutionSnapshot", run_id: str, audio_path: str, title: str, mode: str, language: str | None = None) -> None:
    from contextvars import copy_context
    from backend.services.agent_execution import operation_session
    def worker() -> None:
        token = _job_id.set(run_id)
        try:
            with operation_session(snapshot):
                process_meeting(audio_path, title, mode, language)
        except Exception as error:
            with operation_session(snapshot):
                _update_status(running=False, stage="error", error=str(error))
                meeting_store.update(snapshot.scope, run_id, status="failed", error=str(error))
        finally:
            _job_id.reset(token)
    try:
        threading.Thread(target=copy_context().run, args=(worker,), daemon=True).start()
    except Exception as error:
        meeting_store.update(snapshot.scope, run_id, status="failed", error=str(error))
        raise


def start_async(audio_path: str, title: str, mode: str, language: str | None = None) -> bool:
    """Reserve the owner's durable job before launching its copied context."""
    import uuid
    from backend.services.agent_execution import prepare_snapshot, create_job_run
    from backend.services.agent_operation_catalog import skill_id
    from backend.services.agent_execution_scope import revalidate_scope
    scope = current_scope()
    if scope.role == "viewer":
        raise PermissionError("meeting_editor_required")
    if language is not None and language not in LABELS:
        raise ValueError("Unsupported meeting language")
    revalidate_scope(scope)
    with _LOCK:
        if get_status()["running"]:
            return False
        audio_hash = hashlib.sha256(Path(audio_path).read_bytes()).hexdigest()
        snapshot = prepare_snapshot(skill_id("meeting"))
        run_id = uuid.uuid4().hex
        try:
            snapshot = create_job_run(snapshot, run_id, "meeting.minutes")
        except ValueError as error:
            if str(error) == "meeting_already_running":
                return False
            raise
        try:
            meeting_store.work_checkpoint(scope, run_id, "meeting.input", {
                "audio_path": audio_path, "audio_hash": audio_hash,
                "title": title, "mode": mode, "language": language,
            })
            meeting_store.work_checkpoint(scope, run_id, "meeting.status", {
                "running": True, "stage": "transcribing", "progress": 5, "error": None,
                "page_id": None, "warning": None, "title": title,
            })
            _launch(snapshot, run_id, audio_path, title, mode, language)
        except Exception as error:
            meeting_store.update(scope, run_id, status="failed", error=str(error))
            raise
    return True


def resume_async(run_id: str) -> None:
    from backend.services.agent_execution_scope import revalidate_scope
    scope = current_scope()
    if scope.role == "viewer":
        raise PermissionError("meeting_editor_required")
    revalidate_scope(scope)
    with _LOCK:
        if get_status()["running"]:
            raise ValueError("meeting_already_running")
        inputs = meeting_store.work_checkpoint(scope, run_id, "meeting.input")
        if inputs is None:
            raise ValueError("meeting_original_input_unavailable")
        if meeting_store.work_checkpoint(scope, run_id, "meeting.transcript") is None:
            raise ValueError("meeting_transcript_not_saved")
        saved = meeting_store.claim_feature_job(scope, run_id, "meeting.minutes")
        snapshot = AgentExecutionSnapshot.model_validate(saved).model_copy(update={"parent_run_id": run_id})
        _launch(snapshot, run_id, str(inputs["audio_path"]), str(inputs["title"]), str(inputs["mode"]), inputs.get("language"))
