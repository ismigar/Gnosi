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


def test_resolve_podcast_llm_uses_default_model_when_route_is_empty(monkeypatch):
    expected_llm = FakeLlm()
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: _config(),
    )
    monkeypatch.setattr(
        factory,
        "get_default_llm_with_meta",
        lambda user_message: (expected_llm, "ollama", "llama3.2:latest"),
    )

    assert audio_summarizer._resolve_podcast_llm() == (
        expected_llm,
        "ollama",
        "llama3.2:latest",
    )


def test_resolve_podcast_llm_uses_explicit_enabled_route(monkeypatch):
    expected_llm = FakeLlm()
    settings = {
        "reader": {
            "podcast": {
                "provider": "Groq",
                "model": "llama-3.3-70b-versatile",
            }
        }
    }
    cfg = _config(
        settings=settings,
        models=[
            {
                "provider": "groq",
                "model_id": "llama-3.3-70b-versatile",
                "enabled": True,
            }
        ],
        providers={
            "groq": {
                "enabled": True,
                "base_url": "https://api.groq.com/openai/v1",
            }
        },
    )
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: cfg,
    )
    monkeypatch.setattr(
        "backend.security.ai_credentials.resolve_provider_api_key",
        lambda provider, provider_config: "secret",
    )
    calls = []

    def fake_get_llm(**kwargs):
        calls.append(kwargs)
        return expected_llm

    monkeypatch.setattr(factory, "get_llm", fake_get_llm)

    assert audio_summarizer._resolve_podcast_llm() == (
        expected_llm,
        "groq",
        "llama-3.3-70b-versatile",
    )
    assert calls == [
        {
            "provider": "groq",
            "model": "llama-3.3-70b-versatile",
            "api_key": "secret",
            "base_url": "https://api.groq.com/openai/v1",
        }
    ]


def test_resolve_podcast_llm_rejects_inactive_explicit_route(monkeypatch):
    cfg = _config(
        settings={
            "reader": {
                "podcast": {"provider": "groq", "model": "disabled-model"}
            }
        },
        models=[
            {"provider": "groq", "model_id": "disabled-model", "enabled": False}
        ],
    )
    monkeypatch.setattr(
        "backend.config.app_config.load_params",
        lambda strict_env=False: cfg,
    )

    with pytest.raises(audio_summarizer.PodcastModelError, match="not active"):
        audio_summarizer._resolve_podcast_llm()


def test_summarize_batch_uses_langchain_messages_and_records_usage(monkeypatch):
    llm = FakeLlm(SimpleNamespace(content="Podcast script"))
    recorded = []
    monkeypatch.setattr(
        "backend.agent.model_router.usage_from_message",
        lambda response: (120, 30),
    )
    monkeypatch.setattr(
        "backend.agent.model_router.record_llm_usage",
        lambda provider, model, tokens_in, tokens_out: recorded.append(
            (provider, model, tokens_in, tokens_out)
        ),
    )

    result = audio_summarizer._summarize_batch(
        llm,
        ["Source: Example\nTitle: News\nContent: Details"],
        1,
        1,
        "groq",
        "llama-3.3-70b-versatile",
    )

    assert result == "Podcast script"
    assert llm.messages[0].content == audio_summarizer.SYSTEM_PROMPT
    assert "Structure the summary as a fluid 10-15 minute podcast script" in (
        llm.messages[1].content
    )
    assert recorded == [("groq", "llama-3.3-70b-versatile", 120, 30)]
