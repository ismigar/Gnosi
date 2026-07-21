"""Local audio transcription with faster-whisper (CTranslate2, WITHOUT torch).

Private: the audio is processed on the machine, it never goes to any cloud. The
model is loaded lazily (singleton) and downloaded on first use to
`GNOSI_LOCAL_DATA/cache/whisper` (outside OneDrive, cf. the caches memory note).
Decodes webm/opus (what the browser's MediaRecorder produces) via PyAV,
without external ffmpeg.

Configurable model size: env `GNOSI_WHISPER_MODEL` or
`ai.transcription.model` in params.yaml. Default `small` (good balance of
quality/speed on CPU). `base` is faster; `medium`/`large-v3` are more accurate
but slower.
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
    """Loads (lazily) and returns the `WhisperModel` singleton."""
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
    """Transcribes an audio file.

    Returns `{text, language, duration, segments}` where `segments` is a list of
    `{start, end, text}` (in case timestamps are wanted). `language=None` →
    auto-detection (Whisper works well with Catalan/Spanish).
    
    """
    model = get_model()
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,   # skips silences → faster and cleaner
        beam_size=1,       # fast on CPU; raising it to 5 gives a bit more accuracy
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
