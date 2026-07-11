"""LOCAL handwriting recognition endpoint (ink → text) using TrOCR.

`POST /api/vault/handwriting/recognize` receives a PNG image of the strokes exported
by the Tldraw canvas and returns the recognized text. Fully local: the image never goes to
any cloud (cf. `services/handwriting.py`).
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.services import handwriting

router = APIRouter(prefix="/api/vault/handwriting", tags=["Handwriting"])
log = logging.getLogger(__name__)

# Size limit to protect the CPU (the frontend exports crops, not 4K canvases).
_MAX_BYTES = 12 * 1024 * 1024  # 12 MB


@router.get("/status")
async def handwriting_status():
    """Indicates whether the local engine (transformers + PIL) is available."""
    return {
        "available": handwriting.is_available(),
        "loaded": handwriting.is_loaded(),
        "model": handwriting._model_id(),
    }


@router.post("/warmup")
async def handwriting_warmup():
    """Preloads the model in the background (idempotent, non-blocking).

    The frontend calls this when opening the canvas so the 1st real
    recognition call doesn't have to wait for the model to load (~1.3 GB the first time).
    
    """
    started = handwriting.warmup()
    return {"warming": started, "loaded": handwriting.is_loaded()}


@router.post("/recognize")
async def recognize_handwriting(
    image: UploadFile = File(...),
    correct: Optional[bool] = Form(None),
    language: Optional[str] = Form(None),
):
    """Receives a PNG of the strokes and returns `{text, raw, lines, model, corrected}`.

    `correct` applies AI correction (accents/spelling) with the local LLM; if it's
    `None`, the config default is used. `language` is an optional hint (ca/es/…).
    
    """
    if not handwriting.is_available():
        raise HTTPException(
            status_code=503,
            detail="El motor de reconeixement local no està disponible (falta transformers/PIL).",
        )

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Imatge buida.")
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Imatge massa gran.")

    try:
        # TrOCR on CPU is heavy and blocking: keep it off the event loop.
        result = await asyncio.to_thread(
            handwriting.recognize, data, True, correct, language
        )
    except Exception as e:
        log.exception("Error reconeixent escriptura a mà")
        raise HTTPException(status_code=500, detail=f"Error de reconeixement: {e}")

    return result
