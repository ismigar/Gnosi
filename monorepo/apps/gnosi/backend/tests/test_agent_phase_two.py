"""Focused regression tests for the second agent reliability phase."""
from __future__ import annotations

import time
from pathlib import Path

from backend.agent.semantic_interpreter import interpret_request
from backend.security.egress_policy import is_allowed_url
from backend.security.secret_redaction import redact_secrets
from backend.services import durable_job_queue
from backend.services.agent_observability import recent_spans, span
from backend.services.tool_runtime import MAX_RESULT_CHARS, bound_result, validate_arguments


def test_semantic_interpreter_rewrites_multilingual_inventory_request():
    result = interpret_request("Busca quines fonts bibliogràfiques tinc relacionades amb coaching", mode="inventory")
    assert result["operation"] == "inventory"
    assert result["relation_requested"] is True
    assert "bibliografia" in result["concepts"]
    assert result["confidence"] >= 0.8
    assert result["abstain"] is False


def test_tool_runtime_bounds_arguments_and_results():
    validate_arguments({"query": "ok"})
    try:
        validate_arguments({"query": "x" * 9000})
    except ValueError:
        pass
    else:
        raise AssertionError("oversized argument was accepted")
    bounded = bound_result("x" * (MAX_RESULT_CHARS + 100))
    assert len(bounded) <= MAX_RESULT_CHARS + 80


def test_durable_queue_claim_is_idempotent_and_recoverable(tmp_path, monkeypatch):
    monkeypatch.setattr(durable_job_queue, "queue_path", lambda: Path(tmp_path) / "jobs.sqlite3")
    row = durable_job_queue.enqueue("test", {"id": 1}, idempotency_key="same", job_id="job-1")
    assert row["job_id"] == "job-1"
    assert durable_job_queue.enqueue("test", {"id": 2}, idempotency_key="same")["payload"] == {"id": 1}
    assert durable_job_queue.claim("job-1", "worker-a", lease_seconds=10) is True
    assert durable_job_queue.claim("job-1", "worker-b", lease_seconds=10) is False
    assert durable_job_queue.heartbeat("job-1", "worker-a") is True
    assert durable_job_queue.complete("job-1", "worker-a", {"ok": True}) is True
    assert durable_job_queue.get("job-1")["state"] == "completed"


def test_observability_does_not_store_prompt_attributes(tmp_path, monkeypatch):
    import backend.services.agent_observability as telemetry
    monkeypatch.setattr(telemetry, "_storage_path", lambda: Path(tmp_path) / "spans.jsonl")
    with span("test.operation", trace_id="trace-1", attributes={"provider": "local", "prompt": "secret"}):
        time.sleep(0.001)
    entries = recent_spans("trace-1")
    assert entries and entries[-1]["trace_id"] == "trace-1"
    assert "prompt" not in entries[-1]


def test_security_helpers_reject_private_egress_and_redact_tokens():
    assert is_allowed_url("http://127.0.0.1:8080") is False
    assert "[REDACTED]" in redact_secrets("api_key=sk_test_123456789012345678")
