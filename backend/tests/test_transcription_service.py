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

    from backend.services import agent_specialized_tools
    calls = []
    def engine(kind, resource, invoke):
        calls.append((kind, resource))
        return invoke()
    monkeypatch.setattr(agent_specialized_tools, "run_engine", engine)
    assert transcription.transcribe("/tmp/note.webm", language="ca") == {
        "text": "Hola món",
        "language": "ca",
        "duration": 3.0,
        "segments": [
            {"start": 0.0, "end": 1.24, "text": "Hola"},
            {"start": 2.0, "end": 3.0, "text": "món"},
        ],
    }
    assert calls == [("transcription", "audio")]


def test_cached_weights_follow_model_and_data_directory_changes(monkeypatch, tmp_path):
    import sys
    from unittest.mock import Mock
    selected = {'model': 'small', 'cache': str(tmp_path / 'a')}
    monkeypatch.setattr(transcription, '_MODEL', None)
    monkeypatch.setattr(transcription, '_MODEL_KEY', None)
    monkeypatch.setattr(transcription, '_model_size', lambda: selected['model'])
    monkeypatch.setattr(transcription, '_cache_dir', lambda: selected['cache'])
    model_constructor = Mock(side_effect=[object(), object(), object()])
    monkeypatch.setitem(sys.modules, 'faster_whisper', SimpleNamespace(WhisperModel=model_constructor))
    first = transcription.get_model()
    assert transcription.get_model() is first and model_constructor.call_count == 1
    selected['model'] = 'base'
    second = transcription.get_model()
    assert second is not first and model_constructor.call_count == 2
    selected['cache'] = str(tmp_path / 'b')
    assert transcription.get_model() is not second and model_constructor.call_count == 3
    assert model_constructor.call_args.kwargs['download_root'] == selected['cache']
