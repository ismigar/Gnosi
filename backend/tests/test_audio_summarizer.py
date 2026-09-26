from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.agent import factory
from backend.services import audio_summarizer


class FakeLlm:
    def __init__(self, response=None):
        self.response = response or SimpleNamespace(content="Generated script")
        self.messages = None

    def invoke(self, messages):
        self.messages = messages
        return self.response


def _config(settings=None, models=None, providers=None):
    return SimpleNamespace(
        settings=settings or {},
        ai={"models": models or [], "providers": providers or {}},
    )


def test_podcast_model_selection_requires_provider_and_model_together():
    with pytest.raises(audio_summarizer.PodcastModelError, match="incomplete"):
        audio_summarizer._podcast_model_selection(
            {"reader": {"podcast": {"provider": "groq"}}}
        )


@pytest.mark.parametrize(
    ("settings", "expected"),
    [
        ({"language": "ca"}, ("ca", "Catalan")),
        ({"language": "es"}, ("es", "Spanish")),
        ({"language": "fr"}, ("fr", "French")),
        ({"language": "en"}, ("en", "English")),
        ({"language": "unsupported"}, ("en", "English")),
        ({}, ("en", "English")),
    ],
)
def test_podcast_language_selection_follows_normalized_interface_language(
    settings, expected
):
    assert audio_summarizer._podcast_language_selection(settings) == expected


def test_resolve_podcast_language_reads_current_settings_each_time(monkeypatch):
    configs = iter([
        _config(settings={"language": "ca"}),
        _config(settings={"language": "fr"}),
    ])
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: next(configs),
    )

    assert audio_summarizer._resolve_podcast_language() == ("ca", "Catalan")
    assert audio_summarizer._resolve_podcast_language() == ("fr", "French")

@pytest.mark.parametrize("old_route", [{}, {"provider": "old", "model": "disabled"}])
def test_podcast_uses_only_the_principal_snapshot(monkeypatch, old_route):
    from backend.services import agent_execution
    snapshot = SimpleNamespace(profile={"provider": "principal-provider", "model": "principal-model"})
    requested = []
    def prepare(skill):
        requested.append(skill)
        return snapshot
    monkeypatch.setattr(agent_execution, "prepare_snapshot", prepare)
    monkeypatch.setattr("backend.config.app_config.load_params", lambda **_: _config(settings={"reader": {"podcast": old_route}}))
    assert audio_summarizer._resolve_podcast_llm() == (snapshot, "principal-provider", "principal-model")
    assert requested == ["core.gnosi-daily-briefing"]


def test_podcast_reports_missing_principal_without_legacy_fallback(monkeypatch):
    from backend.services import agent_execution
    def unavailable(_):
        raise RuntimeError("principal_agent_unavailable")
    monkeypatch.setattr(agent_execution, "prepare_snapshot", unavailable)
    with pytest.raises(RuntimeError, match="principal_agent_unavailable"):
        audio_summarizer._resolve_podcast_llm()


def test_summarize_batch_uses_shared_executor_and_preserves_language(monkeypatch):
    from backend.services import agent_execution
    snapshot = SimpleNamespace(profile={})
    calls = []
    def execute(request, **kwargs):
        calls.append((request, kwargs))
        return SimpleNamespace(result="Podcast script")
    monkeypatch.setattr(agent_execution, "run_sync", execute)
    assert audio_summarizer._summarize_batch(snapshot, ["News evidence"], 1, 1, "ignored", "ignored", "Catalan") == "Podcast script"
    request, kwargs = calls[0]
    assert kwargs["snapshot"] is snapshot
    assert request.skill_id == "core.gnosi-daily-briefing"
    assert request.language == "Catalan"
    assert "News evidence" in request.input
    import json
    assert json.loads(request.input)["data"]["language"] == "Catalan"


def test_generate_tts_uses_selected_language(monkeypatch, tmp_path):
    observed = []

    class FakeTts:
        def __init__(self, text, lang, slow):
            observed.append((text, lang, slow))

        def write_to_fp(self, buffer):
            buffer.write(b"audio")

    monkeypatch.setattr(audio_summarizer, "gTTS", FakeTts)
    output_path = tmp_path / "podcast.mp3"

    audio_summarizer._generate_tts_by_sentences(
        "Primera frase. Segona frase.", output_path, "ca"
    )

    assert sorted(observed) == sorted([
        ("Primera frase.", "ca", False),
        ("Segona frase.", "ca", False),
    ])
    assert output_path.read_bytes() == b"audioaudio"


def test_generate_tts_publishes_audio_atomically(monkeypatch, tmp_path):
    output_path = tmp_path / "podcast.mp3"
    output_path.write_bytes(b"previous")

    def fake_generate(text, partial_path, language_code):
        assert partial_path == f"{output_path}.part"
        assert output_path.read_bytes() == b"previous"
        Path(partial_path).write_bytes(b"complete")

    monkeypatch.setattr(audio_summarizer, "_generate_tts_by_sentences", fake_generate)

    audio_summarizer._generate_tts_atomically("Guió", output_path, "ca")

    assert output_path.read_bytes() == b"complete"
    assert not Path(f"{output_path}.part").exists()


def test_generate_tts_keeps_previous_audio_when_generation_fails(
    monkeypatch, tmp_path
):
    output_path = tmp_path / "podcast.mp3"
    output_path.write_bytes(b"previous")

    def fake_generate(text, partial_path, language_code):
        Path(partial_path).write_bytes(b"incomplete")
        raise RuntimeError("network failure")

    monkeypatch.setattr(audio_summarizer, "_generate_tts_by_sentences", fake_generate)

    with pytest.raises(RuntimeError, match="network failure"):
        audio_summarizer._generate_tts_atomically("Guió", output_path, "ca")

    assert output_path.read_bytes() == b"previous"
    assert not Path(f"{output_path}.part").exists()


def test_podcast_output_dir_is_inside_selected_vault(tmp_path):
    assert audio_summarizer.get_podcast_output_dir(tmp_path) == (
        Path(tmp_path) / "data" / "podcasts"
    )


def test_async_generation_preserves_selected_vault(monkeypatch, tmp_path):
    observed_paths = []

    def fake_generate():
        from backend.services.context_vars import get_active_vault_path

        observed_paths.append(get_active_vault_path())
        audio_summarizer.generation_status["running"] = False

    class ImmediateThread:
        def __init__(self, target, daemon, args=()):
            self.target = lambda: target(*args)

        def start(self):
            self.target()

    audio_summarizer.generation_status["running"] = False
    monkeypatch.setattr(audio_summarizer, "generate_daily_podcast", fake_generate)
    monkeypatch.setattr(audio_summarizer.threading, "Thread", ImmediateThread)

    assert audio_summarizer.start_generation_async(vault_path=tmp_path) is True
    assert observed_paths == [Path(tmp_path)]
