"""Contract tests for the legacy hybrid AI client boundary."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import requests

from pipeline import ai_client


class _Response:
    def __init__(
        self,
        payload: object,
        *,
        status_code: int = 200,
        text: str = "",
    ) -> None:
        self.payload = payload
        self.status_code = status_code
        self.text = text

    def json(self) -> object:
        return self.payload


def test_cache_loader_keeps_only_string_entries(tmp_path: Path, monkeypatch) -> None:
    cache_path = tmp_path / "ai-cache.json"
    cache_path.write_text(
        json.dumps({"valid": "answer", "number": 3, "nested": {"x": 1}}),
        encoding="utf-8",
    )
    monkeypatch.setattr(ai_client, "CACHE_FILE", cache_path)

    assert ai_client._load_cache() == {"valid": "answer"}  # noqa: SLF001


def test_call_provider_sends_typed_openai_payload(monkeypatch) -> None:
    captured: dict[str, object] = {}
    monkeypatch.setattr(
        ai_client,
        "PROVIDERS",
        {
            "demo": {
                "model_name": "demo-model",
                "model_url": "https://provider.invalid/chat",
                "timeout": "17",
            }
        },
    )
    monkeypatch.setattr(
        ai_client,
        "resolve_provider_api_key",
        lambda provider, config: "secret",
    )

    def fake_post(url, **kwargs):
        captured.update({"url": url, **kwargs})
        return _Response({"choices": [{"message": {"reasoning_content": "reasoned"}}]})

    monkeypatch.setattr(ai_client.requests, "post", fake_post)

    assert ai_client._call_provider("demo", "Prompt") == "reasoned"  # noqa: SLF001
    assert captured["url"] == "https://provider.invalid/chat"
    assert captured["timeout"] == 17
    assert captured["headers"] == {
        "Content-Type": "application/json",
        "Authorization": "Bearer secret",
    }
    assert captured["json"] == {
        "model": "demo-model",
        "messages": [{"role": "user", "content": "Prompt"}],
        "max_tokens": 1000,
        "temperature": 0.2,
    }


@pytest.mark.parametrize(
    "payload",
    [[], {}, {"choices": []}, {"choices": [{}]}],
)
def test_call_provider_rejects_malformed_payloads(payload: object, monkeypatch) -> None:
    monkeypatch.setattr(
        ai_client,
        "PROVIDERS",
        {"demo": {"model_name": "model", "model_url": "https://invalid"}},
    )
    monkeypatch.setattr(ai_client, "resolve_provider_api_key", lambda provider, config: None)
    monkeypatch.setattr(
        ai_client.requests,
        "post",
        lambda *args, **kwargs: _Response(payload),
    )

    with pytest.raises(RuntimeError, match="AI provider"):
        ai_client._call_provider("demo", "Prompt")  # noqa: SLF001


def test_fallback_uses_truncated_primary_and_full_secondary(monkeypatch) -> None:
    calls: list[tuple[str, str, int | None]] = []
    monkeypatch.setattr(
        ai_client,
        "PROVIDERS",
        {
            "primary": {"timeout": 3, "max_content_chars": 4},
            "secondary": {"timeout": 9},
        },
    )
    monkeypatch.setattr(ai_client, "PRIMARY_PROVIDER", "primary")
    monkeypatch.setattr(ai_client, "FALLBACK_PROVIDER", "secondary")
    monkeypatch.setattr(ai_client, "_AI_CACHE", {})
    monkeypatch.setattr(ai_client, "_save_cache", lambda cache: None)

    def fake_call(provider: str, prompt: str, timeout: int | None = None) -> str:
        calls.append((provider, prompt, timeout))
        if provider == "primary":
            raise requests.exceptions.Timeout("slow")
        return "fallback answer"

    monkeypatch.setattr(ai_client, "_call_provider", fake_call)

    assert ai_client.call_ai_with_fallback("abcdefgh", use_cache=False) == (
        "fallback answer",
        "secondary",
    )
    assert calls == [
        ("primary", "abcd\n[... truncated ...]", 3),
        ("secondary", "abcdefgh", 9),
    ]


def test_cached_result_skips_provider(monkeypatch) -> None:
    prompt = "same prompt"
    prompt_hash = ai_client.hashlib.sha256(prompt.encode("utf-8")).hexdigest()
    monkeypatch.setattr(ai_client, "_AI_CACHE", {prompt_hash: "cached answer"})
    monkeypatch.setattr(
        ai_client,
        "_call_provider",
        lambda *args, **kwargs: pytest.fail("provider should not be called"),
    )

    assert ai_client.call_ai_client(prompt) == "cached answer"
    assert ai_client.call_ai_with_fallback(prompt) == ("cached answer", "cache")


def test_availability_rejects_missing_url_without_network(monkeypatch) -> None:
    monkeypatch.setattr(ai_client, "PROVIDERS", {"broken": {"model_name": "x"}})
    monkeypatch.setattr(
        ai_client.requests,
        "post",
        lambda *args, **kwargs: pytest.fail("network should not be called"),
    )

    assert not ai_client.check_provider_availability("broken")
    assert not ai_client.check_provider_availability("missing")


def test_availability_isolates_credential_resolution_failure(monkeypatch) -> None:
    monkeypatch.setattr(
        ai_client,
        "PROVIDERS",
        {"demo": {"model_name": "x", "model_url": "https://invalid"}},
    )

    def fail_credentials(provider, config):
        raise RuntimeError("keychain unavailable")

    monkeypatch.setattr(ai_client, "resolve_provider_api_key", fail_credentials)

    assert not ai_client.check_provider_availability("demo")
