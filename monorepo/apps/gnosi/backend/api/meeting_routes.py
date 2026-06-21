"""Endpoints del prenedor d'actes de reunions amb IA.

`POST /api/meetings/record` rep l'àudio gravat al navegador (webm/opus), el desa i
llança el job de fons (transcripció local + acta IA + pàgina del Vault). El
frontend consulta `GET /api/meetings/status` fins que acaba i obre la pàgina.
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
async def record_meeting(
    audio: UploadFile = File(...),
    title: str = Form("Reunió"),
    mode: str = Form("presencial"),
):
    """Rep l'àudio, el desa i engega el processament en segon pla."""
    if meeting_notes.get_status().get("running"):
        raise HTTPException(status_code=409, detail="Ja s'està processant una reunió.")

    dest = _audio_dir() / f"meeting_{uuid.uuid4().hex}.webm"
    try:
        data = await audio.read()
        if not data:
            raise HTTPException(status_code=400, detail="Àudio buit.")
        dest.write_bytes(data)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"No s'ha pogut desar l'àudio: {e}")

    if not meeting_notes.start_async(str(dest), title, mode):
        raise HTTPException(status_code=409, detail="Ja s'està processant una reunió.")
    return {"status": "started"}


@router.get("/status")
async def meeting_status():
    """Estat del job en vol (poll des del frontend)."""
    return meeting_notes.get_status()
