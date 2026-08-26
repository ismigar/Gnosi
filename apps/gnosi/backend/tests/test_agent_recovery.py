"""Tests for safe, user-confirmed recovery metadata."""

from backend.agent.recovery import is_retryable_error_code, recovery_metadata


def test_transient_agent_failures_offer_one_deliberate_retry():
    assert is_retryable_error_code("agent_loop_exhausted") is True
    assert is_retryable_error_code("rate_limit") is True
    assert recovery_metadata("agent_turn_timeout") == {
        "retryable": True,
        "action": "retry_message",
        "automatic": False,
        "max_attempts": 1,
    }


def test_non_transient_failures_require_editing_or_configuration():
    assert is_retryable_error_code("agent_model_unavailable") is False
    assert recovery_metadata("agent_model_unavailable") == {
        "retryable": False,
        "action": "edit_request",
        "automatic": False,
        "max_attempts": 1,
    }
