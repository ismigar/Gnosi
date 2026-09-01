"""Local audio transcription with faster-whisper (CTranslate2, WITHOUT torch).

Private: the audio is processed on the machine, it never goes to any cloud. The
model is loaded lazily (singleton) and downloaded on first use to
`GNOSI_DATA_DIR/cache/whisper` (outside OneDrive, cf. the caches memory note).
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
from collections.abc import Iterable
from typing import Optional, Protocol, TypedDict

from backend.config.app_config import load_params
from backend.config.data_dir import resolve_data_dir

log = logging.getLogger(__name__)


class WhisperSegment(Protocol):
    text: str
    start: float
    end: float


class WhisperInfo(Protocol):
    language: str | None
    duration: float


class WhisperModel(Protocol):
    def transcribe(
        self,
        audio_path: str,
        *,
        language: str | None,
        vad_filter: bool,
        beam_size: int,
    ) -> tuple[Iterable[WhisperSegment], WhisperInfo]: ...


class TranscriptionSegment(TypedDict):
    start: float
    end: float
    text: str


class TranscriptionResult(TypedDict):
    text: str
    language: str | None
    duration: float
    segments: list[TranscriptionSegment]


_MODEL: WhisperModel | None = None
_MODEL_LOCK = threading.Lock()


def _cache_dir() -> str:
    directory = resolve_data_dir(create=True) / "cache" / "whisper"
    try:
        directory.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return str(directory)


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
        import faster_whisper  # type: ignore[import-untyped]  # noqa: F401

        return True
    except Exception:
        return False


def get_model() -> WhisperModel:
    """Loads (lazily) and returns the `WhisperModel` singleton."""
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    with _MODEL_LOCK:
        if _MODEL is None:
            from faster_whisper import WhisperModel as FasterWhisperModel

            size = _model_size()
            log.info(f"transcription: carregant WhisperModel '{size}' (CPU/int8)…")
            _MODEL = FasterWhisperModel(
                size, device="cpu", compute_type="int8", download_root=_cache_dir()
            )
            log.info("transcription: model carregat.")
    return _MODEL


def transcribe(audio_path: str, language: Optional[str] = None) -> TranscriptionResult:
    """Transcribes an audio file.

    Returns `{text, language, duration, segments}` where `segments` is a list of
    `{start, end, text}` (in case timestamps are wanted). `language=None` →
    auto-detection (Whisper works well with Catalan/Spanish).

    """
    model = get_model()
    segments, info = model.transcribe(
        audio_path,
        language=language,
        vad_filter=True,  # skips silences → faster and cleaner
        beam_size=1,  # fast on CPU; raising it to 5 gives a bit more accuracy
    )
    parts: list[str] = []
    seg_list: list[TranscriptionSegment] = []
    for s in segments:
        t = (s.text or "").strip()
        if not t:
            continue
        parts.append(t)
        seg_list.append(
            {
                "start": round(float(s.start or 0.0), 2),
                "end": round(float(s.end or 0.0), 2),
                "text": t,
            }
        )
    return {
        "text": " ".join(parts).strip(),
        "language": getattr(info, "language", None),
        "duration": round(float(getattr(info, "duration", 0.0) or 0.0), 1),
        "segments": seg_list,
    }
