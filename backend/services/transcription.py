"""Transcripció local d'àudio amb faster-whisper (CTranslate2, SENSE torch).

Privat: l'àudio es processa a la màquina, no surt a cap núvol. El model es
carrega de manera mandrosa (singleton) i es baixa al 1r ús a
`GNOSI_LOCAL_DATA/cache/whisper` (fora d'OneDrive, cf. memòria de caches).
Decodifica webm/opus (el que produeix MediaRecorder del navegador) via PyAV,
sense ffmpeg extern.

Tamany del model configurable: env `GNOSI_WHISPER_MODEL` o
`ai.transcription.model` a params.yaml. Default `small` (bon equilibri
qualitat/velocitat en CPU). `base` és més ràpid; `medium`/`large-v3` més precisos
però més lents.
"""
import logging
import os
import threading
from pathlib import Path
from typing import Optional

from backend.config.app_config import load_params

log = logging.getLogger(__name__)

_MODEL = None
_MODEL_LOCK = threading.Lock()


def _cache_dir() -> str:
    cfg = load_params(strict_env=False)
    local_data = cfg.paths.get("LOCAL_DATA")
    base = Path(local_data) if local_data else (Path.home() / ".cache" / "gnosi")
    d = base / "cache" / "whisper"
    try:
        d.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(d)


def _model_size() -> str:
    env = os.environ.get("GNOSI_WHISPER_MODEL")
    if env:
        return env.strip()
    try:
        cfg = load_params(strict_env=False)
        size = ((cfg.get("ai", {}) or {}).get("transcription", {}) or {}).get("model")
        return (size or "small").strip()
    except Exception:
        return "small"


def is_available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:
        return False


def get_model():
    """Carrega (mandrós) i retorna el `WhisperModel` singleton."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            from faster_whisper import WhisperModel
            size = _model_size()
            log.info(f"transcription: carregant WhisperModel '{size}' (CPU/int8)…")
            _MODEL = WhisperModel(
                size, device="cpu", compute_type="int8", download_root=_cache_dir()
            )
            log.info("transcription: model carregat.")
    return _MODEL


def transcribe(audio_path: str, language: Optional[str] = None) -> dict:
    """Transcriu un fitxer d'àudio.

    Retorna `{text, language, duration, segments}` on `segments` és una llista de
    `{start, end, text}` (per si es volen marques de temps). `language=None` →
    autodetecció (Whisper va bé en català/castellà).
    """
    model = get_model()
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,   # salta silencis → més ràpid i net
        beam_size=1,       # ràpid en CPU; pujar a 5 dona una mica més de precisió
    )
    parts = []
    seg_list = []
    for s in segments:
        t = (s.text or "").strip()
        if not t:
            continue
        parts.append(t)
        seg_list.append({
            "start": round(float(s.start or 0.0), 2),
            "end": round(float(s.end or 0.0), 2),
            "text": t,
        })
    return {
        "text": " ".join(parts).strip(),
        "language": getattr(info, "language", None),
        "duration": round(float(getattr(info, "duration", 0.0) or 0.0), 1),
        "segments": seg_list,
    }
