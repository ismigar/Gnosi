"""Endpoints for the AI meeting notetaker.

`POST /api/meetings/record` receives the audio recorded in the browser (webm/opus), saves it, and
launches the background job (local transcription + AI minutes + Vault page). The
frontend polls `GET /api/meetings/status` until it finishes and opens the page.
"""
import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.config.app_config import load_params
from backend.services import meeting_notes

router = APIRouter(prefix="/api/meetings", tags=["Meetings"])
log = logging.getLogger(__name__)


def _audio_dir() -> Path:
    cfg = load_params(strict_env=False)
    local_data = cfg.paths.get("LOCAL_DATA")
    base = Path(local_data) if local_data else (Path.home() / ".cache" / "gnosi")
    d = base / "cache" / "meetings"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/record")
async def record_meeting(  # type: ignore[no-untyped-def]
    audio: UploadFile = File(...),
    title: str = Form("Reunió"),
    mode: str = Form("presencial"),
):
    """Receives the audio, saves it, and starts background processing."""
    if meeting_notes.get_status().get("running"):
        raise HTTPException(status_code=409, detail="A meeting is already being processed.")

    dest = _audio_dir() / f"meeting_{uuid.uuid4().hex}.webm"
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="Àudio buit.")
        dest.write_bytes(data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save the audio: {e}")

    if not meeting_notes.start_async(str(dest), title, mode):
        raise HTTPException(status_code=409, detail="A meeting is already being processed.")
    return {"status": "started"}


@router.get("/status")
async def meeting_status():  # type: ignore[no-untyped-def]
    """Status of the in-flight job (polled from the frontend)."""
    return meeting_notes.get_status()
