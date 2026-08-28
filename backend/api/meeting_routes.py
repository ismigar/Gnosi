"""Endpoints for the AI meeting notetaker.

`POST /api/meetings/record` receives the audio recorded in the browser (webm/opus), saves it, and
launches the background job (local transcription + AI minutes + Vault page). The
frontend polls `GET /api/meetings/status` until it finishes and opens the page.
"""

import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict

from backend.config.app_config import load_params
from backend.services import meeting_notes

router = APIRouter(prefix="/api/meetings", tags=["Meetings"])
log = logging.getLogger(__name__)


class MeetingStartResponse(BaseModel):
    status: str


class MeetingStatusResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    running: bool
    stage: str
    progress: int
    error: str | None = None
    page_id: str | None = None
    title: str | None = None


def _audio_dir() -> Path:
    cfg = load_params(strict_env=False)
    local_data = cfg.paths.get("LOCAL_DATA")
    base = Path(local_data) if local_data else (Path.home() / ".cache" / "gnosi")
    d = base / "cache" / "meetings"
    d.mkdir(parents=True, exist_ok=True)
    return d


@router.post("/record", response_model=None)
async def record_meeting(
    audio: UploadFile = File(...),
    title: str = Form("Reunió"),
    mode: str = Form("presencial"),
) -> dict[str, str]:
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
    return MeetingStartResponse(status="started").model_dump()


@router.get("/status", response_model=None)
async def meeting_status() -> dict[str, Any]:
    """Status of the in-flight job (polled from the frontend)."""
    return MeetingStatusResponse.model_validate(meeting_notes.get_status()).model_dump()
