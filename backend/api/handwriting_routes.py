"""Endpoint de reconeixement d'escriptura a mà (ink → text) LOCAL amb TrOCR.

`POST /api/vault/handwriting/recognize` rep una imatge PNG dels traços exportats
pel canvas de Tldraw i retorna el text reconegut. Tot local: la imatge no surt a
cap núvol (cf. `services/handwriting.py`).
"""
import asyncio
import logging
from typing import Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from backend.services import handwriting

router = APIRouter(prefix="/api/vault/handwriting", tags=["Handwriting"])
log = logging.getLogger(__name__)

# Límit de mida per protegir la CPU (el frontend exporta retalls, no llenços 4K).
_MAX_BYTES = 12 * 1024 * 1024  # 12 MB


@router.get("/status")
async def handwriting_status():
    """Indica si el motor local (transformers + PIL) està disponible."""
    return {
        "available": handwriting.is_available(),
        "loaded": handwriting.is_loaded(),
        "model": handwriting._model_id(),
    }


@router.post("/warmup")
async def handwriting_warmup():
    """Precarrega el model en segon pla (idempotent, no bloqueja).

    El frontend el crida en obrir el llenç perquè la 1a crida real de
    reconeixement no hagi d'esperar la càrrega del model (~1.3 GB el 1r cop).
    """
    started = handwriting.warmup()
    return {"warming": started, "loaded": handwriting.is_loaded()}


@router.post("/recognize")
async def recognize_handwriting(
    image: UploadFile = File(...),
    correct: Optional[bool] = Form(None),
    language: Optional[str] = Form(None),
):
    """Rep un PNG dels traços i retorna `{text, raw, lines, model, corrected}`.

    `correct` aplica correcció IA (accents/ortografia) amb l'LLM local; si és
    `None` s'usa el default de config. `language` és una pista opcional (ca/es/…).
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
        # TrOCR en CPU és feixuc i bloqueja: fora de l'event loop.
        result = await asyncio.to_thread(
            handwriting.recognize, data, True, correct, language
        )
    except Exception as e:
        log.exception("Error reconeixent escriptura a mà")
        raise HTTPException(status_code=500, detail=f"Error de reconeixement: {e}")

    return result
