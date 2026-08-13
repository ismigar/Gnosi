"""Failure classification: the reason decides whose fault a failed call is.

The whole point of the taxonomy is not to blame the model for things that are
not about the model — see directive `model_failure_reasons.md`.
"""
from datetime import datetime, timedelta

import pytest

from backend.agent import model_reliability as mr


# Real strings observed from the providers during the BOE agent QA.
GROQ_TOOL_FAILURE = (
    "Error code: 400 - {'error': {'message': \"Failed to call a function. Please "
    "adjust your prompt. See 'failed_generation' for more details.\", 'type': "
    "'invalid_request_error', 'code': 'tool_use_failed'}}"
)
OPENROUTER_402 = (
    "Error code: 402 - {'error': {'message': 'This request requires more credits, "
    "or fewer max_tokens. You requested up to 16384 tokens, but can only afford "
    "6336.', 'code': 402}}"
)


@pytest.mark.parametrize("error,expected", [
    (GROQ_TOOL_FAILURE, "tool_use_failed"),
    ("tool call validation failed: attempted to call tool 'x'", "tool_use_failed"),
    (OPENROUTER_402, "insufficient_credit"),
    ("Error code: 429 - rate_limit_exceeded", "rate_limit"),
    ("Error code: 401 - invalid_api_key", "auth"),
    ("This model's maximum context length is 8192 tokens", "context_length_exceeded"),
    ("Read operation timed out", "timeout"),
    ("502 Bad Gateway", "server_error"),
    ("something nobody has ever seen", "unknown"),
    ("", "unknown"),
    (None, "unknown"),
])
def test_provider_errors_are_classified(error, expected):
    assert mr.classify_failure(error) == expected


def test_the_credit_error_is_not_evidence_about_the_model():
    """A 402 must never read as 'this model is bad at tools'."""
    reason = mr.classify_failure(OPENROUTER_402)
    assert mr.fault_of(reason) == "account"
    assert not mr.blames_the_model(reason)


def test_a_malformed_tool_call_is_evidence_about_the_model():
    assert mr.blames_the_model(mr.classify_failure(GROQ_TOOL_FAILURE))


def test_an_exception_object_classifies_like_its_text():
    assert mr.classify_failure(RuntimeError(GROQ_TOOL_FAILURE)) == "tool_use_failed"


def test_recording_needs_a_provider_and_a_model():
    assert mr.record_failure(None, "m", GROQ_TOOL_FAILURE) is None
    assert mr.record_failure("groq", None, GROQ_TOOL_FAILURE) is None


def _isolated_store(tmp_path, monkeypatch):
    monkeypatch.setattr(mr, "_store_path", lambda: tmp_path / "llm_failures.json")


def test_failures_accumulate_per_model_and_reason(tmp_path, monkeypatch):
    _isolated_store(tmp_path, monkeypatch)
    mr.record_failure("groq", "llama-3.3-70b", GROQ_TOOL_FAILURE)
    mr.record_failure("groq", "llama-3.3-70b", GROQ_TOOL_FAILURE)
    mr.record_failure("openrouter", "openai/gpt-4o-mini", OPENROUTER_402)

    rows = {(r["provider"], r["model_id"]): r for r in mr.reliability_report()}
    groq = rows[("groq", "llama-3.3-70b")]
    assert groq["reasons"]["tool_use_failed"] == 2
    assert groq["top_model_reason"] == "tool_use_failed"

    router = rows[("openrouter", "openai/gpt-4o-mini")]
    # Counted, but never attributed to the model.
    assert router["reasons"]["insufficient_credit"] == 1
    assert router["model_fault_total"] == 0
    assert router["top_model_reason"] is None


def test_the_model_at_fault_is_reported_first(tmp_path, monkeypatch):
    _isolated_store(tmp_path, monkeypatch)
    for _ in range(5):
        mr.record_failure("openrouter", "openai/gpt-4o-mini", OPENROUTER_402)
    mr.record_failure("groq", "llama-3.3-70b", GROQ_TOOL_FAILURE)
    assert mr.reliability_report()[0]["model_id"] == "llama-3.3-70b"


def test_old_failures_drop_out_of_the_window(tmp_path, monkeypatch):
    _isolated_store(tmp_path, monkeypatch)
    long_ago = datetime.now() - timedelta(days=90)
    mr.record_failure("groq", "llama-3.3-70b", GROQ_TOOL_FAILURE, when=long_ago)
    assert mr.reliability_report(window_days=30) == []
    assert mr.reliability_report(window_days=365)[0]["reasons"]["tool_use_failed"] == 1


def test_a_model_with_no_history_has_no_evidence(tmp_path, monkeypatch):
    _isolated_store(tmp_path, monkeypatch)
    assert mr.model_evidence("groq", "llama-3.3-70b") is None
