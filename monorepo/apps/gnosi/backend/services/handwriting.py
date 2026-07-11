"""Handwriting recognition (ink → text) LOCAL with TrOCR.

Private: the stroke image is processed on the machine, it never goes to any cloud
(consistent with Gnosi's offline-first vault). The model is loaded
lazily (singleton) and downloaded on first use to `GNOSI_LOCAL_DATA/cache/trocr`
(outside OneDrive, cf. caches memory).

Configurable model: env `GNOSI_TROCR_MODEL` or `ai.handwriting.model` in
params.yaml. Default `microsoft/trocr-base-handwritten` (balance of
quality/speed on CPU; `-large-` is more accurate but much slower on Intel).

⚠️ Known limitation: TrOCR handwritten is trained in ENGLISH. In Catalan/
Spanish it works but with more errors (especially accents and digraphs). To mitigate
this, we optionally pass the output through a CORRECTION with the local LLM (Ollama) that
fixes accents/digraphs without altering the machine's text (`correct=True`). If
there is no AI provider, the raw text is returned without failing. For multi-line we do
a simple segmentation by horizontal projection (TrOCR is single-line).

Warmup: `warmup()` preloads the model in the background (daemon thread) so that
the first real recognition call doesn't have to wait for the load. The frontend
calls it when the canvas is opened.
"""
import io
import logging
import os
import threading
from pathlib import Path
from typing import Optional

from backend.config.app_config import load_params

log = logging.getLogger(__name__)

_MODEL = None          # VisionEncoderDecoderModel
_PROCESSOR = None      # TrOCRProcessor
_LOCK = threading.Lock()
_WARMUP_THREAD = None   # in-flight preload thread (avoids duplicates)

_DEFAULT_MODEL = "microsoft/trocr-base-handwritten"
# Line cap to prevent a large canvas from stalling the CPU for minutes.
_MAX_LINES = 40

_LANG_LABELS = {"ca": "català", "es": "castellà", "en": "anglès", "fr": "francès"}


def _cache_dir() -> str:
    cfg = load_params(strict_env=False)
    local_data = cfg.paths.get("LOCAL_DATA")
    base = Path(local_data) if local_data else (Path.home() / ".cache" / "gnosi")
    d = base / "cache" / "trocr"
    try:
        d.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(d)


def _model_id() -> str:
    env = os.environ.get("GNOSI_TROCR_MODEL")
    if env:
        return env.strip()
    try:
        cfg = load_params(strict_env=False)
        mid = ((cfg.get("ai", {}) or {}).get("handwriting", {}) or {}).get("model")
        return (mid or _DEFAULT_MODEL).strip()
    except Exception:
        return _DEFAULT_MODEL


def _correct_default() -> bool:
    """Whether AI correction is applied by default (params `ai.handwriting.correct`)."""
    try:
        cfg = load_params(strict_env=False)
        val = ((cfg.get("ai", {}) or {}).get("handwriting", {}) or {}).get("correct")
        return True if val is None else bool(val)
    except Exception:
        return True


def is_available() -> bool:
    try:
        import transformers  # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception:
        return False


def is_loaded() -> bool:
    return _MODEL is not None and _PROCESSOR is not None


def _load():
    """Loads (lazily) the TrOCR processor + model (singleton, CPU)."""
    global _MODEL, _PROCESSOR
    if _MODEL is not None and _PROCESSOR is not None:
        return _PROCESSOR, _MODEL
    with _LOCK:
        if _MODEL is None or _PROCESSOR is None:
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel
            mid = _model_id()
            cache = _cache_dir()
            log.info(f"handwriting: carregant TrOCR '{mid}' (CPU)… (1r cop baixa el model)")
            _PROCESSOR = TrOCRProcessor.from_pretrained(mid, cache_dir=cache)
            _MODEL = VisionEncoderDecoderModel.from_pretrained(mid, cache_dir=cache)
            _MODEL.eval()
            log.info("handwriting: model carregat.")
    return _PROCESSOR, _MODEL


def warmup() -> bool:
    """Preloads the model in a daemon thread (idempotent, non-blocking).

    Returns True if it started (or was already loading/loaded), False if the
    engine is not available. The idea is to call it when the canvas is opened: while
    the user writes, the model loads, and by the time they click "Convert to text" it's already there.
    
    """
    global _WARMUP_THREAD
    if not is_available():
        return False
    if is_loaded():
        return True
    with _LOCK:
        if _WARMUP_THREAD is not None and _WARMUP_THREAD.is_alive():
            return True

        def _run():
            try:
                _load()
            except Exception as e:  # pragma: no cover - degradació neta
                log.warning(f"handwriting: warmup fallit: {e}")

        _WARMUP_THREAD = threading.Thread(target=_run, daemon=True, name="trocr-warmup")
        _WARMUP_THREAD.start()
    log.info("handwriting: warmup del model engegat en segon pla.")
    return True


def _correct_text(text: str, language: Optional[str] = None) -> Optional[str]:
    """Corrects accents/spelling with the local LLM (Ollama). Reuses the
    same mechanism as `POST /api/ai/correct`. Returns the corrected text or
    `None` if there's no AI provider or it fails (clean degradation → raw text).
    
    """
    if not text.strip():
        return None
    try:
        from backend.agent.factory import generate_text
    except Exception:
        return None

    lang_note = ""
    if language and language in _LANG_LABELS:
        lang_note = f" El text és en {_LANG_LABELS[language]}."
    prompt = (
        "Ets un corrector ortogràfic per a text reconegut d'escriptura a mà (OCR)."
        f"{lang_note} Corregeix accents, dígrafs i errors ortogràfics evidents,"
        " respectant el sentit i les paraules originals. NO afegeixis ni treguis"
        " contingut, ni comentis res. Respon NOMÉS amb el text corregit:\n\n"
        f"{text}"
    )
    try:
        content, _provider = generate_text(prompt, text[:200], timeout=30)
        corrected = (content or "").strip()
        return corrected or None
    except Exception as e:
        log.info(f"handwriting: correcció IA no aplicada ({e}); es retorna el text cru.")
        return None


def recognize(
    image_bytes: bytes,
    segment: bool = True,
    correct: Optional[bool] = None,
    language: Optional[str] = None,
) -> dict:
    """Recognizes the handwritten text from a PNG/JPEG image.

    `segment=True` splits the image into lines and recognizes them one by one (better
    for multi-line notes). `correct` applies an AI correction (accents/
    spelling) to the output; if it's `None` the config default is used. Returns
    `{text, raw, lines, model, corrected}` where `text` is the final result (raw or
    corrected) and `raw` is always TrOCR's direct output.
    
    """
    from PIL import Image

    processor, model = _load()

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    lines = _segment_lines(image) if segment else [image]

    import torch

    texts = []
    with torch.no_grad():
        for line_img in lines:
            pixel_values = processor(images=line_img, return_tensors="pt").pixel_values
            generated_ids = model.generate(pixel_values, max_new_tokens=64)
            txt = processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
            txt = (txt or "").strip()
            if txt:
                texts.append(txt)

    raw = "\n".join(texts).strip()
    final = raw
    did_correct = False

    want_correct = _correct_default() if correct is None else bool(correct)
    if want_correct and raw:
        corrected = _correct_text(raw, language)
        if corrected and corrected != raw:
            final = corrected
            did_correct = True

    return {
        "text": final,
        "raw": raw,
        "lines": texts,
        "model": _model_id(),
        "corrected": did_correct,
    }


def _segment_lines(image):
    """Splits a multi-line image into crops of one line each.

    Horizontal projection: we sum the "ink" (dark pixels) per row; contiguous
    bands with ink are lines, separated by blank stripes.
    Returns a list of PIL images (one per line) or `[image]` if it can't be
    segmented reliably (single-line image, or too much noise).
    
    """
    import numpy as np
    from PIL import Image

    gray = image.convert("L")
    arr = np.asarray(gray, dtype=np.uint8)
    # Ink = pixels darker than a threshold (white background from the tldraw export).
    ink = arr < 200
    row_has_ink = ink.sum(axis=1) > 0
    if not row_has_ink.any():
        return [image]

    # Detects contiguous bands of rows with ink.
    bands = []
    start = None
    for y, has in enumerate(row_has_ink):
        if has and start is None:
            start = y
        elif not has and start is not None:
            bands.append((start, y))
            start = None
    if start is not None:
        bands.append((start, len(row_has_ink)))

    # Discards tiny bands (noise) and adds a vertical margin.
    h = arr.shape[0]
    pad = max(4, h // 100)
    crops = []
    for (y0, y1) in bands:
        if (y1 - y0) < 6:
            continue
        top = max(0, y0 - pad)
        bot = min(h, y1 + pad)
        crops.append(image.crop((0, top, image.width, bot)))

    if len(crops) <= 1:
        return [image]
    return crops[:_MAX_LINES]
