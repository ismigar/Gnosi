"""Endpoint de reconeixement d'escriptura a mà (ink → text) LOCAL amb TrOCR.

`POST /api/vault/handwriting/recognize` rep una imatge PNG dels traços exportats
pel canvas de Tldraw i retorna el text reconegut. Tot local: la imatge no surt a
cap núvol (cf. `services/handwriting.py`).
"""
import asyncio
import logging

from fastapi import APIRouter, File, HTTPException, UploadFile

from backend.services import handwriting

router = APIRouter(prefix="/api/vault/handwriting", tags=["Handwriting"])
log = logging.getLogger(__name__)

# Límit de mida per protegir la CPU (el frontend exporta retalls, no llenços 4K).
_MAX_BYTES = 12 * 1024 * 1024  # 12 MB


@router.get("/status")
async def handwriting_status():
    """Indica si el motor local (transformers + PIL) està disponible."""
    return {"available": handwriting.is_available(), "model": handwriting._model_id()}


@router.post("/recognize")
async def recognize_handwriting(image: UploadFile = File(...)):
    """Rep un PNG dels traços i retorna `{text, lines, model}`."""
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
        result = await asyncio.to_thread(handwriting.recognize, data)
    except Exception as e:
        log.exception("Error reconeixent escriptura a mà")
        raise HTTPException(status_code=500, detail=f"Error de reconeixement: {e}")

    return result
