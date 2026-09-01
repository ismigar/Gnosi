"""AI-powered meeting minutes taker orchestrator.

Flow of a job (one in flight): audio → LOCAL transcription (faster-whisper) → MINUTES with
AI (`factory.generate_text`) → Vault page. Degrades gracefully: if the AI
fails (invalid keys), the page is still saved with the transcription + a warning.

Single-job global state, `audio_summarizer.generation_status`-style (queried
from `GET /api/meetings/status`).
"""
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
    return (
        "You are an assistant who writes MEETING MINUTES. From the TRANSCRIPT, "
        "write clear, structured Markdown minutes in the SAME language as the "
        "transcript. Use EXACTLY these sections, translated into that language:\n"
        "## Summary\n(2–4 sentences)\n\n"
        "## Topics discussed\n(bullet points)\n\n"
        "## Decisions\n(bullet points; if there are none, write “No decisions recorded”)\n\n"
        "## Tasks and agreements\n(bullet points with owner and date when stated: "
        "`- [ ] Task — Owner (date)`)\n\n"
        "## Next steps\n(bullet points)\n\n"
        "Do NOT include the transcript or anything outside these sections.\n\n"
        f"Meeting title: {title}\n\n--- TRANSCRIPT ---\n{transcript}"
    )


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


def process_meeting(
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
                from backend.agent.factory import generate_text
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
    with _LOCK:
        if job_status["running"]:
            return False
        job_status.update({
            "running": True, "stage": "transcribing", "progress": 5,
            "error": None, "page_id": None, "title": (title or "").strip() or "Reunió",
        })
    threading.Thread(
        target=process_meeting, args=(audio_path, title, mode), daemon=True
    ).start()
    return True
