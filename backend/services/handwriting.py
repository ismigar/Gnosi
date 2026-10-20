"""Handwriting recognition (ink → text) LOCAL with TrOCR.

The stroke image is processed on the machine. Optional text correction uses
the configured AI provider, which can be remote, and requires explicit activation.
The model is loaded
lazily (singleton) and downloaded on first use to `GNOSI_DATA_DIR/cache/trocr`
(outside OneDrive, cf. caches memory).

Configurable model: env `GNOSI_TROCR_MODEL` or `ai.handwriting.model` in
params.yaml. Default `microsoft/trocr-base-handwritten` (balance of
quality/speed on CPU; `-large-` is more accurate but much slower on Intel).

⚠️ Known limitation: TrOCR handwritten is trained in ENGLISH. In Catalan/
Spanish it works but with more errors (especially accents and digraphs). To mitigate
this, we optionally pass the output through a CORRECTION with the configured AI provider that
fixes accents/digraphs without altering the machine's text (`correct=True`). If
there is no AI provider, the raw text is returned without failing. For multi-line we do
a simple segmentation by horizontal projection (TrOCR is single-line).

Warmup: `warmup()` supports explicit preloading in a background daemon thread.
Opening the canvas does not load weights; recognition loads them on demand.
"""

from backend.services.agent_behavior import task_input
import io
import logging
import os
import re
import threading
from contextvars import copy_context
from pathlib import Path
from typing import Any, Optional

from backend.config.app_config import load_params

log = logging.getLogger(__name__)

_MODEL: Any = None          # VisionEncoderDecoderModel
_PROCESSOR: Any = None      # TrOCRProcessor
_MODEL_KEY: tuple[str, str] | None = None
_LOCK = threading.Lock()
_WARMUP_LOCK = threading.Lock()
_WARMUP_THREADS: dict[tuple[str, str], threading.Thread] = {}

_DEFAULT_MODEL = "microsoft/trocr-base-handwritten"
# Line cap to prevent a large canvas from stalling the CPU for minutes.
_MAX_LINES = 40

_LANG_LABELS = {"ca": "Catalan", "es": "Spanish", "en": "English", "fr": "French"}


def _download_owner() -> str:
    from backend.services.agent_execution_scope import current_scope
    try:
        scope = current_scope()
    except RuntimeError:
        return ''  # Direct local callers; HTTP cancellation requires a scope.
    import json
    return json.dumps([scope.user_id, scope.workspace_id, str(scope.vault_path)], ensure_ascii=False)


def download_status() -> dict[str, Any]:
    from backend.services import handwriting_download as downloads
    owner = _download_owner()
    selected = (_model_id(), str(Path(_cache_dir()).resolve()))
    model, cache = downloads.active(owner) or selected
    state = downloads.status(model, cache, owner)
    loaded = _MODEL is not None and _PROCESSOR is not None and _MODEL_KEY == (model, cache)
    state.update(model=model, loaded=loaded)
    if loaded:
        state['state'] = 'ready'
    return state


def cancel_download() -> bool:
    from backend.services.agent_execution_scope import current_scope
    from backend.services import handwriting_download as downloads
    current_scope()  # Never cancel a worker without an authenticated scope.
    owner = _download_owner()
    active = downloads.active(owner)
    return downloads.cancel(*active, owner) if active else False


class HandwritingInputError(ValueError):
    """An image that cannot be recognized completely within the line budget."""


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
        return val is True
    except Exception:
        return False


def is_available() -> bool:
    try:
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel  # noqa: F401
        from PIL import Image  # noqa: F401
        return True
    except Exception:
        return False


def is_loaded() -> bool:
    return (_MODEL is not None and _PROCESSOR is not None
            and _MODEL_KEY == (_model_id(), str(Path(_cache_dir()).resolve())))


def _load() -> tuple[Any, Any, str]:
    """Loads (lazily) the TrOCR processor + model (singleton, CPU)."""
    global _MODEL, _PROCESSOR, _MODEL_KEY
    mid = _model_id()
    cache = str(Path(_cache_dir()).resolve())
    key = (mid, cache)
    with _LOCK:
        if _MODEL is None or _PROCESSOR is None or _MODEL_KEY != key:
            from backend.services import handwriting_download as downloads
            owner = _download_owner()
            try:
                source = downloads.prepare(mid, cache, owner)
                downloads.transition(mid, cache, owner, 'loading')
                from transformers import TrOCRProcessor, VisionEncoderDecoderModel
                log.info("handwriting: loading cached TrOCR '%s' on CPU", mid)
                processor: Any = TrOCRProcessor.from_pretrained(source, cache_dir=cache, local_files_only=True)
                model: Any = VisionEncoderDecoderModel.from_pretrained(source, cache_dir=cache, local_files_only=True)
                model.eval()
                _PROCESSOR, _MODEL, _MODEL_KEY = processor, model, key
                downloads.transition(mid, cache, owner, 'ready')
                log.info("handwriting: model loaded")
            except BaseException as error:
                downloads.failed(mid, cache, owner, error)
                raise
        return _PROCESSOR, _MODEL, mid


def warmup() -> bool:
    """Preloads the model in a daemon thread (idempotent, non-blocking).

    Returns True if it started (or was already loading/loaded), False if the
    engine is not available. Callers must request this explicitly: opening a
    canvas alone must not trigger a large download or model allocation.
    
    """
    if not is_available():
        return False
    if is_loaded():
        return True
    key = (_model_id(), str(Path(_cache_dir()).resolve()))
    # Loading weights holds _LOCK for a long time. Never wait on that lock in
    # the API's event-loop thread just to reserve a background warmup.
    with _WARMUP_LOCK:
        for completed in [item for item, thread in _WARMUP_THREADS.items() if not thread.is_alive()]:
            _WARMUP_THREADS.pop(completed)
        if key in _WARMUP_THREADS:
            return True

        def _run() -> None:
            try:
                _load()
            except Exception as e:  # pragma: no cover - clean degradation
                log.warning("handwriting: warmup failed: %s", e)

        thread = threading.Thread(target=copy_context().run, args=(_run,), daemon=True, name="trocr-warmup")
        _WARMUP_THREADS[key] = thread
        try:
            thread.start()
        except Exception:
            _WARMUP_THREADS.pop(key, None)
            raise
    log.info("handwriting: model warmup started in the background")
    return True


def _correct_text(text: str, language: Optional[str] = None) -> Optional[str]:
    """Corrects accents/spelling with the configured AI provider. Reuses the
    same mechanism as `POST /api/ai/correct`. Returns the corrected text or
    `None` if there's no AI provider or it fails (clean degradation → raw text).
    
    """
    if not text.strip():
        return None
    try:
        from functools import partial
        from backend.services.agent_execution import generate_for

        generate_text = partial(generate_for, "writing")
    except Exception:
        return None

    lang_note = ""
    if language and language in _LANG_LABELS:
        lang_note = f" The text is in {_LANG_LABELS[language]}."
    prompt = task_input("writing.ocr-correct", text=text, language=language or "")
    try:
        content, _provider = generate_text(prompt, text[:200], timeout=30)
        corrected = (content or "").strip()
        numbers = r"[+-]?\d+(?:[.,]\d+)*"
        if re.findall(numbers, corrected) != re.findall(numbers, text):
            log.info("handwriting: discarded AI correction that changed numeric values")
            return None
        return corrected or None
    except Exception as e:
        log.info("handwriting: AI correction was not applied (%s); returning raw text", e)
        return None


def recognize(image_bytes: bytes, segment: bool = True, correct: Optional[bool] = None, language: Optional[str] = None) -> dict[str, Any]:
    from backend.services.agent_specialized_tools import run_engine
    result = run_engine("handwriting", "image", lambda: _recognize_engine(image_bytes, segment, False, language))
    want_correct = _correct_default() if correct is None else correct
    if want_correct and result["raw"]:
        corrected = _correct_text(str(result["raw"]), language)
        if corrected:
            result.update(text=corrected, corrected=corrected != result["raw"])
    return result


def _recognize_engine(
    image_bytes: bytes,
    segment: bool = True,
    correct: Optional[bool] = None,
    language: Optional[str] = None,
) -> dict[str, Any]:
    """Recognizes the handwritten text from a PNG/JPEG image.

    `segment=True` splits the image into lines and recognizes them one by one (better
    for multi-line notes). `correct` applies an AI correction (accents/
    spelling) to the output; if it's `None` the config default is used. Returns
    `{text, raw, lines, model, corrected}` where `text` is the final result (raw or
    corrected) and `raw` is always TrOCR's direct output.
    
    """
    from PIL import Image

    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            # Canvas exports can be transparent; alpha must be flattened onto
            # white so an empty transparent canvas is not treated as black ink.
            canvas = Image.new("RGBA", source.size, "white")
            canvas.alpha_composite(source.convert("RGBA"))
            image = canvas.convert("RGB")
    except (OSError, ValueError) as error:
        raise HandwritingInputError("invalid_image") from error
    darkest = image.convert("L").getextrema()[0]
    if isinstance(darkest, (int, float)) and darkest >= 200:
        raise HandwritingInputError("blank_image")
    lines = _segment_lines(image) if segment else [image]
    processor, model, model_id = _load()

    import torch

    texts = []
    with torch.no_grad():
        for line_img in lines:
            pixel_values = processor(images=line_img, return_tensors="pt").pixel_values
            generated_ids = model.generate(pixel_values, max_new_tokens=64)
            token_ids = generated_ids[0].tolist()
            eos = getattr(model.generation_config, "eos_token_id", None)
            eos_ids = eos if isinstance(eos, (list, tuple)) else [eos]
            # TrOCR starts with one decoder token. Reaching the 64 new-token
            # ceiling without EOS is a partial line, never a complete result.
            if len(token_ids) >= 65 and token_ids[-1] not in eos_ids:
                raise HandwritingInputError("line_too_long")
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
        "model": model_id,
        "corrected": did_correct,
    }


def _segment_lines(image: Any) -> list[Any]:
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
    if len(crops) > _MAX_LINES:
        raise HandwritingInputError("too_many_lines")
    return crops
