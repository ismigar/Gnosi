from pathlib import Path
from types import SimpleNamespace

from backend.services import transcription


def test_whisper_cache_uses_canonical_data_directory(
    monkeypatch,
    tmp_path: Path,
) -> None:
    monkeypatch.setattr(transcription, "resolve_data_dir", lambda *, create: tmp_path)

    cache_dir = Path(transcription._cache_dir())

    assert cache_dir == tmp_path / "cache" / "whisper"
    assert cache_dir.is_dir()


def test_transcribe_normalizes_segments_and_metadata(monkeypatch) -> None:
    class FakeModel:
        def transcribe(self, audio_path, **options):
            assert audio_path == "/tmp/note.webm"
            assert options == {"language": "ca", "vad_filter": True, "beam_size": 1}
            return (
                [
                    SimpleNamespace(text="  Hola ", start=0.004, end=1.236),
                    SimpleNamespace(text=" ", start=1.3, end=2.0),
                    SimpleNamespace(text="món", start=2.0, end=3.0),
                ],
                SimpleNamespace(language="ca", duration=3.04),
            )

    monkeypatch.setattr(transcription, "get_model", lambda: FakeModel())

    assert transcription.transcribe("/tmp/note.webm", language="ca") == {
        "text": "Hola món",
        "language": "ca",
        "duration": 3.0,
        "segments": [
            {"start": 0.0, "end": 1.24, "text": "Hola"},
            {"start": 2.0, "end": 3.0, "text": "món"},
        ],
    }
