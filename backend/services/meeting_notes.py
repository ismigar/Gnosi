"""AI-powered meeting minutes taker orchestrator.

Flow of a job (one in flight): audio → LOCAL transcription (faster-whisper) → MINUTES with
AI (principal Agent) → Vault page. Degrades gracefully: if the AI
fails (invalid keys), the page is still saved with the transcription + a warning.

Single-job global state, `audio_summarizer.generation_status`-style (queried
from `GET /api/meetings/status`).
"""

from backend.services.agent_behavior import task_input
import asyncio
import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

log = logging.getLogger(__name__)

# Job state (one in flight). stage: idle|transcribing|summarizing|saving|done|error
job_status = {
    "running": False,
    "stage": "idle",
    "progress": 0,
    "error": None,
    "page_id": None,
    "title": None,
}
_LOCK = threading.Lock()


def get_status() -> dict[str, Any]:
    return dict(job_status)


def _build_acta_prompt(title: str, transcript: str) -> str:
    return task_input("meeting.minutes", title=title, transcript=transcript)


def _acta_page_markdown(acta_md: str, transcript: str, meta_line: str) -> str:
    transcript_block = transcript or "(empty transcript)"
    return (
        f"{meta_line}\n\n"
        f"{acta_md}\n\n"
        "---\n\n"
        "<details>\n<summary>📝 Full transcript</summary>\n\n"
        f"{transcript_block}\n\n</details>\n"
    )


def _create_vault_page(title: str, content: str) -> Optional[str]:
    """Creates a page in the Vault reusing `create_page` (via asyncio.run).

    `create_page` is async and normally runs in a request context; here
    we invoke it directly from the job's thread with a new event loop. For
    a simple page (no table) it doesn't need request state: it writes the .md
    to the WIKI folder and inserts the page into the index inline.
    
    """
    from fastapi import BackgroundTasks

    from backend.api.vault_routes import PageSaveRequest, create_page

    req = PageSaveRequest(title=title, content=content, metadata={"icon": "🎙️"})

    async def _run() -> dict[str, Any]:
        return dict(await create_page(req, BackgroundTasks()))

    result = asyncio.run(_run())
    return (result or {}).get("id")


def process_meeting(audio_path: str, title: str, mode: str) -> dict[str, Any]:
    import uuid
    from backend.services.agent_execution import _snapshot, prepare_snapshot, create_job_run, operation_session
    from backend.services.agent_operation_catalog import skill_id
    from backend.services import agent_execution_store
    snapshot = _snapshot.get() or prepare_snapshot(skill_id("meeting"))
    run_id = uuid.uuid4().hex
    snapshot = create_job_run(snapshot, run_id, "meeting.minutes")
    with operation_session(snapshot):
        agent_execution_store.update(snapshot.scope, run_id, status="running")
        try:
            result = _process_meeting(audio_path, title, mode)
            agent_execution_store.update(snapshot.scope, run_id,
                status="failed" if result.get("error") else "completed",
                result=str(result.get("page_id") or ""), error=str(result.get("error") or ""))
            return result
        except BaseException as error:
            agent_execution_store.update(snapshot.scope, run_id, status="failed", error=str(error))
            raise


def _process_meeting(
    audio_path: str,
    title: str,
    mode: str = "presencial",
) -> dict[str, Any]:
    """Full job (intended to run in a background thread)."""
    from backend.services.transcription import transcribe

    safe_title = (title or "").strip() or "Meeting"
    try:
        # 1) Local transcription
        job_status.update({"stage": "transcribing", "progress": 10, "error": None})
        result = transcribe(audio_path)
        transcript = (result.get("text") or "").strip()
        language = result.get("language")
        duration = result.get("duration", 0) or 0

        # 2) AI-generated minutes (degrades on failure)
        job_status.update({"stage": "summarizing", "progress": 60})
        acta_md = ""
        if transcript:
            try:
                from functools import partial
                from backend.services.agent_execution import generate_for

                generate_text = partial(generate_for, "meeting")
                acta_md, _ = generate_text(
                    _build_acta_prompt(safe_title, transcript), user_message=safe_title
                )
                acta_md = (acta_md or "").strip()
            except Exception as e:
                log.info(f"meeting_notes: AI minutes unavailable ({e}).")
        if not acta_md:
            acta_md = (
                "> ⚠️ AI could not generate the minutes (check Settings › AI). "
                "The full transcript appears below."
            )

        # 3) Vault page
        job_status.update({"stage": "saving", "progress": 85})
        now = datetime.now()
        meta_bits = [
            f"**Date:** {now.strftime('%Y-%m-%d %H:%M')}",
            f"**Mode:** {'Online' if mode == 'online' else 'In person'}",
        ]
        if duration:
            meta_bits.append(f"**Duration:** ~{int(duration // 60)} min")
        if language:
            meta_bits.append(f"**Idioma:** {language}")
        meta_line = " · ".join(meta_bits)
        page_title = f"Acta — {safe_title} ({now.strftime('%d/%m/%Y')})"
        content = _acta_page_markdown(acta_md, transcript, meta_line)

        from backend.services.agent_execution_scope import current_scope, revalidate_scope
        revalidate_scope(current_scope())
        page_id = _create_vault_page(page_title, content)
        job_status.update(
            {"running": False, "stage": "done", "progress": 100, "page_id": page_id}
        )
        return {"page_id": page_id, "transcript_chars": len(transcript)}
    except Exception as e:
        log.error(f"meeting_notes: job failed: {e}", exc_info=True)
        job_status.update({"running": False, "stage": "error", "error": str(e)})
        return {"error": str(e)}
    finally:
        # Cleans up the temporary audio file (privacy + space).
        try:
            if audio_path and os.path.exists(audio_path):
                os.remove(audio_path)
        except Exception:
            pass


def start_async(audio_path: str, title: str, mode: str) -> bool:
    """Launches the job in a daemon thread. Returns False if one is already in flight."""
    from backend.services.agent_execution import prepare_snapshot, operation_session
    from backend.services.agent_operation_catalog import skill_id
    snapshot = prepare_snapshot(skill_id("meeting"))
    with _LOCK:
        if job_status["running"]:
            return False
        job_status.update({
            "running": True, "stage": "transcribing", "progress": 5,
            "error": None, "page_id": None, "title": (title or "").strip() or "Reunió",
        })
    def worker() -> None:
        try:
            with operation_session(snapshot):
                process_meeting(audio_path, title, mode)
        except Exception as error:
            job_status.update(running=False, stage="error", error=str(error))
    from contextvars import copy_context
    threading.Thread(target=copy_context().run, args=(worker,), daemon=True).start()
    return True
