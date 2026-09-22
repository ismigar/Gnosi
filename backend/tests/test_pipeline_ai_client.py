"""Legacy script aliases must not provide a second provider transport."""
import pytest
from pipeline import ai_client


def test_old_client_delegates_without_cache_or_truncation(monkeypatch):
    calls = []
    def generate(operation, prompt, **kwargs):
        calls.append((operation, prompt, kwargs))
        return "answer", "principal-model"
    monkeypatch.setattr("backend.services.agent_execution.generate_for", generate)
    assert ai_client.call_ai_client("all input") == "answer"
    assert ai_client.call_ai_with_fallback("all input", max_chars_primary=2) == "answer"
    assert all(call[:2] == ("writing", "all input") for call in calls)


def test_old_client_cannot_choose_another_provider():
    with pytest.raises(ValueError, match="cannot select"):
        ai_client.call_ai_client("input", provider="legacy")


def test_failure_does_not_try_a_second_transport(monkeypatch):
    def unavailable(*args, **kwargs):
        raise RuntimeError("principal unavailable")
    monkeypatch.setattr("backend.services.agent_execution.generate_for", unavailable)
    with pytest.raises(RuntimeError, match="principal unavailable"):
        ai_client.call_ai_with_fallback("input")
