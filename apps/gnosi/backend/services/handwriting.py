"""Reconeixement d'escriptura a mà (ink → text) LOCAL amb TrOCR.

Privat: la imatge dels traços es processa a la màquina, no surt a cap núvol
(coherent amb el vault offline-first de Gnosi). El model es carrega de manera
mandrosa (singleton) i es baixa al 1r ús a `GNOSI_LOCAL_DATA/cache/trocr`
(fora d'OneDrive, cf. memòria de caches).

Model configurable: env `GNOSI_TROCR_MODEL` o `ai.handwriting.model` a
params.yaml. Default `microsoft/trocr-base-handwritten` (equilibri
qualitat/velocitat en CPU; `-large-` és més precís però molt més lent en Intel).

⚠️ Limitació coneguda: TrOCR handwritten està entrenat en ANGLÈS. En català/
castellà funciona però amb més errors (sobretot accents i dígrafs). Per pal·liar-
ho, opcionalment passem la sortida per una CORRECCIÓ amb l'LLM local (Ollama) que
arregla accents/dígrafs sense treure el text de la màquina (`correct=True`). Si
no hi ha proveïdor d'IA, es retorna el text cru sense fallar. Per multi-línia fem
una segmentació simple per projecció horitzontal (TrOCR és mono-línia).

Warmup: `warmup()` precarrega el model en segon pla (thread daemon) perquè la
primera crida real de reconeixement no hagi d'esperar la càrrega. El frontend el
crida en obrir el llenç.
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
_WARMUP_THREAD = None   # thread de precàrrega en vol (evita duplicats)

_DEFAULT_MODEL = "microsoft/trocr-base-handwritten"
# Sostre de línies per evitar que un llenç gran encalli la CPU minuts.
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
    """Si per defecte s'aplica la correcció IA (params `ai.handwriting.correct`)."""
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
    """Carrega (mandrós) el processor + model TrOCR (singleton, CPU)."""
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
    """Precarrega el model en un thread daemon (idempotent, no bloqueja).

    Retorna True si ha engegat (o ja estava carregant/carregat), False si el
    motor no està disponible. La idea és cridar-lo quan s'obre el llenç: mentre
    l'usuari escriu, el model es carrega, i quan clica "Passar a text" ja hi és.
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
    """Corregeix accents/ortografia amb l'LLM local (Ollama). Reaprofita el
    mateix mecanisme que `POST /api/ai/correct`. Retorna el text corregit o
    `None` si no hi ha proveïdor d'IA o falla (degradació neta → text cru).
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
    """Reconeix el text manuscrit d'una imatge PNG/JPEG.

    `segment=True` parteix la imatge en línies i les reconeix una a una (millor
    per notes de diverses línies). `correct` aplica una correcció IA (accents/
    ortografia) a la sortida; si és `None` s'usa el default de config. Retorna
    `{text, raw, lines, model, corrected}` on `text` és el resultat final (cru o
    corregit) i `raw` és sempre la sortida directa de TrOCR.
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
    """Parteix una imatge multi-línia en retalls d'una línia cadascun.

    Projecció horitzontal: sumem la "tinta" (píxels foscos) per fila; les
    bandes contigües amb tinta són línies, separades per franges en blanc.
    Retorna una llista d'imatges PIL (una per línia) o `[image]` si no es pot
    segmentar de forma fiable (imatge d'una sola línia, o massa soroll).
    """
    import numpy as np
    from PIL import Image

    gray = image.convert("L")
    arr = np.asarray(gray, dtype=np.uint8)
    # Tinta = píxels més foscos que un llindar (fons blanc de l'export tldraw).
    ink = arr < 200
    row_has_ink = ink.sum(axis=1) > 0
    if not row_has_ink.any():
        return [image]

    # Detecta bandes contigües de files amb tinta.
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

    # Descarta bandes minúscules (soroll) i afegeix un marge vertical.
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
