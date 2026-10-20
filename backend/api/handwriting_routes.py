"""LOCAL handwriting recognition endpoint (ink → text) using TrOCR.

`POST /api/vault/handwriting/recognize` receives a PNG image of the strokes exported
by the Tldraw canvas and returns the recognized text. Fully local: the image never goes to
any cloud (cf. `services/handwriting.py`).
"""

import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, JsonValue

from backend.services import handwriting
from backend.services.handwriting_download import DownloadCancelled

router = APIRouter(prefix="/api/vault/handwriting", tags=["Handwriting"])
log = logging.getLogger(__name__)

# Size limit to protect the CPU (the frontend exports crops, not 4K canvases).
_MAX_BYTES = 12 * 1024 * 1024  # 12 MB


class HandwritingStatusResponse(BaseModel):
    available: bool
    loaded: bool
    model: str
    downloaded: bool = False
    state: Literal['not_downloaded', 'downloaded', 'downloading', 'loading', 'ready', 'cancelled', 'failed'] = 'not_downloaded'
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    error: str = ''
    cancelling: bool = False


class HandwritingDownloadCancellationResponse(BaseModel):
    cancelling: bool


class HandwritingWarmupResponse(BaseModel):
    warming: bool
    loaded: bool


class HandwritingRecognitionResponse(BaseModel):
    text: str
    raw: str
    lines: list[str]
    model: str
    corrected: bool


@router.get("/status", response_model=HandwritingStatusResponse)
async def handwriting_status() -> dict[str, JsonValue]:
    """Indicates whether the local engine (transformers + PIL) is available."""
    def read_status() -> dict[str, JsonValue]:
        return HandwritingStatusResponse(
            available=handwriting.is_available(),
            **handwriting.download_status(),
        ).model_dump()
    return await asyncio.to_thread(read_status)


@router.post('/cancel-download', response_model=HandwritingDownloadCancellationResponse)
async def cancel_handwriting_download() -> dict[str, bool]:
    return {'cancelling': await asyncio.to_thread(handwriting.cancel_download)}


@router.post("/warmup", response_model=HandwritingWarmupResponse)
async def handwriting_warmup() -> dict[str, bool]:
    """Preloads the model in the background (idempotent, non-blocking).

    The frontend calls this when opening the canvas so the 1st real
    recognition call doesn't have to wait for the model to load (~1.3 GB the first time).

    """
    def begin() -> dict[str, bool]:
        return HandwritingWarmupResponse(
            warming=handwriting.warmup(),
            loaded=handwriting.is_loaded(),
        ).model_dump()
    return await asyncio.to_thread(begin)


@router.post("/recognize", response_model=HandwritingRecognitionResponse)
async def recognize_handwriting(
    image: UploadFile = File(...),
    correct: bool | None = Form(None),
    language: str | None = Form(None),
) -> dict[str, JsonValue]:
    """Receives a PNG of the strokes and returns `{text, raw, lines, model, corrected}`.

    `correct` applies correction through the configured AI provider, which can
    be remote. If omitted, correction runs only when explicitly enabled in the
    handwriting configuration. `language` is an optional hint (ca/es/…).

    """
    if not await asyncio.to_thread(handwriting.is_available):
        raise HTTPException(
            status_code=503,
            detail="The local recognition engine is unavailable (transformers/PIL is missing).",
        )

    data = await image.read()
    if not data:
        raise HTTPException(status_code=400, detail="Image is empty.")
    if len(data) > _MAX_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large.")

    try:
        # TrOCR on CPU is heavy and blocking: keep it off the event loop.
        result = await asyncio.to_thread(handwriting.recognize, data, True, correct, language)
    except DownloadCancelled:
        raise HTTPException(409, 'handwriting_download_cancelled') from None
    except handwriting.HandwritingInputError as error:
        messages = {
            "blank_image": {
                "ca": "La imatge no conté traços per reconèixer.",
                "es": "La imagen no contiene trazos para reconocer.",
                "en": "The image contains no strokes to recognize.",
                "fr": "L’image ne contient aucun trait à reconnaître.",
            },
            "too_many_lines": {
                "ca": "La nota supera les 40 línies. Divideix-la en fragments més curts.",
                "es": "La nota supera las 40 líneas. Divídela en fragmentos más cortos.",
                "en": "The note exceeds 40 lines. Split it into shorter sections.",
                "fr": "La note dépasse 40 lignes. Divisez-la en parties plus courtes.",
            },
            "invalid_image": {
                "ca": "No s’ha pogut llegir la imatge. Torna-la a exportar.",
                "es": "No se ha podido leer la imagen. Vuelve a exportarla.",
                "en": "The image could not be read. Export it again.",
                "fr": "L’image n’a pas pu être lue. Exportez-la à nouveau.",
            },
            "line_too_long": {
                "ca": "Una línia supera el límit de reconeixement. Divideix-la en línies més curtes.",
                "es": "Una línea supera el límite de reconocimiento. Divídela en líneas más cortas.",
                "en": "A line exceeds the recognition limit. Split it into shorter lines.",
                "fr": "Une ligne dépasse la limite de reconnaissance. Divisez-la en lignes plus courtes.",
            },
        }
        locale = language if isinstance(language, str) and language in {"ca", "es", "en", "fr"} else "en"
        raise HTTPException(422, messages[str(error)][locale]) from error
    except Exception as e:
        log.exception("Handwriting recognition failed")
        raise HTTPException(status_code=500, detail=f"Recognition failed: {e}")

    return HandwritingRecognitionResponse.model_validate(result).model_dump()
